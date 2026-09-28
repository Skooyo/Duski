import { formatBlock, parseBlock, stamp, toDate, type Block, type TodoBlock } from '../shared/todo';

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
let active = 0;

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
  b.classList.toggle('overdue', overdue);
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

// ---- reminder menu (typed @ or the clock button) ----

function openMenu(r: TodoRow, anchor: DOMRect, at: number | null): void {
  menuFor = { id: r.id, at };
  const now = new Date();
  const day = (plus: number, hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + plus, hour, 0);
  const inHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 60_000) * 60_000); // rounded up: never fires early
  const items: [string, () => void, string?][] = [
    ['In 1 hour', () => choose(stamp(inHour))],
    ...(now.getHours() < 20 ? [[`Tonight ${clock(day(0, 20))}`, () => choose(stamp(day(0, 20)))] as [string, () => void]] : []),
    [`Tomorrow ${clock(day(1, 9))}`, () => choose(stamp(day(1, 9)))],
    ['Pick a date and time…', () => showPicker(r)],
    ...(r.due ? [['Remove reminder', () => choose(null), 'remove'] as [string, () => void, string]] : []),
  ];
  menu.replaceChildren(
    ...items.map(([label, run, cls], i) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, id: `opt${i}`, tabIndex: -1 });
      b.setAttribute('role', 'option');
      if (cls) b.classList.add(cls);
      b.addEventListener('click', run);
      b.addEventListener('mouseenter', () => setActive(i));
      return b;
    }),
  );
  menu.hidden = false;
  positionMenu(anchor);
  setActive(0);
  if (at === null) options()[0].focus(); // opened by a button: keyboard focus moves into the menu
}

function options(): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>('[role=option]')];
}

function setActive(i: number): void {
  active = i;
  options().forEach((b, j) => {
    b.classList.toggle('active', j === i);
    b.setAttribute('aria-selected', String(j === i));
  });
  if (menu.contains(document.activeElement)) options()[i]?.focus();
}

function positionMenu(anchor: DOMRect): void {
  const left = Math.min(anchor.left, innerWidth - menu.offsetWidth - 8);
  let top = anchor.bottom + 4;
  if (top + menu.offsetHeight > innerHeight - 8) top = anchor.top - menu.offsetHeight - 4;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function showPicker(r: TodoRow): void {
  const form = document.createElement('form');
  const input = Object.assign(document.createElement('input'), { type: 'datetime-local', id: 'pick' });
  input.setAttribute('aria-label', 'Reminder date and time');
  const next = new Date();
  next.setHours(next.getHours() + 1, 0, 0, 0);
  input.value = (r.due ?? stamp(next)).replace(' ', 'T');
  const set = Object.assign(document.createElement('button'), { type: 'submit', textContent: 'Set', className: 'primary' });
  form.append(input, set);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value) choose(input.value.replace('T', ' '));
  });
  menu.replaceChildren(form);
  input.focus();
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
  const n = options().length;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeMenu(true);
  } else if (!n) {
    // the date picker form handles its own keys
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    setActive((active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    options()[active].click();
  } else if (menuFor?.at !== null && !['Shift', 'Control', 'Alt'].includes(e.key)) {
    closeMenu(false); // typing goes on; the '@' stays as plain text
  }
}
