// Solid fill of the current viewport: the frame and background of the
// picture-in-picture view (renderer.renderInset). instance_index picks the colour.

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) which: u32,
};

@vertex
fn vs(@builtin(vertex_index) i: u32, @builtin(instance_index) k: u32) -> VSOut {
  // one triangle that covers the whole viewport: (−1, −1), (3, −1), (−1, 3)
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VSOut;
  o.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.which = k;
  return o;
}

@fragment
fn fs(v: VSOut) -> @location(0) vec4f {
  // linear RGB: 0 = a light frame, 1 = a background a little lighter than the wall
  let c = select(vec3f(0.030, 0.031, 0.036), vec3f(0.42, 0.43, 0.47), v.which == 0u);
  return toOutput(vec4f(c, 1.0));
}
