// The fact space.
//
// A Fact is { op: '*', a, b } with a and b each 0..10 and the pair ORDERED.
// A FactId is `${op}:${a}x${b}` — e.g. "*:6x7".
//
// 6x7 and 7x6 are TWO DIFFERENT FACTS with two different ids, and nothing in
// this codebase ever merges them. This is deliberate: commutativity is
// understood as a rule long before retrieval becomes symmetric, so each
// orientation carries its own latency history and its own bucket. Merging them
// would average that asymmetry away and report a fact as half-learned when the
// truth is "learned in one direction and not the other" — a different diagnosis
// with a different fix. See spec §1. Do not add a canonicalising helper.
//
// Pure module: no DOM, no network, no clock, no randomness.

const MIN_OPERAND = 0;
const MAX_OPERAND = 10;

const FACT_ID_PATTERN = /^([^:]+):(\d+)x(\d+)$/;

/**
 * All 121 ordered pairs for operands 0..10.
 *
 * Order is stable and row-major: `a` ascends in the outer loop, `b` in the
 * inner. So the sequence runs 0x0, 0x1, ... 0x10, 1x0, 1x1, ... 10x10, and
 * index === a * 11 + b. Both orientations of a pair are present and are
 * separate entries.
 *
 * @returns {{op: string, a: number, b: number}[]}
 */
export function allFacts() {
  const facts = [];
  for (let a = MIN_OPERAND; a <= MAX_OPERAND; a += 1) {
    for (let b = MIN_OPERAND; b <= MAX_OPERAND; b += 1) {
      facts.push({ op: '*', a, b });
    }
  }
  return facts;
}

/**
 * @param {{op: string, a: number, b: number}} fact
 * @returns {string} the fact's id, e.g. "*:6x7"
 */
export function factId(fact) {
  return `${fact.op}:${fact.a}x${fact.b}`;
}

/**
 * Inverse of factId. Operand order is preserved — parsing "*:7x6" gives
 * { op: '*', a: 7, b: 6 }, never the transpose.
 *
 * @param {string} id
 * @returns {{op: string, a: number, b: number}}
 */
export function parseFactId(id) {
  const match = FACT_ID_PATTERN.exec(id);
  if (match === null) {
    throw new Error(`Malformed fact id: ${id}`);
  }
  return { op: match[1], a: Number(match[2]), b: Number(match[3]) };
}

/**
 * @param {{op: string, a: number, b: number}} fact
 * @returns {number} the product
 */
export function answerOf(fact) {
  return fact.a * fact.b;
}

/**
 * Digit count of the product, which is what drives the answer-slot count and
 * the "evaluate at length" rule in the engine. Answers span 0..100, so this is
 * 1, 2, or 3 — and 100 is the only three-digit answer in the set.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @returns {number} 1, 2, or 3
 */
export function answerDigits(fact) {
  return String(answerOf(fact)).length;
}

/**
 * The id of the reversed pair — transposeId({op:'*',a:6,b:7}) === "*:7x6".
 *
 * This exists so the scheduler can keep the two orientations from being served
 * adjacently (spec §7). It is emphatically NOT a canonicalisation: it names the
 * other fact, it does not merge with it.
 *
 * @param {{op: string, a: number, b: number}} fact
 * @returns {string}
 */
export function transposeId(fact) {
  return `${fact.op}:${fact.b}x${fact.a}`;
}
