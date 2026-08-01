// The single tunables table for the whole system.
//
// Every magic number in the codebase lives here and nowhere else. Scheduling
// weights, hint delays, bucket thresholds, session shape — all of it. Nothing
// downstream hard-codes a number that appears in this table; modules take
// `config` as a parameter so the same logic can be replayed under a different
// table offline (see tools/replay.js).
//
// `build` is the version tag written onto every logged event. Bump it whenever
// scheduler weights, hint delays, or bucket thresholds change, so before/after
// comparison across the log is a filter rather than a guess.

export const CONFIG = {
  build: 'm1',
  sessionLength: 20,
  retain: 5,
  hotMs: 1500,
  delays: { cold: 2000, warm: 4000, hot: 6000 },
  weights: { cold: 6, warm: 3, hot: 1 },
  noRepeatWithin: 4,
  governorWindow: 8,
  governorFloor: 0.8,
  blocksMaxProduct: 25,
  logTail: 2000,
};
