import { BrowserWindow, ipcMain, nativeImage, Notification, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { parseTodos, toDate, type TodoBlock } from '../shared/todo';
import { AGENT_HOME } from './config';
import { savedWindow } from './saved-window';

const TODO_FILE = 'todo.md';
const TODO_PATH = path.join(AGENT_HOME, TODO_FILE);
// ponytail: polls every 15 s, so a toast can be up to 15 s late. A timer per todo would be exact but must be rebuilt on every file change.
const CHECK_MS = 15_000;

let md = ''; // file content with '\n' line ends; the notebook window sees the same form
let todos: TodoBlock[] = [];
let win: BrowserWindow | null = null;
let reloadTimer: NodeJS.Timeout | undefined;
const toasts = new Set<Notification>(); // keeps a reference, or the click handler can be garbage-collected

/** Loads todo.md, watches it, and shows reminders for open todos whose time passes. */
export function initTodos(): void {
  load();
  ipcMain.on('todo:ready', (e) => e.sender.send('todo:file', md));
  // The notebook sends the whole file plus the version it edited. If the file changed since
  // (chat agent, hand edit), the outside change wins and the notebook reloads.
  ipcMain.on('todo:save', (e, base: string, text: string) => {
    load();
    if (md !== base) return void e.sender.send('todo:file', md);
    try {
      fs.writeFileSync(TODO_PATH, read().includes('\r\n') ? text.replace(/\n/g, '\r\n') : text);
    } catch (err) {
      return void e.sender.send('todo:save-failed', base, (err as Error).message); // the notebook keeps the text and retries
    }
    load();
  });
  ipcMain.on('todo:pin', (_e, on: boolean) => win?.setAlwaysOnTop(on));
  ipcMain.on('todo:open-file', () => void shell.openPath(TODO_PATH));

  // Editors save by writing a new file and renaming it, which ends a watch on the file itself. Watch the folder.
  fs.watch(AGENT_HOME, (_event, name) => {
    if (name !== TODO_FILE) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 100); // one save fires several events
  });

  const overdue = todos.filter((t) => !t.done && dueMs(t) <= Date.now()).length;
  if (overdue) toast('Duski', `${overdue} overdue todo${overdue > 1 ? 's' : ''}`);
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    for (const t of todos) if (!t.done && dueMs(t) > last && dueMs(t) <= now) toast('Duski reminder', t.text);
    last = now;
  }, CHECK_MS);
}

export function openTodo(): void {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  const w = savedWindow('todoWindow', 'Duski Todo');
  win = w;
  w.on('closed', () => {
    win = null;
  });
  void w.loadFile(path.join(__dirname, '..', 'static', 'todo.html'));
}

function dueMs(t: TodoBlock): number {
  return (t.due && toDate(t.due)?.getTime()) || Infinity;
}

/** Returns "" only when the file does not exist. Any other read error throws, so a write can never replace unread content. */
function read(): string {
  try {
    return fs.readFileSync(TODO_PATH, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

/** Rereads the file. Tells the notebook only when the content changed, so its own saves do not echo back. */
function load(): void {
  let next: string;
  try {
    next = read().replace(/\r\n/g, '\n');
  } catch {
    return; // file locked by an editor; keep the last content, the next change event retries
  }
  const changed = next !== md;
  md = next;
  todos = parseTodos(md);
  if (changed && win && !win.isDestroyed()) win.webContents.send('todo:file', md);
}

function toast(title: string, body: string): void {
  const n = new Notification({ title, body, icon: nativeImage.createFromPath(path.join(__dirname, '..', 'resources', 'duski-icon.png')) });
  toasts.add(n);
  n.on('click', openTodo);
  n.on('close', () => toasts.delete(n));
  n.show();
}
