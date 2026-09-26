import { BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import type { ChatEvent } from '../shared/chat-events';
import { lastLines, runClaude, type ClaudeRun } from './claude';
import { AGENT_HOME, getConfig, saveChatBounds } from './config';

let win: BrowserWindow | null = null;
let sessionId: string | null = null;
let run: ClaudeRun | null = null;
let events: ChatEvent[] = [];

export function initChatIpc(): void {
  ipcMain.on('chat:ready', (e) => e.sender.send('chat:replay', events, run !== null));
  ipcMain.on('chat:send', (_e, text: string) => send(text));
  ipcMain.on('chat:stop', () => run?.cancel());
  ipcMain.on('chat:new', () => {
    run?.cancel();
    run = null;
    sessionId = null;
    events = [];
    win?.webContents.send('chat:replay', events, false);
  });
  ipcMain.on('chat:pin', (_e, on: boolean) => win?.setAlwaysOnTop(on));
}

export function openChat(): void {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  const b = getConfig().chatWindow;
  const pos = b.x !== null && b.y !== null && onScreen(b.x, b.y) ? { x: b.x, y: b.y } : {};
  const w = new BrowserWindow({
    ...pos,
    width: b.width,
    height: b.height,
    minWidth: 320,
    minHeight: 320,
    title: 'Duski Chat',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win = w;
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
  });
  // Links in replies open in the browser, never inside the chat window.
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openExternal(url);
  });
  w.on('close', () => {
    const r = w.getBounds();
    saveChatBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
  });
  w.on('closed', () => {
    win = null; // the window is destroyed to free RAM; the session stays
  });
  void w.loadFile(path.join(__dirname, '..', 'static', 'chat.html'));
}

function send(text: string): void {
  if (run) return;
  const cfg = getConfig();
  emit({ kind: 'user', text });
  let resultError = false;
  const thisRun: ClaudeRun = runClaude({
    claudePath: cfg.claudePath,
    cwd: AGENT_HOME,
    prompt: text,
    args: ['--dangerously-skip-permissions', '--model', cfg.models.chat, ...(sessionId ? ['--resume', sessionId] : [])],
    onEvent: (e) => {
      if (run !== thisRun) return; // a "New chat" happened; drop the old run's output
      if (e.type === 'session') sessionId = e.id;
      else if (e.type === 'text') emit({ kind: 'text', text: e.text });
      else if (e.type === 'tool') emit({ kind: 'tool', id: e.id, name: e.name, summary: summarize(e.input), input: JSON.stringify(e.input, null, 2) });
      else if (e.type === 'tool-result') emit({ kind: 'tool-result', id: e.id, output: truncate(e.output, 4000), isError: e.isError });
      else if (e.type === 'result' && e.isError) {
        resultError = true;
        emit({ kind: 'error', text: e.text });
      }
    },
  });
  run = thisRun;
  void thisRun.done.then((r) => {
    if (run !== thisRun) return;
    run = null;
    if (r.cancelled) emit({ kind: 'error', text: 'Stopped.' });
    else if (r.code !== 0 && !resultError) emit({ kind: 'error', text: lastLines(r.stderr, 5) || `claude exited with code ${r.code}` });
    emit({ kind: 'done' });
  });
}

function emit(e: ChatEvent): void {
  events.push(e);
  if (win && !win.isDestroyed()) win.webContents.send('chat:event', e);
}

function summarize(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const v = i.command ?? i.file_path ?? i.pattern ?? i.query ?? i.url ?? i.description;
  return truncate(typeof v === 'string' ? v : JSON.stringify(input), 80).replace(/\s+/g, ' ');
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function onScreen(x: number, y: number): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height);
}
