/**
 * Mesh pipeline (Part A): solid, lit triangle meshes.
 * Same structure as painting.js (vertex buffer → uniform buffer → bind group
 * → pipeline → draw), with one difference that matters when many objects are
 * drawn in one frame:
 *
 *   queue.writeBuffer() runs BEFORE the frame's commands. If every object
 *   used the same 224 bytes of uniforms, all of them would be drawn with the
 *   last matrix written. So each draw gets its OWN slot in one big uniform
 *   buffer, and the bind group selects the slot with a dynamic offset.
 */
import meshWGSL from './shaders/mesh.wgsl?raw';
import { createShader, fragmentConstants } from './shader.js';
import { DEPTH_FORMAT } from './renderer.js';
import * as mat4 from '../math/mat4.js';

const SLOT_FLOATS = 16 * 3 + 4 * 2; // mvp, model, normalMat, colour, eye
const SLOT_BYTES = SLOT_FLOATS * 4; // 224

/** A vertex buffer of interleaved [x, y, z, nx, ny, nz] (scene/geometry.js layout). */
export class Mesh {
  constructor(device, data, label) {
    this.count = data.length / 6;
    this.buffer = device.createBuffer({
      label,
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffer, 0, data);
  }
}

export class MeshRenderer {
  constructor(gpu, renderer) {
    const { device } = gpu;
    this.gpu = gpu;
    this.renderer = renderer;
    const align = device.limits.minUniformBufferOffsetAlignment;
    this.stride = Math.ceil(SLOT_BYTES / align) * align;

    this.layout = device.createBindGroupLayout({
      label: 'mesh uniforms',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: SLOT_BYTES },
      }],
    });

    const module = createShader(device, meshWGSL, 'mesh');
    const make = (transparent) => device.createRenderPipeline({
      label: transparent ? 'mesh (transparent)' : 'mesh',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: {
        module, entryPoint: 'vs',
        buffers: [{
          arrayStride: 6 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, // normal
          ],
        }],
      },
      fragment: {
        module, entryPoint: 'fs',
        targets: [{
          format: gpu.viewFormat,
          // "over" blending in linear space for see-through objects
          blend: transparent ? {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          } : undefined,
        }],
        constants: fragmentConstants(gpu),
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      // transparent objects are tested against, but do not write, depth
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: !transparent, depthCompare: 'less' },
    });
    this.opaque = make(false);
    this.transparent = make(true);

    this.staging = new Float32Array(SLOT_FLOATS);
    this.capacity = 0;
    this.slot = 0;
    this.eye = [0, 0, 0];
    this.#allocate(64);
  }

  #allocate(slots) {
    this.capacity = slots;
    // Only called from begin(), before this frame records any draw with the old buffer.
    this.uniforms?.destroy();
    this.uniforms = this.gpu.device.createBuffer({
      label: 'mesh uniform slots',
      size: slots * this.stride,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = this.gpu.device.createBindGroup({
      layout: this.layout,
      entries: [{ binding: 0, resource: { buffer: this.uniforms, size: SLOT_BYTES } }],
    });
  }

  /**
   * Start a frame. `count` = how many draws will follow, so the slot buffer
   * can grow before any of them is recorded.
   */
  begin(eye, count) {
    if (count > this.capacity) this.#allocate(Math.max(count, this.capacity * 2));
    this.slot = 0;
    this.eye = eye;
  }

  /**
   * @param {GPURenderPassEncoder} pass
   * @param {Mesh} mesh
   * @param {Float32Array} viewProj  P · V
   * @param {Float32Array} model     M (object → world)
   * @param {number[]} colour        linear [r, g, b, a]; a < 1 uses the transparent pipeline
   */
  draw(pass, mesh, viewProj, model, colour) {
    const k = this.slot++;
    const f = this.staging;
    f.set(mat4.multiply(viewProj, model), 0);
    f.set(model, 16);
    f.set(mat4.normalMatrix(model), 32);
    f.set([colour[0], colour[1], colour[2], colour[3] ?? 1], 48);
    f.set([this.eye[0], this.eye[1], this.eye[2], 1], 52);
    this.gpu.device.queue.writeBuffer(this.uniforms, k * this.stride, f);

    pass.setPipeline((colour[3] ?? 1) < 1 ? this.transparent : this.opaque);
    pass.setBindGroup(0, this.bindGroup, [k * this.stride]);
    pass.setVertexBuffer(0, mesh.buffer);
    pass.draw(mesh.count);
    this.renderer.countDraw(mesh.count);
  }
}
