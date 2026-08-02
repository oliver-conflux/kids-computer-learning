// Timeclock derivation and validation: the activity event log in, the open
// clocks and a verdict on what she typed out.
//
// Nothing here is stored. Which clock is running, how long a session lasted,
// and whether an entry is acceptable are all recomputed from the log, which is
// what lets `maxHours` change and history be re-read rather than re-collected.
//
// The one idea this module exists to protect: `t` and `at` are different kinds
// of time and are never interchangeable.
//
//   `t`  is a machine instant — ISO-8601 UTC, `Z`-suffixed, written by the
//        machine clock. It answers "when was this line written".
//   `at` is a human observation — local wall-clock text 'YYYY-MM-DDTHH:MM' with
//        NO zone suffix, typed by a child who read a real clock. It answers
//        "what did the clock say".
//
// So there are two arithmetics, and mixing them is the failure this module is
// shaped to prevent. `durationMinutes` measures what she observed and works on
// wall-clock strings. `elapsedMinutesSince` measures what really happened and
// works on the machine instant. The different-day screen needs the second: how
// long the timer *really* ran is a fact about the machine clock, not about
// anything she typed.
//
// Likewise there are two day checks, at two distinct moments. `isStale` runs on
// screen load against the injected current time and asks "has she come back on
// a later day". The wrong-day rule in `validateClockOut` runs on submit against
// the value she typed and asks "is the time she gave on the day she started".
// A stale clock is still closed out as an ordinary same-day session, so
// collapsing the two would make the different-day path unreachable.
//
// Pure module: no DOM, no network, no clock, no randomness, and no user-facing
// copy — validation returns reason codes and the UI owns the words. The current
// time always arrives as an argument, so every rule here is testable without
// mocking a global.
//
// The one deliberate exception to the no-copy rule is `formatDuration`, which
// necessarily emits the words "hour" and "minute". It is a number formatter, not
// a message: it renders an arithmetic result and makes no decision. Keeping it
// here is what stops two consumers — the bar and the timer page — from growing
// two different spellings of the same duration.

const CLOCK_IN = 'clock-in';
const CLOCK_OUT = 'clock-out';
const CLOCK_VOID = 'clock-void';

const MS_PER_MINUTE = 60000;
const MINUTES_PER_HOUR = 60;

// Used only when `config.maxHours` is missing or nonsense. The real value lives
// in activity-log/js/config.js; this is a floor under a corrupt caller, not a
// second place to tune the rule.
const DEFAULT_MAX_HOURS = 5;

// A wall-clock reading exactly as the date half and `<input type="time">`
// produce it: 'YYYY-MM-DDTHH:MM', local, no zone suffix. The absent `Z` is the
// entire point — see the spec's "t and at are different kinds of time".
const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * An open clock-in, as returned by deriveOpenClocks.
 *
 * `at` is a local wall clock reading, 'YYYY-MM-DDTHH:MM'.
 * `t` is a machine instant, ISO-8601 UTC. The two are not interchangeable —
 * see the spec's "t and at are different kinds of time".
 *
 * @typedef {{
 *   id: string,
 *   activity: string,
 *   description: string,
 *   at: string,
 *   t: string,
 * }} OpenClock
 *
 * @typedef {'wrong-day' | 'end-before-start' | 'too-long'} RejectReason
 * @typedef {{ ok: true, minutes: number } | { ok: false, reason: RejectReason }} Result
 */

/** Left-pad a non-negative integer to `width` digits. */
function pad(value, width) {
  return String(value).padStart(width, '0');
}

/**
 * The five numbers in a wall-clock reading, or null if it is not one.
 *
 * Exported because the display code needs these numbers and has no other honest
 * way to get them. Left unexported, each consumer re-derived them: `main.js`
 * grew a byte-identical copy of the pattern, and `bar.js` sliced at hardcoded
 * offsets without restating the format at all — so relaxing the pattern here to
 * accept '2026-8-4' would have left the bar slicing at the old positions and
 * rendering "started undefined at NaN: PM" on the games menu, with no error
 * anywhere. The format is one fact and it belongs in one file.
 *
 * `month` is 1-based, as it is written. Callers building a `Date` subtract one.
 *
 * @param {unknown} wall local wall clock 'YYYY-MM-DDTHH:MM'
 * @returns {{year: number, month: number, day: number, hour: number, minute: number} | null}
 */
export function wallParts(wall) {
  if (typeof wall !== 'string') {
    return null;
  }
  const match = WALL_CLOCK_PATTERN.exec(wall);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  // The pattern alone admits '2026-02-30' and '2026-08-04T25:99', which Date.UTC
  // then silently rolls over into a real but different moment. Comparing the
  // round-trip back out is the only reliable way to reject them, and rejecting
  // them here is what lets `localDate` promise that a non-null answer means the
  // whole reading is sound, time half included.
  const rolled = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    rolled.getUTCFullYear() !== year
    || rolled.getUTCMonth() !== month - 1
    || rolled.getUTCDate() !== day
    || rolled.getUTCHours() !== hour
    || rolled.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/**
 * A wall-clock reading as a number, for arithmetic only.
 *
 * The reading is deliberately interpreted as if it were UTC. That is not a
 * mistake and not a timezone conversion — it is what makes wall-clock
 * subtraction mean what she means by it. Two readings on one day differ by the
 * number of minutes the clock face advanced, and reading that off a fixed-offset
 * scale gives exactly that, immune to the ambient timezone and to daylight
 * saving. Interpreting the readings as local instants instead would make a
 * session that spans 2 AM on a shift day come out an hour wrong.
 *
 * The returned number is meaningful only when subtracted from another value from
 * this same function. It is not an instant and must never be treated as one.
 *
 * @param {unknown} wall
 * @returns {number | null} null when `wall` is not a well-formed reading
 */
function wallToNominalMs(wall) {
  const parts = wallParts(wall);
  if (parts === null) {
    return null;
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

/**
 * The local calendar date of a wall-clock reading.
 *
 * This is the same-day rule in its entirety, and it stays in local terms on
 * purpose. `at` is already local, so the date is already in the reading and no
 * conversion can go wrong in between. Had `at` been stored as a UTC instant, a
 * 5 PM Pacific session would carry the *next* day's date and the same-day rule
 * would reject every afternoon a child ever logs.
 *
 * The answer is BUILT FROM `wallParts`, never sliced out of the string. That
 * distinction is the whole point and it is worth stating plainly, because
 * slicing looks equivalent and is not: it silently assumes the pattern is
 * fixed-width. Relax that pattern to accept '2026-8-2' and a slice returns
 * '2026-8-2T9' — a date that equals nothing, so `isStale` calls a one-hour-old
 * timer stale and `validateClockOut` rejects every end time she can type as the
 * wrong day. She would be accused of forgetting to clock out on a timer she
 * started an hour ago, with no way to close it but to throw it away. Building
 * from the parsed numbers cannot drift from the parser that validated them, and
 * canonicalises the width the string comparison depends on.
 *
 * The whole reading is validated before the date is derived from it. That is the
 * contract the caller in `validateClockOut` leans on: once two readings have
 * both produced a non-null date, their times are known good too, so the duration
 * arithmetic that follows cannot come back null.
 *
 * @param {unknown} wall local wall clock 'YYYY-MM-DDTHH:MM'
 * @returns {string | null} 'YYYY-MM-DD', or null when `wall` is malformed
 */
export function localDate(wall) {
  const parts = wallParts(wall);
  if (parts === null) {
    return null;
  }
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/**
 * An instant rendered as the wall clock a person standing here would read.
 *
 * Local by design: this feeds the "current time" hint shown beside the start
 * field and the today-check in `isStale`, both of which are about the clock on
 * the wall rather than the one in the machine. It is never used to build a
 * stored `at` — she types that herself, because the machine taking the
 * measurement for her is the one thing this feature must not do.
 *
 * @param {number} ms epoch milliseconds, supplied by the caller
 * @returns {string | null} 'YYYY-MM-DDTHH:MM', or null when `ms` is not a time
 */
export function toWallClock(ms) {
  if (!Number.isFinite(ms)) {
    return null;
  }
  const here = new Date(ms);
  if (Number.isNaN(here.getTime())) {
    return null;
  }
  return `${pad(here.getFullYear(), 4)}-${pad(here.getMonth() + 1, 2)}-${pad(here.getDate(), 2)}`
    + `T${pad(here.getHours(), 2)}:${pad(here.getMinutes(), 2)}`;
}

/**
 * Minutes between two wall-clock readings — the arithmetic she is here to learn.
 *
 * Operates on what she typed, not on machine instants. May be negative: a
 * backwards pair is a fact the caller needs to see and reject, not something to
 * be quietly made positive.
 *
 * @param {unknown} startWall 'YYYY-MM-DDTHH:MM'
 * @param {unknown} endWall 'YYYY-MM-DDTHH:MM'
 * @returns {number | null} whole minutes, or null when either reading is malformed
 */
export function durationMinutes(startWall, endWall) {
  const start = wallToNominalMs(startWall);
  const end = wallToNominalMs(endWall);
  if (start === null || end === null) {
    return null;
  }
  // Both operands are minute-aligned, so this is exact; the rounding only keeps
  // floating-point division from ever handing back 89.99999999999999.
  return Math.round((end - start) / MS_PER_MINUTE);
}

/**
 * Minutes of real time since a machine instant.
 *
 * The counterpart to `durationMinutes` and not a substitute for it: this one
 * reads the machine clock's record of events and is how the different-day screen
 * can say "your timer has been running 25 hours" — a fact about what actually
 * happened, which is the point of naming the forgetting rather than absorbing
 * it silently.
 *
 * Truncated toward the past, so the answer is completed minutes elapsed.
 *
 * @param {unknown} isoT machine instant, ISO-8601 UTC
 * @param {number} nowMs epoch milliseconds, supplied by the caller
 * @returns {number | null} null when either input is unusable
 */
export function elapsedMinutesSince(isoT, nowMs) {
  if (typeof isoT !== 'string' || !Number.isFinite(nowMs)) {
    return null;
  }
  const started = Date.parse(isoT);
  if (Number.isNaN(started)) {
    return null;
  }
  return Math.floor((nowMs - started) / MS_PER_MINUTE);
}

/**
 * A minute count in plain language: 75 becomes '1 hour 15 minutes'.
 *
 * Zero renders as '0 minutes' rather than as nothing, so a caller interpolating
 * it never produces an empty gap. A negative count keeps its sign instead of
 * being hidden — nothing valid reaches here negative, and silently showing a
 * backwards session as a positive one would be a lie.
 *
 * @param {number} minutes
 * @returns {string | null} null when `minutes` is not a number
 */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) {
    return null;
  }
  const whole = Math.trunc(minutes);
  const sign = whole < 0 ? '-' : '';
  const total = Math.abs(whole);
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const rest = total % MINUTES_PER_HOUR;

  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  }
  if (rest > 0 || hours === 0) {
    parts.push(`${rest} ${rest === 1 ? 'minute' : 'minutes'}`);
  }
  return sign + parts.join(' ');
}

/**
 * A `clock-in` event as an OpenClock, or null if the line cannot be trusted.
 *
 * `t` is required even though staleness is decided from `at`, because the
 * OpenClock contract promises it and the different-day screen hands it straight
 * to `elapsedMinutesSince`. Admitting a clock-in with an unreadable `t` would
 * move that failure off this line and into a rendered hour count.
 *
 * `description` is the one optional field — she may legitimately leave it blank
 * — so it is normalised to '' rather than being allowed through as undefined.
 *
 * @param {object} event
 * @returns {OpenClock | null}
 */
function toOpenClock(event) {
  const { id, activity, description, at, t } = event;
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  if (typeof activity !== 'string' || activity === '') {
    return null;
  }
  if (localDate(at) === null) {
    return null;
  }
  if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) {
    return null;
  }
  return {
    id,
    activity,
    description: typeof description === 'string' ? description : '',
    at,
    t,
  };
}

/**
 * The clocks still running, newest first.
 *
 * A list, not a single value. The UI routing makes a second open clock
 * unreachable — she cannot reach the start form while one is running — but two
 * browser tabs can still produce one, so this must not assume uniqueness. The
 * bar shows the newest; closing it reveals the next, with no special case
 * anywhere.
 *
 * Folded in log order rather than sorted by `t`, per the spec. For a single
 * writer appending as it goes the two are the same order.
 *
 * Every defensive case is a silent skip, never a throw: a corrupt line must
 * never break a session, the same rule `readLog` already follows in
 * server/serve.js. Concretely — an unmatched `clock-out` or `clock-void` closes
 * nothing, a `clock-in` whose id is already open is ignored so the first reading
 * wins, and an unrecognised type or a non-object is passed over.
 *
 * @param {unknown} events
 * @returns {OpenClock[]} newest first
 */
export function deriveOpenClocks(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  // Insertion-ordered by construction, which is what makes "newest first" a
  // reverse at the end rather than a sort on a field that may be missing.
  /** @type {Map<string, OpenClock>} */
  const open = new Map();

  for (const event of events) {
    if (event === null || typeof event !== 'object') {
      continue;
    }
    if (event.type === CLOCK_IN) {
      const clock = toOpenClock(event);
      if (clock === null || open.has(clock.id)) {
        continue;
      }
      open.set(clock.id, clock);
      continue;
    }
    if (event.type === CLOCK_OUT || event.type === CLOCK_VOID) {
      if (typeof event.id !== 'string') {
        continue;
      }
      // Closing and voiding differ only in what the record means, not in what
      // they do to the running clock; the distinction is preserved in the log,
      // which is where it matters. Deleting an absent key is already a no-op,
      // so the unmatched case needs no branch of its own.
      open.delete(event.id);
      continue;
    }
  }

  return [...open.values()].reverse();
}

/**
 * Has she come back on a later day than she clocked in on?
 *
 * Checked once on screen load, from the injected current time — NOT on submit,
 * and not against anything she typed. A stale clock does not get a blank
 * end-time field; it gets the different-day path, which tells her how long the
 * timer really ran and then asks what time she finished on the original day.
 * Her answer to that is validated afterwards as an ordinary same-day session, by
 * `validateClockOut`. Two questions, two moments.
 *
 * Both sides are local calendar dates, so this compares the day she was living
 * in, not the day UTC happened to be having.
 *
 * Returns false whenever it cannot tell. Not knowing is not evidence that she
 * forgot, and guessing wrong here would push her onto a screen that accuses her
 * of forgetting something she did not forget.
 *
 * @param {OpenClock | null} openClock
 * @param {number} nowMs epoch milliseconds, supplied by the caller
 * @returns {boolean}
 */
export function isStale(openClock, nowMs) {
  if (openClock === null || typeof openClock !== 'object') {
    return false;
  }
  const startedOn = localDate(openClock.at);
  const today = localDate(toWallClock(nowMs));
  if (startedOn === null || today === null) {
    return false;
  }
  return today !== startedOn;
}

/** `config.maxHours` as minutes, falling back if the caller supplies nonsense. */
function maxMinutes(config) {
  const hours = config === null || typeof config !== 'object' ? undefined : config.maxHours;
  const usable = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MAX_HOURS;
  return usable * MINUTES_PER_HOUR;
}

/**
 * Judge the end time she typed, and give back the duration if it stands.
 *
 * The three checks run in this order, and the order is a rule rather than an
 * implementation detail. A wrong-day entry is almost always also an
 * over-maximum one — put yesterday's date in and the session is a day long —
 * and "that's a really long time for one activity" is exactly the wrong thing to
 * say to someone who typed the wrong date. Day first means she is told the thing
 * that is actually wrong.
 *
 *   1. wrong-day        the day she gave is not the day she started
 *   2. end-before-start including equal times; a zero-length session is not a
 *                       measurement
 *   3. too-long         over `config.maxHours`
 *
 * Reason codes only, never sentences. The words belong to the UI, which is
 * writing for a child and needs to phrase the too-long case as an invitation to
 * split the session in two.
 *
 * A missing or malformed end reading fails the first check and so reports
 * 'wrong-day': it cannot yield a day, and no day can match. The UI is expected
 * to catch an empty field before it gets here, where it can say something
 * kinder.
 *
 * @param {OpenClock | null} openClock the clock being closed
 * @param {unknown} endWall the reading she typed, 'YYYY-MM-DDTHH:MM'
 * @param {{ maxHours?: number }} config
 * @returns {Result}
 */
export function validateClockOut(openClock, endWall, config) {
  const startWall = openClock === null || typeof openClock !== 'object' ? null : openClock.at;

  // 1. Wrong day.
  const startedOn = localDate(startWall);
  const endedOn = localDate(endWall);
  if (startedOn === null || endedOn === null || startedOn !== endedOn) {
    return { ok: false, reason: 'wrong-day' };
  }

  // Past that check both readings are known well-formed and on one calendar day,
  // so this cannot be null. A valid record never crosses midnight — a rule the
  // whole design rests on, safe only because these children do not work
  // overnight, and the reason the day check can stand in front of the arithmetic.
  const minutes = durationMinutes(startWall, endWall);

  // 2. End before start, equal times included.
  if (minutes <= 0) {
    return { ok: false, reason: 'end-before-start' };
  }

  // 3. Over the maximum. Strictly greater: exactly `maxHours` is a long day, not
  // an impossible one.
  if (minutes > maxMinutes(config)) {
    return { ok: false, reason: 'too-long' };
  }

  return { ok: true, minutes };
}
