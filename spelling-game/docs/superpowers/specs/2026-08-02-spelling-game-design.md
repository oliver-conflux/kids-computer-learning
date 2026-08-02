# Spelling game — design

**Date:** 2026-08-02
**Status:** Approved design, ready for implementation planning
**Branch:** `spelling-game`
**Also amends:** `math-game/docs/superpowers/specs/2026-08-01-math-facts-game-design.md`
§12 and §14 — the pure core moves to `core/`, and the math log stops being
committed. Both changes are described in §1 and §11 below.

## Context

The third game. Typing teaches the keyboard; math teaches fact retrieval;
spelling is the one where the kid has something to say and needs the letters to
come out right.

Spelling looks like the typing game and **is** the math game. That distinction
drove most of what follows, so it is worth stating precisely.

| | typing | math | spelling |
|---|---|---|---|
| item is a knowledge unit | no — a vehicle | yes | **yes** |
| per-item mastery worth storing | no | yes | **yes** |
| item has a teachable route | no | strategy | **word family** |
| neighbours interfere | no | `6×7`→`48` | **`they`→`thay`** |
| latency separates retrieval from working it out | no | yes | **yes** |
| needs a scheduler to choose what to serve | no — the rungs are ordered | yes | **yes** |

In the typing game a word is a *vehicle*: typing `cat` does not teach you `cat`,
it teaches you where C, A and T live. Its real item space is 26 keys, which is
why its curriculum is a fixed sequence of rungs and why `progress.js` only ever
asks about stars and best accuracy. "Has she mastered `cat`?" is not a question
that game wants to answer.

For spelling, the word *is* the knowledge. It is discrete, it either comes back
or it does not, it has a route that can be taught, and it interferes with its
neighbours. That is the math game's shape exactly, and the math game's machinery
— log as single source of truth, mastery derived on read, weighted scheduling,
latency as the signal, learn/drill split — transfers wholesale.

### Provenance of the word data

The source research was done in a separate conversation and is summarised here
so the choices below are not mistaken for arbitrary ones. Its main findings:

- **There is no authoritative graded spelling list.** Common Core specifies
  patterns, not words. Every published "3rd grade list" is a publisher's
  editorial judgement and they disagree with each other.
- **Fry and Dolch are the real backbone** — frequency-derived from actual
  corpora, public domain, and most commercial lists are these reshuffled.
- **Kuperman/Brysbaert age-of-acquisition norms and SUBTLEX frequencies** would
  give an empirically-derived difficulty score, but they measure when a kid
  learns to *say* a word, which is not when they can *spell* it. `said` and
  `friend` are early words and late spellings.
- **Typing difficulty is orthogonal to spelling difficulty.** `rhythm` is a hard
  spell and an easy type; `pizzazz` is the reverse. Two dials, not one.

That last point was an aside for a ten-year-old. With a four-year-old in scope it
becomes load-bearing, and §3 is built around it.

## Goals

- Build genuine spelling retrieval across a word spine that scales from a
  four-year-old to a ten-year-old without a level setting anywhere.
- Teach patterns, not words. A kid who learns `-ight` gets eight words, not one.
- Never stage a failure. Errors buy help.
- Extract the shared engine so this is the second consumer of one core rather
  than a second copy of it.
- Stay dependency-free, double-click-to-play, and playable with no API key.

## Non-goals

- **Multi-kid profiles.** One kid per machine, as with both existing games.
- Any network egress *at play time*. The M-W ingest is a separate, manual,
  offline step (§5).
- A test mode. Everything here is fluency practice; assessment is deferred (§16).
- Any clock, countdown, speed score, or comparison to anyone but the kid's own
  past self. Both modes, same as the other two games.
- Handwriting, capitalisation rules, or punctuation. Letters only in v1.

## 1. The shared core

`core/` holds the engine. Each game supplies an **item space adapter** plus its
own content, and the math game becomes the core's first consumer rather than its
owner.

The extraction is smaller than it sounds. `deriveMastery` is already
item-agnostic in everything but four places: it imports `allFacts`/`factId`, it
reads `event.op/a/b`, it filters `wrong` with `Number.isFinite`, and its
documentation says "121". The timestamp sort, the three-window logic, the
`maxPlausibleMs` outlier guard and the totality guarantee know nothing about what
a fact is.

The adapter is four functions:

| function | math | spelling |
|---|---|---|
| `allItems()` | 121 facts | the word spine |
| `itemId(item)` | `"*:6:7"` | `"w:friend"` |
| `idFromEvent(e)` | from `op,a,b` | from `word` |
| `isValidWrong(v)` | `Number.isFinite` | non-empty string |

Only the last row is genuinely new: math's wrong answers are numbers, spelling's
are strings.

### `core/log.js` takes the typing game's implementation, not the math game's

There are already two near-identical log clients. They share the outbox, the
`localStorage` guards, the fire-and-forget `record`, and the
4xx-permanent/5xx-transient failure model. They differ in two constants:

| | math | typing |
|---|---|---|
| `LOG_URL` | `/api/log` | `/api/log?game=typing` |
| `OUTBOX_KEY` | `kct.math.outbox.v1` | `kct.typing.outbox.v1` |

The typing version is strictly better — it has `serverIsUp()`, which exists
because `loadEvents()` deliberately cannot distinguish "server is down" from
"first run on a new machine", and conflating those lets a game bank every round
into an outbox that may never flush. The math client has no equivalent.

So the core takes typing's version parameterised by game name, and the math
client gains `serverIsUp()` by adopting it. The math client's bare `/api/log`
also becomes explicit `?game=math` rather than relying on the server's
`DEFAULT_GAME` fallback.

**Two real implementations already exist, so the boundary is observed rather than
guessed.** That is what makes extracting now the low-risk option rather than a
speculative abstraction.

### The safety net

The math game is in daily use by the kids. The extraction is done when its ten
existing test files pass **unmodified** against `core/`. If they cannot, the
boundary is wrong and that is the signal to stop and reconsider — not to edit the
tests.

### `CONFIG` splits

Core keys — `retain`, `hotMs`, `maxPlausibleMs`, `delays`, `weights`,
`noRepeatWithin`, `governorWindow`, `governorFloor`, `logTail` — are read by core
modules and supplied per game. Everything else stays in the game's own table,
including `build`, `mode` and `sessionLength`, which are per game by nature.

## 2. The word spine

An ordered array of about a thousand words, all public domain.

**1. A CVC opener, roughly 50 words, hand-authored.** `cat bat hat sat mat rat`,
`dog log fog jog`, `pig big dig wig`, `sun run fun bun`. Grouped in families from
the very first word.

This is hand-written and not copied from anywhere, and the reason is worth
recording because the obvious shortcut is wrong. The typing game's rung word
lists look like a CVC set — `home-base` is `ask sad lad dad fad` — but they are
banded by **keyboard availability**, not phonics. `ask sad lad` share no rime and
teach no pattern; they are simply the real English words available in `asdfjkl;`.
That constraint is orthogonal to spelling difficulty, so those lists inform the
`typingCost` dial (§3) and never the spine.

**2. Fry 1000 in frequency rank order**, with Dolch membership as a flag.

`spine.js` is **committed source**, not generated and not cached. Fry and Dolch
are public domain — that is the whole reason for choosing them — so the word list
travels with the repo and every clone gets an identical, playable spine. This is
the opposite of the M-W cache in §5, which is gitignored precisely because it is
not ours to redistribute. The line between the two is licence, not convenience,
and it should stay visible in the file layout.

The opener exists because pure frequency order is wrong at the very start. Fry's
first five are `the of and a to` — maximally frequent, but `of` is irregular,
none are decodable, and none belong to a family a four-year-old can generalise
from. After about fifty words, frequency order takes over and behaves well.

**Sight words are frequency-picked, not spelling-picked**, and this is the
accepted cost of the cheap spine: `said`, `could`, `one`, `two`, `friend` all
arrive early and are all irregular. §4's `irregular` tag exists to handle them
honestly rather than pretend they have a route.

## 3. The frontier and the two dials

### The frontier is derived, never stored

```
activeWindow(spine, mastery, size)
  → the first `size` words in spine order that are not yet `hot`
```

That is the entire rule. Mastered words drop out and the window slides forward on
its own. There is no stored position, no advancement threshold to tune, and no
placement test — **the log is the placement test**, recomputed on every load. A
four-year-old and a ten-year-old run identical code and land in completely
different regions of the same spine.

Critically, **one stubborn word cannot block the window.** It stays in, keeps
being served, and the other nineteen advance past it. A naive "advance when the
first N are all hot" rule would stall the entire game on a single leech, which is
the failure mode that makes kids quit.

### Dial one: bucket weight

`cold 6, warm 3, hot 1`, straight from the core scheduler, unchanged from math.

### Dial two: `typingCost(word)`

A pure function of the string, multiplying that weight. It is a **multiplier, not
a gate** — hard-to-type words are served less often, never excluded. This avoids
inventing a "typing ceiling" we have no data to calibrate, and it guarantees no
word is ever unreachable.

Its input improves in three stages, and the function signature never changes:

1. **Static keyboard cost**, available immediately. Same-finger bigrams, pinky
   reaches, row jumps, hand alternation — computed from `typing-game/js/keymap.js`,
   which exports `fingerFor(ch)`, `FINGER` and `ROWS` and is a verified
   transcription of the design file. Imported, not copied.
2. **Which keys the kid has been taught**, available today. The typing curriculum
   is sequential by keyboard region — `home`, `top`, `bottom`, `numbers`, `shift`
   — and `progress.js` already exports `allProgress(events)` over the typing log.
   A word containing `p` should not be pushed hard before the kid has reached the
   top row.
3. **Per-key error rates**, not yet built. Every typing `item` event carries
   `misses: [{expected, actual, pos}]` and, per that game's `next-steps.md` §2,
   **nothing reads it**. Folding it into a per-character rate is listed there as
   the cheapest next step; when it exists, this dial gets better numbers and
   nothing downstream changes.

Stage 1 ships in v1. Stage 2 is a small addition once there is real typing
history on the machine. Stage 3 belongs to the typing game and is a dependency,
not a blocker.

**`typingWeightFloor` (0.25) bounds the suppression**, so an awkward word is
served a quarter as often rather than effectively never.

## 4. Patterns are the route

The math game's hard-won lesson, from `learn-and-drill-modes-design.md`: *the
answer must always arrive with its derivation attached.* Math v1 shipped a reveal
that showed `42` with no route to it, and fixing that was most of v2.

Flash-and-hide has the same shape. Showing `friend` for two seconds and hiding it
is **copy practice** — it exercises a visual buffer that survives about ten
seconds and teaches nothing about why the word looks like that. It is the
spelling equivalent of a bare reveal, and it must not be the whole method.

The route for a word is its **pattern**. `patternsFor(word)` runs a table of
roughly 25 rules:

| kind | examples |
|---|---|
| rime families | `-at`, `-ig`, `-op`, `-ug`, `-ight`, `-ake`, `-all`, `-ing` |
| structural | silent `e`, doubled final `ll/ff/ss/zz`, digraphs `ch/sh/th/wh` |
| vowel teams | `ea`, `ee`, `oa`, `ai` |
| r-controlled | `ar`, `er`, `ir`, `or`, `ur` |
| affixes | `-tion`, `-ed`, plural `-s`/`-es` |

**Derived at load, not built.** It is a regex pass over a thousand words and
costs nothing, and a generated file would be one more thing to drift.

`patternsFor` is **total**: every word gets at least one tag. A word matching
nothing is tagged `irregular` — `said`, `one`, `friend`, `could` — and learn mode
tells the truth about it: *"this one you just have to remember."* For those
words flash-and-hide genuinely is the method, which is fine, because that is
actually how `said` is learned.

## 5. Audio, and the Merriam-Webster ingest

### What is gated and what is not

Verified against M-W's own documentation and terms, 2026-08-02:

- A **free API key** is required, with registration. The free tier is
  **non-commercial only**; commercial use requires contacting them and paying.
- **Two reference works per account**, **1000 queries/day/reference**.
- The **audio files themselves need no key**. They are served from
  `https://media.merriam-webster.com/audio/prons/en/us/mp3/<subdir>/<basename>.mp3`,
  where the subdirectory is: starts with `bix` → `bix`; starts with `gg` → `gg`;
  starts with a number or punctuation → `number`; otherwise the first letter.
- But the **basename is not derivable from the word**. It comes back in the API
  response as `prs[].sound.audio` and diverges from the spelling for homographs
  and multi-entry words. So the open CDN does not enable scraping; it is a plain
  fetch *after* the authenticated lookup.

**Register two references: Elementary (grades 3–5) as primary, Intermediate
(6–8) as fallback.** That doubles the daily budget to 2000 and covers the older
kid drifting past Elementary's ceiling.

### The ingest

`tools/fetch-words.js`, run by hand, resumable, never at play time.

- Key from the `MW_KEY` environment variable. **Never in the repo.**
- Writes `data/audio/<word>.mp3` and `data/words/<word>.json` (short definitions
  plus the usage sentence).
- Skips words already cached, so re-running is cheap and an interrupted run
  resumes.

**The spine is about 1050 words and the cap is 1000/day/reference**, so a full
ingest is a two-evening job rather than a one-shot script. The resumability is
not a nicety.

### Both cache directories are gitignored, and this is required

The M-W terms prohibit "copy, reproduce, distribute, or in any other manner
duplicate the Software, in whole or in part." Committing `data/audio/` to a repo
with a public origin would be redistribution. **You ship the ingest script; each
clone brings its own key and pulls its own cache.** That is what keeps an
open-source repo clean.

One grey area, recorded rather than papered over: **the terms do not address
caching at all.** Storing responses locally is what every normal API client does
and the product is plainly built for it, but it is not explicitly blessed. For
family use this is a non-issue; it deserves another look only if this ever stops
being a hobby project.

### The fallback matters more than it looks

When a word has no cached audio, drill falls back to the browser's
`speechSynthesis`. Consequences:

- The game is **playable the moment it exists**, with no key and no ingest. A
  stranger cloning the repo gets a working game.
- The ingest is allowed to **lag the spine** without ever breaking a session.
- M-W is the quality tier, not a hard dependency.

## 6. The two modes

The split, and the reasoning behind it, is inherited wholesale from
`learn-and-drill-modes-design.md`. Fluency and instruction want opposite
conditions, and cramming both into one ladder ruins each.

### Drill — fluency

Audio plays when the problem appears. **`Space` replays it** — words contain no
spaces, so the key is free. The kid types the word into the slots.

```
┌────────────────────────────────────────────┐
│                              7 / 20        │
│  ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░               │
├────────────────────────────────────────────┤
│              🔊  space to hear again       │
│                                            │
│         f  r  ▢  ▢  ▢  ▢                   │
│                                            │
└────────────────────────────────────────────┘
```

No hints, no patterns, no definitions. Same rule as math drill: teaching happens
in learn mode, and drill's only meaningful outcomes are "got it" and "didn't".

### Learn — instruction, blocked on one family

A session is **one pattern, cycled**: `learnWords × learnPasses`.

```
┌────────────────────────────────────────────┐
│  These are  - a t  words                   │
│                                            │
│         c a t      b a t      h a t        │
│                                            │
│            ▢ ▢ ▢        [ show me ]        │
└────────────────────────────────────────────┘
```

- **No clock anywhere.** Nothing is pushed at the kid.
- **The family stays on screen after the word hides.** This is the detail that
  stops flash-and-hide being copy practice: the kid rebuilds `hat` from `-at`,
  not from a two-second visual buffer. It is the direct analogue of the strategy
  staying visible in math learn mode.
- **"Show me" is press-and-hold.** The word is visible only while the button is
  held, so the kid must carry it in memory long enough to type it. Holding it
  means taking a hand off the keyboard, so peeking has a small physical cost —
  friction doing useful work.
- The M-W definition and usage sentence live here, as the meaning anchor.
- Blocked on purpose, exactly as math learn mode is: building a route needs
  consecutive reps, and interleaving actively interferes with acquisition.

Learn selects the coldest family with at least one word in the active window.

**When a family has fewer than `learnWords` words available**, it runs with what
it has and raises `learnPasses` to keep the item count steady — four words × 3
passes and three words × 4 passes are both twelve items. A family of one is
skipped in favour of the next-coldest, because a single word cycled twelve times
teaches no pattern and is just a spelling detention. Irregular words are the
common case here: `irregular` is a tag, not a family, so learn mode draws a small
set of unrelated irregulars and frames them honestly rather than pretending they
rhyme.

## 7. The loop and the input rule

Slots in **both** modes, and **no submit key in either** — identical to the math
game. Type letters; when the typed length reaches the word length, evaluate.

| Condition | Response |
|---|---|
| Typed string equals the word | Advance |
| Typed length reaches word length without matching | Wrong — respond (§7.2) |
| Typed length never reaches it | The reveal fires on its timer (§8) |

### 7.1 Why slots, despite the hint they give

Showing the letter count is a **substantially bigger hint than showing the digit
count** in math. It gives away doubled consonants (`hopping` vs `hoping`), silent
`e`, and `frend` vs `friend` — which is precisely the hard part of many words on
the spine.

Taken anyway, deliberately: **this is a fluency drill, not an assessment.** The
goal is reps that build retrieval, and a hint that costs nothing at the till is
cheap at this stage. It also keeps `core/engine.js` genuinely shared rather than
forked, since the terminal-condition logic is identical.

Slots-off with an explicit `Enter` is **test mode**, deferred to §16. That is the
place where measuring matters more than practising, and it should be a separate,
clearly-labelled activity rather than a setting that silently changes what the
numbers mean.

### 7.2 Wrong answers

The entry **pulses amber for ~400ms, clears itself, and one more letter is
revealed** (§8). A wrong answer buys help. Nothing is scored down, nothing is
left standing in red.

**Evaluation happens at full length; incorrect letters are never rejected as
they are typed.** The math spec rejected prefix-rejection to preserve the
confusion diagnostic, and the argument is stronger here: `thay` for `they`, `frend`
for `friend`, `becuase` for `because` are systematic, repeated, and by far the
most useful signal in the dataset. Misspellings cluster much harder than wrong
products do. Prefix rejection would reduce all of them to "typed an `a` third".

## 8. Progressive reveal

The math game reveals its answer whole. **Spelling reveals one letter at a
time**, left to right, greyed into the slots.

This is the real adaptation, and it falls out of the domain rather than being
imposed: the ladder has **N stages, where N is the word length**. Longer words
get proportionally more scaffolding, for free, with no rule needed.

Two timing values, because one cannot do both jobs:

| value | meaning | table |
|---|---|---|
| `delays` | time to the **first** letter | `cold 4000, warm 6000, hot 8000` |
| `letterStepMs` | gap between each letter after | `1200` |

`delays` is the retrieval window and keeps math's counterintuitive rule: **the
delay grows with mastery, it does not shrink.** A new word is rescued soonest,
which is what keeps acquisition errorless; a nearly-mastered one is made to work
for it, because at that point retrieval effort is the whole point. This is the
rule most likely to be reverted by accident and it is tested explicitly (§14).

`letterStepMs` is flat and brisk. Once the first letter has appeared the kid is
being walked through the word, not thinking, and a per-letter `delays` value
would take 32 seconds to spell out `elephant`.

### The clean-stage consequence

`stage` is `'clean'` when **zero letters were revealed**, and that is the only
evidence of retrieval. Because `deriveMastery` already keys on
`stage === 'clean'`, **the core's mastery logic needs no spelling-specific change
at all.** The letter count rides alongside as `revealed: n`.

## 9. Mastery

Unchanged from the core: last `retain` drill attempts per word, buckets derived
never stored, learn attempts excluded, confusions unwindowed, `taught` unwindowed.

**`hotMs` cannot be inherited from math.** 1500ms is the published automaticity
benchmark for retrieving one fact and pressing a key or two. Typing `friend` is
six keystrokes, and at a kid's typing speed the floor is several seconds before
any spelling knowledge is involved.

Starting at **4000ms**, explicitly a guess, and the first thing to retune against
real logs. `tools/replay.js` can test a change against collected history before
it reaches a kid.

Confusions are keyed word → set of misspellings, and are the most interesting
thing the log will hold.

## 10. The scheduler

Core's weighted sample, over `activeWindow` rather than the whole spine, with
weight `bucketWeight × typingCost`. Then the core constraints:

- **No repeat within `noRepeatWithin`.** The transpose guard is math-specific and
  simply has no analogue here; the adapter supplies no transpose.
- **Interference guard.** If `thay` has ever been typed for `they`, and `thay`
  happens to be a real word on the spine, the two are not served adjacently while
  either is cold. In practice this fires far less than in math, because most
  misspellings are not themselves words. Kept because it costs nothing and the
  cases where it does fire (`there`/`their`, `to`/`too`) are exactly the hardest
  ones.
- **Success governor.** Below `governorFloor` clean rate over `governorWindow`,
  inject a `hot` word. Same reasoning: this is what stops a bad night becoming
  twenty consecutive hard words.

## 11. The log

`data/spelling-log.jsonl`, via `/api/log?game=spelling`. The server's allowlist
gains one entry:

```js
export const LOG_PATHS = {
  math:     path.join(REPO_ROOT, 'data', 'math-log.jsonl'),
  typing:   path.join(REPO_ROOT, 'data', 'typing-log.jsonl'),
  spelling: path.join(REPO_ROOT, 'data', 'spelling-log.jsonl'),
};
```

`logPathFor` already resolves through `hasOwnProperty`, so `__proto__` cannot
name a path and an unknown game is a 400 rather than a fallback. No server change
beyond the one line.

```json
{"type":"attempt","t":"2026-08-02T15:04:05.123Z","build":"s1","session":"s_4a1c",
 "mode":"drill","word":"friend","ms":5210,"stage":"clean","revealed":0,
 "typed":["freind","friend"],"wrong":["freind"],"patterns":["irregular"]}
```

```json
{"type":"session","t":"2026-08-02T15:08:12.004Z","build":"s1","session":"s_4a1c",
 "mode":"drill","items":20,"cleanRate":0.55,"medianMs":4820,"frontier":63}
```

- `revealed` is how many letters had been given away when the word landed.
- `patterns` is **denormalised onto the event deliberately.** The rule table will
  change, and you want to know which tag was in force at the time rather than
  what today's rules would say about a two-month-old attempt.
- `frontier` on the session event is the spine index the window had reached — the
  single number that answers "is she progressing?"

### All logs become gitignored

`.gitignore` gains `data/*.jsonl`, and `data/math-log.jsonl` is untracked with
`git rm --cached`. Rationale: a clone should not carry the kids' history.

**This reverses math spec §14**, which committed that log deliberately so that
"what did this look like before we retuned the scheduler" was a `git show`. That
capability is genuinely lost. Two things worth knowing:

- `git rm --cached` stops *future* tracking; the file remains in existing history
  and a fresh clone still downloads it inside `.git`. Actually removing it means
  rewriting history, which for 9KB of latencies is not worth doing.
- If before/after comparison across a `build` bump turns out to matter, the cheap
  recovery is a one-off snapshot committed under `data/baselines/` while the live
  logs stay ignored.

This also aligns all three games on one rule, replacing the current split where
math is committed and typing is not.

## 12. Config

```js
export const CONFIG = {
  build: 's1',
  mode: 'drill',

  sessionLength: 20,

  learnWords: 4,        // one family, cycled
  learnPasses: 3,

  windowSize: 20,       // active frontier width

  retain: 5,
  hotMs: 4000,          // NOT math's 1500 — see §9
  maxPlausibleMs: 60_000,

  delays: { cold: 4000, warm: 6000, hot: 8000 },   // → first letter
  letterStepMs: 1200,                              // → each letter after

  weights: { cold: 6, warm: 3, hot: 1 },
  typingWeightFloor: 0.25,

  noRepeatWithin: 4,
  governorWindow: 8,
  governorFloor: 0.8,

  logTail: 2000,
};
```

Every quantity here is expected to change as the kids grow. None of it is
hard-coded anywhere else.

## 13. Architecture

```
kids-computer-learning/
  core/
    mastery.js        deriveMastery(events, config, space)      pure
    scheduler.js      weighted sample + constraints             pure
    engine.js         per-item input state machine              pure
    log.js            POST queue + outbox + serverIsUp
    space.js          the adapter contract, documented
  math-game/          becomes core's first consumer
    js/space.js       facts adapter
  typing-game/        unchanged this pass
    js/keymap.js      imported by spelling's typingCost
  spelling-game/
    index.html
    css/              base, layout, word, hints, results
    js/
      space.js        word adapter
      spine.js        the ordered word list
      patterns.js     the ~25 rules, patternsFor()             pure
      frontier.js     activeWindow()                            pure
      typing-cost.js  typingCost()                              pure
      audio.js        cached mp3, speechSynthesis fallback
      config.js
      main.js
      ui/
    tests/
  tools/
    replay.js         one tool, --game=math|spelling
    fetch-words.js    the M-W ingest
  data/               all *.jsonl gitignored; audio/ and words/ too
```

The pure core takes no DOM, no network and **no clock** — `now` is passed in.
That is what makes `tools/replay.js` able to run real history through a modified
scheduler offline, and it is the property most worth protecting during the
extraction.

### House rules adopted from the other games

- **Refuse to start rather than play with nowhere to save.** `serverIsUp()` gates
  the game, per typing commit `8a3c2f2`.
- **A `file://` guard** — a classic inline script in `index.html` that catches
  the blocked-modules case and says so in words a kid can read.
- **`build` stamped on every event**, bumped whenever weights, delays or
  thresholds change.

## 14. Testing

`node --test`, no harness, no dependencies.

The tests that earn their place:

- The extracted `core/` passes the math game's **ten existing test files
  unmodified**. This is the gate on the whole refactor.
- A wrong answer reveals **exactly one** more letter — not zero, not two.
- **The delay to the first letter grows with mastery**, and `letterStepMs` does
  not. The rule most likely to be silently reverted.
- `stage: 'clean'` requires `revealed === 0`. A word walked out letter by letter
  never counts as retrieval, however fast the typing was.
- `activeWindow` returns the first N non-`hot` words in spine order, **and a
  single permanently-cold word does not prevent the window advancing past it.**
- `patternsFor` is total — every word gets at least one tag, `irregular` if
  nothing else matches.
- `typingCost` is pure and never returns 0, so no word is unreachable.
- A word completes at the right length: `frend` for `friend` does not evaluate at
  five letters, it is one letter short and keeps waiting.
- Mastery derivation is deterministic — replaying the same log twice is identical.
- The ingest never writes outside `data/`, and never runs during play.

The reveal animation, the amber pulse and the press-and-hold are verified by
playing it. `typing-game/docs/next-steps.md` is emphatic on this point: four real
defects in that build were found by playing, none by 96 passing tests.

## 15. Rollout

Branch `spelling-game`, cut from `master`. In order:

1. **Extract `core/`**, math game as first consumer. Math's tests green,
   unmodified. Math's log client gains `serverIsUp()` and explicit `?game=math`.
2. **`.gitignore` and `git rm --cached`** for the logs. Separate commit.
3. **Build the spelling game** on the core.
4. **`games-menu.html` gains two cards** — **Learn Spelling** and **Spell It** —
   matching the Learn/Drill pair already there. Two entry points, one game, per
   the reasoning in `learn-and-drill-modes-design.md` §7: drill teaches nothing,
   so learn cannot be a buried setting.

The typing game is untouched in this pass beyond being imported from.

## 16. Deferred extensions

- **Test mode** — slots off, explicit `Enter`. The place where measurement
  matters more than practice. Must be a separate labelled activity, never a
  toggle that silently changes what the numbers mean.
- **Per-key error rates** from the typing log's unread `misses` array, feeding
  `typingCost` stage 3. Belongs to the typing game; its `next-steps.md` §2 lists
  it as the cheapest next step there.
- **A shared theme file.** Typing's `next-steps.md` §5 defers this until "a third
  game appears." The spelling game is the third game, so the trigger has fired —
  but it is a separate piece of work from this spec.
- **Homophone disambiguation** via the M-W usage sentence. `their`/`there` cannot
  be distinguished by audio alone, and this is the one place where the definition
  data becomes load-bearing rather than decorative.
- **The AoA/SUBTLEX pipeline**, if the Fry ordering proves too coarse. Kuperman
  and Brysbaert norms plus SUBTLEX frequencies would give a continuous difficulty
  score. Deliberately not built until the logs show the simple ordering failing.
- **Sentence dictation** — spelling a word inside a sentence, which is how
  spelling is actually assessed and which brings homophones and capitalisation
  into scope.

## 17. Open questions

- **Is 4000ms right for `hotMs`?** Almost certainly not; it is a placeholder
  chosen to be obviously too generous rather than obviously too strict. The
  first real question to ask the log is what the distribution of clean latencies
  actually looks like, and whether it separates into two modes the way the math
  latencies do.
- **Does the frontier advance at a sane rate?** `windowSize: 20` and the
  non-blocking rule are both guesses. The `frontier` field on the session event
  exists to answer this.
- **Is one family per learn session right, or too narrow?** Math uses three
  facts; a family is four words that rhyme, which may be so easy in-session that
  it teaches pattern-matching rather than spelling. Watch whether learn-mode
  performance predicts drill-mode performance at all — if it does not, the
  blocked structure is flattering the kid.
- **How much does `typingCost` actually matter?** The whole two-dial design rests
  on the claim that typing difficulty confounds spelling measurement. If the logs
  show clean latency is uncorrelated with `typingCost`, the dial can be dropped
  and the design simplifies considerably.
- **Whether a four-year-old can use this at all.** The honest answer is that
  nobody knows, and the design accommodates her rather than being built for her.
  If the keyboard turns out to be the binding constraint, letter tiles in learn
  mode is the fallback — deliberately not built now, because building it before
  watching her try would be designing for an imagined kid.
- **Is `irregular` demotivating as a label?** It is shown to the kid. "You just
  have to remember this one" is honest but may read as a shrug. The same concern
  the math notes raise about "shown how".
