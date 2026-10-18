import { app, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveClaudePath } from './claude';

// The agent folder is picked from the tray. Its path lives outside it, in Electron's userData folder.
const HOME_FILE = path.join(app.getPath('userData'), 'agent-home.txt');
const LEGACY_HOME = 'D:\\Duski'; // the fixed folder of Duski 0.1; kept so an old install finds its files

/** The saved agent folder, if its drive is still there. Else D:\Duski if it exists, else %USERPROFILE%\Duski. */
function resolveHome(): string {
  try {
    const saved = fs.readFileSync(HOME_FILE, 'utf8').trim();
    if (path.isAbsolute(saved) && fs.existsSync(path.parse(saved).root)) return saved;
  } catch {
    // no saved folder yet
  }
  return fs.existsSync(LEGACY_HOME) ? LEGACY_HOME : path.join(os.homedir(), 'Duski');
}

export const AGENT_HOME = resolveHome();
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
  models: { chat: string; translate: string; translateArea: string };
  translateTimeoutSec: number;
  chatWindow: WindowBounds;
  todoWindow: WindowBounds;
}

export const DEFAULTS: Config = {
  hotkey: 'Ctrl+Shift+Space',
  claudePath: 'claude',
  models: { chat: 'sonnet', translate: 'sonnet', translateArea: 'sonnet' }, // translateArea needs exact text boxes for the overlay: Haiku's are too loose
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
      claudePath: resolveClaudePath(pick(raw.claudePath, DEFAULTS.claudePath)), // in memory only; config.json keeps what the user wrote
      models: {
        chat: pick(raw.models?.chat, DEFAULTS.models.chat),
        translate: pick(raw.models?.translate, DEFAULTS.models.translate),
        translateArea: pick(raw.models?.translateArea, DEFAULTS.models.translateArea),
      },
      translateTimeoutSec: Math.max(5, pick(raw.translateTimeoutSec, DEFAULTS.translateTimeoutSec)),
      chatWindow: { ...DEFAULTS.chatWindow, ...raw.chatWindow },
      todoWindow: { ...DEFAULTS.todoWindow, ...raw.todoWindow },
    };
    writable = true;
    return null;
  } catch (err) {
    current = { ...DEFAULTS, claudePath: resolveClaudePath(DEFAULTS.claudePath) };
    writable = false;
    return `config.json is not valid (${(err as Error).message}). Using defaults.`;
  }
}

/** The uninstaller (also run by every update) deletes the whole install folder, so an agent folder inside it is lost. */
function inInstallFolder(dir: string): boolean {
  if (!app.isPackaged) return false;
  const rel = path.relative(path.dirname(app.getPath('exe')), dir); // win32 compares case-insensitively
  return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** A warning for startup when the agent folder is inside the install folder, else null. */
export function agentHomeWarning(): string | null {
  return inInstallFolder(AGENT_HOME)
    ? `Your agent folder ${AGENT_HOME} is inside the Duski install folder. The next update or uninstall deletes it. Click here to move it.`
    : null;
}

/**
 * Tray "Change agent folder…": picks a folder, optionally copies the current files into it, then restarts Duski.
 * Copy, not move: the old folder stays as it is, and files that already exist in the new folder are kept.
 */
export async function changeAgentHome(): Promise<void> {
  const pick = await dialog.showOpenDialog({ title: 'Choose the Duski agent folder', defaultPath: AGENT_HOME, properties: ['openDirectory', 'createDirectory'] });
  const dir = pick.filePaths[0];
  if (pick.canceled || !dir || path.resolve(dir).toLowerCase() === path.resolve(AGENT_HOME).toLowerCase()) return;
  if (inInstallFolder(dir)) {
    return void dialog.showErrorBox('Duski', `${dir} is inside the Duski install folder. An update or uninstall deletes that folder. Choose a folder outside ${path.dirname(app.getPath('exe'))}.`);
  }
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Duski',
    message: `Use ${dir} as the agent folder?`,
    detail: `Duski restarts to use it. Copy your config, CLAUDE.md, todo.md, and notes from ${AGENT_HOME}? The old folder is not changed.`,
    buttons: ['Copy files and restart', 'Start empty and restart', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 2) return;
  try {
    if (response === 0) fs.cpSync(AGENT_HOME, dir, { recursive: true, force: false });
    fs.mkdirSync(path.dirname(HOME_FILE), { recursive: true });
    fs.writeFileSync(HOME_FILE, dir);
  } catch (err) {
    // e.g. the new folder is inside the old one; nothing is saved, so Duski keeps the old folder
    return void dialog.showErrorBox('Duski', `Could not change the agent folder: ${(err as Error).message}`);
  }
  app.relaunch();
  app.quit();
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
