/**
 * mat4 — 4×4 matrices for Parts A and C.
 *
 * CONVENTIONS (the tests check exactly these):
 *   • A matrix is a Float32Array(16) in COLUMN-MAJOR order — the layout WebGPU
 *     expects for a mat4x4f in a uniform buffer. Element (row r, column c)
 *     lives at index  c * 4 + r.  The translation of an affine matrix is
 *     therefore at indices 12, 13, 14.
 *   • Column vectors: a point p is transformed as  M · p.
 *     multiply(A, B) returns A·B, so B is applied FIRST.
 *   • Right-handed world space. Angles in RADIANS. A positive angle rotates
 *     counter-clockwise when you look down the axis towards the origin
 *     (rotateZ(π/2) takes +x to +y).
 *   • View space: the camera sits at the origin and looks down −z, +y is up.
 *   • Clip space is WebGPU's: after the divide by w, x and y are in [−1, 1]
 *     and z is in [0, 1] (near → 0, far → 1). NOT OpenGL's [−1, 1].
 *
 * No maths libraries (no gl-matrix, no Three.js). Tests: tests/mat4.test.js
 */
import * as vec3 from './vec3.js';

/** Column-major index of element (row r, column c). */
const at = (r, c) => c * 4 + r;

/* ------------------------------------------------------------- Part A ---- */

/** The 4×4 identity. */
export function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** A · B (apply B first, then A). Must not modify a or b. */
export function multiply(a, b) {
  const out = new Float32Array(16);
  // (A·B)[r][c] = Σ_k A[r][k] · B[k][c]
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[at(r, k)] * b[at(k, c)];
      out[at(r, c)] = sum;
    }
  }
  return out;
}

/** Translation by (tx, ty, tz). */
export function translate(tx, ty, tz) {
  const m = identity();
  m[12] = tx; m[13] = ty; m[14] = tz;
  return m;
}

/**
 * The three axis rotations share one pattern: the rotation acts in the plane
 * of two axes (i, j) and leaves the third fixed. With c = cos θ, s = sin θ
 *     i → c·i + s·j,   j → −s·i + c·j
 * so column i holds (c, s) and column j holds (−s, c) in rows i and j.
 */
function planeRotation(i, j, rad) {
  const m = identity();
  const c = Math.cos(rad), s = Math.sin(rad);
  m[at(i, i)] = c; m[at(j, i)] = s;
  m[at(i, j)] = -s; m[at(j, j)] = c;
  return m;
}

/** Rotation by `rad` about the x axis (+y → +z). */
export function rotateX(rad) { return planeRotation(1, 2, rad); }

/** Rotation by `rad` about the y axis (+z → +x). */
export function rotateY(rad) { return planeRotation(2, 0, rad); }

/** Rotation by `rad` about the z axis (+x → +y). */
export function rotateZ(rad) { return planeRotation(0, 1, rad); }

/** Non-uniform scale by (sx, sy, sz). */
export function scale(sx, sy, sz) {
  const m = identity();
  m[0] = sx; m[5] = sy; m[10] = sz;
  return m;
}

/** Mᵀ */
export function transpose(m) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[at(c, r)] = m[at(r, c)];
  return out;
}

/**
 * Inverse of a RIGID transform M = T·R (rotation + translation only, no scale).
 * Do not write a general 4×4 inverse: use the structure (Week 3).
 *
 *   M⁻¹ = (T·R)⁻¹ = R⁻¹·T⁻¹ = Rᵀ · T(−t)   →   [ Rᵀ | −Rᵀ·t ]
 * because a rotation is orthonormal (R⁻¹ = Rᵀ).
 */
export function invertRigid(m) {
  const out = identity();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[at(r, c)] = m[at(c, r)];
  const t = [m[12], m[13], m[14]];
  for (let r = 0; r < 3; r++) {
    out[at(r, 3)] = -(out[at(r, 0)] * t[0] + out[at(r, 1)] * t[1] + out[at(r, 2)] * t[2]);
  }
  return out;
}

/** M · v for a 4-component v = [x, y, z, w]; returns [x', y', z', w']. */
export function transformVec4(m, v) {
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = m[at(r, 0)] * v[0] + m[at(r, 1)] * v[1] + m[at(r, 2)] * v[2] + m[at(r, 3)] * v[3];
  }
  return out;
}

/**
 * Matrix for transforming NORMALS by M (used by the mesh shader).
 * Normals need the inverse-transpose of the upper 3×3 block A; for a
 * non-uniform scale A itself would tilt them. The cofactor matrix of A equals
 * det(A)·A⁻ᵀ, and the shader normalises anyway, so the cofactors (times the
 * sign of det, so mirrored transforms keep outward normals) are enough — no
 * general inverse needed. Returned as a mat4 with zero translation.
 */
export function normalMatrix(m) {
  const a = (r, c) => m[at(r, c)];
  const out = identity();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const r1 = (r + 1) % 3, r2 = (r + 2) % 3, c1 = (c + 1) % 3, c2 = (c + 2) % 3;
      out[at(r, c)] = a(r1, c1) * a(r2, c2) - a(r1, c2) * a(r2, c1);
    }
  }
  const det = a(0, 0) * out[at(0, 0)] + a(0, 1) * out[at(0, 1)] + a(0, 2) * out[at(0, 2)];
  if (det < 0) for (let i = 0; i < 11; i++) if (i % 4 !== 3) out[i] = -out[i];
  return out;
}

/* ------------------------------------------------------------- Part C ---- */

/**
 * View matrix for a camera at `eye` looking at `target`, with `up` as the
 * approximate up direction. Build the camera basis with two cross products.
 * Must stay finite when `up` is parallel to the view direction — handle it.
 * eye, target, up: [x, y, z]
 *
 * Camera basis (all unit length, right-handed):
 *   f = normalize(target − eye)    forward; the camera looks down −z, so z_cam = −f
 *   s = normalize(f × up)          side (right, +x on screen)
 *   u = s × f                      true up (+y on screen)
 * V is the inverse of the camera's rigid placement [s u −f | eye]:
 * rows s, u, −f and translation −(row · eye).
 */
export function lookAt(eye, target, up) {
  let f = vec3.normalize(vec3.sub(target, eye));
  if (vec3.length(f) === 0) f = [0, 0, -1]; // eye == target: look down −z

  // If `up` is (nearly) parallel to f, f × up vanishes. Fall back to the first
  // world axis that is not parallel to f; −z keeps the painting at the top of
  // the screen when looking straight down or up.
  let s = vec3.cross(f, vec3.normalize(up));
  if (vec3.length(s) < 1e-6) {
    for (const alt of [[0, 1, 0], [0, 0, -1], [1, 0, 0]]) {
      s = vec3.cross(f, alt);
      if (vec3.length(s) > 1e-3) break;
    }
  }
  s = vec3.normalize(s);
  const u = vec3.cross(s, f);

  const m = identity();
  for (let c = 0; c < 3; c++) {
    m[at(0, c)] = s[c];
    m[at(1, c)] = u[c];
    m[at(2, c)] = -f[c];
  }
  m[12] = -vec3.dot(s, eye);
  m[13] = -vec3.dot(u, eye);
  m[14] = vec3.dot(f, eye);
  return m;
}

/**
 * Perspective projection for WebGPU (depth z ∈ [0, 1]).
 * fovY: vertical field of view in radians; aspect = width / height;
 * near, far: positive distances along −z.
 *
 *   x_clip = (f/aspect)·x,  y_clip = f·y   with f = 1 / tan(fovY / 2)
 *   w_clip = −z                            (the perspective divide)
 *   z_clip = A·z + B  with A = far/(near − far), B = near·far/(near − far),
 * chosen so that z = −near gives z/w = 0 and z = −far gives z/w = 1.
 */
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[at(0, 0)] = f / aspect;
  m[at(1, 1)] = f;
  m[at(2, 2)] = far / (near - far);
  m[at(2, 3)] = (near * far) / (near - far);
  m[at(3, 2)] = -1;
  return m;
}

/**
 * Orthographic projection for WebGPU (depth z ∈ [0, 1]) of the box
 * x ∈ [left, right], y ∈ [bottom, top], z ∈ [−near, −far] in view space.
 *
 * A scale and a translation per axis: x and y map linearly onto [−1, 1],
 * and depth d = −z maps from [near, far] onto [0, 1]. w stays 1.
 */
export function orthographic(left, right, bottom, top, near, far) {
  const m = identity();
  m[at(0, 0)] = 2 / (right - left);
  m[at(1, 1)] = 2 / (top - bottom);
  m[at(2, 2)] = -1 / (far - near);
  m[at(0, 3)] = -(right + left) / (right - left);
  m[at(1, 3)] = -(top + bottom) / (top - bottom);
  m[at(2, 3)] = -near / (far - near);
  return m;
}

/* ------------------------------------------------- provided (not graded) - */

/**
 * Pretty-print a column-major matrix as four rows, for showing matrices on
 * screen (Part A asks you to display T·R·S and S·R·T).
 */
export function format(m, digits = 2) {
  if (!m) return '(none)';
  const w = digits + 4;
  let s = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) s += (+m[c * 4 + r]).toFixed(digits).padStart(w);
    if (r < 3) s += '\n';
  }
  return s;
}
