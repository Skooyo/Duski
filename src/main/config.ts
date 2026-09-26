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
    const pick = <T>(value: unknown, fallback: T): T => (typeof value === typeof fallback ? (value as T) : fallback);
    current = {
      hotkey: pick(raw.hotkey, DEFAULTS.hotkey),
      claudePath: pick(raw.claudePath, DEFAULTS.claudePath),
      models: { chat: pick(raw.models?.chat, DEFAULTS.models.chat), translate: pick(raw.models?.translate, DEFAULTS.models.translate) },
      translateTimeoutSec: Math.max(5, pick(raw.translateTimeoutSec, DEFAULTS.translateTimeoutSec)),
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
