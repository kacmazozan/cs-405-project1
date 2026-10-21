// Overlay primitives drawn in world space with a size in PIXELS:
//   • lines  — every segment is an instanced screen-space quad, so lines can be
//              thicker than WebGPU's 1-pixel 'line-list'
//   • points — round markers (control points), also instanced quads
// Colours arrive in LINEAR RGB.

struct Uniforms {
  viewProj: mat4x4f,
  viewport: vec4f,     // xy = drawing-buffer size in device pixels
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) colour: vec3f,
  @location(1) local: vec2f,   // position inside the quad, for round points
};

// Two triangles; x = along the segment (0 → a, 1 → b), y = side (−1, +1).
const LINE_QUAD = array<vec2f, 6>(
  vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
);

@vertex
fn vsLine(@builtin(vertex_index) vi: u32,
          @location(0) a: vec3f, @location(1) b: vec3f,
          @location(2) colour: vec3f, @location(3) width: f32) -> VSOut {
  var o: VSOut;
  o.colour = colour;
  o.local = vec2f(0.0);
  var ca = u.viewProj * vec4f(a, 1.0);
  var cb = u.viewProj * vec4f(b, 1.0);

  // Clip against the near plane (WebGPU: z_clip ≥ 0) before dividing by w,
  // otherwise an end behind the camera flips to the other side of the screen.
  if (ca.z < 0.0 && cb.z < 0.0) {
    o.position = vec4f(0.0, 0.0, -1.0, 1.0);   // whole segment culled
    return o;
  }
  if (ca.z < 0.0) { ca = mix(ca, cb, ca.z / (ca.z - cb.z)); }
  if (cb.z < 0.0) { cb = mix(cb, ca, cb.z / (cb.z - ca.z)); }

  let half = u.viewport.xy * 0.5;
  let sa = ca.xy / ca.w * half;               // pixels from the centre
  let sb = cb.xy / cb.w * half;
  let d = sb - sa;
  let len = length(d);
  let dir = select(vec2f(1.0, 0.0), d / len, len > 1e-5);
  let nrm = vec2f(-dir.y, dir.x);

  var quad = LINE_QUAD;                       // a var can be indexed at run time everywhere
  let c = quad[vi];
  let p = select(ca, cb, c.x > 0.5);
  // widen sideways, and extend the ends by half a width (square caps, so
  // the joints of a polyline have no gaps)
  let px = nrm * c.y * width * 0.5 + dir * (c.x * 2.0 - 1.0) * width * 0.5;
  o.position = vec4f(p.xy + px / half * p.w, p.z, p.w);
  return o;
}

const POINT_QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

@vertex
fn vsPoint(@builtin(vertex_index) vi: u32,
           @location(0) pos: vec3f, @location(1) colour: vec3f, @location(2) size: f32) -> VSOut {
  var o: VSOut;
  var quad = POINT_QUAD;
  let c = quad[vi];
  let clip = u.viewProj * vec4f(pos, 1.0);
  o.colour = colour;
  o.local = c;
  if (clip.w <= 0.0) {
    o.position = vec4f(0.0, 0.0, -1.0, 1.0);   // behind the camera
    return o;
  }
  o.position = vec4f(clip.xy + c * size / u.viewport.xy * clip.w, clip.z, clip.w);
  return o;
}

@fragment
fn fsLine(i: VSOut) -> @location(0) vec4f {
  return toOutput(vec4f(i.colour, 1.0));
}

@fragment
fn fsPoint(i: VSOut) -> @location(0) vec4f {
  let r = length(i.local);
  if (r > 1.0) { discard; }
  // dark rim so markers stay readable on light and dark parts of a painting
  let rim = smoothstep(0.62, 0.78, r);
  return toOutput(vec4f(mix(i.colour, vec3f(0.0), rim * 0.85), 1.0));
}
