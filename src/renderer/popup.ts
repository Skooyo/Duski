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

document.getElementById('copy')!.addEventListener('click', () => window.duski.send('popup:copy', textEl.textContent ?? ''));
document.getElementById('close')!.addEventListener('click', () => window.duski.send('popup:close'));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.duski.send('popup:close');
});
