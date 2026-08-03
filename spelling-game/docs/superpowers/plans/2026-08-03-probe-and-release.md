# Probe and release — implementation plan

**Spec:** `spelling-game/docs/superpowers/specs/2026-08-03-probe-and-release-design.md`
**Branch:** to be cut from `master`
**Execution model:** agent teams, wave-based, orchestrated — the same model as
`2026-08-02-spelling-game.md`. Not subagent-driven-development.

**Goal:** Stop making a kid prove three times over that she can spell a word she
got right the first time, and stop drilling words that are far beyond her.

**Architecture:** Two decisions that were fused get separated. *Probe selection*
goes wide — every word in the catalogue, in random order. *Admission to drill*
goes narrow — a missed word only becomes a drill word if it sits near a frontier
cursor derived from her history. Everything stays derived from the log on read,
so every constant here can be changed later and all history re-read under the new
value.

**Tech stack:** Vanilla ES modules, zero dependencies, `node --test` (Node 22).

---

## How this plan is executed

**Waves, not tasks.** Tasks inside a wave may run in parallel. A later wave may
not start until the previous wave's gate has passed.

**Gate A after Wave 1 is non-negotiable.** Wave 1 is pure derivation and every
later wave reads its output. An error there is invisible in the UI and corrupts
everything downstream. It gets a dedicated code review.

**On code samples:** this plan contains almost none, per house convention.
Implementers are capable engineers. What they cannot infer — **interfaces** and
**house conventions** — is stated exactly below.

**On discovering patterns:** where this plan says *"follow the pattern in X"*, go
read X. Three agents inventing three idioms for the same thing is the main risk
in a multi-agent build.

**Escalate rather than comply.** If a task as written is wrong or blocked, stop
and say so. Do not quietly diverge.

---

## Global constraints

Every task inherits the constraints in `2026-08-02-spelling-game.md`
§Global constraints — read them. They are unchanged. The ones this work touches
most:

- **Pure modules take no DOM, no network, no clock, no randomness.** Randomness
  arrives as an injected `rng`. This is what keeps `tools/replay.js` possible and
  it is the property most worth protecting in this plan specifically, because the
  whole design is a derivation.
- **`config` is a parameter, never an import, in pure modules.**
- **Every quantity lives in `CONFIG`.** No magic numbers in logic files.
- **A corrupt log line must never break a session.** Skip it silently.
- **Comments explain why, not what.** `core/mastery.js` is the voice reference.
- **`build` is stamped on every event.** Bump it to `s2` in this work — the
  scheduling rules change, so before/after must be a filter over the log rather
  than a guess.

New for this plan:

- **Nothing about placement is stored.** Cursor, marking, admission and deferral
  are all recomputed from the log on every read, exactly as buckets are. If any
  of them ends up written into the log as a decision, the design has failed —
  `probeMargin` becomes unretunable and history becomes unreadable under a new
  value.

---

## Read-first map

| Working on | Read first | Why |
|---|---|---|
| anything pure | `core/mastery.js` | comment voice, JSDoc style, purity discipline, the "derive on read" doctrine |
| the derivation additions | `core/mastery.js:227-382` | how `taught` is accumulated unwindowed — the exact pattern Task 1.1 copies |
| the item-space seam | `core/space.js`, `spelling-game/js/space.js` | why `mastery.js` never learns what a word is |
| spine positions | `spelling-game/js/spine.js:191` | `spinePositionOf` already exists; do not write a second one |
| homophones | `spelling-game/js/homophones.js` | the set Task 1.2 consults |
| session wiring | `spelling-game/js/main.js:396-500` | where `activeWindow` is called today and what a session does with it |
| learn sessions | `spelling-game/js/learn.js` | family grouping, and the `taughtCount` scoring Task 3.1 must not break |
| replay | `tools/replay.js` | math-only today; Task 4.1 generalises it |

Required reading, once, for every implementer: the spec above, and
`docs/next-steps.md` items 4, 5 and 6 — item 6 in particular, because Task 2.4
exists to close it.

---

## Interface contracts

Names and shapes here are fixed. Anything not listed is the implementer's choice.

### `core/mastery.js` — three new raw facts, still item-agnostic

`ItemStats` gains three fields. All three are **unwindowed** — computed over the
full event list, not the `retain` window — for the same reason `taught` is: the
first sighting of a word is a fact about all of history, and `retain: 5` would
let it age out.

```
firstAttempt:   { t, ms, stage, session } | null   earliest DRILL attempt ever
cleanSessions:  number    distinct sessions containing >= 1 clean drill attempt
cleanTotal:     number    total clean drill attempts, unwindowed
```

The existing windowed `cleanCount`, `medianCleanMs` and `bucket` are **unchanged**
and keep driving serving weight and hint delay. Learn-mode attempts stay excluded
from all three new fields, per the module's existing mode split.

`mastery.js` does not know what "marked" means and must not learn. It reports
facts; the marking rule lives in Task 1.2 because it needs the homophone list.

### `spelling-game/js/placement.js` — new pure module

```
derivePlacement(model, spine, config, needsFullProof) -> Placement

Placement {
  cursor:     number          spine position
  marked:     Set<ItemId>     finished with; never shown again
  drill:      ItemId[]        met, not finished; spine order; length <= config.drillCap
  pending:    ItemId[]        met, not finished, no drill slot yet; spine order
  deferred:   Set<ItemId>     missed while out of reach
  probePool:  ItemId[]        never met; spine order
}
```

**The five sets PARTITION the spine — every word is in exactly one, always.**
Assert this from both sides. "At most one" is not enough: the original assertion
was `<= 1` and it passed while five real words sat in zero sets. See Task 1.2's
found-bugs note.

- `model` is a `MasteryModel` from `deriveMastery`.
- `spine` is passed in, never imported — same reason `frontier.js` takes it.
- `needsFullProof(word) -> boolean` is injected, so the module stays testable
  without the homophone list.
- Pure. No clock, no randomness, deterministic under replay.

**Marking rule.** A word is marked when either holds:

- its `firstAttempt.stage === 'clean'` **and** `needsFullProof(word)` is false; or
- `cleanTotal >= 3` **and** `cleanSessions >= config.markSpanSessions`.

The homophone exception is load-bearing, not a nicety: drill flashes a homophone
on screen before asking, so a first-sight correct answer there is partly copying.
Without the exception this rule retires 64 spine words on evidence that is not
retrieval.

**Cursor rule.** One forward pass over every item that has a `firstAttempt`,
sorted by `firstAttempt.t` ascending, ties broken by spine position. Starting at
0, for each, with `p = spinePositionOf(word)`:

- clean → `cursor = max(cursor, p - config.cursorStepUp)`
- otherwise → `cursor = min(cursor, p + config.cursorStepDown)`

**Admission**, decided in the same pass, using the cursor value **before** that
attempt's update. A non-clean first attempt at position `p` is admitted when
`p <= cursor + config.probeMargin`, and deferred otherwise.

**Deferred re-entry — corrected during execution.** A deferred id rejoins as a
**drill** word once `p <= cursor + config.probeMargin`, not as a probe. The spec
said probe; that was written while a re-probe was still expected to reset the
word's first sighting, and the reset was rejected on 2026-08-03. Given the miss
stands, the word already needs three clean answers, so probing it again spends a
problem asking something already on file — and the first drill turn re-checks it
for free. Recomputed each read, so nothing is written.

**`probePool` therefore holds only words she has NEVER met.** A word she has met
is a word we have evidence about, and evidence is drilled or deferred rather than
re-asked.

**A deferred word keeps its miss.** When re-probed and answered cleanly it still
takes the three-correct path. Decided 2026-08-03; see spec §7. Do not "fix" this.

**`probePool` order is spine order, not random.** Randomness belongs to the
caller, which injects an `rng`. A pure module must not shuffle.

### `spelling-game/js/config.js` — new keys

```
probeMargin:       60     how far past the cursor a miss may still be drilled
drillCap:          20     working-set bound; replaces windowSize
probesPerSession:  4      probes per sessionLength problems
cursorStepUp:      40
cursorStepDown:   180
markSpanSessions:  2      three corrects must span at least this many sessions
```

`windowSize` is **removed**, not left dangling. `build` goes to `s2`.

### What does not change

- **`core/frontier.js` is not edited.** Spelling stops calling `activeWindow` and
  calls `derivePlacement` instead; math keeps using it unchanged. Confirm this
  during Wave 2 rather than assuming it — if an edit turns out to be needed,
  escalate, because that module is shared.
- **`core/scheduler.js` is not edited.** It still picks among candidates by
  weight; the candidate list is now `placement.drill`.
- **`hotMs` and the `cold|warm|hot` buckets stay** and keep driving `weights` and
  `delays`. They stop being the window exit. Retuning `hotMs` is out of scope and
  needs the kid's own data — see spec open question 4.

---

# Wave 1 — Derivation

Pure, fully tested, no UI. This is the whole design; everything after it is
wiring.

### Task 1.1 — `core/mastery.js` gains the three raw facts

**Files:** modify `core/mastery.js`; create `core/tests/mastery.test.js`.

Note the existing test location: `core/mastery.js` is currently exercised through
`math-game/tests/mastery.test.js`, because `math-game/js/mastery.js` is a binding
shim. **Leave that file alone** — it pins math's behaviour and must keep passing
unchanged. New coverage goes in `core/tests/mastery.test.js`, matching
`core/tests/frontier.test.js`.

Accumulate the three fields in the existing forward pass, alongside `taughtIds`
and `taughtSessionsById`. Follow that pattern exactly — it is already the
unwindowed accumulator this needs.

Tests, all written before the implementation:

- `firstAttempt` is the earliest drill attempt by `t`, **not** file order — feed
  events out of order and assert it.
- `firstAttempt` is `null` for an untouched word, and `byId` stays total.
- A learn-mode attempt is never `firstAttempt`, and never counts toward
  `cleanSessions` or `cleanTotal`.
- An attempt older than the `retain` window still supplies `firstAttempt` — this
  is the whole point of the field.
- `cleanSessions` counts distinct sessions, so three cleans in one session gives
  1, and one clean in each of three sessions gives 3.
- An attempt with a missing or non-string `session` is its own session, matching
  the `#loose` handling `taughtSessionsById` already uses.
- A clean attempt above `maxPlausibleMs` does not count toward `cleanTotal`, for
  the same reason it does not count toward `cleanCount`.
- Corrupt lines are skipped and none of the three fields is poisoned.
- **Regression:** `bucket`, `cleanCount` and `medianCleanMs` are byte-identical
  to before on a fixture log. Run `math-game/tests/mastery.test.js` green.

### Task 1.2 — `spelling-game/js/placement.js`

**Files:** create `spelling-game/js/placement.js`, `spelling-game/tests/placement.test.js`.

Implements the contract above. Read `core/mastery.js` first for voice and purity
discipline, and `spelling-game/js/spine.js:191` for `spinePositionOf` — do not
write a second position lookup.

Tests, written first:

- **Empty log** — cursor 0, everything cold, `drill` empty, `probePool` is the
  whole spine, `marked` and `deferred` empty.
- **Marking, first sight** — one clean first attempt marks a non-homophone.
- **Marking, homophone exception** — the same clean first attempt on a word where
  `needsFullProof` returns true does *not* mark it.
- **Marking, three-correct path** — three cleans in one session do not mark; the
  same three spread over two sessions do.
- **Cursor climbs** on a clean probe and **retreats** on a miss, by exactly
  `cursorStepUp` / `cursorStepDown`.
- **Cursor is order-dependent on `t`, not file order** — shuffle the fixture and
  assert the same cursor.
- **Admission** — a miss at `cursor + probeMargin` is admitted; at
  `cursor + probeMargin + 1` it is deferred.
- **Admission uses the pre-update cursor** — construct a case where post-update
  would differ and pin the pre-update answer.
- **Deferred re-entry** — a word deferred early appears in `probePool` once later
  cleans have advanced the cursor past it.
- **A re-probed deferred word keeps its miss** — answering it cleanly does not
  mark it; it needs the full three corrects.
- **`drill` is capped** at `drillCap` and is in spine order.
- **`drill` excludes marked words.**
- **Determinism** — same events, same output, twice.
- **Totality** — every spine id appears in exactly one of marked / drill /
  deferred / probePool, or none, and never two.

### Task 1.3 — Config

**Files:** modify `spelling-game/js/config.js`.

Add the six keys with the values above and a comment on each saying *why* that
value, in the voice of the existing `hotMs` comment. `probeMargin` in particular
must record that it is deliberately not the simulation's optimum of 0, and why —
see spec §4 and open question 1.

**`build` is NOT bumped in this task — corrected during execution.** Wave 1 adds
derivation that nothing calls yet, so play is byte-identical until Task 2.1 wires
it in. Stamping `s2` on events produced by `s1` rules is precisely the confusion
`build` exists to prevent. **Bump it in Task 2.1**, with the change that alters
what the kid actually sees.

**`windowSize` is NOT removed in this task — corrected during execution.** It is
still called by `main.js:405`, `main.js:490` and two cases in
`spelling-game/tests/learn.test.js`, which Waves 2 and 3 own. Deleting a config
key ahead of its consumers leaves the game broken between two commits, and the
wave model exists so that every wave ends on working software. Mark it retired
with a comment naming `drillCap` as its replacement, and **delete it in Task 2.1
alongside the last `activeWindow` call.**

---

## ▶ GATE A

Wave 2 may not begin until this passes.

- `node --test` green across the whole repo, including both other games.
- A reviewer reads `placement.js` against spec §2, §3 and §7 and confirms the
  marking rule, cursor rule, admission rule and homophone exception each match.
- **Purity audit:** no `Date`, no `Math.random`, no DOM, no imports of `CONFIG`
  inside `placement.js`.
- **Derivation audit:** grep the diff for anything that writes placement state
  into the log. There must be nothing.
- Hand-run `derivePlacement` against the real `data/spelling-log.jsonl` and
  eyeball the cursor and drill set. That log is an adult testing, not the kid, so
  the numbers mean little — but it will catch a crash or an absurd cursor.

---

# Wave 2 — Session assembly

### Task 2.1 — `main.js` builds sessions from placement

**Files:** modify `spelling-game/js/main.js`.

Replace the `activeWindow` call at `main.js:405` (and the re-derive at `:490`)
with `derivePlacement`. The scheduler's candidate list becomes `placement.drill`.
Confirm and record in the commit message that `core/frontier.js` needed no edit.

### Task 2.2 — Probe interleaving

**Files:** modify `spelling-game/js/main.js`.

Every `sessionLength / probesPerSession`-th problem is a probe, drawn from
`placement.probePool` with the injected `rng`. Probes are otherwise
indistinguishable — same audio, same reveal ladder, same logging. **Nothing in
the UI may mark a problem as a probe.** The kid must not be able to tell.

When `placement.drill` is empty — which is the state of a fresh log — the session
is all probes. That is what makes the first session double as placement, so do
not special-case it.

### Task 2.3 — The end state

**Files:** modify `spelling-game/js/main.js`.

When `drill` and `probePool` are both empty she has finished the catalogue.
Follow the existing "You have spelled every word we have!" notice at
`main.js:413-419` — same shape, same tone. Do not throw.

### Task 2.4 — Record the item space on every session event

**Files:** modify `spelling-game/js/main.js`, `spelling-game/js/log.js`.

Closes `next-steps.md` item 6. The window is built from `PLAYABLE`, which is
derived from the audio cache on disk and is **not a function of the log**. A
replay months later rebuilds it from whatever the cache holds then, which is why
replaying the 2026-08-02 sessions does not reproduce them: 401 words were
unplayable at the time and are playable now.

Add `playableCount` and `playableHash` to the session event. The hash must be
computed over the **sorted** word list, so it is stable across runs regardless of
the order the cache listing came back in — an order-sensitive hash would change
on every run and be worse than no hash at all, because it would look like the
item space kept changing when it had not.

Without this, every constant in this plan is untunable, because no replay can be
trusted.

### Task 2.5 — Results screen reads the new model

**Files:** modify `spelling-game/js/ui/results.js`.

Wherever it refers to the window or to hot/warm/cold as progress, it now reports
marked-off count against the catalogue. Keep the house product rule: **no
comparison to anyone but her own past self**, no streaks, no speed score.

---

## ▶ GATE B

- `node --test` green.
- Play a full session against a fresh empty log and confirm it is all probes, no
  crash, and nothing on screen distinguishes a probe.
- Play a session against a seeded log with a known drill set.
- Confirm the session event carries `playableCount` and `playableHash`.

---

# Wave 3 — Learn mode

### Task 3.1 — Target from the drill set, siblings from the spine

**Files:** modify `spelling-game/js/learn.js`, `spelling-game/tests/learn.test.js`.

Today learn builds its lesson from the window. Change it to:

- **target** — a word from `placement.drill`, chosen by the existing neediness
  scoring;
- **siblings** — drawn from the whole spine by shared pattern tag, **including
  already-marked words**.

So a target of `hop` yields `hop shop stop drop` even though the siblings are not
in her drill set and she may already know them. This is not a workaround. The
words she owns are the analogy that cracks the one she does not, and a lesson
built only from words she is failing has no scaffolding in it.

Measured justification, so it is not re-litigated: over 400 samples of 20 words,
a random drill set and a contiguous window yield near-identical families
(`irregular` 71% vs 73%). Rime families reach four words only 1–2% of the time in
either, because the spine carries 34 rime tags over 232 words and 56 of those
words sit in the opener. Pulling siblings from the whole spine takes rime lessons
from ~2% to nearly always, whenever the target carries a rime tag.

Tests:

- A target with a rime tag produces a lesson of `learnWords` from that rime,
  including marked-off siblings.
- A target whose only tag is `irregular` still produces a runnable lesson.
- A family smaller than `learnWords` does not produce a short session — the
  existing `learnPasses`-as-a-floor rule still holds.
- `taughtCount` scoring is unchanged; the existing learn tests stay green.

**Out of scope:** splitting the 232-word `irregular` bucket. That is
`next-steps.md` item 4, it is a content decision, and it does not belong in a
scheduling change.

---

# Wave 4 — Tooling

### Task 4.1 — Port `tools/replay.js` to spelling

**Files:** modify `tools/replay.js`.

It imports `../math-game/js/*` directly today and cannot read a spelling log.
Parameterise it by game so it can replay either.

It must reconstruct the item space from the session event's `playableCount` /
`playableHash` rather than assuming today's cache — otherwise it reproduces the
item 6 divergence with a new coat of paint.

This is what makes `probeMargin`, `cursorStepUp`, `cursorStepDown` and eventually
`hotMs` tunable against real sessions instead of against an argument. Until it
exists, every constant in this plan is a guess that cannot be checked.

---

## ▶ GATE C

- `node --test` green.
- `tools/replay.js` reads `data/spelling-log.jsonl` and reports a cursor.
- Re-run `speech-transcribe --expect` if the spine grew — it did not in this
  plan, so this should be a no-op, but confirm rather than assume
  (`next-steps.md` item 1).

---

## What this plan does not do

Stated so it is not mistaken for an oversight:

- **Does not retune `hotMs`.** It needs the kid's data, and every existing log
  event is an adult testing. Spec open question 4.
- **Does not split `irregular`.** Item 4, content, separate.
- **Does not add re-probing of marked words.** Rule 1 retires a word permanently
  on one correct answer and nothing revisits it, so decay would be invisible.
  Spending ~1 in 20 probes on already-marked words is the cheap guard; it is
  recommended in spec §7 and deliberately not specified here.
- **Does not add a spelling card to `games-menu.html`.** Still item 7, still the
  smallest high-value item on the list, still unrelated to this work.
