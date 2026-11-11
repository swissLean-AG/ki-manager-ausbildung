// Scroll-Bühne: eine fixierte Zeichenfläche hinter den Texten zeigt die Kamerafahrt als Bildsequenz.
// Der Scrollfortschritt (fortschritt.mjs) wählt das Bild der Fahrt.
//
// - Natives Scrollen, nur passive scroll- und resize-Lauscher, kein Mausrad- oder Touch-Lauscher.
// - Laden je Abschnitt: aktueller und der nächste in Fahrtrichtung (rückwärts gescrollt der vorherige), nie mehr.
//   Im aktuellen Abschnitt zuerst die acht Bilder ab der Lage in Fahrtrichtung, dann grob vor fein.
// - Jedes Bild wird mit img.decode() decodiert, bevor es gezeigt wird. Fehlt ein Bild, bleibt das letzte stehen.
// - Reduzierte Bewegung, Save-Data, 2g oder slow-2g: keine Fahrtbilder, nur Überblendung der Schlüsselbilder.
//   Auf 3g, bei gemeldeter Bandbreite unter 2 Mbit/s und auf schwachen Geräten läuft die Fahrt als leichte Fahrt
//   weiter (leichteFahrt): kleinste Bildstufe, jedes zweite Bild, geringere Zeichenauflösung.
// - Fehlt das Bild an der Zielstelle noch, mischt die Bühne zwischen den nächsten geladenen Bildern davor und danach
//   (an den Enden mit den Schlüsselbildern) statt stehenzubleiben. Der nächste Abschnitt lädt ab der groben Stufe.
// - Fehlt ein Abschnitt im Manifest (oder das Manifest ganz): Überblendung der Schlüsselbilder, keine Anfrage.
// - Die Schlüsselbilder sind die <picture> der Abschnitte (HTML, ohne JavaScript sichtbar); die Bühne zeichnet
//   deren vom Browser gewählte Datei (currentSrc), lädt also nichts doppelt.
// - Zwischen zwei benachbarten Fahrtbildern wird weich gemischt (fahrtMischung), sobald beide geladen sind.
// - Durchgehende Fahrt ohne Stillstand: Anker sind der Seitenanfang und je Station der Moment, in dem ihre
//   Kopfkarte in der Bildschirmmitte steht. Zwischen zwei Ankern läuft die Fahrt mit jedem Pixel Scroll.
//   Nach der Chefetage fährt die Bühne in die Finalfahrt hinein (bis FINALE_VORLAUF), bis das Kapitel Ausbildung
//   den Bildschirm deckt; das Finale (finale.mjs) setzt an dieser Stelle fort.
// - Am Anfang zeichnet die Bühne genau dort, wo das Startbild im HTML liegt, und weitet sich mit dem ersten Stück
//   Fahrt auf den ganzen Bildschirm; das Startbild blendet im selben Stück aus. So springt beim Umschalten nichts.
// - Ändert sich die Fenstergrösse, wählt die Bühne die passende Bildvariante neu; bis die neuen Bilder da sind,
//   zeigt sie die bisherigen. Ändert sich die Breite (Drehen, Fenster), bleibt die Stelle in der Fahrt erhalten.
//
// Prüfpunkte für Tests an der Zeichenfläche: data-abschnitt, data-index (-1 = Überblendung), data-bild,
// data-mischung (Anteil des Nachbarbilds), data-bild2 (Nachbarbild), data-fortschritt,
// data-ueberblendung (Anteil des nächsten Schlüsselbilds), data-zoom, data-leicht, data-geladen (vollständig geladene Abschnitte).
import { klemme, beiBewegung } from './fortschritt.mjs';

export const REIHE = ['start', 'buero', 'planung', 'werkstatt', 'lager', 'baustelle', 'dienstleistung', 'chefetage'];
const PARALLEL = 4;
// Anteil der Finalfahrt chefetage-finale, den die Bühne nach der Chefetage selbst fährt; das Finale beginnt dort.
export const FINALE_VORLAUF = 0.2;
const RAND = 0.06; // Anteil am Anfang und Ende einer Fahrt, in dem Schlüsselbild und Fahrt ineinander übergehen
const WENDE = 0.05; // Gegenbewegung in Bildschirmhöhen, ab der die Fahrtrichtung als gewechselt gilt
export const NACHLAUF = 0.1; // Anteil der Strecke zur Scrolllage, den die gezeichnete Lage je Bild aufholt
const GRUND = '#0b111b';

// Ruhiger Modus nur bei Save-Data, 2g und slow-2g. 3g meldet Chrome schon bei zeitweise langsamer Leitung,
// dort läuft die Fahrt weiter, aber mit der kleineren Bildstufe (knappesNetz, waehleVariante).
export function langsamesNetz() {
  const c = globalThis.navigator?.connection;
  return !!c && (c.saveData === true || /^(slow-2g|2g)$/.test(c.effectiveType || ''));
}

export function knappesNetz() {
  return globalThis.navigator?.connection?.effectiveType === '3g';
}

// Leichte Fahrt (kein ruhiger Modus, die Fahrt mit Zoom läuft weiter): knappe Leitung (3g oder gemeldete Bandbreite
// unter 2 Mbit/s) oder schwaches Gerät (gemeldeter Speicher höchstens 4 GB oder höchstens 2 Rechenkerne). Dann lädt
// die Bühne die kleinste Bildstufe und nur jedes zweite Bild und zeichnet in geringerer Auflösung. Die Kernzahl zählt
// erst ab 2 abwärts, weil manche Browser auch auf schnellen Handys pauschal 4 melden.
export const LEICHT_SCHRITT = 2;
// Sehr knappe Leitung (gemeldete Bandbreite unter 0.7 Mbit/s, aber nicht 2g, das bleibt ruhig): keine Fahrtbilder, die
// Leitung gehört den Schlüsselbildern. Die Bühne fährt mit einem weichen Zoom auf das aktuelle Schlüsselbild und blendet
// in das nächste über, sobald es da ist. Der Zoom gilt auch sonst, wenn weder Fahrtbild noch nächstes Schlüsselbild da
// ist; bei reduzierter Bewegung nie.
export const SCHLUESSEL_ZOOM = 0.15;
export function nurSchluesselbilder() {
  const c = globalThis.navigator?.connection;
  return !langsamesNetz() && typeof c?.downlink === 'number' && c.downlink > 0 && c.downlink < 0.7;
}
export const LEICHT_DICHTE = 1.25;
export function leichteFahrt() {
  const n = globalThis.navigator;
  const c = n?.connection;
  const netz = knappesNetz() || (typeof c?.downlink === 'number' && c.downlink > 0 && c.downlink < 2);
  const geraet = (n?.deviceMemory > 0 && n.deviceMemory <= 4) || (n?.hardwareConcurrency > 0 && n.hardwareConcurrency <= 2);
  return !!(netz || geraet);
}

export function reduziertGewuenscht() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || langsamesNetz();
}

// Manifest aus data-fahrt (beim Bauen eingebettet). Die CSP verbietet das Nachladen von JSON.
export function leseManifest(wurzel) {
  const roh = wurzel?.dataset?.fahrt;
  if (!roh) return null;
  try {
    const m = JSON.parse(roh);
    return m && m.fassung === 1 && Array.isArray(m.abschnitte) ? m : null;
  } catch {
    return null;
  }
}

async function ladeManifest(option, wurzel) {
  if (option && typeof option === 'object') return { manifest: option, basis: '/bilder/fahrt/' };
  if (typeof option === 'string') {
    // Pfad zu einem Modul neben der JSON-Datei (fahrt.json -> fahrt.mjs mit "export default {...}").
    const pfad = option.replace(/\.json$/, '.mjs');
    try {
      return { manifest: (await import(pfad)).default, basis: pfad.replace(/[^/]*$/, '') };
    } catch {
      return { manifest: null, basis: '/bilder/fahrt/' };
    }
  }
  return { manifest: leseManifest(wurzel), basis: '/bilder/fahrt/' };
}

// Leichte Fahrt: im Hochformat hoch-480, falls der Abschnitt sie hat (Manifest hochLeicht), quer die kleinste Breite.
export function waehleVariante(abschnitt, leicht = leichteFahrt()) {
  if (abschnitt.hoch && window.matchMedia('(orientation: portrait)').matches) return leicht && abschnitt.hochLeicht ? 'hoch-480' : 'hoch-720';
  const noetig = Math.max(window.innerWidth, window.innerHeight * 1.5) * Math.min(window.devicePixelRatio || 1, 2);
  const breiten = [...abschnitt.breiten].sort((a, b) => a - b);
  if (leicht || knappesNetz()) return String(breiten[0]);
  return String(breiten.find((b) => b >= noetig * 0.8) ?? breiten[breiten.length - 1]);
}

// Bildnummern der Fahrt: jedes, in der leichten Fahrt jedes zweite; das letzte Bild immer, damit die Fahrt an der
// nächsten Station ankommt.
export function fahrtNummern(n, schritt = 1) {
  const r = [];
  for (let i = 0; i < n; i += schritt) r.push(i);
  if (r[r.length - 1] !== n - 1) r.push(n - 1);
  return r;
}

export function fahrtBilder(abschnitt, basis = '/bilder/fahrt/', variante = waehleVariante(abschnitt), schritt = leichteFahrt() ? LEICHT_SCHRITT : 1) {
  return fahrtNummern(Math.min(abschnitt.bilder, 90), schritt).map((i) => `${basis}${abschnitt.id}/${variante}/${String(i + 1).padStart(3, '0')}.avif`);
}

// Ohne passendes Bild an der Zielstelle: die nächsten geladenen Bilder davor (lo) und danach (hi), Anteil t von hi.
// Fehlt eines davon, gilt das Schlüsselbild der Station davor als Bild 0 und das der Station danach als letztes Bild
// (vorhanden(-1) und vorhanden(n)). So mischt die Bühne immer zwischen dem, was schon da ist, und steht nie still.
export function umgebung(ziel, n, vorhanden) {
  let lo = Math.min(Math.floor(ziel), n - 1);
  while (lo >= 0 && !vorhanden(lo)) lo--;
  let hi = Math.max(Math.ceil(ziel), 0);
  while (hi < n && !vorhanden(hi)) hi++;
  if (lo < 0 && vorhanden(-1)) lo = -1;
  else if (lo < 0) lo = null;
  if (hi >= n && vorhanden(n)) hi = n;
  else if (hi >= n) hi = null;
  if (lo === null && hi === null) return null;
  if (lo === null || hi === null || lo === hi) return { lo: lo ?? hi, hi: lo ?? hi, t: 0 };
  const posLo = Math.max(lo, 0);
  const posHi = Math.min(hi, n - 1);
  return { lo, hi, t: posHi > posLo ? Math.min(1, Math.max(0, (ziel - posLo) / (posHi - posLo))) : 0 };
}

// Lage zwischen zwei Fahrtbildern: unteres Bild i0, oberes i1, Anteil t von i1 (0 bis unter 1).
// Die Bühne zeichnet i0 deckend und i1 mit Deckkraft t darüber, so läuft die Fahrt auch bei wenigen Bildern weich.
export function fahrtMischung(q, n) {
  if (n <= 1) return { i0: 0, i1: 0, t: 0 };
  const f = klemme(q) * (n - 1);
  const i0 = Math.min(Math.floor(f), n - 1);
  const i1 = Math.min(i0 + 1, n - 1);
  return { i0, i1, t: i1 === i0 ? 0 : f - i0 };
}

// Abschnitt k und Anteil p aus der Scrollposition y und den Ankern (aufsteigend). Zwischen dem ersten und dem
// letzten Anker gibt es keinen Bereich ohne Bewegung; danach steht der letzte Zustand.
export function lageAus(y, anker) {
  for (let k = 0; k < anker.length - 1; k++) {
    if (y < anker[k + 1]) {
      const weg = anker[k + 1] - anker[k];
      return { k, p: weg > 0 ? Math.max(0, y - anker[k]) / weg : 1 };
    }
  }
  return { k: anker.length - 1, p: 1 };
}

// Anker der Fahrt als Scrolllagen: Seitenanfang, je Station der Moment, in dem ihre Kopfkarte in der Bildschirmmitte
// steht, zuletzt die Lage, in der das Kapitel Ausbildung den Bildschirm deckt (Ende der Fahrt). Eine Quelle für
// Bühne, Halte und Gleitfahrt.
export function fahrtAnker(stationen = REIHE.map((id) => document.getElementById(id)), abdeckung = document.getElementById('ausbildung')) {
  const y = window.scrollY;
  const halb = window.innerHeight * 0.5;
  const a = [0];
  for (let k = 1; k < stationen.length; k++) {
    const s = stationen[k];
    a.push(Math.max(a[k - 1], s.getBoundingClientRect().top + y + (parseFloat(getComputedStyle(s).paddingTop) || 0) - halb));
  }
  if (abdeckung) a.push(Math.max(a[a.length - 1], abdeckung.getBoundingClientRect().top + y));
  return a;
}

// Scrollposition zu Abschnitt k und Anteil p (Umkehrung von lageAus).
export function yAus(k, p, anker) {
  if (k >= anker.length - 1) return anker[anker.length - 1];
  return anker[k] + klemme(p) * (anker[k + 1] - anker[k]);
}

// Ladereihenfolge grob vor fein: Anfang, Ende, dann jedes 8., 4., 2. und zuletzt jedes Bild.
// Mit Lage "ab": zuerst die acht Bilder ab dort in Fahrtrichtung (richtung 1 vorwärts, -1 rückwärts),
// damit beim Scrollen nichts hängt. Rückwärts ohne Lage beginnt die Reihenfolge am Ende.
export function ladeReihenfolge(n, ab = null, richtung = 1) {
  const r = [];
  const gesehen = new Set();
  const dazu = (i) => {
    if (i >= 0 && i < n && !gesehen.has(i)) {
      gesehen.add(i);
      r.push(i);
    }
  };
  const schritt1 = richtung < 0 ? -1 : 1;
  if (ab !== null && ab !== undefined) {
    for (let j = 0; j < 8; j++) dazu(ab + schritt1 * j);
  } else if (schritt1 < 0) {
    dazu(n - 1);
    dazu(0);
  } else {
    dazu(0);
    dazu(n - 1);
  }
  for (const schritt of [8, 4, 2, 1]) for (let i = 0; i < n; i += schritt) dazu(i);
  return r;
}

// Zeichnet das Bild deckend (wie object-fit: cover, mittig). Mit rahmen nur in diesem Rechteck (Gerätepixel).
// zoom über 1 vergrössert mittig (Fahrt ohne Fahrtbilder).
export function zeichneDeckend(ctx, bild, alpha = 1, rahmen = null, zoom = 1) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const iw = bild.naturalWidth;
  const ih = bild.naturalHeight;
  if (!iw || !ih || !cw || !ch) return false;
  const r = rahmen ?? { x: 0, y: 0, w: cw, h: ch };
  const s = Math.max(r.w / iw, r.h / ih) * zoom;
  const w = iw * s;
  const h = ih * s;
  ctx.globalAlpha = alpha;
  if (rahmen) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
  }
  ctx.drawImage(bild, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  if (rahmen) ctx.restore();
  ctx.globalAlpha = 1;
  return true;
}

export function starteBuehne(wurzel, optionen = {}) {
  const html = document.documentElement;
  const reduziert = optionen.reduziert ?? reduziertGewuenscht();
  const leicht = !reduziert && (optionen.leicht ?? leichteFahrt());
  const nurSchluessel = !reduziert && (optionen.nurSchluessel ?? nurSchluesselbilder());
  const stationen = REIHE.map((id) => document.getElementById(id));
  if (stationen.some((s) => !s)) return { stoppe() {} };

  const huelle = document.createElement('div');
  huelle.className = 'buehne';
  huelle.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'buehne-flaeche';
  huelle.append(canvas);
  document.body.prepend(huelle);
  const ctx = canvas.getContext('2d', { alpha: false });
  html.classList.add('buehne-an');
  html.classList.toggle('buehne-ruhig', reduziert);
  if (nurSchluessel) canvas.dataset.leicht = 'schluessel';
  else if (leicht) canvas.dataset.leicht = 'ja';

  let manifest = null;
  let basis = '/bilder/fahrt/';
  let gestoppt = false;
  let letzterZustand = '';
  const cache = new Map(); // Abschnitt-ID -> { variante, urls, bilder, ersatz, fertig, abgebrochen, fehler, laufend }
  const ersatz = new Map(); // Abschnitt-ID -> Bilder der vorherigen Variante, bis die neue geladen ist

  // Fahrtrichtung mit Schwelle: Eine kleine Gegenbewegung (Nachfedern beim Wischen) wechselt sie nicht.
  let richtung = 1;
  let wendeY = window.scrollY;
  const merkeRichtung = () => {
    const y = window.scrollY;
    const schwelle = window.innerHeight * WENDE;
    if (richtung > 0) {
      if (y > wendeY) wendeY = y;
      else if (wendeY - y > schwelle) {
        richtung = -1;
        wendeY = y;
      }
    } else if (y < wendeY) wendeY = y;
    else if (y - wendeY > schwelle) {
      richtung = 1;
      wendeY = y;
    }
  };

  // Schlüsselbilder: <img> der Abschnitte. Bereit, sobald geladen und decodiert.
  const schluessel = stationen.map((s) => s.querySelector('.ebenen img'));
  const startEbenen = stationen[0].querySelector('.ebenen');
  const bereit = new WeakSet();
  const decodiere = (img) => {
    if (!img || bereit.has(img) || img.dataset.decodiert === 'laeuft') return;
    if (img.loading === 'lazy') img.loading = 'eager';
    img.dataset.decodiert = 'laeuft';
    const fertig = () => {
      if (img.naturalWidth > 0) {
        bereit.add(img);
        plan.plane();
      }
      delete img.dataset.decodiert;
    };
    const versuch = () => img.decode().then(fertig, fertig);
    if (img.complete) versuch();
    else img.addEventListener('load', versuch, { once: true });
  };

  const LETZTE = REIHE.length - 1;
  const idFuer = (k) => (k < 0 ? '' : k < LETZTE ? `${REIHE[k]}-${REIHE[k + 1]}` : k === LETZTE ? `${REIHE[LETZTE]}-finale` : '');
  const abschnittFuer = (k) => manifest?.abschnitte.find((a) => a.id === idFuer(k)) ?? null;
  const abdeckung = document.getElementById('ausbildung');
  // Anteil der Fahrt im Abschnitt k: beim Vorlauf in das Finale nur bis FINALE_VORLAUF.
  const anteil = (k, p) => (k === LETZTE ? FINALE_VORLAUF * klemme(p) : klemme(p));
  const bildAus = (e, i) => e.bilder[i] || e.ersatz?.[i] || null;

  // Zeichenauflösung: höchstens doppelte Pixeldichte, in der leichten Fahrt LEICHT_DICHTE (die kleine Bildstufe hat
  // ohnehin nicht mehr Pixel, und jedes Bild kostet auf schwachen Geräten weniger Zeichenarbeit).
  const dichte = () => Math.min(window.devicePixelRatio || 1, leicht ? LEICHT_DICHTE : 2);
  function miss() {
    const breite = Math.round(canvas.clientWidth * dichte());
    const hoehe = Math.round(canvas.clientHeight * dichte());
    if (canvas.width !== breite || canvas.height !== hoehe) {
      canvas.width = breite;
      canvas.height = hoehe;
      letzterZustand = '';
    }
  }

  function anker() {
    return fahrtAnker(stationen, abdeckung);
  }

  // Aktueller Abschnitt k und sein Fortschritt p. Nach dem letzten Anker: Ende des letzten Abschnitts.
  function lage(y = window.scrollY) {
    const a = anker();
    const l = lageAus(y, a);
    return l.k >= a.length - 1 ? { k: a.length - 2, p: 1 } : l;
  }

  // Nachlauf: Die gezeichnete Lage folgt der Scrolllage weich, Anteil NACHLAUF je Bild bei 60 Bildern pro Sekunde
  // (über die Zeit gerechnet, gleich schnell bei jeder Bildrate). Das Scrollen selbst bleibt unberührt. Grosse Sprünge
  // (Sprungmarke, Drehen, Fenstergrösse) und reduzierte Bewegung folgen sofort. Nur das Zeichnen nutzt diese Lage;
  // Nachladen und Positionsmerker rechnen mit der echten Scrolllage.
  let yBild = window.scrollY;
  let letzteZeit = 0;
  function folgeLage() {
    const ziel = window.scrollY;
    const jetzt = performance.now();
    if (reduziert || Math.abs(ziel - yBild) > window.innerHeight * 0.5) yBild = ziel;
    else if (yBild !== ziel) {
      const dt = letzteZeit ? Math.min(50, jetzt - letzteZeit) : 1000 / 60;
      yBild += (ziel - yBild) * (1 - (1 - NACHLAUF) ** (dt / (1000 / 60)));
      if (Math.abs(ziel - yBild) < 0.5) yBild = ziel;
    }
    const laeuft = yBild !== ziel;
    letzteZeit = laeuft ? jetzt : 0;
    return laeuft;
  }

  function ladeAbschnitt(k) {
    const a = abschnittFuer(k);
    if (!a || reduziert || nurSchluessel || cache.has(a.id)) return;
    const variante = waehleVariante(a, leicht);
    const urls = fahrtBilder(a, basis, variante, leicht ? LEICHT_SCHRITT : 1);
    const eintrag = {
      variante,
      urls,
      bilder: new Array(urls.length).fill(null),
      ersatz: ersatz.get(a.id) ?? null,
      fertig: false,
      grob: false,
      erledigt: 0,
      abgebrochen: false,
      fehler: 0,
      laufend: new Set(),
    };
    ersatz.delete(a.id);
    cache.set(a.id, eintrag);
    const jetzt = lage();
    let ab = null;
    if (jetzt.k === k) ab = Math.floor(anteil(k, jetzt.p) * (urls.length - 1));
    else if (k < jetzt.k) ab = urls.length - 1; // rückwärts betritt man den Abschnitt an seinem Ende
    const folge = ladeReihenfolge(urls.length, ab, jetzt.k === k ? richtung : k < jetzt.k ? -1 : 1);
    // Grobe Stufe: die acht Bilder ab der Lage plus jedes vierte. Danach darf der nächste Abschnitt schon laden
    // (gestaffelt), während hier die Zwischenbilder folgen; die Bühne mischt bis dahin zwischen den groben Bildern.
    const grobGrenze = Math.min(folge.length, 8 + Math.ceil(urls.length / 4));
    let naechster = 0;
    let offen = 0;
    const weiter = () => {
      if (eintrag.abgebrochen) return;
      if (naechster >= folge.length && offen === 0) {
        eintrag.fertig = true;
        eintrag.ersatz = null;
        meldeGeladen();
        nachladen();
        return;
      }
      while (offen < PARALLEL && naechster < folge.length) {
        const i = folge[naechster++];
        offen++;
        const img = new Image();
        eintrag.laufend.add(img);
        img.decoding = 'async';
        img.src = urls[i];
        img.decode().then(
          () => {
            if (!eintrag.abgebrochen) {
              eintrag.bilder[i] = img;
              plan.plane();
            }
          },
          () => {
            eintrag.fehler++;
          },
        ).finally(() => {
          eintrag.laufend.delete(img);
          offen--;
          if (!eintrag.grob && ++eintrag.erledigt >= grobGrenze && !eintrag.abgebrochen) {
            eintrag.grob = true;
            nachladen();
          }
          weiter();
        });
      }
    };
    weiter();
  }

  // Verworfener Abschnitt: laufende Anfragen abbrechen, damit sie nicht zu Ende laden und decodieren.
  function verwirf(e) {
    e.abgebrochen = true;
    for (const img of e.laufend) img.removeAttribute('src');
    e.laufend.clear();
  }

  function meldeGeladen() {
    canvas.dataset.geladen = [...cache].filter(([, e]) => e.fertig && e.fehler < e.urls.length).map(([id]) => id).join(',');
  }

  // Nur der aktuelle und der nächste Abschnitt in Fahrtrichtung bleiben im Speicher; geladen wird der Nachbar,
  // sobald der aktuelle seine grobe Stufe hat (gestaffelt, nicht erst ganz am Ende).
  function nachladen() {
    if (gestoppt || !manifest || reduziert) return;
    const { k } = lage();
    const nachbar = richtung < 0 ? k - 1 : k + 1;
    const behalten = new Set([abschnittFuer(k)?.id, abschnittFuer(nachbar)?.id].filter(Boolean));
    for (const [id, e] of cache) {
      if (!behalten.has(id)) {
        verwirf(e);
        cache.delete(id);
      }
    }
    for (const id of ersatz.keys()) if (!behalten.has(id)) ersatz.delete(id);
    meldeGeladen();
    const aktuell = abschnittFuer(k);
    if (aktuell && !cache.has(aktuell.id)) ladeAbschnitt(k);
    else if (!aktuell || cache.get(aktuell.id)?.fertig || cache.get(aktuell.id)?.grob) ladeAbschnitt(nachbar);
  }

  // Passt die geladene Variante nicht mehr zur Fenstergrösse, wird der Abschnitt neu geladen. Die bisherigen
  // Bilder bleiben als Ersatz sichtbar, bis die neuen da sind.
  function pruefeVarianten() {
    if (!manifest) return;
    let geaendert = false;
    for (const [id, e] of cache) {
      const a = manifest.abschnitte.find((x) => x.id === id);
      if (!a || waehleVariante(a, leicht) === e.variante) continue;
      verwirf(e);
      cache.delete(id);
      const alt = e.bilder.map((b, i) => b || e.ersatz?.[i] || null);
      if (alt.some(Boolean)) ersatz.set(id, alt);
      geaendert = true;
    }
    if (geaendert) {
      meldeGeladen();
      letzterZustand = '';
      plan.plane();
    }
  }

  // Am Anfang der ersten Fahrt: Rechteck, in dem die Bühne zeichnet. Bei q = 0 genau die Lage des Startbilds im
  // HTML, bis q = RAND aufgeweitet auf den ganzen Bildschirm. Danach null (ganze Fläche).
  function startRahmen(k, q) {
    if (k !== 0 || !startEbenen) return null;
    const s = klemme(q / RAND);
    if (s >= 1) return null;
    const r = startEbenen.getBoundingClientRect();
    const f = canvas.width / (canvas.clientWidth || 1);
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    const mix = (a, b) => (a * (1 - s) + b * s) * f;
    return { x: mix(r.left, 0), y: mix(r.top, 0), w: mix(r.width, vw), h: mix(r.height, vh) };
  }

  let deckung = '';
  function setzeStartDeckung(wert) {
    if (!startEbenen || wert === deckung) return;
    deckung = wert;
    startEbenen.style.setProperty('--start-deckung', wert);
  }

  function zeichne() {
    if (gestoppt) return;
    const { k, p } = lage(yBild);
    const a = schluessel[k];
    const b = schluessel[k + 1] ?? null;
    decodiere(a);
    if (b) decodiere(b);
    if (schluessel[k + 2]) decodiere(schluessel[k + 2]);
    const abschnitt = abschnittFuer(k);
    const eintrag = abschnitt ? cache.get(abschnitt.id) : null;
    const q = klemme(p);
    const f = anteil(k, p); // Lage in der Fahrt (beim Vorlauf in das Finale nur bis FINALE_VORLAUF)
    let index = -1;
    let haupt = null;
    let neben = null;
    let t = 0;
    if (eintrag && q > 0 && (q < 1 || k === LETZTE)) {
      const m = fahrtMischung(f, eintrag.urls.length);
      if (bildAus(eintrag, m.i0) && bildAus(eintrag, m.i1)) {
        // Beide Nachbarn da: weich mischen.
        index = m.i0;
        haupt = bildAus(eintrag, m.i0);
        if (m.t > 0) {
          neben = bildAus(eintrag, m.i1);
          t = m.t;
        }
      } else {
        // Noch nicht alles geladen (grob vor fein): zwischen den nächsten geladenen Bildern davor und danach mischen,
        // an den Enden mit den Schlüsselbildern der Stationen. Ein fehlendes Bild hält die Fahrt so nie an.
        const n = eintrag.urls.length;
        const schl = (i) => (i < 0 ? (bereit.has(a) ? a : null) : i >= n ? (b && bereit.has(b) ? b : null) : bildAus(eintrag, i));
        const u = umgebung(f * (n - 1), n, (i) => !!schl(i));
        if (u) {
          index = u.lo >= 0 && u.lo < n ? u.lo : -1;
          haupt = schl(u.lo);
          if (u.t > 0 && u.hi !== u.lo) {
            neben = schl(u.hi);
            t = u.t;
          }
        }
      }
    }
    const rahmen = startRahmen(k, q);
    const id = idFuer(k);
    // Mischpartner und Anteil gehören dazu: kommt ein fehlendes Bild an, wechselt nur der Partner, nicht die Lage.
    const zustand = `${id}|${index}|${haupt?.src ?? ''}|${neben?.src ?? ''}|${t.toFixed(3)}|${q.toFixed(3)}|${bereit.has(a)}|${b ? bereit.has(b) : ''}|${canvas.width}x${canvas.height}|${rahmen ? Math.round(rahmen.y) : ''}`;
    if (zustand === letzterZustand) return;
    // Im Startrahmen bleibt Fläche frei: dort Grund, aber nur wenn danach wirklich ein Bild gezeichnet wird
    // (der Rahmen besteht nur am Anfang der ersten Fahrt, gezeichnet wird dann das Fahrtbild oder das Startbild).
    if (rahmen && (haupt || bereit.has(a))) {
      ctx.fillStyle = GRUND;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    let gezeichnet = false;
    let quelle = '';
    let ueber = 0; // Anteil des nächsten Schlüsselbilds in der Überblendung (data-ueberblendung)
    let zoom = 1; // Zoom auf das aktuelle Schlüsselbild ohne Fahrtbilder (data-zoom)
    if (haupt) {
      gezeichnet = zeichneDeckend(ctx, haupt, 1, rahmen);
      quelle = haupt.currentSrc || haupt.src;
      if (neben) zeichneDeckend(ctx, neben, t, rahmen);
      const alphaA = klemme(1 - q / RAND);
      const alphaB = klemme((q - (1 - RAND)) / RAND);
      if (alphaA > 0 && bereit.has(a)) zeichneDeckend(ctx, a, alphaA, rahmen);
      if (alphaB > 0 && b && bereit.has(b)) zeichneDeckend(ctx, b, alphaB);
    } else {
      // Überblendung der Schlüsselbilder (reduziert, fehlender Abschnitt, Fahrtbilder noch nicht da).
      const aOk = bereit.has(a);
      const bOk = !!b && bereit.has(b);
      if (aOk && (q < 1 || !bOk)) {
        zoom = reduziert ? 1 : 1 + SCHLUESSEL_ZOOM * q;
        gezeichnet = zeichneDeckend(ctx, a, 1, rahmen, zoom);
        quelle = a.currentSrc || a.src;
        if (bOk && q > 0) {
          zeichneDeckend(ctx, b, q, rahmen);
          ueber = q;
          if (q >= 0.5) quelle = b.currentSrc || b.src;
        }
      } else if (bOk && q >= 0.5) {
        gezeichnet = zeichneDeckend(ctx, b, 1, rahmen);
        quelle = b.currentSrc || b.src;
        ueber = 1;
      }
    }
    if (!gezeichnet) return; // nichts Fertiges: letztes Bild bleibt stehen, kein Flackern
    letzterZustand = zustand;
    canvas.dataset.abschnitt = id;
    canvas.dataset.index = String(index);
    canvas.dataset.bild = quelle.replace(location.origin, '');
    canvas.dataset.mischung = t.toFixed(3);
    canvas.dataset.bild2 = neben ? (neben.currentSrc || neben.src).replace(location.origin, '') : '';
    canvas.dataset.fortschritt = q.toFixed(3);
    canvas.dataset.ueberblendung = ueber.toFixed(3);
    canvas.dataset.zoom = zoom.toFixed(3);
    // Das Startbild im HTML blendet erst aus, wenn die Bühne an seiner Stelle dasselbe zeigt.
    setzeStartDeckung(k === 0 ? klemme(1 - q / RAND).toFixed(3) : '0');
    if (!html.classList.contains('buehne-bereit')) html.classList.add('buehne-bereit');
  }

  // Stelle in der Fahrt, zuletzt beim Scrollen gemessen, mit der Fensterbreite dazu.
  let stelle = null;
  const merkeStelle = () => {
    const l = lage();
    stelle = { ...l, breite: window.innerWidth };
  };

  const plan = beiBewegung(() => {
    merkeRichtung();
    miss();
    const laeuft = folgeLage();
    canvas.dataset.lageY = String(Math.round(yBild));
    zeichne();
    nachladen();
    merkeStelle();
    if (laeuft) plan.plane();
  });

  // Breite geändert (Drehen, Fenster): Die Fahrstrecke hängt an der Bildschirmhöhe, dieselbe Scrollposition
  // läge sonst in einem anderen Abschnitt. Vor dem nächsten Bild zur gemerkten Stelle zurück.
  const groesse = () => {
    if (stelle && stelle.breite !== window.innerWidth) {
      const ziel = yAus(stelle.k, stelle.p, anker());
      if (Math.abs(ziel - window.scrollY) > 1) window.scrollTo({ top: ziel, behavior: 'instant' });
      wendeY = window.scrollY;
      stelle = { ...stelle, breite: window.innerWidth };
    }
    clearTimeout(varianteZeit);
    varianteZeit = setTimeout(pruefeVarianten, 150);
  };
  let varianteZeit = 0;
  window.addEventListener('resize', groesse, { passive: true });
  const hochformat = window.matchMedia('(orientation: portrait)');
  const wechsel = () => {
    pruefeVarianten();
    miss();
    plan.plane();
  };
  hochformat.addEventListener('change', wechsel);

  // Das Startbild ist beim Umschalten schon sichtbar, also geladen und decodiert: sofort zeichnen, ohne auf
  // ein weiteres decode() zu warten, damit die Bühne im selben Durchlauf steht.
  if (schluessel[0]?.complete && schluessel[0].naturalWidth > 0) bereit.add(schluessel[0]);
  miss();
  zeichne();
  merkeStelle();
  ladeManifest(optionen.manifest, wurzel).then((r) => {
    if (gestoppt) return;
    manifest = r.manifest;
    basis = r.basis;
    canvas.dataset.geladen = '';
    // Fahrtbilder erst nach dem Laden der Seite, damit das Startbild (LCP) Vorrang hat; danach sofort, ohne Leerlauf
    // abzuwarten, weil die Bühne erst bei der ersten Absicht (Scroll, Taste, Zeiger) startet.
    if (document.readyState === 'complete') nachladen();
    else window.addEventListener('load', () => nachladen(), { once: true });
  });

  return {
    stoppe() {
      gestoppt = true;
      plan.stoppe();
      clearTimeout(varianteZeit);
      window.removeEventListener('resize', groesse);
      hochformat.removeEventListener('change', wechsel);
      for (const e of cache.values()) verwirf(e);
      cache.clear();
      ersatz.clear();
      huelle.remove();
      startEbenen?.style.removeProperty('--start-deckung');
      html.classList.remove('buehne-an', 'buehne-bereit', 'buehne-ruhig');
    },
  };
}
