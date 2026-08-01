// Seeded deterministic randomness.
//
// The scheduler owns no randomness of its own — it takes an `rng` parameter so
// the same model, history and config always produce the same fact for a given
// generator state. That property is what makes tools/replay.js able to answer
// "what would the new weights have done to real history" without shipping the
// change to a kid first.
//
// Two callers need a SEEDED generator: the tests, so a failure is reproducible
// from its seed, and the replay tool, so a comparison is repeatable. They must
// use the SAME generator — two independently-written PRNGs would make a replay
// result unreproducible from the test suite that validated the scheduler, and
// the divergence would be silent.
//
// Live gameplay does NOT use this. main.js supplies the real randomness source;
// it is one of the two modules allowed to be impure.
//
// Pure module: no clock, no randomness of its own beyond the caller's seed.

/**
 * mulberry32 — a small, fast, seeded generator returning values in [0, 1).
 *
 * Chosen for being short enough to audit at a glance and dependency-free. It is
 * not cryptographic and does not need to be; it schedules multiplication facts.
 *
 * @param {number} seed any integer; coerced to uint32
 * @returns {() => number} generator producing values in [0, 1)
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
