// Finale: Die Fahrt chefetage-finale läuft als Bildsequenz, während der Gesprächsabschnitt ins Bild scrollt.
// Ohne JavaScript (und bei reduzierter Bewegung) bleibt das Poster stehen: das ganze Gelände leuchtet.
// Die Zeichenfläche liegt über dem Poster und ist durchsichtig, solange kein Fahrtbild bereit ist.
// Prüfpunkte: data-geladen ("ja", sobald alle Bilder decodiert sind), data-index.
import { klemme, beiBewegung } from './fortschritt.mjs';
import { ladeReihenfolge, zeichneDeckend, FINALE_VORLAUF } from './buehne.mjs';

export function starteFinale(canvas, bilder) {
  const abschnitt = canvas.closest('section');
  const urls = (bilder || []).slice(0, 90);
  if (!abschnitt || urls.length === 0) return { stoppe() {} };
  const ctx = canvas.getContext('2d');
  const geladen = new Array(urls.length).fill(null);
  let gestoppt = false;
  let gestartet = false;
  let letzter = '';

  function miss() {
    const f = Math.min(window.devicePixelRatio || 1, 2);
    const b = Math.round(canvas.clientWidth * f);
    const h = Math.round(canvas.clientHeight * f);
    if (canvas.width !== b || canvas.height !== h) {
      canvas.width = b;
      canvas.height = h;
      letzter = '';
    }
  }

  function zeichne() {
    if (gestoppt) return;
    miss();
    const p = klemme((window.innerHeight - abschnitt.getBoundingClientRect().top) / window.innerHeight);
    let index = -1;
    // Die Bühne fährt die ersten FINALE_VORLAUF der Finalfahrt schon nach der Chefetage; hier geht es dort weiter.
    const ziel = Math.round((FINALE_VORLAUF + (1 - FINALE_VORLAUF) * p) * (urls.length - 1));
    for (let d = 0; d < urls.length && index < 0; d++) {
      if (geladen[ziel - d]) index = ziel - d;
      else if (geladen[ziel + d]) index = ziel + d;
    }
    const zustand = `${index}|${canvas.width}|${p >= 1}`;
    if (zustand === letzter) return;
    letzter = zustand;
    if (index < 0 || p >= 1) {
      // Am Ziel oder ohne Bild: Poster zeigen (Zeichenfläche leer).
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      zeichneDeckend(ctx, geladen[index]);
    }
    canvas.dataset.index = String(index);
  }

  function lade() {
    if (gestartet) return;
    gestartet = true;
    const folge = ladeReihenfolge(urls.length);
    let offen = 0;
    let n = 0;
    let fertig = 0;
    const weiter = () => {
      while (!gestoppt && offen < 4 && n < folge.length) {
        const i = folge[n++];
        offen++;
        const img = new Image();
        img.decoding = 'async';
        img.src = urls[i];
        img.decode().then(() => {
          geladen[i] = img;
          letzter = '';
          plan.plane();
        }, () => {}).finally(() => {
          offen--;
          fertig++;
          if (fertig === folge.length) canvas.dataset.geladen = 'ja';
          weiter();
        });
      }
    };
    weiter();
  }

  // Erst laden, wenn der Abschnitt näher als eine Bildschirmhöhe ist.
  const beobachter = new IntersectionObserver((e) => {
    if (e.some((x) => x.isIntersecting)) {
      lade();
      beobachter.disconnect();
    }
  }, { rootMargin: '100% 0px 100% 0px' });
  beobachter.observe(abschnitt);
  const plan = beiBewegung(zeichne);
  canvas.dataset.geladen = 'nein';
  zeichne();

  return {
    stoppe() {
      gestoppt = true;
      beobachter.disconnect();
      plan.stoppe();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
