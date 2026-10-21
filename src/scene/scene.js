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
 *          └─ curve follower (Part D: rides along the curve)
 *
 * Every mesh node is drawn with  mvp = viewProj · node.world.
 */
import { SceneNode } from './node.js';
import { cube } from './geometry.js';
import { sphere, cylinder, cone } from './shapes.js';
import { createObjects } from './objects.js';
import { createArm } from './arm.js';
import { createCurveEditor } from './curveEditor.js';
import { Mesh, MeshRenderer } from '../render/mesh.js';
import { Overlay } from '../render/overlay.js';
import * as mat4 from '../math/mat4.js';

const AXIS_COLOURS = [[1, 0.05, 0.05], [0.1, 0.9, 0.1], [0.15, 0.35, 1]];

export function createScene({ gpu, renderer, painting, panel, view, paintingId }) {
  const { device } = gpu;
  const meshes = {
    cube: new Mesh(device, cube(), 'cube'),
    sphere: new Mesh(device, sphere(), 'sphere'),
    cylinder: new Mesh(device, cylinder(), 'cylinder'),
    cone: new Mesh(device, cone(), 'cone'),
  };
  const meshRenderer = new MeshRenderer(gpu, renderer);
  const overlay = new Overlay(gpu, renderer);
  const state = { debugAxes: false, showObjects: true, showArm: true };

  const f = panel.folder('Scene');
  f.toggle('objects (A)', state, 'showObjects');
  f.toggle('robot arm (B)', state, 'showArm');
  f.toggle('debug axes (node frames)', state, 'debugAxes');

  const root = new SceneNode('world');
  const objects = createObjects({ root, meshes, panel });
  const arm = createArm({ root, meshes, panel });
  const curves = createCurveEditor({ root, meshes, panel, painting, view, paintingId });

  // the scene graph as text (Part B)
  const g = panel.folder('Scene graph', { open: false });
  let tree = '';
  root.traverse((n, d) => { tree += `${'  '.repeat(d)}${n.data.mesh ? '■' : '○'} ${n.name}\n`; });
  g.text(tree.trimEnd());
  g.note('○ transform-only node · ■ node with a mesh');

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
      curves.update(dt, time);
      root.updateWorld();
      arm.afterUpdate();
    },

    /** @param {GPURenderPassEncoder} pass  @param {Float32Array} viewProj  P · V */
    draw(pass, viewProj) {
      const nodes = visibleNodes(root);
      const drawn = nodes.filter((n) => n.data.mesh);
      // opaque first; see-through objects last so what is behind them is already there
      drawn.sort((a, b) => (b.data.colour[3] ?? 1) - (a.data.colour[3] ?? 1));
      meshRenderer.begin(view.camera.eye, drawn.length);
      for (const n of drawn) meshRenderer.draw(pass, n.data.mesh, viewProj, n.world, n.data.colour);

      if (state.debugAxes) {
        for (const n of nodes) {
          if (n.data.mesh && !n.data.showAxes) continue;
          const len = n === root ? 0.5 : 0.15;
          const o = mat4.transformVec4(n.world, [0, 0, 0, 1]).slice(0, 3);
          for (let k = 0; k < 3; k++) {
            const e = [0, 0, 0, 1]; e[k] = len;
            overlay.line(o, mat4.transformVec4(n.world, e).slice(0, 3), AXIS_COLOURS[k], 2, true);
          }
        }
      }
      curves.drawOverlay(overlay);
      overlay.draw(pass, viewProj);
    },

    reset() {
      objects.reset();
      arm.reset();
      curves.reset();
    },

    setPainting(id) { curves.setPainting(id); },
    pointerDown: (e) => curves.pointerDown(e),
    pointerDrag: (e) => curves.pointerDrag(e),
    pointerUp: (e) => curves.pointerUp(e),
    pointerMove: (e) => curves.pointerMove(e),
  };
}
