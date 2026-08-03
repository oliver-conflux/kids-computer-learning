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

## 4. ~~A third mode: drill in order~~ — **shipped 2026-08-03**

Design: `docs/superpowers/specs/2026-08-03-math-menu-and-ordered-mode-design.md`.
Plan: `docs/superpowers/plans/2026-08-03-math-menu-and-ordered-mode.md`. Read the
spec for the reasoning; this is only the summary.

**It is not drill.** That is the one thing this item got wrong, and everything
else followed from correcting it. A kid marching a table she has not learned
needs the route in front of her, so `?mode=ordered&table=N` borrows learn mode's
feel entirely — strategy on screen from the first frame, the answer behind a
button, no clock of any kind — and changes exactly one thing: which facts it
serves, and in what order. The scheduler is not called at all.

**What shipped.** A table is the row `N×0 … N×10` for `N` in 2–10, and the run is
that row from the first fact whose *ordered rung* has not cleared through to the
end. `math-game/index.html` with no `?mode=` now shows the game's own menu, which
carries all three routes and a progress bar per table. `games-menu.html` is back
to one math card.

**And the third thing, which was not in this item at all.** Specifying the mode
surfaced that learn mode had never measured anything: `taught` counts *sessions
that taught a fact*, so a kid walked through `7×8` four times who pressed "show
me the answer" every time was indistinguishable from one who got it unaided all
four. Every fact now carries a **rung record** for each of the three modes —
one measurement, can she produce this answer, taken at three levels of support —
and the detail panel shows all three.

**All five open questions were answered:**

- *Third mode or a shape of drill?* A third mode, and the objection ("three cards
  on the menu is already a lot") dissolved by giving math a menu of its own.
- *Does it log the same way?* Yes — ordinary AttemptEvents with `mode: 'ordered'`,
  no migration. It sits on the instruction side of the mastery seam beside learn,
  so its timings never reach a bucket.
- *How does the follow-up round terminate?* There is no follow-up round. A fact
  she missed does not peel, so it is at the front of the run next visit and the
  visit after — hammering happens across visits rather than inside a session.
- *Where does it start and stop?* Per table, eleven facts including the 0s and
  1s, which peel off the front after two visits rather than being skipped by a
  rule.
- *Does it fight the frontier?* No. The ordered rung is the weakest of the three
  and permanent for that reason; the two decaying rungs above it are the ones
  that notice a fact slipping. It means "you can stop starting here", never "she
  knows it".

---

## 5. Open questions needing a human, not a fix

- **The square strategy wording.** Added late so `7×7` would not be unteachable:
  `6×6` "5 x 6 = 30, add one more 6", `7×7` "5 x 7 = 35, then two more 7s",
  `8×8` "4 x 8 = 32, then double it". Arithmetic is test-verified; whether they
  *read* well to a 10-year-old is not something a test can answer.
- ~~**Should `learn` be the default mode** when the URL carries no `?mode=`?~~
  **Answered 2026-08-03: neither.** A URL with no recognised `?mode=` shows the
  game's own menu, and `CONFIG.mode` is retired. A kid arriving without a query
  string has not chosen a mode, and picking one for her was always a guess — the
  guess being `drill`, which teaches nothing.
- **Menu copy.** Still open, but it has moved: `games-menu.html` no longer says
  "the tricky times tables", because math is one card now. The wording that
  survives is on the game's own menu — "Shows you a way to work out three tricky
  ones" (`js/ui/menu.js`) — and it does the same quiet thing, telling a kid these
  are the hard ones. Probably good framing; worth a second opinion.
- **Everything the ordered mode and the rungs say is provisional copy**, written
  by an agent and verified only for arithmetic. Four places, all of which have to
  read as progress to a ten-year-old and none of which a test can judge:
  - the ordered results strip — "worked through, in table order", "every one of
    them right first time, no button", and the three sentences the table block
    picks between: "a fact drops off after two clean times through" on a first
    visit, "you can start past these now" partway, "the whole table — this row is
    done" at the end;
  - the three-rung block in the detail panel, headed "How much help you still
    need" and captioned "most help at the top", with `✓ · —` for
    cleared / not-yet / never-tried;
  - the rung lines themselves — "on your own 2 of 2 times through", "on your own
    1 of 4 tries with the strategy up", "not drilled yet";
  - the continuation button, "The 3s" or "The 2s again".

  The one worth arguing about first is the zero case. A perfect first visit to a
  table ends on "0 of 11", because a fact clears the ordered rung on the second
  unaided run and not the first. That is honest and it is also the least
  encouraging number on a screen that has just watched a kid get eleven answers
  right.
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
- ~~**The log is committed deliberately** (v1 spec §14).~~ **No longer true.**
  Commit `0df4845` untracked `data/math-log.jsonl` and ignores `data/*.jsonl`,
  reversing spec §14 on purpose: with the repo meant to be cloned, tracking it
  means shipping a real child's timestamped record of what they could not do to
  anyone who clones. The file stays on disk and stays in the history of earlier
  commits, so the v1 / learn / drill baseline is still recoverable with
  `git show 0df4845^:data/math-log.jsonl` — but a clone starts empty, and
  anything relying on the log being present has to say so.
- **`taughtCount` has quietly changed meaning — watch any copy that renders it.**
  Ordered attempts set `taught`, so ordered runs now pool with learn sessions in
  the count: three ordered runs plus one learn session on `6×7` gives
  `taughtCount: 4`. It has gone from "how many lessons" to "how many instruction
  occasions of either kind". The behaviour is correct — both are instruction —
  but any UI calling it a lesson count is now wrong. Nothing renders it today;
  the results detail panel is the place that would.

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
