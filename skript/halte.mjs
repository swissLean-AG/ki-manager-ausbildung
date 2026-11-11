// Halte: An jeder Station der Fahrt steht ein Block mit Überschrift, Punkten, Kennzahl und Quelle (statisches HTML).
// Mit diesem Skript (html.halte-an) liegen die Blöcke fest über dem Bild und erscheinen nur am Halt, also dort, wo
// die Kopfkarte der Station in der Bildschirmmitte steht. Während einer Gleitfahrt und zwischen den Halten ist das
// Bild frei. Ohne Skript und bei reduzierter Bewegung stehen die Blöcke als Karten im Fluss der Seite.
// Die Lage der Halte kommt aus derselben Rechnung wie die Bühne (fahrtAnker in buehne.mjs).
// Prüfpunkt: Klasse "an" am sichtbaren Block.
import { beiBewegung } from './fortschritt.mjs';

const DAUER = 900;

// Kennzahl beim Erscheinen von null auf den Endwert zählen.
function zaehle(halt) {
  for (const z of halt.querySelectorAll('.kennzahl-wert .zahl')) {
    const ziel = z.dataset.ziel ?? z.textContent;
    z.dataset.ziel = ziel;
    const wert = Number(ziel);
    const start = performance.now();
    z.dataset.laeuft = String(start);
    z.textContent = '0';
    const schritt = (jetzt) => {
      if (z.dataset.laeuft !== String(start)) return;
      const t = Math.min(1, (jetzt - start) / DAUER);
      z.textContent = t >= 1 ? ziel : String(Math.round(wert * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
  }
}

// Grosse Systemschrift: Der Halt steht unten fest über dem Bild, darüber der Gebäudeplan. Wächst der Text über diesen
// Platz hinaus, ragte er oben aus dem Bild. Dann wird die Schrift dieses Halts (--halt-skala in halte.css) kleiner, bis
// der ganze Text zwischen Plan und Buchen-Leiste steht, mit etwas Luft im oberen Verlauf. Bei normaler Schrift passt
// alles und die Stufe bleibt 1. Die Höhe des Textes wächst etwa mit dem Quadrat der Schrift, daher die Wurzel.
export const SKALA_MIN = 0.5;

export function naechsteSkala(skala, bedarf, grenze, ziel) {
  if (bedarf <= (skala < 1 ? ziel : grenze)) return skala;
  return Math.max(SKALA_MIN, Math.floor(skala * Math.sqrt(Math.max(ziel, 1) / bedarf) * 0.98 * 1000) / 1000);
}

function platzBedarf(halt) {
  const cs = getComputedStyle(halt);
  const max = parseFloat(cs.maxHeight);
  const grenze = (Number.isFinite(max) ? max : window.innerHeight) - parseFloat(cs.paddingBottom);
  const ziel = grenze - parseFloat(cs.paddingTop) / 2;
  let oben = Infinity;
  let unten = -Infinity;
  for (const kind of halt.children) {
    if (kind.offsetHeight <= 1) continue; // ruhende Textfassung für Screenreader
    oben = Math.min(oben, kind.offsetTop);
    unten = Math.max(unten, kind.offsetTop + kind.offsetHeight);
  }
  return { bedarf: unten - oben, grenze, ziel };
}

export function passeHalteAn(bloecke) {
  for (const b of bloecke) b.style.removeProperty('--halt-skala');
  const skala = new Map(bloecke.map((b) => [b, 1]));
  let offen = bloecke;
  // Erst alle messen, dann alle setzen: ein Layout je Runde. Wenige Runden genügen, weil die Wurzel vorsichtig schätzt.
  for (let runde = 0; runde < 6 && offen.length; runde++) {
    const messungen = offen.map((b) => [b, platzBedarf(b)]);
    offen = [];
    for (const [b, { bedarf, grenze, ziel }] of messungen) {
      const alt = skala.get(b);
      const neu = naechsteSkala(alt, bedarf, grenze, ziel);
      if (neu >= alt) continue;
      skala.set(b, neu);
      b.style.setProperty('--halt-skala', String(neu));
      if (neu > SKALA_MIN) offen.push(b);
    }
  }
  return skala;
}

// anker(): Scrolllagen [Start, Station 1 bis 7, Ende der Fahrt]; gleitet(): true während einer Gleitfahrt.
export function starteHalte({ anker, gleitet = () => false }) {
  const html = document.documentElement;
  const bloecke = [...document.querySelectorAll('.station')].map((s) => s.querySelector('.halt[data-halt]'));
  if (bloecke.some((b) => !b)) return { pruefe() {}, stoppe() {} };
  let aktiv = -1;

  function pruefe() {
    let neu = -1;
    if (!gleitet()) {
      const a = anker();
      const y = window.scrollY;
      const tol = Math.max(40, window.innerHeight * 0.12);
      bloecke.forEach((_, i) => {
        if (Math.abs(y - a[i + 1]) <= tol) neu = i;
      });
    }
    if (neu === aktiv) return;
    if (aktiv >= 0) bloecke[aktiv].classList.remove('an');
    aktiv = neu;
    if (neu >= 0) {
      bloecke[neu].classList.add('an');
      zaehle(bloecke[neu]);
    }
  }

  // Screenreader lesen die Kennzahl aus einer ruhenden Textfassung mit dem Endwert; die hochzählende Zahl ist
  // für sie verborgen. Der Text steht schon im HTML, hier wird er nur für den Baum verdoppelt.
  const textfassungen = [];
  for (const wert of document.querySelectorAll('.halt .kennzahl-wert')) {
    const text = document.createElement('p');
    text.className = 'nur-vorlesen';
    text.textContent = wert.textContent.replace(/\s+/g, ' ').trim();
    wert.after(text);
    wert.setAttribute('aria-hidden', 'true');
    textfassungen.push([wert, text]);
  }

  html.classList.add('halte-an');
  pruefe();
  const plan = beiBewegung(pruefe);

  // Schriftstufe im nächsten Bild (dort steht das Layout ohnehin an), wieder nach dem Laden der Schriften und nach
  // jeder Grössenänderung. Ein sichtbarer Halt blendet erst ein, die Anpassung fällt in den Beginn der Blende.
  let bild = 0;
  let warte = 0;
  const anpassen = () => {
    cancelAnimationFrame(bild);
    bild = requestAnimationFrame(() => passeHalteAn(bloecke));
  };
  const beiGroesse = () => {
    clearTimeout(warte);
    warte = setTimeout(anpassen, 150);
  };
  anpassen();
  document.fonts?.ready.then(anpassen);
  window.addEventListener('resize', beiGroesse, { passive: true });

  return {
    pruefe,
    stoppe() {
      plan.stoppe();
      cancelAnimationFrame(bild);
      clearTimeout(warte);
      window.removeEventListener('resize', beiGroesse);
      html.classList.remove('halte-an');
      for (const b of bloecke) {
        b.classList.remove('an');
        b.style.removeProperty('--halt-skala');
      }
      for (const [wert, text] of textfassungen) {
        text.remove();
        wert.removeAttribute('aria-hidden');
      }
    },
  };
}
