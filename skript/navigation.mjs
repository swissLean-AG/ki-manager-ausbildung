// Gebäudeplan: zeigt die aktive Station (aria-current="location") und lässt besuchte Stockwerke leuchten.
// Die Links selbst funktionieren ohne JavaScript (Sprung zur Station).
//
// Ohne erzwungenes Layout: Ein IntersectionObserver meldet, welcher Abschnitt die waagrechte Linie in der
// Bildschirmmitte schneidet. Beobachtet werden alle Abschnitte der Seite in Dokumentreihenfolge (die Stationen statt
// ihres Behälters), sie liegen lückenlos untereinander. So schneidet immer genau einer die Linie, und auch ein Sprung
// über mehrere Stationen erzeugt eine Meldung (der alte Abschnitt verlässt die Linie, der neue erreicht sie).
// Aktiv ist die Station auf der Linie; besucht sind alle Stationen davor, unter der Fahrt alle.
// Browser ohne IntersectionObserver: Messung beim Scrollen wie bisher, aber erst nach der ersten Bewegung.
import { beiBewegung } from './fortschritt.mjs';

function setze(links, neu, besuchtBis) {
  links.forEach((a, i) => {
    if (i === neu) a.setAttribute('aria-current', 'location');
    else a.removeAttribute('aria-current');
    a.classList.toggle('aktiv', i === neu);
    a.classList.toggle('besucht', i < besuchtBis);
  });
}

export function starteNavigation(nav) {
  if (!nav) return { stoppe() {} };
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const ziele = links.map((a) => document.getElementById(a.getAttribute('href').slice(1)));
  let stand = '';
  const zeige = (neu, besuchtBis) => {
    const s = `${neu}|${besuchtBis}`;
    if (s === stand) return;
    stand = s;
    setze(links, neu, besuchtBis);
  };

  const behaelter = ziele.find(Boolean)?.parentElement;
  const haupt = document.getElementById('inhalt');
  if (!('IntersectionObserver' in window) || !behaelter || !haupt) {
    const pruefe = () => {
      const mitte = window.innerHeight * 0.5;
      let neu = -1;
      let zuletzt = -1;
      ziele.forEach((s, i) => {
        if (!s) return;
        const r = s.getBoundingClientRect();
        if (r.top <= mitte) zuletzt = i;
        if (r.top <= mitte && r.bottom > mitte) neu = i;
      });
      zeige(neu, neu >= 0 ? neu : zuletzt + 1);
    };
    const plan = beiBewegung(pruefe);
    return { stoppe: plan.stoppe };
  }

  // Abschnitte in Dokumentreihenfolge: vor dem Behälter der Stationen, die Stationen, danach. Nur Elemente mit Box
  // (keine <link> oder <script>), jedes mit seiner Stelle in der Reihe.
  const ohneBox = (el) => el.tagName === 'LINK' || el.tagName === 'SCRIPT';
  const reihe = [];
  for (const kind of haupt.children) {
    if (kind === behaelter) {
      for (const s of behaelter.children) if (!ohneBox(s)) reihe.push(s);
    } else if (!ohneBox(kind)) reihe.push(kind);
  }
  const stelle = new Map(reihe.map((el, i) => [el, i]));
  const stationAn = ziele.map((z) => (z ? stelle.get(z) ?? -1 : -1));
  const vorhanden = stationAn.filter((i) => i >= 0);
  const erste = Math.min(...vorhanden);
  const letzte = Math.max(...vorhanden);
  const aufLinie = new Set();

  const beobachter = new IntersectionObserver(
    (eintraege) => {
      for (const e of eintraege) {
        if (e.isIntersecting) aufLinie.add(stelle.get(e.target));
        else aufLinie.delete(stelle.get(e.target));
      }
      if (!aufLinie.size) return; // Linie in einer Lücke zwischen zwei Abschnitten: Stand bleibt
      // An einer Grenze berühren zwei Abschnitte die Linie: es gilt der untere (seine Oberkante liegt auf der Linie).
      const hier = Math.max(...aufLinie);
      const neu = stationAn.indexOf(hier);
      if (neu >= 0) zeige(neu, neu);
      else if (hier < erste) zeige(-1, 0);
      else if (hier > letzte) zeige(-1, links.length);
      else zeige(-1, vorhanden.filter((i) => i < hier).length);
    },
    { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
  );
  for (const el of reihe) beobachter.observe(el);
  return { stoppe: () => beobachter.disconnect() };
}
