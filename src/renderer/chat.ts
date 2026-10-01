import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ChatEvent } from '../shared/chat-events';

type Segment = { el: HTMLElement; raw: string };

const log = document.getElementById('log') as HTMLElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const pinBtn = document.getElementById('pin') as HTMLButtonElement;
const attachments = document.getElementById('attachments') as HTMLElement;

let busy = false;
let segment: Segment | null = null; // assistant text block that receives the next deltas
let reply: HTMLElement | null = null; // body of the current AI reply (next to its avatar)
const dirty = new Set<Segment>();
const tools = new Map<string, HTMLDetailsElement>();
let pending: string[] = []; // image data URLs for the next message

window.duski.on('chat:replay', (events: ChatEvent[], isBusy: boolean) => {
  log.replaceChildren();
  segment = null;
  reply = null;
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
      reply = null;
      add('div', 'msg user', log).append(...(e.images ?? []).map((url) => image(url, 'Attached image')), e.text);
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
      reply = null;
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

function add(tag: string, cls: string, parent: HTMLElement = replyBody()): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  parent.append(node);
  return node;
}

/** One avatar per AI reply: text blocks, tool lines and errors of the reply stack beside it. */
function replyBody(): HTMLElement {
  if (reply) return reply;
  const row = document.createElement('div');
  row.className = 'reply';
  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.src = '../resources/duski-icon.png';
  avatar.alt = 'Duski';
  reply = document.createElement('div');
  reply.className = 'reply-body';
  row.append(avatar, reply);
  log.append(row);
  return reply;
}

function nearBottom(): boolean {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
}

function setBusy(b: boolean): void {
  busy = b;
  log.classList.toggle('busy', b);
  input.disabled = b;
  sendBtn.textContent = b ? 'Stop' : 'Send';
  if (!b) input.focus();
}

function image(src: string, alt: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  return img;
}

function attach(files: FileList | undefined): void {
  for (const file of files ?? []) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) continue;
    const reader = new FileReader();
    reader.onload = () => {
      pending.push(reader.result as string);
      renderPending();
    };
    reader.readAsDataURL(file);
  }
}

function renderPending(): void {
  attachments.hidden = pending.length === 0;
  attachments.replaceChildren(
    ...pending.map((url, i) => {
      const b = document.createElement('button');
      b.title = b.ariaLabel = `Remove image ${i + 1}`;
      b.append(image(url, ''));
      b.addEventListener('click', () => {
        pending.splice(i, 1);
        renderPending();
        input.focus();
      });
      return b;
    }),
  );
}

function submit(): void {
  const text = input.value.trim();
  if ((!text && !pending.length) || busy) return;
  input.value = '';
  window.duski.send('chat:send', text, pending);
  pending = [];
  renderPending();
}

sendBtn.addEventListener('click', () => (busy ? window.duski.send('chat:stop') : submit()));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});
input.addEventListener('paste', (e) => attach(e.clipboardData?.files));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  attach(e.dataTransfer?.files);
});
document.getElementById('new')!.addEventListener('click', () => window.duski.send('chat:new'));
pinBtn.addEventListener('click', () => {
  const on = pinBtn.getAttribute('aria-pressed') !== 'true';
  pinBtn.setAttribute('aria-pressed', String(on));
  window.duski.send('chat:pin', on);
});
