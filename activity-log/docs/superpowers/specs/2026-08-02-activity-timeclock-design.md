# Activity Timeclock — Design

**Date:** 2026-08-02
**Status:** Approved, ready for planning

## Purpose

A timeclock the kids operate themselves, so that *measuring time* becomes the
exercise. It exists to serve an upcoming science unit on measurement: the child
reads a clock, records what she read, and the machine does the arithmetic and
shows her the result.

The design consequence that follows from this and drives everything else: **the
machine must never take the measurement for her.** No live-ticking counter, no
prefilled time field, no stopwatch. She reads a real clock and types what it
says. The machine's own clock is recorded separately, so the gap between what
she observed and what was true is itself visible data.

## Non-goals

Deliberately excluded from v1. Each is cheap to add later and none require the
record shape to change.

- **Automatic cross-checking of her claims** against the game logs. The design
  makes this trivial to bolt on (see *Designed-for extensions*), but it is not
  built now.
- **A `who` field.** There is one computer per kid, so identity is inherited
  from the filesystem exactly as the three game logs already do it.
- **The bar inside the games.** See *Screens*.
- **Activities with no machine record** (reading, art, chores). v1 ships the
  three verifiable activities only.
- **Editing or deleting past records.** The log is append-only. A bad
  measurement is voided, not erased.

## Context: how logging already works

Unchanged, and reused wholesale:

- One append-only JSONL file per game in `data/`. The file on disk is the single
  source of truth.
- `core/log.js` exports `createLogClient({ game, outboxKey, defaultTail })`.
  Each game's `js/log.js` is a ~3-line shim that only names the game.
- `server/serve.js` serves `/api/log?game=<name>` — GET returns the last N
  well-formed lines, POST appends one event. `LOG_PATHS` is an allowlist; an
  unknown game is a 400, never a fallback.
- `localStorage` holds **only** an outbox of unacknowledged events, keyed per
  game. It is a buffer, never a second store, and state is never derived from
  it (`core/log.js:5`).

The timeclock adds a fourth log and inherits all of the above — including the
offline outbox and the permanent-vs-transient failure model — for the cost of
one `LOG_PATHS` entry and one shim.

## Data model

`data/activity-log.jsonl`, three event types:

```json
{"type":"clock-in", "t":"2026-08-04T17:00:31.482Z","id":"a_7f3c","activity":"typing","description":"Lesson 4","at":"2026-08-04T10:00"}
{"type":"clock-out","t":"2026-08-04T18:02:14.907Z","id":"a_7f3c","at":"2026-08-04T11:00"}
{"type":"clock-void","t":"2026-08-05T18:11:02.114Z","id":"a_9b21","reason":"stale"}
```

### `t` and `at` are different kinds of time

This is the load-bearing decision of the design.

| field | meaning | format |
|---|---|---|
| `t` | when the line was written, from the machine clock | ISO-8601 UTC, `Z`-suffixed |
| `at` | the time **she read off a clock and typed** | local wall clock, `YYYY-MM-DDTHH:MM`, **no** `Z` |

Reasons `at` is stored as local wall-clock text rather than a UTC instant:

1. **Fidelity.** It records exactly what she observed, with no conversion
   between the observation and the record. A measurement log should read like a
   lab notebook.
2. **The same-day rule becomes a string comparison.** `at.slice(0, 10)` is the
   local calendar date. Storing UTC would put a 5 PM Pacific clock-in on the
   *next* UTC day, silently breaking the same-day rule for every afternoon
   session.
3. **Legibility.** `cat`-ing the file shows `10:00`, not `17:00:00Z`.

Daylight saving cannot cause an error: it shifts at 2 AM, and every valid
session is at most 5 hours within a single day.

`t` remains `Z`-suffixed for consistency with the other three logs, where
`core/mastery.js` orders events by string-comparing `t` — a format that only
sorts correctly while every writer emits UTC (see the trap comment at
`spelling-game/js/main.js:512`).

The gap between `t` and `at` is meaningful data: it shows whether she logged as
she went or filled it in afterward.

### What is NOT stored

- **Duration.** Always `out.at − in.at`. Storing it invites a record whose
  stored minutes disagree with its stored times, with no way to say which is
  true. Deriving it also means the arithmetic is visible, which is the lesson.
- **Which clock is currently running.** Derived by folding the log.
- **Whether an activity is verifiable.** Derivable from whether its name is in
  the server's `LOG_PATHS` allowlist.
- **Whether a claim passed verification.** That is analysis layered on top. The
  log records what she observed and claimed; the system's opinion about it is
  not part of the record.

### `id`

`a_` + 4 random hex characters, matching the existing `s_37ce` session-id
convention. It joins a `clock-out` or `clock-void` to its `clock-in`.

### Activity vocabulary

**The dropdown values for game activities must be exactly the `LOG_PATHS` keys**
(`server/serve.js:22`):

    typing · math · spelling

This single naming rule is the entire preparation for automatic cross-checking.
If the dropdown said "Typing Practice" while the log is `typing`, that join
would be string-guessing forever.

v1 ships these three and nothing else. Adding unverifiable activities later is
a one-line change to the config array.

## Derived state

All of it lives in `core/timeclock.js` as pure functions over an event array —
the same shape as `core/mastery.js:227`, which the codebase already uses
everywhere.

**Fold rules**, applied in log order:

- `clock-in` with a new `id` opens a clock.
- `clock-out` with a matching open `id` closes it into a completed interval.
- `clock-void` with a matching open `id` discards it.
- A `clock-out` or `clock-void` with no matching open `id` is ignored.
- A `clock-in` whose `id` is already open is ignored.
- Any malformed or unrecognised event is skipped, never thrown on. A corrupt
  line must never break a session — the same rule `readLog` already follows
  (`server/serve.js:130`).

**Open clocks** are returned as a list, newest first. The UI routing makes more
than one open clock unreachable, but two browser tabs could still produce it, so
the derive must not assume uniqueness. The bar shows the newest; closing it
reveals the next. No special-casing required.

## Validation rules

All pure, all in `core/timeclock.js`. There are **two distinct checks at two
distinct moments**, and conflating them is the easiest way to get this wrong.

**On clock-out screen load — staleness**, from the injected `now()`:

- **Stale** when the local calendar date of `now()` ≠ the date of `in.at`. She
  has come back on a later day. She is not shown a blank end-time field at all;
  she gets the different-day path described under *Screens*.

**On submit — validating the time she typed**, in this order:

1. **Wrong day.** `out.at` date ≠ `in.at` date. Rejected. (Reachable even on
   the stale path: she is asked what time she finished *on Tuesday*, and could
   still answer with a Wednesday date.)
2. **End before start.** `out.at` ≤ `in.at`. Rejected — a zero-length session
   is not a measurement.
3. **Over the maximum.** Duration > `maxHours` (config, default **5**).
   Rejected with an invitation to split the session in two.

The order matters: a wrong-day entry would otherwise also trip rule 3, and
"that's a really long time" is the wrong message for someone who typed the
wrong date.

**A valid record never crosses midnight.** This is a rule, not an accident, and
it is only safe because these children do not work overnight. Everything in the
design rests on this assumption, so it is written down here explicitly.

## Screens

### The bar

Renders on `games-menu.html` and on every timer screen. Not inside the games.

```
┌────────────────────────────────────────────────────┐
│  ⏱  no timer running          [ Start timer! ]     │
└────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────┐
│  ⏱  Typing · started Tue 10:00 AM   [ Stop timer! ]│
└────────────────────────────────────────────────────┘
```

It shows the **start time, not a live elapsed counter.** A counter would take
the measurement for her.

Reasons it stays out of the three games:

- The games are full-attention environments; the typing game runs
  error-blocking drills. A ticking clock competes for exactly the attention it
  is measuring.
- For these three activities the game's own log *already* records real timing.
  Her clock is the thing being verified, not the source of truth.
- `core/` currently holds shared *logic* only — there is no shared UI layer in
  this repo. Putting the bar in the games would mean inventing one and touching
  three currently-independent codebases.

### Start screen

Activity dropdown, description field, and a start-time field she types into.
The current time is displayed **beside** the field as a reference, never
prefilled into it.

### Clock-out screen

Shows activity, description, start day and time; a time field she types into;
then the computed duration in plain language:

    10:00 AM → 11:15 AM = 1 hour 15 minutes

Ends with a **"New timer?"** button. This is what makes task-switching a
two-click flow rather than a blocked state: she can never reach the start form
while a clock is running, so there is no "you must close this first" error to
explain. She is simply routed to the clock-out screen instead.

**Different-day path.** The normal end-time field is replaced:

> You clocked in **Tuesday at 10:00 AM**. It is now **Wednesday, 11:00 AM** —
> your timer has been running **25 hours**. You probably forgot to clock out.
> What time did you finish on Tuesday?

The 25 hours is computed from the machine clock (`t`), so the forgetting is
shown and named rather than silently absorbed. Her answer is then validated as
an ordinary Tuesday session.

**Over-maximum path.**

> That's 6 hours 20 minutes. That's a really long time for one activity — if
> you really did work that long, split it into two timers.

Both paths also offer **throw it away**, which appends a `clock-void`. Nothing
is ever erased; a discarded measurement stays in the record as a discarded
measurement.

### Time input

`<input type="time">`. She types the digits; the widget rejects impossible
entries like `25:99` and renders AM/PM segments, so no parsing of free text and
no AM/PM ambiguity.

## File layout

```
data/activity-log.jsonl              new log
server/serve.js                      +1 line in LOG_PATHS
core/timeclock.js                    NEW — pure: fold, duration, validation
core/tests/timeclock.test.js         NEW — the tests
activity-log/index.html              the three screens
activity-log/css/style.css
activity-log/js/config.js            maxHours: 5, activity list, logTail
activity-log/js/log.js               ~3-line shim over core/log.js
activity-log/js/bar.js               renders the bar; games-menu.html imports it
activity-log/js/main.js              impure: owns the clock and the DOM
games-menu.html                      + bar mount (needs type="module"), + a card
math-game/tests/server.test.js       + allowlist case for the new game key
```

**Purity split**, matching the other three games: `core/timeclock.js` holds
every rule and knows nothing about the DOM or the current time. `main.js` owns
the clock and the DOM and holds no rules. The current time is injected as a
`now()` function, as `spelling-game/js/main.js` already does, so every rule is
testable without mocking a global.

**The bar lives in `activity-log/js/bar.js`**, imported by both consumers,
rather than in a new `core/ui/`. Two consumers do not justify inventing this
repo's first shared UI layer; if a third appears, promoting it is a file move.

**Server change**, in full:

```js
activity: path.join(REPO_ROOT, 'data', 'activity-log.jsonl'),
```

Log key `activity`, outbox key `kct.activity.outbox.v1`. The shim, the failure
model, and the offline queue all come free.

## Testing

Following this repo's established practice: thorough tests on logic, none on UI.

`core/tests/timeclock.test.js` covers:

- Fold: open clock derivation, close, void, unmatched `clock-out`, unmatched
  `clock-void`, duplicate `clock-in`, malformed events, empty log.
- Multiple simultaneous open clocks ordered newest-first.
- Duration arithmetic, including across noon and the 12→1 boundary.
- Same-day check, including a late-afternoon local time that would fall on the
  next UTC day — the specific bug the local-wall-clock format exists to prevent.
- End-before-start rejection, including the equal-times case.
- Over-maximum rejection at and either side of the boundary.
- Stale detection driven by an injected `now()`, kept distinct from the
  same-day validation of a typed `out.at`.
- Check ordering: a wrong-day entry that is also over the maximum reports the
  wrong-day message, not the too-long one.

`math-game/tests/server.test.js` gains a case asserting `activity` resolves
through the allowlist and that an unknown game is still a 400.

No tests on the bar, the screens, or the DOM.

## Designed-for extensions

None of these require the record shape to change.

- **Automatic cross-checking.** activity name → log file → events whose `t`
  falls inside `[in.at, out.at]` → compare against her claim. Needs one
  local→UTC conversion, in one place. The naming rule above is the only
  preparation v1 makes for it, and it is free.
- **More activities**, including unverifiable ones — a config array entry.
- **Reminders to clock out** — the bar already derives the open clock.
- **A weekly time report.** This is the first read in the repo that is
  cross-log, date-ranged and aggregated rather than "the last N events," so it
  should be a **separate read path**, not a widening of `loadEvents`.

## Storage: why JSONL is still right

Worth recording, since it was asked directly.

The workload is one bounded query — `tail=2000`, once, at page load, then a
linear fold in memory. Derivation cost is therefore *permanently constant*
regardless of file size. Writes are single appended lines to four separate
files, so there is no write contention. A database buys nothing against this.

The one real wart: `readLog` (`server/serve.js:118`) reads the whole file and
parses every line before slicing off the tail — O(file) work for an O(2000)
question. At roughly 200 bytes per event that is years away from mattering, and
the fix is to read backward from the end of the file: a contained change to one
function, not a migration.

What would actually justify a database is not size but shape — multiple kids
with real per-kid queries, ad-hoc questions not known in advance, or concurrent
writers to one log. None are on the table, and the one-file-per-game split
avoids the third by construction.
