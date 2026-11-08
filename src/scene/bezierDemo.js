/**
 * Part D — ONE Bézier curve and de Casteljau's construction at an adjustable t.
 *
 * The project asks for a CUBIC Bézier: degree 3, four control points P0 … P3
 * (drag them with the mouse). A quadratic one (degree 2, three points) can be
 * chosen too, to compare: a Bézier of degree n always has n + 1 control points.
 * At the parameter t the panel shows both ways of evaluating the curve:
 *
 *   Bernstein form    B(t) = Σ Bᵢ,ₙ(t)·Pᵢ,  cubic: (1−t)³P0 + 3t(1−t)²P1 + 3t²(1−t)P2 + t³P3
 *   de Casteljau      repeated linear interpolation at t (cubic):
 *                       level 0  P0 P1 P2 P3        (the control polygon)
 *                       level 1  3 points  Pᵢ¹ = lerp(Pᵢ, Pᵢ₊₁, t)
 *                       level 2  2 points  — the segment between them is tangent to the curve
 *                       level 3  1 point   = B(t)
 *
 * Both give the same point (the panel prints the difference), and the last
 * segment of the construction gives the tangent: B'(t) = n·(its end − its start).
 */
import { bernstein, bezier, bezierTangent, deCasteljau } from '../math/curves.js';
import { uvToWorld, worldToUV } from './curve.js';
import { planePoint, pickPoint } from './picking.js';
import { hex } from '../render/colour.js';

const LIFT = 0.006;

const COL = {
  curve: hex('#5ee7ff'),
  polygon: hex('#c9ced6'), // level 0
  middle: hex('#2ecc71'),  // levels 1 … n − 2
  last: hex('#3f8cff'),    // level n − 1: the tangent segment
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
export const DEGREES = ['cubic (4 points)', 'quadratic (3 points)'];

const DEFAULTS = { show: SHOW[0], degree: DEGREES[0], t: 0.35, animate: false, tangent: true };

const lerp = (a, b, s) => a.map((x, d) => x + (b[d] - x) * s);

/**
 * Degree elevation (exact): the quadratic Q0 Q1 Q2 is the same curve as the cubic
 * Q0, Q0 + ⅔(Q1 − Q0), Q2 + ⅔(Q1 − Q2), Q2.
 */
export function elevate([q0, q1, q2]) {
  return [[...q0], lerp(q0, q1, 2 / 3), lerp(q2, q1, 2 / 3), [...q2]];
}

/**
 * Back to a quadratic: the inverse of `elevate`, Q1 = (3(P1 + P2) − P0 − P3) / 4.
 * Exact for a cubic that came from a quadratic; otherwise the closest single middle point.
 */
export function reduce([p0, p1, p2, p3]) {
  return [[...p0], p0.map((_, d) => (3 * (p1[d] + p2[d]) - p0[d] - p3[d]) / 4), [...p3]];
}

export function createBezierDemo({ panel, painting, view, paintingId }) {
  const state = { ...DEFAULTS };
  const sets = new Map(); // painting id → its control points (world x, y)
  let P = null, currentId = paintingId;
  let hover = -1, dragging = -1, dir = 1;

  const wanted = () => (state.degree === DEGREES[0] ? 4 : 3); // number of control points
  const toDegree = (pts) => (pts.length === wanted() ? pts : pts.length === 4 ? reduce(pts) : elevate(pts));

  /* ---------------- panel ---------------- */
  const f = panel.folder('D · Bézier & de Casteljau');
  const showSel = f.select('on the painting', SHOW, state.show, (v) => (state.show = v));
  const degreeSel = f.select('degree', DEGREES, state.degree, (v) => {
    state.degree = v;
    P = toDegree(P);
    sets.set(currentId, P);
    hover = dragging = -1;
  });
  const ui = [
    f.slider('t', state, 't', 0, 1, 0.001),
    f.toggle('animate t', state, 'animate'),
    f.toggle('tangent at t', state, 'tangent'),
  ];
  f.note('drag the control points · grey: control polygon (level 0) · green: middle level · blue: last level (tangent at B(t)) · red: B(t)');
  const info = f.text();
  f.button('reset points', () => { P = preset(currentId); sets.set(currentId, P); });

  function preset(id) {
    return toDegree((PRESETS[id] ?? PRESETS.default).map((uv) => uvToWorld(uv, painting.aspect)));
  }

  function setPainting(id) {
    currentId = id;
    if (!sets.has(id)) sets.set(id, preset(id));
    P = toDegree(sets.get(id));
    sets.set(id, P);
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
      const t = state.t, n = P.length - 1;
      const b = bernstein(n, t);
      const bern = bezier(P, t);
      const levels = deCasteljau(P, t);
      const dc = levels[n][0];
      const tan = bezierTangent(P, t);
      const last = levels[n - 1];
      const viaLast = [n * (last[1][0] - last[0][0]), n * (last[1][1] - last[0][1])];
      const toPx = painting.size ? painting.size[1] / 2 : 1; // world units → painting pixels
      const sel = dragging >= 0 ? dragging : hover;
      info.set(
        `degree n = ${n}: ${n === 3 ? 'cubic' : 'quadratic'}, ${n + 1} control points\n` +
        `t = ${t.toFixed(3)}\n` +
        `Bernstein B0…B${n}: ${b.map((x) => x.toFixed(3)).join(' ')}\n` +
        `          sum = ${b.reduce((s, x) => s + x, 0).toFixed(3)}\n` +
        `Σ Bᵢ(t)·Pᵢ   u,v = (${fmt(bern)})\n` +
        `de Casteljau u,v = (${fmt(dc)})\n` +
        `difference   ${(Math.hypot(bern[0] - dc[0], bern[1] - dc[1]) * toPx).toExponential(1)} px\n` +
        `B'(t) = ${n}·(level-${n - 1} segment): ${Math.hypot(tan[0] - viaLast[0], tan[1] - viaLast[1]) < 1e-9 ? 'matches' : 'MISMATCH'}\n` +
        (sel >= 0 ? `P${sel}: u,v = (${fmt(P[sel])})` : 'hover a control point: its (u, v)')
      );
    },

    drawOverlay(overlay) {
      if (!visible()) return;
      const t = state.t, n = P.length - 1;
      const curve = Array.from({ length: 65 }, (_, k) => lift(bezier(P, k / 64)));
      overlay.polyline(curve, COL.curve, 3);

      // de Casteljau's levels 0 … n − 1, then the point B(t) = level n
      const levels = deCasteljau(P, t);
      levels.slice(0, n).forEach((lvl, k) => {
        const c = k === 0 ? COL.polygon : k === n - 1 ? COL.last : COL.middle;
        overlay.polyline(lvl.map((p) => lift(p)), c, k === 0 ? 1.5 : 2, true);
        if (k > 0) lvl.forEach((p) => overlay.point(lift(p), c, 8));
      });
      const bt = levels[n][0];
      if (state.tangent) {
        const d = bezierTangent(P, t);
        const tip = [bt[0] + d[0] / n, bt[1] + d[1] / n]; // B'(t)/n: the last level's segment
        overlay.line(lift(bt), lift(tip), COL.tangent, 2.5, true);
      }
      overlay.point(lift(bt), COL.point, 13);
      P.forEach((p, i) => {
        const c = i === hover || i === dragging ? COL.hover : i === 0 || i === n ? COL.end : COL.inner;
        overlay.point(lift(p), c, 13);
      });
    },

    reset() {
      Object.assign(state, DEFAULTS);
      ui.forEach((c) => c.update());
      showSel.set(state.show);
      degreeSel.set(state.degree);
      P = toDegree(P);
      sets.set(currentId, P);
      dir = 1;
    },
  };
}
