# Math menu, ordered mode, and three rungs of support — design

**Date:** 2026-08-03
**Status:** Approved design, ready for implementation planning
**Amends:** `2026-08-01-learn-and-drill-modes-design.md` (v2). Where the two
disagree, this document wins. Everything v2 says that is not contradicted here
still holds — in particular §1's rule that drill teaches nothing, and the
mastery seam that keeps instruction out of the buckets.
**Resolves:** `math-game/docs/next-steps.md` item 4, "A third mode: drill in
order — wanted, shape undecided", including all five of its open questions.

## Context

Three observations arrived together, and they turn out to unblock each other.

**The main menu presents one game as two.** `games-menu.html` carries seven
cards, and math takes two of them — Learn Numbers and Drill Numbers. v2 §7 chose
that deliberately ("two entry points into one game, not two games") for a good
reason: drill teaches nothing, so learn cannot be a setting buried behind a
toggle or a kid takes the default forever and the hard facts are never taught.
The reason still holds. But the mechanism has run out of room, because the menu
is a flat list and math now wants a third entry.

**Ordered practice is missing.** Both existing modes serve facts chosen by the
scheduler — a frontier of not-yet-hot items, sampled by bucket weight. That is
the right machinery for building fluency and it is deliberately not sequential.
What it cannot do is march a table end to end: `2×2, 2×3, 2×4 …` and on through
the threes. That is how most people actually learned these, and it gives a kid a
sense of place — where she is, how far in, what is coming — that a weighted
sample refuses to give by construction.

`next-steps.md` recorded the strongest objection to a third mode as *"three
cards on the menu is already a lot for one game."* A math submenu dissolves that
objection.

**Learn mode has never measured anything.** This surfaced while specifying
ordered mode, from one question: *is she getting it in order, is she getting it
in learn, is she getting it in drill?* Drill answers that with buckets. Ordered
mode answers it below. **Learn answers nothing** — `core/mastery.js` gives it
`taught` and `taughtCount`, and both count *sessions that taught the fact*, not
outcomes. A kid walked through `7×8` four times who pressed "show me the answer"
every single time is indistinguishable from one who got it unaided all four.
True since v2, and invisible until the three modes were laid side by side.

§3 is the frame that came out of putting them side by side, and it is the idea
the rest of this document is organised around.

**Provenance.** Ordered mode is a preference about how practice should feel,
recorded while walking through the games, not a finding from play data. That is
a legitimate reason to build something and a bad reason to skip the design
conversation — hence this document. The menu change and the learn-mode gap are
both direct observations of the shipped product.

---

## 1. Two levels of menu

`games-menu.html` collapses its two math cards into one:

```
  ⌨️  Typing Game          ✖️  Numbers          📖  Learn Spelling   …
                                ↓
                        math-game/menu.html
```

**`math-game/menu.html`** is a new page and the only new page. Three routes out:

```
  Numbers

  💡  Learn 3 facts      →  index.html?mode=learn
      Shows you a way to work out three tricky ones.

  ✖️  Drill              →  index.html?mode=drill
      Practice what you already have a way to work out.

  🔢  In order           →  a table each, below
      Straight through a table, start to finish.

      the 2s   ▓▓▓▓▓▓▓▓░░░  8 of 11     →  index.html?mode=ordered&table=2
      the 3s   ▓▓▓▓░░░░░░░  4 of 11     →  index.html?mode=ordered&table=3
      the 4s   ▓░░░░░░░░░░  1 of 11
      the 5s   ░░░░░░░░░░░  not started
      …
      the 10s  ▓▓▓▓▓▓▓▓▓▓▓  done ✓

  [ Back to all games ]
```

### The table list lives on the menu, not behind another click

The picker is not a further screen. Putting the nine tables on the math menu is
what earns the page its existence — otherwise it is a router, and a router is
one more click between a kid and a game for no return. Here the menu does work:
the whole curriculum is visible at once and progress is legible **before** she
starts anything, which is the sense of place ordered mode exists to provide.
Losing that to a second click would be losing the point.

### Which table the kid plays is the kid's choice

Not the game's. The alternative — land her in the lowest unfinished table — has
less friction and enforces the sequence, but it takes away exactly what the mode
is for: she cannot see what is coming, and she cannot go back to the 3s because
she feels shaky about them. Both are things she should be able to do.

### A finished table is not startable

When every fact in a row has cleared the ordered rung the run is empty, so the
row renders as done and links nowhere. No victory-lap replay: a button that
starts a session with nothing in it is the same failure the `canLearn` guard
exists to prevent (v2 §8), and the completed row is already the reward.

### Card copy

Unchanged in spirit from v2 §7: these are **different activities, not difficulty
levels**, and the copy must not imply otherwise. "In order" is not the easy one
and drill is not the hard one.

### Out of scope

Spelling has the identical two-card split and the identical available fix. It is
not part of this work. Doing it later is a mechanical repeat of §1.

---

## 2. Ordered mode

A fourth mode, `?mode=ordered&table=N`, where `N` is 2 through 10.

It **borrows learn mode's feel entirely**: the strategy is on screen from the
first frame, the answer is behind a button, and there is **no clock at all** —
no reveal timer, no tick loop, no time pressure of any kind. It changes exactly
one thing: which facts it serves, and in what order.

This is the answer to `next-steps.md` item 4's framing, which called the mode
"drill in order". It is not drill. A kid marching a table she has not learned
needs the route in front of her; the ordering is what is new, not the removal of
help.

### Mechanics

- `MODES` in `js/main.js:98` gains `'ordered'`.
- `LADDERS` in `js/hints.js:46` maps `ordered` to `['strategy', 'reveal']` — the
  same two rungs as learn.
- `delayMs` is `null`, as in learn. Not a large number: nothing downstream may
  mistake it for a very patient timer.
- **The scheduler is not called.** `pickNext` plays no part. The item list is
  built up front by `ordered.js`, the way learn builds its session from
  `buildLearnSession`.

### The run

A table is the full row `N×0 … N×10`, eleven facts, and the run is that row from
the first uncleared fact to the end:

```
  the 2s, visit 3          2×4  2×5  2×6  2×7  2×8  2×9  2×10
  (2×0 … 2×3 have peeled)   1    2    3    4    5    6     7
```

Order is strictly ascending and never varies. No interleaving, no shuffling, and
**no re-inserting a missed fact later in the same run** — that would break the
sense of place the ordering exists to create, because "how far in am I" stops
being answerable when the bar no longer matches the table. The progress bar
counts the run, so `6 of 7` means what it says.

### Why the row is eleven facts and not nine

An earlier draft started runs at `N×2` to avoid the trivia problem —
`next-steps.md` item 2 records that 0s and 1s are 36% of the fact space and that
a fresh drill log spent half a session on `8×0` and `9×1`.

Peeling makes that rule unnecessary, and a rule you do not need is a rule that
will be wrong somewhere. A kid meets `2×0` and `2×1` on her first two visits to
the 2s, gets them, they peel off the front, and she never sees them again. The
run reaches the same place the hardcoded skip would have reached, without
asserting in advance which facts are beneath her.

### No second block inside the session

Item 4 imagined a follow-up round — go through, note what broke, hammer those.
Peeling already does this: **a fact she missed does not peel, so it is at the
front of the run next visit, and the visit after.** Hammering happens across
visits rather than inside a session. A second in-session mechanism would be two
things doing one job, and the run is short enough already.

### Coverage gap, stated rather than buried

Tables are rows 2–10, so ordered mode serves `2×0` but never `0×2`. The `a=0`
and `a=1` rows — 21 of the 121 facts — are reachable only through drill. They are
the trivia, so this is correct, but it means **"every table is done" and "the
grid is complete" are different statements** and neither implies the other. The
menu says tables; the scorecard says grid.

---

## 3. Three rungs of support

The organising idea, and the one that makes everything below fall out rather
than be invented.

The three modes are **not three parallel measurements**. They are one
measurement — can she produce this answer — taken at three levels of scaffolding:

```
  in order    strategy on screen, and she knows the last one was 2×6
              → context is carrying her.  WEAKEST evidence

  learn       strategy on screen, randomized, no sequence to lean on
              → the route is there, nothing else is

  drill       no hints, randomized, against a clock
              → pure retrieval.  STRONGEST evidence
```

Getting `2×7` in order is genuinely weaker evidence than getting it in learn,
which is weaker than getting it in drill. So the useful question is not "did she
get it" but **"at which level of support can she still get it"** — and that is a
thing worth showing a parent, because it says which mode to run next.

This reframing is load-bearing in three places:

- **Peeling stops being a special case.** It is simply the ordered rung. The run
  starts at the first fact whose ordered rung is not cleared. No separate
  concept, no apology for a second notion of knowing.
- **The learn gap becomes obvious and cheap to close.** Learn's ladder is
  `['strategy', 'reveal']`, *identical* to ordered's, so "unaided" already means
  the same thing in both. Learn is one counter away from being measured.
- **Permanence stops being awkward.** The ordered rung can be permanent
  precisely because it is the weakest rung and two decaying measures sit above
  it. A fact that peeled and then genuinely slipped shows up in the two rungs
  that are supposed to notice.

### Unaided

One predicate, used by the two instruction rungs:

> An attempt is **unaided** when `stage === 'strategy'` — the reveal button was
> never pressed — **and** `wrong.length === 0` — right on the first typed value.

Both fields are already on every AttemptEvent. **No new attempt fields, and no
log migration.**

### Clearing a rung

| Rung | Cleared when | Decays? |
|---|---|---|
| **in order** | unaided in the last `CONFIG.unaidedRuns` (2) ordered runs of its table that served it | no |
| **learn** | unaided in the last `CONFIG.unaidedRuns` (2) learn attempts of that fact | no |
| **drill** | `bucket === 'hot'` — the existing rule, 3 clean attempts under `hotMs` | **yes**, as clean attempts age out of the retain window |

The two instruction rungs share one rule and one config key. Drill keeps the
bucket it already has, because drill is the rung that was always measured
properly and nothing about it needs changing.

### Why two, and not one

One unaided answer is more responsive and would feel better. It is also wrong
for both instruction rungs, because the strategy is sitting on screen: "she did
not press the button" can mean she read `double 7 → 14` off the display. One
weak signal would clear a rung — and in ordered mode, peel a fact permanently
off the front of the run so she never meets it again. Requiring two separate
occasions does not eliminate that, but a lucky read does not usually survive
being asked again a week later.

The cost is real and accepted: the 2s stay full length until her second visit.

### Why the ordered rung is not the `hot` bucket

It would be the rigorous choice and there would be nothing new to invent — one
definition of "knows it" across the whole game. But `core/mastery.js:171`
excludes instruction-mode attempts from buckets by design, and §2 puts ordered
mode on that side of the seam. So ordered runs cannot produce `hot`, and a kid
who plays only ordered mode would see the 2s at eleven facts forever.

The rungs are deliberately of **different strengths**. The ordered rung means
"you can stop starting here". Only the drill rung claims she knows it.

---

## 4. Peeling

Peeling is the ordered rung applied to a row. Two properties beyond §3.

### Prefix-only

The run starts at the first fact in the row whose ordered rung is not cleared.
**Gaps survive.** If `2×7` has cleared but `2×5` has not, the run starts at `2×5`
and still contains `2×7`.

Only the front moves. Plucking cleared facts out of the middle would shorten the
run faster and destroy the ordering, which is the one thing the mode sells.

### Runs are grouped from attempts, not from session events

This is the load-bearing implementation decision in §4.

A SessionEvent is written only when a session **finishes** (`js/main.js:627`). A
run abandoned halfway therefore writes no session event at all, while its
attempts are already on disk. So the ordered rung groups **ordered attempt events
by their `session` id**, and derives the table from `fact.a`. Nothing is looked
up, and nothing depends on a session having ended.

The consequence is the correct one: an abandoned run counts as evidence for the
facts she actually reached and contributes nothing for the ones she never saw.

Note the asymmetry with the learn rung, which counts *attempts* rather than
*runs*, because learn sessions are randomized and a fact may appear more than
once in one. Ordered runs serve each fact exactly once, so run and attempt
coincide there.

---

## 5. Modules

### New: `math-game/js/ordered.js`

Pure. No DOM, no clock, no randomness — same shape and same reasons as
`learn.js`. Three exports:

```js
tableRow(n)              // the 11 facts, n×0 … n×10, in order
runFor(model, n)         // the facts to serve this visit; [] when done
tableProgress(model)     // [{table, cleared, total}] for the menu
```

Both take the MasteryModel rather than raw events, since §6 puts the rung
computation in `core/mastery.js` where every consumer already looks. `ordered.js`
is then purely about rows and prefixes.

### New: `math-game/menu.html`

Reads the log through the existing `js/log.js` `loadEvents()`, derives the model,
and renders §1. Presentation only; every number on it comes from
`tableProgress`.

**It must `await flushOutbox()` before `loadEvents()`**, in that order. This is
the same trap `js/main.js:710` documents: a previous session that lost the server
queued its events to the localStorage outbox, and reading the tail first means
the menu renders progress from a history missing everything the last session
recorded. The kid would finish a run and watch the bar not move. Getting the
order wrong fails silently — the log ends up complete on disk either way.

### Changed

| File | Change | Why |
|---|---|---|
| `core/mastery.js` | Per-fact `ordered` and `learn` rung records — see §6 | §3 |
| `core/mastery.js:171` | Exclude `mode: 'ordered'` from `attempts` / `cleanCount` / `medianCleanMs` / `bucket`, alongside `'learn'` | The strategy is on screen, so these timings are not retrieval and must not become a fluency claim |
| `core/mastery.js` | Ordered attempts **do** set `taught` and `taughtCount` | Ordered mode is instruction; a fact walked through in order should read "shown how" on the grid |
| `js/main.js:187` | Accept only `mode === 'drill'` or absent, replacing the current reject-list on `'learn'` | See below |
| `js/hints.js:46` | `ordered: ['strategy', 'reveal']` | Same rungs as learn |
| `js/main.js:98` | `MODES` gains `'ordered'` | |
| `js/main.js:95` | `MENU_URL` becomes `./menu.html` | Done should return to the game's own home, not skip past it to the top level. One click back to the main menu from there |
| `js/config.js` | `unaidedRuns: 2` | §3 |
| `js/ui/results.js` | Ordered branch on the strip; three-rung block in the detail panel — §7 | |
| `games-menu.html` | Two math cards become one | §1 |

**On `previousSessionMedian`.** It currently reads `if (event.mode === 'learn')
continue;` — a reject-list. An ordered session would pass straight through it and
be compared against a drill median, which is precisely the comparison v2 §5
forbids, and it would fail **silently**: a plausible number, no exception, no red
test. Inverting it to an accept-list closes the hole for ordered mode and for
whatever fifth mode arrives later.

---

## 6. The mastery model

Additive. Every existing field keeps its meaning, so nothing that reads the model
today needs to change.

Per fact, two new records:

```js
{
  // … existing: bucket, cleanCount, medianCleanMs, attempts, taught, taughtCount

  ordered: { runs: 2, unaided: 2, cleared: true  },
  learn:   { attempts: 3, unaided: 1, cleared: false },
}
```

- `runs` / `attempts` — how many times this rung has been tried at all
- `unaided` — how many of those met the §3 predicate
- `cleared` — the last-two rule from §3

`cleared` is stored rather than derived at the call site so that the rule lives
in exactly one place. Duplicated rules have bitten this project twice already
(the PRNG and the timestamp comparator, `next-steps.md:81`), and this one would
be duplicated across `ordered.js`, the menu, and the results panel.

**`taught` and `taughtCount` are unchanged and are not replaced.** They answer a
different question — *has she ever been shown a route* — which is what drives the
grid's "shown how" state, and it is deliberately unwindowed. A route taught three
weeks ago is still a route she has been shown, even if the learn rung has since
gone quiet.

Neither new record affects `bucket`. The mastery seam is untouched.

### Explicitly out of scope

`pickLearnFacts` currently prefers facts that are untaught. With a learn rung it
could prefer facts whose learn rung has not cleared, which is a better selector.
It is **not** part of this work: it touches `next-steps.md` item 1, the open bug
where learn mode teaches `6×7`, `7×6` and `7×7` together and manufactures
interference. Those two should be designed together, on their own, against the
real log.

---

## 7. Results screen

The results screen stays the hub it became in v2 §8.

### The strip

Ordered mode gets its own branch on `summary.mode`, for the same reason learn
needed one — the drill strip would report `0% from memory` after every ordered
session, a failure grade for a session that cannot produce a `clean` rung at all.

```
  Session done
  In order · the 2s

  7 answers            5 unaided           4 of 11
  worked through       no button needed    peeled now

  [ The 3s ]   [ Drill 20 ]   [ Done ]
```

`[ The 3s ]` is the next unfinished table, or `[ The 2s again ]` when this one
still has facts left. It is offered alongside drill, never instead of it — both
continuations after every mode, per v2 §8.

### The detail panel

Tapping a square gains the three-rung block. This is where the question that
started §3 actually gets answered:

```
  7 × 8 = 56                          getting there

  in order   ✓  unaided the last two times
  learn      ·  unaided once in three
  drill      ·  2 clean, typically 2.4s — 3 needed

  Last few tries
  [2.4s clean] [3.1s hint] [1.9s clean]
```

- A rung shows `✓` when `cleared`, `·` otherwise, and a `—` when never tried.
- The three lines read **top to bottom as increasing difficulty**, so the boundary
  between `✓` and `·` is the kid's current level of support, at a glance.
- Copy is provisional and goes on the "needs a human, not a fix" list in
  `next-steps.md` §5 — these have to read as progress to a ten-year-old, and no
  test can answer that.

**The grid itself is unchanged.** Cell colour still comes from the drill bucket,
because that is the rung that makes the real claim, and a grid coloured by the
weakest available evidence would flatter. The rungs live in the panel, where
there is room to be precise.

---

## 8. Testing

Per the working style on this repo: thorough tests on logic, none on UI.
Everything decision-bearing in §3, §4 and §6 is in a pure module for that reason.

`tests/ordered.test.js`:

- Row construction, and that order never varies
- **Prefix-only peeling** — the `2×7` cleared / `2×5` uncleared case from §4
- **Abandoned runs** — attempts present with no session event, evidence still
  counts for the facts reached and not for the rest
- A fully cleared table yields an empty run
- `tableProgress` agrees with `runFor` for every table

`tests/mastery.test.js`, extended:

- The unaided predicate — reveal pressed is not unaided; wrong-then-right is not
  unaided
- The last-two rule on **both** instruction rungs — one unaided clears nothing,
  two consecutive clear, unaided-then-missed does not
- The learn rung counts attempts, the ordered rung counts runs, and a fact served
  twice in one learn session counts twice
- Zero ordered attempts reach any bucket, but they **do** set `taught`
- A fact with no history has both rungs at zero and `cleared: false`

Elsewhere:

- `previousSessionMedian` ignores an ordered session
- `ladderFor(fact, CONFIG, 'ordered')` returns the two-rung ladder

### Mutation testing on the rung rules

`next-steps.md:220` records that **every real defect in this project passed a
green build**, and that mutation testing is one of the two habits that caught
them. The mutations that must fail something:

1. `unaidedRuns` 2 → 1
2. Peeling made non-prefix (cleared facts plucked from the middle)
3. Ordered attempts allowed into `cleanCount`
4. Ordered runs grouped from session events instead of attempts — must fail the
   abandoned-run test
5. `unaided` ignoring `wrong.length`, so a wrong-then-right attempt clears a rung

A test that passes against the broken version is theatre.

### Not needed

`tools/replay.js` requires nothing. Ordered mode touches no RNG and no
scheduler, so it has no config surface for replay to explore.

---

## 9. What this does not change

- The scheduler, and both existing modes' behaviour
- The mastery thresholds, the retain window, `hotMs`, and every existing field on
  the model
- The 11×11 grid and its four display states
- The event log format — ordered attempts are ordinary AttemptEvents with
  `mode: 'ordered'`, and `data/math-log.jsonl` needs no migration
- `pickLearnFacts`, per §6
- The two bugs in `next-steps.md` items 1 and 2, which remain open and are not
  addressed here
