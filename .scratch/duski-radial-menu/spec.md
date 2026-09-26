# Duski v1: radial menu, agent chat, translation

Status: v1 implemented 2026-09-27, manual test in manual-test.md

## Goal

Duski is a Windows 11 overlay for one user. A global hotkey opens a radial pie menu at the cursor. The pie is the main interface, and new features plug into it. v1 ships three pie actions:

1. **Chat**: an agent chat that uses Claude Code with full tools.
2. **Translate selection**: translates the highlighted text to English.
3. **Translate region**: translates the text in a screen box that you drag (as in Lightshot).

## Decisions

| Topic | Decision |
|---|---|
| Stack | Electron + TypeScript. Plain TS or Preact in renderers (no React). |
| AI backend | `claude -p` (Claude Code CLI) with the user's subscription login. No API key. |
| Agent tools | Full, Bash included (`--dangerously-skip-permissions`) for chat. |
| Agent home | `D:\Duski\` holds `CLAUDE.md`, `.mcp.json`, `notes\`, `config.json`. Separate from the source in `D:\Projects\Duski`. |
| Translation target | Always English. |
| Translation output | A popup next to the source. |
| Testing | Manual checklist only (no unit tests, no e2e) in v1. |

Future integrations (Obsidian vault, Notion MCP, markdown reminders) are config in `D:\Duski\` (`CLAUDE.md` rules, `.mcp.json`, `--add-dir`). They need no Duski code.

## Architecture

```
Electron main process (always on, tray icon)
├── hotkey.ts      global hotkey → show pie at cursor
├── windows.ts     creates and destroys windows
├── claude.ts      starts `claude -p` in D:\Duski, parses stream-json
├── capture.ts     selected text (Ctrl+C trick) + screen region → PNG
├── config.ts      loads D:\Duski\config.json, creates agent home on first start
└── actions/       one file per pie item
    ├── index.ts   ordered list of actions
    ├── chat.ts
    ├── translate-selection.ts
    └── translate-region.ts

Renderer windows
├── pie          created hidden at startup, reused
├── chat         created on use, destroyed on close
├── region box   created on use, one full-screen window per monitor, destroyed after the drag
└── popup        created on use, destroyed on close
```

### RAM budget

- Target: 70–100 MB idle (measure after the first build).
- Only the tray, the main process, and the hidden pie window stay alive when idle.
- Chat, region, and popup windows are destroyed on close.
- The GPU process stays on (the pie animations need it).
- Each `claude -p` process (about 150–300 MB) exits after each reply.

## Pie menu

1. The hotkey (default `Ctrl+Shift+Space`, set in config) shows the pie centered on the cursor, clamped to the screen.
2. A click on a slice, or its number key (1–8), runs the action. Esc or a click outside closes the pie.
3. The pie window is `focusable: false`. The foreground app keeps focus and its text selection.
4. While the pie is open, Duski registers Esc and 1–8 as global shortcuts. It unregisters them when the pie closes.
5. Maximum 8 slices. The pie draws with SVG and CSS.

### Extension point

A new feature is one file in `actions/` plus one line in `actions/index.ts`. The actions compile into the app. There is no dynamic plugin loading.

```ts
interface PieAction {
  id: string;
  label: string;
  icon: string;
  run(ctx: ActionContext): Promise<void>;
}

interface ActionContext {
  cursor: { x: number; y: number };        // screen point at hotkey time
  getSelectedText(): Promise<string>;       // "" when nothing is selected
  selectRegion(): Promise<RegionImage | null>; // null when cancelled
  claude: ClaudeRunner;
  showPopup(opts: PopupOptions): PopupHandle;
  openChat(): void;
}
```

## Claude runner (`claude.ts`)

- Starts `claude -p` with `cwd = D:\Duski` (`agentHome`) and the path from config (`claudePath`, default `claude`).
- Always uses `--output-format stream-json --verbose --include-partial-messages`.
- Writes the prompt to stdin, never to argv (Windows quoting and length limits).
- Parses each stdout line as JSON. It emits text deltas, tool-use events, the `session_id` from the init event, and the final result.
- Cancel kills the process tree with `taskkill /PID <pid> /T /F`.
- A non-zero exit reports the last 5 lines of stderr.

## Chat

- A normal resizable window. It opens at its saved position and size (`chatWindow` in config) and saves them on close.
- A pin button toggles always-on-top.
- Closing the window destroys it. The `session_id` stays in the main process, so the conversation continues on the next open.
- The first message starts a session and stores its `session_id`. Later messages add `--resume <session_id>`.
- **New chat** clears the stored `session_id`.
- Flags: `--dangerously-skip-permissions --model <models.chat>`.
- Replies render as markdown with `marked` and sanitize with `DOMPurify`.
- Each tool call is one collapsed line (for example `Bash: dir D:\Duski\notes`), expandable to show input and output.
- Enter sends. Shift+Enter adds a new line. The input is locked while a reply streams. A **Stop** button cancels the reply.
- Sessions are also saved by Claude Code, so `claude --resume` in `D:\Duski` continues a Duski chat.

## Translation

### Translate selection

1. The pie hides. The foreground app still has focus.
2. Save the clipboard (text, HTML, RTF, image). Clear it.
3. Send Ctrl+C with `@nut-tree-fork/nut-js`.
4. Check the clipboard for text every 25 ms, for a maximum of 500 ms.
5. Restore the saved clipboard in a `finally` block. Formats other than text, HTML, RTF, and image are lost (`ponytail:` known limit).
6. If no text arrives, the popup shows "No text selected".

### Translate region

1. Capture each monitor at native resolution with `desktopCapturer`.
2. Open one full-screen overlay per monitor. It shows the frozen, dimmed screenshot.
3. Drag a box. Esc or a right-click cancels. Release confirms.
4. Crop at physical pixels (use the monitor scale factor). Save to `%TEMP%\duski\region-<timestamp>.png`.
5. Delete the PNG after the Claude call ends (success, error, or cancel).
6. v1 limit: the box stays on one monitor.

### Claude call (both modes)

- `--model <models.translate>` (default `sonnet`; Haiku was too weak for Japanese).
- `--system-prompt`: "Translate to English. Output only the translation. Keep line breaks. If the text is already English, reply `Already English`."
- Selection mode: no tools. The text goes to stdin.
- Region mode: only the `Read` tool. The stdin prompt names the PNG path.
- Timeout: `translateTimeoutSec` (default 60). On timeout, cancel and show "Timed out".
- A new translation cancels a running one.

### Popup

- Position: next to the cursor (selection mode), or at the bottom-right corner of the box (region mode). Clamped to the screen.
- Shows a spinner, then the streamed translation.
- Maximum width 480 px. Long text scrolls.
- **Copy** and **X** buttons. Esc closes it.
- It does not close on blur.

## Config: `D:\Duski\config.json`

```json
{
  "hotkey": "Ctrl+Shift+Space",
  "claudePath": "claude",
  "models": { "chat": "sonnet", "translate": "sonnet" },
  "translateTimeoutSec": 60,
  "chatWindow": { "x": null, "y": null, "width": 480, "height": 640 }
}
```

- On first start, Duski creates `D:\Duski\` with `config.json` (defaults), a starter `CLAUDE.md`, an empty `.mcp.json` (`{"mcpServers": {}}`), and `notes\`.
- Missing keys use defaults.
- Invalid JSON: use defaults, show a tray notification, and do not overwrite the file.

## Errors

| Case | Behavior |
|---|---|
| `claude --version` fails at startup | Tray notification: install Claude Code or run `claude` once to log in. |
| `claude` exits non-zero | Popup or chat shows the last 5 lines of stderr. |
| Translation timeout | Cancel the process, show "Timed out". |
| Hotkey registration fails | Tray notification: change `hotkey` in config. |
| Second Duski instance | `app.requestSingleInstanceLock()`; the second instance exits. |

## Tray menu

- Open chat
- Open agent folder (`D:\Duski`)
- Quit

## Manual test checklist

1. `npm start`: the tray icon shows. `D:\Duski\` exists with all 4 items.
2. The hotkey opens the pie at the cursor in Chrome, Notepad, and a borderless-window game. Esc closes it.
3. Pie keys 1–3 and clicks run the correct action.
4. Chat: send "list the files in notes". A tool line shows, and the reply renders as markdown.
5. Chat: close and reopen the window. The next message remembers the conversation. **New chat** forgets it.
6. Chat: **Stop** during a reply ends it. No `claude` process stays in Task Manager.
7. Translate selection in Chrome and Notepad: the popup shows English. The old clipboard content is back.
8. Translate selection with nothing selected: "No text selected".
9. Translate region on each monitor, at 100% and 150% scaling: the box matches what you dragged, and the translation is correct.
10. Region: Esc and right-click cancel with no popup. `%TEMP%\duski\` has no leftover PNG.
11. Popup: Copy puts the text on the clipboard. Esc and X close it.
12. Idle RAM in Task Manager (all Duski processes): record the number.
13. Set `claudePath` to a wrong path: the error shows in the popup and chat.

## Not in v1

- Installer (`electron-builder`) and start with Windows. v1 runs with `npm start`.
- Chat history list, file drop into chat, and automatic selection-to-chat.
- Region box across two monitors.
- Automated tests.
