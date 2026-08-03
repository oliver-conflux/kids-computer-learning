# Spelling game — probe and release

**Date:** 2026-08-03
**Status:** Approved design, ready for implementation planning
**Amends:** `2026-08-02-spelling-game-design.md` §3 (the frontier), §9 (mastery),
§10 (the scheduler)
**Closes:** `docs/next-steps.md` item 5, "A kid who already knows the words is
stuck proving it"

## Context

The complaint, from playing it: the game does not reach ahead. A speller getting
the early words right stays on the early words far longer than feels right.

The mechanism, from the code. `core/frontier.js` exposes the first
`windowSize: 20` words in spine order that are not yet `hot`. A word goes hot at
three clean attempts with a median under `hotMs`. Clearing a window therefore
costs a minimum of **60 correct answers**, and new words trickle in only as
individual words graduate. A kid who genuinely knows all twenty owes sixty
keystroke-heavy repetitions to earn ground she already held.

There is no placement test and never was. `core/frontier.js` says so on purpose —
*"no placement test — the log is the placement test"*. That is correct for a
returning player and vacuous on day one, when the log is empty, every word is
cold, and the window degenerates to spine positions 0–19: `at cat hat bat sat
mat an can man ran…`. Correct for a genuine beginner. Expensive for anyone else,
who pays ~168 correct answers to clear the hand-authored opener before reaching
a word that might be new.

### What the evidence here is, and is not

**The existing logs are not usable as evidence about the kid.** All 543 events in
`data/spelling-log.jsonl` and all 209 in `data/typing-log.jsonl` were recorded
2026-08-02/03 by an adult testing the game. Latency figures derived from them
describe adult typing and are not transferable — an adult's ~250ms per keystroke
against a seven-year-old's 500–800ms is the difference between every threshold in
the config being loose and every one of them being binding.

So the design below rests on **simulation against a synthetic learner**, not on
measurement. That is weaker evidence than this project usually accepts, and the
weakness is stated rather than smoothed over. What the simulation is good for is
comparing *policies against each other* under one consistent set of assumptions;
what it cannot do is set a constant. Every number here is a starting value to be
retuned once real sessions exist.

One measurement does survive, because it does not depend on who was typing: with
an empty log the window is spine positions 0–19, and every word in the catalogue
is `cold`. That is a property of the code.

## Goals

- A kid who can already spell a word proves it **once**, not three times.
- Words she cannot spell yet surface fast, and are drilled.
- Words far beyond her reach are **discovered** but not **drilled**.
- No test screen, no level setting, no visible difference in presentation.
- Placement is continuous, not a one-time phase, so it self-corrects as she grows.
- Everything stays derived from the log, so any constant here can be changed and
  all history re-read under the new value.

## Non-goals

- **Modelling per-word difficulty.** With one learner there is no population to
  calibrate against, so an item-difficulty parameter is unidentifiable. Difficulty
  is whatever she has trouble with, observed directly.
- **Reordering the spine.** Fry order is a proxy for difficulty and an imperfect
  one — the existing spec already records that frequency is not difficulty. This
  design tolerates a weak ordering rather than trying to fix it.
- **Replacing `learn` mode.** See §7.

## 1. The two decisions that must stay separate

The whole design is one distinction:

> **A miss produces information, not an obligation.**

Two questions were previously fused into one, and separating them is what makes
the rest work:

| question | answer | scope |
| --- | --- | --- |
| Which word do we show next? | **probe selection** | wide — the whole catalogue |
| Does a missed word become a drill word? | **admission control** | narrow — near her frontier |

Fusing them forces a false choice. Probe narrowly and you never discover that she
can already spell `necessary`. Probe widely with automatic admission and every
deep miss lodges in the drill set, consuming repetitions she cannot convert.

Split, both work at once: probe everywhere, admit selectively.

## 2. The four rules

1. **Every word is probed once**, drawn at random from the whole catalogue. A
   word answered correctly on its first sight, with no hint, is **marked** and
   never shown again.
2. **A word missed on first sight needs three clean answers to be marked**, and
   those three must **span at least two sessions**. Three in one sitting measures
   short-term memory; the point is retention.
3. **A miss is admitted to the drill set only if it lies within `margin` of the
   frontier cursor.** Otherwise it is **released** — recorded as missed and kept
   out of the drill set until the cursor has advanced past it, at which point it
   returns as a **drill** word.

   *Corrected during implementation, 2026-08-03.* This first read "returned to the
   probe pool to be re-probed", which was written while a re-probe was still
   expected to reset the word's first sighting. That reset was rejected (§7), so
   the miss stands, so the word already needs three clean answers — re-probing
   would spend a problem asking something already on file, and the first drill
   turn re-checks it for free. **The probe pool therefore holds only words she has
   never met.**
4. **The drill set is capped at 20.** Each session serves a fixed mix — about 16
   drill items and 4 probes — so probing never stalls behind clearing.

Rule 3 is the new one and it does the work. Rules 1 and 2 are the engine; rule 4
is bookkeeping.

## 3. The frontier cursor

A single integer, a spine position, **derived from the log** exactly the way
buckets are — never stored.

- Starts at 0 on an empty log.
- A probe answered correctly at position `p` moves it to `max(cursor, p - 40)`.
- A probe missed at position `p` moves it to `min(cursor, p + 180)`.

That is a transformed staircase: it climbs on evidence of competence and retreats
on evidence of a ceiling, converging on the region where she is roughly half
right. It replaces the placement test that was never built, and because it runs
continuously it keeps working as she improves rather than going stale.

The asymmetric step sizes are deliberate. A correct answer is strong evidence
(see §5), so the cursor advances confidently past it; a miss is weak evidence, so
the retreat is generous and provisional.

**There is no separate placement phase.** Random probing from an empty log *is*
the placement, and it terminates into ordinary play with no mode switch and
nothing for the kid to notice.

## 4. What the simulation says

A synthetic learner with a known competence curve, 3000 problems of budget, 12
seeds per cell. `wasted` counts drill attempts on words she has under a 10%
chance of getting.

**Releasing deep misses is the entire effect:**

```
probe policy   admit-rule     marked  tested  hard  deferred  wasted
sequential     admit all         830     849    19        0     358
random         admit all         759     763     3        0     479
random         RELEASE deep      870     995     3      122     178
```

Random probing is the *worst* policy when every miss sticks, and the *best* once
they do not — and it covers the whole catalogue while wasting under half the
attempts a sequential walk does.

**It holds at every level** (marked / wasted):

```
 kid level     margin=0    margin=120   admit-all
 beginner      728/147      676/186      601/609
 middle        945/120      870/178      759/479
 advanced      995/31       995/85       995/197
```

**Tighter margins are monotonically better** — 0 → 945/120, 120 → 870/178,
250 → 832/223, none → 759/479.

**The drill cap should not be raised.** 10 → 834 marked, 20 → 830, 40 → 821,
80 → 804. A larger working set spreads repetitions thin and converts less.

Two findings that killed earlier proposals and are recorded so they are not
re-proposed: bucket-level miss-rate estimation is indistinguishable from plain
sequential order (830 vs 830) because "easiest bucket with misses" resolves to
"earliest untested position" — and at three samples per bucket the rates are
noise anyway, since 2-of-3 carries a confidence interval of roughly 9% to 99%.

### What the simulation cannot tell you

- **The learning curve in it is invented** — a fixed increment per exposure. Real
  acquisition is not that shape.
- **`margin = 0` winning is probably an artifact of that curve**, which makes
  nearly-known words the cheapest thing to drill. Ship a margin of **60**, not 0,
  and retune.
- **Nothing about motivation.** A margin of 0 means she meets hard words only in
  probes, never in drill. That is defensible pedagogy and may still feel flat.

## 5. Why one correct answer is enough

Rule 1 marks a word off on a single observation, which is a strong claim from
thin data. It holds here for a reason specific to this game:

**Guessing is impossible.** You cannot produce `because` by chance. Free-recall
spelling has a guess probability of essentially zero, unlike the multiple-choice
settings the "three in a row" convention comes from, where a quarter of correct
answers are luck. A clean first-sight correct answer is therefore strong evidence
of retrieval.

**The converse does not hold.** Slip probability is *high* — typos, mishearings,
a moment's distraction. So a miss is weak evidence, which is exactly why rule 3
does not treat one as a verdict and rule 2 asks for three confirmations rather
than one.

The asymmetry is the design: **corrects are trusted, misses are investigated.**

## 6. What this changes in the code

Everything below is derived on read. No new stored state, no migration.

### `core/mastery.js` — a new terminal state

`marked` joins `cold | warm | hot`, and it is derivable: a word is marked if its
first-ever attempt was clean, or if it has three clean answers across two or more
sessions. Both are readable from events the log already carries — `stage` and
`session`.

`bucketFor` is unchanged. Marking is a separate predicate layered beside it, in
keeping with the module's rule that display states do not become fourth buckets.

### `core/frontier.js` — the exit changes, the module may not

The window exit becomes `marked` rather than `hot`. This is the change flagged in
the `hotMs` analysis: **progression stops being gated on typing speed.** At seven,
latency is dominated by motor skill, not spelling knowledge, and this project
already has a separate game for the motor half. `hot` remains, and keeps driving
serving weight (`weights`) and hint delay (`delays`) — fluency is still tracked,
it just no longer blocks advancement.

`frontier.js` takes the spine as a parameter deliberately — *"the rule has to be
runnable against something other than the shipped list"* — and `main.js:405`
already exploits that by passing `PLAYABLE`. The drill set and probe pool are
built the same way, by passing a different list. **It is possible this module
needs no edit at all.** Establish that during planning.

### `spelling-game/js/main.js` — the session mix

One session builds two lists: `drillIds` (the capped set) and `probeIds` (drawn
from the unprobed pool). The existing scheduler serves the drill items; probes
are interleaved at roughly the 16:4 rate. With an empty log the drill set is
empty and a session is all probes, which is what makes the first session double
as placement.

### `spelling-game/js/config.js`

```js
probeMargin: 60,        // how far past the cursor a miss may still be drilled
drillCap: 20,           // replaces windowSize as the working-set bound
probesPerSession: 4,
cursorStepUp: 40,
cursorStepDown: 180,
markSpanSessions: 2,    // rule 2: three corrects across at least this many
```

`windowSize` is retired. Bump `build` so before/after is a filter over the log
rather than a guess.

## 7. Interactions to settle during planning

**Homophones break rule 1, and this is not optional.** Drill flashes the word on
screen for `homophoneFlashMs` before a homophone is asked, because audio alone
cannot distinguish `sea` from `see`. A first-sight correct answer on a flashed
word is therefore partly *copying*, and marking it off on one observation would
retire 64 spine words on evidence that is not retrieval. **Homophones must take
the three-correct path regardless of how the first attempt goes.** Membership is
already in `js/homophones.js`, so this is a lookup.

**The exception cannot be written without a matching catch downstream — found
the hard way, 2026-08-03.** A homophone answered cleanly on first sight is not
marked (by this rule), was never missed so was never admitted to drill, and has a
first sighting so is not a probe. It falls through every set and vanishes:
unreachable and unmarkable, for up to 64 spine words. Running the first
implementation against the real log lost `there their so some would` exactly this
way. Two things prevent it: state drill membership **positively** — *a word she
has met and is not finished with needs drilling* — rather than as a union of the
routes that lead there; and assert that the sets partition the spine **exactly**,
not merely without overlap. An "at most one set" assertion passes happily while
five words sit in zero.

**Deferral does not reset first sight — decided 2026-08-03.** A word missed while
out of reach keeps that miss on its record. When it is re-probed later it takes
the three-correct path like any other missed word, even if the original miss
happened somewhere she had no chance.

Considered and rejected: treating a re-probe as a fresh first sight, on the
grounds that a miss outside her frontier says nothing about whether she knows the
word now. Rejected as complication that does not earn its keep. The cost is
bounded and small — roughly 120 deferred words in a full run, each paying two
extra repetitions, so on the order of 240 problems against a budget in the
thousands. Those repetitions land on words she demonstrably missed at least once,
which is not a bad place to spend them.

**Learn mode: the sparsity worry was measured and is unfounded; a bigger,
pre-existing problem sits behind it.**

The concern was that a drill set drawn from random probes would be too scattered
to form families. Measured over 400 samples of 20 words, it is not — a random
20-word set and a contiguous one yield near-identical families:

```
CONTIGUOUS (old window):  irregular 73%, blend-start 30%, silent-e 26%, ... -ot 2%
RANDOM (new drill set):   irregular 71%, blend-start 23%, silent-e 21%, ... -ed 1%
```

The big tags are spread across the whole spine, so any 20 words hit them. This
design costs learn mode nothing.

What the measurement did surface: **`irregular` wins 71–73% of the time under
both schemes, and rime families reach four words about 1–2% of the time.** The
spine carries 34 rime tags over 232 words, and 56 of those words are in the
hand-authored opener. So rimes are dense only in the opener, and past spine
position ~56 a 20-word window essentially never holds four words of one rime.
Learn mode therefore teaches by analogy for the opener and then degrades into
teaching `irregular` — which `next-steps.md` item 4 already describes as "not a
family". That is true today, is not caused by this design, and is not fixed by it.

**The fix, which this design should adopt: separate the target from the
siblings.** Learn mode currently builds its lesson from the window. Instead:

- the **target** is a word from the drill set — one she actually missed;
- the **siblings** are drawn from the whole spine, *including words already
  marked off*.

So a target of `hop` yields `hop shop stop drop` even though the siblings are not
in her window and she may already know them. That is how rime teaching works: the
words she owns are the analogy that cracks the one she does not. A lesson built
only from words she is failing has no scaffolding in it. At roughly 7 words per
rime family, siblings are almost always available, which takes rime lessons from
~2% to nearly always whenever the target carries a rime tag.

What remains is a **content** problem, not a scheduling one: a target tagged only
`irregular` has no route to teach, because there is no analogy for `of`, `they`
or `said`. That is item 4's split — Dolch sight words against genuinely irregular
spellings, and the `-ould` family hiding inside the bucket — and it is about the
word data.

**Retention of marked words is unchecked.** Rule 1 retires a word permanently on
one correct answer. Nothing ever revisits it. A cheap guard is to spend a small
share of probes — say 1 in 20 — re-probing already-marked words, which costs
almost nothing and is the only way decay would ever be visible. Recommended, not
yet specified.

## 8. Testing

The logic is pure and the existing suite's shape applies: thorough tests on the
derivation, none on the UI.

- **Cursor derivation** — a fixed event list produces a fixed cursor. No clock,
  no randomness, deterministic under replay.
- **Admission** — a miss inside the margin is admitted; a miss outside is
  deferred; the same miss is admitted once the cursor advances past it.
- **Marking** — first-sight clean marks; first-sight clean on a *homophone* does
  not; three corrects in one session do not; across two sessions do.
- **Deferral keeps the miss** — a released word re-probed and answered cleanly
  still needs the full three corrects, per §7.
- **Empty log** — a session is all probes and does not throw.
- **Everything marked** — the probe pool empties and the game says she is done,
  the way `activeWindow` returning `[]` is already handled.

`tools/replay.js` is math-only (`next-steps.md` item 7) and must be ported before
any constant here is tuned against real history. Note the related trap recorded
in item 6: the window is built from `PLAYABLE`, which is not a function of the
log, so replays are only reproducible if the item space is recorded alongside the
session. That applies to this design too — **log the probe pool size, or a hash
of the playable list, with each session event.**

## 9. Open questions

1. **`probeMargin = 60` — decided 2026-08-03, and expected to be retuned.**
   Deliberately biased away from the simulation's optimum of 0, because that
   optimum is suspected to be an artifact of the synthetic learner's flat
   learning curve (§4). Not an open question so much as a starting value: it
   costs nothing to change, since buckets derive on read and all history re-reads
   under a new value.

   **What to watch in real sessions.** If the drill set keeps running dry and she
   is mostly getting probes, the margin is too tight. If it sits pinned at 20
   full of words she has no traction on, it is too loose.
2. **Does the drill set need a floor?** If she is having a very good run it could
   empty, leaving a session of pure probes. Probably fine, possibly dull.
3. **Should probe rate scale with the drill set's size** — more probes when few
   words are stuck, fewer when she is struggling? Simple and untested.
4. **What replaces `hotMs` as a fluency signal** now that it no longer gates
   progression. The length-relative budget (`base + perLetter × length`) is the
   obvious candidate and needs her data, not an adult's.
5. ~~**Learn mode's family source.**~~ **Settled 2026-08-03** — measured, not
   reasoned. The drill set is no sparser in families than the old window was;
   learn mode draws its target from the drill set and its siblings from the whole
   spine. See §7. The residue is item 4's `irregular` split, which is a content
   question and out of scope here.
