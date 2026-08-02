import { test } from 'node:test';
import assert from 'node:assert/strict';

import { project, simplify, pathFor, boxFor, WORLD } from '../geometry.js';

test('project maps the world corners onto the canvas', () => {
  assert.deepEqual(project(-180, 90), [0, 0]);
  assert.deepEqual(project(180, -90), [WORLD.width, WORLD.height]);
  assert.deepEqual(project(0, 0), [WORLD.width / 2, WORLD.height / 2]);
});

test('project is monotonic — east is right, north is up', () => {
  assert.ok(project(10, 0)[0] > project(-10, 0)[0]);
  assert.ok(project(0, 10)[1] < project(0, -10)[1]);
});

test('simplify keeps both endpoints', () => {
  const points = [[0, 0], [1, 0.01], [2, 0], [3, 0.01], [4, 0]];
  const out = simplify(points, 0.5);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out.at(-1), [4, 0]);
});

test('simplify drops points inside the tolerance and keeps points outside it', () => {
  const nearlyStraight = [[0, 0], [1, 0.01], [2, 0]];
  assert.equal(simplify(nearlyStraight, 0.5).length, 2);

  const realCorner = [[0, 0], [1, 5], [2, 0]];
  assert.equal(simplify(realCorner, 0.5).length, 3);
});

test('simplify never returns fewer than two points', () => {
  assert.equal(simplify([[0, 0], [1, 0]], 1000).length, 2);
});

test('pathFor emits one closed subpath per ring', () => {
  const square = {
    type: 'Polygon',
    coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
  };
  const d = pathFor(square, 0);
  assert.match(d, /^M/, 'starts with a moveto');
  assert.equal((d.match(/Z/g) ?? []).length, 1, 'one closepath per ring');
});

test('pathFor handles MultiPolygon as several subpaths', () => {
  const two = {
    type: 'MultiPolygon',
    coordinates: [
      [[[0, 0], [10, 0], [10, 10], [0, 0]]],
      [[[20, 20], [30, 20], [30, 30], [20, 20]]],
    ],
  };
  assert.equal((pathFor(two, 0).match(/Z/g) ?? []).length, 2);
});

// boxFor rounds to the committed coordinate precision, so it cannot agree with
// raw project() output any closer than half a rounding step. Comparing to the
// unrounded projection is still the right check — it is what catches an axis
// swapped or a corner taken from the wrong ring — but the tolerance has to be
// the rounding, not an arbitrary epsilon.
const ROUNDING = 0.06;

test('boxFor bounds the projected geometry, in projected units', () => {
  const square = {
    type: 'Polygon',
    coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
  };
  const [x, y, w, h] = boxFor(square);
  const [x0, y0] = project(0, 10);
  const [x1, y1] = project(10, 0);
  assert.ok(Math.abs(x - x0) < ROUNDING);
  assert.ok(Math.abs(y - y0) < ROUNDING);
  assert.ok(Math.abs(w - (x1 - x0)) < ROUNDING);
  assert.ok(Math.abs(h - (y1 - y0)) < ROUNDING);
});
