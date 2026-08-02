// The timeclock's tunables table.
//
// Same arrangement as each game's config.js: every magic number the timeclock
// has lives here and nowhere else, and nothing downstream hard-codes a value
// that appears in this table. `core/timeclock.js` takes `config` as a parameter
// rather than importing this file, which is what keeps it pure and lets its
// tests drive it under a different table.
//
// `build` is the version tag written onto every logged event. Bump it whenever
// a rule in `core/timeclock.js` changes, so before/after comparison across the
// log is a filter rather than a guess.
//
// WHICH MODULE READS EACH KEY:
//
//   core/log.js           logTail  (via activity-log/js/log.js's defaultTail)
//   core/timeclock.js     maxHours (passed in by main.js as `config`)
//   activity-log/js/main.js  build, activities
//
// This table is smaller than the games' because the timeclock has no scheduler
// and no mastery model — there is nothing to tune about it except how long a
// session may plausibly be and what she can clock into.

export const CONFIG = {
  build: 'a1',

  // How many log lines to ask the server for at page load. Matches the games:
  // one bounded read, then a linear fold in memory.
  logTail: 2000,

  // The longest session `validateClockOut` will accept, in hours. Five is a
  // judgement about a child's day, not about the clock: past five hours on one
  // activity the likeliest explanation is a forgotten clock-out or a mistyped
  // time, not a genuine marathon. So it is a rejection with an invitation to
  // split the session in two, rather than a silent acceptance of a number that
  // is probably wrong. It also keeps every valid record inside a single
  // calendar day, which is what makes the same-day rule a string comparison.
  maxHours: 5,

  // The dropdown, read by main.js to build the <select>.
  //
  // THE `value` STRINGS MUST STAY IDENTICAL TO THE `LOG_PATHS` KEYS in
  // server/serve.js (`typing`, `math`, `spelling`). That single naming rule is
  // the whole preparation for cross-checking her claim against what the game
  // logs actually recorded: activity name -> log file, no translation table and
  // no string-guessing. Prettify a value here — 'Typing Practice', 'maths' —
  // and that join is broken forever, silently, because nothing fails at the
  // moment you break it. `label` is where the prettifying belongs.
  //
  // v1 ships only activities the machine can verify. Adding an unverifiable one
  // later (reading, art) is an entry in this array and nothing else.
  activities: [
    { value: 'typing',   label: 'Typing' },
    { value: 'math',     label: 'Math' },
    { value: 'spelling', label: 'Spelling' },
  ],
};
