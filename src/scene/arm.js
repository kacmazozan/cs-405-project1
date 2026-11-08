/**
 * Part B — a hierarchical model: a robot arm standing in front of the painting.
 *
 *   arm ─┬─ base
 *        └─ turret (yaw about y) ─┬─ turret mesh
 *                                 └─ shoulder (about z) ─┬─ shoulder joint, upper arm
 *                                                        └─ elbow (about z) ─┬─ elbow joint, forearm
 *                                                                            └─ wrist (about z) ─┬─ wrist joint, palm, tip
 *                                                                                                ├─ held fruit (carried)
 *                                                                                                ├─ finger L ── mesh
 *                                                                                                └─ finger R ── mesh
 *
 * Two kinds of nodes:
 *   • JOINT nodes (turret, shoulder, elbow, wrist, fingers) hold only rigid
 *     motion, local = T(offset from the parent joint) · R(angle). Children
 *     inherit them: world = parent.world · local.
 *   • MESH nodes are leaves that hold the scale which turns a unit cube /
 *     sphere into a link. Keeping the scale in a leaf stops it from
 *     stretching everything further down the chain.
 */
import * as mat4 from '../math/mat4.js';
import { SceneNode } from './node.js';
import { hex } from '../render/colour.js';
import { trs } from './objects.js';

const DEFAULTS = { animate: true, yaw: 0.5, shoulder: -0.45, elbow: -0.75, wrist: 0.45, grip: 0.3 };

const UPPER = 0.42, FORE = 0.34; // link lengths

export function createArm({ root, meshes, panel }) {
  const state = { ...DEFAULTS };
  const I = mat4.identity();
  const colour = {
    base: [...hex('#3b3f47'), 1],
    link: [...hex('#e3a72f'), 1],
    joint: [...hex('#d6d6d6'), 1],
    finger: [...hex('#c9483b'), 1],
    fruit: [...hex('#6d3a8e'), 1],
  };
  // `desc` is the local transform in words, shown in the panel's scene-graph readout
  const node = (parent, name, local = mat4.identity(), mesh = null, c = null, desc = '') => {
    const n = parent.addChild(new SceneNode(name, local));
    n.data = mesh ? { mesh, colour: c, desc } : { desc };
    return n;
  };

  const arm = node(root, 'arm', mat4.translate(-1.05, -0.9, 0.55), null, null, 'T(−1.05, −0.9, 0.55)');
  node(arm, 'base', trs([0, 0.04, 0], I, [0.34, 0.08, 0.34]), meshes.cylinder, colour.base, 'T·S');

  const turret = node(arm, 'turret');
  node(turret, 'turret mesh', trs([0, 0.07, 0], I, [0.16, 0.14, 0.16]), meshes.cylinder, colour.base, 'T·S');

  const shoulder = node(turret, 'shoulder');
  node(shoulder, 'shoulder joint', mat4.scale(0.11, 0.11, 0.11), meshes.sphere, colour.joint, 'S');
  node(shoulder, 'upper arm', trs([0, UPPER / 2, 0], I, [0.07, UPPER, 0.07]), meshes.cube, colour.link, 'T·S');

  const elbow = node(shoulder, 'elbow');
  node(elbow, 'elbow joint', mat4.scale(0.09, 0.09, 0.09), meshes.sphere, colour.joint, 'S');
  node(elbow, 'forearm', trs([0, FORE / 2, 0], I, [0.06, FORE, 0.06]), meshes.cube, colour.link, 'T·S');

  const wrist = node(elbow, 'wrist');
  node(wrist, 'wrist joint', mat4.scale(0.07, 0.07, 0.07), meshes.sphere, colour.joint, 'S');
  node(wrist, 'palm', trs([0, 0.04, 0], I, [0.16, 0.035, 0.07]), meshes.cube, colour.base, 'T·S');
  // empty leaf: the gripper centre (its world matrix is verified by hand in the report)
  const tip = node(wrist, 'tip', mat4.translate(0, 0.14, 0), null, null, 'T(0, 0.14, 0)');
  // the object the arm carries: a child of the wrist, so it follows every joint above it
  node(wrist, 'held fruit', trs([0, 0.14, 0], I, [0.075, 0.075, 0.075]), meshes.sphere, colour.fruit, 'T·S');

  const fingerL = node(wrist, 'finger L');
  node(fingerL, 'finger L mesh', trs([0, 0.055, 0], I, [0.022, 0.11, 0.05]), meshes.cube, colour.finger, 'T·S');
  const fingerR = node(wrist, 'finger R');
  node(fingerR, 'finger R mesh', trs([0, 0.055, 0], I, [0.022, 0.11, 0.05]), meshes.cube, colour.finger, 'T·S');

  /* ---------------- panel ---------------- */
  const f = panel.folder('B · Scene graph (robot arm)');
  const ui = [
    f.toggle('animate', state, 'animate'),
    // ±3.14 (not ±π) so that values like 0.5 lie on the slider's 0.01 grid and are not rounded
    f.slider('turret yaw', state, 'yaw', -3.14, 3.14, 0.01),
    f.slider('shoulder', state, 'shoulder', -1.6, 1.6, 0.01),
    f.slider('elbow', state, 'elbow', -2.4, 2.4, 0.01),
    f.slider('wrist', state, 'wrist', -1.6, 1.6, 0.01),
    f.slider('grip', state, 'grip', 0, 0.8, 0.01),
  ];
  f.note('world(tip) = arm · turret · shoulder · elbow · wrist · tip  (a leaf)');
  const tipText = f.text();

  return {
    node: arm,

    /** Set the joints' local matrices (before root.updateWorld()). */
    update(dt, time) {
      if (state.animate) {
        state.yaw = 0.5 + 0.7 * Math.sin(0.4 * time);
        state.shoulder = -0.45 + 0.35 * Math.sin(0.7 * time);
        state.elbow = -0.75 + 0.45 * Math.sin(0.9 * time + 1);
        state.wrist = 0.45 * Math.sin(1.3 * time);
        state.grip = 0.3 + 0.2 * Math.sin(2.2 * time);
        ui.forEach((c) => c.update());
      }
      turret.local = mat4.multiply(mat4.translate(0, 0.08, 0), mat4.rotateY(state.yaw));
      shoulder.local = mat4.multiply(mat4.translate(0, 0.14, 0), mat4.rotateZ(state.shoulder));
      elbow.local = mat4.multiply(mat4.translate(0, UPPER, 0), mat4.rotateZ(state.elbow));
      wrist.local = mat4.multiply(mat4.translate(0, FORE, 0), mat4.rotateZ(state.wrist));
      fingerL.local = mat4.multiply(mat4.translate(-0.06, 0.055, 0), mat4.rotateZ(state.grip));
      fingerR.local = mat4.multiply(mat4.translate(0.06, 0.055, 0), mat4.rotateZ(-state.grip));
      const a = (x) => x.toFixed(2);
      turret.data.desc = `T(0, 0.08, 0)·Ry(${a(state.yaw)})`;
      shoulder.data.desc = `T(0, 0.14, 0)·Rz(${a(state.shoulder)})`;
      elbow.data.desc = `T(0, ${UPPER}, 0)·Rz(${a(state.elbow)})`;
      wrist.data.desc = `T(0, ${FORE}, 0)·Rz(${a(state.wrist)})`;
      fingerL.data.desc = `T(−0.06, 0.055, 0)·Rz(${a(state.grip)})`;
      fingerR.data.desc = `T(0.06, 0.055, 0)·Rz(${a(-state.grip)})`;
    },

    /** After root.updateWorld(): show where the chain of products puts the tip. */
    afterUpdate() {
      const p = mat4.transformVec4(tip.world, [0, 0, 0, 1]);
      tipText.set(`${mat4.format(tip.world, 4)}\ntip at (${p.slice(0, 3).map((x) => x.toFixed(4)).join(', ')})`);
    },

    reset() {
      Object.assign(state, DEFAULTS);
      ui.forEach((c) => c.update());
    },
  };
}
