type Status = 'loading' | 'streaming' | 'done' | 'error';

const card = document.getElementById('card') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const textEl = document.getElementById('text') as HTMLDivElement;

const LABELS: Record<Status, string> = { loading: 'Translating…', streaming: 'Translating…', done: 'English', error: 'Error' };

window.duski.on('popup:update', ({ status, text }: { status: Status; text: string }) => {
  document.body.dataset.status = status;
  statusEl.textContent = LABELS[status];
  textEl.textContent = text;
  window.duski.send('popup:resize', card.offsetHeight + 2); // +2 for the body border
});

// Translate area only: hides the painted translation so the original shows, without closing the popup.
const overlayBtn = document.getElementById('overlay') as HTMLButtonElement;
window.duski.on('popup:overlay-available', () => {
  overlayBtn.hidden = false;
  window.duski.send('popup:resize', card.offsetHeight + 2);
});
const toggleOverlay = () => {
  const on = overlayBtn.getAttribute('aria-pressed') !== 'true';
  overlayBtn.setAttribute('aria-pressed', String(on));
  window.duski.send('popup:overlay', on);
};
overlayBtn.addEventListener('click', toggleOverlay);

document.getElementById('copy')!.addEventListener('click', () => window.duski.send('popup:copy', textEl.textContent ?? ''));
document.getElementById('close')!.addEventListener('click', () => window.duski.send('popup:close'));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.duski.send('popup:close');
  else if (e.key.toLowerCase() === 'o' && !overlayBtn.hidden && !e.ctrlKey && !e.altKey && !e.metaKey) toggleOverlay();
});
