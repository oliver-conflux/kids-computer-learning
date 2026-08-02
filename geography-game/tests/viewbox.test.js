import { test } from 'node:test';
import assert from 'node:assert/strict';

import { viewBoxFor } from '../js/viewbox.js';
import { CONFIG } from '../js/config.js';
import { COUNTRIES } from '../js/countries.js';
// The projection's own canvas, read rather than restated: countries.js is
// generated against it and a second copy of 2000 here could drift from it.
import { WORLD } from '../../tools/countries/geometry.js';

const boxOf = (code) => COUNTRIES.find((c) => c.code === code).box;

test('the country stays centred in the view', () => {
  const box = [100, 100, 20, 10];
  const view = viewBoxFor(box, CONFIG);
  assert.ok(Math.abs((view.x + view.width / 2) - 110) < 0.001);
  assert.ok(Math.abs((view.y + view.height / 2) - 105) < 0.001);
});

test('a tiny country gets the minimum context, not a full-screen dot', () => {
  const view = viewBoxFor([100, 100, 0.5, 0.5], CONFIG);
  assert.equal(view.width, CONFIG.minContextSpan);
});

test('a vast country is capped rather than showing the whole world', () => {
  const view = viewBoxFor([0, 0, 1800, 900], CONFIG);
  assert.equal(view.width, CONFIG.maxContextSpan);
});

test('the view is square, so the map does not distort between countries', () => {
  for (const code of ['bz', 'ru', 'cl', 'nl']) {
    const view = viewBoxFor(boxOf(code), CONFIG);
    assert.equal(view.width, view.height, code);
  }
});

test('the view always contains the country it is showing', () => {
  for (const country of COUNTRIES) {
    const [x, y, w, h] = country.box;
    const view = viewBoxFor(country.box, CONFIG);

    // A capped giant cannot be contained and stay legible, but it must still be
    // centred on itself. That is the weaker claim, not no claim: a view that has
    // wandered off its own country is the failure this is here to catch.
    if (view.width === CONFIG.maxContextSpan) {
      const centreX = view.x + view.width / 2;
      const centreY = view.y + view.height / 2;
      assert.ok(centreX >= x && centreX <= x + w, `${country.name} is off the view's centre`);
      assert.ok(centreY >= y && centreY <= y + h, `${country.name} is off the view's centre`);
      continue;
    }

    assert.ok(view.x <= x && view.y <= y, country.name);
    assert.ok(view.x + view.width >= x + w, country.name);
    assert.ok(view.y + view.height >= y + h, country.name);
  }
});

// The centring check above cannot catch a box that is wrong in the one way boxes
// go wrong. A country whose geometry crosses the antimeridian used to measure
// 2000 units wide -- the whole canvas -- and a view centred on the middle of
// THAT is centred on longitude 0 while still passing every containment and
// centring assertion, because the bogus box contains the whole world. So the
// data is checked directly: no country spans half the globe in longitude.
// Russia is the real ceiling at about 171 degrees, and it is under this line.
test('no country is measured as spanning half the world', () => {
  for (const country of COUNTRIES) {
    assert.ok(
      country.box[2] < WORLD.width / 2,
      `${country.name} is ${country.box[2]} units wide, which is a mis-measured box, not a country`,
    );
  }
});

test('Belize gets regional context rather than filling the frame', () => {
  const box = boxOf('bz');
  const view = viewBoxFor(box, CONFIG);
  assert.ok(view.width > Math.max(box[2], box[3]) * 2, 'should show neighbours');
});
