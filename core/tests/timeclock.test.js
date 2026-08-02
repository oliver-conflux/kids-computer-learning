// Tests for core/timeclock.js — the module that holds every timeclock rule.
//
// Two mistakes this file exists to catch, both of which pass a casual reading:
//
//   1. Deriving the calendar day of `at` through a UTC instant. Every test here
//      runs in a negative-offset zone, where a late-afternoon local time already
//      belongs to tomorrow in UTC, so that bug fails a test instead of silently
//      rejecting every afternoon session a child ever logs.
//   2. Reordering the validation checks. A wrong-day entry is nearly always also
//      over the maximum, so check order is the only thing deciding which of two
//      true statements she is told.
//
// A fixed zone is pinned below rather than left to the machine. `toWallClock`
// and `isStale` are local by definition, so without a known zone their expected
// values are unwriteable — and the point-1 tests would quietly stop testing
// anything at all if CI happened to run in UTC.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  localDate,
  toWallClock,
  wallParts,
  durationMinutes,
  elapsedMinutesSince,
  formatDuration,
  deriveOpenClocks,
  isStale,
  validateClockOut,
} from '../timeclock.js';

// Pacific: UTC-7 in August. Chosen because it is where these children are and
// because its offset is negative, which is the condition that makes the
// local-day bug reachable at all.
process.env.TZ = 'America/Los_Angeles';

const CONFIG = { build: 'a1', logTail: 2000, maxHours: 5, activities: [] };

/** A well-formed clock-in event. */
function clockIn(id, at, extra = {}) {
  return {
    type: 'clock-in',
    t: '2026-08-04T17:00:31.482Z',
    id,
    activity: 'typing',
    description: 'Lesson 4',
    at,
    ...extra,
  };
}

/** The OpenClock a clock-in derives to, for the functions that take one directly. */
function openClock(at, extra = {}) {
  return {
    id: 'a_7f3c',
    activity: 'typing',
    description: 'Lesson 4',
    at,
    t: '2026-08-04T17:00:31.482Z',
    ...extra,
  };
}

/** Epoch ms for a local wall-clock reading, under the pinned zone. */
function localMs(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

// ---------------------------------------------------------------------------
// localDate — the same-day rule
// ---------------------------------------------------------------------------

test('localDate takes the calendar date off a wall-clock reading', () => {
  assert.equal(localDate('2026-08-04T10:00'), '2026-08-04');
  assert.equal(localDate('2026-08-04T00:00'), '2026-08-04');
  assert.equal(localDate('2026-08-04T23:59'), '2026-08-04');
});

test('a late-afternoon reading keeps its local day, though its UTC instant is tomorrow', () => {
  // THE test the wall-clock format exists to pass. 5 PM Pacific on the 4th is
  // midnight UTC on the 5th. Routing the day through an instant would file this
  // session under the 5th and break the same-day rule for every afternoon.
  assert.equal(localDate('2026-08-04T17:00'), '2026-08-04');

  // The bug, spelled out: the same reading treated as an instant, which is what
  // storing `at` in UTC would have produced.
  const asInstant = new Date(2026, 7, 4, 17, 0);
  assert.equal(
    asInstant.toISOString().slice(0, 10),
    '2026-08-05',
    'the pinned zone must actually put 5 PM local on the next UTC day, or this file proves nothing',
  );
});

test('a whole afternoon session validates as one day despite spanning UTC midnight', () => {
  // 4:30 PM and 6:00 PM Pacific are on opposite sides of midnight UTC.
  const result = validateClockOut(openClock('2026-08-04T16:30'), '2026-08-04T18:00', CONFIG);
  assert.deepEqual(result, { ok: true, minutes: 90 });
});

test('localDate rejects anything that is not a well-formed reading', () => {
  assert.equal(localDate('2026-08-04T17:00:31.482Z'), null, 'a machine instant is not a reading');
  assert.equal(localDate('2026-08-04T17:00Z'), null, 'the Z suffix is not part of this format');
  assert.equal(localDate('2026-08-04'), null, 'a date with no time');
  assert.equal(localDate('2026-8-4T17:00'), null, 'unpadded fields');
  assert.equal(localDate(''), null);
  assert.equal(localDate(null), null);
  assert.equal(localDate(undefined), null);
  assert.equal(localDate(20260804), null);
  assert.equal(localDate({ at: '2026-08-04T17:00' }), null);
});

test('localDate rejects readings that pass the shape but are not real times', () => {
  // Date.UTC rolls all of these over into some other real moment. Letting them
  // through would leave validateClockOut doing arithmetic on a fiction.
  assert.equal(localDate('2026-02-30T10:00'), null, 'February has no 30th');
  assert.equal(localDate('2026-13-01T10:00'), null, 'no 13th month');
  assert.equal(localDate('2026-08-04T25:00'), null, 'no 25 o\'clock');
  assert.equal(localDate('2026-08-04T10:99'), null, 'no 99th minute');
  assert.equal(localDate('2026-00-04T10:00'), null, 'no zeroth month');
});

test('localDate accepts a real leap day and rejects a fake one', () => {
  assert.equal(localDate('2028-02-29T10:00'), '2028-02-29');
  assert.equal(localDate('2026-02-29T10:00'), null);
});

// ---------------------------------------------------------------------------
// toWallClock
// ---------------------------------------------------------------------------

test('toWallClock renders the clock a person here would read', () => {
  assert.equal(toWallClock(localMs(2026, 8, 4, 10, 0)), '2026-08-04T10:00');
  assert.equal(toWallClock(localMs(2026, 8, 4, 23, 59)), '2026-08-04T23:59');
  assert.equal(toWallClock(localMs(2026, 1, 2, 3, 4)), '2026-01-02T03:04', 'fields are zero-padded');
});

test('toWallClock reads an instant back as the local day, not the UTC one', () => {
  // Midnight UTC on the 5th is 5 PM on the 4th where she is sitting.
  assert.equal(toWallClock(Date.UTC(2026, 7, 5, 0, 0)), '2026-08-04T17:00');
});

test('toWallClock round-trips with localDate', () => {
  assert.equal(localDate(toWallClock(localMs(2026, 8, 4, 17, 30))), '2026-08-04');
});

test('toWallClock rejects anything that is not a time', () => {
  assert.equal(toWallClock(Number.NaN), null);
  assert.equal(toWallClock(Infinity), null);
  assert.equal(toWallClock(null), null);
  assert.equal(toWallClock('2026-08-04T10:00'), null, 'it takes epoch ms, not a string');
  assert.equal(toWallClock(undefined), null);
});

// ---------------------------------------------------------------------------
// durationMinutes — arithmetic on what she observed
// ---------------------------------------------------------------------------

test('durationMinutes measures between two readings', () => {
  assert.equal(durationMinutes('2026-08-04T10:00', '2026-08-04T11:15'), 75);
  assert.equal(durationMinutes('2026-08-04T10:00', '2026-08-04T10:01'), 1);
});

test('durationMinutes crosses noon', () => {
  assert.equal(durationMinutes('2026-08-04T11:30', '2026-08-04T12:30'), 60);
  assert.equal(durationMinutes('2026-08-04T11:45', '2026-08-04T12:15'), 30);
});

test('durationMinutes crosses the 12 to 1 boundary', () => {
  // The one the 12-hour clock face makes look like going backwards.
  assert.equal(durationMinutes('2026-08-04T12:45', '2026-08-04T13:15'), 30);
  assert.equal(durationMinutes('2026-08-04T12:00', '2026-08-04T13:00'), 60);
});

test('durationMinutes returns zero for equal readings', () => {
  assert.equal(durationMinutes('2026-08-04T10:00', '2026-08-04T10:00'), 0);
});

test('durationMinutes goes negative rather than hiding a backwards pair', () => {
  assert.equal(durationMinutes('2026-08-04T11:00', '2026-08-04T10:00'), -60);
  assert.equal(durationMinutes('2026-08-04T10:00', '2026-08-03T10:00'), -1440);
});

test('durationMinutes is unaffected by the ambient zone', () => {
  // Both readings sit on the far side of UTC midnight; the answer is still the
  // number of minutes the clock face advanced.
  assert.equal(durationMinutes('2026-08-04T17:00', '2026-08-04T18:30'), 90);
});

test('durationMinutes spans a daylight-saving shift by clock face, not by elapsed time', () => {
  // Pacific springs forward at 2 AM on 2026-03-08. These readings are 3 hours
  // apart on the clock she is reading, which is what she measured and what the
  // record must say. Only a session that straddles 2 AM can see this, and the
  // design forbids one; the assertion pins the behaviour anyway.
  assert.equal(durationMinutes('2026-03-08T01:00', '2026-03-08T04:00'), 180);
});

test('durationMinutes returns null when either reading is malformed', () => {
  assert.equal(durationMinutes('2026-08-04T10:00', 'later'), null);
  assert.equal(durationMinutes(null, '2026-08-04T10:00'), null);
  assert.equal(durationMinutes('2026-08-04T10:00', '2026-08-04T10:00Z'), null);
  assert.equal(durationMinutes('2026-02-30T10:00', '2026-02-30T11:00'), null);
});

// ---------------------------------------------------------------------------
// elapsedMinutesSince — arithmetic on the machine instant
// ---------------------------------------------------------------------------

test('elapsedMinutesSince measures real time from the machine instant', () => {
  const started = '2026-08-04T17:00:00.000Z';
  assert.equal(elapsedMinutesSince(started, Date.parse(started) + 60000), 1);
  assert.equal(elapsedMinutesSince(started, Date.parse(started) + 90 * 60000), 90);
});

test('elapsedMinutesSince gives the different-day screen its hour count', () => {
  // The spec's worked example: clocked in Tuesday 10 AM, now Wednesday 11 AM.
  const started = '2026-08-04T17:00:00.000Z';
  const minutes = elapsedMinutesSince(started, Date.parse(started) + 25 * 60 * 60000);
  assert.equal(minutes, 1500);
  assert.equal(formatDuration(minutes), '25 hours');
});

test('elapsedMinutesSince truncates toward the past', () => {
  const started = '2026-08-04T17:00:00.000Z';
  assert.equal(elapsedMinutesSince(started, Date.parse(started) + 59999), 0);
  assert.equal(elapsedMinutesSince(started, Date.parse(started) + 119999), 1);
});

test('elapsedMinutesSince is not durationMinutes', () => {
  // Same session, two different questions. She read 10:00 and 11:00 off the
  // wall; the machine recorded instants 62 minutes apart. Both answers are
  // correct and they are not the same answer.
  assert.equal(durationMinutes('2026-08-04T10:00', '2026-08-04T11:00'), 60);
  assert.equal(
    elapsedMinutesSince('2026-08-04T17:00:00.000Z', Date.parse('2026-08-04T18:02:00.000Z')),
    62,
  );
});

test('elapsedMinutesSince returns null on unusable input', () => {
  assert.equal(elapsedMinutesSince('not a time', 0), null);
  assert.equal(elapsedMinutesSince(null, 0), null);
  assert.equal(elapsedMinutesSince('2026-08-04T17:00:00.000Z', Number.NaN), null);
  assert.equal(elapsedMinutesSince('2026-08-04T17:00:00.000Z', undefined), null);
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

test('formatDuration renders the spec example', () => {
  assert.equal(formatDuration(75), '1 hour 15 minutes');
});

test('formatDuration handles the singular and plural of both units', () => {
  assert.equal(formatDuration(1), '1 minute');
  assert.equal(formatDuration(2), '2 minutes');
  assert.equal(formatDuration(60), '1 hour');
  assert.equal(formatDuration(61), '1 hour 1 minute');
  assert.equal(formatDuration(120), '2 hours');
  assert.equal(formatDuration(121), '2 hours 1 minute');
  assert.equal(formatDuration(125), '2 hours 5 minutes');
});

test('formatDuration drops an empty half rather than saying zero of it', () => {
  assert.equal(formatDuration(45), '45 minutes');
  assert.equal(formatDuration(180), '3 hours');
});

test('formatDuration renders zero as a quantity, not as nothing', () => {
  assert.equal(formatDuration(0), '0 minutes');
});

test('formatDuration covers the over-maximum copy', () => {
  // The spec's over-maximum screen: "That's 6 hours 20 minutes."
  assert.equal(formatDuration(380), '6 hours 20 minutes');
});

test('formatDuration keeps a negative sign rather than lying about direction', () => {
  assert.equal(formatDuration(-15), '-15 minutes');
  assert.equal(formatDuration(-75), '-1 hour 15 minutes');
});

test('formatDuration returns null when there is no number to format', () => {
  assert.equal(formatDuration(Number.NaN), null);
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration('75'), null);
  assert.equal(formatDuration(undefined), null);
});

// ---------------------------------------------------------------------------
// deriveOpenClocks — the fold
// ---------------------------------------------------------------------------

test('an empty log has no open clocks', () => {
  assert.deepEqual(deriveOpenClocks([]), []);
});

test('a clock-in opens a clock carrying every field the UI needs', () => {
  const open = deriveOpenClocks([clockIn('a_7f3c', '2026-08-04T10:00')]);
  assert.equal(open.length, 1);
  assert.deepEqual(open[0], {
    id: 'a_7f3c',
    activity: 'typing',
    description: 'Lesson 4',
    at: '2026-08-04T10:00',
    t: '2026-08-04T17:00:31.482Z',
  });
});

test('a matching clock-out closes the clock', () => {
  const events = [
    clockIn('a_7f3c', '2026-08-04T10:00'),
    { type: 'clock-out', t: '2026-08-04T18:02:14.907Z', id: 'a_7f3c', at: '2026-08-04T11:00' },
  ];
  assert.deepEqual(deriveOpenClocks(events), []);
});

test('a matching clock-void discards the clock', () => {
  const events = [
    clockIn('a_9b21', '2026-08-04T10:00'),
    { type: 'clock-void', t: '2026-08-05T18:11:02.114Z', id: 'a_9b21', reason: 'stale' },
  ];
  assert.deepEqual(deriveOpenClocks(events), []);
});

test('a clock-out with no matching clock-in is ignored', () => {
  const events = [
    { type: 'clock-out', t: '2026-08-04T18:02:14.907Z', id: 'a_ffff', at: '2026-08-04T11:00' },
    clockIn('a_7f3c', '2026-08-04T10:00'),
  ];
  const open = deriveOpenClocks(events);
  assert.deepEqual(open.map((clock) => clock.id), ['a_7f3c'], 'it closed nothing');
});

test('a clock-void with no matching clock-in is ignored', () => {
  const events = [
    { type: 'clock-void', t: '2026-08-04T18:11:02.114Z', id: 'a_ffff', reason: 'stale' },
    clockIn('a_7f3c', '2026-08-04T10:00'),
  ];
  assert.deepEqual(deriveOpenClocks(events).map((clock) => clock.id), ['a_7f3c']);
});

test('a clock-in whose id is already open is ignored, first reading wins', () => {
  const events = [
    clockIn('a_7f3c', '2026-08-04T10:00'),
    clockIn('a_7f3c', '2026-08-04T14:00', { description: 'Lesson 9' }),
  ];
  const open = deriveOpenClocks(events);
  assert.equal(open.length, 1);
  assert.equal(open[0].at, '2026-08-04T10:00');
  assert.equal(open[0].description, 'Lesson 4');
});

test('one clock-out closes a duplicated id exactly once', () => {
  // The duplicate never opened, so the single close must leave nothing behind.
  const events = [
    clockIn('a_7f3c', '2026-08-04T10:00'),
    clockIn('a_7f3c', '2026-08-04T14:00'),
    { type: 'clock-out', t: '2026-08-04T18:02:14.907Z', id: 'a_7f3c', at: '2026-08-04T11:00' },
  ];
  assert.deepEqual(deriveOpenClocks(events), []);
});

test('several open clocks come back newest first', () => {
  // Unreachable through the UI, reachable with two browser tabs. The bar shows
  // the newest and closing it reveals the next.
  const events = [
    clockIn('a_1111', '2026-08-04T09:00'),
    clockIn('a_2222', '2026-08-04T10:00'),
    clockIn('a_3333', '2026-08-04T11:00'),
  ];
  assert.deepEqual(deriveOpenClocks(events).map((clock) => clock.id), ['a_3333', 'a_2222', 'a_1111']);
});

test('closing the newest of several reveals the next', () => {
  const events = [
    clockIn('a_1111', '2026-08-04T09:00'),
    clockIn('a_2222', '2026-08-04T10:00'),
    { type: 'clock-out', t: '2026-08-04T18:02:14.907Z', id: 'a_2222', at: '2026-08-04T11:00' },
  ];
  assert.deepEqual(deriveOpenClocks(events).map((clock) => clock.id), ['a_1111']);
});

test('a corrupt line never throws and never breaks the session around it', () => {
  const events = [
    null,
    undefined,
    'not an object',
    42,
    [],
    {},
    { type: 'clock-in' },
    { type: 'attempt', item: 'cat', ms: 900 },
    { type: 'unheard-of', id: 'a_7f3c' },
    clockIn('a_7f3c', '2026-08-04T10:00'),
    { type: 'clock-out' },
    { type: 'clock-out', id: null },
    { type: 'clock-void', id: 7 },
  ];
  const open = deriveOpenClocks(events);
  assert.deepEqual(open.map((clock) => clock.id), ['a_7f3c'], 'the one good line survived');
});

test('a clock-in missing a field the UI depends on is skipped', () => {
  const cases = [
    ['no id', clockIn(undefined, '2026-08-04T10:00')],
    ['empty id', clockIn('', '2026-08-04T10:00')],
    ['non-string id', clockIn(7, '2026-08-04T10:00')],
    ['no activity', clockIn('a_7f3c', '2026-08-04T10:00', { activity: undefined })],
    ['empty activity', clockIn('a_7f3c', '2026-08-04T10:00', { activity: '' })],
    ['no at', clockIn('a_7f3c', undefined)],
    ['at with a Z', clockIn('a_7f3c', '2026-08-04T10:00Z')],
    ['impossible at', clockIn('a_7f3c', '2026-08-04T25:00')],
    ['no t', clockIn('a_7f3c', '2026-08-04T10:00', { t: undefined })],
    ['unreadable t', clockIn('a_7f3c', '2026-08-04T10:00', { t: 'sometime' })],
  ];
  for (const [label, event] of cases) {
    assert.deepEqual(deriveOpenClocks([event]), [], label);
  }
});

test('a clock-in with no description opens with an empty one, never undefined', () => {
  const open = deriveOpenClocks([clockIn('a_7f3c', '2026-08-04T10:00', { description: undefined })]);
  assert.equal(open[0].description, '');
  const numbered = deriveOpenClocks([clockIn('a_7f3c', '2026-08-04T10:00', { description: 7 })]);
  assert.equal(numbered[0].description, '');
});

test('deriveOpenClocks tolerates a caller with no events at all', () => {
  assert.deepEqual(deriveOpenClocks(null), []);
  assert.deepEqual(deriveOpenClocks(undefined), []);
  assert.deepEqual(deriveOpenClocks('clock-in'), []);
  assert.deepEqual(deriveOpenClocks({ 0: clockIn('a_7f3c', '2026-08-04T10:00') }), []);
});

test('deriveOpenClocks does not mutate the events it is given', () => {
  const events = [clockIn('a_7f3c', '2026-08-04T10:00')];
  const before = JSON.stringify(events);
  deriveOpenClocks(events);
  assert.equal(JSON.stringify(events), before);
});

// ---------------------------------------------------------------------------
// isStale — the screen-load check, distinct from same-day validation
// ---------------------------------------------------------------------------

test('a clock started today is not stale', () => {
  const clock = openClock('2026-08-04T10:00');
  assert.equal(isStale(clock, localMs(2026, 8, 4, 14, 30)), false);
  assert.equal(isStale(clock, localMs(2026, 8, 4, 23, 59)), false, 'still the same day at 11:59 PM');
});

test('a clock started yesterday is stale', () => {
  const clock = openClock('2026-08-04T10:00');
  assert.equal(isStale(clock, localMs(2026, 8, 5, 11, 0)), true);
  assert.equal(isStale(clock, localMs(2026, 8, 5, 0, 1)), true, 'stale one minute after midnight');
});

test('staleness is decided on the local day, not the UTC one', () => {
  // 5 PM on the 4th is already the 5th in UTC. A UTC comparison would call this
  // clock stale the moment she started it.
  const clock = openClock('2026-08-04T17:00');
  assert.equal(isStale(clock, localMs(2026, 8, 4, 18, 0)), false);
});

test('staleness and the same-day rule are two different checks at two moments', () => {
  // She clocked in Tuesday and is back on Wednesday: stale on load.
  const clock = openClock('2026-08-04T10:00');
  assert.equal(isStale(clock, localMs(2026, 8, 5, 11, 0)), true);

  // She is then asked what time she finished on TUESDAY, and a Tuesday answer is
  // accepted — the current time has no say in it. Collapsing the two checks
  // would reject this and make the different-day path a dead end.
  assert.deepEqual(
    validateClockOut(clock, '2026-08-04T11:00', CONFIG),
    { ok: true, minutes: 60 },
  );

  // A Wednesday answer is still wrong-day, exactly as the spec says it stays
  // reachable on the stale path.
  assert.deepEqual(
    validateClockOut(clock, '2026-08-05T11:00', CONFIG),
    { ok: false, reason: 'wrong-day' },
  );
});

test('isStale says no when it cannot tell', () => {
  // Not knowing is not evidence she forgot, and the stale screen accuses her.
  assert.equal(isStale(null, localMs(2026, 8, 5, 11, 0)), false);
  assert.equal(isStale(undefined, localMs(2026, 8, 5, 11, 0)), false);
  assert.equal(isStale(openClock('garbage'), localMs(2026, 8, 5, 11, 0)), false);
  assert.equal(isStale(openClock('2026-08-04T10:00'), Number.NaN), false);
  assert.equal(isStale(openClock('2026-08-04T10:00'), undefined), false);
});

// ---------------------------------------------------------------------------
// validateClockOut — the three checks, in order
// ---------------------------------------------------------------------------

test('a good entry comes back with its duration', () => {
  assert.deepEqual(
    validateClockOut(openClock('2026-08-04T10:00'), '2026-08-04T11:15', CONFIG),
    { ok: true, minutes: 75 },
  );
});

test('an end time on another day is wrong-day', () => {
  assert.deepEqual(
    validateClockOut(openClock('2026-08-04T10:00'), '2026-08-05T11:00', CONFIG),
    { ok: false, reason: 'wrong-day' },
  );
  assert.deepEqual(
    validateClockOut(openClock('2026-08-04T10:00'), '2026-08-03T11:00', CONFIG),
    { ok: false, reason: 'wrong-day' },
  );
});

test('an end time before the start is end-before-start', () => {
  assert.deepEqual(
    validateClockOut(openClock('2026-08-04T11:00'), '2026-08-04T10:00', CONFIG),
    { ok: false, reason: 'end-before-start' },
  );
});

test('equal start and end is end-before-start, not a zero-minute session', () => {
  // A zero-length session is not a measurement.
  assert.deepEqual(
    validateClockOut(openClock('2026-08-04T10:00'), '2026-08-04T10:00', CONFIG),
    { ok: false, reason: 'end-before-start' },
  );
});

test('one minute of work is a measurement', () => {
  assert.deepEqual(
    validateClockOut(openClock('2026-08-04T10:00'), '2026-08-04T10:01', CONFIG),
    { ok: true, minutes: 1 },
  );
});

test('the maximum is a boundary that holds on both sides', () => {
  const clock = openClock('2026-08-04T09:00');

  assert.deepEqual(
    validateClockOut(clock, '2026-08-04T13:59', CONFIG),
    { ok: true, minutes: 299 },
    'a minute under the maximum',
  );
  assert.deepEqual(
    validateClockOut(clock, '2026-08-04T14:00', CONFIG),
    { ok: true, minutes: 300 },
    'exactly the maximum is a long day, not an impossible one',
  );
  assert.deepEqual(
    validateClockOut(clock, '2026-08-04T14:01', CONFIG),
    { ok: false, reason: 'too-long' },
    'a minute over the maximum',
  );
});

test('the maximum comes from config, not from the module', () => {
  const clock = openClock('2026-08-04T09:00');
  const strict = { maxHours: 2 };

  assert.deepEqual(validateClockOut(clock, '2026-08-04T11:00', strict), { ok: true, minutes: 120 });
  assert.deepEqual(
    validateClockOut(clock, '2026-08-04T11:01', strict),
    { ok: false, reason: 'too-long' },
  );

  // And the same entry stands under the real config.
  assert.deepEqual(validateClockOut(clock, '2026-08-04T11:01', CONFIG), { ok: true, minutes: 121 });
});

test('a wrong day that is also over the maximum reports wrong-day', () => {
  // THE ordering test. Yesterday's date makes the session a day long, so it trips
  // the maximum too — but "that's a really long time for one activity" is the
  // wrong thing to say to someone who typed the wrong date.
  const clock = openClock('2026-08-04T10:00');
  const result = validateClockOut(clock, '2026-08-05T11:00', CONFIG);

  assert.deepEqual(result, { ok: false, reason: 'wrong-day' });
  assert.equal(
    durationMinutes(clock.at, '2026-08-05T11:00'),
    1500,
    'and it really is over the maximum, so the order is what decided this',
  );
});

test('a wrong day that is also backwards reports wrong-day', () => {
  const clock = openClock('2026-08-04T10:00');
  const result = validateClockOut(clock, '2026-08-03T09:00', CONFIG);

  assert.deepEqual(result, { ok: false, reason: 'wrong-day' });
  assert.equal(durationMinutes(clock.at, '2026-08-03T09:00'), -1500, 'it is also backwards');
});

test('a backwards entry reports end-before-start even when it is huge', () => {
  // Same day, so the day check passes; the second check must beat the third.
  const clock = openClock('2026-08-04T23:00');
  assert.deepEqual(
    validateClockOut(clock, '2026-08-04T00:00', CONFIG),
    { ok: false, reason: 'end-before-start' },
  );
});

test('an unusable end reading cannot pass the day check', () => {
  const clock = openClock('2026-08-04T10:00');
  for (const bad of [undefined, null, '', 'noon', '2026-08-04', '2026-08-04T11:00Z', 1100]) {
    const result = validateClockOut(clock, bad, CONFIG);
    assert.deepEqual(result, { ok: false, reason: 'wrong-day' }, JSON.stringify(bad));
  }
});

test('an unusable open clock is rejected rather than throwing', () => {
  for (const bad of [null, undefined, {}, openClock('garbage')]) {
    const result = validateClockOut(bad, '2026-08-04T11:00', CONFIG);
    assert.deepEqual(result, { ok: false, reason: 'wrong-day' });
  }
});

test('a missing or nonsense config falls back rather than admitting everything', () => {
  const clock = openClock('2026-08-04T09:00');
  for (const bad of [undefined, null, {}, { maxHours: 0 }, { maxHours: -1 }, { maxHours: 'five' }]) {
    assert.deepEqual(
      validateClockOut(clock, '2026-08-04T14:01', bad),
      { ok: false, reason: 'too-long' },
      JSON.stringify(bad),
    );
    assert.deepEqual(validateClockOut(clock, '2026-08-04T14:00', bad), { ok: true, minutes: 300 });
  }
});

test('validateClockOut hands back reason codes, never sentences', () => {
  // The UI owns the words; core must not grow a second copy of them.
  const clock = openClock('2026-08-04T10:00');
  const rejections = [
    validateClockOut(clock, '2026-08-05T11:00', CONFIG),
    validateClockOut(clock, '2026-08-04T09:00', CONFIG),
    validateClockOut(clock, '2026-08-04T16:00', CONFIG),
  ];

  assert.deepEqual(rejections.map((result) => result.reason), [
    'wrong-day',
    'end-before-start',
    'too-long',
  ]);
  for (const result of rejections) {
    assert.equal(result.ok, false);
    assert.equal(Object.hasOwn(result, 'minutes'), false, 'a rejection carries no duration');
    assert.match(result.reason, /^[a-z-]+$/, 'a code, not prose');
  }
});

test('an accepted result carries minutes and no reason', () => {
  const result = validateClockOut(openClock('2026-08-04T10:00'), '2026-08-04T11:15', CONFIG);
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'reason'), false);
  assert.equal(formatDuration(result.minutes), '1 hour 15 minutes', 'the spec\'s worked example');
});

// ---------------------------------------------------------------------------
// wallParts — the one parser
// ---------------------------------------------------------------------------
//
// Exported so `main.js` and `bar.js` stop deriving these numbers themselves.
// Before this existed the wall-clock format lived in three files: this one,
// a byte-identical regex in main.js, and — worst — hardcoded slice offsets in
// bar.js that never restated the format at all. Relaxing the pattern here would
// have left the bar slicing at stale positions and rendering "started undefined
// at NaN: PM" on the games menu, with nothing thrown. These tests exist so the
// format stays one fact.

test('wallParts splits a reading into the five numbers a display needs', () => {
  assert.deepEqual(wallParts('2026-08-04T10:00'), {
    year: 2026, month: 8, day: 4, hour: 10, minute: 0,
  });
  // 1-based, as written on the page — callers building a Date subtract one.
  assert.equal(wallParts('2026-01-31T23:59').month, 1);
});

test('wallParts rejects everything localDate rejects, and agrees with it exactly', () => {
  // The two must never disagree: bar.js used to ask localDate for permission and
  // then parse by hand, so a reading one accepted and the other mangled printed
  // garbage rather than nothing.
  const readings = [
    '2026-08-04T10:00',   // good
    '2026-02-30T10:00',   // rolls over — not a real day
    '2026-08-04T25:00',   // rolls over — not a real hour
    '2026-08-04T10:60',   // rolls over — not a real minute
    '2026-8-4T10:00',     // the relaxed form the pattern does NOT admit
    '2026-08-04T10:00:00',// seconds are not part of a reading
    '2026-08-04T10:00Z',  // a Z makes it an instant, not a reading
    '', '   ', 'noon', '10am',
  ];
  for (const wall of readings) {
    assert.equal(
      wallParts(wall) === null,
      localDate(wall) === null,
      `wallParts and localDate must agree about ${JSON.stringify(wall)}`,
    );
  }
});

test('localDate builds its answer from wallParts rather than slicing the string', () => {
  // Agreeing about VALIDITY is not enough, and the first version of the test
  // above only checked that. The bug it missed: `localDate` slicing ten
  // characters off a reading whose pattern had been relaxed. Both functions
  // still returned non-null — they "agreed" — while one returned '2026-8-2T9',
  // a date equal to nothing. `isStale` then calls a one-hour-old timer stale and
  // `validateClockOut` rejects every end time as the wrong day, so she cannot
  // close a timer she started an hour ago.
  //
  // So this pins the VALUE against the parsed numbers. Be honest about its
  // reach: while the pattern is fixed-width a slice returns the same bytes, so
  // this test alone would not have caught that bug. It catches other drift in
  // what localDate returns, and the structural test below covers the slice.
  const readings = ['2026-08-04T10:00', '2026-01-01T00:00', '2026-12-31T23:59'];
  for (const wall of readings) {
    const parts = wallParts(wall);
    const expected = `${String(parts.year).padStart(4, '0')}-`
      + `${String(parts.month).padStart(2, '0')}-`
      + `${String(parts.day).padStart(2, '0')}`;
    assert.equal(localDate(wall), expected, `localDate must rebuild ${wall} from its parts`);
  }
});

test('a date is always ten characters, so the same-day rule can compare strings', () => {
  // validateClockOut decides "same day" with ===, which is only sound while
  // every date comes out canonically padded. A hand-cut date could not promise
  // that; one derived from the numbers can.
  for (const wall of ['2026-08-04T10:00', '2026-01-09T09:05', '2026-11-30T23:00']) {
    assert.match(localDate(wall), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(localDate(wall).length, 10);
  }
});

test('no date in this module is cut out of a string with an offset', () => {
  // A STRUCTURAL test, in the style of the purity test below, and it exists
  // because behaviour cannot express this one. While the pattern is fixed-width,
  // slicing ten characters and building from the parsed numbers produce byte-
  // identical answers — every behavioural test passes against either. The two
  // only diverge once someone relaxes the pattern, and at that point the slicing
  // version returns '2026-8-2T9': a date equal to nothing, which calls a
  // one-hour-old timer stale and rejects every end time she can type.
  //
  // This exact hazard has already moved once. It lived in bar.js as hardcoded
  // offsets, was removed from there, and turned out to be sitting in localDate
  // too. So the rule is pinned where a reader will trip over it rather than left
  // to the next person to rediscover: in this module, a date comes from
  // wallParts, never from an offset into the reading.
  const source = readFileSync(new URL('../timeclock.js', import.meta.url), 'utf8');

  const offsetCuts = source.match(/\bwall\w*\.slice\s*\(/g) ?? [];
  assert.deepEqual(
    offsetCuts,
    [],
    'a wall-clock reading must be read through wallParts, not sliced at an offset',
  );
});

test('wallParts refuses anything that is not a string', () => {
  for (const value of [null, undefined, 20260804, {}, [], new Date()]) {
    assert.equal(wallParts(value), null);
  }
});

test('wallParts reads the digits she typed, whatever zone the machine is in', () => {
  // The reading carries no zone. Parsed against the ambient one, a 5 PM Pacific
  // reading would come back as the next day — the exact bug the wall-clock
  // format exists to prevent, and the reason this returns numbers rather than
  // an instant.
  const parts = wallParts('2026-08-04T17:30');
  assert.equal(parts.day, 4);
  assert.equal(parts.hour, 17);
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test('core/timeclock.js reaches for nothing outside itself', () => {
  // The rule that makes every test above possible without mocking a global. It
  // is cheap to break by accident and invisible in review once the module is
  // long, so it is pinned here rather than left to a reader.
  const source = readFileSync(new URL('../timeclock.js', import.meta.url), 'utf8');

  const forbidden = [
    'Date.now',       // the current time is an argument, always
    'Math.random',    // ids are the caller's business
    'document',
    'window',
    'localStorage',
    'fetch',
    'require(',
    'import(',
  ];
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `core/timeclock.js must not mention ${token}`);
  }

  assert.equal(/^\s*import\s/m.test(source), false, 'and it imports nothing');
});
