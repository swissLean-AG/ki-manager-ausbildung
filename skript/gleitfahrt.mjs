// Gleitfahrt: Steht die Seite an einem Halt der Kamerafahrt (Seitenanfang oder Station), fährt die erste
// Scrollbewegung selbständig bis zum nächsten Halt in dieser Richtung. Die Bühne folgt der Scrolllage wie immer,
// so läuft die Bildspur sichtbar durch. Am Halt steht die Seite still, bis die nächste Eingabe kommt.
//
// - Auslöser: Mausrad, Touch-Wisch ab rund 10 px, Bild-ab und Bild-auf, Leertaste, Pfeil ab und auf.
// - Während einer Fahrt schluckt das Skript Radereignisse in Fahrtrichtung (Nachlauf eines Trackpads), nach der
//   Ankunft noch so lange, bis rund 400 ms Ruhe ist. So wird kein Halt übersprungen.
// - Gegenrichtung, Berührung, Mausklick (auch auf die Bildlaufleiste) und jede Taste brechen die Fahrt sofort ab.
// - Nur im Bereich der Fahrt, vom Seitenanfang bis zum Ende der Finalfahrt. Darunter scrollt alles normal.
// - Keine Gleitfahrt bei reduzierter Bewegung, im ruhigen Modus der Bühne und wenn der Fokus in einem
//   Formularfeld oder Video steckt. Sprungmarken und Tabulator bleiben unberührt.
//
// Prüfpunkt: html.gleitet, solange eine Fahrt läuft.

export const DAUER_MIN = 1500;
export const DAUER_MAX = 2400; // mit Bildtakt und Startverzögerung bleibt die Fahrt unter 2.5 s
const NACHLAUF = 400; // ms Ruhe nach der Ankunft, bis Radereignisse in Fahrtrichtung wieder zählen
const WISCH = 10; // px Fingerweg, ab dem ein Wisch als Absicht gilt
const TAKT = 17; // ms, angenommener Bildabstand, bis zwei Bilder gemessen sind
const TAKT_MAX = 34; // ms, ein einzelnes langsames Bild zieht die Ankunft höchstens um diesen Wert vor
const RESERVE = 60; // ms vor der Frist ankommen: Platz für die Arbeit nach der Ankunft und ein gestautes Bild

const klemme = (x) => Math.min(1, Math.max(0, x));

// Zeitpunkt der Eingabe aus dem Ereignis selbst (gleiche Uhr wie performance.now()). Ältere Browser liefern dort
// eine Zeit seit 1970 oder 0: dann gilt jetzt.
export function eingabeZeit(e, jetzt = performance.now()) {
  const t = e?.timeStamp;
  return t > 0 && t <= jetzt ? t : jetzt;
}

// Fahrtlage zum Zeitpunkt jetzt. Kommt das nächste Bild voraussichtlich erst nach dem Ende (jetzt plus ein Bildabstand),
// springt schon dieses Bild aufs Ziel: So liegt die Ankunft nie nach der Frist, auch wenn der Bildtakt nicht aufgeht.
export function fahrtLage({ von, nach, start, ende }, jetzt, takt = TAKT) {
  if (jetzt + takt > ende) return { y: nach, fertig: true };
  return { y: von + (nach - von) * kurve((jetzt - start) / Math.max(ende - start, 1)), fertig: false };
}

// Weich anfahren und weich bremsen (halbe Kosinuswelle).
export function kurve(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * klemme(t));
}

// Dauer je nach Strecke, gemessen in Bildschirmhöhen: kurze Wege 1.5 s, lange höchstens 2.4 s.
export function dauerFuer(strecke, hoehe) {
  const bildschirme = Math.abs(strecke) / Math.max(hoehe, 1);
  return Math.round(Math.min(DAUER_MAX, Math.max(DAUER_MIN, 1200 + 380 * bildschirme)));
}

// Abstand, innerhalb dessen die Seite als "am Halt" gilt.
export function haltToleranz(hoehe) {
  return Math.max(8, Math.min(60, hoehe * 0.04));
}

// Ziel der Fahrt: nächster Halt in Richtung (1 nach unten, -1 nach oben), oder null für normales Scrollen.
// Der letzte Halt ist das Ende der Fahrt: Von dort und darunter nach unten scrollt die Seite normal.
export function zielHalt(y, halte, richtung, tol) {
  if (!halte.length) return null;
  const ende = halte[halte.length - 1];
  if (y > ende + tol) return null;
  if (richtung > 0) {
    if (y >= ende - tol) return null;
    return halte.find((h) => h > y + tol) ?? null;
  }
  for (let i = halte.length - 1; i >= 0; i--) if (halte[i] < y - tol) return halte[i];
  return null;
}

const FORMULAR = 'input, textarea, select, video, audio, [contenteditable]:not([contenteditable="false"])';
// Tasten, die auf diesen Elementen etwas anderes tun als scrollen (Leertaste drückt einen Knopf, klappt auf).
const BEDIENELEMENT = `${FORMULAR}, button, summary`;

function tastenRichtung(e) {
  if (e.key === 'PageDown' || e.key === 'ArrowDown' || (e.key === ' ' && !e.shiftKey)) return 1;
  if (e.key === 'PageUp' || e.key === 'ArrowUp' || (e.key === ' ' && e.shiftKey)) return -1;
  return 0;
}

// optionen:
//   vorbereiten(): Promise, startet die Bühne (Module nachladen, Umschalten des Layouts)
//   halte(): Scrolllagen der Halte, aufsteigend, das letzte Element ist das Ende der Fahrt
//   ruhig(): true, wenn die Bühne im ruhigen Modus läuft
//   beimWechsel(laeuft): wird beim Start und beim Ende jeder Fahrt aufgerufen
export function starteGleitfahrt({ vorbereiten, halte, ruhig = () => false, beimWechsel = () => {} } = {}) {
  const html = document.documentElement;
  const reduziert = window.matchMedia('(prefers-reduced-motion: reduce)');
  let bereit = false;
  let aus = false;
  let wartet = 0; // Richtung der ersten Eingabe, während die Bühne startet
  let fahrt = null; // { von, nach, richtung, start, ende, bild, letzt }
  let sperre = { bis: 0, richtung: 0 };
  let finger = null; // { y, seit, entscheid: null | 'gleiten' | 'normal' }

  const gesperrt = () => aus || reduziert.matches || (bereit && ruhig());
  const imFeld = (el, auswahl) => !!(el && el.closest && el.closest(auswahl));

  function ankunft() {
    const r = fahrt.richtung;
    fahrt = null;
    html.classList.remove('gleitet');
    sperre = { bis: performance.now() + NACHLAUF, richtung: r };
    beimWechsel(false);
  }

  function abbrechen() {
    if (!fahrt) return;
    cancelAnimationFrame(fahrt.bild);
    fahrt = null;
    html.classList.remove('gleitet');
    beimWechsel(false);
  }

  function schritt() {
    if (!fahrt) return;
    const jetzt = performance.now();
    const takt = fahrt.letzt ? Math.min(TAKT_MAX, Math.max(1, jetzt - fahrt.letzt)) : TAKT;
    fahrt.letzt = jetzt;
    const { y, fertig } = fahrtLage(fahrt, jetzt, takt);
    window.scrollTo({ top: y, behavior: 'instant' });
    if (fertig) ankunft();
    else fahrt.bild = requestAnimationFrame(schritt);
  }

  // Fahrt zum nächsten Halt in Richtung r. Liefert false, wenn dort normal gescrollt wird.
  // seit: Zeitpunkt der Eingabe. Die Frist der Ankunft zählt ab dort, nicht ab dem Start der Fahrt: Was zwischen
  // Eingabe und Fahrt liegt (Start der Bühne, beim Wisch schon ab dem Aufsetzen des Fingers), geht von der Fahrt ab,
  // nie unter DAUER_MIN. So vergeht von der Eingabe bis zur Ankunft höchstens die Dauer der Strecke.
  function fahre(r, seit = performance.now()) {
    const y = window.scrollY;
    const ziel = zielHalt(y, halte(), r, haltToleranz(window.innerHeight));
    if (ziel === null) return false;
    const jetzt = performance.now();
    const ende = Math.max(jetzt + DAUER_MIN, Math.min(seit, jetzt) + dauerFuer(ziel - y, window.innerHeight) - RESERVE);
    fahrt = { von: y, nach: ziel, richtung: r, start: jetzt, ende, bild: 0, letzt: 0 };
    html.classList.add('gleitet');
    beimWechsel(true);
    fahrt.bild = requestAnimationFrame(schritt);
    return true;
  }

  // Eine Absicht in Richtung r. Liefert true, wenn das Ereignis nicht normal scrollen soll.
  function absicht(r, seit = performance.now()) {
    if (gesperrt()) return false;
    if (!bereit) {
      // Erste Eingabe am Seitenanfang: Bühne starten, dann fahren. Bis dahin steht die Seite.
      if (wartet) return true;
      wartet = r;
      vorbereiten().then(
        () => {
          bereit = true;
          const richtung = wartet;
          wartet = 0;
          if (gesperrt() || !fahre(richtung, seit)) window.scrollBy({ top: richtung * window.innerHeight * 0.15, behavior: 'instant' });
        },
        () => {
          aus = true;
          wartet = 0;
        },
      );
      return true;
    }
    return fahre(r, seit);
  }

  function rad(e) {
    if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (gesperrt() || imFeld(document.activeElement, FORMULAR)) return;
    const r = Math.sign(e.deltaY);
    if (fahrt) {
      if (r === fahrt.richtung) e.preventDefault();
      else abbrechen();
      return;
    }
    const jetzt = performance.now();
    if (r === sperre.richtung && jetzt < sperre.bis) {
      e.preventDefault();
      sperre.bis = jetzt + NACHLAUF;
      return;
    }
    if (absicht(r, eingabeZeit(e))) e.preventDefault();
  }

  function taste(e) {
    if (fahrt) abbrechen();
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const r = tastenRichtung(e);
    if (!r || imFeld(e.target, BEDIENELEMENT) || imFeld(document.activeElement, BEDIENELEMENT)) return;
    if (absicht(r, eingabeZeit(e))) e.preventDefault();
  }

  function beruehrung(e) {
    abbrechen();
    finger = e.touches.length === 1 ? { y: e.touches[0].clientY, seit: eingabeZeit(e), entscheid: null } : null;
  }

  function wisch(e) {
    if (!finger || e.touches.length !== 1) return;
    if (finger.entscheid === 'normal') return;
    if (finger.entscheid === 'gleiten') {
      if (e.cancelable) e.preventDefault();
      return;
    }
    const weg = finger.y - e.touches[0].clientY; // positiv: Finger nach oben, Seite nach unten
    if (weg === 0) return;
    const r = Math.sign(weg);
    if (gesperrt() || imFeld(document.activeElement, FORMULAR) || (bereit && zielHalt(window.scrollY, halte(), r, haltToleranz(window.innerHeight)) === null)) {
      finger.entscheid = 'normal';
      return;
    }
    if (e.cancelable) e.preventDefault();
    if (Math.abs(weg) < WISCH) return;
    finger.entscheid = 'gleiten';
    // Vor dem ersten Start beginnt die Arbeit der Bühne schon beim Aufsetzen des Fingers (seite.mjs): Frist ab dort.
    // Danach zählt der Wisch selbst, ein ruhender Finger verkürzt die Fahrt nicht.
    absicht(r, bereit ? eingabeZeit(e) : finger.seit);
  }

  const ende = () => {
    finger = null;
  };

  window.addEventListener('wheel', rad, { passive: false });
  window.addEventListener('keydown', taste);
  window.addEventListener('touchstart', beruehrung, { passive: true });
  window.addEventListener('touchmove', wisch, { passive: false });
  window.addEventListener('touchend', ende, { passive: true });
  window.addEventListener('touchcancel', ende, { passive: true });
  window.addEventListener('mousedown', abbrechen, { passive: true });

  return {
    laeuft: () => !!fahrt,
    stoppe() {
      abbrechen();
      aus = true;
      window.removeEventListener('wheel', rad);
      window.removeEventListener('keydown', taste);
      window.removeEventListener('touchstart', beruehrung);
      window.removeEventListener('touchmove', wisch);
      window.removeEventListener('touchend', ende);
      window.removeEventListener('touchcancel', ende);
      window.removeEventListener('mousedown', abbrechen);
    },
  };
}
