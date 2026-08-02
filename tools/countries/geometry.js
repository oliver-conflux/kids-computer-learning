// Lat/lon into committed SVG path strings.
//
// The projection happens HERE, once, at build time. The browser receives
// coordinates that are already screen coordinates, which is why the game ships
// no projection library and has no runtime geometry to get wrong.
//
// EQUIRECTANGULAR, NOT MERCATOR. Mercator is what a slippy map uses and it
// inflates everything far from the equator -- Greenland the size of Africa. For
// a game whose whole subject is the size and position of countries that is not a
// cosmetic complaint, it is teaching the wrong thing. Equirectangular stretches
// east-west near the poles too, but it does it without lying about area rank.
//
// Pure module: no DOM, no network, no clock, no randomness.

/** The canvas every path is projected onto. 2:1 is equirectangular's natural ratio. */
export const WORLD = { width: 2000, height: 1000 };

/** Committed coordinates are rounded to this many decimals — see roundTo. */
const DECIMALS = 1;

export function project(lon, lat) {
  return [
    ((lon + 180) / 360) * WORLD.width,
    ((90 - lat) / 180) * WORLD.height,
  ];
}

function roundTo(value) {
  return Number(value.toFixed(DECIMALS));
}

/** Perpendicular distance from `point` to the segment `start`–`end`. */
function perpendicularDistance(point, start, end) {
  const [px, py] = point;
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - sx, py - sy);
  }

  const numerator = Math.abs(dy * px - dx * py + ex * sy - ey * sx);
  return numerator / Math.hypot(dx, dy);
}

/**
 * Douglas–Peucker. Reduces committed file size, NOT visual resolution: 110m
 * Natural Earth is already coarse, and this is about how many points describe
 * that coarse outline.
 *
 * Never returns fewer than two points, so a ring can always still be drawn.
 */
export function simplify(points, tolerance) {
  if (points.length <= 2) {
    return points;
  }

  let worstIndex = 0;
  let worstDistance = 0;

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points.at(-1));
    if (distance > worstDistance) {
      worstIndex = i;
      worstDistance = distance;
    }
  }

  if (worstDistance <= tolerance) {
    return [points[0], points.at(-1)];
  }

  const left = simplify(points.slice(0, worstIndex + 1), tolerance);
  const right = simplify(points.slice(worstIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Every ring of a Polygon or MultiPolygon, as arrays of lon/lat pairs. */
function ringsOf(geometry) {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates;
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat();
  }
  throw new Error(`unsupported geometry type: ${geometry.type}`);
}

export function pathFor(geometry, tolerance) {
  const subpaths = [];

  for (const ring of ringsOf(geometry)) {
    const projected = ring.map(([lon, lat]) => project(lon, lat));
    const reduced = simplify(projected, tolerance);
    const points = reduced.map(([x, y]) => `${roundTo(x)},${roundTo(y)}`);
    subpaths.push(`M${points[0]}L${points.slice(1).join('L')}Z`);
  }

  return subpaths.join('');
}

/** The smallest and largest of `values`, as [min, max]. */
function extremes(values) {
  let min = Infinity;
  let max = -Infinity;

  for (const value of values) {
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  return [min, max];
}

function span([min, max]) {
  return max - min;
}

/**
 * The country's bounds, which is what viewBoxFor centres the map prompt on.
 *
 * THE ANTIMERIDIAN IS WHY THIS IS NOT A PLAIN MIN/MAX. Russia and Fiji have
 * rings near +179 AND rings near -179, so taking the extremes of the longitudes
 * as given reports both as 2000 units wide -- the entire world -- and the prompt
 * then centres on longitude 0. Russia's map showed the North Sea and Fiji's
 * showed empty Atlantic, which are not hard questions, they are unanswerable
 * ones.
 *
 * So longitude is measured twice: once as given, and once with everything west
 * of the seam shifted a full turn east, which is where a seam-crossing landmass
 * becomes contiguous. The tighter of the two is the country. That comparison
 * also decides the ordinary case correctly on its own -- a country on the prime
 * meridian has negative longitudes too, and for it the shifted reading is the
 * one that wraps the world.
 *
 * Only the box is measured this way. `pathFor` is right as it stands: each ring
 * is a separate subpath, so nothing smears across the map.
 *
 * @returns {[number, number, number, number]} x, y, width, height in projected units
 */
export function boxFor(geometry) {
  const points = ringsOf(geometry).flat();

  const asGiven = extremes(points.map(([lon]) => lon));
  const shifted = extremes(points.map(([lon]) => (lon < 0 ? lon + 360 : lon)));
  const [minLon, maxLon] = span(shifted) < span(asGiven) ? shifted : asGiven;
  const [minLat, maxLat] = extremes(points.map(([, lat]) => lat));

  const [left] = project(minLon, 0);
  const [right] = project(maxLon, 0);
  const [, top] = project(0, maxLat);
  const [, bottom] = project(0, minLat);

  const width = right - left;

  // A shifted box can sit off the east edge of the canvas entirely. Its centre
  // wrapped back is the same place on the globe, written on the near side of
  // the seam, which is where the country's own path was drawn.
  const x = left + width / 2 > WORLD.width ? left - WORLD.width : left;

  return [roundTo(x), roundTo(top), roundTo(width), roundTo(bottom - top)];
}
