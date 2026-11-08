// Part D bonus — the curve evaluated in a COMPUTE SHADER and tessellated
// into a ribbon.
//
// One invocation per quad of the ribbon. Each invocation evaluates the cubic
// Bézier at the two ends of its own quad with de Casteljau (the same
// construction as math/curves.js, written here in WGSL), builds a frame
// there, and writes the six vertices of the quad's two triangles straight
// into a buffer that is then bound as the VERTEX buffer of the mesh
// pipeline. The geometry never travels back to the CPU: the control points
// go up, the triangles stay on the GPU.
//
// Layout of `verts` is the one render/mesh.js expects: [x, y, z, nx, ny, nz].

struct Params {
  segments:  u32,  // number of cubic Bézier segments
  samples:   u32,  // samples per segment; quads = segments * samples
  halfWidth: f32,  // half the ribbon's width, in world units
  twists:    f32,  // full turns of the cross-section over the whole curve
  z:         f32,  // height above the painting plane
  _pad0:     f32,
  _pad1:     f32,
  _pad2:     f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> ctrl: array<vec2f>;       // 4 per segment
@group(0) @binding(2) var<storage, read_write> verts: array<f32>;  // 6 floats per vertex

const TAU = 6.283185307179586;

struct Frame {
  pos:    vec3f,  // the point on the curve, lifted off the painting
  across: vec3f,  // the ribbon's half-width direction (unit)
  normal: vec3f,  // the surface normal there (unit)
};

// de Casteljau: three rounds of linear interpolation. The last round's two
// points give the tangent as well — B'(t) = 3·(b1 − b0) — so the frame costs
// no extra evaluation.
fn frameAt(i: u32) -> Frame {
  let total = f32(P.segments * P.samples);
  let u = f32(i) / total;
  let su = u * f32(P.segments);
  let s = min(u32(floor(su)), P.segments - 1u);
  let t = su - f32(s);

  let p0 = ctrl[4u * s + 0u];
  let p1 = ctrl[4u * s + 1u];
  let p2 = ctrl[4u * s + 2u];
  let p3 = ctrl[4u * s + 3u];

  let a0 = mix(p0, p1, t);          // level 1
  let a1 = mix(p1, p2, t);
  let a2 = mix(p2, p3, t);
  let b0 = mix(a0, a1, t);          // level 2 — b0→b1 is tangent to the curve
  let b1 = mix(a1, a2, t);
  let c  = mix(b0, b1, t);          // level 3 — the point B(t)

  var tangent = b1 - b0;            // ∝ B'(t)
  if (length(tangent) < 1e-9) { tangent = p3 - p0; }      // a cusp: fall back to the chord
  if (length(tangent) < 1e-9) { tangent = vec2f(1.0, 0.0); }
  let tn = normalize(tangent);

  // The cross-section turns about the tangent, so the ribbon twists out of
  // the painting plane and catches the light instead of reading as a flat
  // stripe. twists = 0 leaves it lying in the plane.
  let phi = P.twists * TAU * u;
  let inPlane    = vec3f(-tn.y, tn.x, 0.0);
  let outOfPlane = vec3f(0.0, 0.0, 1.0);
  let across = cos(phi) * inPlane + sin(phi) * outOfPlane;

  var f: Frame;
  f.pos = vec3f(c, P.z);
  f.across = across;
  // the surface is spanned by the tangent and `across`
  f.normal = normalize(cross(vec3f(tn, 0.0), across));
  return f;
}

fn put(slot: u32, p: vec3f, n: vec3f) {
  let k = slot * 6u;
  verts[k + 0u] = p.x;
  verts[k + 1u] = p.y;
  verts[k + 2u] = p.z;
  verts[k + 3u] = n.x;
  verts[k + 4u] = n.y;
  verts[k + 5u] = n.z;
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) gid: vec3u) {
  let q = gid.x;
  let quads = P.segments * P.samples;
  if (q >= quads) { return; }

  let f0 = frameAt(q);
  let f1 = frameAt(q + 1u);

  let l0 = f0.pos + P.halfWidth * f0.across;
  let r0 = f0.pos - P.halfWidth * f0.across;
  let l1 = f1.pos + P.halfWidth * f1.across;
  let r1 = f1.pos - P.halfWidth * f1.across;

  // two counter-clockwise triangles seen from the normal's side (the mesh
  // pipeline culls back faces with frontFace 'ccw')
  let base = q * 6u;
  put(base + 0u, l0, f0.normal);
  put(base + 1u, r0, f0.normal);
  put(base + 2u, r1, f1.normal);
  put(base + 3u, l0, f0.normal);
  put(base + 4u, r1, f1.normal);
  put(base + 5u, l1, f1.normal);
}
