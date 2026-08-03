# Math menu and ordered mode — design

**Date:** 2026-08-03
**Status:** Approved design, ready for implementation planning
**Amends:** `2026-08-01-learn-and-drill-modes-design.md` (v2). Where the two
disagree, this document wins. Everything v2 says that is not contradicted here
still holds — in particular §1's rule that drill teaches nothing, and the
mastery seam that keeps instruction out of the buckets.
**Resolves:** `math-game/docs/next-steps.md` item 4, "A third mode: drill in
order — wanted, shape undecided", including all five of its open questions.

## Context

Two observations arrived together, and they turn out to unblock each other.

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
objection. The two pieces of work are one piece of work.

**Provenance.** Ordered mode is a preference about how practice should feel,
recorded while walking through the games, not a finding from play data. That is
a legitimate reason to build something and a bad reason to skip the design
conversation — hence this document. The menu change is a direct observation of
the shipped product.

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

When every fact in a row has peeled the run is empty, so the row renders as done
and links nowhere. No victory-lap replay: a button that starts a session with
nothing in it is the same failure the `canLearn` guard exists to prevent
(v2 §8), and the completed row is already the reward.

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
the peel point to the end:

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

An earlier draft started runs at `N×2` to avoid the trivia problem — `next-steps.md`
item 2 records that 0s and 1s are 36% of the fact space and that a fresh drill
log spent half a session on `8×0` and `9×1`.

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

## 3. Peeling

### The rule

> A fact is peeled when it was answered **unaided** in the last **two** ordered
> runs of its table that served it.

**Unaided** means `stage === 'strategy'` (the reveal button was never pressed)
**and** `wrong.length === 0` (right on the first typed value). Both are already
recorded on every AttemptEvent. No new attempt fields.

`orderedPeelRuns: 2` goes in `CONFIG`, so the rule is tunable like everything
else here.

### Why two runs and not one

One run is more responsive and would feel better. It is also wrong, because the
strategy is sitting on screen: "she did not press the button" can mean she read
`double 7 → 14` off the display. One weak signal would peel a fact permanently
off the front of the run, and she would never meet it again. Requiring two
separate visits does not eliminate that, but a lucky read does not usually
survive being asked a week later.

The cost is real and accepted: the 2s stay full length until her second visit.

### Why not the existing `hot` bucket

It would be the rigorous choice and there would be nothing new to invent — one
definition of "knows it" across the whole game. But `core/mastery.js:171`
excludes instruction-mode attempts from buckets by design, and §2 puts ordered
mode on that side of the seam. So ordered runs cannot produce `hot`, and a kid
who plays only ordered mode would see the 2s at eleven facts forever.

Peeling is therefore a **second, weaker, mode-local notion of knowing**, and that
is deliberate. It means "you can stop starting here", not "you have this from
memory". The scorecard is what makes the stronger claim.

### Peeling is prefix-only

The run starts at the first fact in the row that has not peeled. **Gaps survive.**
If `2×7` is known but `2×5` is not, the run starts at `2×5` and still contains
`2×7`.

Only the front moves. Plucking known facts out of the middle would shorten the
run faster and destroy the ordering, which is the one thing the mode sells.

### Peeling is permanent

A peeled fact stops being served, so its evidence freezes and it stays peeled.

This is a deliberate difference from mastery buckets, which decay as clean
attempts age out of the retain window. The two are measuring different things:
**a peel is a curriculum position, a bucket is a fluency claim.** If she slips on
`2×3` months later, the scorecard cell goes cold — that is the mechanism that
tracks slipping, and it is already built. The run does not need to re-lengthen
to say it, and a table that silently grew back to eleven would read as
punishment.

### Runs are grouped from attempts, not from session events

This is the load-bearing implementation decision in §3.

A SessionEvent is written only when a session **finishes** (`js/main.js:627`). A
run abandoned halfway therefore writes no session event at all, while its
attempts are already on disk. So peeling groups **ordered attempt events by their
`session` id**, and derives the table from `fact.a`. Nothing is looked up, and
nothing depends on a session having ended.

The consequence is the correct one: an abandoned run counts as evidence for the
facts she actually reached and contributes nothing for the ones she never saw.

---

## 4. Modules

### New: `math-game/js/ordered.js`

Pure. No DOM, no clock, no randomness — same shape and same reasons as
`learn.js`. Three exports:

```js
tableRow(n)              // the 11 facts, n×0 … n×10, in order
runFor(events, n)        // the facts to serve this visit; [] when done
tableProgress(events)    // [{table, peeled, total}] for the menu
```

`tableProgress` is what `menu.html` renders, so the menu and the game compute
peeling from one implementation. A second copy free to drift is exactly the
failure mode this project has hit twice already (the PRNG and the timestamp
comparator, per `next-steps.md:81`).

### New: `math-game/menu.html`

Reads the log through the existing `js/log.js` `loadEvents()` and renders §1.
Presentation only; every number on it comes from `tableProgress`.

**It must `await flushOutbox()` before `loadEvents()`**, in that order. This is
the same trap `js/main.js:710` documents: a previous session that lost the server
queued its events to the localStorage outbox, and reading the tail first means
the menu renders peel progress from a history missing everything the last session
recorded. The kid would finish a run and watch the bar not move. Getting the
order wrong fails silently — the log ends up complete on disk either way.

### Changed

| File | Change | Why |
|---|---|---|
| `core/mastery.js:171` | Exclude `mode: 'ordered'` from `attempts` / `cleanCount` / `medianCleanMs` / `bucket`, alongside `'learn'` | The strategy is on screen, so these timings are not retrieval and must not become a fluency claim |
| `core/mastery.js` | Ordered attempts **do** set `taught` and `taughtCount` | Ordered mode is instruction; a fact walked through in order should read "shown how" on the grid |
| `js/main.js:187` | Accept only `mode === 'drill'` or absent, replacing the current reject-list on `'learn'` | See below |
| `js/hints.js:46` | `ordered: ['strategy', 'reveal']` | Same rungs as learn |
| `js/main.js:98` | `MODES` gains `'ordered'` | |
| `js/config.js` | `orderedPeelRuns: 2` | |
| `js/main.js:95` | `MENU_URL` becomes `./menu.html` | Done should return to the game's own home, not skip past it to the top level. One click back to the main menu from there |
| `js/ui/results.js` | An ordered branch — see §5 | |
| `games-menu.html` | Two math cards become one | §1 |

**On `previousSessionMedian`.** It currently reads `if (event.mode === 'learn')
continue;` — a reject-list. An ordered session would pass straight through it and
be compared against a drill median, which is precisely the comparison v2 §5
forbids, and it would fail **silently**: a plausible number, no exception, no red
test. Inverting it to an accept-list closes the hole for ordered mode and for
whatever fifth mode arrives later.

---

## 5. Results screen

The results screen stays the hub it became in v2 §8. Ordered mode gets its own
branch on `summary.mode`, for the same reason learn needed one — the drill strip
would report `0% from memory` after every ordered session, a failure grade for a
session that cannot produce a `clean` rung at all.

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

The 11×11 grid below is **unchanged**. It is the one place that shows the whole
picture, and ordered mode does not get its own version of it.

---

## 6. Testing

Per the working style on this repo: thorough tests on logic, none on UI.
Everything decision-bearing in §3 is in a pure module for exactly that reason.

`tests/ordered.test.js`:

- Row construction, and that order never varies
- The unaided predicate — reveal pressed is not unaided; wrong-then-right is not
  unaided
- The two-run rule — one clean visit peels nothing, two consecutive peel,
  clean-then-missed does not
- **Prefix-only peeling** — the `2×7` known / `2×5` missed case from §3
- **Abandoned runs** — attempts present with no session event, evidence still
  counts for the facts reached and not for the rest
- A fully peeled table yields an empty run
- `tableProgress` agrees with `runFor` for every table

Extending existing suites:

- `deriveMastery` puts zero ordered attempts into any bucket, but **does** set
  `taught`
- `previousSessionMedian` ignores an ordered session
- `ladderFor(fact, CONFIG, 'ordered')` returns the two-rung ladder

### Mutation testing on the peel rule

`next-steps.md:220` records that **every real defect in this project passed a
green build**, and that mutation testing is one of the two habits that caught
them. The mutations that must fail something:

1. `orderedPeelRuns` 2 → 1
2. Peeling made non-prefix (known facts plucked from the middle)
3. Ordered attempts allowed into `cleanCount`
4. Runs grouped from session events instead of attempts — must fail the
   abandoned-run test

A test that passes against the broken version is theatre.

### Not needed

`tools/replay.js` requires nothing. Ordered mode touches no RNG and no
scheduler, so it has no config surface for replay to explore.

---

## 7. What this does not change

- The scheduler, and both existing modes' behaviour
- The mastery thresholds, the retain window, and `hotMs`
- The 11×11 grid and its four display states
- The event log format — ordered attempts are ordinary AttemptEvents with
  `mode: 'ordered'`, and `data/math-log.jsonl` needs no migration
- The two bugs in `next-steps.md` items 1 and 2, which remain open and are not
  addressed here
