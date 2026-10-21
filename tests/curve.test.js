// Extra tests for the curve editor's model (src/scene/curve.js) and export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Curve from '../src/scene/curve.js';
import { curveToJSON, curveFromJSON } from '../src/scene/curveExport.js';
import { close, closeArr } from './helpers.js';

const A = 1.4;

test('presets are C¹ and closed where intended', () => {
  const c = Curve.presetCurve('kavunlu', A);
  assert.equal(c.closed, true);
  assert.equal(Curve.segmentCount(c), 5);
  close(Curve.c1Error(c), 0, 1e-9);
});

test('moving a handle keeps the joint C¹', () => {
  const c = Curve.presetCurve('other', A);
  Curve.movePoint(c, 2, [0.3, 0.9]);
  Curve.movePoint(c, 3, [0.1, -0.2]);
  close(Curve.c1Error(c), 0, 1e-9);
});

test('add / remove keep the A H H A layout', () => {
  const c = Curve.presetCurve('other', A);
  Curve.addPoint(c, [1, 0.5]);
  assert.equal((c.points.length - 1) % 3, 0);
  close(Curve.c1Error(c), 0, 1e-9);
  Curve.removePoint(c, 3);
  assert.equal((c.points.length - 1) % 3, 0);
});

test('Catmull–Rom → Bézier conversion is exact', () => {
  const c = { painting: 'x', aspect: A, kind: 'catmull-rom', closed: false, points: [[0, 0], [0.5, 0.4], [1, -0.2], [1.3, 0.3], [1.2, 0.8]] };
  const before = Curve.sample(c, 8);
  Curve.convert(c, 'bezier-c1');
  Curve.sample(c, 8).forEach((p, i) => closeArr(p, before[i], 1e-9));
});

test('JSON export uses (u, v) and round-trips', () => {
  const c = Curve.presetCurve('kavunlu', A);
  const json = curveToJSON(c);
  assert.equal(json.kind, 'bezier-c1');
  closeArr(json.segments[0][0], [0.186, 0.632], 1e-4);
  const back = curveFromJSON(json, A);
  assert.equal(back.closed, true);
  back.points.forEach((p, i) => closeArr(p, c.points[i], 1e-3));
});

test('closed spline export is unrolled so an open evaluation reproduces it', () => {
  const c = { painting: 'x', aspect: A, kind: 'bspline', closed: true, points: [[0, 0], [1, 0], [1, 1], [0, 1]] };
  const json = curveToJSON(c);
  assert.equal(json.points.length, 7);
  const open = curveFromJSON(json, A);
  Curve.sample(open, 4).forEach((p, i) => closeArr(p, Curve.sample(c, 4)[i], 1e-3));
});
