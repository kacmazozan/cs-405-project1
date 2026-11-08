/**
 * Bonus — matching the camera to the painting's own perspective.
 *
 * You mark two pairs of lines over the painting: group A is a pair that is
 * parallel in the painted SCENE, group B another pair, perpendicular to A in
 * the scene. Each pair meets at a vanishing point, and two vanishing points
 * of perpendicular directions fix the focal length (math/calibrate.js):
 *
 *      f² = −(v₁ · v₂),    fovY = 2·atan(1 / f),    eye = (0, 0, f)
 *
 * because the painting hangs as a quad of half-height 1 at z = 0, which makes
 * the painting's own plane an image plane with its principal point at the
 * origin. "match camera" puts the camera exactly there, so everything in
 * front of the painting is projected with the painter's own perspective.
 *
 * The lines are DRAGGED, not hard-coded: the numbers that go in the report
 * have to be measured off the picture, and where the painting does not
 * determine them the readout says so instead of printing a plausible-looking
 * focal length.
 *
 * The "aligned box" is the check: its edges run along the two recovered scene
 * directions, so once the camera is matched they must come out parallel to
 * the lines you marked. If they do not, the marks are wrong.
 */
import * as vec3 from '../math/vec3.js';
import {
  lineThrough, vanishingPoint, cameraFromVPs, horizonThrough, horizonTilt, fitWarnings, clipLineToBox,
} from '../math/calibrate.js';
import { uvToWorld, worldToUV } from './curve.js';
import { planePoint as hitPlane, pickPoint } from './picking.js';
import { SceneNode } from './node.js';
import { hex } from '../render/colour.js';

const LIFT = 0.008; // in front of the curves, so the marks stay visible

const COL = {
  a: hex('#ff9f1c'),
  b: hex('#4ad6ff'),
  extend: hex('#6b7280'),
  horizon: hex('#ffffff'),
  hover: hex('#ffffff'),
  box: hex('#9b5de5'),
};

/**
 * Starting marks, in normalised painting (u, v). They are somewhere to start
 * dragging from, not a measurement — `hint` says which features to put them
 * on for each painting.
 */
const GENERIC = {
  A: [[[0.10, 0.62], [0.90, 0.58]], [[0.10, 0.88], [0.90, 0.80]]],
  B: [[[0.22, 0.58], [0.14, 0.92]], [[0.80, 0.56], [0.88, 0.90]]],
};

const NEEDS_TWO_POINT = 'The method needs a TWO-POINT view: both directions have to run away from you. '
  + 'A direction that lies across the canvas has its vanishing point at infinity and fixes nothing.';

const GUIDES = {
  kavunlu: {
    // the stone slab is the only straight-edged thing in the picture
    A: [[[0.127, 0.489], [0.875, 0.506]], [[0.004, 0.773], [0.992, 0.896]]],
    B: [[[0.127, 0.489], [0.004, 0.773]], [[0.930, 0.512], [0.860, 0.900]]],
    hint: 'the stone slab. A: its two long edges (the back one, and the front where the top meets the dark '
      + 'face). B: the short edges — but only the left one is in the picture, and the slab is painted almost '
      + 'square-on, so B is nearly parallel to the canvas. Expect the warnings: this painting does not fix a '
      + 'focal length, and that is the honest result to report.',
  },
  'selim-turbesi': {
    A: [[[0.05, 0.895], [0.46, 0.975]], [[0.26, 0.845], [0.70, 0.885]]],
    B: [[[0.28, 0.855], [0.235, 0.905]], [[0.84, 0.860], [0.885, 0.920]]],
    hint: 'a doorway seen square-on: one-point perspective. A: two joints of the paved floor, which do '
      + 'recede. B: the threshold and the step behind it — but those run across the canvas, so B’s vanishing '
      + `point escapes to infinity. The clearest example of why ${NEEDS_TWO_POINT.toLowerCase()}`,
  },
  kabatas: {
    // the foreground quay is seen obliquely: its corner gives two receding directions
    A: [[[0.000, 0.862], [0.580, 0.850]], [[0.020, 0.825], [0.550, 0.818]]],
    B: [[[0.585, 0.852], [0.740, 0.985]], [[0.620, 0.838], [0.760, 0.955]]],
    hint: 'the best candidate of the five: the foreground quay is seen obliquely, so both of its horizontal '
      + 'directions recede. A: the quay’s front edge and the railing line above it. B: the quay’s side edge '
      + 'running down to the right, and the railing’s return. Drag all eight ends onto the paint, then read f.',
  },
  moda: {
    ...GENERIC,
    hint: 'A: the pier building’s base and its roof line. B: its two short sides. The building is small and '
      + 'far away, so the marks are nearly parallel and f comes out very sensitive — watch for the warning.',
  },
  'ormanda-karaca': {
    ...GENERIC,
    hint: 'a forest: no straight man-made edges, so there is nothing to mark. "v₁·v₂ > 0, no fit" is the '
      + 'honest answer here, not a number.',
  },
  default: {
    ...GENERIC,
    hint: `mark two pairs of lines that are parallel in the scene and perpendicular to one another. ${NEEDS_TWO_POINT}`,
  },
};

const DEFAULTS = { show: false, box: false, boxDist: 2.4, boxSize: 0.4 };

export function createCalibration({ root, meshes, panel, painting, view, camera, paintingId, onCameraChanged }) {
  const state = { ...DEFAULTS };
  const marks = new Map(); // painting id → { A, B, hint } in world (x, y)
  let current = paintingId;
  let G = null;
  let hover = -1, dragging = -1;
  let message = '';
  let fit = null; // this frame's solution, computed once in update()

  const box = root.addChild(new SceneNode('painting-aligned box'));
  box.data = { mesh: meshes.cube, colour: [...COL.box, 1], hidden: true, desc: 'axes from the vanishing points' };

  /* ---------------- panel ---------------- */
  const f = panel.folder('Bonus · painting camera', { open: false });
  const hintNote = f.note('');
  const ui = [
    f.toggle('show calibration lines', state, 'show', () => { hover = dragging = -1; }),
    f.toggle('aligned test box', state, 'box'),
    f.slider('box distance', state, 'boxDist', 0.5, 6, 0.05),
    f.slider('box size', state, 'boxSize', 0.05, 1.2, 0.01),
  ];
  f.note('drag the eight end points onto features of the painting — orange: one scene direction, blue: the perpendicular one.');
  const info = f.text();
  f.button('match camera to the painting', applyMatch);
  f.button('reset lines', () => { G = preset(current); marks.set(current, G); message = ''; });

  function preset(id) {
    const g = GUIDES[id] ?? GUIDES.default;
    const toWorld = (seg) => seg.map((p) => uvToWorld(p, painting.aspect));
    return { A: g.A.map(toWorld), B: g.B.map(toWorld), hint: g.hint };
  }

  function setPainting(id) {
    current = id;
    if (!marks.has(id)) marks.set(id, preset(id));
    G = marks.get(id);
    hintNote.textContent = G.hint;
    hover = dragging = -1;
    message = '';
  }
  setPainting(paintingId);

  /** The eight draggable end points, in storage order: A0a A0b A1a A1b B0a B0b B1a B1b. */
  const points = () => [...G.A[0], ...G.A[1], ...G.B[0], ...G.B[1]];
  const setPoint = (i, p) => {
    const group = i < 4 ? G.A : G.B;
    group[Math.floor((i % 4) / 2)][i % 2] = p;
  };

  /** Vanishing points of both groups and the camera they imply. */
  function solve() {
    const va = vanishingPoint(G.A[0], G.A[1]);
    const vb = vanishingPoint(G.B[0], G.B[1]);
    if (!va.point || !vb.point) {
      const which = va.point ? 'B' : 'A';
      return {
        va, vb,
        cam: { ok: false, reason: `group ${which}’s two lines are parallel on the canvas, so ${which} has no vanishing point` },
      };
    }
    return { va, vb, cam: cameraFromVPs(va.point, vb.point) };
  }

  function applyMatch() {
    const { cam } = solve();
    if (!cam.ok) { message = `cannot match: ${cam.reason}`; return; }
    camera.transition = null;
    camera.projection = 'perspective';
    camera.fovY = cam.fovY;
    camera.eye = [...cam.eye];
    camera.target = [0, 0, 0];
    camera.up = [0, 1, 0];
    // the depth bracket has to reach the new eye; keep it on the slider's whole-number grid
    camera.far = Math.max(camera.far, Math.ceil(cam.f * 2 + 4));
    onCameraChanged?.();
    message = `matched: fovY ${(cam.fovY * 180 / Math.PI).toFixed(2)}°, eye (0, 0, ${cam.f.toFixed(3)})`;
  }

  const lift = (p) => [p[0], p[1], LIFT];
  const uv = (p) => worldToUV(p, painting.aspect).map((x) => x.toFixed(3)).join(', ');

  return {
    setPainting,

    /* ---------------- pointer ---------------- */
    pointerDown(e) {
      if (!state.show || e.button !== 0) return false;
      const i = pickPoint(view, points(), e.px, LIFT);
      if (i < 0) return false;
      dragging = i;
      return true;
    },
    pointerDrag(e) {
      if (dragging < 0) return;
      const p = hitPlane(view, painting.aspect, e.ndc, true);
      if (p) setPoint(dragging, p);
    },
    pointerUp() { dragging = -1; },
    /** @returns {boolean} true when an end point is under the pointer */
    pointerMove(e) {
      hover = state.show ? pickPoint(view, points(), e.px, LIFT) : -1;
      return hover >= 0;
    },

    /* ---------------- frame ---------------- */
    update() {
      fit = solve();
      const { va, vb, cam } = fit;
      box.data.hidden = !state.show || !state.box || !cam.ok;

      if (!box.data.hidden) {
        // the box rides the ray through the middle of group A's first line,
        // oriented by the two recovered scene directions
        const anchor = vec3.scale(vec3.add([...G.A[0][0], 0], [...G.A[0][1], 0]), 0.5);
        const centre = vec3.add(cam.eye, vec3.scale(vec3.normalize(vec3.sub(anchor, cam.eye)), state.boxDist));
        const [d1, , d3] = cam.axes;
        const up = d3[1] >= 0 ? d3 : d3.map((x) => -x);         // the axis that points up on screen
        const right = d1[0] >= 0 ? d1 : d1.map((x) => -x);      // and the one that points right
        const fwd = vec3.cross(right, up);                      // right × up: a right-handed basis
        const s = state.boxSize;
        box.local = new Float32Array([
          ...vec3.scale(right, s), 0,
          ...vec3.scale(up, s), 0,
          ...vec3.scale(fwd, s), 0,
          ...vec3.add(centre, vec3.scale(up, s / 2)), 1,        // resting on the plane, not centred on it
        ]);
      }

      if (!state.show) { info.set('(off — turn on "show calibration lines")'); return; }
      const px = painting.size ? painting.size[1] / 2 : 1; // world units → painting pixels
      const out = [
        `A → ${va.point ? `VP (u,v) = (${uv(va.point)})` : 'the two lines are parallel on the canvas: VP at infinity'}`,
        `B → ${vb.point ? `VP (u,v) = (${uv(vb.point)})` : 'the two lines are parallel on the canvas: VP at infinity'}`,
      ];
      if (va.point && vb.point) {
        out.push(`v₁·v₂ = ${(va.point[0] * vb.point[0] + va.point[1] * vb.point[1]).toFixed(4)}   (must be < 0)`);
      }
      if (cam.ok) {
        out.push(
          `f = ${cam.f.toFixed(4)} half-heights = ${(cam.f * px).toFixed(0)} px`,
          `fovY = ${(cam.fovY * 180 / Math.PI).toFixed(2)}°`,
          `eye  = (0, 0, ${cam.f.toFixed(4)})`,
          `horizon tilt ${horizonTilt(va.point, vb.point).toFixed(2)}°`,
          `d₁ = ${cam.axes[0].map((x) => x.toFixed(3)).join(', ')}`,
          `d₂ = ${cam.axes[1].map((x) => x.toFixed(3)).join(', ')}`,
        );
        // a number is not a measurement: say when it should not be trusted
        for (const w of fitWarnings(cam, va.point, vb.point)) out.push(`! ${w}`);
      } else {
        out.push(`NO FIT — ${cam.reason}`);
      }
      const sel = dragging >= 0 ? dragging : hover;
      if (sel >= 0) out.push(`point ${sel} (group ${sel < 4 ? 'A' : 'B'}): u,v = (${uv(points()[sel])})`);
      if (message) out.push(message);
      info.set(out.join('\n'));
    },

    drawOverlay(overlay) {
      if (!state.show || !fit) return;
      const W = 3 * painting.aspect, H = 3; // extensions and the horizon are clipped to this box
      const { va, vb, cam } = fit;

      for (const [group, colour, v] of [[G.A, COL.a, va], [G.B, COL.b, vb]]) {
        for (const seg of group) {
          const ext = clipLineToBox(lineThrough(...seg), W, H);
          if (ext) overlay.line(lift(ext[0]), lift(ext[1]), COL.extend, 1, true); // towards the VP
          overlay.line(lift(seg[0]), lift(seg[1]), colour, 3, true);              // the marked part
        }
        if (v.point && Math.abs(v.point[0]) <= W && Math.abs(v.point[1]) <= H) {
          overlay.point(lift(v.point), colour, 14);
        }
      }

      if (cam.ok) {
        const h = clipLineToBox(horizonThrough(va.point, vb.point), W, H);
        if (h) overlay.line(lift(h[0]), lift(h[1]), COL.horizon, 1.5, true);
      }

      points().forEach((p, i) => {
        overlay.point(lift(p), i === hover || i === dragging ? COL.hover : i < 4 ? COL.a : COL.b, 11);
      });
    },

    reset() {
      Object.assign(state, DEFAULTS);
      ui.forEach((c) => c.update());
      marks.set(current, preset(current));
      G = marks.get(current);
      hover = dragging = -1;
      message = '';
      fit = null;
    },
  };
}
