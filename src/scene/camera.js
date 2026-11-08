/**
 * Camera — Part C.
 *
 * The camera is plain data. viewProjection() turns it into P · V using YOUR
 * mat4.lookAt / mat4.perspective / mat4.orthographic / mat4.multiply.
 *
 * Until those exist it falls back to a fixed "fit the painting to the window"
 * matrix, so the starter shows your painting from the first `npm run dev`.
 * The panel tells you which of the two is active.
 */
import * as mat4 from '../math/mat4.js';
import * as vec3 from '../math/vec3.js';
import * as quat from '../math/quat.js';
import { NotImplemented } from '../math/todo.js';

export function createCamera() {
  return {
    eye: [0, 0, 2.8],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fovY: Math.PI / 4, // radians
    // near/far bracket the scene tightly: depth precision is spent mostly
    // near the near plane, so near ≫ 0 and far / near small keep it usable.
    // far = 10 covers the scene from the farthest the camera can zoom out (8).
    near: 0.1,
    far: 10,
    projection: 'perspective', // or 'orthographic'
    orthoHeight: 2.2, // world units visible vertically in orthographic mode
    transition: null, // set by setView(): a smooth move to a preset view
  };
}

/**
 * @param {object} cam     from createCamera()
 * @param {number} aspect  canvas width / height
 * @param {number} paintingAspect  image width / height (only used by the fallback)
 * @returns {{ matrix: Float32Array, fallback: boolean, missing?: string }}
 */
export function viewProjection(cam, aspect, paintingAspect = 1) {
  try {
    const view = mat4.lookAt(cam.eye, cam.target, cam.up);
    let proj;
    if (cam.projection === 'orthographic') {
      const h = cam.orthoHeight / 2, w = h * aspect;
      proj = mat4.orthographic(-w, w, -h, h, cam.near, cam.far);
    } else {
      proj = mat4.perspective(cam.fovY, aspect, cam.near, cam.far);
    }
    return { matrix: mat4.multiply(proj, view), fallback: false };
  } catch (e) {
    if (!(e instanceof NotImplemented)) throw e;
    return { matrix: fitMatrix(aspect, paintingAspect), fallback: true, missing: e.message };
  }
}

/**
 * Placeholder used until Part C works: scales the painting quad (height 2,
 * width 2·paintingAspect, centred at the origin in the z = 0 plane) to fit
 * the canvas, and maps world z to depth so that +z is in front.
 * There is no camera here — do not build on this.
 */
function fitMatrix(aspect, paintingAspect) {
  const s = 0.92 * Math.min(1, aspect / paintingAspect);
  return new Float32Array([
    s / aspect, 0, 0, 0,
    0, s, 0, 0,
    0, 0, -0.05, 0,
    0, 0, 0.5, 1,
  ]);
}

/* ------------------------------------------------- orbit controls ------- */
/* Quaternion orbit (bonus): the eye's offset from the target is rotated by a  */
/* quaternion — about the world y axis (azimuth), then about the camera's own  */
/* right axis (elevation). Elevation is clamped short of the poles so the      */
/* camera never rolls over the top.                                            */

const MAX_ELEVATION = (89 * Math.PI) / 180;

/** The camera's orientation as a quaternion: the rotation with columns s, u, −f (rows of V). */
export function orientation(cam) {
  const V = mat4.lookAt(cam.eye, cam.target, cam.up);
  return quat.fromBasis([V[0], V[4], V[8]], [V[1], V[5], V[9]], [V[2], V[6], V[10]]);
}

/** Rotate around the target (angles in radians). */
export function orbit(cam, dAzimuth, dElevation) {
  cam.transition = null; // the user takes over
  const off = vec3.sub(cam.eye, cam.target);
  const r = vec3.length(off) || 1e-6;
  const el = Math.asin(Math.max(-1, Math.min(1, off[1] / r)));
  const dEl = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, el + dElevation)) - el;
  const V = mat4.lookAt(cam.eye, cam.target, cam.up);
  const right = [V[0], V[4], V[8]];
  // about `right`, a positive angle swings the eye DOWN (+z → −y), so use −dEl
  const q = quat.multiply(quat.fromAxisAngle([0, 1, 0], dAzimuth), quat.fromAxisAngle(right, -dEl));
  cam.eye = vec3.add(cam.target, quat.rotate(q, off));
  cam.up = [0, 1, 0];
}

/**
 * Zoom by `factor` (< 1 = closer). Perspective: move the eye along the view
 * ray (dolly). Orthographic: moving does not change the image size, so the
 * visible height shrinks instead.
 */
export function zoom(cam, factor) {
  cam.transition = null;
  if (cam.projection === 'orthographic') {
    cam.orthoHeight = Math.max(0.05, Math.min(50, cam.orthoHeight * factor));
    return;
  }
  const off = vec3.sub(cam.eye, cam.target);
  const r = Math.max(0.15, Math.min(8, vec3.length(off) * factor));
  cam.eye = vec3.add(cam.target, vec3.scale(vec3.normalize(off), r));
}

/** Slide eye and target sideways / up by a fraction of the view (NDC units). */
export function pan(cam, dxNdc, dyNdc, aspect) {
  cam.transition = null;
  // the camera's own right / up axes are the first two rows of V (also in the top view)
  const V = mat4.lookAt(cam.eye, cam.target, cam.up);
  const right = [V[0], V[4], V[8]], up = [V[1], V[5], V[9]];
  const halfH = cam.projection === 'orthographic'
    ? cam.orthoHeight / 2
    : vec3.length(vec3.sub(cam.target, cam.eye)) * Math.tan(cam.fovY / 2);
  const move = vec3.add(vec3.scale(right, -dxNdc * halfH * aspect), vec3.scale(up, -dyNdc * halfH));
  cam.eye = vec3.add(cam.eye, move);
  cam.target = vec3.add(cam.target, move);
}

/** Preset views (Part C): eye positions around the default target. */
export const VIEWS = {
  front: { eye: [0, 0, 2.8], up: [0, 1, 0] },
  'three-quarter': { eye: [1.9, 0.9, 1.9], up: [0, 1, 0] },
  side: { eye: [2.8, 0, 0], up: [0, 1, 0] },
  // straight down: up is parallel to the view direction on purpose — lookAt's fallback handles it
  top: { eye: [0, 2.8, 0], up: [0, 1, 0] },
};

/**
 * Go to a preset view. With `animate`, the camera flies there: the target and
 * the distance are interpolated linearly and the ORIENTATION by quaternion slerp,
 * so the camera turns at a steady rate along the shortest arc (no gimbal
 * problems, even into the straight-down "top" view).
 */
export function setView(cam, name, animate = true) {
  const v = VIEWS[name];
  const to = { eye: [...v.eye], target: [0, 0, 0], up: [...v.up] };
  if (!animate) { Object.assign(cam, to); cam.transition = null; return; }
  const dist = (c) => vec3.length(vec3.sub(c.eye, c.target));
  cam.transition = {
    t: 0,
    duration: 0.9,
    from: { q: orientation(cam), target: [...cam.target], d: dist(cam) },
    to: { q: orientation(to), target: to.target, d: dist(to) },
  };
}

/** Advance a running view transition by dt seconds (call once per frame). */
export function updateCamera(cam, dt) {
  const tr = cam.transition;
  if (!tr) return;
  tr.t = Math.min(1, tr.t + dt / tr.duration);
  const k = tr.t * tr.t * (3 - 2 * tr.t); // smoothstep: ease in and out
  const q = quat.slerp(tr.from.q, tr.to.q, k);
  const target = tr.from.target.map((x, i) => x + (tr.to.target[i] - x) * k);
  const d = tr.from.d + (tr.to.d - tr.from.d) * k;
  // the camera's +z axis points from the target back to the eye
  cam.target = target;
  cam.eye = vec3.add(target, vec3.scale(quat.rotate(q, [0, 0, 1]), d));
  cam.up = quat.rotate(q, [0, 1, 0]);
  if (tr.t >= 1) cam.transition = null;
}

/**
 * The second, fixed "inspection" camera (Part C): it looks at the scene from
 * the side and behind, far enough out to see the main camera and its frustum.
 */
export function createInspectionCamera() {
  return {
    ...createCamera(),
    eye: [3.6, 2.4, 5.0],
    target: [0, -0.1, 1.0],
    fovY: (50 * Math.PI) / 180,
    far: 200,
  };
}

/**
 * Edges of a camera's view frustum in WORLD space, as [a, b] segments.
 * The eight corners are easy in VIEW space — the near and far rectangles at
 * z = −near and z = −far, of half-height d·tan(fov/2) (perspective) or
 * orthoHeight/2 (orthographic) — and V⁻¹ = invertRigid(V) carries them out.
 * `section` is the same rectangle at the target's distance: what fills the
 * screen at the depth of the painting.
 */
export function frustumLines(cam, aspect) {
  const toWorld = mat4.invertRigid(mat4.lookAt(cam.eye, cam.target, cam.up));
  const rect = (d) => {
    const h = cam.projection === 'orthographic' ? cam.orthoHeight / 2 : d * Math.tan(cam.fovY / 2);
    const w = h * aspect;
    return [[-w, -h], [w, -h], [w, h], [-w, h]]
      .map(([x, y]) => mat4.transformVec4(toWorld, [x, y, -d, 1]).slice(0, 3));
  };
  const n = rect(cam.near), f = rect(cam.far);
  const section = rect(vec3.length(vec3.sub(cam.target, cam.eye)));
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    lines.push([n[i], n[j]], [f[i], f[j]], [n[i], f[i]]);
  }
  return { lines, near: n, far: f, section };
}

/* ----------------------------------------------------- picking ---------- */

/**
 * World-space ray through a point of the screen (ndc x, y ∈ [−1, 1], +y up):
 * build the ray in VIEW space from the projection's parameters, then map it
 * to world space with V⁻¹. V = lookAt(…) is rigid, so V⁻¹ = invertRigid(V).
 *   perspective:  from the eye through (x·tan(fov/2)·aspect, y·tan(fov/2), −1)
 *   orthographic: from (x·w/2, y·h/2, 0) straight down −z
 */
export function screenRay(cam, aspect, ndc) {
  const toWorld = mat4.invertRigid(mat4.lookAt(cam.eye, cam.target, cam.up));
  let origin, dir;
  if (cam.projection === 'orthographic') {
    const h = cam.orthoHeight / 2;
    origin = [ndc[0] * h * aspect, ndc[1] * h, 0, 1];
    dir = [0, 0, -1, 0];
  } else {
    const t = Math.tan(cam.fovY / 2);
    origin = [0, 0, 0, 1];
    dir = [ndc[0] * t * aspect, ndc[1] * t, -1, 0];
  }
  return {
    origin: mat4.transformVec4(toWorld, origin).slice(0, 3),
    dir: vec3.normalize(mat4.transformVec4(toWorld, dir).slice(0, 3)),
  };
}

/** Where a ray meets the plane z = zPlane, or null if it is parallel or behind. */
export function intersectZPlane(ray, zPlane = 0) {
  if (Math.abs(ray.dir[2]) < 1e-9) return null;
  const t = (zPlane - ray.origin[2]) / ray.dir[2];
  return t > 0 ? vec3.add(ray.origin, vec3.scale(ray.dir, t)) : null;
}

/** World point → CSS pixels on the canvas (null if behind the camera). */
export function toScreen(viewProj, p, width, height) {
  const [x, y, , w] = mat4.transformVec4(viewProj, [p[0], p[1], p[2] ?? 0, 1]);
  if (w <= 0) return null;
  return [((x / w + 1) / 2) * width, ((1 - y / w) / 2) * height];
}
