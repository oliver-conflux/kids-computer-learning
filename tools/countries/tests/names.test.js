import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalize, curate } from '../names.js';

const FEATURES = JSON.parse(
  readFileSync(new URL('../../../geography-game/data/ne_110m_admin_0_countries.geojson', import.meta.url), 'utf8'),
).features;

test('normalize strips everything that is not a lowercase letter', () => {
  assert.equal(normalize('Costa Rica'), 'costarica');
  assert.equal(normalize('Guinea-Bissau'), 'guineabissau');
  assert.equal(normalize("People's Republic of China"), 'peoplesrepublicofchina');
});

test('curate drops non-countries and unrecognised states', () => {
  const names = new Set(curate(FEATURES).map((c) => c.name));
  for (const gone of ['Antarctica', 'French Southern and Antarctic Lands',
                      'Turkish Republic of Northern Cyprus', 'Somaliland', 'Western Sahara']) {
    assert.ok(!names.has(gone), `${gone} should not be in the spine pool`);
  }
});

test('curate shortens the names that are cruel to type', () => {
  const byCode = new Map(curate(FEATURES).map((c) => [c.code, c.name]));
  assert.equal(byCode.get('cn'), 'China');
  assert.equal(byCode.get('us'), 'United States');
  assert.equal(byCode.get('cd'), 'DR Congo');
  assert.equal(byCode.get('cg'), 'Congo');
});

test('every country resolves to a lowercase alpha-2 code', () => {
  for (const c of curate(FEATURES)) {
    assert.match(c.code, /^[a-z]{2}$/, `${c.name} has code ${c.code}`);
  }
});

test('Taiwan is aliased off Natural Earth cn-tw onto the flag set tw', () => {
  const codes = new Set(curate(FEATURES).map((c) => c.code));
  assert.ok(codes.has('tw'));
  assert.ok(!codes.has('cn-tw'));
});

test('no two countries collide on their typed target', () => {
  const seen = new Map();
  for (const c of curate(FEATURES)) {
    assert.ok(!seen.has(c.target), `${c.name} and ${seen.get(c.target)} both type as "${c.target}"`);
    seen.set(c.target, c.name);
  }
});

test('the pool is 172 countries', () => {
  assert.equal(curate(FEATURES).length, 172);
});
