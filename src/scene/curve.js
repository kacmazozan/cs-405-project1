/**
 * Curve model for Part D: data, evaluation and editing, with no GPU or DOM
 * code (so it can be unit-tested in Node: tests/curve.test.js).
 *
 *   curve = {
 *     painting: 'kavunlu',
 *     aspect:   1.433,                 // painting width / height (world ↔ u, v)
 *     kind:     'bezier-c1' | 'catmull-rom' | 'bspline',
 *     closed:   false,
 *     points:   [[x, y], …],           // world x, y on the painting plane z = 0
 *   }
 *
 * For 'bezier-c1' `points` is the flat poly-Bézier list
 *     A0  H  H  A1  H  H  A2 …         (anchors A, handles H)
 * with 3n + 1 points for n open segments (3n when closed: the last segment
 * ends at A0). Segment i is points[3i … 3i + 3], so consecutive segments
 * share their joint by construction, and C¹ only needs the two handles
 * around each anchor to mirror each other (c1NextControl).
 * For the other two kinds `points` are the spline's control points.
 */
import * as C from '../math/curves.js';

export const KINDS = ['bezier-c1', 'catmull-rom', 'bspline'];

/* -------------------------------------------- painting coordinates ------ */

/** Normalised painting (u, v) — origin top-left, v down — → world (x, y). */
export const uvToWorld = ([u, v], a) => [(2 * u - 1) * a, 1 - 2 * v];

/** World (x, y) → normalised painting (u, v). */
export const worldToUV = ([x, y], a) => [(x + a) / (2 * a), (1 - y) / 2];

/* ------------------------------------------------------- segments ------- */

const isBezier = (curve) => curve.kind === 'bezier-c1';
const mod = (i, n) => ((i % n) + n) % n;

/** Number of cubic segments the curve currently has. */
export function segmentCount(curve) {
  const n = curve.points.length;
  if (isBezier(curve)) return curve.closed ? (n >= 6 ? n / 3 : 0) : Math.max(0, (n - 1) / 3);
  if (curve.closed) return n >= 3 ? n : 0;
  return Math.max(0, n - 3);
}

/** The four control points of every segment, in the curve's own basis. */
export function segments(curve) {
  const P = curve.points, n = P.length, count = segmentCount(curve);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (isBezier(curve)) out.push([0, 1, 2, 3].map((k) => P[(3 * i + k) % n]));
    else if (curve.closed) out.push([-1, 0, 1, 2].map((k) => P[mod(i + k, n)]));
    else out.push([P[i], P[i + 1], P[i + 2], P[i + 3]]);
  }
  return out;
}

/** Point of segment `s` (four control points) at local t. */
export function evalSegment(kind, s, t) {
  if (kind === 'catmull-rom') return C.catmullRom(...s, t);
  if (kind === 'bspline') return C.bspline(...s, t);
  return C.cubicBezier(...s, t);
}

/** Tangent dC/dt of segment `s` at local t. */
export function tangentSegment(kind, s, t) {
  if (kind === 'catmull-rom') return C.catmullRomTangent(...s, t);
  if (kind === 'bspline') return C.bsplineTangent(...s, t);
  return C.cubicBezierTangent(...s, t);
}

/** The same segment rewritten as a cubic Bézier (exact for all three kinds). */
export function bezierOfSegment(kind, s) {
  if (kind === 'catmull-rom') return C.catmullRomToBezier(...s);
  if (kind === 'bspline') return C.bsplineToBezier(...s);
  return s.map((p) => [...p]);
}

/**
 * The curve at a global parameter u ∈ [0, 1] (segment i covers [i/n, (i+1)/n]).
 * Returns null while the curve has no segment yet.
 */
export function evaluate(curve, u) {
  const segs = segments(curve);
  if (segs.length === 0) return null;
  const { index, t } = C.splitParameter(segs.length, u);
  const point = isBezier(curve) ? C.evalPiecewise(segs, u) : evalSegment(curve.kind, segs[index], t);
  return { point, tangent: tangentSegment(curve.kind, segs[index], t), index, t, segment: segs[index] };
}

/** Polyline through the curve: `perSegment` samples per segment. */
export function sample(curve, perSegment = 32) {
  const segs = segments(curve), out = [];
  segs.forEach((s, i) => {
    for (let k = i === 0 ? 0 : 1; k <= perSegment; k++) out.push(evalSegment(curve.kind, s, k / perSegment));
  });
  return out;
}

/**
 * Largest tangent mismatch over the joints (0 for a C¹ curve). Only Bézier
 * curves can break C¹; Catmull–Rom is C¹ and the B-spline C² by construction.
 */
export function c1Error(curve) {
  const segs = segments(curve);
  let worst = 0;
  const joints = curve.closed ? segs.length : segs.length - 1;
  for (let i = 0; i < joints; i++) {
    const a = tangentSegment(curve.kind, segs[i], 1);
    const b = tangentSegment(curve.kind, segs[(i + 1) % segs.length], 0);
    worst = Math.max(worst, Math.hypot(...a.map((x, d) => x - b[d])));
  }
  return worst;
}

/**
 * Arc-length table for constant-speed motion: the parameter u does not move
 * at constant speed along a cubic, so measure the polyline length at many u
 * and invert it. Returns { us, lengths, total }.
 */
export function arcLengthTable(curve, perSegment = 48) {
  const n = segmentCount(curve) * perSegment;
  const us = [], lengths = [];
  let total = 0, prev = null;
  for (let k = 0; k <= n; k++) {
    const u = n ? k / n : 0;
    const p = evaluate(curve, u)?.point;
    if (!p) break;
    if (prev) total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    us.push(u); lengths.push(total); prev = p;
  }
  return { us, lengths, total };
}

/** The parameter u at which the curve has length s ∈ [0, total] (binary search + lerp). */
export function uAtLength(table, s) {
  const { us, lengths } = table;
  if (us.length < 2) return 0;
  let lo = 0, hi = lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] < s) lo = mid; else hi = mid;
  }
  const span = lengths[hi] - lengths[lo];
  const f = span > 0 ? (s - lengths[lo]) / span : 0;
  return us[lo] + (us[hi] - us[lo]) * Math.min(Math.max(f, 0), 1);
}

/* ------------------------------------------------------- editing -------- */
/* All edits change `curve` in place; points are replaced, never mutated.   */

/** 'anchor' | 'handle' — what the point at index i is (all points are anchors for splines). */
export function role(curve, i) {
  return isBezier(curve) && i % 3 !== 0 ? 'handle' : 'anchor';
}

/** Index of P[i ± k] for a Bézier list, wrapping when closed; −1 if outside. */
function neighbour(curve, i, k) {
  const n = curve.points.length, j = i + k;
  if (curve.closed) return mod(j, n);
  return j >= 0 && j < n ? j : -1;
}

/**
 * Move point i to p. For 'bezier-c1' this keeps every joint C¹:
 *   • moving an anchor carries both of its handles along (same offset);
 *   • moving a handle mirrors the opposite handle through the anchor.
 */
export function movePoint(curve, i, p) {
  const P = curve.points;
  if (!isBezier(curve)) { P[i] = [...p]; return; }
  const r = i % 3;
  if (r === 0) {
    const d = [p[0] - P[i][0], p[1] - P[i][1]];
    for (const k of [-1, 1]) {
      const j = neighbour(curve, i, k);
      if (j >= 0) P[j] = [P[j][0] + d[0], P[j][1] + d[1]];
    }
    P[i] = [...p];
    return;
  }
  P[i] = [...p];
  // r = 1: handle after anchor i − 1, opposite handle at i − 2
  // r = 2: handle before anchor i + 1, opposite handle at i + 2
  const anchor = neighbour(curve, i, r === 1 ? -1 : 1);
  const other = neighbour(curve, i, r === 1 ? -2 : 2);
  if (anchor >= 0 && other >= 0) P[other] = C.c1NextControl(P[i], P[anchor]);
}

/**
 * Add a point at p and return its index. Splines: append a control point.
 * Bézier: append a segment ending at p whose first handle mirrors the
 * previous one (C¹); on a closed curve the new anchor is inserted before the
 * closing joint.
 */
export function addPoint(curve, p) {
  const P = curve.points;
  if (!isBezier(curve) || P.length === 0) { P.push([...p]); return P.length - 1; }
  const n = P.length;
  if (curve.closed && n >= 6) {
    const last = P[n - 3], first = P[0];
    const d = [(first[0] - last[0]) / 6, (first[1] - last[1]) / 6];
    P.splice(n - 1, 0, [p[0] - d[0], p[1] - d[1]], [...p], [p[0] + d[0], p[1] + d[1]]);
    return n;
  }
  const a = P[n - 1];
  const h1 = n >= 4 ? C.c1NextControl(P[n - 2], a) : C.lerp(a, p, 1 / 3);
  P.push(h1, C.lerp(h1, p, 0.5), [...p]);
  return P.length - 1;
}

/**
 * Remove point i. Bézier: removes the anchor with its two handles (clicking
 * a handle removes its anchor), so the list stays A H H A H H … A.
 */
export function removePoint(curve, i) {
  const P = curve.points;
  if (!isBezier(curve)) { P.splice(i, 1); return; }
  let a = Math.round(i / 3) * 3;                            // the handle's anchor
  if (curve.closed) {
    if (P.length <= 6) { curve.closed = false; P.splice(P.length - 2, 2); a = Math.min(a, P.length - 1); }
    else {
      // rotate so the anchor is first, then drop [last handle, anchor, next handle]
      const rot = P.splice(0, mod(a, P.length));
      P.push(...rot);
      P.splice(P.length - 1, 1);
      P.splice(0, 2);
      // now starts with a handle: move it to the end to start at an anchor again
      P.push(P.shift());
      return;
    }
  }
  if (P.length <= 1) { P.length = 0; return; }
  if (a === 0) P.splice(0, 3);
  else if (a >= P.length - 1) P.splice(P.length - 3, 3);
  else P.splice(a - 1, 3);
}

/** Open or close the curve (Bézier: add / drop the closing segment's handles). */
export function setClosed(curve, closed) {
  if (closed === curve.closed) return;
  const P = curve.points;
  if (isBezier(curve)) {
    if (closed) {
      if (P.length < 4) return; // needs at least one segment
      P.push(C.c1NextControl(P[P.length - 2], P[P.length - 1]), C.c1NextControl(P[1], P[0]));
    } else {
      P.splice(P.length - 2, 2);
    }
  }
  curve.closed = closed;
}

/**
 * Change the kind and keep the shape where the maths allows it:
 *   spline → Bézier is EXACT (every segment rewritten with bezierOfSegment);
 *   Bézier → Catmull–Rom keeps the anchors (exact for curves that came from
 *   Catmull–Rom); Catmull–Rom ↔ B-spline keeps the control points, so you
 *   can see the same points interpolated vs approximated.
 */
export function convert(curve, kind) {
  if (kind === curve.kind) return;
  if (kind === 'bezier-c1') {
    const segs = segments(curve).map((s) => bezierOfSegment(curve.kind, s));
    const old = curve.points;
    curve.kind = kind;
    curve.points = [];
    if (segs.length === 0) {
      // too few points for a spline segment yet: rebuild them as Bézier anchors
      const closed = curve.closed;
      curve.closed = false;
      for (const p of old) addPoint(curve, p);
      setClosed(curve, closed);
      return;
    }
    segs.forEach((s, i) => curve.points.push(...(i === 0 ? s : s.slice(1))));
    if (curve.closed) curve.points.pop(); // the last P3 is the first P0 again
    return;
  } else if (curve.kind === 'bezier-c1') {
    const P = curve.points;
    const anchors = P.filter((_, i) => i % 3 === 0);
    if (!curve.closed && anchors.length >= 2) {
      // phantom end points that give Catmull–Rom the same end tangents:
      // tangent at A0 = 3(H − A0) = (A1 − p₋₁)/2  →  p₋₁ = A1 − 6(H − A0)
      const a0 = P[0], h0 = P[1], an = P[P.length - 1], hn = P[P.length - 2];
      const first = anchors[1].map((x, d) => x - 6 * (h0[d] - a0[d]));
      const last = anchors[anchors.length - 2].map((x, d) => x + 6 * (an[d] - hn[d]));
      curve.points = [first, ...anchors, last];
    } else {
      curve.points = anchors;
    }
  }
  curve.kind = kind;
}

/* ------------------------------------------------------- presets -------- */

/**
 * Starting curves in normalised (u, v), as anchors with one handle offset
 * each (the other handle mirrors it, so they are C¹ by construction).
 * kavunlu: the outline of the melon slice, a closed loop.
 */
const PRESETS = {
  kavunlu: {
    closed: true,
    anchors: [
      { p: [0.186, 0.632], h: [0.018, 0.080] },  // left tip of the slice
      { p: [0.470, 0.818], h: [0.140, 0.004] },  // bottom of the rind
      { p: [0.815, 0.675], h: [0.040, -0.055] }, // right tip
      { p: [0.700, 0.535], h: [-0.090, -0.012] },
      { p: [0.430, 0.548], h: [-0.110, 0.002] }, // along the seeds
    ],
  },
  default: {
    closed: false,
    anchors: [
      { p: [0.20, 0.62], h: [0.08, -0.12] },
      { p: [0.50, 0.45], h: [0.10, 0.00] },
      { p: [0.80, 0.38], h: [0.08, -0.08] },
    ],
  },
};

/** A fresh curve for a painting (its preset, or a generic S-curve). */
export function presetCurve(paintingId, aspect) {
  const preset = PRESETS[paintingId] ?? PRESETS.default;
  const pts = [];
  preset.anchors.forEach(({ p, h }, i) => {
    const before = [p[0] - h[0], p[1] - h[1]], after = [p[0] + h[0], p[1] + h[1]];
    if (i > 0 || preset.closed) pts.push(before);
    pts.push(p);
    if (i < preset.anchors.length - 1 || preset.closed) pts.push(after);
  });
  if (preset.closed) pts.push(pts.shift()); // start at A0: A0 H H A1 … H (H before A0)
  return {
    painting: paintingId,
    aspect,
    kind: 'bezier-c1',
    closed: preset.closed,
    points: pts.map((uv) => uvToWorld(uv, aspect)),
  };
}
