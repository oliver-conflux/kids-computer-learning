import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPINE, OPENER } from '../js/spine.js';
import { COUNTRIES } from '../js/countries.js';

test('the spine opens on the water the family sails', () => {
  const firstCodes = SPINE.slice(0, OPENER.length * 2).map((e) => e.code);
  for (const code of OPENER) {
    assert.ok(firstCodes.includes(code), `${code} should be in the opener`);
  }
});

test('every country contributes exactly one shape item and one flag item', () => {
  assert.equal(SPINE.length, COUNTRIES.length * 2);
  const shapes = SPINE.filter((e) => e.kind === 'shape');
  const flags = SPINE.filter((e) => e.kind === 'flag');
  assert.equal(shapes.length, COUNTRIES.length);
  assert.equal(flags.length, COUNTRIES.length);
});

test('the opener names only countries that exist', () => {
  const codes = new Set(COUNTRIES.map((c) => c.code));
  for (const code of OPENER) {
    assert.ok(codes.has(code), `opener names ${code}, which is not in COUNTRIES`);
  }
});

test('the tail is ordered by descending familiarity', () => {
  const tail = SPINE.filter((e) => !OPENER.includes(e.code) && e.kind === 'shape');
  for (let i = 1; i < tail.length; i += 1) {
    assert.ok(tail[i - 1].rank <= tail[i].rank, `${tail[i - 1].name} should not follow ${tail[i].name}`);
  }
});

test('every entry carries the geometry the map prompt needs', () => {
  for (const entry of SPINE) {
    assert.ok(entry.path.startsWith('M'), `${entry.name} has no path`);
    assert.equal(entry.box.length, 4);
  }
});
