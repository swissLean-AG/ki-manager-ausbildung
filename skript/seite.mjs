// Einstieg der Startseite: Bühne, Einblendungen, Halte, Gleitfahrt, Gebäudeplan, Finale.
// Alles ist Zusatz. Ohne dieses Skript ist die Seite vollständig: gestapelte Stationen mit Schlüsselbild,
// Halte-Texte untereinander, Stimmen nach der Fahrt, Gebäudeplan als Links, Finale als Poster.
//
// Die Bühne startet erst bei der ersten Absicht der Person (Scrollen, Taste, Zeiger) oder sofort, wenn die
// Seite schon gescrollt geöffnet wird. Am Start zeigt das Startbild im HTML ohnehin dasselbe Bild; so bleibt
// der Hauptthread beim Laden frei (kurze Blockierzeit, schnelles grösstes Bild), und wer nicht scrollt, lädt
// keine Fahrtbilder. Die Module der Bühne holt die Seite erst nach dem Laden, damit sie dem Startbild keine
// Leitung wegnehmen; wer vorher scrollt, wartet auf sie.
// Reihenfolge: Bühne, Einblendungen und Halte im selben Durchlauf, damit dazwischen kein Bild gezeichnet wird.
// Die Gleitfahrt hört von Anfang an auf Rad, Wisch und Tasten; ihre erste Eingabe startet die Bühne.
import { starteGleitfahrt } from './gleitfahrt.mjs';
import { starteNavigation } from './navigation.mjs';

const wurzel = document.getElementById('inhalt');
const ausloeser = ['scroll', 'keydown', 'pointerdown'];
let aktiv = false;
let gestartet = null;
let module = null;
let halte = null; // läuft nur mit Bewegung; bei reduzierter Bewegung stehen die Halte im Fluss
let fahrtAnker = null;

const ladeModule = () =>
  (module ??= Promise.all([import('./buehne.mjs'), import('./einblendungen.mjs'), import('./halte.mjs'), import('./finale.mjs')]).then(
    ([buehne, einblendungen, halt, finale]) => ({ ...buehne, ...einblendungen, ...halt, ...finale }),
  ));

// Menü und Leistungs-Abschnitt: Beide funktionieren ohne Skript (details, Endlage des Objekts). Ihre Module kommen
// wie die Bühne erst nach dem Startbild oder bei der ersten Eingabe, damit sie dem grössten Bild keine Leitung nehmen.
let zusatz = null;
const ladeZusatz = () => (zusatz ??= Promise.all([import('./menue.mjs'), import('./leistungen.mjs')]).catch(() => {}));

// Startet die Bühne einmal; jeder weitere Aufruf wartet auf denselben Start.
function aktiviere() {
  return (gestartet ??= starte());
}

async function starte() {
  aktiv = true;
  // Gibt die Stationsbilder frei (buehne.css), auch für den ruhigen Modus und falls die Bühne später anhält.
  document.documentElement.classList.add('fahrt-gestartet');
  ladeZusatz();
  for (const t of ausloeser) window.removeEventListener(t, aktiviere);
  const m = await ladeModule();
  const reduziert = m.reduziertGewuenscht();
  const mitte = merkeMitte(); // unmittelbar vor dem Umschalten, im selben Durchlauf
  m.starteBuehne(wurzel, { reduziert });
  m.starteEinblendungen(document, { reduziert });
  fahrtAnker = m.fahrtAnker;
  if (!reduziert) halte = m.starteHalte({ anker: () => m.fahrtAnker(), gleitet: () => gleitfahrt.laeuft() });
  const finale = document.querySelector('canvas.finale-flaeche');
  const abschnitt = m.leseManifest(wurzel)?.abschnitte.find((a) => a.id === 'chefetage-finale');
  if (finale && abschnitt && !reduziert) {
    let bilder = m.fahrtBilder(abschnitt);
    let lauf = m.starteFinale(finale, bilder);
    // Andere Bildvariante nach Drehen oder Grössenänderung: Finale mit den passenden Bildern neu laden.
    let zeit = 0;
    const pruefe = () => {
      const neu = m.fahrtBilder(abschnitt);
      if (neu[0] === bilder[0]) return;
      bilder = neu;
      lauf.stoppe();
      lauf = m.starteFinale(finale, bilder);
    };
    window.matchMedia('(orientation: portrait)').addEventListener('change', pruefe);
    window.addEventListener(
      'resize',
      () => {
        clearTimeout(zeit);
        zeit = setTimeout(pruefe, 150);
      },
      { passive: true },
    );
  }
  // Browser ohne die Abfrage (scripting): Der Aufbau mit Fahrstrecken kam erst mit dem Umschalten. Mit Sprungmarke
  // geöffnet liegt das Ziel jetzt woanders, also erneut hinspringen; sonst das gemerkte Element zurück in die Mitte.
  // Mit der Abfrage ist der Aufbau vorher und nachher gleich: kein Sprung, auch nicht nach Neuladen mit Sprungmarke
  // in der Adresse, wo der Browser die zuletzt gesehene Stelle wiederherstellt.
  let ziel = null;
  if (!vorab) {
    try {
      ziel = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    } catch {
      // ungültig kodierte Sprungmarke: ignorieren
    }
  }
  if (ziel) ziel.scrollIntoView({ block: 'start', behavior: 'instant' });
  else halteMitte(mitte);
  return m;
}

// Fahrstrecken schon vor dem Start (buehne.css, halte.css). Unbekannte Medienmerkmale treffen nie zu.
const vorab = window.matchMedia('(scripting: enabled)').matches;

// Sicherheitsnetz beim Umschalten: Ändert sich der Aufbau doch (Browser ohne die Abfrage, ruhiger Modus bei Save-Data
// oder 2g, in dem die Halte in den Fluss zurückkommen), bleibt das Element in der Bildschirmmitte, wo es war.
// Nur wenn die Seite schon gescrollt ist; ganz oben ändert sich nichts Sichtbares.
function merkeMitte() {
  if (window.scrollY <= 0) return null;
  const el = document.elementFromPoint(document.documentElement.clientWidth / 2, window.innerHeight / 2);
  if (!el || el === document.documentElement || el === document.body) return null;
  return { el, oben: el.getBoundingClientRect().top };
}

function halteMitte(gemerkt) {
  if (!gemerkt?.el.isConnected) return;
  const versatz = gemerkt.el.getBoundingClientRect().top - gemerkt.oben;
  if (Math.abs(versatz) > 1) window.scrollBy({ top: versatz, behavior: 'instant' });
}

// Einflug ohne Wartezeit: Nach dem Laden, sobald das Startbild gemalt ist, und im Leerlauf die Module und die
// ersten acht Bilder der Fahrt start-buero in den Zwischenspeicher holen, damit der erste Scroll sofort fährt.
// Erst nach dem Startbild, damit nichts davon mit dem grössten Bild (LCP) um die Leitung konkurriert.
// Keine Bilder bei reduzierter Bewegung, Save-Data oder 2g (auf 3g die kleinere Stufe), und nicht, wenn die Bühne schon läuft.
const VORLADEN = 8;
const RUECKFALL_MS = 3000; // ohne Meldung des grössten Bilds (Browser ohne diese Messung): so lange nach dem Laden

function nachDemStartbild(fn) {
  let erledigt = false;
  let beobachter = null;
  const los = () => {
    if (erledigt) return;
    erledigt = true;
    beobachter?.disconnect();
    fn();
  };
  const startbild = document.querySelector('#start .ebenen img');
  if (startbild && window.PerformanceObserver && PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')) {
    beobachter = new PerformanceObserver((liste) => {
      if (liste.getEntries().some((e) => e.element === startbild)) los();
    });
    beobachter.observe({ type: 'largest-contentful-paint', buffered: true });
  }
  setTimeout(los, RUECKFALL_MS);
}
async function vorladen() {
  const m = await ladeModule();
  if (aktiv || m.reduziertGewuenscht()) return;
  const abschnitt = m.leseManifest(wurzel)?.abschnitte.find((a) => a.id === 'start-buero');
  if (!abschnitt) return;
  for (const url of m.fahrtBilder(abschnitt).slice(0, VORLADEN)) {
    const bild = new Image();
    bild.decoding = 'async';
    bild.src = url;
  }
}
const imLeerlauf = () => (window.requestIdleCallback ? requestIdleCallback(vorladen, { timeout: 2000 }) : setTimeout(vorladen, 500));
const spaeter = () =>
  nachDemStartbild(() => {
    ladeZusatz();
    imLeerlauf();
  });

const gleitfahrt = starteGleitfahrt({
  vorbereiten: aktiviere,
  halte: () => (halte && fahrtAnker ? fahrtAnker() : []),
  ruhig: () => !halte || document.documentElement.classList.contains('buehne-ruhig'),
  beimWechsel: () => halte?.pruefe(),
});

starteNavigation(document.querySelector('.gebaeudeplan'));
// Mit Sprungmarke geöffnet: sofort starten. Schon gescrollt geöffnet (der Browser stellt die Lage meist erst später
// her und meldet das mit scroll): im ersten Bild nachsehen, wo das Layout ohnehin ansteht. Ein Lesen von scrollY
// hier beim Laden erzwänge ein Layout der ganzen Seite als lange Aufgabe.
for (const t of ausloeser) window.addEventListener(t, aktiviere, { passive: true });
if (location.hash) aktiviere();
else
  requestAnimationFrame(() => {
    if (!gestartet && window.scrollY > 0) aktiviere();
  });
if (document.readyState === 'complete') spaeter();
else window.addEventListener('load', spaeter, { once: true });
