/**
 * Surfaces made by sweeping a curve (bonus): a surface of revolution or an
 * extrusion, as mesh data in the geometry.js layout [x, y, z, nx, ny, nz].
 *
 * Revolution about an axis through the point c with direction a: write each
 * profile point as height h = (p − c)·a and signed radius r = (p − c)·e₁ (e₁ ⟂ a in
 * the painting plane, e₂ = +z its normal); then
 *     S(s, φ) = c + h(s)·a + r(s)·(cos φ·e₁ + sin φ·e₂)
 * and the normal is ∂S/∂s × ∂S/∂φ with
 *     ∂S/∂s = h'·a + r'·(cos φ·e₁ + sin φ·e₂),   ∂S/∂φ = r·(−sin φ·e₁ + cos φ·e₂).
 *
 * The profile is a traced outline that may cross the axis, so "outside" is not
 * well defined: every triangle is emitted twice (both windings, opposite
 * normals) and back-face culling keeps whichever side faces the camera.
 */
import * as vec3 from '../math/vec3.js';

export const SWEEPS = ['revolve (horizontal axis)', 'revolve (vertical axis)', 'extrude'];

/** Push triangle (a, b, c) twice; each vertex is { p, n }. */
function doubleSided(out, a, b, c) {
  const face = vec3.cross(vec3.sub(b.p, a.p), vec3.sub(c.p, a.p));
  if (vec3.length(face) < 1e-12) return; // degenerate (on the axis)
  // orient the smooth normals to agree with this winding's geometric normal
  const s = vec3.dot(face, vec3.add(vec3.add(a.n, b.n), c.n)) >= 0 ? 1 : -1;
  for (const v of [a, b, c]) out.push(...v.p, ...vec3.scale(v.n, s));
  for (const v of [a, c, b]) out.push(...v.p, ...vec3.scale(v.n, -s));
}

/** Unit tangents of a sampled polyline by central differences. */
function tangents(pts, closed) {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    return [b[0] - a[0], b[1] - a[1]];
  });
}

/**
 * @param {number[][]} profile  points [x, y] of the curve on the painting plane
 * @param {object} o  { mode, closed, slices, depth }
 * @returns {Float32Array}
 */
export function sweepMesh(profile, { mode = SWEEPS[0], closed = false, slices = 48, depth = 0.2 } = {}) {
  const out = [];
  if (profile.length < 2) return new Float32Array(out);
  const first = profile[0], last = profile[profile.length - 1];
  // a sampled closed curve ends where it starts: drop the duplicate, the loop wraps instead
  const pts = closed && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9 ? profile.slice(0, -1) : profile;
  const T = tangents(pts, closed);
  const ring = closed ? [...pts.keys(), 0] : [...pts.keys()]; // profile indices, closed loops wrap

  if (mode === 'extrude') {
    // the outline pushed out of the painting along +z, side normal ⟂ tangent
    const z0 = 0.01, z1 = z0 + depth;
    const v = (i, z) => {
      const n = vec3.normalize([T[i][1], -T[i][0], 0]);
      return { p: [pts[i][0], pts[i][1], z], n };
    };
    for (let k = 0; k + 1 < ring.length; k++) {
      const i = ring[k], j = ring[k + 1];
      doubleSided(out, v(i, z0), v(j, z0), v(j, z1));
      doubleSided(out, v(i, z0), v(j, z1), v(i, z1));
    }
    if (closed) {
      // caps: a fan from the centroid (fine for the roughly convex outlines traced here)
      const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
      for (const [z, nz] of [[z1, 1], [z0, -1]]) {
        for (let k = 0; k + 1 < ring.length; k++) {
          const P = (q) => ({ p: [q[0], q[1], z], n: [0, 0, nz] });
          doubleSided(out, P(c), P(pts[ring[k]]), P(pts[ring[k + 1]]));
        }
      }
    }
    return new Float32Array(out);
  }

  // revolution: axis through the profile's centroid, parallel to x or y
  const vertical = mode === 'revolve (vertical axis)';
  const a = vertical ? [0, 1, 0] : [1, 0, 0];
  const e1 = vertical ? [1, 0, 0] : [0, 1, 0];
  const e2 = [0, 0, 1];
  const centroid = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  const h = pts.map((p) => vertical ? p[1] - centroid[1] : p[0] - centroid[0]);
  const r = pts.map((p) => vertical ? p[0] - centroid[0] : p[1] - centroid[1]);
  const dh = T.map((t) => (vertical ? t[1] : t[0]));
  const dr = T.map((t) => (vertical ? t[0] : t[1]));
  // put the axis in front of the painting, far enough that the solid never cuts it
  const rMax = Math.max(...r.map(Math.abs));
  const c = [centroid[0], centroid[1], rMax + 0.03];

  const vertex = (i, k) => {
    const phi = (2 * Math.PI * k) / slices, cs = Math.cos(phi), sn = Math.sin(phi);
    const radial = vec3.add(vec3.scale(e1, cs), vec3.scale(e2, sn));
    const p = vec3.add(vec3.add(c, vec3.scale(a, h[i])), vec3.scale(radial, r[i]));
    const ds = vec3.add(vec3.scale(a, dh[i]), vec3.scale(radial, dr[i]));
    const dphi = vec3.scale(vec3.add(vec3.scale(e1, -sn), vec3.scale(e2, cs)), r[i]);
    let n = vec3.normalize(vec3.cross(ds, dphi));
    if (vec3.length(n) === 0) n = radial; // on the axis
    return { p, n };
  };
  for (let q = 0; q + 1 < ring.length; q++) {
    const i = ring[q], j = ring[q + 1];
    for (let k = 0; k < slices; k++) {
      doubleSided(out, vertex(i, k), vertex(j, k), vertex(j, k + 1));
      doubleSided(out, vertex(i, k), vertex(j, k + 1), vertex(i, k + 1));
    }
  }
  return new Float32Array(out);
}
