import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ladderFor, blocksApply, delayMsFor, nextStage } from '../js/hints.js';
import { strategyFor } from '../js/strategies.js';
import { allFacts, factId, answerOf } from '../js/facts.js';
import { CONFIG } from '../js/config.js';

const DRILL_LADDER = ['clean', 'reveal'];
const LEARN_LADDER = ['strategy', 'reveal'];

function fact(a, b) {
  return { op: '*', a, b };
}

// --- ladderFor ------------------------------------------------------------

test('the drill ladder is exactly clean -> reveal for all 121 facts', () => {
  // No exceptions, no predicates, no per-fact variation. Drill offering help on
  // 4 x 5 but not 6 x 7 would read as the game being arbitrary rather than
  // consistent, for a difference no kid can perceive.
  const facts = allFacts();
  assert.equal(facts.length, 121);
  for (const f of facts) {
    assert.deepEqual(ladderFor(f, CONFIG, 'drill'), DRILL_LADDER, factId(f));
  }
});

test('the learn ladder is exactly strategy -> reveal for all 121 facts', () => {
  // 'strategy' is the INITIAL stage in learn mode: the text is on screen from
  // the first frame, not held back as a rescue. There is no 'clean' rung, which
  // is what keeps learn attempts out of mastery's "clean means retrieval" rule
  // by construction.
  for (const f of allFacts()) {
    assert.deepEqual(ladderFor(f, CONFIG, 'learn'), LEARN_LADDER, factId(f));
  }
});

test('the ordered ladder is the learn ladder — the same two rungs', () => {
  // Ordered mode borrows learn's feel entirely: the strategy is on screen from
  // the first frame, the answer is behind a button, and there is no clock. It
  // changes exactly one thing, which is which facts get served and in what
  // order — and that is a session decision this module never sees. A 'clean'
  // rung here would put ordered attempts inside mastery's "clean means
  // retrieval" rule, which is the seam the whole mode sits on the other side of.
  for (const f of allFacts()) {
    assert.deepEqual(ladderFor(f, CONFIG, 'ordered'), LEARN_LADDER, factId(f));
    assert.ok(!ladderFor(f, CONFIG, 'ordered').includes('clean'), factId(f));
  }
});

test('a learn ladder never contains clean, and a drill ladder never contains strategy', () => {
  for (const f of allFacts()) {
    assert.ok(!ladderFor(f, CONFIG, 'learn').includes('clean'), factId(f));
    assert.ok(!ladderFor(f, CONFIG, 'drill').includes('strategy'), factId(f));
  }
});

test('blocks is not a stage in either mode', () => {
  // Blocks are a second REPRESENTATION rendered alongside the strategy, not a
  // rung. The renderer asks blocksApply directly.
  for (const f of allFacts()) {
    assert.ok(!ladderFor(f, CONFIG, 'drill').includes('blocks'), factId(f));
    assert.ok(!ladderFor(f, CONFIG, 'learn').includes('blocks'), factId(f));
  }
});

test('every ladder ends in reveal and has exactly two stages', () => {
  for (const f of allFacts()) {
    for (const mode of ['drill', 'learn', 'ordered']) {
      const ladder = ladderFor(f, CONFIG, mode);
      assert.equal(ladder.length, 2, `${factId(f)} ${mode}`);
      assert.equal(ladder[ladder.length - 1], 'reveal', `${factId(f)} ${mode}`);
      assert.equal(new Set(ladder).size, 2, `${factId(f)} ${mode} repeats a stage`);
    }
  }
});

test('the ladder does not vary with the presence of strategy text', () => {
  // The hard middle and the trivial rows get the same shape. 1 x 7 has no
  // strategy text at all and its learn ladder is still strategy -> reveal; what
  // the strategy region shows for such a fact is the renderer's problem. (Note
  // the learn SELECTOR never offers such a fact — but the ladder is a pure
  // function of mode and must not vary.)
  assert.equal(strategyFor(fact(1, 7)), null);
  assert.deepEqual(ladderFor(fact(1, 7), CONFIG, 'learn'), LEARN_LADDER);
  assert.deepEqual(ladderFor(fact(6, 7), CONFIG, 'learn'), LEARN_LADDER);
  assert.deepEqual(ladderFor(fact(7, 7), CONFIG, 'drill'), DRILL_LADDER);
  assert.deepEqual(ladderFor(fact(6, 7), CONFIG, 'drill'), DRILL_LADDER);
});

test('the ladder does not vary with blocksMaxProduct', () => {
  // blocksMaxProduct governs learn-mode rendering only; it can no longer move a
  // rung in or out of any ladder.
  const noBlocks = { ...CONFIG, blocksMaxProduct: 0 };
  const allBlocks = { ...CONFIG, blocksMaxProduct: 100 };
  for (const f of [fact(2, 3), fact(9, 9), fact(6, 7)]) {
    assert.deepEqual(ladderFor(f, noBlocks, 'drill'), DRILL_LADDER);
    assert.deepEqual(ladderFor(f, allBlocks, 'drill'), DRILL_LADDER);
    assert.deepEqual(ladderFor(f, noBlocks, 'learn'), LEARN_LADDER);
    assert.deepEqual(ladderFor(f, allBlocks, 'learn'), LEARN_LADDER);
  }
});

test('there is no mode fallback left in the config, so an omitted mode throws', () => {
  // `CONFIG.mode` is gone. It was the fallback for a URL with no ?mode=, and a
  // URL with no ?mode= now means "show the menu" rather than "start whatever
  // this key says" — nobody arriving with no query string has chosen a mode.
  //
  // The consequence is worth a test of its own, because the OLD behaviour was
  // the silent one: `ladderFor(fact, CONFIG)` inside a learn session used to
  // return the DRILL ladder, and the kid got a hint-free screen while the log
  // recorded `stage: 'clean'` on instruction attempts. Now it throws. Call
  // sites pass the mode explicitly.
  assert.equal(CONFIG.mode, undefined);
  assert.throws(() => ladderFor(fact(6, 7), CONFIG), /undefined/);
});

test('ladderFor throws on an unknown mode', () => {
  assert.throws(() => ladderFor(fact(6, 7), CONFIG, 'practice'), /practice/);
  assert.throws(() => ladderFor(fact(6, 7), { ...CONFIG, mode: undefined }), /undefined/);
});

test('ladderFor returns a fresh array each call', () => {
  const first = ladderFor(fact(6, 7), CONFIG, 'drill');
  first.push('blocks');
  assert.deepEqual(ladderFor(fact(6, 7), CONFIG, 'drill'), DRILL_LADDER);
});

test('ladderFor does not mutate the fact or the config', () => {
  const f = fact(6, 7);
  const config = { ...CONFIG, delays: { ...CONFIG.delays } };
  const configBefore = JSON.stringify(config);
  ladderFor(f, config, 'learn');
  assert.deepEqual(f, { op: '*', a: 6, b: 7 });
  assert.equal(JSON.stringify(config), configBefore);
});

// --- blocksApply ----------------------------------------------------------

test('blocksApply is false for every zero-product fact', () => {
  // 21 facts have a zero operand. Their product passes the upper bound but the
  // array renders EMPTY — a blank region rather than a gentler hint.
  const zeroFacts = allFacts().filter((f) => answerOf(f) === 0);
  assert.equal(zeroFacts.length, 21);
  for (const f of zeroFacts) {
    assert.equal(blocksApply(f, CONFIG), false, `${factId(f)} would draw nothing`);
  }
});

test('a product of exactly 1 gets blocks — one block is a real picture', () => {
  assert.equal(blocksApply(fact(1, 1), CONFIG), true);
});

test('blocksApply is false above blocksMaxProduct', () => {
  for (const f of allFacts()) {
    if (answerOf(f) > CONFIG.blocksMaxProduct) {
      assert.equal(blocksApply(f, CONFIG), false, `${factId(f)} product ${answerOf(f)}`);
    }
  }
  assert.equal(blocksApply(fact(6, 7), CONFIG), false);
});

test('blocksApply is true for exactly the drawable products, 1..blocksMaxProduct', () => {
  for (const f of allFacts()) {
    const product = answerOf(f);
    const drawable = product >= 1 && product <= CONFIG.blocksMaxProduct;
    assert.equal(blocksApply(f, CONFIG), drawable, `${factId(f)} product ${product}`);
  }
});

test('blocksApply is inclusive at both bounds', () => {
  const at25 = { ...CONFIG, blocksMaxProduct: 25 };
  assert.equal(blocksApply(fact(5, 5), at25), true, '25 is inside the bound');
  assert.equal(blocksApply(fact(5, 6), at25), false, '30 is outside');
  const at1 = { ...CONFIG, blocksMaxProduct: 1 };
  assert.equal(blocksApply(fact(1, 1), at1), true);
  assert.equal(blocksApply(fact(1, 2), at1), false);
});

test('blocksApply reads the bound from the config passed in', () => {
  const none = { ...CONFIG, blocksMaxProduct: 0 };
  const all = { ...CONFIG, blocksMaxProduct: 100 };
  assert.equal(blocksApply(fact(2, 3), none), false);
  assert.equal(blocksApply(fact(9, 9), none), false);
  assert.equal(blocksApply(fact(9, 9), all), true);
  assert.equal(blocksApply(fact(0, 9), all), false, 'the lower bound still holds');
});

test('blocksApply is symmetric across a transpose', () => {
  for (const f of allFacts()) {
    assert.equal(
      blocksApply(f, CONFIG),
      blocksApply(fact(f.b, f.a), CONFIG),
      `${factId(f)} disagrees with its transpose`,
    );
  }
});

test('blocksApply does not mutate the fact or the config', () => {
  const f = fact(4, 5);
  const config = { ...CONFIG, delays: { ...CONFIG.delays } };
  const configBefore = JSON.stringify(config);
  blocksApply(f, config);
  assert.deepEqual(f, { op: '*', a: 4, b: 5 });
  assert.equal(JSON.stringify(config), configBefore);
});

// --- delayMsFor -----------------------------------------------------------

test('delayMsFor reads the delays table', () => {
  // v2: these are no longer the gap between hint rungs. Drill has exactly one
  // transition, so the value is the whole retrieval window before the answer
  // appears. Raised accordingly when the hint rungs were removed.
  assert.equal(delayMsFor('cold', CONFIG), 4000);
  assert.equal(delayMsFor('warm', CONFIG), 6000);
  assert.equal(delayMsFor('hot', CONFIG), 8000);
});

test('THE DELAY GROWS WITH MASTERY: hot waits longer than cold', () => {
  // This is progressive time delay and it is deliberate. A cold fact is rescued
  // almost immediately so acquisition stays errorless; a hot fact is made to
  // wait because by then the retrieval effort is the entire point.
  //
  // If this assertion ever fails because someone "fixed" the delays table so
  // help arrives faster as mastery grows, the table is wrong, not this test.
  assert.ok(
    delayMsFor('hot', CONFIG) > delayMsFor('cold', CONFIG),
    'hot delay must exceed cold delay — the delay grows with mastery',
  );
});

test('delays increase monotonically cold -> warm -> hot', () => {
  assert.ok(delayMsFor('warm', CONFIG) > delayMsFor('cold', CONFIG));
  assert.ok(delayMsFor('hot', CONFIG) > delayMsFor('warm', CONFIG));
});

test('delayMsFor takes its numbers from the config passed in', () => {
  const retuned = { ...CONFIG, delays: { cold: 1, warm: 2, hot: 3 } };
  assert.equal(delayMsFor('cold', retuned), 1);
  assert.equal(delayMsFor('hot', retuned), 3);
});

test('delayMsFor throws on an unknown bucket', () => {
  assert.throws(() => delayMsFor('lukewarm', CONFIG), /lukewarm/);
});

// --- nextStage ------------------------------------------------------------

test('nextStage returns null at the end of a ladder', () => {
  assert.equal(nextStage(ladderFor(fact(6, 7), CONFIG, 'drill'), 'reveal'), null);
  assert.equal(nextStage(ladderFor(fact(6, 7), CONFIG, 'learn'), 'reveal'), null);
});

test('nextStage returns null at the end of every ladder, in both modes', () => {
  for (const f of allFacts()) {
    for (const mode of ['drill', 'learn', 'ordered']) {
      const ladder = ladderFor(f, CONFIG, mode);
      assert.equal(nextStage(ladder, ladder[ladder.length - 1]), null, `${factId(f)} ${mode}`);
    }
  }
});

test('nextStage walks the single transition of each ladder', () => {
  assert.equal(nextStage(ladderFor(fact(6, 7), CONFIG, 'drill'), 'clean'), 'reveal');
  assert.equal(nextStage(ladderFor(fact(6, 7), CONFIG, 'learn'), 'strategy'), 'reveal');
});

test('walking from the first stage visits every stage of every ladder exactly once', () => {
  for (const f of allFacts()) {
    for (const mode of ['drill', 'learn', 'ordered']) {
      const ladder = ladderFor(f, CONFIG, mode);
      const walked = [ladder[0]];
      let current = nextStage(ladder, ladder[0]);
      while (current !== null) {
        walked.push(current);
        current = nextStage(ladder, current);
      }
      assert.deepEqual(walked, ladder, `${factId(f)} ${mode}`);
    }
  }
});

test('nextStage throws when the stage is not in the ladder', () => {
  const drill = ladderFor(fact(6, 7), CONFIG, 'drill');
  assert.throws(() => nextStage(drill, 'blocks'), /blocks/);
  assert.throws(() => nextStage(drill, 'strategy'), /strategy/);
  assert.throws(() => nextStage(ladderFor(fact(6, 7), CONFIG, 'learn'), 'clean'), /clean/);
});

// --- strategyFor ----------------------------------------------------------

test('trivial facts have no strategy, in both orientations', () => {
  for (let n = 0; n <= 10; n += 1) {
    assert.equal(strategyFor(fact(0, n)), null, `0x${n}`);
    assert.equal(strategyFor(fact(n, 0)), null, `${n}x0`);
    assert.equal(strategyFor(fact(1, n)), null, `1x${n}`);
    assert.equal(strategyFor(fact(n, 1)), null, `${n}x1`);
  }
});

test('x2 facts get a doubling strategy', () => {
  assert.equal(strategyFor(fact(2, 7)), 'double 7: 7 + 7');
  assert.equal(strategyFor(fact(7, 2)), 'double 7: 7 + 7');
});

test('x5 facts get half-of-ten', () => {
  assert.equal(strategyFor(fact(5, 8)), '10 x 8 = 80, take half');
  assert.equal(strategyFor(fact(8, 5)), '10 x 8 = 80, take half');
});

test('x9 facts get ten-minus-one', () => {
  assert.equal(strategyFor(fact(9, 7)), '10 x 7 = 70, take away 7');
  assert.equal(strategyFor(fact(7, 9)), '10 x 7 = 70, take away 7');
});

test('the hard middle facts all have strategy text, both orientations', () => {
  const hard = [
    [6, 7],
    [6, 8],
    [7, 8],
    [7, 9],
    [8, 9],
  ];
  for (const [a, b] of hard) {
    assert.equal(typeof strategyFor(fact(a, b)), 'string', `${a}x${b}`);
    assert.equal(typeof strategyFor(fact(b, a)), 'string', `${b}x${a}`);
    assert.equal(strategyFor(fact(a, b)), strategyFor(fact(b, a)), `${a}x${b} asymmetric`);
  }
});

test('near-square and halve-and-double text for the hard middle', () => {
  assert.equal(strategyFor(fact(6, 7)), '6 x 6 = 36, add one more 6');
  assert.equal(strategyFor(fact(6, 8)), 'half it: 3 x 8 = 24, now double');
  assert.equal(strategyFor(fact(7, 8)), '7 x 7 = 49, add one more 7');
});

test('squares in the hard middle DO have a strategy', () => {
  // v1 left these null on the reasoning that a square is an anchor the other
  // strategies lever off. True of deriving a square from another square, but
  // the consequence was that 6x6, 7x7 and 8x8 had no teaching anywhere in the
  // game: drill shows no hints, and learn mode only offers facts with strategy
  // text. 7 x 7 = 49 is one of the hardest facts in the set and was the one
  // learn mode could never reach. Each now levers off a x5 or x4 fact instead.
  for (const [a, b] of [[6, 6], [7, 7], [8, 8]]) {
    const text = strategyFor(fact(a, b));
    assert.ok(text !== null, `${a}x${b} must be teachable`);
    assert.ok(text.length <= 40, `${a}x${b} strategy too long: ${text}`);
  }
});

test('strategy text is symmetric across every pair', () => {
  for (const f of allFacts()) {
    assert.equal(
      strategyFor(f),
      strategyFor(fact(f.b, f.a)),
      `${factId(f)} disagrees with its transpose`,
    );
  }
});

test('every strategy string is short enough for one line', () => {
  for (const f of allFacts()) {
    const text = strategyFor(f);
    if (text !== null) {
      assert.ok(text.length <= 40, `${factId(f)} is ${text.length} chars: "${text}"`);
      assert.ok(text.trim().length > 0, `${factId(f)} is blank`);
    }
  }
});

test('every non-trivial fact outside the squares has a strategy', () => {
  const squares = new Set(['*:6x6', '*:7x7', '*:8x8']);
  for (const f of allFacts()) {
    if (f.a <= 1 || f.b <= 1 || squares.has(factId(f))) {
      continue;
    }
    assert.notEqual(strategyFor(f), null, `${factId(f)} has no strategy`);
  }
});

test('a fact with neither strategy text nor blocks still gets a learn ladder', () => {
  // 0 x 7: no derivation worth teaching, and an empty array if drawn. The
  // ladder is unchanged; the learn screen simply has nothing to put in either
  // region, which is the renderer's call, not the ladder's.
  assert.equal(strategyFor(fact(0, 7)), null);
  assert.equal(blocksApply(fact(0, 7), CONFIG), false);
  assert.deepEqual(ladderFor(fact(0, 7), CONFIG, 'learn'), LEARN_LADDER);
});

// --- strategy arithmetic (V2-Review-W1, SMALL 6) ---------------------------
//
// The <=40-char rule was tested; the SUMS were not. Mutating 6x6 to
// "5 x 6 = 31, add one more 6", or 8x8 to "4 x 8 = 30, then double it" — which
// teaches a kid that 8 x 8 is 60 — passed the entire suite. Strategy text is
// content, and wrong content in a teaching game is worse than absent content:
// the kid trusts it.

test('every arithmetic claim inside a strategy string is true', () => {
  const patterns = [
    // "5 x 7 = 35, ..." / "10 x 4 = 40, ..."
    { re: /(\d+) x (\d+) = (\d+)/g, check: (m) => Number(m[1]) * Number(m[2]) === Number(m[3]),
      describe: (m) => `${m[1]} x ${m[2]} = ${m[3]}` },
    // "double 7 = 14, ..."
    { re: /double (\d+) = (\d+)/g, check: (m) => Number(m[1]) * 2 === Number(m[2]),
      describe: (m) => `double ${m[1]} = ${m[2]}` },
    // "double 7: 7 + 7"
    { re: /double (\d+): (\d+) \+ (\d+)/g,
      check: (m) => m[1] === m[2] && m[2] === m[3],
      describe: (m) => `double ${m[1]}: ${m[2]} + ${m[3]}` },
    // "double 7 twice: 14, 28"
    { re: /double (\d+) twice: (\d+), (\d+)/g,
      check: (m) => Number(m[1]) * 2 === Number(m[2]) && Number(m[1]) * 4 === Number(m[3]),
      describe: (m) => `double ${m[1]} twice: ${m[2]}, ${m[3]}` },
  ];

  let claimsChecked = 0;
  for (const f of allFacts()) {
    const text = strategyFor(f);
    if (text === null) continue;
    for (const { re, check, describe } of patterns) {
      for (const m of text.matchAll(re)) {
        claimsChecked += 1;
        assert.ok(check(m), `${factId(f)} strategy is arithmetically wrong: "${text}" claims ${describe(m)}`);
      }
    }
  }
  // Guard the guard: if the patterns stop matching anything, this test would
  // pass vacuously while checking nothing.
  // Guards the guard against passing vacuously. Not every rule states an
  // equation — "7 then a 0 on the end" has nothing to check — so this is well
  // below the total number of strategies.
  assert.ok(claimsChecked >= 60, `only ${claimsChecked} claims parsed — patterns may have drifted`);
});

test('a strategy never states the answer it is teaching', () => {
  // "6 x 7 = 42, ..." would hand over the very thing the kid is meant to derive,
  // turning the strategy rung into a second reveal.
  for (const f of allFacts()) {
    const text = strategyFor(f);
    if (text === null) continue;
    for (const m of text.matchAll(/(\d+) x (\d+) = (\d+)/g)) {
      const statesThisFact =
        (Number(m[1]) === f.a && Number(m[2]) === f.b) ||
        (Number(m[1]) === f.b && Number(m[2]) === f.a);
      assert.ok(!statesThisFact, `${factId(f)} strategy gives away its own answer: "${text}"`);
    }
  }
});
