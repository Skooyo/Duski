# Duski Todo: reminders in the pie

Status: implemented 2026-09-28, manual test pending

## Goal

A "Todo" pie action. Write short reminders, see what to do, check them off. A todo can have an optional time. When the time passes and the todo is still open, Duski shows a Windows toast. Todos persist between sessions.

## Decisions

| Topic | Decision |
|---|---|
| Storage | One markdown file: `D:\Duski\todo.md`. The chat agent and the user can read and edit it. |
| Line format | `- [ ] Text @YYYY-MM-DD HH:MM` (due, optional). Checked: `- [x] Text done:YYYY-MM-DD HH:MM`. Tags are optional and sit at the end of the line. A line without tags is a todo with no time. Lines that are not checklist items are kept as they are. |
| UI | Notebook window (like chat): resizable, Pin, remembers its position (`todoWindow` in config.json). Opened from the pie, the tray, or a toast. Redesigned 2026-09-28 from a quick popup; the popup felt too rigid. |
| Content | The whole `todo.md`, one block per line: to-dos, headings (`#`–`###`), plain lines. `[] ` or `- [ ] ` makes a to-do, `# ` a heading. Enter splits, Backspace at the start converts then joins, multi-line paste makes blocks. |
| Reminder input | Type `@` in a to-do, or click the clock (hover) or the reminder chip: In 1 hour, Tonight 8 PM (before 20:00 only), Tomorrow 9 AM, Pick a date and time, Remove reminder. |
| Check off | Checkbox. Writes `- [x]` and `done:<now>`. |
| Checked todos | Stay in the notebook, struck through, for 24 h after `done:`. Then hidden, but always kept in the file. Uncheck = undo (removes `done:`). |
| Saving | Whole file, 400 ms after the last edit, with the version it was based on. If the file changed since (chat agent, hand edit), the outside change wins and the notebook reloads. |
| Overdue | Open todo with a past time shows a red "Overdue" chip. |
| Reminder | One Windows toast (Electron `Notification`) when the time passes. Click opens the notebook. No repeat, no snooze. |
| Startup | One summary toast ("N overdue todos") if any open todo is overdue. No per-todo toasts at startup. No state file. |
| Live updates | Duski watches `todo.md`. Edits from the chat agent or by hand reschedule reminders without a restart. A time moved to the future gets a new toast. |

## Out of scope

- Repeating reminders, snooze, toast buttons.
- Recurring todos.
- Obsidian Tasks compatibility.

## Notes

- The starter `CLAUDE.md` teaches the chat agent the `todo.md` format. `D:\Duski\CLAUDE.md` got the same rule on 2026-09-28.
