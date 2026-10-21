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
import { NotImplemented } from '../math/todo.js';

export function createCamera() {
  return {
    eye: [0, 0, 2.8],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fovY: Math.PI / 4, // radians
    // near/far bracket the scene tightly: depth precision is spent mostly
    // near the near plane, so near ≫ 0 and far / near small keep it usable
    near: 0.1,
    far: 20,
    projection: 'perspective', // or 'orthographic'
    orthoHeight: 2.2, // world units visible vertically in orthographic mode
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
/* The camera orbits its target on a sphere: eye = target + r·(cos φ sin θ,  */
/* sin φ, cos φ cos θ) with azimuth θ around +y and elevation φ.             */

const MAX_ELEVATION = (89 * Math.PI) / 180; // stop short of the poles: no sudden flip

function spherical(cam) {
  const off = vec3.sub(cam.eye, cam.target);
  const r = vec3.length(off) || 1e-6;
  return { r, azimuth: Math.atan2(off[0], off[2]), elevation: Math.asin(Math.max(-1, Math.min(1, off[1] / r))) };
}

function placeOnSphere(cam, r, azimuth, elevation) {
  const c = Math.cos(elevation);
  cam.eye = vec3.add(cam.target, vec3.scale([c * Math.sin(azimuth), Math.sin(elevation), c * Math.cos(azimuth)], r));
  cam.up = [0, 1, 0];
}

/** Rotate around the target (angles in radians). */
export function orbit(cam, dAzimuth, dElevation) {
  const { r, azimuth, elevation } = spherical(cam);
  const el = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, elevation + dElevation));
  placeOnSphere(cam, r, azimuth + dAzimuth, el);
}

/**
 * Zoom by `factor` (< 1 = closer). Perspective: move the eye along the view
 * ray (dolly). Orthographic: moving does not change the image size, so the
 * visible height shrinks instead.
 */
export function zoom(cam, factor) {
  if (cam.projection === 'orthographic') {
    cam.orthoHeight = Math.max(0.05, Math.min(50, cam.orthoHeight * factor));
    return;
  }
  const off = vec3.sub(cam.eye, cam.target);
  const r = Math.max(0.15, Math.min(15, vec3.length(off) * factor));
  cam.eye = vec3.add(cam.target, vec3.scale(vec3.normalize(off), r));
}

/** Slide eye and target sideways / up by a fraction of the view (NDC units). */
export function pan(cam, dxNdc, dyNdc, aspect) {
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

export function setView(cam, name) {
  const v = VIEWS[name];
  cam.target = [0, 0, 0];
  cam.eye = [...v.eye];
  cam.up = [...v.up];
}

/**
 * The second, fixed "inspection" camera (Part C): it looks at the scene from
 * the side and behind, far enough out to see the main camera and its frustum.
 */
export function createInspectionCamera() {
  return {
    ...createCamera(),
    eye: [5.2, 3.4, 6.2],
    target: [0, -0.1, 1.2],
    fovY: (50 * Math.PI) / 180,
    far: 200,
  };
}

/**
 * Edges of a camera's view frustum in WORLD space, as [a, b] segments.
 * The eight corners are easy in VIEW space — the near and far rectangles at
 * z = −near and z = −far, of half-height d·tan(fov/2) (perspective) or
 * orthoHeight/2 (orthographic) — and V⁻¹ = invertRigid(V) carries them out.
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
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    lines.push([n[i], n[j]], [f[i], f[j]], [n[i], f[i]]);
  }
  return { lines, near: n, far: f };
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
