import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ladderFor, delayMsFor, nextStage } from '../js/hints.js';
import { strategyFor } from '../js/strategies.js';
import { allFacts, factId, answerOf } from '../js/facts.js';
import { CONFIG } from '../js/config.js';

const LADDER_ORDER = ['clean', 'strategy', 'blocks', 'reveal'];

function fact(a, b) {
  return { op: '*', a, b };
}

// --- ladderFor ------------------------------------------------------------

test('ladderFor 6x7 is exactly clean, strategy, reveal', () => {
  assert.deepEqual(ladderFor(fact(6, 7), CONFIG), ['clean', 'strategy', 'reveal']);
});

test('ladderFor 2x3 includes blocks', () => {
  assert.ok(ladderFor(fact(2, 3), CONFIG).includes('blocks'));
});

test('blocks never appears when the product exceeds blocksMaxProduct', () => {
  for (const f of allFacts()) {
    if (answerOf(f) > CONFIG.blocksMaxProduct) {
      assert.ok(
        !ladderFor(f, CONFIG).includes('blocks'),
        `${factId(f)} (product ${answerOf(f)}) should not offer blocks`,
      );
    }
  }
});

test('blocks appears for every drawable product within blocksMaxProduct', () => {
  // "Drawable" excludes 0: the bound is 1..blocksMaxProduct, not 0... A zero
  // product renders an empty array, which is a blank hint region rather than a
  // gentler hint. See the zero-operand test below.
  for (const f of allFacts()) {
    const product = answerOf(f);
    if (product >= 1 && product <= CONFIG.blocksMaxProduct) {
      assert.ok(
        ladderFor(f, CONFIG).includes('blocks'),
        `${factId(f)} (product ${product}) should offer blocks`,
      );
    }
  }
});

test('clean is always first and reveal always last, across all 121 facts', () => {
  const facts = allFacts();
  assert.equal(facts.length, 121);
  for (const f of facts) {
    const ladder = ladderFor(f, CONFIG);
    assert.equal(ladder[0], 'clean', `${factId(f)} must start clean`);
    assert.equal(ladder[ladder.length - 1], 'reveal', `${factId(f)} must end reveal`);
    assert.ok(ladder.length >= 2, `${factId(f)} must have at least clean and reveal`);
  }
});

test('every ladder is an ordered subsequence of the canonical stage order', () => {
  for (const f of allFacts()) {
    const ladder = ladderFor(f, CONFIG);
    const positions = ladder.map((stage) => LADDER_ORDER.indexOf(stage));
    assert.ok(
      positions.every((p) => p !== -1),
      `${factId(f)} contains an unknown stage: ${ladder.join(',')}`,
    );
    const ascending = positions.every((p, i) => i === 0 || p > positions[i - 1]);
    assert.ok(ascending, `${factId(f)} stages out of order: ${ladder.join(',')}`);
    assert.equal(new Set(ladder).size, ladder.length, `${factId(f)} repeats a stage`);
  }
});

test('the strategy stage is present exactly when a strategy exists', () => {
  for (const f of allFacts()) {
    const hasStage = ladderFor(f, CONFIG).includes('strategy');
    const hasText = strategyFor(f) !== null;
    assert.equal(hasStage, hasText, `${factId(f)} stage/text mismatch`);
  }
});

test('ladder membership follows config, not hard-coded numbers', () => {
  const noBlocks = { ...CONFIG, blocksMaxProduct: 0 };
  const allBlocks = { ...CONFIG, blocksMaxProduct: 100 };

  assert.ok(!ladderFor(fact(2, 3), noBlocks).includes('blocks'));
  assert.ok(ladderFor(fact(9, 9), allBlocks).includes('blocks'));
  assert.deepEqual(ladderFor(fact(6, 7), allBlocks), [
    'clean',
    'strategy',
    'blocks',
    'reveal',
  ]);
});

test('a fact with neither strategy nor blocks is just clean then reveal', () => {
  // 7 x 7 = 49: a square, so no shorter derivation, and far too many blocks.
  assert.deepEqual(ladderFor(fact(7, 7), CONFIG), ['clean', 'reveal']);
});

test('ladderFor does not mutate the fact or the config', () => {
  const f = fact(6, 7);
  const config = { ...CONFIG, delays: { ...CONFIG.delays } };
  const configBefore = JSON.stringify(config);
  ladderFor(f, config);
  assert.deepEqual(f, { op: '*', a: 6, b: 7 });
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
  const ladder = ladderFor(fact(6, 7), CONFIG);
  assert.equal(nextStage(ladder, 'reveal'), null);
});

test('nextStage returns null at the end of every ladder', () => {
  for (const f of allFacts()) {
    const ladder = ladderFor(f, CONFIG);
    assert.equal(nextStage(ladder, ladder[ladder.length - 1]), null, factId(f));
  }
});

test('nextStage walks a ladder rung by rung, skipping omitted stages', () => {
  const ladder = ladderFor(fact(6, 7), CONFIG);
  assert.equal(nextStage(ladder, 'clean'), 'strategy');
  assert.equal(nextStage(ladder, 'strategy'), 'reveal');
  assert.equal(nextStage(ladder, 'reveal'), null);
});

test('walking from clean visits every stage of every ladder exactly once', () => {
  for (const f of allFacts()) {
    const ladder = ladderFor(f, CONFIG);
    const walked = ['clean'];
    let current = nextStage(ladder, 'clean');
    while (current !== null) {
      walked.push(current);
      current = nextStage(ladder, current);
    }
    assert.deepEqual(walked, ladder, factId(f));
  }
});

test('nextStage throws when the stage is not in the ladder', () => {
  const ladder = ladderFor(fact(6, 7), CONFIG);
  assert.throws(() => nextStage(ladder, 'blocks'), /blocks/);
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

test('squares in the hard middle have no strategy', () => {
  assert.equal(strategyFor(fact(6, 6)), null);
  assert.equal(strategyFor(fact(7, 7)), null);
  assert.equal(strategyFor(fact(8, 8)), null);
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

test('a zero-product fact gets no blocks rung — it would draw nothing', () => {
  // 21 facts have a zero operand. Their product is 0, which passes the upper
  // bound, but the array renders empty: a kid stuck on 0 x 7 would stare at a
  // blank hint region for the full delay. None of them gets a strategy either,
  // so without the lower bound their ladder is clean -> nothing -> reveal.
  for (const b of [0, 1, 5, 7, 10]) {
    assert.deepEqual(ladderFor({ op: '*', a: 0, b }, CONFIG), ['clean', 'reveal']);
    assert.deepEqual(ladderFor({ op: '*', a: b, b: 0 }, CONFIG), ['clean', 'reveal']);
  }
});

test('a product of exactly 1 still gets blocks — one block is a real picture', () => {
  assert.ok(ladderFor({ op: '*', a: 1, b: 1 }, CONFIG).includes('blocks'));
});

test('no ladder ever contains a rung that would render nothing', () => {
  for (const fact of allFacts()) {
    if (ladderFor(fact, CONFIG).includes('blocks')) {
      assert.ok(answerOf(fact) >= 1, `${fact.a}x${fact.b} offers an empty block array`);
    }
  }
});
