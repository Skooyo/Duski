import { BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AttachedFile, ChatEvent, FilePreview } from '../shared/chat-events';
import { lastLines, REPLY_STYLE_ARGS, runClaude, type ClaudeEvent, type ClaudeRun } from './claude';
import { AGENT_HOME, getConfig, TEMP_DIR } from './config';
import { savedWindow } from './saved-window';

let win: BrowserWindow | null = null;
let sessionId: string | null = null;
let run: ClaudeRun | null = null;
let events: ChatEvent[] = [];

export function initChatIpc(): void {
  ipcMain.on('chat:ready', (e) => e.sender.send('chat:replay', events, run !== null));
  ipcMain.on('chat:send', (_e, text: string, images: unknown, files: unknown) =>
    send(String(text), Array.isArray(images) ? images : [], Array.isArray(files) ? files : []),
  );
  ipcMain.handle('chat:preview', (_e, file: unknown) => preview(String(file)));
  ipcMain.on('chat:reveal', (_e, file: unknown) => shell.showItemInFolder(String(file)));
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
  const w = savedWindow('chatWindow', 'Duski Chat');
  win = w;
  // Links in replies open in the browser, never inside the chat window.
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openExternal(url);
  });
  w.on('closed', () => {
    win = null; // the window is destroyed to free RAM; the session stays
  });
  void w.loadFile(path.join(__dirname, '..', 'static', 'chat.html'));
}

const IMAGE_URL = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/;

/** Writes pasted images to temp files that Claude can Read. Skips anything that is not a supported image data URL. */
function saveImages(images: unknown[]): { urls: string[]; files: string[] } {
  const urls: string[] = [];
  const files: string[] = [];
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  for (const url of images) {
    const m = typeof url === 'string' ? IMAGE_URL.exec(url) : null;
    if (!m) continue;
    const file = path.join(TEMP_DIR, `chat-${Date.now()}-${files.length}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    urls.push(url as string);
    files.push(file);
  }
  return { urls, files };
}

/** Keeps dropped paths that still exist on disk. The renderer is not trusted to send real paths. */
function checkFiles(files: unknown[]): AttachedFile[] {
  return files.flatMap((f) => {
    const p = (f as { path?: unknown } | null)?.path;
    if (typeof p !== 'string' || !path.isAbsolute(p)) return [];
    try {
      const st = fs.statSync(p);
      return [{ name: path.basename(p), path: p, size: st.isFile() ? st.size : 0 }];
    } catch {
      return []; // gone, or no access
    }
  });
}

const PREVIEW_BYTES = 256 * 1024;

/** The start of a dropped file as text, for the preview dialog. A NUL byte in the first chunk means binary. */
async function preview(file: string): Promise<FilePreview> {
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st) return { kind: 'missing' };
  if (st.isDirectory()) return { kind: 'folder' };
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, PREVIEW_BYTES));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead);
    if (head.includes(0)) return { kind: 'binary' };
    return { kind: 'text', text: head.toString('utf8'), truncated: st.size > bytesRead };
  } finally {
    await fh.close();
  }
}

function send(text: string, images: unknown[], dropped: unknown[]): void {
  if (run) return;
  const cfg = getConfig();
  const { urls, files } = saveImages(images);
  const attached = checkFiles(dropped);
  if (!text && !files.length && !attached.length) return;
  emit({ kind: 'user', text, images: urls, files: attached });
  let prompt = text;
  if (files.length) prompt += `\n\nI attached images. Read each one with the Read tool:\n${files.join('\n')}`;
  if (attached.length) prompt += `\n\nAttached files:\n${attached.map((f) => `- "${f.path}"`).join('\n')}`;
  prompt = prompt.trim();
  let resultError = false;
  const thisRun: ClaudeRun = runClaude({
    claudePath: cfg.claudePath,
    cwd: AGENT_HOME,
    prompt,
    args: ['--dangerously-skip-permissions', '--model', cfg.models.chat, ...REPLY_STYLE_ARGS, ...(sessionId ? ['--resume', sessionId] : [])],
    onEvent: (e) => {
      if (run !== thisRun) return; // a "New chat" happened; drop the old run's output
      if (e.type === 'session') sessionId = e.id;
      const ce = toChatEvent(e);
      if (!ce) return;
      if (ce.kind === 'error') resultError = true;
      emit(ce);
    },
  });
  run = thisRun;
  void thisRun.done.then((r) => {
    // The session transcript keeps the image after Claude reads it, so --resume does not need the files.
    for (const f of files) fs.rmSync(f, { force: true });
    if (run !== thisRun) return;
    run = null;
    if (r.cancelled) emit({ kind: 'error', text: 'Stopped.' });
    else if (r.code !== 0 && !resultError) emit({ kind: 'error', text: lastLines(r.stderr, 5) || `claude exited with code ${r.code}` });
    emit({ kind: 'done' });
  });
}

/** Claude stream event → chat log entry. Null for events the log does not show. */
export function toChatEvent(e: ClaudeEvent): ChatEvent | null {
  if (e.type === 'text') return { kind: 'text', text: e.text };
  if (e.type === 'tool') return { kind: 'tool', id: e.id, name: e.name, summary: summarize(e.input), input: JSON.stringify(e.input, null, 2) };
  if (e.type === 'tool-result') return { kind: 'tool-result', id: e.id, output: truncate(e.output, 4000), isError: e.isError };
  if (e.type === 'result' && e.isError) return { kind: 'error', text: e.text };
  return null;
}

/** Starts a new chat that resumes another session (a quick ask). Returns false while a chat reply is running. */
export function continueInChat(session: string, history: ChatEvent[]): boolean {
  if (run) return false;
  sessionId = session;
  events = [...history, { kind: 'done' }];
  win?.webContents.send('chat:replay', events, false);
  openChat();
  return true;
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
