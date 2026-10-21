/**
 * Part A — objects in front of the painting (z > 0), placed with our mat4,
 * and an interactive T·R·S vs S·R·T demo.
 *
 * With column vectors, M = T·R·S applies S first, then R, then T: the object
 * is scaled and rotated about ITS OWN origin and then moved into place.
 * S·R·T moves it first, so the rotation swings the translated object around
 * the WORLD origin and the scale stretches the translation too.
 */
import * as mat4 from '../math/mat4.js';
import { SceneNode } from './node.js';
import { hex } from '../render/colour.js';

const ROTATE = { x: mat4.rotateX, y: mat4.rotateY, z: mat4.rotateZ };

/** T(t) · R · S(s) */
export function trs(t, R, s) {
  return mat4.multiply(mat4.translate(...t), mat4.multiply(R, mat4.scale(...s)));
}

/** S(s) · R · T(t) */
export function srt(t, R, s) {
  return mat4.multiply(mat4.scale(...s), mat4.multiply(R, mat4.translate(...t)));
}

const DEFAULTS = {
  tx: 0.6, ty: 0.5, tz: 0.55,
  axis: 'y', angle: 0.6,
  sx: 0.26, sy: 0.26, sz: 0.26,
  order: 'T·R·S',
  ghost: true,
  spin: true,
};

export function createObjects({ root, meshes, panel }) {
  const state = { ...DEFAULTS };
  const group = root.addChild(new SceneNode('objects'));

  const solid = (code) => [...hex(code), 1];
  const fixed = (name, local, mesh, colour) => {
    const n = group.addChild(new SceneNode(name, local));
    n.data = { mesh, colour: solid(colour), showAxes: true };
    return n;
  };

  // Three fixed objects, each placed with its own T·R·S.
  fixed('melon (ellipsoid)',
    trs([0.62, -0.72, 0.5], mat4.multiply(mat4.rotateZ(-0.25), mat4.rotateY(0.5)), [0.44, 0.24, 0.24]),
    meshes.sphere, '#c9b847');
  fixed('pedestal',
    trs([-0.3, -0.86, 0.85], mat4.identity(), [0.2, 0.14, 0.2]),
    meshes.cylinder, '#8e929b');
  fixed('cone',
    trs([-0.3, -0.64, 0.85], mat4.rotateY(0.3), [0.16, 0.3, 0.16]),
    meshes.cone, '#d9873a');

  // The T·R·S demo object and a see-through "ghost" with the other order.
  const demo = group.addChild(new SceneNode('T·R·S demo'));
  demo.data = { mesh: meshes.cube, colour: solid('#f07a4a'), showAxes: true };
  const ghost = group.addChild(new SceneNode('other order (ghost)'));
  ghost.data = { mesh: meshes.cube, colour: [...hex('#4aa3f0'), 0.35] };

  /* ---------------- panel ---------------- */
  const f = panel.folder('A · Transforms');
  f.note('The orange cube uses the chosen order; the blue ghost uses the other one.');
  const ui = [
    f.slider('translate x', state, 'tx', -1.5, 1.5, 0.01),
    f.slider('translate y', state, 'ty', -1, 1, 0.01),
    f.slider('translate z', state, 'tz', 0, 1.5, 0.01),
    f.slider('angle (rad)', state, 'angle', -Math.PI, Math.PI, 0.01),
    f.slider('scale x', state, 'sx', 0.05, 1, 0.01),
    f.slider('scale y', state, 'sy', 0.05, 1, 0.01),
    f.slider('scale z', state, 'sz', 0.05, 1, 0.01),
    f.toggle('spin (animate angle)', state, 'spin'),
    f.toggle('show other order', state, 'ghost'),
  ];
  const axisSel = f.select('rotation axis', ['x', 'y', 'z'], state.axis, (v) => (state.axis = v));
  const orderSel = f.select('order', ['T·R·S', 'S·R·T'], state.order, (v) => (state.order = v));
  f.note('T·R·S = T · R · S');
  const trsText = f.text();
  f.note('S·R·T = S · R · T');
  const srtText = f.text();

  return {
    node: group,

    update(dt) {
      if (state.spin) {
        state.angle = ((state.angle + dt * 0.8 + Math.PI) % (2 * Math.PI)) - Math.PI;
        ui[3].update();
      }
      const t = [state.tx, state.ty, state.tz], s = [state.sx, state.sy, state.sz];
      const R = ROTATE[state.axis](state.angle);
      const mTRS = trs(t, R, s), mSRT = srt(t, R, s);
      const first = state.order === 'T·R·S';
      demo.local = first ? mTRS : mSRT;
      ghost.local = first ? mSRT : mTRS;
      ghost.data.hidden = !state.ghost;
      trsText.set(mat4.format(mTRS));
      srtText.set(mat4.format(mSRT));
    },

    reset() {
      Object.assign(state, DEFAULTS);
      ui.forEach((c) => c.update());
      axisSel.set(state.axis);
      orderSel.set(state.order);
    },
  };
}
