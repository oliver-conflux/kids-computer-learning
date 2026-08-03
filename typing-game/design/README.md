# Design reference

Source of truth for the visual design of the typing game.

## `typing-keyboard.dc.html`

Fetched from a private Claude Design session — the source URL is not reachable by
anyone but its author, so it is deliberately not reproduced here. The committed
snapshot below is the whole of what this project needs.

Snapshot taken 2026-07-28, after the hand geometry was shortened.

**This file is reference, not runnable here.** It's authored for the Claude Design
runtime (`DCLogic`, `<x-dc>`, `<sc-for>`, `{{ }}` bindings) and needs `support.js`
from that project to render. We port values out of it; we don't execute it.

### What to port

| Thing | Where | Notes |
|---|---|---|
| Key → finger map | `FINGER` | Standard touch-typing assignments; matches the curriculum |
| Finger display names | `NAMES` | "left pinky", "right index", … used in prompts |
| Keyboard layout | `ROWS` | Label, width multiplier, optional id for duplicate keys |
| Key unit sizing | `U = 52`, `GAP = 8` | Width formula: `w * U + (w - 1) * GAP` |
| Per-finger colors | `FCOLOR` | Used for the legend and no-hands key tinting |
| Tapered finger paths | `taper()` + `GEO` | The SVG hand overlay |
| Palette | inline styles | See below |

### Palette

| Role | Value |
|---|---|
| Page background | `#eef0f3` |
| Keyboard deck | `#d9dde3` |
| Key face | `#ffffff` |
| Key label | `#6b7381` |
| Heading text | `#2f3742` |
| Muted text | `#7b8493` |
| Accent (default) | `#7b6bd6` — alternates `#2a9dad` `#e0813f` `#3f9e63` |
| Skin (default) | `#e8b7ac` — alternates `#d9a074` `#a9744f` `#7a5236` |
| Wrong-key flash | `#f4c9c2` |
| Error text | `#d98a7d` |

Fonts: **Baloo 2** (display) and **Nunito** (UI), both from Google Fonts.

### Tapered hands is the chosen style

The design explored three hand styles. **Tapered hands** is the selected one —
that's the `taper()` function plus the `GEO` table plus the two palm `<path>`
elements. Port those.

The other two are rejected and should not be ported:

- **Blocky hands** — the `<rect>` block. Dead code in this snapshot: the stage was
  shortened from 600px to 385px and only the tapered geometry was updated, so the
  blocky palms now sit at `y=392`, entirely outside `viewBox="0 0 924 385"`. Ignore it.
- **No hands** — keys tinted by finger color instead. Superseded by our guidance
  levels, which handle showing less in a more deliberate way.

### Other files in the design project (not mirrored here)

- `support.js` — the Claude Design runtime. Not our code.
- `uploads/*.png` — reference screenshots pasted into the session.
