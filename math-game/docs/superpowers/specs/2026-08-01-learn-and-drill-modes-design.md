# Learn and drill modes — design

**Date:** 2026-08-01
**Status:** Approved design, ready for implementation planning
**Amends:** `2026-08-01-math-facts-game-design.md` (v1). Where the two disagree,
this document wins. Everything v1 says that is not contradicted here still holds.

## Context

v1 shipped and was played. Two problems surfaced immediately, and they turned out
to be the same problem.

**The hints replaced each other.** By the time the answer appeared, the strategy
that would have got you there had gone. So the reveal stage showed `42` with no
route to it — exactly the flashcard failure the game exists to avoid.

**The hints arrived too fast.** Diagnosed first as a timing problem. It is not.

The real fault: **a strategy hint is not a cue, it is a task.** Blocks and the
reveal are perceived — you look, you have it. "6 × 6 = 36, add one more 6" is
work: recall 36, hold it, add 6. That is comparable effort to the original
problem. Putting a task on a rescue timer is self-defeating, because the clock
meant to help you is simultaneously counting down to the thing that makes your
effort pointless. The kid is asked to think and interrupted for thinking.

No delay value fixes that. Fluency practice and strategy instruction want
opposite conditions:

| | wants |
|---|---|
| **Fluency** | pressure toward speed, nothing to read, pure retrieval |
| **Strategy** | unhurried thinking, no clock, comprehension |

v1 crammed both into one ladder and each ruined the other. This splits them.

**Audience note.** The kids are homeschooled and this is a substantial part of
their maths instruction, not a supplement. Two consequences run through this
document: the learn side carries real instructional load rather than being a
fallback, and **every quantity here is tunable in `CONFIG` without touching
logic**, because session shapes will grow as the kids do.

## Goals

- Separate strategy instruction from fluency drilling so neither interrupts the
  other.
- Give the kid control over when the answer appears, rather than pushing it.
- Keep the two kinds of progress on separate scales, because they measure
  different things.
- Keep every session shape and timing value in the config table.

## Non-goals

- Any clock or countdown in learn mode. Not a long one — none.
- Merging the two scores into a single number.
- Changing the fact space, the log format's identity, the server, or the
  scheduler's constraint logic. All still v1.

## 1. Two modes

### Drill — fluency

The v1 loop, with **the `strategy` rung removed**. The ladder becomes
`clean → blocks → reveal`: every rung is perceptual, nothing has to be read.

Unchanged from v1: timed stage advance, latency scoring, mastery buckets,
interleaved scheduling, the anti-repeat and transpose guards, the interference
guard, the success governor, the 11 × 11 grid.

### Learn — instruction

**No clock anywhere.** Nothing is ever pushed at the kid.

- The **strategy is on screen from the start of each problem**, not held back as
  a rescue. A kid with no route to `6 × 7` will not invent one by staring at it,
  and making them fail first purely to be told afterwards is the discouraging
  version of the same information.
- **Blocks render alongside the strategy** where the product allows, not instead
  of it (§3).
- A **"show me the answer"** button reveals it on demand. The kid decides when.
- The answer, once revealed, stays visible along with the strategy.

## 2. Hints accumulate, never replace

In **both** modes, a hint that has appeared stays. Reaching the reveal stage in
drill mode shows the blocks *and* the answer; learn mode shows the strategy, the
blocks, and the answer together.

The answer must always arrive with its derivation attached. An answer alone is
the thing we are trying not to build.

Consequence for T8's layout: the reserved hint region was sized for the tallest
*single* hint (210px, from a 10-row block array). Accumulated hints need more
room, or a more compact arrangement — strategy text beside the block array rather
than above it. The reserved-space rule still holds: **the problem must not move
vertically when a hint appears.**

## 3. The two hint modalities are developmental, not sequential

This is why v1's single ladder felt wrong.

| | is | suits |
|---|---|---|
| **Blocks** | a concrete representation — see the quantity | a young kid, small products |
| **Prose** | a strategic one — derive from a known anchor | an older kid, any product |

They are **alternative representations for different developmental stages**, not
degrees of the same help. A six-year-old cannot use "6 × 6 = 36, add one more 6"
because they do not have 36 yet. A ten-year-old gets nothing from counting 42
squares. v1's ladder treated them as rungs, which is why they read as competing.

Skip-counting (`7, 14, 21, 28…`) is a natural third modality sitting between
them. Not built now; the structure accommodates it as a peer, not a rung.

## 4. Learn session shape

**3 facts × 4 passes = 12 items.** All three values live in `CONFIG` and are
expected to grow.

Fact selection: the coldest facts that **have strategy text**. That filter does
real work — `0 ×` and `1 ×` facts have no strategy at all, since there is no
route to teach for "anything times zero", so the trivial facts cannot enter learn
mode by construction. 78 of the 121 facts are eligible.

### Learn mode is deliberately blocked, and drill deliberately interleaved

The three facts cycle: `A B C A B C A B C A B C`, not twelve different facts.

This is the opposite of drill, on purpose. Blocked practice flatters performance
and harms *retention* — which is why drill interleaves. But for **acquisition**,
blocked is correct: building a route needs consecutive reps, and interleaving
actively interferes with it. Each mode gets the structure right for its own job.

### No success governor in learn mode

Drill mixes in mastered facts to hold the clean rate near 80%. Learn mode needs
no equivalent, because **the governor is a fix for failure and learn mode has no
failure**: the strategy is visible and the answer is a button press away, so
success is available at every moment.

The real risk in learn mode is **fatigue, not demoralisation** — ten hard facts
is tiring even when you succeed at all ten. That is what the narrow-and-repeated
shape addresses. Padding with easy facts would treat the wrong problem.

## 5. Scoring is separate, on separate scales

**Learn-mode attempts never feed the mastery buckets.** Not merely discounted —
excluded. A 20-second answer in learn mode is a successful derivation, not a slow
retrieval; counting it would drag the median and mislabel a fact the kid is
acquiring well.

Drill measures *retrieval speed*. Learn measures *whether a route was taught and
followed*. These do not share a scale and must not share a bucket.

### `mode` on the attempt event

```json
{"type":"attempt","mode":"drill", ...}
{"type":"attempt","mode":"learn","revealed":true, ...}
```

- `mode` is `'drill' | 'learn'`. **Absent means `'drill'`** — every v1 line
  predates this field and was a drill attempt, so the default reads existing
  history correctly with no migration.
- `revealed` (learn only) records whether the kid pressed "show me the answer"
  before answering. That is the learn-mode signal worth having: a fact answered
  without pressing it has a route that is starting to stick.
- `ms` is still recorded in learn mode. It is not used for buckets, but it is
  data and the log stores raw.

`deriveMastery` filters to `mode !== 'learn'` before folding. Because everything
derives on read, this applies retroactively across all history.

**Confusions are the exception.** Wrong answers from learn mode still count
toward `confusions` — interference between two facts is interference regardless
of which mode surfaced it.

## 6. The grid gains a fourth state

Three states cannot express the difference between "no idea where to start" and
"has a route, needs reps" — and that difference is exactly what says which mode
to send the kid to next.

| state | meaning | reached by |
|---|---|---|
| **not started** | never attempted | — |
| **shown how** | learn mode taught the route | a learn attempt exists |
| **getting there** | lands unhinted, slowly | drill: warm |
| **from memory** | fast, repeatedly | drill: hot |

"Shown how" is derived from the presence of learn-mode attempts, not from a new
bucket in the mastery model — `bucket` stays `cold | warm | hot` and the fourth
state is a display concern layered on top. A fact that is `cold` **and** has learn
attempts renders as "shown how"; `cold` with none renders "not started".

This keeps the mastery model unchanged and the scheduler untouched.

## 7. Play again

**v1 omission, not an implementation miss.** Spec §11 described what the results
screen *shows* and never specified a control to start another session, so the
session ended in a dead end requiring a page reload. The typing game spec has
`[ Again ] [ Next → ]` in its results mockup; it was not carried over.

The results screen gains:

```
[ Drill again ]   [ Learn 3 facts ]   [ Done ]
```

"Learn 3 facts" appears only when at least one eligible cold fact exists. Making
the next mode a one-click choice off the results screen is how the two modes stay
connected in use rather than being two separate things a kid has to know about.

## 8. Timing

Removing prose from drill dissolves the original complaint at its root — the
interruption existed because a *task* was on a rescue timer, and drill now has no
task rungs.

So the delays are only modestly raised, and deliberately not overhauled at the
same time as the structural change:

| bucket | v1 | v2 |
|---|---|---|
| cold | 2000 | 3000 |
| warm | 4000 | 5000 |
| hot | 6000 | 7000 |

Blocks still take a moment to count, which is what the bump covers. **This table
is the first thing to retune against real sessions** — it is one line in
`CONFIG`, and `tools/replay.js` can compare a change against collected history
before it reaches a kid.

The rule from v1 stands and is still the one most likely to be reverted by
accident: **the delay grows with mastery, it does not shrink.**

## 9. Config additions

All new quantities, in one place as ever:

```
mode:              'drill',   // default mode on launch
learnFacts:        3,         // distinct facts per learn session
learnPasses:       4,         // times each is cycled
delays:            { cold: 3000, warm: 5000, hot: 7000 },
```

`sessionLength` (20) continues to govern drill. Expected to grow once the kids
are used to it — that is a config edit, not a code change.

## 10. What does not change

Stated explicitly so implementation does not drift into it:

- The fact space, and `6 × 7` / `7 × 6` staying separate.
- The log as single source of truth; everything derived on read.
- The server, the launcher, the outbox, `tools/replay.js`.
- The scheduler's constraint logic — anti-repeat, transpose exclusion,
  interference guard, success governor — all still drill mode's.
- No countdown, timer bar, elapsed time, speed score, or comparison to anyone
  but the kid's own previous session. **Both modes.**
- Timestamps UTC `Z`; `now` in epoch milliseconds.

## 11. Open questions

- Whether "shown how" is the right label for a kid. It has to read as progress,
  not as a consolation state.
- Whether a learn session should end by offering an immediate short drill on the
  same three facts — pedagogically strong, since acquisition wants to be followed
  by retrieval, but it lengthens the sitting.
- Whether `revealed: true` should influence which facts learn mode picks next.
  Probably, eventually; it needs real data first.
