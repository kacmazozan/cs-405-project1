/**
 * Curve export — Part D.
 *
 * Required JSON format (control points in NORMALISED painting coordinates:
 * u, v ∈ [0, 1], origin at the TOP-LEFT corner of the painting, v downwards,
 * the same as texture coordinates):
 *
 * {
 *   "painting": "kavunlu",
 *   "kind": "bezier-c1",                 // or "catmull-rom" / "bspline"
 *   "segments": [                          // for "bezier-c1": 4 points each
 *     [[0.12, 0.40], [0.18, 0.31], [0.27, 0.30], [0.33, 0.38]],
 *     ...
 *   ],
 *   "points": [[u, v], ...]                // for "catmull-rom" / "bspline"
 * }
 *
 * We also write "closed": true / false. It is an extra key (readers that do
 * not know it can ignore it); without it a closed spline could not be told
 * apart from an open one.
 *
 * The painting quad spans x ∈ [−a, a], y ∈ [−1, 1] at z = 0 (a = image
 * width / height), so  u = (x + a) / (2a)  and  v = (1 − y) / 2.
 */
import { KINDS, segments, worldToUV, uvToWorld } from './curve.js';

const round = (x) => Math.round(x * 1e4) / 1e4; // 0.0001 ≈ a tenth of a pixel

/**
 * Build the object above from a curve of scene/curve.js (world x, y on the
 * painting plane). Every control point goes through
 *     u = (x + a) / (2a),   v = (1 − y) / 2.
 */
export function curveToJSON(curve) {
  const uv = (p) => worldToUV(p, curve.aspect).map(round);
  const out = { painting: curve.painting, kind: curve.kind, closed: curve.closed };
  if (curve.kind === 'bezier-c1') out.segments = segments(curve).map((seg) => seg.map(uv));
  else out.points = curve.points.map(uv);
  return out;
}

/**
 * The inverse of curveToJSON, for loading a saved curve onto a painting with
 * the given aspect. "closed" is read when present; a Bézier whose last P3
 * equals its first P0 also comes back closed.
 */
export function curveFromJSON(obj, aspect) {
  if (!obj || !KINDS.includes(obj.kind)) throw new Error(`unknown curve kind: ${obj?.kind}`);
  const world = (p) => {
    if (!Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite)) throw new Error('bad control point');
    return uvToWorld(p, aspect);
  };
  const curve = { painting: obj.painting, aspect, kind: obj.kind, closed: false, points: [] };
  const closed = obj.closed === true;
  if (obj.kind === 'bezier-c1') {
    const segs = obj.segments ?? [];
    segs.forEach((seg, i) => {
      if (!Array.isArray(seg) || seg.length !== 4) throw new Error(`segment ${i} needs 4 points`);
      curve.points.push(...(i === 0 ? seg : seg.slice(1)).map(world));
    });
    const P = curve.points;
    if (segs.length >= 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-3) {
      P.pop();
      curve.closed = true;
    }
  } else {
    curve.points = (obj.points ?? []).map(world);
    curve.closed = closed && curve.points.length >= 3;
  }
  return curve;
}

/** Provided: save any object as a .json download in the browser. */
export function downloadJSON(obj, filename = 'curve.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
