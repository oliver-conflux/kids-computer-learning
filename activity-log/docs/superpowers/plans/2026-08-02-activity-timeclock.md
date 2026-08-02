# Activity Timeclock — Implementation Plan

**Spec:** `activity-log/docs/superpowers/specs/2026-08-02-activity-timeclock-design.md`
**Read the spec first.** It holds the record shapes, the rules, and the reasoning.
This plan does not repeat them.

**Goal:** A timeclock the kids operate themselves, logging clock-in / clock-out
events to a fourth JSONL log, so that measuring time becomes the exercise.

**Architecture:** A fourth per-game log behind the existing `/api/log` route.
All rules live in one pure module (`core/timeclock.js`); one impure module owns
the clock and the DOM. Open clocks are derived by folding the log, never stored.

**Tech stack:** Vanilla ES modules, no dependencies. `node:test` for tests.

## Execution model

Built in **waves** by Claude agent teams. Agents within a wave run in parallel
and must not depend on each other's output — every cross-agent interface is
pinned in this document.

**Review is per-wave, not per-agent.** During wave N, one reviewer agent reviews
all of wave N−1's committed work. A wave does not start until the previous
wave's gate passes.

| Wave | Build agents | Reviewer reviews |
|---|---|---|
| 0 | 3 — foundations | — |
| 1 | 3 — the timer app | Wave 0 |
| 2 | 2 — integration | Wave 1 |
| 3 | fixes only | Wave 2 |

## Global constraints

- **No dependencies.** Nothing is installed. Vanilla ES modules, `node:test`.
- **Run tests with `node --test` from the repo root.** Not `node --test <dir>` —
  the directory-argument form reports a spurious failure. Baseline is **640
  passing**; a wave gate means 640 + your new tests, zero failures.
- **`core/` is pure.** No DOM, no `fetch`, no `localStorage`, no `Date.now()`,
  no `Math.random()`. Current time arrives as an argument.
- **`core/` holds no user-facing copy.** Validation returns reason codes; the UI
  owns the words.
- **`t` is `new Date(now()).toISOString()`.** Never a local-offset format. See
  the trap comment at `spelling-game/js/main.js:512`.
- **`at` is local wall-clock text, `YYYY-MM-DDTHH:MM`, no `Z`.** This is not an
  oversight; the spec explains why.
- **Never store duration, open-clock state, or verification results.** All derived.
- **Activity values are exactly `typing`, `math`, `spelling`** — identical to the
  `LOG_PATHS` keys. This is what makes cross-checking possible later.
- **Tests on logic, none on UI.** House rule. No DOM tests, no screen tests.
- **Do not touch** `typing-game/`, `math-game/js/`, or `spelling-game/`.
  (`math-game/tests/server.test.js` is the one exception, in Wave 0.)

---

# Wave 0 — Foundations

Three agents, fully parallel. Nothing here imports anything else here.

## Agent 0A — Server allowlist

**Files:** modify `server/serve.js` (the `LOG_PATHS` object, ~line 22); modify
`math-game/tests/server.test.js`.

The entire production change:

```js
activity: path.join(REPO_ROOT, 'data', 'activity-log.jsonl'),
```

Add test cases to the existing server test file, following the style already
there: `?game=activity` resolves to the new path, and an unknown game is still a
400 rather than falling back. Do not restructure the existing tests.

**Gate:** `node --test` from repo root, all green. Commit.

## Agent 0B — `core/timeclock.js` and its tests

**Files:** create `core/timeclock.js`, `core/tests/timeclock.test.js`.

This is the load-bearing module. Every rule in the spec lives here and nowhere
else. Read the spec's *Derived state* and *Validation rules* sections in full
before starting — especially the part about staleness and same-day validation
being **two distinct checks at two distinct moments**.

**Exported interface — implement exactly these names and shapes.** Wave 1 agents
write against them without seeing your code.

```js
export function localDate(wall)                    // 'YYYY-MM-DDTHH:MM' -> 'YYYY-MM-DD'
export function toWallClock(ms)                    // epoch ms -> local 'YYYY-MM-DDTHH:MM'
export function durationMinutes(startWall, endWall)// -> integer minutes, may be negative
export function elapsedMinutesSince(isoT, nowMs)   // machine instant -> minutes since
export function formatDuration(minutes)            // 75 -> '1 hour 15 minutes'
export function deriveOpenClocks(events)           // -> OpenClock[], newest first
export function isStale(openClock, nowMs)          // -> boolean
export function validateClockOut(openClock, endWall, config) // -> Result
```

```js
// OpenClock  { id, activity, description, at, t }
// Result     { ok: true, minutes } | { ok: false, reason }
// reason     'wrong-day' | 'end-before-start' | 'too-long'
```

`durationMinutes` works on wall-clock strings (her measurements);
`elapsedMinutesSince` works on the machine instant `t`. They are not
interchangeable, and the different-day screen needs the second one — it reports
how long the timer *really* ran, which is a fact about the machine clock, not
about anything she typed. Keeping that arithmetic here is what stops it leaking
into `main.js`.

There is deliberately **no** `deriveIntervals`. Completed intervals have no
consumer in v1 — the done screen gets its duration from `validateClockOut`. The
deferred weekly report will need one; it can fold the log itself when it exists.

`validateClockOut` applies its three checks **in the order listed in the spec**,
and returns reason codes only — no sentences. `config` is the object defined in
Agent 0C's task below; you need only `maxHours` from it.

`deriveIntervals` and `deriveOpenClocks` both fold the event array using the
rules in the spec, including every defensive case (unmatched clock-out,
unmatched void, duplicate clock-in, malformed events, empty log). Model the
shape on `deriveMastery` in `core/mastery.js:227`.

**Tests:** implement every case enumerated in the spec's *Testing* section, plus
whatever else you think is needed. Two that are easy to get wrong and must be
present:

- A late-afternoon local time whose UTC instant falls on the *next* calendar
  day, asserting `localDate` still returns the local day. This is the exact bug
  the wall-clock format exists to prevent.
- An entry that is both wrong-day and over the maximum, asserting the reported
  reason is `wrong-day`.

**Gate:** `node --test` from repo root, all green. Commit.

## Agent 0C — Config and log shim

**Files:** create `activity-log/js/config.js`, `activity-log/js/log.js`.

`log.js` is a shim over `core/log.js`. **Copy the pattern from
`math-game/js/log.js`** — it is ~10 lines and already does exactly this. Use
game key `activity` and outbox key `kct.activity.outbox.v1`. Read the header
comment in `core/log.js` first; the outbox-key warning applies here too.

`config.js` — the shape other agents import:

```js
export const CONFIG = {
  build: 'a1',
  logTail: 2000,
  maxHours: 5,
  activities: [
    { value: 'typing',   label: 'Typing' },
    { value: 'math',     label: 'Math' },
    { value: 'spelling', label: 'Spelling' },
  ],
};
```

Follow the commenting style of `math-game/js/config.js`, including its note on
which module reads each field. No tests — this is declaration and a shim, both
covered by their consumers.

**Gate:** `node --test` from repo root, all green. Commit.

---

# Wave 1 — The timer app

Three build agents in parallel, plus one reviewer on Wave 0. The DOM contract
below is what lets 1A and 1C be written simultaneously — **treat these ids as
frozen.**

```
#timer-bar                                          bar mount (both pages)
#screen-start  #screen-stop  #screen-done           the three screens

#activity-select  #description-input                start screen
#start-time-input  #clock-hint  #btn-clock-in

#stop-activity  #stop-description  #stop-started     stop screen
#end-time-input  #stop-message
#btn-clock-out  #btn-void

#done-summary  #btn-new-timer                        done screen
```

Screens are shown and hidden with the `hidden` attribute, as
`spelling-game/js/main.js` already does.

## Agent 1A — Markup and styles

**Files:** create `activity-log/index.html`, `activity-log/css/style.css`.

Build the three screens described in the spec's *Screens* section using exactly
the ids above. Time fields are `<input type="time">`. The activity dropdown is
populated at runtime by Agent 1C — ship it empty.

`#clock-hint` sits **beside** the start-time field, never inside it. The current
time is a reference she reads, never a prefilled value. Same for the bar: it
shows a start time, not a ticking counter. Both rules exist because the machine
must not take the measurement for her.

Match the visual language of `games-menu.html` — same palette, rounded cards,
large touch targets. This is for a child; type large.

**No tests.** House rule.

**Gate:** page loads without console errors. Commit.

## Agent 1B — The bar

**Files:** create `activity-log/js/bar.js`.

One exported function that renders bar state into `#timer-bar`. It is imported
by both the timer page and `games-menu.html`, so it must not assume anything
about the rest of either page.

```js
export function renderBar(mount, openClock, options)
// openClock: OpenClock | null   (from deriveOpenClocks(...)[0])
// options:   { onStart, onStop } click handlers
```

Both states are in the spec's *Screens* section. Use `formatDuration` and the
other helpers from `core/timeclock.js` rather than writing your own date
formatting. Ship the bar's CSS inside this module or in its own file — it cannot
depend on `activity-log/css/style.css`, which the menu does not load.

**No tests.**

**Gate:** commit.

## Agent 1C — Wiring

**Files:** create `activity-log/js/main.js`.

The only impure module: it owns the clock, the randomness, and the DOM. It holds
**no rules** — every decision comes from `core/timeclock.js`.

Boot sequence, mirroring `spelling-game/js/main.js:660` and `math-game/js/main.js:711`:

1. `serverIsUp()` — **if the server is down, refuse to start and say so.** A
   clock-in that cannot be saved is worse than no clock at all. Read the comment
   at `spelling-game/js/main.js:660`; the same reasoning applies.
2. `flushOutbox()`, then `loadEvents()`.
3. `deriveOpenClocks(events)` decides which screen renders: none open → start
   screen; one or more open → stop screen for the newest.
4. On the stop screen, `isStale(openClock, now())` decides whether she gets a
   blank end-time field or the different-day path. Its hour count comes from
   `elapsedMinutesSince(openClock.t, now())` — never from arithmetic you do
   yourself here.

Then: populate the dropdown from `CONFIG.activities`; generate ids as `a_` plus
4 random hex characters (matching the `s_37ce` convention in the other games);
render the bar via Agent 1B's function; route "New timer?" back to the start
screen.

`#stop-message` is where the wrong-day, end-before-start, and too-long copy
goes. The exact wording for the different-day and over-maximum cases is in the
spec — **use it verbatim**; it was written for a child. Map reason codes to
copy here, not in `core/`.

**No tests.**

**Gate:** commit.

## Reviewer R0 — reviews Wave 0

Reviews the three Wave 0 commits together. Does not review code that Wave 1 is
still writing.

Check: `core/timeclock.js` is genuinely pure (no `Date.now`, no `Math.random`,
no DOM, no copy); the check ordering matches the spec; staleness and same-day
validation are separate; the outbox key is exactly `kct.activity.outbox.v1`; the
server change did not disturb the allowlist's rejection behaviour; test coverage
matches the spec's list. Report findings — do not fix Wave 1's in-flight files.

---

# Wave 2 — Integration

Two build agents in parallel, plus one reviewer on Wave 1.

## Agent 2A — Menu integration

**Files:** modify `games-menu.html`.

Add a `#timer-bar` mount above the games grid and a card linking to
`activity-log/index.html`. The menu's existing script is a plain inline
`<script>`; the bar needs `type="module"` — add a second module script rather
than converting the existing `file://` guard, which must keep running first.

The menu's bar needs its own small boot: `loadEvents()`, `deriveOpenClocks()`,
`renderBar()`. Its buttons navigate to `activity-log/index.html`; the menu never
writes an event itself.

**Do not** add a card for the spelling game. It is a few commits from being
integrated and is out of scope.

**Gate:** menu loads clean from `play.command`; bar reflects real log state.
Commit.

## Agent 2B — Real-play verification

**Files:** none. Produces a written report only.

Start the server, open the menu, and actually run these through the UI, checking
`data/activity-log.jsonl` by hand after each:

1. Clock in, clock out same day. One `clock-in` and one `clock-out` line, joined
   by `id`. Confirm `at` has **no** `Z` and `t` **does**.
2. Clock in, then navigate to the menu. Bar shows the running clock.
3. Clock in, try to start another. You get the stop screen, not an error.
4. End time before start time → rejected, nothing written.
5. A 6-hour span → the "split it into two timers" copy.
6. Throw one away → a `clock-void` line appears; nothing is deleted.
7. Stop the server, then clock in. The app refuses to start.

For the stale path, hand-append a `clock-in` dated yesterday to the log, reload,
and confirm the "you probably forgot to clock out" screen with a correct hour
count.

Report what you observed, exactly. Do not report a step as passing unless you
saw the line in the file.

## Reviewer R1 — reviews Wave 1

Reviews the three Wave 1 commits together. Check: no rules leaked out of
`core/timeclock.js` into `main.js`; no ticking counter and no prefilled time
field anywhere; ids match the frozen contract; the server-down refusal is real,
not a console warning; `bar.js` has no dependency on the timer page's stylesheet.

---

# Wave 3 — Close out

## Reviewer R2 — reviews Wave 2

Reviews the menu integration and reads 2B's report. Check that 2B's claims match
the log file rather than taking the report at face value.

## Fixes

Address findings from R0, R1, and R2. Full `node --test` from repo root must be
green. Then update `activity-log/docs/superpowers/specs/` with anything real
play changed about the design, and commit.

---

## Follow-up: add `geography` to the dropdown

A geography game is being built in parallel. It should become a fourth
verifiable activity — but **only once it registers a `geography` key in
`LOG_PATHS`** (`server/serve.js`). The activity `value` strings must equal the
log keys; adding `geography` before its log exists produces a dropdown entry
with nothing to check against.

Once that key lands, this is a one-line addition to `CONFIG.activities` in
`activity-log/js/config.js`:

```js
{ value: 'geography', label: 'Geography' },
```

Do it at Wave 3 close-out if geography's log exists by then; otherwise carry it
as a standing follow-up.

## Findings from Wave 0 that later waves must honour

- **`validateClockOut` cannot report a blank end-time field.** There is no
  fourth reason code, and the wrong-day check runs first, so an empty or
  unparseable reading comes back as `'wrong-day'`. **Agent 1C must guard the
  empty field before calling it** — otherwise a child who submits a blank form
  is told she typed the wrong date.
- **`OpenClock.description` is always a string** (`''` when absent). 1C need not
  guard it.
- **`formatDuration` emits words** ("hour", "minute"), a deliberate narrow
  exception to the no-copy-in-`core` rule: it is a number formatter that makes
  no decision, and the frozen interface puts it in `core`. Not a defect.
- **The fold runs in log order, not sorted by `t`.** If the offline outbox ever
  flushed a `clock-out` ahead of its `clock-in`, that close would be dropped and
  the clock would stay open. Single-writer append makes this unlikely; noted
  because it is the one place log order and `t` order can genuinely diverge.

## Deliberately not in this plan

From the spec's *Non-goals*, all cheap to add later, none requiring a record
shape change: automatic cross-checking of her claims against the game logs;
unverifiable activities such as reading; a `who` field; the bar inside the three
games; a weekly time report; editing past records.
