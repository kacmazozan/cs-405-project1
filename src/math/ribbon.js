/**
 * ribbon — the geometry of the tessellated curve ribbon (bonus).
 *
 * The application builds this geometry on the GPU: render/shaders/ribbon.wgsl
 * is a transcription of the frame maths below, one compute invocation per
 * quad. What lives here is the part that has to run on the CPU anyway — the
 * packing of the control points and the buffer sizes — plus `referenceFrame`
 * and `referenceVertices`, the CPU reference the shader mirrors, which the
 * unit tests check (WGSL cannot be run under `node --test`).
 *
 * A ribbon of n segments sampled k times per segment has
 *     samples = n·k + 1,  quads = n·k,  vertices = 6·quads,  floats = 36·quads
 * in the [x, y, z, nx, ny, nz] layout that render/mesh.js draws.
 *
 * Tests: tests/ribbon.test.js
 */
import { cubicBezier, cubicBezierTangent, splitParameter } from './curves.js';

export const FLOATS_PER_VERTEX = 6;
export const VERTICES_PER_QUAD = 6;

/** Number of quads for `segments` cubic segments at `samples` samples each. */
export const quadCount = (segments, samples) => Math.max(0, segments * samples);

/** Number of vertices the compute shader writes. */
export const vertexCount = (segments, samples) => quadCount(segments, samples) * VERTICES_PER_QUAD;

/** Length of the vertex buffer, in floats. */
export const floatCount = (segments, samples) => vertexCount(segments, samples) * FLOATS_PER_VERTEX;

/**
 * Flatten cubic Bézier segments ([[P0, P1, P2, P3], …], points [x, y]) into
 * the storage buffer the shader reads: four vec2f per segment, joints
 * repeated so every invocation can index its own segment without a search.
 * @returns {Float32Array} of length 8·segments
 */
export function packSegments(segments) {
  const out = new Float32Array(segments.length * 8);
  segments.forEach((seg, i) => {
    for (let k = 0; k < 4; k++) {
      out[i * 8 + k * 2] = seg[k][0];
      out[i * 8 + k * 2 + 1] = seg[k][1];
    }
  });
  return out;
}

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v) => {
  const l = Math.hypot(...v);
  return l > 0 ? v.map((x) => x / l) : v.map(() => 0);
};

/**
 * The frame at sample `i` of the ribbon — the CPU twin of `frameAt` in
 * ribbon.wgsl. `across` turns about the tangent as u runs over the curve, so
 * the ribbon twists out of the painting plane; `twists` = 0 keeps it flat.
 * @returns {{ pos: number[], across: number[], normal: number[], u: number }}
 */
export function referenceFrame(segments, i, { samples, twists = 0, z = 0 }) {
  const total = segments.length * samples;
  const u = total > 0 ? i / total : 0;
  const { index, t } = splitParameter(segments.length, u);
  const seg = segments[index];

  const c = cubicBezier(...seg, t);
  let tangent = cubicBezierTangent(...seg, t);
  if (Math.hypot(...tangent) < 1e-9) tangent = [seg[3][0] - seg[0][0], seg[3][1] - seg[0][1]];
  if (Math.hypot(...tangent) < 1e-9) tangent = [1, 0];
  const tn = unit(tangent);

  const phi = twists * 2 * Math.PI * u;
  const cs = Math.cos(phi), sn = Math.sin(phi);
  const across = [-tn[1] * cs, tn[0] * cs, sn]; // cos·(in-plane normal) + sin·(+z)

  return {
    u,
    pos: [c[0], c[1], z],
    across,
    normal: unit(cross([tn[0], tn[1], 0], across)),
  };
}

/**
 * The whole vertex buffer, exactly as the compute shader writes it.
 * The application does NOT call this — it is the reference the tests compare
 * the shader's construction against.
 * @returns {Float32Array}
 */
export function referenceVertices(segments, { samples, halfWidth, twists = 0, z = 0 }) {
  const quads = quadCount(segments.length, samples);
  const out = new Float32Array(floatCount(segments.length, samples));
  let k = 0;
  const put = (p, n) => { out.set(p, k); out.set(n, k + 3); k += 6; };
  const offset = (f, s) => [
    f.pos[0] + s * halfWidth * f.across[0],
    f.pos[1] + s * halfWidth * f.across[1],
    f.pos[2] + s * halfWidth * f.across[2],
  ];
  for (let q = 0; q < quads; q++) {
    const f0 = referenceFrame(segments, q, { samples, twists, z });
    const f1 = referenceFrame(segments, q + 1, { samples, twists, z });
    const l0 = offset(f0, +1), r0 = offset(f0, -1);
    const l1 = offset(f1, +1), r1 = offset(f1, -1);
    put(l0, f0.normal); put(r0, f0.normal); put(r1, f1.normal);
    put(l0, f0.normal); put(r1, f1.normal); put(l1, f1.normal);
  }
  return out;
}
