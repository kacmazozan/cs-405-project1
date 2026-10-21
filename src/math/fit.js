/**
 * Least-squares fitting of cubic Bézier curves to a hand-drawn stroke (bonus).
 *
 * Given stroke points Q₀ … Q_m and a parameter t_k for each, the Bézier
 *     B(t) = b₀(t)P₀ + b₁(t)P₁ + b₂(t)P₂ + b₃(t)P₃      (bᵢ = Bernstein basis)
 * is LINEAR in the control points, so minimising Σ |B(t_k) − Q_k|² is a
 * linear least-squares problem: setting the gradient to zero gives small
 * normal equations. The t_k start as chord-length fractions and are then
 * improved by Newton steps that move each B(t_k) to the closest curve point.
 */
import { bernstein3, cubicBezier, cubicBezierTangent, lerp } from './curves.js';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const scale = (a, s) => a.map((x) => x * s);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a) => Math.sqrt(dot(a, a));
const unit = (a) => { const l = norm(a); return l > 0 ? scale(a, 1 / l) : a.map(() => 0); };

/** Chord-length parameters: t_k = (polyline length up to Q_k) / (total length). */
export function chordParams(points) {
  const t = [0];
  for (let k = 1; k < points.length; k++) t.push(t[k - 1] + norm(sub(points[k], points[k - 1])));
  const total = t[t.length - 1] || 1;
  return t.map((x) => x / total);
}

/** Second derivative of the cubic Bézier. */
function bezierSecond([p0, p1, p2, p3], t) {
  return p0.map((_, d) => 6 * ((1 - t) * (p2[d] - 2 * p1[d] + p0[d]) + t * (p3[d] - 2 * p2[d] + p1[d])));
}

/**
 * One Newton step per point on f(t) = (B(t) − Q)·B'(t) = 0, the condition for
 * B(t) being the closest curve point to Q:  t ← t − f / f'.
 */
export function reparametrize(ctrl, points, params) {
  return params.map((t, k) => {
    const d = sub(cubicBezier(...ctrl, t), points[k]);
    const d1 = cubicBezierTangent(...ctrl, t), d2 = bezierSecond(ctrl, t);
    const den = dot(d1, d1) + dot(d, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - dot(d, d1) / den));
  });
}

/** Root-mean-square distance between the points and B(t_k). */
export function rmsError(ctrl, points, params) {
  const s = points.reduce((acc, q, k) => acc + dot(sub(cubicBezier(...ctrl, params[k]), q), sub(cubicBezier(...ctrl, params[k]), q)), 0);
  return Math.sqrt(s / points.length);
}

/**
 * Least-squares cubic Bézier with fixed end points P₀ = Q₀, P₃ = Q_m.
 * Unknowns P₁, P₂ (any dimension), normal equations
 *   [Σb₁²   Σb₁b₂] [P₁]   [Σ b₁ R_k]
 *   [Σb₁b₂  Σb₂² ] [P₂] = [Σ b₂ R_k],    R_k = Q_k − b₀P₀ − b₃P₃.
 * @returns {{ control: number[][], params: number[], rms: number }}
 */
export function fitCubicBezier(points, { params = chordParams(points), iterations = 6 } = {}) {
  const p0 = points[0], p3 = points[points.length - 1];
  let ctrl;
  for (let it = 0; it <= iterations; it++) {
    let a11 = 0, a12 = 0, a22 = 0;
    let r1 = p0.map(() => 0), r2 = p0.map(() => 0);
    points.forEach((q, k) => {
      const [b0, b1, b2, b3] = bernstein3(params[k]);
      const r = sub(sub(q, scale(p0, b0)), scale(p3, b3));
      a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2;
      r1 = add(r1, scale(r, b1)); r2 = add(r2, scale(r, b2));
    });
    const det = a11 * a22 - a12 * a12;
    const p1 = Math.abs(det) < 1e-12 ? lerp(p0, p3, 1 / 3) : scale(sub(scale(r1, a22), scale(r2, a12)), 1 / det);
    const p2 = Math.abs(det) < 1e-12 ? lerp(p0, p3, 2 / 3) : scale(sub(scale(r2, a11), scale(r1, a12)), 1 / det);
    ctrl = [[...p0], p1, p2, [...p3]];
    if (it < iterations) params = reparametrize(ctrl, points, params);
  }
  return { control: ctrl, params, rms: rmsError(ctrl, points, params) };
}

/**
 * Least-squares fit with the end TANGENT DIRECTIONS fixed (Schneider's form):
 * P₁ = P₀ + α·t̂₀ and P₂ = P₃ − β·t̂₁, so only the handle lengths α, β are unknown
 * and neighbouring segments that share t̂ meet with the same direction.
 */
function fitWithTangents(points, t0, t1, iterations = 4) {
  const p0 = points[0], p3 = points[points.length - 1];
  const chord = norm(sub(p3, p0));
  let params = chordParams(points), ctrl, alpha, beta;
  for (let it = 0; it <= iterations; it++) {
    let c11 = 0, c12 = 0, c22 = 0, x1 = 0, x2 = 0;
    points.forEach((q, k) => {
      const [b0, b1, b2, b3] = bernstein3(params[k]);
      const A1 = scale(t0, b1), A2 = scale(t1, -b2);
      const r = sub(q, add(scale(p0, b0 + b1), scale(p3, b2 + b3)));
      c11 += dot(A1, A1); c12 += dot(A1, A2); c22 += dot(A2, A2);
      x1 += dot(A1, r); x2 += dot(A2, r);
    });
    const det = c11 * c22 - c12 * c12;
    alpha = Math.abs(det) > 1e-12 ? (x1 * c22 - x2 * c12) / det : 0;
    beta = Math.abs(det) > 1e-12 ? (c11 * x2 - c12 * x1) / det : 0;
    // negative or tiny handles mean the fit is unreliable: fall back to chord / 3
    if (!(alpha > 1e-3 * chord) || !(beta > 1e-3 * chord)) alpha = beta = chord / 3;
    ctrl = [p0, add(p0, scale(t0, alpha)), sub(p3, scale(t1, beta)), p3];
    if (it < iterations) params = reparametrize(ctrl, points, params);
  }
  return { alpha, beta, params };
}

/**
 * Fit a C¹ piecewise cubic Bézier with n segments to a stroke.
 *   1. split the stroke at equal arc length into n pieces (the joints);
 *   2. estimate one unit tangent per joint from the neighbouring stroke points;
 *   3. fit each piece by least squares with those tangent directions (G¹);
 *   4. give the two handles at every joint the same length (their mean): C¹.
 * Returns the flat poly-Bézier list A₀ H H A₁ … used by scene/curve.js
 * (3n + 1 points open, 3n closed) and the RMS distance of the stroke to the result.
 */
export function fitPiecewiseC1(stroke, n, closed = false) {
  let Q = stroke.filter((p, k) => k === 0 || norm(sub(p, stroke[k - 1])) > 1e-9);
  if (closed && Q.length > 2 && norm(sub(Q[0], Q[Q.length - 1])) < 1e-9) Q = Q.slice(0, -1);
  const m = Q.length;
  n = Math.max(1, Math.min(n, Math.floor(m / 4)));

  // cumulative arc length (closed: around the loop, back to Q₀)
  const L = [0];
  for (let k = 1; k < m; k++) L.push(L[k - 1] + norm(sub(Q[k], Q[k - 1])));
  const total = closed ? L[m - 1] + norm(sub(Q[0], Q[m - 1])) : L[m - 1];

  const joints = [];
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total;
    let k = joints.length ? joints[joints.length - 1] + 1 : 0;
    while (k < m - 1 && L[k] < s) k++;
    // take the stroke point whose arc length is NEAREST to s (not just the first past it)
    if (k > 0 && i > 0 && joints.length && k - 1 > joints[joints.length - 1] && s - L[k - 1] < L[k] - s) k--;
    joints.push(i === 0 ? 0 : k);
  }
  joints.push(closed ? m : m - 1); // the end joint (index m wraps to Q₀)

  const at = (k) => Q[((k % m) + m) % m];
  const w = Math.max(1, Math.min(4, Math.floor(m / (n * 6))));
  const tangentAt = (k) => {
    if (!closed && k <= 0) return unit(sub(Q[Math.min(w, m - 1)], Q[0]));
    if (!closed && k >= m - 1) return unit(sub(Q[m - 1], Q[Math.max(0, m - 1 - w)]));
    return unit(sub(at(k + w), at(k - w)));
  };
  const T = joints.map(tangentAt);

  const fits = [];
  for (let i = 0; i < n; i++) {
    const piece = [];
    for (let k = joints[i]; k <= joints[i + 1]; k++) piece.push(at(k));
    fits.push(fitWithTangents(piece, T[i], T[i + 1]));
  }

  // C¹: equal handle lengths at each shared joint
  for (let i = 0; i < n; i++) {
    const next = closed ? (i + 1) % n : i + 1;
    if (next >= n) break;
    const mean = (fits[i].beta + fits[next].alpha) / 2;
    fits[i].beta = fits[next].alpha = mean;
  }

  const out = [];
  let sq = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const p0 = at(joints[i]), p3 = at(joints[i + 1]);
    const ctrl = [p0, add(p0, scale(T[i], fits[i].alpha)), sub(p3, scale(T[i + 1], fits[i].beta)), p3];
    out.push(...(i === 0 ? ctrl : ctrl.slice(1)));
    const piece = [];
    for (let k = joints[i]; k <= joints[i + 1]; k++) piece.push(at(k));
    const params = reparametrize(ctrl, piece, reparametrize(ctrl, piece, fits[i].params));
    piece.forEach((q, k) => { const d = sub(cubicBezier(...ctrl, params[k]), q); sq += dot(d, d); count++; });
  }
  if (closed) out.pop(); // the last P₃ is A₀ again
  return { points: out.map((p) => [...p]), rms: Math.sqrt(sq / Math.max(1, count)), segments: n };
}
