/**
 * Mouse ↔ painting plane, shared by the curve editors (Part D).
 *
 *   planePoint: cast a ray through the pixel (scene/camera.js screenRay) and
 *               intersect it with the painting plane z = 0 → world (x, y).
 *   pickPoint:  project every control point with P·V and take the closest one
 *               within a few pixels — picking is done in SCREEN space, so the
 *               grab radius is the same at every zoom level.
 */
import { screenRay, intersectZPlane, toScreen } from './camera.js';

export const PICK_PX = 11;

/**
 * Painting-plane point under the pointer, or null.
 * @param {object} view    { camera, aspect } of the camera we render with
 * @param {number} a       painting aspect (the quad spans x ∈ [−a, a], y ∈ [−1, 1])
 * @param {number[]} ndc   pointer position in NDC
 * @param {boolean} clamp  true: clamp onto the painting; false: null outside it
 */
export function planePoint(view, a, ndc, clamp) {
  const hit = intersectZPlane(screenRay(view.camera, view.aspect, ndc), 0);
  if (!hit) return null;
  if (clamp) return [Math.max(-a, Math.min(a, hit[0])), Math.max(-1, Math.min(1, hit[1]))];
  return Math.abs(hit[0]) <= a && Math.abs(hit[1]) <= 1 ? [hit[0], hit[1]] : null;
}

/**
 * Index of the point closest to the pointer (CSS pixels `px`) within `radius`, or −1.
 * @param {object} view       { canvas, viewProj }
 * @param {number[][]} points world points [x, y] on the painting plane
 * @param {number} z          the height the points are drawn at
 */
export function pickPoint(view, points, px, z = 0, radius = PICK_PX) {
  const { canvas, viewProj } = view;
  let best = -1, bestD = radius;
  points.forEach((p, i) => {
    const s = toScreen(viewProj, [p[0], p[1], z], canvas.clientWidth, canvas.clientHeight);
    if (!s) return;
    const d = Math.hypot(s[0] - px[0], s[1] - px[1]);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
