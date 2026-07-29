# Typing game redesign — design

**Date:** 2026-07-28
**Status:** Approved design, ready for implementation planning

## Context

The existing typing game (`index.html` / `script.js` / `style.css`) has been
outgrown. Two problems drove this redesign:

1. **The finger guidance stops exactly when it starts mattering.** `script.js:136`
   shows the on-screen keyboard only for the `firsttime` level and hides it for
   every other level. So the kids learned home row with guidance, then typed
   `cat`, `elephant`, `helicopter` with none. They know where those letters are;
   there's a real chance they've been reaching with whatever finger is closest.
   Correct fingering off the home row was never taught.

2. **No curriculum.** Levels are bucketed by word *length*, not by key coverage.
   Nothing sequences which keys get learned, in what order, or by which finger.

Meanwhile a much more appealing visual design exists as a Claude Design session
(mirrored in `design/`), built around a full keyboard with an SVG hand overlay
that highlights the correct finger. That design is the visual foundation here.

The kids are ready for words and sentences. This rebuilds the game around a real
typing curriculum wearing that design.

## Goals

- Teach correct fingering for the whole alphabet, in a defensible order.
- Teach Shift as an opposite-hand chord, and basic punctuation.
- Support both words and sentences.
- Progressively remove the visual scaffolding, as a reward rather than a loss.
- Stay vanilla HTML/CSS/JS with no build step — kids open the file and play.

## Non-goals

- Numbers row and symbols. Later, if ever.
- Accounts, sync, servers. Everything is local.
- Timed tests or clock pressure of any kind.
- Multi-user profiles — each kid has their own computer.

## 1. Guidance levels

The on-screen keyboard is scaffolding. Looking at it is only marginally better
than looking at your hands — both are visual key-finding rather than muscle
memory. Removing it is the actual goal of the curriculum, not a UI preference.

| Level | Shows | Intended for |
|---|---|---|
| **3 · Full** | Keyboard + tapered hands + next key lit + "use your right middle finger" | Learning new keys |
| **2 · Keyboard** | Keyboard + next key lit. Hands hidden. | Keys known, placement shaky |
| **1 · Peek** | Keyboard dimmed, no highlight. Reference only. | Weaning |
| **0 · Off** | Text only. Clean UI. | Touch typing |

**Default is 3.** When a lesson is 3-starred, the results screen offers a step
down — *"Nice! Want to try that again with the hands off?"* — and clearing a
lesson at level 1 or 0 earns a **hands-off badge** alongside the stars. Framing
matters: this must read as unlocking a harder challenge, never as losing a help.

The level is a global setting, always manually overridable in both directions, so
a struggling kid can be put back to Full without ceremony.

One exception: **drill items containing a not-yet-mastered new key always render
at Full**, whatever the setting says — you cannot learn a new key's finger without
being shown it. This applies to drill items only. The word and sentence items in
the same round follow the setting normally, so the hands-off badge (§9) is still
earnable on a new-key lesson: the drills show you the new finger, then the rest of
the round makes you do it unaided.

## 2. The curriculum ladder

Fourteen rungs. Each is constrained to keys taught so far, so the game never asks
for a key it hasn't introduced.

Ordering principles, in priority order:

- **Frequency.** The top row is ~51% of English text, home row ~34%, bottom row
  ~15%. E alone is 12.7%. Top row before bottom row is not arbitrary.
- **Ergonomics.** Reaching up and returning is easier than curling down and under
  the palm.
- **Finger strength.** Within a row: middle and index first, then ring, then
  pinky last.
- **Mirrored pairs.** Both hands develop together.

| # | id | Title | New keys | Note |
|---|---|---|---|---|
| 0 | `home-base` | Home row | a s d f · j k l ; | Also introduces **space** (thumb) with the first multi-word drill |
| 1 | `home-stretch` | Home stretch | g h | Home row but not home position — index stretches inward and returns |
| 2 | `top-ei` | Top row | e i | Middles, straight up. Highest-value pair in the language |
| 3 | `top-ru` | Top row | r u | Index, straight up |
| 4 | `top-ty` | Top row | t y | Index, up **and** inward — a stretch |
| 5 | `top-wo` | Top row | w o | Rings |
| 6 | `top-qp` | Top row | q p | Pinkies. Q is the rarest letter in English — deliberately last |
| 7 | `bot-vm` | Bottom row | v m | Index, straight down |
| 8 | `bot-nb` | Bottom row | n b | Index, down and inward |
| 9 | `bot-c-comma` | Bottom row | c , | Middles |
| 10 | `bot-x-period` | Bottom row | x . | Rings |
| 11 | `bot-z-slash` | Bottom row | z / | Pinkies |
| 12 | `shift-caps` | Shift & capitals | ⇧ | Opposite-hand rule. Home of the name drill |
| 13 | `punctuation` | Punctuation | ? ! ' | Pinkies, mostly shifted |

Each lesson declares its cumulative `availableKeys`, so content authoring can be
mechanically validated against it (see §11).

## 3. Round structure

A round is **10 items**. An item is simply a string to type — that uniformity is
what keeps the engine small.

Items ramp within a round: key-pair drills, then words, then a sentence. Each
lesson declares its own mix, because early rungs can't support real sentences:

```
home-base      { drills: 6, words: 4, sentences: 0 }
top-ei         { drills: 4, words: 4, sentences: 2 }
shift-caps     { drills: 3, words: 3, sentences: 4 }
```

Example progression inside `top-ei` (available: `asdfghjkl;ei`):

```
drill      did die kid
drill      fed lea sid
word       slide
word       field
word       said
sentence   she had a field
```

Items are sampled from a larger pool per lesson so repeat attempts differ.

**Target content volume:** roughly 15 drills, 20 words, and 8 sentences per rung
where the key set allows. Practice mode adds ~30 sentences per tier plus the
cleaned-up word lists. This is the bulk of the authoring work and it is a real
amount of writing.

## 4. Practice mode

Never locked, never gated by ladder progress, available from the first launch.
Same 10-item round shape and same results screen.

Three tabs:

- **Words** — the existing word lists, cleaned up and re-tiered.
- **Sentences** — curated real sentences in three tiers: short and simple; longer
  with commas; long with mixed punctuation. All keys available. These are meant
  to be worth reading, unlike the necessarily-nonsensical early drills.
- **My Name** — see below.

Practice content is deliberately *not* restricted to taught keys. It's where they
go to play.

## 5. The kid's name

Asked for on first run, with a **skip** option — nothing blocks a kid from just
playing. Stored locally. There is no profile picker; each kid has their own
computer.

Used in three places:

- **Prompts and cheers** — "Howdy Petra!", "Nice one, Petra!"
- **Injected into practice sentences** — `Petra found a frog by the pond.`
- **The My Name drill** — typing your own name, repeatedly.

The name drill matters more than it looks. A name starts with a capital, which
makes it the single best motivation for learning Shift: a kid who doesn't care
about "opposite-hand shifting" as a concept cares a great deal about typing
`Petra` rather than `petra`. Rung 12 opens with it.

Because a name usually contains letters from untaught rows, the drill lives in
practice mode, always available and never gated.

## 6. Typing engine — two error models

One boolean, `blockOnError`. Both modes share an identical rendering path; the
only difference is whether the caret advances on a mismatch.

```
WORD                        WORD
Wo d                        Wo drd
  ^                           ^
  red, caret frozen           red, caret advanced

blockOnError: true          blockOnError: false
(default, beginner)         (advanced)
```

**Block mode.** The wrong letter renders red at the caret and *stays* there. The
caret does not advance. The typed line shakes, the correct key pulses on the
keyboard, and the correct finger flashes on the hand overlay. Backspace clears
the red. A second wrong press replaces the red character.

**Pass-through mode.** The wrong letter renders red and the caret advances. They
can keep typing and backtrack with Backspace. This is how real typing works, and
it's what a more advanced typist will prefer — accuracy is tallied at round end.

Block mode is scaffolding, not realism: it exists to stop a beginner from
building speed on bad fingering. It's the default; flip a kid to pass-through
when they're ready. It's a setting, not a per-lesson property.

## 7. Shift chords

`needsShift(ch)` is true for `A-Z` and shifted punctuation (`?`, `!`, `"`, `:`).

`shiftSideFor(ch)` returns the **opposite hand** from the base character's
finger: `T` is left index, so it wants the *right* Shift. Same-hand shifting is
the habit everyone develops and nobody unlearns.

Detecting which Shift was pressed: a letter's `keydown` only exposes a boolean
`e.shiftKey` with no side information. So track it separately — listen for
`keydown`/`keyup` on Shift itself and record `e.code` (`ShiftLeft` /
`ShiftRight`). When the letter arrives, consult the recorded side.

**Wrong-side Shift is accepted, not penalized.** The character counts as correct
and no error is recorded. The hand overlay shows the correct side and the prompt
says *"try the other shift next time"*. Teach the technique; don't punish a kid
for a capital letter that came out right.

At guidance level 3, a capital highlights **two** keys simultaneously — the
letter and the opposite Shift — with both fingers lit on the overlay. This is
what the hand diagram is uniquely good at, and it's the main payoff of porting it.

## 8. Screen layout

```
┌──────────────────────────────────────────────┐
│  Top row: e i                        4 / 10  │
│  ████████████░░░░░░░░░░░░░░░░░░░             │
├──────────────────────────────────────────────┤
│   ▄▄▄    Howdy Petra! Use your right         │
│  │o o│   middle finger to type:              │
│   ▔▔▔                                        │
├──────────────────────────────────────────────┤
│       The kid fed a deer.        ← target    │
│       The kid fed a d e          ← typed     │
│                       ^                      │
│                       red, caret frozen      │
├──────────────────────────────────────────────┤
│   [ keyboard — next key lit in accent ]      │
│   [ tapered hand overlay — finger lit ]      │
└──────────────────────────────────────────────┘
```

- **Both text lines are monospace** so columns align character-for-character.
  That alignment is the entire reason the two-line compare is worth its vertical
  space; it's what lets a kid see exactly which letter went wrong.
- The bobbing monitor character and speech bubble carry over from the design.
- Everything below the divider is hidden or dimmed per the guidance level.

**Scaling.** The keyboard is 924px wide with fixed 52px keys, and the hand SVG is
positioned in the same coordinate space. They must stay in lockstep, so scale the
whole stage with a single `transform: scale()` computed from container width
rather than making the keyboard fluid. Fluid keys would desynchronize the overlay.

Visual values — palette, fonts, key geometry, finger colors — are documented in
`design/README.md`.

## 9. Scoring, stars, and progress

- **Accuracy** = `(keystrokes - errors) / keystrokes`, shown as a percentage.
- **Best streak** — consecutive correct keystrokes.
- **WPM** = `(correctChars / 5) / minutes`. Shown **only on the results screen**,
  never during typing, and it never gates anything. Speed is a result of
  accuracy, never the path to it; a kid pushed on WPM invents hunt-and-peck and
  keeps it for thirty years.

**Stars** — soft gate:

| Stars | Earned by |
|---|---|
| ★ | Finishing the round |
| ★★ | ≥ 90% accuracy |
| ★★★ | ≥ 95% accuracy |

Plus a **hands-off badge** for a 3-star round at guidance level ≤ 1.

The next rung opens regardless of stars. Nobody gets stuck; stars are the pull to
come back and re-master, not a wall. A kid who rushes ahead unprepared will find
the next rung hard and can drop back on their own.

Results screen:

```
┌────────────────────────────┐
│      Lesson complete!      │
│            ★★★             │
│    Accuracy         96%    │
│    Speed         12 wpm    │
│    Best streak       23    │
│                            │
│  [ Again ]  [ Next → ]     │
└────────────────────────────┘
```

## 10. Architecture

Vanilla, no build step, no dependencies. Split by responsibility rather than one
long file — partly for clarity, partly because focused files are far more
reliable to edit.

```
typing-game/
  index.html
  design/                 reference from the Claude Design session
  css/
    base.css              reset, palette vars, fonts
    layout.css            page shell, prompt bubble, progress
    keyboard.css          deck, keys, highlight, shake
    hands.css             overlay
    results.css           results screen, stars
  js/
    keymap.js             key→finger, shift pairs, row layout, geometry
    curriculum.js         the 14 rungs, availableKeys, item mixes
    content.js            drills, words, sentences   ← hand-editable
    engine.js             typing state machine — pure, no DOM
    keyboard.js           renders keys, highlights, shake
    hands.js              SVG overlay, finger highlight
    ui.js                 prompt, progress, results, guidance levels
    storage.js            localStorage
    main.js               wiring
  tests/
    run.js                node harness
    engine.test.js
    keymap.test.js
```

`engine.js` is the load-bearing piece and is **pure** — no DOM, no globals, no
timers. Feed it keystrokes, get back state. Block-vs-pass-through and shift
chords are precisely the logic that breaks silently and invisibly, so it needs to
be testable without a browser.

### Script loading

Classic `<script src>` with a single `window.TG` namespace — **not** ES modules.

This is a deliberate tradeoff. ES modules are cleaner, but Chrome and Firefox
block module imports over `file://` (origin `null` fails CORS), which would mean
the kids can no longer double-click to play and would need a local server. That
friction is not worth the tidiness. Classic scripts work from `file://`.

Tests then run in Node via a ~15-line `vm`-sandbox harness in `tests/run.js` that
loads the source files into a fake global and asserts against them. Zero
dependencies, no install.

## 11. Data shapes

**Lesson** (`curriculum.js`):

```js
{
  id: 'top-ei',
  title: 'Top row: e i',
  newKeys: ['e', 'i'],
  availableKeys: [...'asdfghjkl; ei'],   // cumulative
  hint: 'Middle fingers reach straight up.',
  mix: { drills: 4, words: 4, sentences: 2 }
}
```

**Engine state** (`engine.js`) — pure functions returning new state:

```js
TG.engine.start(text, { blockOnError })   → state
TG.engine.press(state, { key, shiftSide }) → state
TG.engine.backspace(state)                 → state
TG.engine.stats(state)                     → { accuracy, wpm, bestStreak }

state = {
  text:        'The kid fed a deer.',
  entries:     [ { expected: 'T', actual: 'T', ok: true }, ... ],
  wrong:       'e' | null,     // block mode only — sticky red char
  keystrokes:  18,
  errors:      2,
  streak:      3,
  bestStreak:  9,
  startedAt:   1785290000000,
  finishedAt:  null,
  blockOnError: true
}
```

In block mode a wrong press sets `wrong` and appends nothing. In pass-through it
appends an entry with `ok: false`. Rendering reads `entries` plus `wrong`
identically in both modes.

**Stored state** (`storage.js`), key `kct.typing.v1`:

```js
{
  name: 'Petra' | null,
  settings: { blockOnError: true, guidance: 3, accent: '#7b6bd6', skin: '#e8b7ac' },
  progress: {
    'top-ei': { stars: 3, bestAccuracy: 96, bestWpm: 14, attempts: 3, handsOff: false }
  },
  lastLesson: 'top-ei'
}
```

Versioned key so a schema change can migrate or reset cleanly rather than
throwing on a stale shape.

## 12. Testing

`engine.js` and `keymap.js` are pure and get real unit tests:

- Block mode freezes the caret; pass-through advances it.
- Backspace clears the sticky red in block mode; steps back in pass-through.
- A second wrong press in block mode replaces rather than stacks.
- Accuracy and WPM math, including the zero-keystroke and zero-elapsed cases.
- `needsShift` and `shiftSideFor` return the opposite hand for every letter.
- Wrong-side Shift is accepted and records no error.
- Every key in `keymap` has a finger; every finger has a display name.

Plus one **content validation test**, which is the one most likely to actually
catch a mistake: for every lesson, assert that every character in every drill,
word, and sentence appears in that lesson's `availableKeys`. Hand-authored
constrained content drifts silently, and this catches a rung asking for a key it
never taught.

DOM rendering is verified by playing it, not by tests.

## 13. Rollout

Build alongside the existing game. The current `index.html`, `script.js`, and
`style.css` keep working and stay reachable throughout — nothing breaks mid-flight.

When the new game is good, repoint `games-menu.html` at it and retire the old
files in a separate commit.

## 14. Open questions

- Exact wording and tone of the cheers and prompts. Easy to tune later; worth a
  pass with the kids.
- Whether practice-mode sentences should be tagged by theme (animals, space,
  jokes) on top of difficulty tiers. Deferred — tiers first, themes only if the
  content feels monotonous in use.
- Whether to add a per-key accuracy heatmap to drive targeted review. Genuinely
  useful pedagogically, but it needs real usage data before it's worth building.
