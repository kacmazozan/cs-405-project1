/**
 * quat — unit quaternions [x, y, z, w] for rotations (bonus: quaternion orbit
 * camera with smooth interpolation between viewpoints).
 *
 * A rotation by θ about the unit axis a is q = (a·sin(θ/2), cos(θ/2)).
 * Composition is the quaternion product (a ∘ b applies b first, like matrices),
 * and slerp walks the shortest great-circle arc between two orientations at
 * constant angular speed — interpolating matrices or Euler angles does neither.
 */
import * as vec3 from './vec3.js';

export function identity() { return [0, 0, 0, 1]; }

export function fromAxisAngle(axis, rad) {
  const a = vec3.normalize(axis), s = Math.sin(rad / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(rad / 2)];
}

/** a ∘ b (rotate by b first, then by a). */
export function multiply(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function normalize(q) {
  const len = Math.hypot(...q) || 1;
  return q.map((x) => x / len);
}

/** Rotate the vector v by q:  v' = v + 2w(u × v) + 2u × (u × v),  u = (x, y, z). */
export function rotate(q, v) {
  const u = [q[0], q[1], q[2]];
  const t = vec3.scale(vec3.cross(u, v), 2);
  return vec3.add(vec3.add(v, vec3.scale(t, q[3])), vec3.cross(u, t));
}

/**
 * Quaternion of the rotation matrix whose COLUMNS are the orthonormal axes
 * x, y, z (Shepperd's method: divide by the largest of w, x, y, z for accuracy).
 */
export function fromBasis(x, y, z) {
  const m00 = x[0], m10 = x[1], m20 = x[2];
  const m01 = y[0], m11 = y[1], m21 = y[2];
  const m02 = z[0], m12 = z[1], m22 = z[2];
  const trace = m00 + m11 + m22;
  let q;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return normalize(q);
}

/** Spherical linear interpolation, t ∈ [0, 1], along the shorter arc. */
export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  // q and −q are the same rotation: flip b so we take the short way round
  if (d < 0) { b = b.map((x) => -x); d = -d; }
  if (d > 0.9995) return normalize(a.map((x, i) => x + (b[i] - x) * t)); // nearly equal: lerp is fine
  const theta = Math.acos(d), s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s, wb = Math.sin(t * theta) / s;
  return a.map((x, i) => wa * x + wb * b[i]);
}
