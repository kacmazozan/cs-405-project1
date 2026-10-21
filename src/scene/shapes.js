/**
 * More vertex data in the same layout as geometry.js: interleaved
 * [x, y, z, nx, ny, nz], 'triangle-list', counter-clockwise seen from outside.
 * Every shape fits the unit cube centred at the origin (like geometry.cube()),
 * so a scale matrix gives it its final size.
 */

const TAU = 2 * Math.PI;

/** Push the two triangles (a, b, c) and (a, c, d) of a CCW quad. Each vertex is [p, n]. */
function quad(out, a, b, c, d) {
  for (const [p, n] of [a, b, c, a, c, d]) out.push(...p, ...n);
}

/** UV sphere of radius 0.5. `stacks` bands from pole to pole, `slices` around y. */
export function sphere(stacks = 24, slices = 36) {
  const out = [];
  const vertex = (i, j) => {
    const theta = (Math.PI * i) / stacks, phi = (TAU * j) / slices;
    const n = [Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi)];
    return [n.map((x) => 0.5 * x), n];
  };
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      quad(out, vertex(i, j), vertex(i + 1, j), vertex(i + 1, j + 1), vertex(i, j + 1));
    }
  }
  return new Float32Array(out);
}

/** Closed cylinder along y: radius 0.5, y ∈ [−0.5, 0.5]. */
export function cylinder(slices = 36) {
  const out = [];
  const ring = (j) => {
    const phi = (TAU * j) / slices;
    return [Math.sin(phi), Math.cos(phi)];
  };
  for (let j = 0; j < slices; j++) {
    const [s0, c0] = ring(j), [s1, c1] = ring(j + 1);
    const n0 = [s0, 0, c0], n1 = [s1, 0, c1];
    quad(out,
      [[0.5 * s0, 0.5, 0.5 * c0], n0], [[0.5 * s0, -0.5, 0.5 * c0], n0],
      [[0.5 * s1, -0.5, 0.5 * c1], n1], [[0.5 * s1, 0.5, 0.5 * c1], n1]);
    // caps: fans around the centre
    out.push(0, 0.5, 0, 0, 1, 0, 0.5 * s0, 0.5, 0.5 * c0, 0, 1, 0, 0.5 * s1, 0.5, 0.5 * c1, 0, 1, 0);
    out.push(0, -0.5, 0, 0, -1, 0, 0.5 * s1, -0.5, 0.5 * c1, 0, -1, 0, 0.5 * s0, -0.5, 0.5 * c0, 0, -1, 0);
  }
  return new Float32Array(out);
}

/** Cone along +y: base radius 0.5 at y = −0.5, apex at y = +0.5. */
export function cone(slices = 36) {
  const out = [];
  // side normal at angle φ: perpendicular to the slant line, ∝ (sin φ, r/h, cos φ) with r/h = 0.5
  const normal = (phi) => {
    const n = [Math.sin(phi), 0.5, Math.cos(phi)];
    const len = Math.hypot(...n);
    return n.map((x) => x / len);
  };
  for (let j = 0; j < slices; j++) {
    const p0 = (TAU * j) / slices, p1 = (TAU * (j + 1)) / slices;
    const b0 = [0.5 * Math.sin(p0), -0.5, 0.5 * Math.cos(p0)];
    const b1 = [0.5 * Math.sin(p1), -0.5, 0.5 * Math.cos(p1)];
    out.push(0, 0.5, 0, ...normal((p0 + p1) / 2), ...b0, ...normal(p0), ...b1, ...normal(p1));
    out.push(0, -0.5, 0, 0, -1, 0, ...b1, 0, -1, 0, ...b0, 0, -1, 0);
  }
  return new Float32Array(out);
}
