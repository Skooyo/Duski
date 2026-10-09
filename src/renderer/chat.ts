import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AttachedFile, ChatEvent, FilePreview } from '../shared/chat-events';

type Segment = { el: HTMLElement; raw: string };
/** An item in the attachments band. Images travel as data URLs; other files travel as paths. */
type Pending = { kind: 'image'; name: string; size: number; url: string; path: string } | ({ kind: 'file' } & AttachedFile);

const log = document.getElementById('log') as HTMLElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const pinBtn = document.getElementById('pin') as HTMLButtonElement;
const attachments = document.getElementById('attachments') as HTMLElement;
const previewDlg = document.getElementById('preview') as HTMLDialogElement;
const previewName = document.getElementById('preview-name') as HTMLElement;
const previewMeta = document.getElementById('preview-meta') as HTMLElement;
const previewBody = document.getElementById('preview-body') as HTMLElement;
const revealBtn = document.getElementById('preview-reveal') as HTMLButtonElement;

let busy = false;
let segment: Segment | null = null; // assistant text block that receives the next deltas
let reply: HTMLElement | null = null; // body of the current AI reply (next to its avatar)
const dirty = new Set<Segment>();
const tools = new Map<string, HTMLDetailsElement>();
let pending: Pending[] = []; // attachments for the next message
let previewPath = ''; // file that "Show in folder" reveals

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
      add('div', 'msg user', log).append(
        ...(e.images ?? []).map((url, i) => imageButton(url, `Attached image ${i + 1}`)),
        ...(e.files ?? []).map(fileChip),
        e.text,
      );
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
}

/** A sent image. A click opens the preview. */
function imageButton(url: string, label: string): HTMLButtonElement {
  const b = el('button', 'thumb');
  b.title = b.ariaLabel = `Preview ${label.toLowerCase()}`;
  b.append(image(url, label));
  b.addEventListener('click', () => previewImage(label, url, ''));
  return b;
}

/** A sent file. A click opens the preview. */
function fileChip(f: AttachedFile): HTMLButtonElement {
  const b = el('button', 'file-chip', `📄 ${f.name}`);
  b.title = f.path;
  b.ariaLabel = `Preview ${f.name}`;
  b.addEventListener('click', () => void previewFile(f));
  return b;
}

function attach(files: FileList | undefined): void {
  for (const file of files ?? []) {
    const path = window.duski.pathForFile(file); // '' for a pasted screenshot
    if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      const reader = new FileReader();
      reader.onload = () => {
        pending.push({ kind: 'image', name: file.name || 'Pasted image', size: file.size, url: reader.result as string, path });
        renderPending();
      };
      reader.readAsDataURL(file);
    } else if (path && !pending.some((p) => p.path === path)) {
      pending.push({ kind: 'file', name: file.name, size: file.size, path });
      renderPending();
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** The attachments band above the message box: a header with Clear, then one row per item. */
function renderPending(): void {
  attachments.hidden = pending.length === 0;
  if (!pending.length) return attachments.replaceChildren();
  const clear = el('button', '', 'Clear');
  clear.addEventListener('click', () => removePending(() => true));
  const head = el('div', 'band-head');
  head.append(el('strong', '', `Attached (${pending.length})`), el('span', 'spacer'), clear);

  const rows = pending.map((p) => {
    const open = el('button', 'open');
    open.title = p.path || p.name;
    open.ariaLabel = `Preview ${p.name}`;
    open.append(
      p.kind === 'image' ? image(p.url, '') : el('span', 'icon', '📄'),
      el('span', 'name', p.name),
      el('span', 'meta', [p.size ? formatSize(p.size) : '', p.path].filter(Boolean).join(' · ')),
    );
    open.addEventListener('click', () => (p.kind === 'image' ? previewImage(p.name, p.url, p.path) : void previewFile(p)));
    const rm = el('button', 'rm', '×');
    rm.title = rm.ariaLabel = `Remove ${p.name}`;
    rm.addEventListener('click', () => removePending((x) => x === p));
    const row = el('div', `att ${p.kind}`);
    row.append(open, rm);
    return row;
  });
  attachments.replaceChildren(head, ...rows);
}

function removePending(match: (p: Pending) => boolean): void {
  pending = pending.filter((p) => !match(p));
  renderPending();
  input.focus();
}

function showPreview(name: string, path: string, ...body: Node[]): void {
  previewName.textContent = name;
  previewMeta.textContent = path;
  previewMeta.hidden = revealBtn.hidden = !path;
  previewPath = path;
  previewBody.replaceChildren(...body);
  if (!previewDlg.open) previewDlg.showModal();
}

function previewImage(name: string, url: string, path: string): void {
  showPreview(name, path, image(url, name));
}

async function previewFile(f: AttachedFile): Promise<void> {
  const note = (text: string) => el('p', 'note', text);
  showPreview(f.name, f.path, note('Loading…'));
  const r = await window.duski.invoke<FilePreview>('chat:preview', f.path).catch((): FilePreview => ({ kind: 'missing' }));
  if (!previewDlg.open || previewPath !== f.path) return; // closed, or another preview opened meanwhile
  if (r.kind === 'text') {
    previewBody.replaceChildren(el('pre', '', r.text), ...(r.truncated ? [note('The preview shows the first 256 KB.')] : []));
    return;
  }
  const why = { binary: 'No text preview for this file type.', folder: 'This is a folder.', missing: 'Duski cannot read this file.' }[r.kind];
  previewBody.replaceChildren(note(`${why} Click "Show in folder" to open it in Explorer.`));
}

function submit(): void {
  const text = input.value.trim();
  if ((!text && !pending.length) || busy) return;
  input.value = '';
  const images = pending.flatMap((p) => (p.kind === 'image' ? [p.url] : []));
  const files = pending.flatMap((p) => (p.kind === 'file' ? [{ name: p.name, path: p.path, size: p.size }] : []));
  window.duski.send('chat:send', text, images, files);
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
revealBtn.addEventListener('click', () => window.duski.send('chat:reveal', previewPath));
document.getElementById('preview-close')!.addEventListener('click', () => previewDlg.close());
previewDlg.addEventListener('click', (e) => e.target === previewDlg && previewDlg.close()); // a click on the backdrop
document.getElementById('new')!.addEventListener('click', () => window.duski.send('chat:new'));
pinBtn.addEventListener('click', () => {
  const on = pinBtn.getAttribute('aria-pressed') !== 'true';
  pinBtn.setAttribute('aria-pressed', String(on));
  window.duski.send('chat:pin', on);
});
