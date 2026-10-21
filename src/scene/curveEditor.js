/**
 * Part D — curves drawn over the painting: editing, display and export.
 *
 * Mouse (when "edit" is on):
 *   shift + click on the painting   add a control point (keep dragging to place it)
 *   drag a control point            move it (Bézier: C¹ is kept at every joint)
 *   alt + click a control point     delete it (Bézier: a handle deletes its anchor)
 *
 * Bonus: "freehand trace" turns a drag over the painting into a stroke and
 * fits a C¹ piecewise Bézier to it by least squares (math/fit.js); "swept
 * surface" revolves or extrudes the curve into a mesh (scene/sweep.js).
 *
 * Control points are picked in SCREEN space (project each point with P·V and
 * compare pixel distances) and placed in WORLD space (cast a ray through the
 * pixel and intersect the painting plane z = 0).
 */
import * as Curve from './curve.js';
import { curveToJSON, curveFromJSON, downloadJSON } from './curveExport.js';
import { deCasteljau } from '../math/curves.js';
import * as vec3 from '../math/vec3.js';
import { fitPiecewiseC1 } from '../math/fit.js';
import { sweepMesh, SWEEPS } from './sweep.js';
import { Mesh } from '../render/mesh.js';
import { SceneNode } from './node.js';
import { screenRay, intersectZPlane, toScreen } from './camera.js';
import { hex } from '../render/colour.js';

const LIFT = 0.004; // draw the curve just in front of the painting (no z-fighting)
const PICK_PX = 11;

const COL = {
  curve: hex('#ffd23f'),
  polygon: hex('#9aa3ad'),
  anchor: hex('#ffffff'),
  handle: hex('#45c8ef'),
  hover: hex('#ff6b6b'),
  levels: [hex('#9aa3ad'), hex('#2ecc71'), hex('#3fa9ff'), hex('#ff9f1c')],
  onCurve: hex('#ff3b5c'),
  tangent: hex('#f15bb5'),
};

const DEFAULTS = {
  edit: true,
  polygon: true,
  construction: true,
  tangent: true,
  follower: true,
  animate: true,
  constantSpeed: false,
  phase: 0.3,
  samples: 32,
  freehand: false,
  fitSegments: 5,
  sweep: false,
  sweepMode: SWEEPS[0],
  depth: 0.15,
};

export function createCurveEditor({ gpu, root, meshes, panel, painting, view, paintingId }) {
  const state = { ...DEFAULTS };
  const curves = new Map(); // painting id → curve, so each painting keeps its own
  let curve = null;
  let hover = -1, dragging = -1;
  let message = '';
  let stroke = null, drawing = false; // freehand trace (bonus)

  // An object that rides along the curve, oriented by the tangent (a scene-graph node).
  const follower = root.addChild(new SceneNode('curve follower'));
  follower.data = { mesh: meshes.cone, colour: [...hex('#ff3b5c'), 1], showAxes: true };

  // The swept surface (bonus), rebuilt whenever the curve or its settings change.
  const sweep = root.addChild(new SceneNode('swept surface'));
  sweep.data = { mesh: new Mesh(gpu.device, new Float32Array(0), 'swept surface'), colour: [...hex('#d6cf73'), 1], hidden: true, showAxes: true };
  let sweepKey = '';

  /* ---------------- panel ---------------- */
  const f = panel.folder('D · Curves');
  f.note('shift+click: add point · drag: move · alt+click: delete');
  const kindSel = f.select('kind', Curve.KINDS, 'bezier-c1', (k) => { Curve.convert(curve, k); refreshUI(); });
  // "closed" belongs to the current curve and needs setClosed() (Bézier adds / drops handles)
  const closedUI = { closed: false };
  const closedRow = f.toggle('closed', closedUI, 'closed', (v) => { Curve.setClosed(curve, v); refreshUI(); });
  const ui = [
    f.toggle('edit with the mouse', state, 'edit'),
    f.toggle('control polygon', state, 'polygon'),
    f.toggle('de Casteljau construction', state, 'construction'),
    f.toggle('tangent', state, 'tangent'),
    f.toggle('follower object', state, 'follower'),
    f.toggle('animate', state, 'animate'),
    f.toggle('constant speed (arc length)', state, 'constantSpeed'),
    f.slider('position', state, 'phase', 0, 1, 0.001),
    f.slider('samples / segment', state, 'samples', 2, 64, 1),
  ];
  const info = f.text();
  f.button('export JSON', () => {
    downloadJSON(curveToJSON(curve), `${curve.painting}-curve.json`);
  });
  f.button('import JSON', () => fileInput.click());
  f.button('reset curve', () => { setCurve(Curve.presetCurve(curve.painting, painting.aspect)); });
  f.button('clear', () => { curve.points = []; curve.closed = false; refreshUI(); });

  const bf = panel.folder('Bonus · fitting & surfaces');
  bf.note('freehand: drag over the painting, release → least-squares C¹ Bézier fit (ends close together → closed curve)');
  const bonusUI = [
    bf.toggle('freehand trace (fit on release)', state, 'freehand'),
    bf.slider('fit segments', state, 'fitSegments', 1, 12, 1),
    bf.toggle('swept surface from the curve', state, 'sweep'),
    bf.slider('extrude depth', state, 'depth', 0.02, 0.6, 0.01),
  ];
  const sweepSel = bf.select('sweep', SWEEPS, state.sweepMode, (v) => (state.sweepMode = v));

  /** Fit the finished stroke and make it the current curve. */
  function finishStroke() {
    drawing = false;
    if (!stroke || stroke.length < 8) { message = 'stroke too short to fit'; stroke = null; return; }
    let len = 0;
    for (let k = 1; k < stroke.length; k++) len += Math.hypot(stroke[k][0] - stroke[k - 1][0], stroke[k][1] - stroke[k - 1][1]);
    const last = stroke[stroke.length - 1];
    const closed = Math.hypot(last[0] - stroke[0][0], last[1] - stroke[0][1]) < 0.06 * len;
    const fit = fitPiecewiseC1(stroke, state.fitSegments, closed);
    curve.kind = 'bezier-c1';
    curve.closed = closed;
    curve.points = fit.points;
    refreshUI();
    const px = painting.size ? painting.size[1] / 2 : 1; // world units → painting pixels
    message = `least-squares fit: ${fit.segments} segment${fit.segments === 1 ? '' : 's'}, ` +
      `RMS error ${(fit.rms * px).toFixed(2)} px (${stroke.length} stroke points)`;
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const loaded = curveFromJSON(JSON.parse(await file.text()), painting.aspect);
      message = loaded.painting && loaded.painting !== curve.painting
        ? `loaded a curve made for "${loaded.painting}"` : `loaded ${file.name}`;
      loaded.painting = curve.painting;
      setCurve(loaded);
    } catch (e) {
      message = `import failed: ${e.message}`;
    }
  });

  function refreshUI() {
    kindSel.set(curve.kind);
    closedUI.closed = curve.closed;
    closedRow.update();
  }

  function setCurve(c) {
    curve = c;
    curves.set(c.painting, c);
    hover = dragging = -1;
    refreshUI();
  }

  function setPainting(id) {
    const c = curves.get(id) ?? Curve.presetCurve(id, painting.aspect);
    message = '';
    setCurve(c);
  }

  /* ---------------- geometry helpers ---------------- */
  const lift = (p, z = LIFT) => [p[0], p[1], z];

  /** Painting-plane point under the pointer, or null (outside the painting / parallel). */
  function planePoint(e, clampToPainting) {
    const hit = intersectZPlane(screenRay(view.camera, view.aspect, e.ndc), 0);
    if (!hit) return null;
    const a = painting.aspect;
    if (clampToPainting) return [Math.max(-a, Math.min(a, hit[0])), Math.max(-1, Math.min(1, hit[1]))];
    return Math.abs(hit[0]) <= a && Math.abs(hit[1]) <= 1 ? [hit[0], hit[1]] : null;
  }

  /** Index of the control point within PICK_PX of the pointer, or −1. */
  function pick(e) {
    const { canvas, viewProj } = view;
    let best = -1, bestD = PICK_PX;
    curve.points.forEach((p, i) => {
      const s = toScreen(viewProj, lift(p), canvas.clientWidth, canvas.clientHeight);
      if (!s) return;
      const d = Math.hypot(s[0] - e.px[0], s[1] - e.px[1]);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /** Current position on the curve: global parameter u from the "position" slider. */
  function currentU() {
    if (!state.constantSpeed) return state.phase;
    const table = Curve.arcLengthTable(curve);
    return Curve.uAtLength(table, state.phase * table.total);
  }

  setPainting(paintingId);

  return {
    get curve() { return curve; },
    setPainting,

    /* ---------------- pointer ---------------- */
    pointerDown(e) {
      if (state.freehand && e.button === 0) {
        const p = planePoint(e, false);
        if (!p) return false;
        stroke = [p];
        drawing = true;
        return true;
      }
      if (!state.edit || e.button !== 0) return false;
      const i = pick(e);
      if (i >= 0 && e.alt) {
        Curve.removePoint(curve, i);
        hover = -1;
        refreshUI();
        return true;
      }
      if (i >= 0) { dragging = i; return true; }
      if (e.shift) {
        const p = planePoint(e, false);
        if (!p) return false;
        dragging = Curve.addPoint(curve, p);
        return true;
      }
      return false;
    },
    pointerDrag(e) {
      if (drawing) {
        const p = planePoint(e, true), q = stroke[stroke.length - 1];
        if (p && Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.004) stroke.push(p);
        return;
      }
      if (dragging < 0) return;
      const p = planePoint(e, true);
      if (p) Curve.movePoint(curve, dragging, p);
    },
    pointerUp() {
      if (drawing) finishStroke();
      dragging = -1;
    },
    pointerMove(e) {
      hover = state.edit ? pick(e) : -1;
      view.canvas.style.cursor = hover >= 0 ? 'grab' : '';
    },

    /* ---------------- frame ---------------- */
    update(dt) {
      if (state.animate) {
        state.phase = (state.phase + dt * 0.06) % 1;
        ui[7].update();
      }
      const at = Curve.evaluate(curve, currentU());
      follower.data.hidden = !state.follower || !at;
      if (at) {
        // frame from the tangent: y axis along the curve (the cone points that way),
        // z axis = the painting's normal, x = y × z completes a right-handed basis
        let y = vec3.normalize([at.tangent[0], at.tangent[1], 0]);
        if (vec3.length(y) === 0) y = [1, 0, 0]; // a cusp (two equal control points)
        const z = [0, 0, 1];
        const x = vec3.cross(y, z);
        const s = 0.07;
        follower.local = new Float32Array([
          ...vec3.scale(x, s), 0,
          ...vec3.scale(y, s * 1.6), 0,
          ...vec3.scale(z, s), 0,
          at.point[0], at.point[1], 0.06, 1,
        ]);
      }

      const segs = Curve.segmentCount(curve);
      sweep.data.hidden = !state.sweep || segs === 0;
      if (!sweep.data.hidden) {
        const key = `${state.sweepMode}|${state.depth}|${curve.kind}|${curve.closed}|${curve.points.flat().join(',')}`;
        if (key !== sweepKey) {
          sweepKey = key;
          sweep.data.mesh.update(sweepMesh(Curve.sample(curve, 16), { mode: state.sweepMode, closed: curve.closed, depth: state.depth }));
        }
      }
      const err = curve.kind === 'bezier-c1' ? Curve.c1Error(curve) : 0;
      const uv = (p) => Curve.worldToUV(p, curve.aspect).map((x) => x.toFixed(3)).join(', ');
      const sel = dragging >= 0 ? dragging : hover;
      info.set(
        `${curve.kind}${curve.closed ? ' (closed)' : ''} · ${segs} segment${segs === 1 ? '' : 's'} · ${curve.points.length} points\n` +
        (curve.kind === 'bezier-c1' ? `C¹ joints: ${err < 1e-4 ? 'ok' : `off by ${err.toFixed(4)}`}\n` : `continuity: C${curve.kind === 'bspline' ? '²' : '¹'} by construction\n`) +
        (at ? `u = ${currentU().toFixed(3)} → segment ${at.index}, t = ${at.t.toFixed(3)}\n` : 'add points to start a curve\n') +
        (sel >= 0 ? `point ${sel} (${Curve.role(curve, sel)}): u,v = ${uv(curve.points[sel])}` : 'hover a point to see its (u, v)') +
        (message ? `\n${message}` : '')
      );
    },

    /** Queue this frame's curve drawing into the overlay. */
    drawOverlay(overlay) {
      const P = curve.points;
      // the freehand stroke (kept after the fit, to compare with the fitted curve)
      if (stroke && state.freehand) overlay.polyline(stroke.map((p) => lift(p, LIFT * 2)), hex('#ff5ad7'), 1.5);
      const bez = curve.kind === 'bezier-c1';

      // control polygon (Bézier: only the handle arms, anchor ↔ handle)
      if (state.polygon) {
        if (bez) {
          P.forEach((p, i) => {
            if (i % 3 === 0) return;
            const anchor = P[(i % 3 === 1 ? i - 1 : i + 1) % P.length];
            overlay.line(lift(anchor), lift(p), COL.polygon, 1.5);
          });
        } else {
          overlay.polyline(P.map((p) => lift(p)), COL.polygon, 1.5, false, curve.closed);
        }
      }

      // the curve itself
      const pts = Curve.sample(curve, state.samples).map((p) => lift(p, LIFT * 1.5));
      overlay.polyline(pts, COL.curve, 3);

      // the point at u, its tangent, and de Casteljau's construction on its segment
      const at = Curve.evaluate(curve, currentU());
      if (at) {
        if (state.construction) {
          const levels = deCasteljau(Curve.bezierOfSegment(curve.kind, at.segment), at.t);
          levels.forEach((lvl, k) => {
            if (k === 0 && bez) return; // already the control polygon
            const c = COL.levels[k % COL.levels.length];
            overlay.polyline(lvl.map((p) => lift(p)), c, 1.5, true);
            if (k < levels.length - 1) lvl.forEach((p) => overlay.point(lift(p), c, 7));
          });
        }
        if (state.tangent) {
          // dC/dt / 3: for a Bézier at t = 0 that is exactly the handle P1 − P0
          const tip = at.point.map((x, d) => x + at.tangent[d] / 3);
          overlay.line(lift(at.point), lift(tip), COL.tangent, 2.5, true);
          overlay.point(lift(tip), COL.tangent, 6);
        }
        overlay.point(lift(at.point), COL.onCurve, 11);
      }

      // control points last, on top of everything
      P.forEach((p, i) => {
        const handle = Curve.role(curve, i) === 'handle';
        const c = i === hover || i === dragging ? COL.hover : handle ? COL.handle : COL.anchor;
        overlay.point(lift(p), c, handle ? 9 : 12);
      });
    },

    reset() {
      Object.assign(state, DEFAULTS);
      ui.forEach((c) => c.update());
      bonusUI.forEach((c) => c.update());
      sweepSel.set(state.sweepMode);
      stroke = null;
    },
  };
}
