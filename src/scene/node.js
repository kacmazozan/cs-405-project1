/**
 * Scene graph node — Part B.
 *
 * Each node holds a LOCAL transform (relative to its parent) and a WORLD
 * matrix that you compute by traversal:  world = parent.world · local.
 * Tests: tests/node.test.js
 */
import * as mat4 from '../math/mat4.js';
import { todo } from '../math/todo.js';

// A literal identity so nodes can be created before mat4.identity() exists.
const I = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export class SceneNode {
  /**
   * @param {string} name   shown in debug output and your report diagram
   * @param {Float32Array} [local]  local transform (default identity)
   */
  constructor(name, local = I()) {
    this.name = name;
    this.local = local;
    this.world = I();
    this.parent = null;
    this.children = [];
    /** Anything you want to attach: a mesh, a colour, an animation function… */
    this.data = {};
  }

  /** Attach `child` under this node and return it (so calls can be chained). */
  addChild(child) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  /**
   * TODO (Part B): set this.world from parentWorld and this.local, then
   * update every child recursively. Called on the root with no argument.
   * @param {Float32Array} [parentWorld]  world matrix of the parent (identity for the root)
   */
  updateWorld(parentWorld) {
    return todo('SceneNode.updateWorld');
  }

  /** Visit this node and all descendants depth-first: fn(node, depth). */
  traverse(fn, depth = 0) {
    fn(this, depth);
    for (const c of this.children) c.traverse(fn, depth + 1);
  }

  /** First node in the subtree with the given name, or null. */
  find(name) {
    if (this.name === name) return this;
    for (const c of this.children) {
      const hit = c.find(name);
      if (hit) return hit;
    }
    return null;
  }
}

// Re-exported for convenience when building trees: import { mat4 } from './node.js'
export { mat4 };
