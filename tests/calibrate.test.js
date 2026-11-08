// Tests for src/math/calibrate.js — recovering the painter's camera from
// vanishing points. The strategy is to build a KNOWN camera, project the
// edges of a known box through it, and check that the calibration gets the
// focal length and the box's axes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../src/math/mat4.js';
import * as vec3 from '../src/math/vec3.js';
import {
  lineThrough, meet, toAffine, vanishingPoint, focalFromVPs, directionOfVP,
  cameraFromVPs, horizonThrough, horizonTilt, fitWarnings, clipLineToBox, vpOfDirection,
} from '../src/math/calibrate.js';
import { close, closeArr } from './helpers.js';

/** The three columns of a rotation matrix: an orthonormal scene basis. */
function basis(ry, rx, rz) {
  const R = m.multiply(m.rotateY(ry), m.multiply(m.rotateX(rx), m.rotateZ(rz)));
  return [[R[0], R[1], R[2]], [R[4], R[5], R[6]], [R[8], R[9], R[10]]];
}

/** Point the direction away from the camera (−z), which is the same VP. */
const away = (d) => (d[2] > 0 ? d.map((x) => -x) : d);

/**
 * The image of the point `p` (world) in a camera at (0, 0, f) looking down −z,
 * on the painting plane z = 0: a straight pinhole projection.
 */
function project(p, f) {
  const s = f / (f - p[2]);
  return [p[0] * s, p[1] * s];
}

test('a vanishing point is where the images of two parallel scene lines meet', () => {
  const f = 2.5;
  const d = away(vec3.normalize([0.8, 0.15, -1]));
  // two parallel scene lines, each sampled at two points
  const segs = [[0.4, -0.3, -1.5], [-0.5, 0.2, -2.2]].map((o) =>
    [0.3, 2.4].map((s) => project(vec3.add(o, vec3.scale(d, s)), f)));
  const { point, atInfinity } = vanishingPoint(segs[0], segs[1]);
  assert.equal(atInfinity, false);
  closeArr(point, vpOfDirection(d, f), 1e-6);
  // and the VP really is the image of the direction itself
  closeArr(directionOfVP(point, f), d, 1e-6);
});

test('f² = −(v₁·v₂) recovers the focal length of perpendicular directions', () => {
  for (const f of [1.2, 2.0, 3.7, 8.0]) {
    const [b0, b1] = basis(0.55, 0.22, 0.1);
    const v1 = vpOfDirection(away(b0), f);
    const v2 = vpOfDirection(away(b1), f);
    const fit = focalFromVPs(v1, v2);
    assert.ok(fit.ok, fit.reason);
    close(fit.f, f, 1e-6); // the basis comes from Float32Array rotations
  }
});

test('cameraFromVPs recovers the focal length, the fov and the scene axes', () => {
  const f = 2.8;
  const B = basis(0.6, 0.25, -0.15);
  const v1 = vpOfDirection(away(B[0]), f);
  const v2 = vpOfDirection(away(B[2]), f);

  const cam = cameraFromVPs(v1, v2);
  assert.ok(cam.ok, cam.reason);
  close(cam.f, f, 1e-6);
  close(cam.fovY, 2 * Math.atan(1 / cam.f), 1e-15); // half-height 1 at distance f
  close(cam.fovY, 2 * Math.atan(1 / f), 1e-6);
  closeArr(cam.eye, [0, 0, cam.f], 1e-15); // the eye sits on the painting's normal, at f
  closeArr(cam.eye, [0, 0, f], 1e-6);
  close(cam.orthoResidual, 0, 1e-9);

  // the recovered axes are the two marked directions and their normal
  closeArr(cam.axes[0], away(B[0]), 1e-6);
  closeArr(cam.axes[1], away(B[2]), 1e-6);
  closeArr(cam.axes[2], vec3.cross(cam.axes[0], cam.axes[1]), 1e-9);
  for (const d of cam.axes) close(vec3.length(d), 1, 1e-12);
});

test('the matched camera reproduces the painting: its P·V maps the quad onto the screen', () => {
  const f = 3.1;
  const B = basis(0.4, 0.3, 0);
  const cam = cameraFromVPs(vpOfDirection(away(B[0]), f), vpOfDirection(away(B[2]), f));
  assert.ok(cam.ok, cam.reason);

  // half-height 1 at distance f must fill the frame vertically
  const V = m.lookAt(cam.eye, [0, 0, 0], [0, 1, 0]);
  const P = m.perspective(cam.fovY, 1, 0.1, 10);
  const PV = m.multiply(P, V);
  for (const [p, want] of [[[0, 1, 0], 1], [[0, -1, 0], -1]]) {
    const c = m.transformVec4(PV, [...p, 1]);
    close(c[1] / c[3], want, 1e-6);
  }

  // and a point in front of the painting projects where the pinhole puts it
  const q = [0.3, -0.2, 0.7];
  const c = m.transformVec4(PV, [...q, 1]);
  closeArr([c[0] / c[3], c[1] / c[3]], project(q, f), 1e-6);
});

test('vanishing points on the same side of the principal point are rejected', () => {
  // both to the left: no real f can make two perpendicular directions fit
  const fit = focalFromVPs([-40, 0.3], [-0.6, 0.1]);
  assert.equal(fit.ok, false);
  assert.ok(fit.dot > 0);
  assert.match(fit.reason, /straddle/);
  const cam = cameraFromVPs([-40, 0.3], [-0.6, 0.1]);
  assert.equal(cam.ok, false);
  assert.equal(cam.eye, null);
});

test('parallel image lines give a vanishing point at infinity', () => {
  const a = [[-1, 0.2], [1, 0.2]];
  const b = [[-1, -0.5], [1, -0.5]];
  const vp = vanishingPoint(a, b);
  assert.equal(vp.atInfinity, true);
  assert.equal(vp.point, null);
  close(vp.homogeneous[2], 0, 1e-12);
});

test('the horizon passes through both vanishing points', () => {
  const v1 = [-3.2, 0.42], v2 = [1.1, 0.42];
  const h = horizonThrough(v1, v2);
  for (const v of [v1, v2]) close(h[0] * v[0] + h[1] * v[1] + h[2], 0, 1e-9);
  // a level camera (both VPs at the same height) has a horizontal horizon
  close(h[0], 0, 1e-9);
});

test('clipLineToBox returns the chord of the box, or null when it misses', () => {
  const box = [1.4, 1];
  const through = clipLineToBox(lineThrough([-5, 0.2], [5, 0.25]), ...box);
  assert.ok(through);
  for (const p of through) {
    assert.ok(Math.abs(p[0]) <= box[0] + 1e-6 && Math.abs(p[1]) <= box[1] + 1e-6);
  }
  close(Math.abs(through[0][0] - through[1][0]), 2 * box[0], 1e-9); // enters and leaves at the sides
  assert.equal(clipLineToBox(lineThrough([-5, 4], [5, 4]), ...box), null);
});

test('horizonTilt is zero for two vanishing points at the same height', () => {
  close(horizonTilt([-3, 0.4], [2, 0.4]), 0, 1e-12);
  close(horizonTilt([-1, 0], [1, 1]), 26.565, 1e-3);      // atan(1/2)
  close(horizonTilt([1, 1], [-1, 0]), 26.565, 1e-3);      // direction does not matter
  assert.ok(Math.abs(horizonTilt([0, -1], [0.001, 1])) <= 90);
});

test('fitWarnings flags a fit that is arithmetically fine but not a measurement', () => {
  const near = cameraFromVPs([-2.2, 0.3], [1.4, 0.3]);
  assert.ok(near.ok);
  assert.deepEqual(fitWarnings(near, [-2.2, 0.3], [1.4, 0.3]), []);

  // a vanishing point far out: nearly parallel marks, f barely determined
  const far = cameraFromVPs([-400, 0.3], [1.4, 0.3]);
  assert.ok(far.ok);
  assert.ok(fitWarnings(far, [-400, 0.3], [1.4, 0.3]).some((w) => /nearly parallel/.test(w)));

  // a steeply tilted horizon: the two pairs cannot both be level in the scene
  const tilted = cameraFromVPs([-2.2, 1.6], [1.4, -0.9]);
  assert.ok(tilted.ok);
  assert.ok(fitWarnings(tilted, [-2.2, 1.6], [1.4, -0.9]).some((w) => /tilted/.test(w)));

  // nothing to say about a fit that does not exist
  assert.deepEqual(fitWarnings(cameraFromVPs([-4, 0.3], [-1, 0.1]), [-4, 0.3], [-1, 0.1]), []);
});

test('meet / toAffine: two crossing lines meet where they cross', () => {
  const p = toAffine(meet(lineThrough([0, 0], [2, 2]), lineThrough([0, 2], [2, 0])));
  closeArr(p, [1, 1], 1e-12);
});
