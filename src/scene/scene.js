/**
 * The scene: Parts A, B and D wired into one scene graph.
 *
 * main.js calls, every frame:
 *     scene.update(dt, time)          dt and time in seconds
 *     scene.draw(pass, viewProj)      inside the frame's render pass
 * and scene.reset() from the panel's "reset" button.
 *
 *   world ─┬─ objects (Part A: melon, pedestal, cone, T·R·S demo + ghost)
 *          ├─ arm     (Part B: robot arm, see arm.js)
 *          ├─ curve follower (Part D: rides along the curve)
 *          ├─ swept surface  (bonus: the curve revolved / extruded)
 *          ├─ gpu ribbon     (bonus: the curve tessellated in a compute shader)
 *          └─ painting-aligned box (bonus: axes from the painting's vanishing points)
 *
 * Every mesh node is drawn with  mvp = viewProj · node.world.
 */
import { SceneNode } from './node.js';
import { cube } from './geometry.js';
import { sphere, cylinder, cone } from './shapes.js';
import { createObjects } from './objects.js';
import { createArm } from './arm.js';
import { createCurveEditor } from './curveEditor.js';
import { createBezierDemo } from './bezierDemo.js';
import { createCalibration } from './calibration.js';
import { Mesh, MeshRenderer } from '../render/mesh.js';
import { Overlay } from '../render/overlay.js';
import * as mat4 from '../math/mat4.js';
import * as vec3 from '../math/vec3.js';

const AXIS_COLOURS = [[1, 0.05, 0.05], [0.1, 0.9, 0.1], [0.15, 0.35, 1]];

export function createScene({ gpu, renderer, painting, panel, view, camera, paintingId, onCameraChanged }) {
  const { device } = gpu;
  const meshes = {
    cube: new Mesh(device, cube(), 'cube'),
    sphere: new Mesh(device, sphere(), 'sphere'),
    cylinder: new Mesh(device, cylinder(), 'cylinder'),
    cone: new Mesh(device, cone(), 'cone'),
  };
  const meshRenderer = new MeshRenderer(gpu, renderer);
  const overlay = new Overlay(gpu, renderer);
  const DEFAULTS = { debugAxes: false, showObjects: true, showArm: true };
  const state = { ...DEFAULTS };

  const f = panel.folder('Scene');
  const sceneUI = [
    f.toggle('objects (A)', state, 'showObjects'),
    f.toggle('robot arm (B)', state, 'showArm'),
    f.toggle('debug axes (node frames)', state, 'debugAxes'),
  ];

  const root = new SceneNode('world');
  const objects = createObjects({ root, meshes, panel });
  const arm = createArm({ root, meshes, panel });
  const bezier = createBezierDemo({ panel, painting, view, paintingId }); // Part D: one Bézier + de Casteljau
  const curves = createCurveEditor({ gpu, root, meshes, panel, painting, view, paintingId }); // Part D: piecewise
  // bonus: the painter's own camera, recovered from vanishing points
  const calib = createCalibration({ root, meshes, panel, painting, view, camera, paintingId, onCameraChanged });

  // the scene graph as text (Part B), with each node's local transform
  const g = panel.folder('Scene graph', { open: false });
  g.note('○ transform-only node · ■ node with a mesh · then its local matrix');
  const treeText = g.text('');
  const treeString = () => {
    let s = '';
    root.traverse((n, d) => {
      s += `${'  '.repeat(d)}${n.data.mesh ? '■' : '○'} ${n.name}${n.data.desc ? `   ${n.data.desc}` : ''}\n`;
    });
    return s.trimEnd();
  };
  let nodeCount = 0, depth = 0;
  root.traverse((_, d) => { nodeCount++; depth = Math.max(depth, d); });
  g.note(`${nodeCount} nodes · ${depth + 1} levels, counting the world root as level 1 (deepest node ${depth} steps below the root)`);

  let grabbed = null; // which curve owns the current drag

  /** Visible nodes, skipping hidden subtrees. */
  function visibleNodes(node, out = []) {
    if (node.data.hidden) return out;
    out.push(node);
    for (const c of node.children) visibleNodes(c, out);
    return out;
  }

  return {
    state,

    update(dt, time) {
      objects.node.data.hidden = !state.showObjects;
      arm.node.data.hidden = !state.showArm;
      objects.update(dt, time);
      arm.update(dt, time);
      curves.enabled = bezier.showsPiecewise;
      bezier.update(dt, time);
      curves.update(dt, time);
      calib.update();
      root.updateWorld();
      arm.afterUpdate();
      treeText.set(treeString());
    },

    /**
     * @param {GPURenderPassEncoder} pass  @param {Float32Array} viewProj  P · V
     * @param {object} [o]
     * @param {(overlay: Overlay) => void} [o.extra]  more overlay drawing (main.js: the frustum)
     * @param {number[]} [o.eye]       camera position for the lighting (default: view.camera)
     * @param {number[]} [o.viewport]  device-pixel size of the viewport (default: the canvas)
     */
    draw(pass, viewProj, { extra, eye = view.camera.eye, viewport } = {}) {
      const nodes = visibleNodes(root);
      const drawn = nodes.filter((n) => n.data.mesh?.count > 0);
      // opaque first; see-through objects last so what is behind them is already there
      drawn.sort((a, b) => (b.data.colour[3] ?? 1) - (a.data.colour[3] ?? 1));
      meshRenderer.begin(eye, drawn.length);
      for (const n of drawn) meshRenderer.draw(pass, n.data.mesh, viewProj, n.world, n.data.colour);

      if (state.debugAxes) {
        // every visible node's local frame: origin = world·(0,0,0,1), axes = world·eₖ.
        // The axes are normalised to one length, so a node's scale does not hide them.
        for (const n of nodes) {
          const len = n === root ? 0.5 : 0.12;
          const o = mat4.transformVec4(n.world, [0, 0, 0, 1]).slice(0, 3);
          for (let k = 0; k < 3; k++) {
            const e = [0, 0, 0, 0]; e[k] = 1;
            const dir = vec3.normalize(mat4.transformVec4(n.world, e).slice(0, 3));
            overlay.line(o, vec3.add(o, vec3.scale(dir, len)), AXIS_COLOURS[k], 2, true);
          }
        }
      }
      curves.drawOverlay(overlay);
      bezier.drawOverlay(overlay);
      calib.drawOverlay(overlay);
      extra?.(overlay);
      overlay.draw(pass, viewProj, viewport);
    },

    /** Back to the start-up state: every checkbox, slider and selection, and the curves. */
    reset() {
      Object.assign(state, DEFAULTS);
      sceneUI.forEach((c) => c.update());
      objects.reset();
      arm.reset();
      curves.reset();
      bezier.reset();
      calib.reset();
    },

    setPainting(id) { curves.setPainting(id); bezier.setPainting(id); calib.setPainting(id); },

    // While the calibration lines are shown they get the first chance at a
    // click (marking them is a deliberate mode), then the single Bézier's
    // four points, then the curve editor.
    pointerDown(e) {
      grabbed = calib.pointerDown(e) ? calib
        : bezier.pointerDown(e) ? bezier
          : curves.pointerDown(e) ? curves : null;
      return grabbed !== null;
    },
    pointerDrag: (e) => grabbed?.pointerDrag(e),
    pointerUp(e) { grabbed?.pointerUp(e); grabbed = null; },
    pointerMove(e) {
      // every editor updates its own hover, so call all three
      const over = calib.pointerMove(e) | bezier.pointerMove(e) | curves.pointerMove(e);
      view.canvas.style.cursor = over ? 'grab' : '';
    },
  };
}
