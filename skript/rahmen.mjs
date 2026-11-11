// Schutz gegen Einbetten in fremde Seiten: Läuft die Seite in einem Rahmen, wird der Inhalt ausgeblendet und nur ein
// Link angeboten, der die Seite direkt öffnet. Ohne JavaScript bleibt die Seite unverändert. Stile nur über CSSOM,
// das erlaubt die Content-Security-Policy ohne Hash.

function eingebettet() {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function verberge(el) {
  if (el.nodeType === 1 && !el.hasAttribute('data-rahmen')) el.style.setProperty('display', 'none', 'important');
}

function zeigeHinweis() {
  const kasten = document.createElement('p');
  kasten.setAttribute('data-rahmen', '');
  for (const [k, v] of [['margin', '2rem'], ['padding', '1.5rem'], ['font-size', '1.125rem'], ['line-height', '1.5'], ['color', '#ffffff'], ['background', '#111111']]) {
    kasten.style.setProperty(k, v);
  }
  kasten.append('Diese Seite wird in einer fremden Seite angezeigt. ');
  const link = document.createElement('a');
  link.setAttribute('data-rahmen-hinweis', '');
  link.href = window.location.href;
  link.target = '_top';
  link.rel = 'noopener';
  link.textContent = 'Seite direkt öffnen';
  link.style.setProperty('color', '#ff7a45');
  kasten.append(link);
  document.body.prepend(kasten);
}

if (eingebettet()) {
  for (const el of document.body.children) verberge(el);
  // Was andere Skripte später einfügen, bleibt ebenfalls verborgen.
  new MutationObserver((liste) => {
    for (const m of liste) for (const el of m.addedNodes) verberge(el);
  }).observe(document.body, { childList: true });
  zeigeHinweis();
}
