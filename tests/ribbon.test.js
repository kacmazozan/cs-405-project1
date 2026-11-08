// Tests for src/math/ribbon.js — the geometry that render/shaders/ribbon.wgsl
// builds on the GPU. WGSL cannot run under `node --test`, so the shader is a
// transcription of referenceFrame / referenceVertices and these tests pin the
// construction down: the ribbon follows the curve, its normals are unit and
// perpendicular to the curve, its width is the one asked for, and the two
// triangles of every quad wind the same way as their normal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubicBezier, cubicBezierTangent } from '../src/math/curves.js';
import {
  packSegments, quadCount, vertexCount, floatCount, referenceFrame, referenceVertices,
  FLOATS_PER_VERTEX, VERTICES_PER_QUAD,
} from '../src/math/ribbon.js';
import * as vec3 from '../src/math/vec3.js';
import { close, closeArr } from './helpers.js';

const SEGS = [
  [[-0.8, -0.3], [-0.4, 0.5], [0.2, 0.6], [0.5, 0.1]],
  [[0.5, 0.1], [0.8, -0.4], [1.0, -0.5], [1.2, -0.1]],
];

test('packSegments lays four control points per segment out as vec2f', () => {
  const packed = packSegments(SEGS);
  assert.equal(packed.length, SEGS.length * 8);
  SEGS.forEach((seg, i) => seg.forEach((p, k) => {
    close(packed[i * 8 + k * 2], p[0]);
    close(packed[i * 8 + k * 2 + 1], p[1]);
  }));
});

test('buffer sizes: quads = segments · samples, six vertices each', () => {
  assert.equal(quadCount(2, 24), 48);
  assert.equal(vertexCount(2, 24), 48 * VERTICES_PER_QUAD);
  assert.equal(floatCount(2, 24), 48 * VERTICES_PER_QUAD * FLOATS_PER_VERTEX);
  assert.equal(quadCount(0, 24), 0);
  assert.equal(referenceVertices([], { samples: 8, halfWidth: 0.1 }).length, 0);
});

test('the ribbon centre line is the curve, and it reaches both ends', () => {
  const samples = 16;
  for (let i = 0; i <= SEGS.length * samples; i++) {
    const f = referenceFrame(SEGS, i, { samples, z: 0.02 });
    const want = cubicBezier(...SEGS[Math.min(Math.floor(f.u * SEGS.length), SEGS.length - 1)],
      f.u * SEGS.length - Math.min(Math.floor(f.u * SEGS.length), SEGS.length - 1));
    closeArr(f.pos.slice(0, 2), want, 1e-9);
    close(f.pos[2], 0.02);
  }
  closeArr(referenceFrame(SEGS, 0, { samples }).pos.slice(0, 2), SEGS[0][0], 1e-9);
  closeArr(referenceFrame(SEGS, SEGS.length * samples, { samples }).pos.slice(0, 2), SEGS[1][3], 1e-9);
});

test('the frame is orthonormal: across ⟂ normal ⟂ tangent, all unit', () => {
  const samples = 12;
  for (const twists of [0, 1.5]) {
    for (let i = 0; i <= SEGS.length * samples; i++) {
      const f = referenceFrame(SEGS, i, { samples, twists });
      const seg = Math.min(Math.floor(f.u * SEGS.length), SEGS.length - 1);
      const t = f.u * SEGS.length - seg;
      const d = cubicBezierTangent(...SEGS[seg], t);
      const tn = vec3.normalize([d[0], d[1], 0]);
      close(vec3.length(f.across), 1, 1e-9, `across @${i}`);
      close(vec3.length(f.normal), 1, 1e-9, `normal @${i}`);
      close(vec3.dot(f.across, f.normal), 0, 1e-9);
      close(vec3.dot(f.across, tn), 0, 1e-9);
      close(vec3.dot(f.normal, tn), 0, 1e-9);
    }
  }
});

test('with no twist the ribbon lies in the painting plane and faces the viewer', () => {
  const f = referenceFrame(SEGS, 5, { samples: 16, twists: 0 });
  close(f.across[2], 0, 1e-12);          // across stays in the plane
  closeArr(f.normal, [0, 0, 1], 1e-9);   // the flat ribbon faces +z, out of the painting
});

test('a quarter twist stands the ribbon on edge', () => {
  // twists = 0.5 means half a turn over the curve, so u = 0.5 is a quarter turn
  const f = referenceFrame(SEGS, 8, { samples: 8, twists: 0.5 });
  close(f.u, 0.5, 1e-12);
  close(Math.abs(f.across[2]), 1, 1e-9);  // across now points out of the painting
  close(f.normal[2], 0, 1e-9);            // and the surface faces sideways
});

test('each quad is halfWidth either side of the curve, wound to match its normal', () => {
  const samples = 10, halfWidth = 0.05;
  const data = referenceVertices(SEGS, { samples, halfWidth, twists: 0.75, z: 0.01 });
  assert.equal(data.length, floatCount(SEGS.length, samples));

  const vertex = (k) => ({
    p: [data[k * 6], data[k * 6 + 1], data[k * 6 + 2]],
    n: [data[k * 6 + 3], data[k * 6 + 4], data[k * 6 + 5]],
  });

  for (let q = 0; q < quadCount(SEGS.length, samples); q++) {
    const v = [0, 1, 2, 3, 4, 5].map((k) => vertex(q * 6 + k));
    const f0 = referenceFrame(SEGS, q, { samples, twists: 0.75, z: 0.01 });

    // the first two vertices straddle the curve point by halfWidth
    // the buffer is a Float32Array, so compare at single-precision accuracy
    close(vec3.length(vec3.sub(v[0].p, v[1].p)), 2 * halfWidth, 1e-6, `width @${q}`);
    closeArr(vec3.scale(vec3.add(v[0].p, v[1].p), 0.5), f0.pos, 1e-6, `centre @${q}`);

    for (const tri of [[v[0], v[1], v[2]], [v[3], v[4], v[5]]]) {
      const face = vec3.cross(vec3.sub(tri[1].p, tri[0].p), vec3.sub(tri[2].p, tri[0].p));
      const avg = vec3.add(vec3.add(tri[0].n, tri[1].n), tri[2].n);
      assert.ok(vec3.dot(face, avg) > 0, `quad ${q}: winding disagrees with the normal`);
    }
  }
});

test('the ribbon is continuous: a quad ends where the next one starts', () => {
  const samples = 8;
  const data = referenceVertices(SEGS, { samples, halfWidth: 0.04, twists: 1 });
  const at = (k) => [data[k * 6], data[k * 6 + 1], data[k * 6 + 2]];
  for (let q = 0; q + 1 < quadCount(SEGS.length, samples); q++) {
    closeArr(at(q * 6 + 5), at((q + 1) * 6 + 0), 1e-6, `left edge ${q}`);  // l1 → l0
    closeArr(at(q * 6 + 4), at((q + 1) * 6 + 1), 1e-6, `right edge ${q}`); // r1 → r0
  }
});
