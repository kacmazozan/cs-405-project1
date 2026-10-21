/**
 * vec3 — 3-component vectors as plain arrays [x, y, z].
 *
 * Every function returns a NEW array and never modifies its arguments.
 * Write these yourself (Week 1, Linear Algebra I). Tests: tests/vec3.test.js
 */

/** a + b */
export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

/** a − b */
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

/** s · a  (s is a number) */
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

/** a · b  → number */
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** a × b  (right-handed: cross([1,0,0],[0,1,0]) = [0,0,1]) */
export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** |a|  → number */
export function length(a) { return Math.sqrt(dot(a, a)); }

/**
 * a / |a|.
 * For a zero-length vector return [0, 0, 0] — never NaN.
 */
export function normalize(a) {
  const len = length(a);
  return len > 0 ? scale(a, 1 / len) : [0, 0, 0];
}
