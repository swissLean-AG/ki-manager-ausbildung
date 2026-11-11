// Leistungen: ruhige Einblendungen beim Scrollen und der Objekt-Auftritt für Browser ohne Scroll-Zeitleiste.
// Alles ist Zusatz: Ohne dieses Skript und bei reduzierter Bewegung steht jeder Text sofort und vollständig da,
// das Objekt in seiner Endlage. Verändert werden nur Deckkraft und Verschiebung, nie das Layout.

const reduziert = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Einblenden: nur Elemente, die beim Laden unterhalb des Bildschirms liegen. Was schon zu sehen ist, bleibt stehen.
function starteEinblendungen() {
  if (reduziert || !('IntersectionObserver' in window)) return;
  const unten = [...document.querySelectorAll('.einblenden')].filter((el) => el.getBoundingClientRect().top > window.innerHeight);
  if (!unten.length) return;
  const beobachter = new IntersectionObserver(
    (eintraege) => {
      for (const e of eintraege) {
        if (!e.isIntersecting) continue;
        e.target.classList.remove('wartet');
        beobachter.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  for (const el of unten) {
    el.classList.add('wartet');
    beobachter.observe(el);
  }
  // Fokus per Tastatur oder Suche im Text: sofort zeigen, nie etwas Unsichtbares fokussieren.
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('.einblenden.wartet');
    if (el) el.classList.remove('wartet');
  });
}

// Objekt-Auftritt ohne Scroll-Zeitleiste: Fortschritt 0 bis 1 über dieselbe Strecke wie im Stil (ab halb im Bild bis
// drei Viertel der angepinnten Strecke), weich nachgeführt.
function starteAuftritt() {
  const auftritt = document.querySelector('.auftritt');
  if (!auftritt || reduziert || CSS.supports('animation-timeline: view()')) return;
  let ist = 0;
  let laeuft = false;
  const ziel = () => {
    const r = auftritt.getBoundingClientRect();
    const h = window.innerHeight;
    const start = r.top - h * 0.5; // Abschnitt halb im Bild
    const strecke = h * 0.5 + (r.height - h) * 0.75;
    return Math.min(1, Math.max(0, -start / strecke));
  };
  const schritt = () => {
    const z = ziel();
    ist += (z - ist) * 0.18;
    if (Math.abs(z - ist) < 0.001) ist = z;
    const e = ist < 0.5 ? 2 * ist * ist : 1 - (-2 * ist + 2) ** 2 / 2;
    auftritt.style.setProperty('--auftritt', e.toFixed(4));
    if (ist !== z) requestAnimationFrame(schritt);
    else laeuft = false;
  };
  const plane = () => {
    if (laeuft) return;
    laeuft = true;
    requestAnimationFrame(schritt);
  };
  ist = ziel();
  plane();
  window.addEventListener('scroll', plane, { passive: true });
  window.addEventListener('resize', plane, { passive: true });
}

// Erst wenn die Schriften stehen: Vorher verschiebt der Schriftwechsel die Zeilen, und ein Element knapp unter dem
// Bildschirm würde direkt nach dem Laden einblenden.
const nachSchriften = (fn) => (document.fonts?.ready ? document.fonts.ready.then(() => requestAnimationFrame(fn)) : fn());
nachSchriften(starteEinblendungen);
starteAuftritt();
