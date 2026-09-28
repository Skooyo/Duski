import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AskEvent, AskInit } from '../shared/ask-events';

const context = document.getElementById('context') as HTMLDivElement;
const presets = document.getElementById('presets') as HTMLDivElement;
const form = document.getElementById('ask') as HTMLFormElement;
const q = document.getElementById('q') as HTMLInputElement;
const go = document.getElementById('go') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLSpanElement;
const answer = document.getElementById('answer') as HTMLDivElement;
const actions = document.getElementById('actions') as HTMLDivElement;
const cont = document.getElementById('continue') as HTMLButtonElement;
const card = document.getElementById('card') as HTMLDivElement;

let raw = '';
let busy = false;
let queued = false;

window.duski.on('ask:init', (d: AskInit) => {
  if (d.kind === 'text') {
    context.className = 'text';
    context.textContent = d.text;
  } else {
    const img = Object.assign(document.createElement('img'), { src: d.image, alt: 'The screen area you selected' });
    img.addEventListener('load', resize);
    context.replaceChildren(img);
  }
  presets.replaceChildren(
    ...d.presets.map(([label, instruction]) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
      b.addEventListener('click', () => ask(label, instruction));
      return b;
    }),
  );
  q.focus();
  resize();
});

window.duski.on('ask:event', (e: AskEvent) => {
  if (e.kind === 'status') setStatus(e.text);
  else if (e.kind === 'error') setStatus(e.text, true);
  else if (e.kind === 'text') {
    if (!status.classList.contains('error')) setStatus('Writing…');
    raw += e.text;
    if (!queued) requestAnimationFrame(renderAnswer);
    queued = true;
  } else {
    setBusy(false);
    if (!status.classList.contains('error')) setStatus('');
    actions.hidden = false;
    cont.disabled = !e.canContinue;
    resize();
  }
});
window.duski.send('ask:ready');

// The submit button makes Enter work; while busy it is the Stop button.
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (busy) return window.duski.send('ask:stop');
  const text = q.value.trim();
  if (!text) return q.focus();
  ask(text, text);
});
document.getElementById('copy')!.addEventListener('click', () => window.duski.send('popup:copy', raw.trim()));
cont.addEventListener('click', () => window.duski.send('ask:continue'));
document.getElementById('min')!.addEventListener('click', () => window.duski.send('ask:hide'));
document.getElementById('close')!.addEventListener('click', () => window.duski.send('ask:close'));
addEventListener('keydown', (e) => e.key === 'Escape' && window.duski.send('ask:close'));

function ask(label: string, instruction: string): void {
  if (busy) return;
  raw = '';
  answer.replaceChildren();
  answer.hidden = false;
  actions.hidden = true;
  setBusy(true);
  window.duski.send('ask:run', label, instruction);
  resize();
}

function renderAnswer(): void {
  queued = false;
  // Claude output can contain HTML; sanitize before it touches the DOM.
  answer.innerHTML = DOMPurify.sanitize(marked.parse(raw, { async: false, breaks: true }) as string);
  resize();
}

function setBusy(b: boolean): void {
  busy = b;
  go.textContent = b ? 'Stop' : 'Ask';
  for (const p of presets.querySelectorAll('button')) p.disabled = b;
}

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.title = text;
  status.classList.toggle('error', error);
}

function resize(): void {
  window.duski.send('ask:resize', card.offsetHeight + 2); // +2 for the body border
}
