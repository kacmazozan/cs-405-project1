/**
 * calibrate — recovering the painter's camera from the painting (bonus:
 * "match your camera to the painting's own perspective").
 *
 * The painting hangs as a quad spanning x ∈ [−a, a], y ∈ [−1, 1] at z = 0, so
 * the painting's own plane IS an image plane of half-height 1 whose principal
 * point is the origin. A camera at (0, 0, f) looking down −z with
 *
 *       fovY = 2·atan(1 / f)
 *
 * reproduces that image exactly: the quad fills the frame vertically, and the
 * ray through a painted point is the ray the painter's camera had through it.
 * So matching the camera comes down to finding ONE number, the focal length f,
 * in units of image half-heights.
 *
 * Lines that are parallel in the scene meet, in the image, at a vanishing
 * point. A vanishing point v = (vx, vy) is the image of the scene direction
 *
 *       d = normalize(vx, vy, −f)
 *
 * — the ray from the eye (0, 0, f) through (vx, vy, 0). If two scene
 * directions are PERPENDICULAR then d₁·d₂ = 0, which is
 *
 *       vx₁·vx₂ + vy₁·vy₂ + f² = 0      →      f² = −(v₁ · v₂).
 *
 * The dot product must therefore be negative: the two vanishing points have to
 * straddle the principal point. When they do not, the marked lines do not
 * determine a focal length and this module says so rather than inventing one.
 * (That is the honest answer for a painting composed almost frontally.)
 *
 * Everything here is pure geometry on plain arrays. Tests: tests/calibrate.test.js
 */

/** Cross product of two homogeneous 3-vectors. */
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The homogeneous line through two image points p, q. */
export function lineThrough(p, q) {
  return cross3([p[0], p[1], 1], [q[0], q[1], 1]);
}

/** Where two homogeneous lines meet (w = 0 ⇒ the lines are parallel). */
export function meet(l, m) {
  return cross3(l, m);
}

/** A homogeneous point as [x, y], or null when it lies at infinity. */
export function toAffine(h, eps = 1e-12) {
  return Math.abs(h[2]) < eps ? null : [h[0] / h[2], h[1] / h[2]];
}

/**
 * The vanishing point of two image segments that are parallel in the scene.
 * @param {number[][]} segA  [[x, y], [x, y]]
 * @param {number[][]} segB  [[x, y], [x, y]]
 * @returns {{ point: number[]|null, atInfinity: boolean, homogeneous: number[] }}
 *   `point` is null when the two segments are parallel ON the canvas as well —
 *   a legitimate answer (the scene direction is parallel to the image plane),
 *   but one that carries no information about f.
 */
export function vanishingPoint(segA, segB) {
  const h = meet(lineThrough(...segA), lineThrough(...segB));
  const point = toAffine(h, 1e-9 * Math.max(1, Math.hypot(h[0], h[1])));
  return { point, atInfinity: point === null, homogeneous: h };
}

/**
 * f² = −(v₁ · v₂) for two vanishing points of PERPENDICULAR scene directions.
 * @returns {{ ok: boolean, f: number, f2: number, dot: number, reason: string }}
 */
export function focalFromVPs(v1, v2) {
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const f2 = -dot;
  if (!(f2 > 1e-9)) {
    return {
      ok: false, f: NaN, f2, dot,
      reason: 'f² = −(v₁·v₂) is not positive: the two vanishing points do not straddle '
        + 'the principal point, so no focal length fits two perpendicular directions here',
    };
  }
  return { ok: true, f: Math.sqrt(f2), f2, dot, reason: '' };
}

/** The scene direction a vanishing point stands for, given f. */
export function directionOfVP(v, f) {
  const d = [v[0], v[1], -f];
  const len = Math.hypot(...d);
  return len > 0 ? d.map((x) => x / len) : [0, 0, -1];
}

/**
 * The full camera implied by two vanishing points of perpendicular directions.
 *
 * @returns {{
 *   ok: boolean, reason: string,
 *   f: number, fovY: number, eye: number[],
 *   axes: number[][],        // the three orthonormal scene axes, in world space
 *   orthoResidual: number,   // |d₁·d₂| after the fit — zero by construction, kept as a check
 * }}
 */
export function cameraFromVPs(v1, v2) {
  const fit = focalFromVPs(v1, v2);
  if (!fit.ok) return { ok: false, reason: fit.reason, f: NaN, fovY: NaN, eye: null, axes: null, orthoResidual: NaN };

  const f = fit.f;
  const d1 = directionOfVP(v1, f);
  const d2 = directionOfVP(v2, f);
  const d3 = cross3(d1, d2); // already unit: d1 ⟂ d2 and both unit

  // The camera that re-creates the painting: at (0, 0, f) on the painting's
  // normal, looking at the centre, with the quad exactly filling the height.
  return {
    ok: true,
    reason: '',
    f,
    fovY: 2 * Math.atan(1 / f),
    eye: [0, 0, f],
    axes: [d1, d2, d3],
    orthoResidual: Math.abs(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]),
  };
}

/** The horizon of the plane spanned by the two directions: the line through their VPs. */
export function horizonThrough(v1, v2) {
  return lineThrough(v1, v2);
}

/** Tilt of the horizon through two vanishing points, in degrees, in (−90, 90]. */
export function horizonTilt(v1, v2) {
  const deg = (Math.atan2(v2[1] - v1[1], v2[0] - v1[0]) * 180) / Math.PI;
  return ((((deg + 90) % 180) + 180) % 180) - 90;
}

/**
 * Sanity checks on a fit. Once v₁·v₂ < 0 the algebra always returns a number,
 * but a number is not the same as a measurement: lines that are nearly
 * parallel on the canvas put their vanishing point almost at infinity, where
 * f swings wildly for one pixel of error, and a canvas painted level cannot
 * have a steeply tilted horizon. Every entry here means "go back and check
 * the marks", not "the arithmetic is wrong".
 *
 * @returns {string[]} empty when nothing looks suspicious
 */
export function fitWarnings(cam, v1, v2, { farVP = 20, maxTiltDeg = 3 } = {}) {
  const out = [];
  if (!cam?.ok) return out;
  for (const [name, v] of [['A', v1], ['B', v2]]) {
    const d = Math.hypot(v[0], v[1]);
    if (d > farVP) {
      out.push(`group ${name}'s lines are nearly parallel on the canvas (its VP is ${d.toFixed(0)} `
        + 'half-heights out), so f is very sensitive to where you put them');
    }
  }
  const tilt = horizonTilt(v1, v2);
  if (Math.abs(tilt) > maxTiltDeg) {
    out.push(`the horizon comes out tilted ${tilt.toFixed(1)}°; a canvas painted level should give about 0°, `
      + 'so at least one pair is probably not parallel in the scene');
  }
  const fovDeg = (cam.fovY * 180) / Math.PI;
  if (fovDeg < 15 || fovDeg > 100) {
    out.push(`fovY ${fovDeg.toFixed(1)}° is outside the range a painter's viewpoint plausibly spans`);
  }
  return out;
}

/**
 * Clip the homogeneous line A·x + B·y + C = 0 to the box [−w, w] × [−h, h],
 * so an extension towards a vanishing point far outside the canvas can still
 * be drawn. Returns [[x, y], [x, y]] or null when the line misses the box.
 */
export function clipLineToBox(line, w, h) {
  const [A, B, C] = line;
  const hits = [];
  const inside = (x, y) => Math.abs(x) <= w + 1e-6 && Math.abs(y) <= h + 1e-6;
  if (Math.abs(B) > 1e-12) {
    for (const x of [-w, w]) {
      const y = -(A * x + C) / B;
      if (inside(x, y)) hits.push([x, y]);
    }
  }
  if (Math.abs(A) > 1e-12) {
    for (const y of [-h, h]) {
      const x = -(B * y + C) / A;
      if (inside(x, y)) hits.push([x, y]);
    }
  }
  if (hits.length < 2) return null;
  // the two that are farthest apart (corner hits can be reported twice)
  let best = null, bestD = -1;
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const d = Math.hypot(hits[i][0] - hits[j][0], hits[i][1] - hits[j][1]);
      if (d > bestD) { bestD = d; best = [hits[i], hits[j]]; }
    }
  }
  return bestD > 1e-9 ? best : null;
}

/**
 * Project a scene direction back to its vanishing point, for tests and for
 * drawing: the inverse of directionOfVP.
 */
export function vpOfDirection(d, f) {
  if (Math.abs(d[2]) < 1e-12) return null; // parallel to the image plane: VP at infinity
  const s = -f / d[2];
  return [s * d[0], s * d[1]];
}
