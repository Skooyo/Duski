import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ChatEvent } from '../shared/chat-events';

type Segment = { el: HTMLElement; raw: string };

const log = document.getElementById('log') as HTMLElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const pinBtn = document.getElementById('pin') as HTMLButtonElement;

let busy = false;
let segment: Segment | null = null; // assistant text block that receives the next deltas
const dirty = new Set<Segment>();
const tools = new Map<string, HTMLDetailsElement>();

window.duski.on('chat:replay', (events: ChatEvent[], isBusy: boolean) => {
  log.replaceChildren();
  segment = null;
  tools.clear();
  events.forEach(apply);
  setBusy(isBusy);
  log.scrollTop = log.scrollHeight;
});
window.duski.on('chat:event', (e: ChatEvent) => apply(e));
window.duski.send('chat:ready');

function apply(e: ChatEvent): void {
  const stick = nearBottom();
  switch (e.kind) {
    case 'user':
      segment = null;
      add('div', 'msg user').textContent = e.text;
      setBusy(true);
      break;
    case 'text':
      if (!segment) segment = { el: add('div', 'msg assistant'), raw: '' };
      segment.raw += e.text;
      queueRender(segment);
      break;
    case 'tool': {
      segment = null;
      const d = add('details', 'tool') as HTMLDetailsElement;
      const summary = document.createElement('summary');
      summary.textContent = `${e.name}: ${e.summary}`;
      const pre = document.createElement('pre');
      pre.textContent = e.input;
      d.append(summary, pre);
      tools.set(e.id, d);
      break;
    }
    case 'tool-result': {
      const d = tools.get(e.id);
      if (!d) break;
      const pre = document.createElement('pre');
      pre.className = 'out';
      pre.textContent = e.output;
      d.append(pre);
      if (e.isError) d.classList.add('error');
      break;
    }
    case 'error':
      segment = null;
      add('div', 'msg error').textContent = e.text;
      break;
    case 'done':
      segment = null;
      setBusy(false);
      break;
  }
  if (stick) log.scrollTop = log.scrollHeight;
}

function queueRender(s: Segment): void {
  if (dirty.size === 0) requestAnimationFrame(renderDirty);
  dirty.add(s);
}

function renderDirty(): void {
  const stick = nearBottom();
  // Claude output can contain HTML; sanitize before it touches the DOM.
  for (const s of dirty) s.el.innerHTML = DOMPurify.sanitize(marked.parse(s.raw, { async: false }) as string);
  dirty.clear();
  if (stick) log.scrollTop = log.scrollHeight;
}

function add(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  log.append(node);
  return node;
}

function nearBottom(): boolean {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
}

function setBusy(b: boolean): void {
  busy = b;
  input.disabled = b;
  sendBtn.textContent = b ? 'Stop' : 'Send';
  if (!b) input.focus();
}

function submit(): void {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  window.duski.send('chat:send', text);
}

sendBtn.addEventListener('click', () => (busy ? window.duski.send('chat:stop') : submit()));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});
document.getElementById('new')!.addEventListener('click', () => window.duski.send('chat:new'));
pinBtn.addEventListener('click', () => {
  const on = pinBtn.getAttribute('aria-pressed') !== 'true';
  pinBtn.setAttribute('aria-pressed', String(on));
  window.duski.send('chat:pin', on);
});
