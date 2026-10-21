// Lit, solid-colour meshes (cube, sphere, cylinder, cone from scene/shapes.js).
// One uniform slot per draw, selected with a dynamic offset (render/mesh.js).

struct Uniforms {
  mvp: mat4x4f,        // P · V · M
  model: mat4x4f,      // M (object → world)
  normalMat: mat4x4f,  // cofactors of M's 3×3 block ∝ M⁻ᵀ (mat4.normalMatrix)
  colour: vec4f,       // LINEAR rgb + alpha
  eye: vec4f,          // camera position in world space
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) normal: vec3f,
};

@vertex
fn vs(@location(0) pos: vec3f, @location(1) nrm: vec3f) -> VSOut {
  var o: VSOut;
  o.position = u.mvp * vec4f(pos, 1.0);
  o.worldPos = (u.model * vec4f(pos, 1.0)).xyz;
  o.normal = (u.normalMat * vec4f(nrm, 0.0)).xyz;
  return o;
}

// Gallery lighting in world space: a warm key light from the upper left-front,
// a cool fill from the right and a little ambient.
const KEY_DIR = vec3f(-0.35, 0.75, 0.56);
const KEY_COL = vec3f(1.0, 0.95, 0.88);
const FILL_DIR = vec3f(0.8, 0.1, 0.6);
const FILL_COL = vec3f(0.22, 0.26, 0.34);
const AMBIENT = 0.08;

@fragment
fn fs(i: VSOut) -> @location(0) vec4f {
  let n = normalize(i.normal);
  let v = normalize(u.eye.xyz - i.worldPos);
  let l = normalize(KEY_DIR);
  let h = normalize(l + v);                     // Blinn–Phong half vector
  let ndl = max(dot(n, l), 0.0);
  let spec = select(0.0, pow(max(dot(n, h), 0.0), 40.0), ndl > 0.0);
  let fill = max(dot(n, normalize(FILL_DIR)), 0.0);

  let rgb = u.colour.rgb * (AMBIENT + ndl * KEY_COL + fill * FILL_COL) + 0.18 * spec * KEY_COL;
  return toOutput(vec4f(rgb, u.colour.a));
}
