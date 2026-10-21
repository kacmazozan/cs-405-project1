/**
 * Colours for the CPU side. Colour pickers and hex codes are sRGB-ENCODED;
 * shaders light and blend in LINEAR RGB (see shaders/colour.wgsl). Convert
 * once here, so every uniform / vertex colour is already linear.
 */

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' (sRGB) → [r, g, b] linear, components in [0, 1]. */
export function hex(code) {
  const n = parseInt(code.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => srgbToLinear(x / 255));
}
