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
  build: 'm2',

  // Which mode a session runs in when the URL carries no ?mode= parameter.
  // The menu links to ?mode=learn and ?mode=drill, so this is a fallback for
  // opening index.html directly, not the primary mechanism.
  mode: 'drill',

  sessionLength: 20,

  // Learn mode: a few facts, cycled. Deliberately narrow and repetitive where
  // drill is broad and interleaved — blocked practice is right for ACQUISITION
  // (a route needs consecutive reps) and wrong for retention, which is why the
  // two modes have opposite structures. Expected to grow as the kids do.
  learnFacts: 3,
  learnPasses: 4,

  retain: 5,
  hotMs: 1500,
  // Above this, an attempt is not evidence of retrieval — it is evidence the kid
  // left the room. Drill reveals the answer within 8s at the slowest bucket, so
  // anything past a minute means they saw it and did not type it.
  // Tunable: the raw log keeps every ms, and this only affects derivation, so
  // changing it re-reads all history rather than losing anything.
  maxPlausibleMs: 60_000,

  // Drill mode's RETRIEVAL WINDOW: how long the kid gets before the answer
  // appears. In v1 this was the gap between hint rungs and a cold fact reached
  // the answer after three of them; drill now has exactly one transition, so
  // this single value is the whole window.
  //
  // THE DELAY GROWS WITH MASTERY. It does not shrink. A brand-new fact is
  // rescued soonest, which is what keeps acquisition errorless; a nearly
  // mastered one is made to work for it, because retrieval effort is the point
  // at that stage. This looks backwards and is not — a test asserts it.
  //
  // First thing to retune against real sessions. tools/replay.js can compare a
  // change against collected history before it reaches a kid.
  delays: { cold: 4000, warm: 6000, hot: 8000 },
  weights: { cold: 6, warm: 3, hot: 1 },
  noRepeatWithin: 4,
  governorWindow: 8,
  governorFloor: 0.8,
  // Learn mode only now — blocks are no longer a drill hint rung. Governs
  // whether a block array is drawn alongside the strategy. The lower bound of 1
  // lives in blocksApply: a product of 0 draws an empty array, which is a blank
  // region rather than a gentler hint.
  blocksMaxProduct: 25,
  logTail: 2000,
};
