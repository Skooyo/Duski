# Duski v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows tray app. A global hotkey opens a radial pie menu with three actions: agent chat, translate selection, and translate screen region.

**Architecture:** An Electron main process holds the tray, the hotkey, the action registry, and a `claude -p` runner. The renderer windows (pie, popup, region, chat) are plain TypeScript and HTML. They talk to main through one generic preload bridge. Each pie item is one `PieAction` module in `src/main/actions/`.

**Tech Stack:** Electron 44, TypeScript (typecheck only), esbuild (bundling), `marked` + `dompurify` (chat markdown), `@nut-tree-fork/nut-js` (sends Ctrl+C), Claude Code CLI 2.1.x (`claude.exe`).

**Spec:** `.scratch/duski-radial-menu/spec.md`

## Global Constraints

- Platform: Windows 11 only. Node 24. `claude.exe` is at `C:\Users\daven\.local\bin\claude.exe` (on PATH).
- No React. Renderers are plain TypeScript and DOM.
- No unit tests and no e2e tests. Each task ends with a manual check and `npm run typecheck`.
- Agent home: `D:\Duski\` with `config.json`, `CLAUDE.md`, `.mcp.json` (`{"mcpServers": {}}`), `notes\`.
- Translation target is always English. System prompt, verbatim: `Translate to English. Output only the translation. Keep line breaks. If the text is already English, reply \`Already English\`.`
- Config defaults: `hotkey` `Ctrl+Shift+Space`, `claudePath` `claude`, `models.chat` `sonnet`, `models.translate` `haiku`, `translateTimeoutSec` 60, `chatWindow` `{x:null,y:null,width:480,height:640}`.
- Chat runs with `--dangerously-skip-permissions` in `D:\Duski`.
- Every `claude` call: prompt through stdin, never argv. Cancel with `taskkill /PID <pid> /T /F`.
- Idle RAM target: 70–100 MB. Only the tray, main, and the hidden pie window stay alive when idle.
- Never overwrite an invalid `config.json`.

### Deviations from the spec (measured or simpler)

- `hotkey.ts` is 10 lines, so it lives in `main.ts`. `windows.ts` is split into `pie.ts`, `popup.ts`, `region.ts`, `chat.ts` (one window type per file). `selectRegion` lives in `region.ts`, not `capture.ts`.
- Translation calls run in `%TEMP%\duski` with `--setting-sources project --strict-mcp-config --no-session-persistence`. On this PC this cut the startup from 7.2 s to 5.3 s. It skips user plugins, hooks, and MCP servers, which translation does not need. `--bare` is not usable: it does not read the subscription login.
- The chat transcript stays in main memory, so a reopened chat window shows the earlier messages.
- `ActionContext.claude` is named `runClaude` (a function, not an object).

## Review Focus

1. **Selection in an elevated (admin) app.** Windows blocks the synthetic Ctrl+C. Expected: "No text selected" after about 0.5 s, and the clipboard is unchanged. Check in Task 2, step 7.
2. **Clipboard that holds only an image, or nothing.** Expected: after a selection translation, the clipboard is the same as before. Check in Task 2, step 7.
3. **Two monitors with different scaling (100% + 150%).** Expected: the cropped PNG is exactly the dragged box. Check in Task 3, step 6.
4. **Stop during a Bash tool that does not end** (for example `ping -t localhost`). Expected: the reply stops, and no `claude.exe` or `PING.EXE` stays in Task Manager. Check in Task 4, step 8.
5. **A second translation while one runs.** Expected: the old popup closes, its process ends, and only one `claude.exe` runs. Check in Task 2, step 7.

---

### Task 1: Scaffold, config, tray, startup check

About 30 minutes.

**Files:**
- Create: `package.json`, `tsconfig.json`, `build.mjs`, `.gitignore`
- Create: `src/main/main.ts`, `src/main/config.ts`, `src/main/tray.ts`, `src/preload.ts`, `src/renderer/env.d.ts`

**Interfaces:**
- Produces: `AGENT_HOME: string`, `TEMP_DIR: string`, `interface Config`, `interface WindowBounds`, `loadConfig(): string | null` (error message or null), `getConfig(): Config`, `saveChatBounds(b: WindowBounds): void` (from `config.ts`); `createTray(extra?: MenuItemConstructorOptions[]): void`, `notify(title: string, content: string): void` (from `tray.ts`); `window.duski.send/invoke/on` (preload bridge).

- [ ] **Step 1: Create `package.json` and install packages**

```json
{
  "name": "duski",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "node build.mjs",
    "typecheck": "tsc --noEmit",
    "start": "node build.mjs && electron ."
  }
}
```

Run:
```bash
npm install marked dompurify @nut-tree-fork/nut-js
npm install -D electron esbuild typescript @types/node
```
Expected: both commands end with `added N packages`.

- [ ] **Step 2: Create `tsconfig.json`, `build.mjs`, `.gitignore`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022", "dom", "dom.iterable"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

`build.mjs`:
```js
import { build } from 'esbuild';
import fs from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'info' };
const renderers = fs.existsSync('src/renderer')
  ? fs.readdirSync('src/renderer').filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).map((f) => `src/renderer/${f}`)
  : [];

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron', '@nut-tree-fork/nut-js'] }),
  build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  renderers.length && build({ ...common, entryPoints: renderers, outdir: 'dist/renderer', platform: 'browser', format: 'iife' }),
]);
```

`.gitignore`:
```
node_modules/
dist/
```

- [ ] **Step 3: Create `src/main/config.ts`**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_HOME = 'D:\\Duski';
export const TEMP_DIR = path.join(os.tmpdir(), 'duski');
const CONFIG_PATH = path.join(AGENT_HOME, 'config.json');

export interface WindowBounds {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
}

export interface Config {
  hotkey: string;
  claudePath: string;
  models: { chat: string; translate: string };
  translateTimeoutSec: number;
  chatWindow: WindowBounds;
}

export const DEFAULTS: Config = {
  hotkey: 'Ctrl+Shift+Space',
  claudePath: 'claude',
  models: { chat: 'sonnet', translate: 'haiku' },
  translateTimeoutSec: 60,
  chatWindow: { x: null, y: null, width: 480, height: 640 },
};

const STARTER_CLAUDE_MD = `# Duski agent

You are Duski, a desktop assistant for one user on Windows 11.

- Save notes and reminders as markdown files in \`notes/\`.
- Keep replies short unless the user asks for detail.
`;

let current: Config = DEFAULTS;
let writable = true;

function writeIfMissing(file: string, content: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content);
}

/** Creates the agent home on first start, then loads config.json. Returns an error message when the file is invalid. */
export function loadConfig(): string | null {
  fs.mkdirSync(path.join(AGENT_HOME, 'notes'), { recursive: true });
  writeIfMissing(path.join(AGENT_HOME, 'CLAUDE.md'), STARTER_CLAUDE_MD);
  writeIfMissing(path.join(AGENT_HOME, '.mcp.json'), '{\n  "mcpServers": {}\n}\n');
  writeIfMissing(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n');
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('top level must be an object');
    current = {
      ...DEFAULTS,
      ...raw,
      models: { ...DEFAULTS.models, ...raw.models },
      chatWindow: { ...DEFAULTS.chatWindow, ...raw.chatWindow },
    };
    writable = true;
    return null;
  } catch (err) {
    current = DEFAULTS;
    writable = false;
    return `config.json is not valid (${(err as Error).message}). Using defaults.`;
  }
}

export function getConfig(): Config {
  return current;
}

export function saveChatBounds(bounds: WindowBounds): void {
  current = { ...current, chatWindow: bounds };
  // Never overwrite a file the user broke; they would lose their edits.
  if (writable) fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2) + '\n');
}
```

- [ ] **Step 4: Create `src/main/tray.ts`**

```ts
import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { AGENT_HOME } from './config';

let tray: Tray | null = null; // module-level so it is not garbage-collected

/** 16x16 blue dot, drawn in code so the app needs no icon file. */
function dotIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x - 7.5, y - 7.5) > 7) continue;
      const i = (y * size + x) * 4;
      buf[i] = 0xe0; // B
      buf[i + 1] = 0x7a; // G
      buf[i + 2] = 0x5f; // R
      buf[i + 3] = 0xff; // A
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function createTray(extra: Electron.MenuItemConstructorOptions[] = []): void {
  tray = new Tray(dotIcon());
  tray.setToolTip('Duski');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...extra,
      { label: 'Open agent folder', click: () => void shell.openPath(AGENT_HOME) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

export function notify(title: string, content: string): void {
  tray?.displayBalloon({ title, content, iconType: 'warning' });
}
```

- [ ] **Step 5: Create `src/preload.ts` and `src/renderer/env.d.ts`**

`src/preload.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('duski', {
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, fn: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => fn(...args));
  },
});
```

`src/renderer/env.d.ts`:
```ts
export {};

declare global {
  interface Window {
    duski: {
      send(channel: string, ...args: unknown[]): void;
      invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
      on(channel: string, fn: (...args: any[]) => void): void;
    };
  }
}
```

- [ ] **Step 6: Create `src/main/main.ts`**

```ts
import { app } from 'electron';
import { execFile } from 'node:child_process';
import { getConfig, loadConfig } from './config';
import { createTray, notify } from './tray';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => {
    // Stay alive in the tray.
  });
  void app.whenReady().then(start);
}

function start(): void {
  const configError = loadConfig();
  const cfg = getConfig();
  createTray();
  if (configError) notify('Duski config', configError);
  execFile(cfg.claudePath, ['--version'], { timeout: 15_000, windowsHide: true }, (err) => {
    if (err) notify('Claude Code not found', `"${cfg.claudePath} --version" failed. Install Claude Code, or run "claude" once to log in.`);
  });
}
```

- [ ] **Step 7: Typecheck and run**

Run: `npm run typecheck`
Expected: no output, exit code 0.

Run: `npm start`
Expected:
1. A blue dot shows in the tray (it can be in the hidden-icons area).
2. `D:\Duski\` has `config.json`, `CLAUDE.md`, `.mcp.json`, `notes\`.
3. Tray menu → **Open agent folder** opens `D:\Duski` in Explorer.
4. Run `npm start` a second time in another terminal. It exits at once, and only one tray icon shows.
5. Put `{` as the only text in `D:\Duski\config.json`, then start again. A "Duski config" balloon shows, and the file still contains `{`. Restore the file (delete it, and Duski creates it again on the next start).
6. Tray → **Quit** closes the app.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json build.mjs .gitignore src
git commit -m "feat: scaffold Duski tray app with config and agent home"
```

---

### Task 2: Pie menu, Claude runner, popup, translate selection

About 1.5 hours.

**Files:**
- Create: `src/main/actions/types.ts`, `src/main/actions/index.ts`, `src/main/actions/translate.ts`, `src/main/actions/translate-selection.ts`
- Create: `src/main/claude.ts`, `src/main/capture.ts`, `src/main/pie.ts`, `src/main/popup.ts`
- Create: `static/style.css`, `static/pie.html`, `static/popup.html`, `src/renderer/pie.ts`, `src/renderer/popup.ts`
- Modify: `src/main/main.ts` (full replacement below)

**Interfaces:**
- Consumes: `getConfig()`, `TEMP_DIR`, `notify()`, `createTray()` from Task 1.
- Produces:
  - `claude.ts`: `type ClaudeEvent`, `interface RunOptions { claudePath; args; prompt; cwd; onEvent }`, `interface ClaudeRun { done: Promise<RunResult>; cancel(): void }`, `interface RunResult { code: number | null; stderr: string; cancelled: boolean }`, `runClaude(o: RunOptions): ClaudeRun`, `lastLines(text: string, n: number): string`.
  - `popup.ts`: `type PopupStatus = 'loading' | 'streaming' | 'done' | 'error'`, `interface PopupHandle { update(status, text): void; closed: Promise<void> }`, `showPopup(anchor: Point): PopupHandle`, `initPopupIpc(): void`.
  - `actions/types.ts`: `Point`, `Rect`, `ActionContext`, `PieAction`.
  - `actions/translate.ts`: `translate(ctx, { prompt, tools, anchor }): Promise<void>`.
  - `pie.ts`: `initPie(actions, onPick)`, `togglePie()`, `hidePie()`.
  - IPC channels: `pie:show`, `pie:clear`, `pie:pick`, `pie:close`, `popup:update`, `popup:close`, `popup:copy`, `popup:resize`.

- [ ] **Step 1: Create `src/main/claude.ts`**

```ts
import { execFile, spawn } from 'node:child_process';

export type ClaudeEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; output: string; isError: boolean }
  | { type: 'result'; text: string; isError: boolean };

export interface RunOptions {
  claudePath: string;
  args: string[];
  prompt: string;
  cwd: string;
  onEvent: (event: ClaudeEvent) => void;
}

export interface RunResult {
  code: number | null;
  stderr: string;
  cancelled: boolean;
}

export interface ClaudeRun {
  done: Promise<RunResult>;
  cancel(): void;
}

const STREAM_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

export function runClaude(o: RunOptions): ClaudeRun {
  const child = spawn(o.claudePath, [...STREAM_ARGS, ...o.args], { cwd: o.cwd, windowsHide: true });
  let stderr = '';
  let pending = '';
  let cancelled = false;
  let exited = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => (stderr += d));
  child.stdout.on('data', (d: string) => {
    pending += d;
    let nl: number;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (line) parseLine(line, o.onEvent);
    }
  });
  child.stdin.on('error', () => {}); // EPIPE when the process fails to start; 'error' below reports it
  child.stdin.end(o.prompt);

  const done = new Promise<RunResult>((resolve) => {
    child.on('error', (err) => {
      exited = true;
      resolve({ code: null, stderr: stderr + err.message, cancelled });
    });
    child.on('close', (code) => {
      exited = true;
      resolve({ code, stderr, cancelled });
    });
  });

  return {
    done,
    cancel() {
      if (cancelled || exited || !child.pid) return;
      cancelled = true;
      // claude starts child processes (Bash tool); kill the whole tree.
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    },
  };
}

function parseLine(line: string, emit: (e: ClaudeEvent) => void): void {
  let m: any;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.parent_tool_use_id) return; // subagent traffic; the parent tool line covers it
  if (m.type === 'system' && m.subtype === 'init') {
    emit({ type: 'session', id: m.session_id });
  } else if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
    emit({ type: 'text', text: m.event.delta.text });
  } else if (m.type === 'assistant') {
    for (const b of m.message?.content ?? []) {
      if (b.type === 'tool_use') emit({ type: 'tool', id: b.id, name: b.name, input: b.input });
    }
  } else if (m.type === 'user') {
    for (const b of m.message?.content ?? []) {
      if (b.type === 'tool_result') emit({ type: 'tool-result', id: b.tool_use_id, output: toolText(b.content), isError: !!b.is_error });
    }
  } else if (m.type === 'result') {
    emit({ type: 'result', text: String(m.result ?? ''), isError: !!m.is_error });
  }
}

function toolText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => (p?.type === 'text' ? p.text : `[${p?.type}]`)).join('\n');
  return '';
}

export function lastLines(text: string, n: number): string {
  return text.trim().split(/\r?\n/).slice(-n).join('\n');
}
```

- [ ] **Step 2: Create the action types, `capture.ts`, and `popup.ts`**

`src/main/actions/types.ts`:
```ts
import type { ClaudeRun, RunOptions } from '../claude';
import type { PopupHandle } from '../popup';

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface ActionContext {
  /** Screen point (DIP) of the cursor when the hotkey was pressed. */
  cursor: Point;
  /** Returns "" when nothing is selected. */
  getSelectedText(): Promise<string>;
  runClaude(o: RunOptions): ClaudeRun;
  showPopup(anchor: Point): PopupHandle;
}

export interface PieAction {
  id: string;
  label: string;
  icon: string;
  run(ctx: ActionContext): Promise<void>;
}
```

`src/main/capture.ts`:
```ts
import { clipboard } from 'electron';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends Ctrl+C to the foreground app and reads the copied text. Restores the old clipboard. */
export async function getSelectedText(): Promise<string> {
  const saved = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
  clipboard.clear();
  try {
    const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
    keyboard.config.autoDelayMs = 10;
    await keyboard.pressKey(Key.LeftControl, Key.C);
    await keyboard.releaseKey(Key.LeftControl, Key.C);
    for (let waited = 0; waited <= 500; waited += 25) {
      const text = clipboard.readText();
      if (text) return text;
      await sleep(25);
    }
    return '';
  } finally {
    // ponytail: only text, HTML, RTF and image survive; other clipboard formats (files, custom) are lost
    const data: Electron.Data = {};
    if (saved.text) data.text = saved.text;
    if (saved.html) data.html = saved.html;
    if (saved.rtf) data.rtf = saved.rtf;
    if (!saved.image.isEmpty()) data.image = saved.image;
    if (Object.keys(data).length) clipboard.write(data);
    else clipboard.clear();
  }
}
```

`src/main/popup.ts`:
```ts
import { BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import path from 'node:path';
import type { Point } from './actions/types';

export type PopupStatus = 'loading' | 'streaming' | 'done' | 'error';

export interface PopupHandle {
  update(status: PopupStatus, text: string): void;
  /** Resolves when the popup window closes (user or replacement). */
  closed: Promise<void>;
}

const WIDTH = 480;
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 400;
let current: BrowserWindow | null = null;

export function initPopupIpc(): void {
  ipcMain.on('popup:close', (e) => BrowserWindow.fromWebContents(e.sender)?.destroy());
  ipcMain.on('popup:copy', (_e, text: string) => clipboard.writeText(text));
  ipcMain.on('popup:resize', (e, height: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const h = clamp(Math.ceil(height), MIN_HEIGHT, MAX_HEIGHT);
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const [x, y] = win.getPosition();
    win.setBounds({ x, y: Math.min(y, wa.y + wa.height - h), width: WIDTH, height: h });
  });
}

/** Opens the translation popup near `anchor`. Only one popup exists; a new one replaces the old one. */
export function showPopup(anchor: Point): PopupHandle {
  current?.destroy();
  const wa = screen.getDisplayNearestPoint(anchor).workArea;
  const height = 120;
  const win = new BrowserWindow({
    x: clamp(Math.round(anchor.x) + 12, wa.x, wa.x + wa.width - WIDTH),
    y: clamp(Math.round(anchor.y) + 12, wa.y, wa.y + wa.height - height),
    width: WIDTH,
    height,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  current = win;

  let state: { status: PopupStatus; text: string } = { status: 'loading', text: '' };
  let ready = false;
  win.webContents.once('did-finish-load', () => {
    ready = true;
    win.webContents.send('popup:update', state);
    win.show();
  });
  void win.loadFile(path.join(__dirname, '..', 'static', 'popup.html'));

  const closed = new Promise<void>((resolve) =>
    win.on('closed', () => {
      if (current === win) current = null;
      resolve();
    }),
  );

  return {
    update(status, text) {
      state = { status, text };
      if (ready && !win.isDestroyed()) win.webContents.send('popup:update', state);
    },
    closed,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
```

- [ ] **Step 3: Create the translate helper and the translate-selection action**

`src/main/actions/translate.ts`:
```ts
import fs from 'node:fs';
import { lastLines } from '../claude';
import { getConfig, TEMP_DIR } from '../config';
import type { ActionContext, Point } from './types';

const SYSTEM_PROMPT =
  'Translate to English. Output only the translation. Keep line breaks. If the text is already English, reply `Already English`.';

let running: { cancel(): void } | null = null;

/** Streams an English translation into a popup at `anchor`. `tools` is "" (none) or "Read". */
export async function translate(ctx: ActionContext, o: { prompt: string; tools: string; anchor: Point }): Promise<void> {
  running?.cancel(); // a new translation replaces a running one
  const cfg = getConfig();
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const popup = ctx.showPopup(o.anchor);
  let text = '';
  let resultError = '';

  const run = ctx.runClaude({
    claudePath: cfg.claudePath,
    cwd: TEMP_DIR,
    prompt: o.prompt,
    args: [
      '--model', cfg.models.translate,
      '--system-prompt', SYSTEM_PROMPT,
      '--tools', o.tools,
      ...(o.tools ? ['--allowedTools', o.tools] : []),
      // Skip user plugins, hooks and MCP servers: measured 7.2 s -> 5.3 s startup.
      '--setting-sources', 'project',
      '--strict-mcp-config',
      '--no-session-persistence',
    ],
    onEvent: (e) => {
      if (e.type === 'text') {
        text += e.text;
        popup.update('streaming', text);
      } else if (e.type === 'result' && e.isError) {
        resultError = e.text;
      }
    },
  });
  running = run;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    run.cancel();
  }, cfg.translateTimeoutSec * 1000);
  void popup.closed.then(() => run.cancel());

  const r = await run.done;
  clearTimeout(timer);
  if (running === run) running = null;

  if (timedOut) popup.update('error', 'Timed out');
  else if (r.cancelled) return;
  else if (resultError) popup.update('error', resultError);
  else if (r.code !== 0) popup.update('error', lastLines(r.stderr, 5) || `claude exited with code ${r.code}`);
  else popup.update('done', text.trim());
}
```

`src/main/actions/translate-selection.ts`:
```ts
import { translate } from './translate';
import type { PieAction } from './types';

export const translateSelection: PieAction = {
  id: 'translate-selection',
  label: 'Translate text',
  icon: '文',
  async run(ctx) {
    const text = (await ctx.getSelectedText()).trim();
    if (!text) {
      ctx.showPopup(ctx.cursor).update('error', 'No text selected');
      return;
    }
    await translate(ctx, { prompt: text, tools: '', anchor: ctx.cursor });
  },
};
```

`src/main/actions/index.ts`:
```ts
import { translateSelection } from './translate-selection';
import type { PieAction } from './types';

/** Pie order = number keys 1..8. Add a feature: create one file in this folder and add it here. */
export const actions: PieAction[] = [translateSelection];
```

- [ ] **Step 4: Create `src/main/pie.ts`**

```ts
import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import path from 'node:path';
import type { PieAction, Point } from './actions/types';

const KEYS = ['Escape', '1', '2', '3', '4', '5', '6', '7', '8'];
let win: BrowserWindow;
let items: PieAction[] = [];
let cursor: Point = { x: 0, y: 0 };
let onPick: (action: PieAction, cursor: Point) => void = () => {};

/** Creates the hidden pie window once. It is reused for every hotkey press (instant open). */
export function initPie(actions: PieAction[], pick: (action: PieAction, cursor: Point) => void): void {
  items = actions.slice(0, 8);
  onPick = pick;
  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    focusable: false, // the foreground app keeps focus and its text selection
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  void win.loadFile(path.join(__dirname, '..', 'static', 'pie.html'));
  ipcMain.on('pie:pick', (_e, id: string) => pickAt(items.findIndex((a) => a.id === id)));
  ipcMain.on('pie:close', () => hidePie());
}

export function togglePie(): void {
  if (win.isVisible()) hidePie();
  else showPie();
}

function showPie(): void {
  cursor = screen.getCursorScreenPoint();
  const { bounds } = screen.getDisplayNearestPoint(cursor);
  win.setBounds(bounds); // covers the display so a click outside the pie closes it
  win.webContents.send('pie:show', {
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y,
    items: items.map(({ id, label, icon }) => ({ id, label, icon })),
  });
  win.showInactive();
  // The pie has no focus, so its keys must be global while it is open.
  KEYS.forEach((key, i) => globalShortcut.register(key, () => (i === 0 ? hidePie() : pickAt(i - 1))));
}

export function hidePie(): void {
  if (!win.isVisible()) return;
  KEYS.forEach((key) => globalShortcut.unregister(key));
  win.webContents.send('pie:clear');
  win.hide();
}

function pickAt(index: number): void {
  const action = items[index];
  if (!action) return;
  hidePie();
  onPick(action, cursor);
}
```

- [ ] **Step 5: Create the static pages, the stylesheet, and the pie/popup renderers**

`static/style.css`:
```css
:root {
  --bg: #16181d;
  --panel: #1f2229;
  --line: #2e323b;
  --text: #e7e9ee;
  --muted: #9aa0ab;
  --accent: #5f7ae0;
  --accent-soft: rgba(95, 122, 224, 0.18);
  --error: #e0605f;
  color-scheme: dark;
  font: 14px/1.5 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6f7f9;
    --panel: #ffffff;
    --line: #dde0e6;
    --text: #1b1d22;
    --muted: #5d6370;
    --accent: #3d5bd0;
    --accent-soft: rgba(61, 91, 208, 0.12);
    --error: #c23b3a;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--text); background: var(--bg); }
button {
  font: inherit; color: var(--text); background: var(--panel);
  border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer;
}
button:hover { border-color: var(--accent); }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* Pie */
body.pie { background: transparent; overflow: hidden; user-select: none; }
body.pie.open { background: rgba(0, 0, 0, 0.12); } /* non-zero alpha so clicks outside the pie reach this window */
.pie svg { display: block; width: 100vw; height: 100vh; }
.wheel { animation: pie-in 0.12s ease-out; }
.slice { cursor: pointer; }
.slice path { fill: var(--panel); stroke: var(--line); stroke-width: 1; transition: fill 0.1s; }
.slice:hover path { fill: var(--accent); }
.slice text { fill: var(--text); pointer-events: none; }
.slice .icon { font-size: 22px; }
.slice .label { font-size: 12px; fill: var(--muted); }
.slice:hover .label { fill: var(--text); }
.hub { fill: var(--bg); stroke: var(--line); }
@keyframes pie-in { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wheel { animation: none; } }

/* Popup */
body.popup { background: var(--panel); border: 1px solid var(--line); overflow: hidden; }
#card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
#bar { display: flex; align-items: center; gap: 6px; -webkit-app-region: drag; }
#bar button { -webkit-app-region: no-drag; padding: 2px 8px; }
#status { flex: 1; color: var(--muted); font-size: 12px; }
#text { white-space: pre-wrap; overflow-y: auto; max-height: 330px; user-select: text; }
[data-status='error'] #text { color: var(--error); }
.spinner {
  display: none; width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid var(--line); border-top-color: var(--accent); animation: spin 0.8s linear infinite;
}
[data-status='loading'] .spinner, [data-status='streaming'] .spinner { display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
```

`static/pie.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
  <title>Duski</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body class="pie">
  <svg id="pie" role="menu" aria-label="Duski actions"></svg>
  <script src="../dist/renderer/pie.js"></script>
</body>
</html>
```

`static/popup.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
  <title>Duski translation</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body class="popup" data-status="loading">
  <div id="card">
    <div id="bar">
      <span class="spinner" aria-hidden="true"></span>
      <span id="status" role="status">Translating…</span>
      <button id="copy">Copy</button>
      <button id="close" aria-label="Close">✕</button>
    </div>
    <div id="text" tabindex="0"></div>
  </div>
  <script src="../dist/renderer/popup.js"></script>
</body>
</html>
```

`src/renderer/pie.ts`:
```ts
type Item = { id: string; label: string; icon: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
const R0 = 44; // inner radius
const R1 = 140; // outer radius
const svg = document.getElementById('pie') as unknown as SVGSVGElement;

window.duski.on('pie:show', ({ x, y, items }: { x: number; y: number; items: Item[] }) => {
  const cx = Math.min(Math.max(x, R1 + 8), innerWidth - R1 - 8);
  const cy = Math.min(Math.max(y, R1 + 8), innerHeight - R1 - 8);
  const wheel = el('g', { class: 'wheel' });
  wheel.style.transformOrigin = `${cx}px ${cy}px`;
  const step = (2 * Math.PI) / items.length;
  items.forEach((item, i) => {
    const mid = -Math.PI / 2 + i * step; // slice 1 at the top, then clockwise
    const g = el('g', { class: 'slice', role: 'menuitem', 'aria-label': item.label });
    g.append(el('path', { d: sector(cx, cy, mid - step / 2 + 0.02, mid + step / 2 - 0.02) }));
    const rm = (R0 + R1) / 2;
    const tx = cx + rm * Math.cos(mid);
    const ty = cy + rm * Math.sin(mid);
    g.append(text(tx, ty - 10, item.icon, 'icon'), text(tx, ty + 16, `${i + 1}  ${item.label}`, 'label'));
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      window.duski.send('pie:pick', item.id);
    });
    wheel.append(g);
  });
  wheel.append(el('circle', { cx, cy, r: R0 - 6, class: 'hub' }));
  svg.replaceChildren(wheel);
  document.body.classList.add('open');
});

window.duski.on('pie:clear', () => {
  svg.replaceChildren();
  document.body.classList.remove('open');
});

document.addEventListener('click', () => window.duski.send('pie:close'));
document.addEventListener('contextmenu', () => window.duski.send('pie:close'));

/** Annular sector between angles a0..a1 (radians). The 0.02 gap keeps a1 - a0 below 2π, so one slice still draws. */
function sector(cx: number, cy: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(R1, a0)} A ${R1} ${R1} 0 ${large} 1 ${p(R1, a1)} L ${p(R0, a1)} A ${R0} ${R0} 0 ${large} 0 ${p(R0, a0)} Z`;
}

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function text(x: number, y: number, content: string, cls: string): SVGElement {
  const t = el('text', { x, y, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
  t.textContent = content;
  return t;
}
```

`src/renderer/popup.ts`:
```ts
type Status = 'loading' | 'streaming' | 'done' | 'error';

const card = document.getElementById('card') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const textEl = document.getElementById('text') as HTMLDivElement;

const LABELS: Record<Status, string> = { loading: 'Translating…', streaming: 'Translating…', done: 'English', error: 'Error' };

window.duski.on('popup:update', ({ status, text }: { status: Status; text: string }) => {
  document.body.dataset.status = status;
  statusEl.textContent = LABELS[status];
  textEl.textContent = text;
  window.duski.send('popup:resize', card.offsetHeight + 2); // +2 for the body border
});

document.getElementById('copy')!.addEventListener('click', () => window.duski.send('popup:copy', textEl.textContent ?? ''));
document.getElementById('close')!.addEventListener('click', () => window.duski.send('popup:close'));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.duski.send('popup:close');
});
```

- [ ] **Step 6: Replace `src/main/main.ts`**

```ts
import { app, globalShortcut } from 'electron';
import { execFile } from 'node:child_process';
import { actions } from './actions';
import type { ActionContext, Point } from './actions/types';
import { getSelectedText } from './capture';
import { runClaude } from './claude';
import { AGENT_HOME, getConfig, loadConfig } from './config';
import { initPie, togglePie } from './pie';
import { initPopupIpc, showPopup } from './popup';
import { createTray, notify } from './tray';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => {
    // Stay alive in the tray.
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  void app.whenReady().then(start);
}

function start(): void {
  const configError = loadConfig();
  const cfg = getConfig();
  createTray();
  if (configError) notify('Duski config', configError);
  execFile(cfg.claudePath, ['--version'], { timeout: 15_000, windowsHide: true }, (err) => {
    if (err) notify('Claude Code not found', `"${cfg.claudePath} --version" failed. Install Claude Code, or run "claude" once to log in.`);
  });

  initPopupIpc();
  initPie(actions, (action, cursor) => {
    action.run(contextAt(cursor)).catch((err: unknown) => {
      showPopup(cursor).update('error', err instanceof Error ? err.message : String(err));
    });
  });
  registerHotkey(cfg.hotkey);
}

function contextAt(cursor: Point): ActionContext {
  return { cursor, getSelectedText, runClaude, showPopup };
}

function registerHotkey(hotkey: string): void {
  let ok = false;
  try {
    ok = globalShortcut.register(hotkey, togglePie);
  } catch {
    ok = false; // malformed accelerator string
  }
  if (!ok) notify('Hotkey not available', `Duski could not register "${hotkey}". Change "hotkey" in ${AGENT_HOME}\\config.json and restart Duski.`);
}
```

- [ ] **Step 7: Typecheck and manual check**

Run: `npm run typecheck`
Expected: exit code 0.

Run: `npm start`. If the console shows `was compiled against a different Node.js version` for `libnut`, run `npx @electron/rebuild` and start again.

Expected:
1. `Ctrl+Shift+Space` in Notepad opens the pie at the cursor with one slice "1 Translate text". Esc closes it. A click outside the pie closes it. The hotkey again also closes it.
2. In Chrome, select the French text `Bonjour tout le monde`. Press the hotkey, then `1`. A popup shows "Translating…", then `Hello everyone`. Notepad or Chrome still has focus while the pie is open.
3. Copy in the popup puts the translation on the clipboard. Esc and ✕ close the popup.
4. Select English text and translate: the popup shows `Already English`.
5. Click empty space in Notepad (nothing selected) and translate: "No text selected".
6. **Review Focus 2:** copy an image (Win+Shift+S) and translate selected text. Then paste in Paint: the old image is still on the clipboard.
7. **Review Focus 1:** open PowerShell as administrator, select text, and translate: "No text selected" after about 0.5 s. No hang.
8. **Review Focus 5:** start a translation, and start a second one before the first ends. The first popup closes. Task Manager shows only one `claude.exe`.
9. Set `"claudePath": "claude-missing"` in config and restart: a "Claude Code not found" balloon, and a translation shows an error in the popup. Restore `"claude"`.
10. Set `"hotkey": "Nonsense+Q"` and restart: a "Hotkey not available" balloon. Restore `"Ctrl+Shift+Space"`.

- [ ] **Step 8: Commit**

```bash
git add src static
git commit -m "feat: pie menu, claude runner, and translate-selection popup"
```

---

### Task 3: Translate region

About 1 hour.

**Files:**
- Create: `src/main/region.ts`, `src/main/actions/translate-region.ts`, `static/region.html`, `src/renderer/region.ts`
- Modify: `src/main/actions/types.ts` (add `RegionImage` and `selectRegion`), `src/main/actions/index.ts`, `src/main/main.ts` (`contextAt`), `static/style.css` (append)

**Interfaces:**
- Consumes: `translate()` from Task 2, `TEMP_DIR` from Task 1, `Rect` and `Point` from `actions/types.ts`.
- Produces: `interface RegionImage { path: string; rect: Rect }` (rect in screen DIP), `selectRegion(): Promise<RegionImage | null>`. IPC: `region:init` (main → renderer, PNG data URL), `region:done` (renderer → main, `Rect | null` in window CSS px).

- [ ] **Step 1: Extend `src/main/actions/types.ts`**

Add after `interface Rect`:
```ts
export interface RegionImage {
  /** PNG file in TEMP_DIR. The caller deletes it. */
  path: string;
  /** Selected box in screen DIP. */
  rect: Rect;
}
```

Add to `interface ActionContext`, after `getSelectedText`:
```ts
  /** Lets the user drag a box on screen. Returns null when cancelled. */
  selectRegion(): Promise<RegionImage | null>;
```

- [ ] **Step 2: Create `src/main/region.ts`**

```ts
import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Rect, RegionImage } from './actions/types';
import { TEMP_DIR } from './config';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function selectRegion(): Promise<RegionImage | null> {
  await sleep(100); // let the hidden pie leave the screen before the capture
  const displays = screen.getAllDisplays();
  const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)));
  const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
  const shots = displays.map((d, i) => ({ d, img: (sources.find((s) => s.display_id === String(d.id)) ?? sources[i]).thumbnail }));
  const cursor = screen.getCursorScreenPoint();

  return new Promise((resolve) => {
    let finished = false;
    const wins = shots.map(({ d, img }) => {
      const w = new BrowserWindow({
        ...d.bounds,
        frame: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        enableLargerThanScreen: true,
        show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
      });
      w.setAlwaysOnTop(true, 'screen-saver');
      w.webContents.once('did-finish-load', () => {
        w.webContents.send('region:init', img.toDataURL());
        w.setBounds(d.bounds);
        w.show();
        if (screen.getDisplayNearestPoint(cursor).id === d.id) w.focus(); // Esc goes to this window
      });
      w.on('closed', () => finish(null, -1)); // Alt+F4 counts as cancel
      void w.loadFile(path.join(__dirname, '..', 'static', 'region.html'));
      return w;
    });

    const onDone = (e: Electron.IpcMainEvent, rect: Rect | null) => finish(rect, wins.findIndex((w) => w.webContents === e.sender));
    ipcMain.on('region:done', onDone);

    function finish(rect: Rect | null, index: number): void {
      if (finished) return;
      finished = true;
      ipcMain.removeListener('region:done', onDone);
      wins.forEach((w) => w.isDestroyed() || w.destroy());
      if (!rect || index < 0 || rect.width < 5 || rect.height < 5) return resolve(null);

      // The thumbnail can differ from bounds * scaleFactor; scale by its real size.
      const { d, img } = shots[index];
      const size = img.getSize();
      const sx = size.width / d.bounds.width;
      const sy = size.height / d.bounds.height;
      const crop = img.crop({
        x: Math.round(rect.x * sx),
        y: Math.round(rect.y * sy),
        width: Math.round(rect.width * sx),
        height: Math.round(rect.height * sy),
      });
      fs.mkdirSync(TEMP_DIR, { recursive: true });
      const file = path.join(TEMP_DIR, `region-${Date.now()}.png`);
      fs.writeFileSync(file, crop.toPNG());
      resolve({ path: file, rect: { x: d.bounds.x + rect.x, y: d.bounds.y + rect.y, width: rect.width, height: rect.height } });
    }
  });
}
```

- [ ] **Step 3: Create the region page and renderer; append CSS**

`static/region.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src data:; style-src 'self' 'unsafe-inline'" />
  <title>Duski region</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body class="region">
  <img id="shot" alt="" />
  <div id="box" hidden></div>
  <script src="../dist/renderer/region.js"></script>
</body>
</html>
```

`src/renderer/region.ts`:
```ts
const shot = document.getElementById('shot') as HTMLImageElement;
const box = document.getElementById('box') as HTMLDivElement;
let start: { x: number; y: number } | null = null;
let rect = { x: 0, y: 0, width: 0, height: 0 };

window.duski.on('region:init', (dataUrl: string) => {
  shot.src = dataUrl;
});

addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  box.hidden = false;
  document.body.classList.add('dragging');
  update(e);
});
addEventListener('mousemove', (e) => update(e));
addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !start) return;
  update(e);
  start = null;
  window.duski.send('region:done', rect);
});
addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.duski.send('region:done', null);
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.duski.send('region:done', null);
});

function update(e: MouseEvent): void {
  if (!start) return;
  rect = {
    x: Math.min(start.x, e.clientX),
    y: Math.min(start.y, e.clientY),
    width: Math.abs(e.clientX - start.x),
    height: Math.abs(e.clientY - start.y),
  };
  Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}
```

Append to `static/style.css`:
```css
/* Region */
body.region { background: #000; overflow: hidden; cursor: crosshair; user-select: none; }
#shot { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
body.region::after { content: ''; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); pointer-events: none; }
body.region.dragging::after { display: none; }
#box { position: fixed; outline: 1px solid #fff; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45); pointer-events: none; }
```

- [ ] **Step 4: Create the action and register it**

`src/main/actions/translate-region.ts`:
```ts
import fs from 'node:fs';
import { translate } from './translate';
import type { PieAction } from './types';

export const translateRegion: PieAction = {
  id: 'translate-region',
  label: 'Translate area',
  icon: '⛶',
  async run(ctx) {
    const region = await ctx.selectRegion();
    if (!region) return;
    try {
      const { x, y, width, height } = region.rect;
      await translate(ctx, {
        prompt: `Read the image file ${region.path} and translate all text in it.`,
        tools: 'Read',
        anchor: { x: x + width, y: y + height }, // popup at the bottom-right corner of the box
      });
    } finally {
      fs.rmSync(region.path, { force: true });
    }
  },
};
```

`src/main/actions/index.ts` — replace the list:
```ts
import { translateRegion } from './translate-region';
import { translateSelection } from './translate-selection';
import type { PieAction } from './types';

/** Pie order = number keys 1..8. Add a feature: create one file in this folder and add it here. */
export const actions: PieAction[] = [translateSelection, translateRegion];
```

`src/main/main.ts` — add the import and extend `contextAt`:
```ts
import { selectRegion } from './region';
```
```ts
function contextAt(cursor: Point): ActionContext {
  return { cursor, getSelectedText, selectRegion, runClaude, showPopup };
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 6: Manual check**

Run: `npm start`. Open a web page in Japanese or French.

Expected:
1. Hotkey → `2`: the screen freezes and dims. The cursor is a crosshair.
2. Drag a box around one paragraph. The box area is bright while you drag. On release, the popup shows at the box's bottom-right corner with the English text.
3. Esc cancels with no popup. A right-click cancels with no popup.
4. After each case, `%TEMP%\duski\` has no `region-*.png` file.
5. **Review Focus 3:** with two monitors, set one to 100% and one to 150% scaling (Settings → Display). Drag a tight box around one word on each monitor. Add a temporary `console.log(file)` before `resolve(...)` in `region.ts` and a temporary skip of the `fs.rmSync` line, open the PNG, and confirm it shows exactly the dragged area. Remove both temporary lines.

- [ ] **Step 7: Commit**

```bash
git add src static
git commit -m "feat: translate a dragged screen region"
```

---

### Task 4: Agent chat

About 1.5 hours.

**Files:**
- Create: `src/shared/chat-events.ts`, `src/main/chat.ts`, `src/main/actions/chat.ts`, `static/chat.html`, `src/renderer/chat.ts`
- Modify: `src/main/actions/types.ts` (add `openChat`), `src/main/actions/index.ts`, `src/main/main.ts`, `static/style.css` (append)

**Interfaces:**
- Consumes: `runClaude`, `lastLines`, `ClaudeRun` (Task 2); `AGENT_HOME`, `getConfig`, `saveChatBounds` (Task 1); `createTray(extra)` (Task 1).
- Produces: `type ChatEvent` (shared), `openChat(): void`, `initChatIpc(): void`. IPC: `chat:ready`, `chat:replay` (events, busy), `chat:event`, `chat:send` (text), `chat:stop`, `chat:new`, `chat:pin` (boolean).

- [ ] **Step 1: Create `src/shared/chat-events.ts`**

```ts
/** Messages from main to the chat window. Main keeps the list, so a reopened window can replay it. */
export type ChatEvent =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; summary: string; name: string; input: string }
  | { kind: 'tool-result'; id: string; output: string; isError: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'done' };
```

- [ ] **Step 2: Create `src/main/chat.ts`**

```ts
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
```

- [ ] **Step 3: Create the chat page and renderer; append CSS**

`static/chat.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'" />
  <title>Duski Chat</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body class="chat">
  <header>
    <button id="pin" aria-pressed="false" title="Keep on top">Pin</button>
    <span class="spacer"></span>
    <button id="new">New chat</button>
  </header>
  <main id="log" aria-live="polite"></main>
  <footer>
    <textarea id="input" rows="2" aria-label="Message" placeholder="Message Duski (Enter to send, Shift+Enter for a new line)"></textarea>
    <button id="send">Send</button>
  </footer>
  <script src="../dist/renderer/chat.js"></script>
</body>
</html>
```

`src/renderer/chat.ts`:
```ts
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
```

Append to `static/style.css`:
```css
/* Chat */
body.chat { display: flex; flex-direction: column; height: 100vh; }
body.chat header, body.chat footer { display: flex; gap: 6px; padding: 8px; border-color: var(--line); border-style: solid; border-width: 0; }
body.chat header { border-bottom-width: 1px; }
body.chat footer { border-top-width: 1px; }
.spacer { flex: 1; }
#pin[aria-pressed='true'] { background: var(--accent-soft); border-color: var(--accent); }
#log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.msg { overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; max-width: 85%; background: var(--accent-soft); padding: 6px 10px; border-radius: 8px; white-space: pre-wrap; }
.msg.error { color: var(--error); }
.msg.assistant > :first-child { margin-top: 0; }
.msg.assistant > :last-child { margin-bottom: 0; }
.msg.assistant pre { background: var(--panel); padding: 8px; border-radius: 6px; overflow-x: auto; }
.msg.assistant code, .tool pre { font-family: 'Cascadia Code', Consolas, monospace; font-size: 13px; }
.msg.assistant a { color: var(--accent); }
.tool { font-size: 12px; color: var(--muted); border-left: 2px solid var(--line); padding-left: 8px; }
.tool.error { border-color: var(--error); }
.tool summary { cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tool pre { white-space: pre-wrap; max-height: 240px; overflow: auto; margin: 4px 0; }
textarea {
  flex: 1; resize: none; font: inherit; color: var(--text); background: var(--panel);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px;
}
```

- [ ] **Step 4: Create the chat action; add `openChat` to the context**

`src/main/actions/chat.ts`:
```ts
import type { PieAction } from './types';

export const chat: PieAction = {
  id: 'chat',
  label: 'Chat',
  icon: '💬',
  async run(ctx) {
    ctx.openChat();
  },
};
```

`src/main/actions/types.ts` — add to `interface ActionContext`, after `showPopup`:
```ts
  openChat(): void;
```

`src/main/actions/index.ts` — replace the list:
```ts
import { chat } from './chat';
import { translateRegion } from './translate-region';
import { translateSelection } from './translate-selection';
import type { PieAction } from './types';

/** Pie order = number keys 1..8. Add a feature: create one file in this folder and add it here. */
export const actions: PieAction[] = [chat, translateSelection, translateRegion];
```

- [ ] **Step 5: Wire chat into `src/main/main.ts`**

Add the import:
```ts
import { initChatIpc, openChat } from './chat';
```

In `start()`, replace `createTray();` with:
```ts
  createTray([{ label: 'Open chat', click: openChat }, { type: 'separator' }]);
```

In `start()`, add after `initPopupIpc();`:
```ts
  initChatIpc();
```

Replace `contextAt`:
```ts
function contextAt(cursor: Point): ActionContext {
  return { cursor, getSelectedText, selectRegion, runClaude, showPopup, openChat };
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 7: Manual check — chat basics**

Run: `npm start`.

Expected:
1. The pie shows 3 slices: `1 Chat`, `2 Translate text`, `3 Translate area`. Key `1` opens "Duski Chat" with focus in the input.
2. Send `list the files in notes`. A collapsed line `Bash: …` or `Glob: …` shows. Click it to expand the input and output. The reply renders as markdown.
3. Send `reply with a markdown table and a code block`. Both render correctly.
4. Close the chat window. Open it from the tray (**Open chat**). The old messages show. Send `what did I ask first?`: the reply names the first question.
5. **New chat** clears the log. `what did I ask first?` now gets "no earlier question".
6. Pin keeps the window above other windows. Pin again turns it off.
7. Move and resize the window, close it, and quit Duski. `D:\Duski\config.json` has the new `chatWindow` values. Start Duski and open chat: same place and size.

- [ ] **Step 8: Manual check — Review Focus 4 (Stop)**

1. Send `run the command: ping -t localhost`.
2. When the tool line shows, click **Stop**.
3. Expected: "Stopped." shows, the input unlocks, and Task Manager shows no `claude.exe` and no `PING.EXE`.

- [ ] **Step 9: Commit**

```bash
git add src static
git commit -m "feat: agent chat window with tools, resume, and stop"
```

---

### Task 5: Full manual checklist and RAM measurement

About 30 minutes.

**Files:**
- Create: `.scratch/duski-radial-menu/manual-test.md`
- Modify: `.scratch/duski-radial-menu/spec.md` (the `Status:` line)

- [ ] **Step 1: Run the 13-item checklist from the spec**

Run: `npm start`. Do each item in `spec.md` → "Manual test checklist". Record each result in `.scratch/duski-radial-menu/manual-test.md`:

```markdown
# Duski v1 manual test — <date>

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Tray + agent home | pass/fail | |
| 2 | Hotkey in Chrome, Notepad, borderless game | | |
| 3 | Pie keys and clicks | | |
| 4 | Chat tool line + markdown | | |
| 5 | Chat resume + New chat | | |
| 6 | Stop leaves no process | | |
| 7 | Translate selection, clipboard restored | | |
| 8 | No text selected | | |
| 9 | Region at 100% / 150% | | |
| 10 | Region cancel, no leftover PNG | | |
| 11 | Popup Copy / Esc / X | | |
| 12 | Idle RAM | ___ MB | |
| 13 | Wrong claudePath error | | |
```

- [ ] **Step 2: Measure idle RAM (item 12)**

1. Start Duski. Open and close the pie, a translation popup, and the chat once.
2. Wait 1 minute.
3. Task Manager → Details. Add the "Memory (private working set)" column. Add the values of all `electron.exe` processes.
4. Record the total. Target: 70–100 MB. If it is above 100 MB, note which process is largest. Do not fix it in this task.

- [ ] **Step 3: Mark the spec and commit**

In `spec.md`, change the status line to:
```
Status: v1 implemented 2026-MM-DD, manual test in manual-test.md
```

```bash
git add .scratch/duski-radial-menu
git commit -m "docs: record Duski v1 manual test results"
```
