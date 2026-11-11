// Video-Stimmen: Standbild mit Play-Knopf. Erst der Klick (oder Enter) setzt ein <video> ein und lädt die Datei.
// Ohne dieses Skript bleibt das Standbild mit dem Link "Video ansehen" zur vollen Fassung auf Vimeo stehen.
// Vor dem Klick gibt es im HTML weder <video> noch <source> noch eine Anfrage an MP4 oder VTT.

function stoppeAndere(aktuelles) {
  for (const v of document.querySelectorAll('.stimme-video video')) {
    if (v !== aktuelles && !v.paused) v.pause();
  }
}

function starten(box, bild, poster) {
  const video = document.createElement('video');
  video.controls = true;
  video.setAttribute('playsinline', '');
  video.preload = 'none';
  video.poster = poster.currentSrc || poster.src;
  video.setAttribute('aria-label', box.dataset.titel || 'Video');
  const breite = poster.getAttribute('width');
  const hoehe = poster.getAttribute('height');
  if (breite && hoehe) {
    video.setAttribute('width', breite);
    video.setAttribute('height', hoehe);
  }
  const spur = document.createElement('track');
  spur.kind = 'captions';
  spur.srclang = 'de';
  spur.label = 'Deutsch';
  spur.default = true;
  spur.src = box.dataset.vtt;
  video.append(spur);
  video.addEventListener('play', () => stoppeAndere(video));
  video.src = box.dataset.mp4;
  bild.replaceChildren(video);
  video.focus();
  const start = video.play();
  if (start && typeof start.catch === 'function') start.catch(() => {});
}

function aufbauen(box) {
  const bild = box.querySelector('.stimme-bild');
  const poster = box.querySelector('.stimme-poster');
  if (!bild || !poster || !box.dataset.mp4) return;
  const knopf = document.createElement('button');
  knopf.type = 'button';
  knopf.className = 'stimme-play';
  knopf.setAttribute('aria-label', `Video abspielen: ${box.dataset.titel || 'Teilnehmerstimme'}`);
  knopf.addEventListener('click', () => starten(box, bild, poster), { once: true });
  bild.append(knopf);
}

for (const box of document.querySelectorAll('.stimme-video')) aufbauen(box);
