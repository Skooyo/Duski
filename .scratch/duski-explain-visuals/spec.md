# Duski explain mode: simplify and add visuals

Status: spec agreed 2026-11-04 (grill session)

## Goal

When you ask Duski to explain something, the source is usually too technical. Duski simplifies it first and adds a diagram when the idea has structure.

## Decisions

| Topic | Decision |
|---|---|
| Trigger | An "Explain mode" rule in the shared reply style (`REPLY_STYLE_ARGS`). It applies to any explain request in Chat, Ask about text and Ask about area (preset or typed). |
| Simplify | Plain words. One short labeled analogy is permitted ("Think of it as: …"). All other text stays STE. |
| Shape | 1) One-sentence gist. 2) Visual, if one helps. 3) Breakdown, max 5 points. 4) Key terms. 5) Optional analogy. |
| When | Claude decides: a process, parts of a system, a comparison, a timeline, cause and effect. No visual for a definition or a single fact. "no diagram" in the question turns it off. |
| Visual kind | ` ```mermaid ` for structure; ` ```svg ` for shapes Mermaid cannot draw. Code goes in the reply, not in files. |
| Rendering | Ask and Chat share one renderer (`src/renderer/lib/markdown.ts`). Mermaid loads on first use, `securityLevel: 'strict'`, theme follows the window. SVG and Mermaid output go through DOMPurify. |
| States | While a block streams: "Drawing diagram…". On a parse error: "Diagram could not render" plus the source in a collapsed block. |
| Diagram style | Mermaid `redux-dark-color` theme (`redux-color` in light mode) with the `neo` look. Prompt rules: labels max 5 words, flowcharts top to bottom (LR only for 4 nodes or fewer), labeled subgraphs for each part, the key node gets an amber border (`classDef key`). Chosen 2026-11-04 from a side-by-side comparison. |
| Copy | Copies the raw markdown, as before. |
| Enlarge | Click a diagram to open the Duski viewer window: 80% of the screen, centered, always on top. Scroll zooms at the cursor, drag pans, double-click resets. ─ minimizes it to the taskbar (the taskbar button or a click on any diagram restores it). Esc or ✕ closes. A new diagram replaces the old one. |
| Toggle | None. |

## Out of scope

- Raster image generation (needs an API key).
- Web images.
- Copy diagram as image.
