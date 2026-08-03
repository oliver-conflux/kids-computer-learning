# Math game — next steps

Written 2026-08-02, after v2 (learn + drill modes) landed on `master`.

Each item says what it is, **why we think so**, and where to start. Items backed
by real play data are marked — those are worth more than the ones that came from
reasoning, because reasoning is what produced the bugs in the first place.

---

## 1. Learn mode manufactures interference — **found in real play**

**The bug.** Learn mode picks the three hardest eligible facts by difficulty
score. Difficulty clusters `6×7` (9), `7×6` (9) and `7×7` (10) at the top, so the
first session teaches all three together — and **two of them are 42 while the
third is 49**. The session cycles `49, 42, 42, 49, 42, 42…` and then acts
surprised when 42 comes back for the wrong one.

**The evidence** (`data/math-log.jsonl`, session `s_0d9b`, 2026-08-02):

```
7x7 = 49   learn   typed wrong: [42, 52, 42]
6x8 = 48   drill   typed wrong: [42]        (next session, same sitting)
```

42 was given for `7×7` twice, then again for `6×8` in the drill that followed.
The mode whose entire job is careful instruction is actively creating the
confusion the rest of the system is built to detect.

**Why it slipped through.** Drill has an interference guard — it will not serve
two facts adjacently while one's answer has been typed for the other. Learn mode
has no equivalent, because when it was specced the concern was *fatigue*, not
interference. Selecting purely by difficulty guarantees the collision.

**Where to start.** `math-game/js/learn.js`, `pickLearnFacts`. After ranking,
reject a candidate whose **answer equals** that of a fact already picked for this
session, and probably also one that is a near neighbour (shares an operand and is
adjacent in product). Note this trades against difficulty ordering: refusing
`6×7` and `7×6` in the same session means the session reaches further down the
list. That is the right trade — teaching two facts that collide is worse than
teaching one slightly easier fact.

Worth checking whether `6×7` and `7×6` should ever be taught in the SAME session
at all. They are deliberately separate facts with separate stats, but they share
an answer and a strategy, so teaching them together may be teaching one fact
twice while feeling like two.

---

## 2. Drill serves too much trivia on a fresh log — **found in real play**

**The bug.** On a fresh log every fact is `cold`, so the scheduler's bucket
weights are uniform and it samples evenly across all 121 facts. **36% of the fact
space is `0×` or `1×`.**

**The evidence** (`data/math-log.jsonl`, session `s_22fe`, build `m1`):

```
11 of 20 problems involved a 0 or a 1
 1 of 20 had both operands >= 6
```

Over half the first-ever session was spent typing answers to `8×0` and `9×1`.
The premise of the whole build is that the facts kids lack are a *small set*, and
the scheduler spends most of its early reps elsewhere.

**This is the same bug class as learn mode opening on `2×2`** — fixed there, not
noticed here.

**Nuance before fixing.** Drill is *supposed* to interleave easy facts: the
success governor mixes in mastered ones to hold the clean rate near 80%. But the
governor injects **`hot`** facts as a reward, and on a fresh log there are none,
so it degenerates to uniform random over a space that is a third freebies. The
fix is not "never serve easy facts" — it is that a cold `7×8` should outrank a
cold `8×0`.

**Where to start.** `math-game/js/scheduler.js`, the weighting step. Multiply the
bucket weight by the difficulty score already implemented in
`learn.js` (`OPERAND_DIFFICULTY`) — which probably means **lifting that table into
a shared module** rather than duplicating it. Duplicated tables have bitten this
project twice already (the PRNG and the timestamp comparator).

**Test it before shipping it.** `node tools/replay.js data/math-log.jsonl` runs a
changed config over the real sessions above and reports what would have been
served differently. That is exactly what it was built for and it has not yet been
used in anger.

---

## 3. Strategy dependency ordering — found during the build

Strategies lever off anchors: `6×7` is taught as *"6 × 6 = 36, add one more 6"*.
So strategies form a **dependency graph the difficulty ordering knows nothing
about**.

Observed: session 2 teaches `7×8` via `7×7`, which session 1 covered — correct by
luck. Session 1 teaches `6×7` via `6×6`, which is not taught until session 3 —
inverted.

Soft failure, since squares are often picked up early anyway. But ordering
anchors before their dependents would make the curriculum genuinely sequential
rather than accidentally so. Interacts with item 1: an interference guard changes
which facts land together, so do these two at the same time.

---

## 4. A third mode: drill in order — **wanted, shape undecided**

**What exists.** Both modes serve facts chosen by the scheduler: a frontier of
not-yet-hot items, sampled by bucket weight so cold facts come round more often.
That is the right machinery for building fluency, and it is deliberately not
sequential — the order a kid meets facts in is a function of what she does not
know yet.

**What is missing is the other way of practising.** Straight through, in order:
`2×2, 2×3, 2×4, 2×5, 2×6 …` and on through the threes, the fours. Marching a
table end to end is how most people actually learned these, and it gives a kid a
sense of place — where she is, how far in, what is coming — that a weighted
sample deliberately does not.

**And then the second half, which is the more interesting part.** Go through in
order, note what broke, and hammer *those* until they stick. Say she gets `2×8`
and `3×8`, then loses `4×8` and everything after it. Those are the reps she
needs, and they are identifiable precisely because the run was ordered — a
sequential pass makes the failure boundary visible in a way sampling never does.

**Open questions, all genuinely open:**

- **Is this a third mode, or a shape of drill?** A `?mode=order` alongside
  `learn` and `drill`, or a variation inside drill? Three cards on the menu is
  already a lot for one game.
- **Does an ordered run log the same way?** It has to — `core/mastery.js`
  derives everything from the event log and knows nothing about how an item was
  chosen. But an ordered pass is not a fluency measurement, and treating its
  timings as such would flatter or damage a kid's buckets for the wrong reason.
  Learn-mode attempts are already excluded from mastery for exactly this reason
  (`mastery.js`: "the two do not share a scale, so they must not share a
  bucket"). An ordered pass may need the same treatment, or its own third scale.
- **How does the follow-up round terminate?** "Drill those until you get them"
  needs a definition of *got it*. The obvious answer is the existing `hot`
  bucket, three clean attempts under `hotMs` — but that could take a long time
  inside a single sitting, and a kid who cannot get there needs an exit that is
  not failure.
- **Where does it start and stop?** All 121 facts is far too long a run. Per
  table (`the 2s`, `the 3s`) is the obvious unit and matches how the tables are
  talked about.
- **Does it fight the frontier?** The frontier exists so one stubborn fact cannot
  block progress. An ordered run is the opposite promise — you go through in
  order, including the ones you are bad at. Both are defensible; they should not
  silently disagree about what the kid is working on.

**Recorded while walking through the games, not from play data.** It is a
preference about how practice should feel, which is a legitimate reason to build
something and a bad reason to skip the design conversation.

---

## 5. Open questions needing a human, not a fix

- **The square strategy wording.** Added late so `7×7` would not be unteachable:
  `6×6` "5 x 6 = 30, add one more 6", `7×7` "5 x 7 = 35, then two more 7s",
  `8×8` "4 x 8 = 32, then double it". Arithmetic is test-verified; whether they
  *read* well to a 10-year-old is not something a test can answer.
- **Should `learn` be the default mode** when the URL carries no `?mode=`?
  Currently `drill`, which teaches nothing. Menu cards make it mostly moot.
- **Menu copy.** "the tricky times tables" quietly tells a kid these are the hard
  ones. Probably good framing; worth a second opinion.
- **Is 4 seconds of silence right** in drill? Real medians: v1 1598ms, v2 drill
  1562ms. So most problems resolve well before the window — the question is how
  the silence feels on the ones that do not.
- **`hotMs` is 1500ms**, the published automaticity benchmark, but an untested
  guess for these particular kids.
- **"Shown how"** as a grid label — has to read as progress, not consolation.

---

## 6. Deferred by design

- **Time on task, across all games.** The server is the natural home: it already
  sees every request from every game, so the typing game is covered without being
  modified. Two constraints recorded in the v2 spec §12 — time-in-tab is not
  time-on-task, and it must never be shown to a kid as a target.
- **The other three operations.** Problems are `{op, operands, answer}` and hint
  modalities carry applicability predicates, so addition/subtraction/division are
  content plus a stage set, not a rewrite.
- **Blocks for younger kids.** `blocksApply` exists and is learn-mode only. It
  becomes load-bearing when a younger sibling starts on addition.
- **Skip-counting** as a third hint modality, sitting between blocks and prose.
- **How to encourage longer sittings.** Chaining makes a long sitting *possible*;
  nothing makes it *attractive*. Solve only once logs show what a sitting actually
  looks like — and never as a streak or a target.

---

## 7. Housekeeping

- ~~**`games-menu.html` will conflict.**~~ **Resolved 2026-08-02.** The typing
  redesign merged after the math game landed, and git auto-merged the file —
  master's edits were in the two math cards, the typing branch's in the typing
  card and a trailing script. All three cards are present.
- **The typing game has its own list** at `typing-game/docs/next-steps.md`. One
  item there is cross-cutting: the server now routes `/api/log` by game through
  an allowlist, so it owns `data/math-log.jsonl` and `data/typing-log.jsonl`
  separately. A request with no `?game=` still means math, which is why the
  math client needed no change.
- **`master` is not pushed.** `origin/master` is still at the pre-math-game
  commit.
- **Ordered attempts carry no `revealed` field.** `toAttemptEvent` writes it for
  `mode: 'learn'` only, so ordered lines omit it although the button is on their
  screen too. Nothing is lost — `stage` already says whether it was pressed, and
  that is what both instruction rungs read — but a log reader comparing the two
  instruction modes by eye will notice the asymmetry. Left alone because
  `core/engine.js` is shared with spelling and this is a field nothing consumes.
- **The log is committed deliberately** (v1 spec §14) and now holds three real
  sessions — one v1, one learn, one drill. Do not clear it; it is the before/after
  baseline, and `build` tags separate `m1` from `m2`.

---

## What this project taught about process

Worth keeping, because it shaped how the whole thing was built:

**Every real defect came from an agent explaining its reasoning, or from a
reviewer executing mutations. None came from the test suite going red.** The
worst of them all passed a green build:

- the governor scored against *wrong* evidence rather than absent evidence
- `5xx` treated as permanent, silently discarding every event on a server error
- learn mode repeating the same three facts forever
- "0% from memory" after every learn session
- a strategy string teaching that `8 × 8 = 60`

Two habits that caught them: **agents writing down why they chose what they
chose**, and **mutation testing** — deliberately breaking the implementation to
see whether anything fails. A test that passes against the broken version is
theatre.

And one that did not: trusting a reviewer's silence. All four signalled idle
without reporting and delivered strong work only when chased.
