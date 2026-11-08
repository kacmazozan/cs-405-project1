import colourWGSL from './shaders/colour.wgsl?raw';

const PRELUDE_LINES = colourWGSL.split('\n').length; // so error line numbers match YOUR file

/**
 * Create a shader module with the shared colour helpers (toOutput,
 * srgbToLinear, linearToSrgb, ENCODE_SRGB) prepended.
 * Every pipeline that renders to the canvas must pass
 *   constants: { ENCODE_SRGB: gpu.encodeSRGB ? 1 : 0 }
 * in its `fragment` stage — use fragmentConstants(gpu) for that.
 */
export function createShader(device, code, label) {
  const module = device.createShaderModule({ label, code: `${colourWGSL}\n${code}` });
  report(module, label, PRELUDE_LINES);
  return module;
}

/**
 * A COMPUTE shader module (render/ribbon.js). No colour prelude: a compute
 * pass writes to a buffer, not to the canvas, so it needs neither toOutput()
 * nor the ENCODE_SRGB pipeline constant — and line numbers stay as written.
 */
export function createComputeShader(device, code, label) {
  const module = device.createShaderModule({ label, code });
  report(module, label, 0);
  return module;
}

/** Log WGSL warnings and errors with line numbers that match the source file. */
function report(module, label, prelude) {
  module.getCompilationInfo().then((info) => {
    for (const m of info.messages) {
      const fn = m.type === 'error' ? console.error : console.warn;
      const line = m.lineNum > prelude ? m.lineNum - prelude : `${m.lineNum} (colour.wgsl)`;
      fn(`[WGSL ${label ?? ''}] ${m.type} line ${line}: ${m.message}`);
    }
  });
}

export const fragmentConstants = (gpu) => ({ ENCODE_SRGB: gpu.encodeSRGB ? 1 : 0 });
