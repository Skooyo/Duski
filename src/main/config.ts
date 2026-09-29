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
  todoWindow: WindowBounds;
}

export const DEFAULTS: Config = {
  hotkey: 'Ctrl+Shift+Space',
  claudePath: 'claude',
  models: { chat: 'sonnet', translate: 'sonnet' },
  translateTimeoutSec: 60,
  chatWindow: { x: null, y: null, width: 480, height: 640 },
  todoWindow: { x: null, y: null, width: 440, height: 560 },
};

const STARTER_CLAUDE_MD = `# Duski agent

You are Duski, a desktop assistant for one user on Windows 11.

- Save notes as markdown files in \`notes/\`.
- Todos and reminders live in \`todo.md\`, one per line: \`- [ ] Text @YYYY-MM-DD HH:MM\` (the time is optional).
  Check one off as \`- [x] Text done:YYYY-MM-DD HH:MM\` with the current time. Duski shows a reminder when the time passes.
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
  writeIfMissing(path.join(AGENT_HOME, 'todo.md'), '# Todo\n\n');
  writeIfMissing(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n');
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('top level must be an object');
    const pick = <T>(value: unknown, fallback: T): T => (typeof value === typeof fallback ? (value as T) : fallback);
    current = {
      hotkey: pick(raw.hotkey, DEFAULTS.hotkey),
      claudePath: pick(raw.claudePath, DEFAULTS.claudePath),
      models: { chat: pick(raw.models?.chat, DEFAULTS.models.chat), translate: pick(raw.models?.translate, DEFAULTS.models.translate) },
      translateTimeoutSec: Math.max(5, pick(raw.translateTimeoutSec, DEFAULTS.translateTimeoutSec)),
      chatWindow: { ...DEFAULTS.chatWindow, ...raw.chatWindow },
      todoWindow: { ...DEFAULTS.todoWindow, ...raw.todoWindow },
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

export function saveBounds(key: 'chatWindow' | 'todoWindow', bounds: WindowBounds): void {
  current = { ...current, [key]: bounds };
  // Never overwrite a file the user broke; they would lose their edits.
  if (!writable) return;
  // Reread the file and change only this key: the user may have edited other settings while Duski runs.
  // A file that is invalid now throws here, so it is not overwritten either.
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  raw[key] = bounds;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n');
}
