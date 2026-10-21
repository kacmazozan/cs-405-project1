// Tests for the bonus parts: least-squares fitting, quaternions / view transitions, swept surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubicBezier } from '../src/math/curves.js';
import { fitCubicBezier, fitPiecewiseC1 } from '../src/math/fit.js';
import * as quat from '../src/math/quat.js';
import * as m from '../src/math/mat4.js';
import { createCamera, setView, updateCamera, VIEWS } from '../src/scene/camera.js';
import { c1Error } from '../src/scene/curve.js';
import { sweepMesh, SWEEPS } from '../src/scene/sweep.js';
import { close, closeArr } from './helpers.js';

test('least squares recovers the control points of a sampled Bézier', () => {
  const P = [[0, 0], [0.3, 1.2], [1.4, 1.1], [2, 0.2]];
  const pts = Array.from({ length: 40 }, (_, k) => cubicBezier(...P, (k / 39) ** 1.3)); // uneven spacing
  // alternating "solve, then re-project" converges linearly, so allow a small residual
  const fit = fitCubicBezier(pts, { iterations: 30 });
  fit.control.forEach((p, i) => closeArr(p, P[i], 2e-2));
  assert.ok(fit.rms < 1e-3, `rms ${fit.rms}`);
  assert.ok(fit.rms < fitCubicBezier(pts, { iterations: 0 }).rms / 10, 'Newton steps must improve the fit');
});

test('piecewise fit of a closed circle stroke is C¹ and close to the circle', () => {
  const stroke = Array.from({ length: 200 }, (_, k) => [Math.cos(2 * Math.PI * k / 200), Math.sin(2 * Math.PI * k / 200)]);
  stroke.push([1, 0]);
  const fit = fitPiecewiseC1(stroke, 4, true);
  assert.equal(fit.points.length, 12);
  close(c1Error({ kind: 'bezier-c1', closed: true, points: fit.points }), 0, 1e-9);
  assert.ok(fit.rms < 1e-3, `rms ${fit.rms}`); // a 4-segment Bézier circle is within ~3·10⁻⁴ of the true one
});

test('open piecewise fit keeps the stroke end points', () => {
  const stroke = Array.from({ length: 120 }, (_, k) => [k / 40, Math.sin(k / 20)]);
  const fit = fitPiecewiseC1(stroke, 3, false);
  assert.equal(fit.points.length, 10);
  closeArr(fit.points[0], stroke[0]);
  closeArr(fit.points[9], stroke[119]);
  close(c1Error({ kind: 'bezier-c1', closed: false, points: fit.points }), 0, 1e-9);
});

test('quaternion from a rotation matrix rotates like the matrix', () => {
  const R = m.multiply(m.rotateY(0.7), m.multiply(m.rotateX(-1.1), m.rotateZ(2.4)));
  const q = quat.fromBasis([R[0], R[1], R[2]], [R[4], R[5], R[6]], [R[8], R[9], R[10]]);
  const v = [0.3, -1.2, 0.8];
  closeArr(quat.rotate(q, v), m.transformVec4(R, [...v, 0]).slice(0, 3));
});

test('slerp: ends, unit length and constant angular speed', () => {
  const a = quat.fromAxisAngle([0, 1, 0], 0.2), b = quat.fromAxisAngle([0, 1, 0], 1.4);
  closeArr(quat.slerp(a, b, 0), a);
  closeArr(quat.slerp(a, b, 1), b);
  closeArr(quat.slerp(a, b, 0.5), quat.fromAxisAngle([0, 1, 0], 0.8));
  close(Math.hypot(...quat.slerp(a, b, 0.37)), 1);
});

test('a view transition ends exactly at the preset view (also the degenerate top view)', () => {
  for (const name of Object.keys(VIEWS)) {
    const cam = createCamera();
    cam.eye = [1, 0.5, 2]; cam.target = [0.2, 0, 0];
    setView(cam, name);
    for (let k = 0; k < 100; k++) updateCamera(cam, 0.05);
    assert.equal(cam.transition, null);
    const want = { ...cam, eye: VIEWS[name].eye, target: [0, 0, 0], up: VIEWS[name].up };
    closeArr(m.lookAt(cam.eye, cam.target, cam.up), m.lookAt(want.eye, want.target, want.up), 1e-4, name);
  }
});

test('swept surfaces: whole triangles, finite unit normals', () => {
  const ellipse = Array.from({ length: 41 }, (_, k) => [0.6 * Math.cos(2 * Math.PI * k / 40), 0.3 * Math.sin(2 * Math.PI * k / 40)]);
  for (const mode of SWEEPS) {
    const data = sweepMesh(ellipse, { mode, closed: true, slices: 24 });
    assert.ok(data.length > 0 && data.length % 18 === 0, mode);
    for (let i = 0; i < data.length; i += 6) {
      for (let j = 0; j < 6; j++) assert.ok(Number.isFinite(data[i + j]));
      close(Math.hypot(data[i + 3], data[i + 4], data[i + 5]), 1, 1e-4);
    }
  }
});
