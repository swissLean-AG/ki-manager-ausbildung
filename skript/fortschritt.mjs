// Gemeinsamer Scrollfortschritt für Bildspur und Einblendungen. Beide Ebenen hängen nur an dieser Zahl,
// nie aneinander: Die Bildspur wählt daraus ein Bild, die Einblendungen ihr Fenster von/bis.
//
// Station: 0 = der Abschnitt erreicht den oberen Rand, die vorherige Station ist ganz aus dem Bild;
// 1 = die Textkarten der Station treten unten ins Bild. Dazwischen liegt die freie Fahrstrecke
// (padding-top = CSS-Variable --strecke, abzüglich einer Bildhöhe). Werte ausserhalb 0 bis 1 werden nicht gekappt.
// Start: 0 = Seite ganz oben, 1 = der Startabschnitt ist ganz aus dem Bild gescrollt.

export const klemme = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export function stationsFortschritt(abschnitt, strecke) {
  const hoehe = window.innerHeight;
  const weg = Math.max((strecke || parseFloat(getComputedStyle(abschnitt).paddingTop) || hoehe) - hoehe, hoehe * 0.5);
  return -abschnitt.getBoundingClientRect().top / weg;
}

export function startFortschritt(abschnitt) {
  const unten = abschnitt.getBoundingClientRect().bottom + window.scrollY;
  return unten > 0 ? window.scrollY / unten : 0;
}

// Ruft fn höchstens einmal je Bild auf, ausgelöst durch Scrollen (passiv) und Grössenänderung.
export function beiBewegung(fn) {
  let geplant = false;
  const plane = () => {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => {
      geplant = false;
      fn();
    });
  };
  window.addEventListener('scroll', plane, { passive: true });
  window.addEventListener('resize', plane, { passive: true });
  return {
    plane,
    stoppe() {
      window.removeEventListener('scroll', plane);
      window.removeEventListener('resize', plane);
    },
  };
}
