# Duski v1 manual test — 2026-09-27

User tested the short list (hotkey/pie, translate text, translate area, chat). Items not in that list are marked "not run".

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Tray + agent home | pass | Verified by lead: `D:\Duski\` created with all 4 items |
| 2 | Hotkey opens pie, Esc closes | pass | User, Notepad |
| 3 | Pie keys and clicks | pass | User |
| 4 | Chat tool line + markdown | pass | User; runner also tested against real CLI |
| 5 | Chat resume after reopen | pass | User |
| 6 | Stop leaves no process | pass | Lead, runner test: `ping` tree killed, no leftover |
| 7 | Translate selection, clipboard restored | pass | User |
| 8 | No text selected | not run | |
| 9 | Region at 100% / 150% | skipped | User monitors have the same size and scaling |
| 10 | Region cancel, no leftover PNG | pass (Esc) | User; leftover PNG not checked |
| 11 | Popup Copy / Esc / X | not run | |
| 12 | Idle RAM | 75.1 MB | 4 electron.exe, private working set; target 70–100 MB |
| 13 | Wrong claudePath error | pass (code) | Lead: `.cmd` path returns `spawn EINVAL` as an error, no crash |

Change during test: translation model switched from `haiku` to `sonnet` (Japanese accuracy).
