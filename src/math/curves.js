/**
 * curves — Part D.
 *
 * Points are plain arrays of any dimension: [x, y] in the plane of the
 * painting, or [x, y, z] in world space. Every function must work for both
 * (the tests use 2D and 3D). Return new arrays; never modify the inputs.
 *
 * A piecewise cubic Bézier curve is an array of segments, each segment being
 * four control points [P0, P1, P2, P3]. Consecutive segments share a joint:
 * segments[i][3] equals segments[i + 1][0].
 *
 * Tests: tests/curves.test.js
 */

/* ------------------------------------------------------------ helpers --- */

/** Σ wᵢ·pᵢ for points of any dimension. */
export function combine(points, weights) {
  const out = new Array(points[0].length).fill(0);
  for (let i = 0; i < points.length; i++) {
    for (let d = 0; d < out.length; d++) out[d] += weights[i] * points[i][d];
  }
  return out;
}

/** a + (b − a)·t, any dimension. */
export function lerp(a, b, t) { return a.map((x, d) => x + (b[d] - x) * t); }

/* ---------------------------------------------------------- Bézier ------ */

/**
 * The four cubic Bernstein basis values [B0(t), B1(t), B2(t), B3(t)].
 * Bᵢ(t) = C(3, i)·tⁱ·(1 − t)³⁻ⁱ — the terms of ((1 − t) + t)³ = 1, so they
 * always sum to one (partition of unity) and are ≥ 0 on [0, 1].
 */
export function bernstein3(t) {
  const s = 1 - t;
  return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
}

/** Point on the cubic Bézier curve with control points p0..p3 at t ∈ [0, 1]. */
export function cubicBezier(p0, p1, p2, p3, t) {
  return combine([p0, p1, p2, p3], bernstein3(t));
}

/**
 * First derivative dB/dt of the cubic Bézier at t (not normalised).
 * The derivative of a cubic Bézier is a quadratic Bézier on the differences:
 *   B'(t) = 3[(1 − t)²(P1 − P0) + 2(1 − t)t(P2 − P1) + t²(P3 − P2)]
 */
export function cubicBezierTangent(p0, p1, p2, p3, t) {
  const s = 1 - t;
  const w = [-3 * s * s, 3 * s * s - 6 * s * t, 6 * s * t - 3 * t * t, 3 * t * t];
  return combine([p0, p1, p2, p3], w);
}

/**
 * de Casteljau's construction for any number of control points.
 * Returns every level, for drawing the construction:
 *   levels[0] = the input points (n points)
 *   levels[1] = n − 1 interpolated points
 *   …
 *   levels[n − 1] = [the point on the curve]
 */
export function deCasteljau(points, t) {
  const levels = [points.map((p) => [...p])];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < prev.length - 1; i++) next.push(lerp(prev[i], prev[i + 1], t));
    levels.push(next);
  }
  return levels;
}

/* ----------------------------------------------- piecewise, C¹ joints --- */

/**
 * Given the last two control points P2, P3 of one segment, return the P1 of
 * the NEXT segment that makes the joint at P3 C¹-continuous.
 *
 * The tangent leaving the joint is 3(P1' − P3) and the one arriving is
 * 3(P3 − P2); equal tangents ⇔ P1' = P3 + (P3 − P2) = 2·P3 − P2, i.e. P2
 * mirrored through the joint.
 */
export function c1NextControl(p2, p3) { return p3.map((x, d) => 2 * x - p2[d]); }

/**
 * Evaluate a piecewise cubic Bézier at a global parameter u ∈ [0, 1] that
 * runs over the whole curve: with n segments, segment i covers
 * u ∈ [i/n, (i+1)/n]. u = 0 is the first P0, u = 1 the last P3.
 */
export function evalPiecewise(segments, u) {
  const { index, t } = splitParameter(segments.length, u);
  return cubicBezier(...segments[index], t);
}

/** Global u ∈ [0, 1] over n equal pieces → { index, local t ∈ [0, 1] }. */
export function splitParameter(n, u) {
  const s = Math.min(Math.max(u, 0), 1) * n;
  const index = Math.min(Math.floor(s), n - 1);
  return { index, t: s - index };
}

/* ---------------------------- second curve family: implement ONE -------- */
/* Both are implemented here; the editor lets you switch between them.      */

/**
 * Uniform Catmull–Rom: the segment between p1 and p2 (passes through both),
 * t ∈ [0, 1], with tangents (p2 − p0)/2 at p1 and (p3 − p1)/2 at p2.
 *
 * It is a cubic Hermite segment, written in the power basis:
 *   C(t) = ½[2p1 + (−p0 + p2)t + (2p0 − 5p1 + 4p2 − p3)t² + (−p0 + 3p1 − 3p2 + p3)t³]
 */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const w = [
    0.5 * (-t + 2 * t2 - t3),
    0.5 * (2 - 5 * t2 + 3 * t3),
    0.5 * (t + 4 * t2 - 3 * t3),
    0.5 * (-t2 + t3),
  ];
  return combine([p0, p1, p2, p3], w);
}

/** dC/dt of the Catmull–Rom segment (derivative of the weights above). */
export function catmullRomTangent(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const w = [
    0.5 * (-1 + 4 * t - 3 * t2),
    0.5 * (-10 * t + 9 * t2),
    0.5 * (1 + 8 * t - 9 * t2),
    0.5 * (-2 * t + 3 * t2),
  ];
  return combine([p0, p1, p2, p3], w);
}

/**
 * Uniform cubic B-spline basis values [N0(t), N1(t), N2(t), N3(t)].
 *   N0 = (1 − t)³/6,  N1 = (3t³ − 6t² + 4)/6,  N2 = (−3t³ + 3t² + 3t + 1)/6,  N3 = t³/6
 * Non-negative and summing to 1, so the curve stays in the convex hull of
 * its four control points; neighbouring segments join with C² continuity.
 */
export function bsplineBasis(t) {
  const s = 1 - t, t2 = t * t, t3 = t2 * t;
  return [s * s * s / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
}

/** Point on the uniform cubic B-spline segment controlled by p0..p3. */
export function bspline(p0, p1, p2, p3, t) { return combine([p0, p1, p2, p3], bsplineBasis(t)); }

/** dC/dt of the B-spline segment. */
export function bsplineTangent(p0, p1, p2, p3, t) {
  const s = 1 - t;
  const w = [-0.5 * s * s, 0.5 * (3 * t * t - 4 * t), 0.5 * (-3 * t * t + 2 * t + 1), 0.5 * t * t];
  return combine([p0, p1, p2, p3], w);
}

/* ------------------------------------------------ basis conversions ----- */
/* Both families are cubic polynomials per segment, so every segment can be  */
/* rewritten exactly as a cubic Bézier. Used to convert between curve kinds  */
/* and to show de Casteljau's construction on any segment.                   */

/** Bézier control points of the Catmull–Rom segment p1 → p2. */
export function catmullRomToBezier(p0, p1, p2, p3) {
  return [
    [...p1],
    p1.map((x, d) => x + (p2[d] - p0[d]) / 6),
    p2.map((x, d) => x - (p3[d] - p1[d]) / 6),
    [...p2],
  ];
}

/** Bézier control points of the uniform B-spline segment p0..p3. */
export function bsplineToBezier(p0, p1, p2, p3) {
  return [
    combine([p0, p1, p2], [1 / 6, 4 / 6, 1 / 6]),
    combine([p1, p2], [2 / 3, 1 / 3]),
    combine([p1, p2], [1 / 3, 2 / 3]),
    combine([p1, p2, p3], [1 / 6, 4 / 6, 1 / 6]),
  ];
}
