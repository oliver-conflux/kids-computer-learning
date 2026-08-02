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

/** @returns {[number, number, number, number]} x, y, width, height in projected units */
export function boxFor(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ring of ringsOf(geometry)) {
    for (const [lon, lat] of ring) {
      const [x, y] = project(lon, lat);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return [roundTo(minX), roundTo(minY), roundTo(maxX - minX), roundTo(maxY - minY)];
}
