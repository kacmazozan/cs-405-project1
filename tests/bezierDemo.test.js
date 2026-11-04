// The single-Bézier / de Casteljau demo (src/scene/bezierDemo.js), run without a
// browser: a stub panel records the controls, a stub canvas gives the size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBezierDemo } from '../src/scene/bezierDemo.js';
import { createCamera, viewProjection, toScreen } from '../src/scene/camera.js';
import { cubicBezier } from '../src/math/curves.js';
import { closeArr } from './helpers.js';

function stubPanel() {
  const texts = [], selects = [];
  const folder = {
    slider: () => ({ update() {} }),
    toggle: () => ({ update() {} }),
    select: (label, options, value, onChange) => { selects.push(onChange); return { set() {} }; },
    note() {}, button() {},
    text: () => { const t = { value: '', set(s) { t.value = s; } }; texts.push(t); return t; },
  };
  return { panel: { folder: () => folder }, texts, selects };
}

function setup() {
  const { panel, texts, selects } = stubPanel();
  const camera = createCamera(), aspect = 1.6;
  const view = { camera, aspect, viewProj: viewProjection(camera, aspect).matrix, canvas: { clientWidth: 1600, clientHeight: 1000 } };
  const painting = { aspect: 1280 / 893, size: [1280, 893] };
  const demo = createBezierDemo({ panel, painting, view, paintingId: 'kavunlu' });
  return { demo, view, texts, selects };
}

test('readout: Bernstein and de Casteljau agree, tangent = 3 · level-2 segment', () => {
  const { demo, texts } = setup();
  demo.update(0);
  const info = texts[0].value;
  assert.match(info, /de Casteljau/);
  assert.match(info, /matches/);
  const diff = Number(info.match(/difference\s+(\S+) px/)[1]);
  assert.ok(diff < 1e-9, `difference ${diff}`);
});

test('a control point can be picked on screen and dragged in the painting plane', () => {
  const { demo, view } = setup();
  const drawn = [];
  demo.drawOverlay({ polyline() {}, line() {}, point: (p) => drawn.push(p) });
  const P1 = drawn[drawn.length - 3]; // the last four points drawn are P0 … P3
  const s = toScreen(view.viewProj, P1, 1600, 1000);
  assert.equal(demo.pointerDown({ button: 0, px: s }), true);
  demo.pointerDrag({ ndc: [0.1, 0.2] });
  demo.pointerUp();
  // the moved point now sits under ndc (0.1, 0.2): redraw and check it projects there
  const again = [];
  demo.drawOverlay({ polyline() {}, line() {}, point: (p) => again.push(p) });
  // points are stored on the painting plane (z = 0) and only drawn slightly in front of it
  const moved = [...again[again.length - 3].slice(0, 2), 0];
  const ndc = toScreen(view.viewProj, moved, 2, 2).map((x, i) => (i === 0 ? x - 1 : 1 - x));
  closeArr(ndc, [0.1, 0.2], 1e-4);
});

test('"single Bézier only" hides the piecewise editor; "piecewise curve only" hides the demo', () => {
  const { demo, selects } = setup();
  assert.equal(demo.showsPiecewise, true);
  selects[0]('single Bézier only');
  assert.equal(demo.showsPiecewise, false);
  selects[0]('piecewise curve only');
  assert.equal(demo.pointerDown({ button: 0, px: [800, 500] }), false);
});

test('the kavunlu preset is the fitted top contour of the melon', () => {
  const { demo } = setup();
  const drawn = [];
  demo.drawOverlay({ polyline: (pts) => drawn.push(pts), line() {}, point() {} });
  const a = 1280 / 893;
  const P = [[0.301, 0.23], [0.429, 0.008], [0.78, 0.122], [0.867, 0.325]].map(([u, v]) => [(2 * u - 1) * a, 1 - 2 * v]);
  closeArr(drawn[0][32].slice(0, 2), cubicBezier(...P, 0.5), 1e-6); // the curve, 64 samples
});
