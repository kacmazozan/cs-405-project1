/**
 * vec3 — 3-component vectors as plain arrays [x, y, z].
 *
 * Every function returns a NEW array and never modifies its arguments.
 * Write these yourself (Week 1, Linear Algebra I). Tests: tests/vec3.test.js
 */
import { todo } from './todo.js';

/** a + b */
export function add(a, b) { return todo('vec3.add'); }

/** a − b */
export function sub(a, b) { return todo('vec3.sub'); }

/** s · a  (s is a number) */
export function scale(a, s) { return todo('vec3.scale'); }

/** a · b  → number */
export function dot(a, b) { return todo('vec3.dot'); }

/** a × b  (right-handed: cross([1,0,0],[0,1,0]) = [0,0,1]) */
export function cross(a, b) { return todo('vec3.cross'); }

/** |a|  → number */
export function length(a) { return todo('vec3.length'); }

/**
 * a / |a|.
 * For a zero-length vector return [0, 0, 0] — never NaN.
 */
export function normalize(a) { return todo('vec3.normalize'); }
