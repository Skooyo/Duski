import { BrowserWindow, ipcMain, nativeImage, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AskEvent, AskInit } from '../shared/ask-events';
import type { ChatEvent } from '../shared/chat-events';
import type { Point, RegionImage } from './actions/types';
import { continueInChat, toChatEvent } from './chat';
import { lastLines, runClaude, type ClaudeRun } from './claude';
import { AGENT_HOME, getConfig } from './config';
import { toast } from './tray';

export type AskInput = { kind: 'text'; text: string } | { kind: 'image'; image: RegionImage };

const PRESETS: Record<AskInput['kind'], [label: string, instruction: string][]> = {
  text: [
    ['Fix grammar', 'Fix the grammar and spelling in this text. Keep the meaning and the tone. Reply with only the corrected text.'],
    ['Shorter', 'Make this text shorter and clearer. Keep the meaning. Reply with only the new text.'],
    ['More formal', 'Rewrite this text in a more formal tone. Reply with only the new text.'],
    ['More casual', 'Rewrite this text in a more casual, friendly tone. Reply with only the new text.'],
    ['Explain', 'Explain this text in simple words.'],
  ],
  image: [
    ['What is this?', 'What does it show? Explain briefly.'],
    ['Explain this error', 'It shows an error. Explain what it means and how to fix it.'],
    ['Extract the text', 'Extract all text in it. Keep the line breaks. Reply with only the text.'],
    ['Summarize', 'Summarize what it shows.'],
  ],
};

const WIDTH = 520;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 680;

let win: BrowserWindow | null = null;
let input: AskInput | null = null;
let run: ClaudeRun | null = null;
let session: string | null = null;
let history: ChatEvent[] = []; // the last answer as chat log entries, for "Continue in chat"

export function initAskIpc(): void {
  ipcMain.on('ask:ready', (e) => {
    if (!input) return;
    const init: AskInit =
      input.kind === 'text'
        ? { kind: 'text', text: excerpt(input.text, 600), presets: PRESETS.text }
        : { kind: 'image', image: nativeImage.createFromPath(input.image.path).toDataURL(), presets: PRESETS.image };
    e.sender.send('ask:init', init);
  });
  ipcMain.on('ask:run', (_e, label: string, instruction: string) => start(label, instruction));
  ipcMain.on('ask:stop', () => run?.cancel());
  ipcMain.on('ask:hide', () => win?.hide());
  ipcMain.on('ask:close', () => closeAsk());
  ipcMain.on('ask:continue', () => {
    if (!session) return;
    if (!continueInChat(session, history)) return send({ kind: 'error', text: 'Chat is busy. Wait for its reply, then try again.' });
    closeAsk();
  });
  ipcMain.on('ask:resize', (e, height: number) => {
    if (!win || e.sender !== win.webContents) return;
    const h = clamp(Math.ceil(height), MIN_HEIGHT, MAX_HEIGHT);
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const [x, y] = win.getPosition(); // keeps the place the user dragged it to
    win.setBounds({ x, y: Math.min(y, wa.y + wa.height - h), width: WIDTH, height: h });
  });
}

/** Opens the Ask window at `anchor` for selected text or a screen area. It replaces an open one. */
export function showAsk(anchor: Point, next: AskInput): void {
  closeAsk();
  input = next;
  const wa = screen.getDisplayNearestPoint(anchor).workArea;
  const height = 240;
  const w = new BrowserWindow({
    x: clamp(Math.round(anchor.x) + 12, wa.x, wa.x + wa.width - WIDTH),
    y: clamp(Math.round(anchor.y) + 12, wa.y, wa.y + wa.height - height),
    width: WIDTH,
    height,
    frame: false,
    resizable: false,
    skipTaskbar: true, // hidden, it lives in the tray menu and the toast
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  w.setAlwaysOnTop(true, 'floating');
  win = w;
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
  });
  w.on('closed', () => win === w && closeAsk());
  void w.loadFile(path.join(__dirname, '..', 'static', 'ask.html'));
}

/** Brings a minimized Ask window back (tray menu, toast). */
export function showAskWindow(): void {
  win?.show();
  win?.focus();
}

/** Stops the answer, deletes the area image, closes the window. */
function closeAsk(): void {
  run?.cancel();
  run = null;
  if (input?.kind === 'image') fs.rmSync(input.image.path, { force: true });
  input = null;
  session = null;
  history = [];
  const old = win;
  win = null;
  old?.destroy();
}

function start(label: string, instruction: string): void {
  if (!input) return;
  run?.cancel();
  const cfg = getConfig();
  const prompt =
    input.kind === 'text'
      ? `${instruction}\n\n<selected_text>\n${input.text}\n</selected_text>`
      : `Read the image file ${input.image.path}. It is a screenshot of an area of my screen. ${instruction}`;
  session = null;
  history = [{ kind: 'user', text: input.kind === 'text' ? `${label}\n\n"${excerpt(input.text, 300)}"` : `${label} (screen area)` }];
  let failed = false;
  send({ kind: 'status', text: 'Thinking…' });

  const thisRun: ClaudeRun = runClaude({
    claudePath: cfg.claudePath,
    cwd: AGENT_HOME,
    prompt,
    args: ['--dangerously-skip-permissions', '--model', cfg.models.chat],
    onEvent: (e) => {
      if (run !== thisRun) return; // replaced by a newer question, or the window closed
      if (e.type === 'session') session = e.id;
      const ce = toChatEvent(e);
      if (!ce) return;
      history.push(ce);
      if (ce.kind === 'text') send({ kind: 'text', text: ce.text });
      else if (ce.kind === 'tool') send({ kind: 'status', text: `${ce.name}: ${ce.summary}` });
      else if (ce.kind === 'error') {
        failed = true;
        send({ kind: 'error', text: ce.text });
      }
    },
  });
  run = thisRun;
  void thisRun.done.then((r) => {
    if (run !== thisRun) return;
    run = null;
    if (r.cancelled) send({ kind: 'error', text: 'Stopped.' });
    else if (r.code !== 0 && !failed) {
      failed = true;
      send({ kind: 'error', text: lastLines(r.stderr, 5) || `claude exited with code ${r.code}` });
    }
    send({ kind: 'done', canContinue: session !== null && !r.cancelled });
    if (win && !win.isVisible() && !r.cancelled) toast(failed ? 'Duski could not answer' : 'Duski answer ready', label, showAskWindow);
  });
}

function send(e: AskEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('ask:event', e);
}

function excerpt(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
