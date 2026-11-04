/**
 * Part D — ONE cubic Bézier and de Casteljau's construction at an adjustable t.
 *
 * The curve has four control points P0 … P3 on the painting (drag them with
 * the mouse). At the parameter t the panel shows both ways of evaluating it:
 *
 *   Bernstein form    B(t) = (1−t)³P0 + 3t(1−t)²P1 + 3t²(1−t)P2 + t³P3
 *   de Casteljau      repeated linear interpolation at t:
 *                       level 0  P0 P1 P2 P3        (the control polygon)
 *                       level 1  3 points  Pᵢ¹ = lerp(Pᵢ, Pᵢ₊₁, t)
 *                       level 2  2 points  — the segment between them is tangent to the curve
 *                       level 3  1 point   = B(t)
 *
 * Both give the same point (the panel prints the difference), and the level-2
 * segment gives the tangent: B'(t) = 3·(level-2 end − level-2 start).
 */
import { bernstein3, cubicBezier, cubicBezierTangent, deCasteljau } from '../math/curves.js';
import { uvToWorld, worldToUV } from './curve.js';
import { planePoint, pickPoint } from './picking.js';
import { hex } from '../render/colour.js';

const LIFT = 0.006;

const COL = {
  curve: hex('#5ee7ff'),
  levels: [hex('#c9ced6'), hex('#2ecc71'), hex('#3f8cff')], // level 0, 1, 2
  point: hex('#ff3b5c'),
  tangent: hex('#f15bb5'),
  end: hex('#ffffff'),
  inner: hex('#5ee7ff'),
  hover: hex('#ff6b6b'),
};

/**
 * Starting control points in normalised painting (u, v). kavunlu: the top
 * contour of the whole melon — these are a least-squares fit (math/fit.js)
 * to points read off the image, RMS error ≈ 1.4 px.
 */
const PRESETS = {
  kavunlu: [[0.301, 0.23], [0.429, 0.008], [0.78, 0.122], [0.867, 0.325]],
  default: [[0.22, 0.4], [0.32, 0.12], [0.68, 0.12], [0.78, 0.4]],
};

export const SHOW = ['both', 'single Bézier only', 'piecewise curve only'];

const DEFAULTS = { show: SHOW[0], t: 0.35, animate: false, tangent: true };

export function createBezierDemo({ panel, painting, view, paintingId }) {
  const state = { ...DEFAULTS };
  const sets = new Map(); // painting id → its four control points (world x, y)
  let P = null, currentId = paintingId;
  let hover = -1, dragging = -1, dir = 1;

  /* ---------------- panel ---------------- */
  const f = panel.folder('D · Bézier & de Casteljau');
  const showSel = f.select('on the painting', SHOW, state.show, (v) => (state.show = v));
  const ui = [
    f.slider('t', state, 't', 0, 1, 0.001),
    f.toggle('animate t', state, 'animate'),
    f.toggle('tangent at t', state, 'tangent'),
  ];
  f.note('drag P0…P3 · grey: control polygon (level 0) · green: level 1 · blue: level 2 (tangent at B(t)) · red: B(t)');
  const info = f.text();
  f.button('reset points', () => { P = preset(currentId); sets.set(currentId, P); });

  function preset(id) {
    return (PRESETS[id] ?? PRESETS.default).map((uv) => uvToWorld(uv, painting.aspect));
  }

  function setPainting(id) {
    currentId = id;
    if (!sets.has(id)) sets.set(id, preset(id));
    P = sets.get(id);
    hover = dragging = -1;
  }
  setPainting(paintingId);

  const visible = () => state.show !== 'piecewise curve only';
  const lift = (p, z = LIFT) => [p[0], p[1], z];
  const fmt = (p) => worldToUV(p, painting.aspect).map((x) => x.toFixed(3)).join(', ');

  return {
    setPainting,
    /** Whether the piecewise curve editor should be shown too. */
    get showsPiecewise() { return state.show !== 'single Bézier only'; },

    pointerDown(e) {
      if (!visible() || e.button !== 0) return false;
      const i = pickPoint(view, P, e.px, LIFT);
      if (i < 0) return false;
      dragging = i;
      return true;
    },
    pointerDrag(e) {
      if (dragging < 0) return;
      const p = planePoint(view, painting.aspect, e.ndc, true);
      if (p) P[dragging] = p;
    },
    pointerUp() { dragging = -1; },
    /** @returns {boolean} true when a point is under the pointer */
    pointerMove(e) {
      hover = visible() ? pickPoint(view, P, e.px, LIFT) : -1;
      return hover >= 0;
    },

    update(dt) {
      if (state.animate) {
        // ping-pong 0 → 1 → 0, so the construction can be watched in both directions
        state.t += dir * dt * 0.25;
        if (state.t > 1) { state.t = 1; dir = -1; }
        if (state.t < 0) { state.t = 0; dir = 1; }
        ui[0].update();
      }
      if (!visible()) { info.set('(hidden — choose "both" or "single Bézier only")'); return; }
      const t = state.t;
      const b = bernstein3(t);
      const bern = cubicBezier(...P, t);
      const levels = deCasteljau(P, t);
      const dc = levels[3][0];
      const tan = cubicBezierTangent(...P, t);
      const l2 = levels[2];
      const viaL2 = [3 * (l2[1][0] - l2[0][0]), 3 * (l2[1][1] - l2[0][1])];
      const toPx = painting.size ? painting.size[1] / 2 : 1; // world units → painting pixels
      const sel = dragging >= 0 ? dragging : hover;
      info.set(
        `t = ${t.toFixed(3)}\n` +
        `Bernstein  B0 ${b[0].toFixed(3)}  B1 ${b[1].toFixed(3)}  B2 ${b[2].toFixed(3)}  B3 ${b[3].toFixed(3)}\n` +
        `           (sum = ${(b[0] + b[1] + b[2] + b[3]).toFixed(3)})\n` +
        `Σ Bᵢ(t)·Pᵢ      → u,v = (${fmt(bern)})\n` +
        `de Casteljau    → u,v = (${fmt(dc)})\n` +
        `difference      ${(Math.hypot(bern[0] - dc[0], bern[1] - dc[1]) * toPx).toExponential(1)} px\n` +
        `B'(t) = 3·(level-2 segment): ${Math.hypot(tan[0] - viaL2[0], tan[1] - viaL2[1]) < 1e-9 ? 'matches' : 'MISMATCH'} the derivative\n` +
        (sel >= 0 ? `P${sel}: u,v = (${fmt(P[sel])})` : 'hover a control point to see its (u, v)')
      );
    },

    drawOverlay(overlay) {
      if (!visible()) return;
      const t = state.t;
      const curve = Array.from({ length: 65 }, (_, k) => lift(cubicBezier(...P, k / 64)));
      overlay.polyline(curve, COL.curve, 3);

      const levels = deCasteljau(P, t);
      levels.slice(0, 3).forEach((lvl, k) => {
        overlay.polyline(lvl.map((p) => lift(p)), COL.levels[k], k === 0 ? 1.5 : 2, true);
        if (k > 0) lvl.forEach((p) => overlay.point(lift(p), COL.levels[k], 8));
      });
      const bt = levels[3][0];
      if (state.tangent) {
        const d = cubicBezierTangent(...P, t);
        const tip = [bt[0] + d[0] / 3, bt[1] + d[1] / 3];
        overlay.line(lift(bt), lift(tip), COL.tangent, 2.5, true);
      }
      overlay.point(lift(bt), COL.point, 13);
      P.forEach((p, i) => {
        const c = i === hover || i === dragging ? COL.hover : i === 0 || i === 3 ? COL.end : COL.inner;
        overlay.point(lift(p), c, 13);
      });
    },

    reset() {
      Object.assign(state, DEFAULTS);
      ui.forEach((c) => c.update());
      showSel.set(state.show);
      dir = 1;
    },
  };
}
