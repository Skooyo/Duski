import { formatBlock, parseBlock, parseWhen, stamp, toDate, type Block, type TodoBlock } from '../shared/todo';

// The whole of todo.md, one block per line, edited like a Notion page. Each block is its own
// contenteditable; `rows` is the truth and the DOM is rebuilt from it after every structural change.

type Row = Block & { id: number };
type TodoRow = TodoBlock & { id: number };
type Caret = { id: number; offset: number | 'end' };

const DAY_MS = 24 * 60 * 60 * 1000;
const SHORTCUT = /^(?:(?:- )?\[ ?\]|(#{1,3})) /; // "[] " or "- [ ] " → to-do, "# " … "### " → heading
const PLACEHOLDER = { text: 'Type [] for a to-do, # for a heading', todo: 'To-do. Type @ for a reminder', heading: 'Heading' };
const CLOCK_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5" stroke-linecap="round"/></svg>';

const page = document.getElementById('page') as HTMLElement;
const menu = document.getElementById('menu') as HTMLDivElement;
const status = document.getElementById('status') as HTMLElement;
const pinBtn = document.getElementById('pin') as HTMLButtonElement;

let rows: Row[] = [];
let base: string | null = null; // the file as this window last loaded or saved it
let nextId = 1;
let saveTimer: number | undefined;
let menuFor: { id: number; at: number | null } | null = null; // `at`: offset of a typed '@' that the choice replaces
let active = 0; // highlighted option in the reminder panel

window.duski.on('todo:file', (text: string) => {
  if (text === base) return; // our own save
  clearTimeout(saveTimer); // an outside change (chat agent, hand edit) wins over the last unsaved keystrokes
  const first = base === null;
  base = text;
  const at = focusedIndex();
  const offset = at >= 0 ? caretIn(document.activeElement as HTMLElement)[0] : 0;
  rows = text.replace(/\n$/, '').split('\n').map(toRow);
  if (first) {
    // Open ready to type: the caret waits on an empty line at the end.
    const last = rows.filter(visible).at(-1);
    const blank = last?.kind === 'text' && !last.text ? last : rows[rows.push(toRow('')) - 1];
    return render({ id: blank.id, offset: 0 });
  }
  render(at >= 0 && rows[at] ? { id: rows[at].id, offset } : undefined);
});
window.duski.on('todo:save-failed', (failedBase: string, message: string) => {
  base = failedBase; // the next edit tries again
  status.textContent = `Could not save todo.md: ${message}. Your text stays here.`;
});
window.duski.send('todo:ready');
setInterval(refreshDue, 30_000); // reminders turn red while the window is open
addEventListener('beforeunload', flush);

pinBtn.addEventListener('click', () => {
  const on = pinBtn.getAttribute('aria-pressed') !== 'true';
  pinBtn.setAttribute('aria-pressed', String(on));
  window.duski.send('todo:pin', on);
});
document.getElementById('open-file')!.addEventListener('click', () => window.duski.send('todo:open-file'));

page.addEventListener('input', onInput);
page.addEventListener('keydown', onKey);
page.addEventListener('paste', onPaste);
page.addEventListener('change', onCheck);
page.addEventListener('click', onClick);
page.addEventListener('scroll', () => closeMenu(false));
addEventListener('keydown', onMenuKey, true); // capture: the menu gets arrows and Enter before the block does
addEventListener('mousedown', (e) => !menu.hidden && !menu.contains(e.target as Node) && closeMenu(false));
// Tab out of the menu closes it. No relatedTarget means the window lost focus: keep the menu for when the user comes back.
menu.addEventListener('focusout', (e) => e.relatedTarget && !menu.contains(e.relatedTarget as Node) && closeMenu(false));

// ---- model ----

function toRow(line: string): Row {
  return { ...parseBlock(line), id: nextId++ };
}

function newTodo(text: string, prefix = '- ['): TodoBlock {
  return { kind: 'todo', text, done: false, due: null, doneAt: null, prefix };
}

function rowOf(el: Element): Row | undefined {
  const id = Number(el.closest<HTMLElement>('.block')?.dataset.id);
  return rows.find((r) => r.id === id);
}

function replace(r: Row, b: Block): void {
  rows[rows.indexOf(r)] = { ...b, id: r.id };
}

/** Checked to-dos stay (struck through) for 24 h after they were checked, then only the file keeps them. */
function visible(r: Row): boolean {
  return r.kind !== 'todo' || !r.done || Date.now() - (toDate(r.doneAt ?? '')?.getTime() ?? 0) < DAY_MS;
}

function neighbor(r: Row, dir: 1 | -1): Row | undefined {
  for (let i = rows.indexOf(r) + dir; i >= 0 && i < rows.length; i += dir) if (visible(rows[i])) return rows[i];
}

function save(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 400);
}

function flush(): void {
  clearTimeout(saveTimer);
  const text = rows.map(formatBlock).join('\n') + '\n';
  if (base === null || text === base) return;
  status.textContent = '';
  window.duski.send('todo:save', base, text);
  base = text;
}

// ---- view ----

function render(caret?: Caret): void {
  if (!rows.some(visible)) rows.push(toRow(''));
  page.replaceChildren(...rows.filter(visible).map(blockEl));
  if (caret) place(caret);
}

function blockEl(r: Row): HTMLElement {
  const el = document.createElement('div');
  el.className = `block ${r.kind}${r.kind === 'heading' ? ` h${r.level}` : ''}${r.kind === 'todo' && r.done ? ' done' : ''}`;
  el.dataset.id = String(r.id);
  if (r.kind === 'todo') {
    const check = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'check', checked: r.done });
    check.setAttribute('aria-label', 'Done');
    el.append(check);
  }
  const edit = document.createElement('div');
  edit.className = 'edit';
  edit.contentEditable = 'plaintext-only';
  edit.setAttribute('role', 'textbox');
  edit.setAttribute('aria-placeholder', PLACEHOLDER[r.kind]);
  edit.textContent = r.text;
  el.append(edit);
  if (r.kind === 'todo') {
    const b = Object.assign(document.createElement('button'), { type: 'button' });
    if (r.due) {
      b.className = 'due';
      fillDue(b, r);
    } else {
      b.className = 'clock';
      b.innerHTML = CLOCK_SVG;
      b.title = 'Set reminder';
      b.setAttribute('aria-label', 'Set reminder');
    }
    el.append(b);
  }
  return el;
}

function fillDue(b: HTMLElement, r: TodoBlock): void {
  const d = toDate(r.due!)!;
  const overdue = !r.done && d.getTime() <= Date.now();
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY_MS);
  b.classList.toggle('overdue', overdue);
  b.classList.toggle('today', !overdue && !r.done && days === 0);
  b.classList.toggle('tomorrow', !overdue && !r.done && days === 1);
  b.textContent = (overdue ? 'Overdue, ' : '') + whenLabel(d, overdue);
  b.setAttribute('aria-label', `Reminder: ${b.textContent}. Change`);
}

function refreshDue(): void {
  for (const b of page.querySelectorAll<HTMLElement>('.due')) {
    const r = rowOf(b);
    if (r?.kind === 'todo' && r.due) fillDue(b, r);
  }
}

/** "Today 5:00 PM", "Tomorrow 9:00 AM", "Sat 3 Oct 9:00 AM". Lowercase after "Overdue, ". */
function whenLabel(d: Date, lower: boolean): string {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const names: Record<number, string> = { [-1]: 'Yesterday', 0: 'Today', 1: 'Tomorrow' };
  const name = names[Math.round((day - today) / DAY_MS)];
  if (!name) return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${clock(d)}`;
  return `${lower ? name.toLowerCase() : name} ${clock(d)}`;
}

function clock(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---- caret ----

function caretIn(edit: HTMLElement): [number, number] {
  const sel = getSelection();
  if (!sel?.rangeCount || !edit.contains(sel.anchorNode)) return [0, 0];
  const range = sel.getRangeAt(0);
  const pos = (node: Node, offset: number) => {
    const r = document.createRange();
    r.selectNodeContents(edit);
    r.setEnd(node, offset);
    return r.toString().length;
  };
  return [pos(range.startContainer, range.startOffset), pos(range.endContainer, range.endOffset)];
}

function place({ id, offset }: Caret): void {
  const edit = page.querySelector<HTMLElement>(`[data-id="${id}"] .edit`);
  if (!edit) return;
  edit.focus();
  edit.normalize();
  const node = edit.firstChild;
  const len = edit.textContent?.length ?? 0;
  const range = document.createRange();
  if (node?.nodeType === Node.TEXT_NODE) range.setStart(node, Math.min(offset === 'end' ? len : offset, len));
  else range.setStart(edit, 0);
  range.collapse(true);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
}

function focusedIndex(): number {
  const r = document.activeElement?.classList.contains('edit') ? rowOf(document.activeElement) : undefined;
  return r ? rows.indexOf(r) : -1;
}

/** True when the caret is on the first (or last) visual line of a wrapped block. */
function onEdgeLine(edit: HTMLElement, side: 'top' | 'bottom'): boolean {
  const sel = getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const rect = sel.getRangeAt(0).getClientRects()[0];
  if (!rect) return true; // empty block
  const box = edit.getBoundingClientRect();
  const half = (parseFloat(getComputedStyle(edit).lineHeight) || 20) / 2;
  return side === 'top' ? rect.top - box.top < half : box.bottom - rect.bottom < half;
}

function caretRect(edit: HTMLElement): DOMRect {
  const sel = getSelection();
  return (sel?.rangeCount && sel.getRangeAt(0).getClientRects()[0]) || edit.getBoundingClientRect();
}

// ---- editing ----

function onInput(e: Event): void {
  const edit = e.target as HTMLElement;
  const r = rowOf(edit);
  if (!r || !edit.classList.contains('edit')) return;
  if (!edit.textContent) edit.replaceChildren(); // an emptied block keeps a <br>, which hides the placeholder
  r.text = (edit.textContent ?? '').replace(/ /g, ' ');
  const m = r.kind === 'text' ? SHORTCUT.exec(r.text) : null;
  if (m) {
    const offset = Math.max(0, caretIn(edit)[0] - m[0].length);
    const rest = r.text.slice(m[0].length);
    replace(r, m[1] ? { kind: 'heading', level: m[1].length as 1 | 2 | 3, text: rest } : newTodo(rest));
    render({ id: r.id, offset });
  } else if (r.kind === 'todo' && (e as InputEvent).data?.endsWith('@')) {
    openMenu(r, caretRect(edit), caretIn(edit)[0] - 1);
  }
  save();
}

function onKey(e: KeyboardEvent): void {
  const edit = e.target as HTMLElement;
  const r = edit.classList.contains('edit') ? rowOf(edit) : undefined;
  if (!r || e.isComposing) return;
  const [start, end] = caretIn(edit);
  const i = rows.indexOf(r);

  if (e.key === 'Enter') {
    e.preventDefault();
    if (r.kind !== 'text' && !r.text) {
      // Enter on an empty to-do or heading turns it into a plain line, like Notion.
      replace(r, { kind: 'text', text: '' });
      render({ id: r.id, offset: 0 });
    } else if (start === 0 && end === 0 && r.text) {
      // At the start of a line: open an empty line above and keep this one intact.
      const above = toRow(r.kind === 'todo' ? '- [ ] ' : '');
      rows.splice(i, 0, above);
      render({ id: r.id, offset: 0 });
    } else {
      const after = r.text.slice(end);
      r.text = r.text.slice(0, start);
      const next: Row = { ...(r.kind === 'todo' ? newTodo(after, r.prefix) : { kind: 'text' as const, text: after }), id: nextId++ };
      rows.splice(i + 1, 0, next);
      render({ id: next.id, offset: 0 });
    }
    save();
  } else if (e.key === 'Backspace' && start === 0 && end === 0) {
    if (r.kind !== 'text') {
      // First Backspace at the start turns a to-do or heading into a plain line; the next one joins lines.
      e.preventDefault();
      replace(r, { kind: 'text', text: r.text });
      render({ id: r.id, offset: 0 });
      save();
      return;
    }
    const prev = neighbor(r, -1);
    if (!prev) return;
    e.preventDefault();
    const offset = prev.text.length;
    prev.text += r.text;
    rows.splice(i, 1);
    render({ id: prev.id, offset });
    save();
  } else if (e.key === 'Delete' && start === r.text.length && end === start) {
    const next = neighbor(r, 1);
    if (!next) return;
    e.preventDefault();
    r.text += next.text;
    rows.splice(rows.indexOf(next), 1);
    render({ id: r.id, offset: start });
    save();
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && onEdgeLine(edit, e.key === 'ArrowUp' ? 'top' : 'bottom')) {
    const target = neighbor(r, e.key === 'ArrowUp' ? -1 : 1);
    if (!target) return;
    e.preventDefault();
    place({ id: target.id, offset: start });
  }
}

/** Pasting several lines makes several blocks, so a pasted markdown checklist arrives as to-dos. */
function onPaste(e: ClipboardEvent): void {
  const edit = e.target as HTMLElement;
  const r = edit.classList.contains('edit') ? rowOf(edit) : undefined;
  if (!r) return;
  e.preventDefault();
  const lines = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r/g, '').split('\n');
  if (lines.length === 1) return void document.execCommand('insertText', false, lines[0]); // keeps native undo; fires input
  const [start, end] = caretIn(edit);
  const i = rows.indexOf(r);
  const after = r.text.slice(end);
  r.text = r.text.slice(0, start) + lines[0];
  if (r.kind === 'text') replace(r, parseBlock(r.text));
  const added = lines.slice(1).map(toRow);
  const last = added[added.length - 1];
  const offset = last.text.length;
  last.text += after;
  rows.splice(i + 1, 0, ...added);
  render({ id: last.id, offset });
  save();
}

function onCheck(e: Event): void {
  const box = e.target as HTMLInputElement;
  const r = rowOf(box);
  if (r?.kind !== 'todo') return;
  r.done = box.checked;
  r.doneAt = r.done ? stamp(new Date()) : null;
  box.closest('.block')!.classList.toggle('done', r.done);
  refreshDue();
  save();
}

function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const btn = t.closest<HTMLElement>('.due, .clock');
  const r = btn && rowOf(btn);
  if (r?.kind === 'todo') return openMenu(r, btn!.getBoundingClientRect(), null);
  // A click below the last block continues writing there, like on paper.
  const lastEl = page.lastElementChild;
  if (t !== page || !lastEl || e.clientY < lastEl.getBoundingClientRect().bottom) return;
  const last = rowOf(lastEl)!;
  if (last.kind === 'text' && !last.text) return place({ id: last.id, offset: 0 });
  const blank = toRow('');
  rows.splice(rows.indexOf(last) + 1, 0, blank);
  render({ id: blank.id, offset: 0 });
}

// ---- reminder panel (typed @ or the clock button) ----
// A typed field, presets with their day, the next 3 weeks, time chips and an hour picker.
// Every pick sets the reminder and closes the panel. Spec: .scratch/duski-todo/spec.md

type Option = { icon: string; color?: string; name: string; when?: string; due?: Date | null; kind?: 'typed' | 'bad' | 'remove' };

const ICON: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cup: '<path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2"/><path d="M8 2v3M12 2v3"/>',
  next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  enter: '<path d="M9 10l-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const icon = (name: string, color = 'currentColor') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const query = Object.assign(document.createElement('input'), { id: 'when', placeholder: 'Type a date: fri 3pm, in 2h, 20 nov…', autocomplete: 'off' });
const list = el('div', 'r-list');
const calSec = el('div', 'r-section');
const timeSec = el('div', 'r-section');
const foot = el('div', 'r-foot');
{
  const search = el('div', 'r-search');
  search.innerHTML = icon('search');
  query.setAttribute('role', 'combobox');
  query.setAttribute('aria-label', 'Reminder date and time');
  query.setAttribute('aria-controls', 'r-list');
  query.setAttribute('aria-expanded', 'true');
  list.id = 'r-list';
  list.setAttribute('role', 'listbox');
  search.append(query);
  menu.append(search, list, calSec, timeSec, foot);
  query.addEventListener('input', () => {
    active = 0;
    paintList();
    positionMenu(menuAnchor);
  });
}

let menuAnchor = new DOMRect(); // what the panel opened next to; it is placed again when its height changes
let presets: Option[] = [];
let now = new Date(); // the panel's "now": set when it opens, so its days are never stale
let pickDay: Date | null = null; // a day clicked in the calendar
let otherTime = false; // the hour picker is open
let pm = false;
let pickHour: number | null = null; // 1..12 in the hour picker

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const today = () => new Date(now.getFullYear(), now.getMonth(), now.getDate());
const dayAt = (plus: number, hour = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + plus, hour);
const hourLabel = (d: Date) => d.toLocaleTimeString([], d.getMinutes() ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' });
const dayLabel = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
/** A time on the picked day. With no day picked: its next occurrence, today or tomorrow. */
function timeAt(hour: number, min: number): Date {
  const d = new Date(pickDay ?? today());
  d.setHours(hour, min, 0, 0);
  if (!pickDay && d <= now) d.setDate(d.getDate() + 1);
  return d;
}

function openMenu(r: TodoRow, anchor: DOMRect, at: number | null): void {
  menuFor = { id: r.id, at };
  menuAnchor = anchor;
  now = new Date();
  const toSat = (6 - now.getDay() + 7) % 7 || 7;
  const toMon = (8 - now.getDay()) % 7 || 7;
  const inHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 60_000) * 60_000); // rounded up: never fires early
  presets = [
    { icon: 'clock', color: '#5f7ae0', name: 'In 1 hour', due: inHour },
    ...(now.getHours() < 20 ? [{ icon: 'moon', color: '#a78bfa', name: 'Tonight', due: dayAt(0, 20) }] : []),
    { icon: 'sun', color: '#e0a85f', name: 'Tomorrow', due: dayAt(1, 9) },
    { icon: 'cup', color: '#4fb3a9', name: 'This weekend', due: dayAt(toSat, 10) },
    { icon: 'next', color: '#c084fc', name: 'Next week', due: dayAt(toMon, 9) },
  ];
  for (const p of presets) p.when = p === presets[0] ? hourLabel(p.due!) : `${p.due!.toLocaleDateString([], { weekday: 'short' })} ${hourLabel(p.due!)}`;
  const due = r.due ? toDate(r.due) : null;
  pickDay = due && due > now ? new Date(due.getFullYear(), due.getMonth(), due.getDate()) : null;
  otherTime = false;
  pm = now.getHours() >= 11;
  pickHour = null;
  query.value = '';
  active = 0;
  paintList();
  paintCal();
  paintTimes();
  paintFoot();
  menu.hidden = false;
  positionMenu(anchor);
  if (at === null) query.focus(); // opened by a button: type right away. After a typed '@' the caret stays in the text.
}

function options(): Option[] {
  const q = query.value.trim().toLowerCase();
  const r = rows.find((x) => x.id === menuFor?.id);
  if (!q) return presets;
  if (/^(no( due)? date|none|remove|clear)$/.test(q)) return r?.kind === 'todo' && r.due ? [{ icon: 'x', color: 'var(--error)', name: 'Remove reminder', due: null, kind: 'remove' }, ...presets] : presets;
  const d = parseWhen(q, now);
  if (!d) return [{ icon: 'search', name: 'Not understood. Try "fri 3pm".', kind: 'bad' }, ...presets];
  if (d <= now) return [{ icon: 'search', name: `${dayLabel(d)}, ${hourLabel(d)} has passed.`, kind: 'bad' }, ...presets];
  return [{ icon: 'enter', color: 'var(--accent)', name: dayLabel(d), when: hourLabel(d), due: d, kind: 'typed' }, ...presets];
}

function pickOption(o: Option | undefined): void {
  if (o && o.kind !== 'bad') choose(o.due ? stamp(o.due) : null);
}

function paintList(): void {
  const opts = options();
  active = Math.min(active, opts.length - 1);
  list.replaceChildren(
    ...opts.map((o, i) => {
      const b = el('button', `r-row${o.kind ? ` ${o.kind}` : ''}${i === active ? ' active' : ''}`) as HTMLButtonElement;
      b.type = 'button';
      b.tabIndex = -1;
      b.id = `opt${i}`;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(i === active));
      b.innerHTML = icon(o.icon, o.color);
      b.append(el('span', 'name', o.name));
      if (o.when) b.append(el('span', 'when', o.when));
      if (o.kind === 'typed') b.append(el('kbd', '', 'Enter'));
      // Only a real move: Chromium also fires mousemove when the list repaints under a still pointer.
      b.addEventListener('mousemove', (e) => (e.movementX || e.movementY) && active !== i && setActive(i));
      b.addEventListener('click', () => pickOption(o));
      return b;
    }),
  );
  query.setAttribute('aria-activedescendant', `opt${active}`);
}

function setActive(i: number): void {
  active = i;
  paintList();
}

/** This week and the next two, from Monday. Past days are disabled. */
function paintCal(): void {
  const start = today();
  const monday = dayAt(-((now.getDay() + 6) % 7));
  const cells = Array.from({ length: 21 }, (_, n) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + n));
  const months = [...new Set(cells.filter((d) => d >= start).map((d) => d.toLocaleDateString([], { month: 'long' })))].join(' – ');
  const head = el('div', 'r-head');
  head.append(el('span', '', 'Pick a day'), el('span', '', months));
  const cal = el('div', 'r-cal');
  for (const w of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) cal.append(el('span', 'wd', w));
  for (const d of cells) {
    const b = el('button', '', String(d.getDate())) as HTMLButtonElement;
    b.type = 'button';
    if (d.getDate() === 1) b.append(el('span', 'mo', d.toLocaleDateString([], { month: 'short' })));
    b.disabled = d < start;
    b.classList.toggle('today', +d === +start);
    b.classList.toggle('weekend', d.getDay() % 6 === 0);
    b.classList.toggle('on', !!pickDay && +d === +pickDay);
    b.setAttribute('aria-label', d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }));
    b.setAttribute('aria-pressed', String(!!pickDay && +d === +pickDay));
    b.addEventListener('click', () => {
      pickDay = d;
      paintCal();
      paintTimes();
      paintFoot();
      (calSec.querySelector('.on') as HTMLElement | null)?.focus(); // the old button is gone; keep keyboard focus here
    });
    cal.append(b);
  }
  calSec.replaceChildren(head, cal);
}

function paintTimes(): void {
  const head = el('div', 'r-head');
  const chip = (cls: string, text: string, run: () => void) => {
    const b = el('button', cls, text) as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
  };
  if (!otherTime) {
    head.append(el('span', '', pickDay ? 'Then a time' : 'Time'), el('span', '', pickDay ? pickDay.toLocaleDateString([], { weekday: 'long' }) : 'the next one'));
    const row = el('div', 'r-times');
    for (const h of [9, 12, 15, 18, 20]) {
      const d = timeAt(h, 0);
      const b = chip(pickDay ? 'ready' : '', hourLabel(d), () => choose(stamp(d)));
      b.title = whenLabel(d, false);
      b.disabled = d <= now;
      row.append(b);
    }
    row.append(chip('more', 'Other time…', () => setOtherTime(true)));
    return timeSec.replaceChildren(head, row);
  }
  // Hour picker: AM/PM, a 12-hour grid, then the minutes. The minute click sets the reminder.
  head.append(el('span', '', pickHour === null ? 'Pick an hour' : 'Then the minutes'), chip('back', '‹ Back', () => setOtherTime(false)));
  const to24 = (h: number) => (h % 12) + (pm ? 12 : 0);
  const ampm = el('div', 'r-ampm');
  for (const [label, isPm] of [['AM', false], ['PM', true]] as const) {
    const b = chip(pm === isPm ? 'on' : '', label, () => {
      pm = isPm;
      paintTimes();
      paintFoot();
    });
    b.setAttribute('aria-pressed', String(pm === isPm));
    ampm.append(b);
  }
  const hours = el('div', 'r-hours');
  for (const h of [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const b = chip(pickHour === h ? 'on' : '', String(h), () => {
      pickHour = h;
      paintTimes();
      paintFoot();
      (timeSec.querySelector('.r-mins button:not(:disabled)') as HTMLElement | null)?.focus();
    });
    b.setAttribute('aria-label', `${h} ${pm ? 'PM' : 'AM'}`);
    b.disabled = !!pickDay && timeAt(to24(h), 45) <= now; // all four minutes of this hour have passed on the picked day
    hours.append(b);
  }
  const mins = el('div', 'r-mins');
  for (const m of [0, 15, 30, 45]) {
    const d = pickHour === null ? null : timeAt(to24(pickHour), m);
    const b = chip(d ? 'ready' : '', `:${String(m).padStart(2, '0')}`, () => d && choose(stamp(d)));
    b.disabled = !d || d <= now;
    if (d) b.title = whenLabel(d, false);
    mins.append(b);
  }
  const grid = el('div', 'r-clock');
  grid.append(ampm, hours, mins);
  timeSec.replaceChildren(head, grid);
}

function setOtherTime(on: boolean): void {
  otherTime = on;
  pickHour = null;
  paintTimes();
  paintFoot();
  positionMenu(menuAnchor);
  (timeSec.querySelector(on ? '.r-ampm .on' : '.more') as HTMLElement | null)?.focus();
}

function paintFoot(): void {
  const r = rows.find((x) => x.id === menuFor?.id);
  const due = r?.kind === 'todo' && r.due ? toDate(r.due) : null;
  const text = el('span', 'grow');
  const b = el('b', '');
  if (otherTime && pickHour !== null) text.append(b, ' · pick the minutes');
  else if (pickDay) text.append(b, ' · pick a time');
  else if (due) text.append('Now: ', b);
  b.textContent =
    otherTime && pickHour !== null ? `${pickDay ? `${dayLabel(pickDay)}, ` : ''}${pickHour}:__ ${pm ? 'PM' : 'AM'}` : pickDay ? dayLabel(pickDay) : due ? whenLabel(due, false) : '';
  foot.hidden = !b.textContent; // nothing to show: the panel stays short
  foot.replaceChildren(text);
  if (due) {
    const rm = el('button', 'remove', 'Remove') as HTMLButtonElement;
    rm.type = 'button';
    rm.addEventListener('click', () => choose(null));
    foot.append(rm);
  }
}

/** Below the anchor, or above it when there is no room; always inside the window. */
function positionMenu(anchor: DOMRect): void {
  const left = Math.min(anchor.left, innerWidth - menu.offsetWidth - 8);
  let top = anchor.bottom + 4;
  if (top + menu.offsetHeight > innerHeight - 8) top = anchor.top - menu.offsetHeight - 4;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, Math.min(top, innerHeight - menu.offsetHeight - 8))}px`;
}

function choose(due: string | null): void {
  const r = rows.find((x) => x.id === menuFor?.id);
  const at = menuFor?.at ?? null;
  menu.hidden = true;
  menuFor = null;
  if (r?.kind !== 'todo') return;
  if (at !== null && r.text[at] === '@') r.text = r.text.slice(0, at) + r.text.slice(at + 1);
  r.due = due;
  render({ id: r.id, offset: at ?? 'end' });
  save();
}

function closeMenu(returnFocus: boolean): void {
  if (menu.hidden) return;
  const was = menuFor;
  menu.hidden = true;
  menuFor = null;
  if (returnFocus && was) place({ id: was.id, offset: was.at === null ? 'end' : was.at + 1 });
}

function onMenuKey(e: KeyboardEvent): void {
  if (menu.hidden) return;
  const target = e.target as HTMLElement;
  const stop = () => {
    e.preventDefault();
    e.stopPropagation();
  };
  if (e.key === 'Escape') {
    stop();
    closeMenu(true);
  } else if (menu.contains(target) && target !== query) {
    // calendar and time buttons: native Tab, Enter and Space
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    stop();
    const n = options().length;
    setActive((active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
  } else if (e.key === 'Enter') {
    stop();
    pickOption(options()[active]);
  } else if (target !== query && menuFor?.at !== null && !['Shift', 'Control', 'Alt'].includes(e.key)) {
    closeMenu(false); // typing after '@' goes on in the text; the '@' stays as plain text
  }
}
