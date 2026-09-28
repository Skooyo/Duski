# Duski Ask: quick questions about selected text or a screen area

Status: spec agreed 2026-09-28 (grill session)

## Goal

Two pie slices open one floating "Ask" window for questions you already know you want to ask: rewrite or explain selected text, or ask about a box on screen. The answer shows in the window to check and copy. Nothing is pasted back.

## Decisions

| Topic | Decision |
|---|---|
| Slices | 5 "Ask about text" (selected text, same Ctrl+C capture as Translate) and 6 "Ask about area" (same box drag as Translate area). |
| Window | Floating, frameless, at the cursor, always on top, dragged by its top bar. Stays open when you click away. Esc or ✕ closes it and stops a running answer. A new ask replaces the old window. |
| Minimize | A — button hides the window (it keeps working). When a hidden window's answer finishes (or fails), a toast shows; clicking it brings the window back. Tray menu "Show Ask window" also brings it back. Added after the grill session. |
| Input | Preset buttons plus an input line for your own instruction. Enter or a preset starts the answer. Another preset or question replaces the answer (fresh session each time). |
| Presets (fixed in code) | Text: Fix grammar, Shorter, More formal, More casual, Explain. Area: What is this?, Explain this error, Extract the text, Summarize. |
| Agent | Full agent, like Chat: `claude -p` in `D:\Duski\` with all tools and `models.chat`. The status line shows the latest tool action. |
| Answer | One answer, markdown. Copy button. |
| Continue in chat | Starts a new chat from the quick-ask session (`--resume`), so Claude keeps the text or image, the question and tool results. Replaces the current chat. Refused with "Chat is busy" while chat is running a reply. The ask window then closes. |
| No selection | Popup "No text selected", as Translate does. |
| Area image | PNG in the temp folder, deleted when the ask window closes. The session already holds the image, so Continue in chat still works. |

## Out of scope

- Pasting the result back over the selection.
- Follow-ups inside the ask window.
- Presets in config.json, recent custom instructions.
