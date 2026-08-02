# Typing game redesign — design

**Date:** 2026-07-28
**Amended:** 2026-08-01
**Status:** Approved design, ready for implementation planning

### Amendments — 2026-08-01

Three changes, driven by the math facts game landing on `math-facts-game`:

1. **A parallel number track** (§2a). The kids are doing arithmetic; they should
   be learning correct fingering for the digits they're already typing. The
   laptops have no numpad, so this is the top row.
2. **Storage moves to the math game's log model** (§9, §11). `data/typing-log.jsonl`
   becomes the source of truth; nothing is stored pre-chewed.
3. **ES modules, not classic scripts** (§10). Consequence of (2) — the game now
   requires the server, so the `file://` constraint that drove the original
   decision no longer exists.

Plus fixes to internal contradictions found in review: the `!` / punctuation
mismatch between §2 and §7, and the §8 mockup that violated its own lesson's
`availableKeys`.

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
- Teach the number row, so the math game reinforces typing rather than
  undermining it.
- Teach Shift as an opposite-hand chord, and basic punctuation.
- Support both words and sentences.
- Progressively remove the visual scaffolding, as a reward rather than a loss.
- Stay vanilla HTML/CSS/JS with no build step — kids open the file and play.

## Non-goals

- The symbol row above the digits — `~ @ # $ % ^ & *` — and the bracket and
  backslash cluster. The digits themselves are now in scope (§2a); their shifted
  symbols are not.
- Accounts, sync, or anything off this machine. The server is localhost-only and
  binds `127.0.0.1`; "local" now means a local server rather than `file://`.
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

Fourteen rungs, covering the letters. Each is constrained to keys taught so far,
so the game never asks for a key it hasn't introduced. The number row runs as a
separate parallel track — see §2a.

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
| 13 | `punctuation` | Punctuation | ? ' " : | Pinkies, mostly shifted |

Each lesson declares its cumulative `availableKeys`, so content authoring can be
mechanically validated against it (see §11).

`!` is **not** here. It is shift-`1`, so it belongs to the number track (§2a)
and is taught there. Rung 13 covers `?` (shift-`/`), `'`, `"` (shift-`'`), and
`:` (shift-`;`) — which is exactly the set §7 declares shift-bearing, minus the
`!` that the number track owns.

### Authoring rule: casing and terminal punctuation

Capitals arrive at rung 12 and the period at rung 10. **Every sentence item in
rungs 2–9 is therefore lowercase and unpunctuated** — `she had a field`, not
`She had a field.` This reads wrong to anyone writing content and will be
"corrected" by reflex, so it is stated here and enforced by the validation test
in §12.

## 2a. The number track

The kids are doing arithmetic daily in the math game. Every digit they type
there is fingering practice — currently, practice at doing it wrong. This track
exists to get ahead of that.

**It is a separate, ungated track, not rungs 14–18 of the letter ladder.** The
letter ladder is ordered by English letter frequency, and digits are far rarer in
prose than any bottom-row letter; slotting them in early would break the ladder's
own stated ordering principle. But making a kid clear `z /` before `4 7` is
backwards when they're typing digits every day. A parallel track resolves both:
the letter ladder keeps its integrity, and numbers are available from first
launch, like practice mode and the name drill.

The laptops have no numpad, so this is the top row throughout.

Five rungs, mirroring the letter ladder's ordering logic exactly — middles, then
index, then the inward stretch, then rings, then pinkies:

| # | id | Title | New keys | Note |
|---|---|---|---|---|
| n0 | `num-38` | Numbers | 3 8 | Middles, two rows up |
| n1 | `num-47` | Numbers | 4 7 | Index, two rows up |
| n2 | `num-56` | Numbers | 5 6 | Index, up **and** inward — the number row's `t y` |
| n3 | `num-29` | Numbers | 2 9 | Rings |
| n4 | `num-10` | Numbers | 1 0 - = ! | Pinkies. `-` and `=` ride along; `!` is shift-`1` |

`availableKeys` is cumulative **within the track** and does not inherit the
letter ladder:

```
num-38  '38 '
num-47  '3847 '
num-56  '384756 '
num-29  '38475629 '
num-10  '3847562910-= !'
```

### Rendering is already done

No new keyboard work. `design/typing-keyboard.dc.html` draws the full keyboard —
its `ROWS` already includes `` ` `` `1`–`0` `-` `=` `delete` — and its `FINGER`
map already assigns every digit on standard touch-typing lines:

| | lp | lr | lm | li | ri | rm | rr | rp |
|---|---|---|---|---|---|---|---|---|
| **Digit** | 1 | 2 | 3 | 4 5 | 6 7 | 8 | 9 | 0 - = |

Porting `FINGER` and `ROWS` wholesale, as §10 already requires, covers the number
track for free. This was a curriculum gap, not a rendering gap.

### Content

Items are constrained to digits taught so far, plus space. Two kinds:

- **drills** — `38 83 383`, `47 74 474`
- **numbers** — realistic multi-digit strings: ages, years, math answers

Mix is `{ drills: 7, words: 3, sentences: 0 }`. There are no sentences: digits
alone cannot make one.

Mixed items that combine digits with letters — `6 x 7 = 42`, `24 divided by 4 is
6` — are genuinely the most motivating content here, but they need letters the
track deliberately doesn't own. **They live in practice mode** (§4), which is
already exempt from key restriction. That keeps §12's validation strict without
losing the math tie-in.

Note that unlike the letter rungs, this content generates mechanically. The
authoring cost called out in §3 does not apply here.

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

"Where the key set allows" is doing real work in that sentence. `home-base` has
only `asdfjkl;` — English contains perhaps a dozen words in that alphabet
(`ask`, `sad`, `flask`, `salad`, `alfalfa`…), not twenty, and no sentences at
all. The early rungs are drill-heavy by necessity, and per-rung targets should be
set against the actual alphabet rather than applied uniformly. Build the §12
validator **before** authoring content, not after: it is much cheaper to be told
a word doesn't fit than to discover it three rungs later.

## 4. Practice mode

Never locked, never gated by ladder progress, available from the first launch.
Same 10-item round shape and same results screen.

Four tabs:

- **Words** — the existing word lists, cleaned up and re-tiered.
- **Sentences** — curated real sentences in three tiers: short and simple; longer
  with commas; long with mixed punctuation. All keys available. These are meant
  to be worth reading, unlike the necessarily-nonsensical early drills.
- **Math** — sentences mixing digits and letters: `6 x 7 = 42`, `24 divided by 4
  is 6`, `there are 60 seconds in a minute`. This is where the number track (§2a)
  pays off in something worth typing, and it is the direct bridge to the math
  game.
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

**A wrong space needs a visible glyph.** Pressing space where a letter is
expected sets `wrong: ' '`, which renders as nothing at all — the kid sees the
line shake with no indication of what they typed. Render the sticky wrong
character as a middle dot `·` in the error colour when it is whitespace. Same for
a space typed in pass-through mode.

## 7. Shift chords

`needsShift(ch)` is true for `A-Z` and shifted punctuation (`?`, `!`, `"`, `:`).
Every one of those is taught: `?` `"` `:` at rung 13, `!` at `num-10` (§2a). The
unshifted `'` and `;` are taught at rung 13 and rung 0 respectively.

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
│  │o o│   ring finger to type:                │
│   ▔▔▔                                        │
├──────────────────────────────────────────────┤
│       she had a field            ← target    │
│       she had a fiek             ← typed     │
│                    ^                         │
│                    red, caret frozen         │
├──────────────────────────────────────────────┤
│   [ keyboard — next key lit in accent ]      │
│   [ tapered hand overlay — finger lit ]      │
└──────────────────────────────────────────────┘
```

The mockup is a valid `top-ei` item: every character in `she had a field` is in
that rung's `availableKeys`, and the mistyped `k` is a key the kid already knows.
Illustrations in this document are held to the same §12 validation as real
content, because they are exactly what gets copied into `content.js`.

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

  The clock starts on the **first keystroke**, not when the item is displayed. A
  kid reading the sentence before starting is doing the right thing and must not
  be scored down for it.

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

Stars, best accuracy, best WPM, and the hands-off badge are **derived on read
from the log** (§11), never stored. See §9a.

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

## 9a. Storage and the server

This adopts the math facts game's model wholesale. The two games share a machine,
a server, and a household; they should not have two different theories of what a
record is.

**`data/typing-log.jsonl` is the single source of truth.** One JSONL line per
event, appended by the server. The server must be running for the page to exist
at all, so there is no state where the browser is up and the file is unreachable.

- **On load** — `GET /api/log?game=typing&tail=N`. The client derives progress
  from the tail.
- **During play** — all state in memory. Each completed item and each completed
  round fires a POST **without awaiting it**. The kid never waits on I/O.
- **On disk** — the server appends the line.

**Nothing is stored pre-chewed.** Stars, best accuracy, hands-off badges, and
per-lesson attempt counts are all computed on read. This is the rule that makes
questions we have not thought of yet answerable against history we have already
collected — and it retires one of §14's open questions on the spot: a per-key
accuracy heatmap becomes a query over data already on disk rather than a feature
to build and then wait months to populate.

### The one exception: settings

`name`, `guidance`, `blockOnError`, `accent`, and `skin` stay in localStorage
under `kct.typing.settings.v1`. They are device preferences, not observations —
and they are needed synchronously at boot, before any fetch resolves. Forcing
them through an event stream would mean rendering the first frame without knowing
what to render. This split is deliberate: **observations go to the log,
preferences stay local.**

localStorage's other and only job is the **outbox** (`kct.typing.outbox.v1`), a
buffer of events the server has not acknowledged. Same shape and same failure
model as `math-game/js/log.js`: 204 is success, 4xx is permanent and drops the
event, 5xx and network failures are transient and queue for the next load.

### Server change required

`server/serve.js` currently hardcodes `/api/log` to `data/math-log.jsonl` via
`DEFAULT_LOG_PATH`. It needs to route by game — a `?game=` parameter validated
against an allowlist, resolving to `data/<game>-log.jsonl`. The allowlist matters:
this is a filesystem path derived from a query string, and `serve.js` already
takes path traversal seriously enough to have a test for it.

That file is owned by the `math-facts-game` branch, where work is ongoing. The
change is small but it is **cross-branch**, and it is the one piece of this plan
that cannot be built entirely inside the typing worktree.

### A note on the log file

The math spec commits `data/math-log.jsonl` to git. A typing log contains the
kid's name, and this repo has an `origin`. Either keep `data/typing-log.jsonl`
out of version control, or confirm the remote is private before the first commit
that includes it. Worth deciding once, now, rather than discovering later.

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
    curriculum.js         the 14 letter rungs + 5 number rungs, availableKeys, mixes
    content.js            drills, words, sentences   ← hand-editable
    engine.js             typing state machine — pure, no DOM
    progress.js           derives stars/badges/bests from log events — pure
    keyboard.js           renders keys, highlights, shake
    hands.js              SVG overlay, finger highlight
    ui.js                 prompt, progress, results, guidance levels
    log.js                POST/GET /api/log, outbox   ← impure
    settings.js           localStorage preferences
    main.js               wiring                      ← impure
  tests/
    engine.test.js
    keymap.test.js
    progress.test.js
    content.test.js       every item validates against its lesson's availableKeys
```

`engine.js` is the load-bearing piece and is **pure** — no DOM, no globals, no
timers. Feed it keystrokes, get back state. Block-vs-pass-through and shift
chords are precisely the logic that breaks silently and invisibly, so it needs to
be testable without a browser. `progress.js` is pure for the same reason: it is
the code that decides whether a kid earned a third star.

Exactly two impure modules — `log.js` and `main.js` — matching the math game's
arrangement.

### Script loading

**ES modules.** This reverses the original decision, and the reversal is a
consequence of §9a rather than a change of taste.

The original argument was that Chrome and Firefox block module imports over
`file://` (origin `null` fails CORS), so modules would cost the kids their
double-click-to-play. That constraint is gone twice over:

1. `play.command` already exists — a double-clickable Finder launcher that starts
   `server/serve.js` on port 8777 and opens the menu. The kids still double-click.
   They just get `http://localhost:8777` instead of `file://`.
2. More decisively, §9a makes the server **load-bearing**. A game whose stats live
   behind `/api/log` cannot run from `file://` regardless of how its scripts load.
   There is no longer a `file://` mode to preserve.

With that gone, the `window.TG` namespace and the `vm`-sandbox test harness are
pure cost. Tests run under `node --test` against real imports, exactly as
`math-game/tests/` already does. Still zero dependencies, still no install, still
no build step.

## 11. Data shapes

**Lesson** (`curriculum.js`):

```js
{
  id: 'top-ei',
  track: 'letters',                      // 'letters' | 'numbers'
  title: 'Top row: e i',
  newKeys: ['e', 'i'],
  availableKeys: [...'asdfghjkl; ei'],   // cumulative within the track
  hint: 'Middle fingers reach straight up.',
  mix: { drills: 4, words: 4, sentences: 2 }
}
```

The two tracks are independent sequences over the same shape — `availableKeys`
accumulates within a track and never across them (§2a).

**Engine state** (`engine.js`) — pure functions returning new state:

```js
start(text, { blockOnError })       → state
press(state, { key, shiftSide })   → state
backspace(state)                   → state
stats(state)                       → { accuracy, wpm, bestStreak }

state = {
  text:        'The kid fed a deer.',
  entries:     [ { expected: 'T', actual: 'T', ok: true }, ... ],
  wrong:       'e' | null,     // block mode only — sticky red char
  keystrokes:  18,
  errors:      2,
  misses:      [ { expected: 'd', actual: 'x', pos: 2 } ],

  // `misses` is recorded by the engine in BOTH modes and must not be derived
  // from `entries`. In block mode a wrong press appends no entry at all, so
  // filtering entries for ok:false yields [] — and since block mode is the
  // default, deriving it that way collects nothing from almost every kid.

  streak:      3,
  bestStreak:  9,
  startedAt:   null,           // set by the FIRST keystroke, not by start()
  finishedAt:  null,
  blockOnError: true
}
```

In block mode a wrong press sets `wrong` and appends nothing. In pass-through it
appends an entry with `ok: false`. Rendering reads `entries` plus `wrong`
identically in both modes.

**Log events** (`data/typing-log.jsonl`) — one JSON object per line.

An `item` event per completed item:

```json
{"type":"item","t":"2026-08-01T15:04:05.123Z","build":"t1","session":"s_9f2c",
 "lesson":"top-ei","kind":"sentence","text":"she had a field",
 "keystrokes":16,"errors":1,"ms":9400,"guidance":3,"blockOnError":true,
 "misses":[{"expected":"l","actual":"k","pos":13}]}
```

A `round` event per completed round:

```json
{"type":"round","t":"2026-08-01T15:07:12.004Z","build":"t1","session":"s_9f2c",
 "lesson":"top-ei","items":10,"accuracy":0.96,"wpm":12,"bestStreak":23,
 "guidance":3,"handsOff":false}
```

- `misses` is the whole reason to log at item granularity. It is small — a clean
  item carries an empty array — and it is exactly the data a per-key accuracy
  heatmap needs. Logging it now costs nothing and means the feature is a query
  later rather than a build-and-wait.
- `guidance` rides on every event because a 96% round at level 0 and a 96% round
  at level 3 are not the same achievement, and nothing else records which it was.
- `build` is a version tag bumped when the curriculum, mixes, or star thresholds
  change, so before/after comparison is a filter rather than a guess. Same
  convention as the math log.
- `round` is derivable from its `item` events, and is written anyway: it is the
  unit the results screen and the star history actually ask about, and the
  redundancy is worth not reconstructing round boundaries on every read.

**Derived progress** (`progress.js`) — pure, computed from the tail on load:

```js
forLesson(events, 'top-ei')
  → { stars: 3, bestAccuracy: 96, bestWpm: 14, attempts: 3, handsOff: false }
```

This is the shape the old `storage.js` persisted. It is now computed, never
written — which means a change to the star thresholds re-scores all history
instead of leaving stale stars on disk.

**Settings** (`settings.js`), localStorage key `kct.typing.settings.v1`:

```js
{ name: 'Petra' | null, blockOnError: true, guidance: 3,
  accent: '#7b6bd6', skin: '#e8b7ac', lastLesson: 'top-ei' }
```

Versioned key so a schema change can migrate or reset cleanly rather than
throwing on a stale shape. A corrupt or absent value must fall back to defaults
silently — a first run and a broken run look identical from here, and neither may
prevent a kid from playing.

## 12. Testing

`engine.js` and `keymap.js` are pure and get real unit tests:

- Block mode freezes the caret; pass-through advances it.
- Backspace clears the sticky red in block mode; steps back in pass-through.
- A second wrong press in block mode replaces rather than stacks.
- Accuracy and WPM math, including the zero-keystroke and zero-elapsed cases.
- WPM ignores time before the first keystroke.
- `needsShift` and `shiftSideFor` return the opposite hand for every letter.
- Wrong-side Shift is accepted and records no error.
- Every key in `keymap` has a finger; every finger has a display name — including
  every digit, `-`, and `=` (§2a).

`progress.js` is pure and gets the same treatment:

- Star thresholds at their exact boundaries: 89.9%, 90%, 94.9%, 95%.
- The hands-off badge requires 3 stars **and** guidance ≤ 1.
- An empty event list yields zero progress rather than throwing — a kid who has
  never played is the common case on day one.
- Events for other lessons, and malformed events, are ignored rather than fatal.

Plus one **content validation test**, which is the one most likely to actually
catch a mistake: for every lesson in both tracks, assert that every character in
every drill, word, and sentence appears in that lesson's `availableKeys`.
Hand-authored constrained content drifts silently, and this catches a rung asking
for a key it never taught. It also enforces the §2 casing rule: no uppercase and
no terminal punctuation before the rungs that teach them.

Practice-mode content is deliberately exempt — it is not key-restricted (§4).

DOM rendering is verified by playing it, not by tests.

## 13. Rollout

Build alongside the existing game. The current `index.html`, `script.js`, and
`style.css` keep working and stay reachable throughout — nothing breaks mid-flight.

When the new game is good, repoint `games-menu.html` at it and retire the old
files in a separate commit.

Two ordering constraints this time:

- The **`serve.js` game-routing change (§9a) has to land first**, on
  `math-facts-game` or wherever that file settles. Nothing in the typing game
  that touches progress can be exercised until `/api/log?game=typing` answers.
- The old game runs from `file://`; the new one does not. Until the cutover,
  `games-menu.html` must be reached through `play.command` for the new game to
  work at all. Opening the menu by double-clicking the HTML file will appear to
  work and then fail at the first log write.

## 14. Open questions

- Exact wording and tone of the cheers and prompts. Easy to tune later; worth a
  pass with the kids.
- Whether practice-mode sentences should be tagged by theme (animals, space,
  jokes) on top of difficulty tiers. Deferred — tiers first, themes only if the
  content feels monotonous in use.
- ~~Whether to add a per-key accuracy heatmap to drive targeted review.~~
  **Resolved by §9a.** The `misses` array on every `item` event collects the data
  from day one, so this stops being a question about whether to build a feature
  and becomes a question about when to render one. Deferred, not blocked.
- Whether the number track should eventually reach the shifted symbols above the
  digits. Out of scope now (§Non-goals), but `!` arriving via `num-10` makes the
  boundary less obvious than it was.
- Whether progress should be shown across both tracks on one screen, or whether
  each track gets its own ladder view. Depends on how the kids actually navigate;
  worth watching before deciding.
