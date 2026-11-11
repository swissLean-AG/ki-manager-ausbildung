// Einblendungen: eigene HTML-Ebene vor der Bildspur. Der Inhalt steht als statisches HTML in der Seite.
// Dieses Skript schaltet nur sichtbar und unsichtbar: Eine Einblendung ist "an", solange der Scrollfortschritt
// ihres Abschnitts zwischen data-von und data-bis liegt. Kein Bezug zu einem Einzelbild der Fahrt.
// Ein- und Ausblenden über opacity, transform und visibility (buehne.css).
// Schmale Bildschirme: Die sichtbaren Einblendungen stapeln sich vom unteren Rand nach oben. Die Höhe darunter
// steht als --stapel an jeder Karte und wirkt über translate, so verschiebt sich keine Karte im Layout.
// Zähler laufen beim Erscheinen hoch; bei reduzierter Bewegung stehen sie sofort mit dem Endwert da.
// Prüfpunkt: data-fortschritt am Block jeder Station.
import { stationsFortschritt, startFortschritt, beiBewegung } from './fortschritt.mjs';

const DAUER = 1100;

function zaehle(el, reduziert) {
  for (const z of el.querySelectorAll('.zahl')) {
    const ziel = z.dataset.ziel ?? z.textContent;
    z.dataset.ziel = ziel;
    if (reduziert) {
      z.textContent = ziel;
      continue;
    }
    const wert = Number(ziel);
    const stellen = (ziel.split('.')[1] || '').length;
    const start = performance.now();
    const schritt = (jetzt) => {
      const t = Math.min(1, (jetzt - start) / DAUER);
      const e = 1 - (1 - t) ** 3;
      z.textContent = t >= 1 ? ziel : (wert * e).toFixed(stellen);
      if (t < 1 && z.dataset.laeuft === String(start)) requestAnimationFrame(schritt);
    };
    z.dataset.laeuft = String(start);
    z.textContent = (0).toFixed(stellen);
    requestAnimationFrame(schritt);
  }
}

// Stapel der sichtbaren Karten einer Gruppe: die letzte im Dokument unten, darüber die vorherigen.
// Nur wenn die Karten absolut liegen (schmale Bildschirme); im Raster der breiten Bildschirme nichts zu tun.
function staple(g) {
  if (g.start || !g.elemente.length || getComputedStyle(g.elemente[0]).position !== 'absolute') return;
  const abstand = parseFloat(getComputedStyle(g.block).rowGap) || 8;
  let unten = 0;
  for (let i = g.elemente.length - 1; i >= 0; i--) {
    const el = g.elemente[i];
    if (!el.einblendung.an) continue;
    const wert = `${Math.round(unten)}px`;
    if (el.style.getPropertyValue('--stapel') !== wert) el.style.setProperty('--stapel', wert);
    unten += el.offsetHeight + abstand;
  }
}

export function starteEinblendungen(wurzel = document, { reduziert = false } = {}) {
  const gruppen = [];
  const start = wurzel.getElementById ? wurzel.getElementById('start') : document.getElementById('start');
  if (start) gruppen.push({ abschnitt: start, block: start, elemente: [...start.querySelectorAll('.einblendung')], start: true });
  const textfassungen = [];
  for (const block of wurzel.querySelectorAll('.einblendungen[data-einblendungen]')) {
    const abschnitt = block.closest('section');
    if (!abschnitt) continue;
    // Barrierefreiheit: Die schwebende Ebene blendet nach Scrollfortschritt ein und aus und lässt Zähler laufen.
    // Für Screenreader steht daneben eine ruhende Textfassung mit den Endwerten, die Ebene ist verborgen.
    // Geklont wird vor dem ersten pruefe(), also bevor ein Zähler läuft.
    const text = block.cloneNode(true);
    text.className = 'einblendungen-text';
    text.removeAttribute('data-einblendungen');
    text.removeAttribute('aria-hidden');
    for (const el of text.querySelectorAll('[id]')) el.removeAttribute('id');
    for (const el of text.querySelectorAll('.an')) el.classList.remove('an');
    block.after(text);
    block.setAttribute('aria-hidden', 'true');
    textfassungen.push({ block, text });
    gruppen.push({ abschnitt, block, elemente: [...block.querySelectorAll('.einblendung')], start: false });
  }
  for (const g of gruppen) {
    for (const el of g.elemente) {
      el.einblendung = { von: Number(el.dataset.von), bis: Number(el.dataset.bis), an: null };
    }
  }

  let breite = window.innerWidth;
  let hoehe = window.innerHeight;
  function pruefe() {
    const groesseNeu = window.innerWidth !== breite || window.innerHeight !== hoehe;
    breite = window.innerWidth;
    hoehe = window.innerHeight;
    for (const g of gruppen) {
      const p = g.start ? startFortschritt(g.abschnitt) : stationsFortschritt(g.abschnitt);
      g.block.dataset.fortschritt = p.toFixed(3);
      const neu = [];
      let wechsel = groesseNeu;
      for (const el of g.elemente) {
        const e = el.einblendung;
        const an = p >= e.von && p < e.bis;
        if (an === e.an) continue;
        e.an = an;
        wechsel = true;
        if (an) neu.push(el);
        else el.classList.remove('an');
      }
      if (!wechsel) continue;
      // Erst die Lage im Stapel setzen, solange neue Karten noch unsichtbar sind (ohne Übergang),
      // dann einblenden. Bereits sichtbare Karten gleiten weich an ihren neuen Platz.
      staple(g);
      if (neu.length && neu[0].isConnected) getComputedStyle(neu[0]).translate;
      for (const el of neu) {
        el.classList.add('an');
        if (el.classList.contains('statistik')) zaehle(el, reduziert);
      }
    }
  }

  // Erst den Zustand setzen, dann die Darstellung umschalten: so blitzt nichts auf und nichts blendet unnötig ein.
  pruefe();
  document.documentElement.classList.add('einblendungen-an');
  // Mit der neuen Darstellung liegen die Karten erst jetzt absolut: Stapel einmal nachrechnen, ohne dass bereits
  // sichtbare Karten an ihren Platz gleiten.
  const sichtbar = gruppen.flatMap((g) => (g.start ? [] : g.elemente.filter((el) => el.einblendung.an)));
  for (const el of sichtbar) el.style.transition = 'none';
  for (const g of gruppen) staple(g);
  for (const el of sichtbar) getComputedStyle(el).translate;
  for (const el of sichtbar) el.style.removeProperty('transition');
  const plan = beiBewegung(pruefe);
  return {
    stoppe() {
      plan.stoppe();
      document.documentElement.classList.remove('einblendungen-an');
      for (const g of gruppen) {
        for (const el of g.elemente) {
          el.classList.remove('an');
          el.style.removeProperty('--stapel');
        }
      }
      for (const { block, text } of textfassungen) {
        text.remove();
        block.removeAttribute('aria-hidden');
      }
    },
  };
}
