// Menü: Ohne dieses Skript funktioniert es über details und summary vollständig. Das Skript schliesst nur:
// Escape schliesst das innerste offene Menü und setzt den Fokus auf seinen Knopf zurück, ein Klick daneben und ein
// Fokus ausserhalb des Menüs schliessen alles, damit das offene Menü nie etwas Fokussiertes verdeckt.
// Öffnet sich ein Untermenü, schliessen die anderen.

const nav = document.querySelector('.menue');

if (nav) {
  document.documentElement.classList.add('menue-js');
  const offene = () => [...nav.querySelectorAll('details[open]')];
  const schliesseAlle = () => {
    for (const d of offene()) d.open = false;
  };

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const liste = offene();
    if (!liste.length) return;
    const innerstes = liste[liste.length - 1];
    const fokusImMenue = nav.contains(document.activeElement);
    innerstes.open = false;
    if (fokusImMenue) innerstes.querySelector(':scope > summary')?.focus();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!nav.contains(e.target)) schliesseAlle();
  });

  nav.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !nav.contains(e.relatedTarget)) schliesseAlle();
  });

  for (const d of nav.querySelectorAll('.menue-unter')) {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      for (const andere of nav.querySelectorAll('.menue-unter[open]')) if (andere !== d) andere.open = false;
    });
  }
}
