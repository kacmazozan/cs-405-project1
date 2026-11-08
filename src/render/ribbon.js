/**
 * Ribbon — the curve evaluated in a COMPUTE SHADER and drawn as a mesh (bonus).
 *
 * The CPU uploads only the control points. A compute pass then evaluates the
 * cubic Bézier with de Casteljau, builds a frame at every sample and writes
 * the ribbon's triangles into a buffer created with
 *     usage: STORAGE | VERTEX
 * so the very same buffer is bound as the vertex buffer of the mesh pipeline
 * in the frame that follows. Nothing is read back.
 *
 * `build()` records and submits its own command buffer. It is called from
 * scene.update() — before renderer.render() submits the frame — and only when
 * the curve or its settings actually changed, so a still curve costs nothing.
 */
import ribbonWGSL from './shaders/ribbon.wgsl?raw';
import { createComputeShader } from './shader.js';
import { packSegments, quadCount, vertexCount, floatCount } from '../math/ribbon.js';

const WORKGROUP = 64; // must match @workgroup_size in ribbon.wgsl
const PARAM_BYTES = 32; // 8 × 4 bytes, see struct Params

export class Ribbon {
  /** @param {{device: GPUDevice}} gpu */
  constructor(gpu, label = 'gpu ribbon') {
    const { device } = gpu;
    this.gpu = gpu;
    this.label = label;

    this.params = device.createBuffer({
      label: `${label} params`,
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.paramData = new ArrayBuffer(PARAM_BYTES);
    this.paramU32 = new Uint32Array(this.paramData);
    this.paramF32 = new Float32Array(this.paramData);

    this.pipeline = device.createComputePipeline({
      label,
      layout: 'auto',
      compute: { module: createComputeShader(device, ribbonWGSL, label), entryPoint: 'cs' },
    });

    this.ctrl = null;      // control points (storage)
    this.verts = null;     // the triangles (storage + vertex)
    this.bindGroup = null;
    /** Shaped like a render/mesh.js Mesh, so MeshRenderer can draw it. */
    this.mesh = { buffer: null, count: 0 };
  }

  #ensure(ctrlBytes, vertBytes) {
    const { device } = this.gpu;
    let changed = false;
    if (!this.ctrl || this.ctrl.size < ctrlBytes) {
      this.ctrl?.destroy();
      this.ctrl = device.createBuffer({
        label: `${this.label} control points`,
        size: Math.max(32, ctrlBytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      changed = true;
    }
    if (!this.verts || this.verts.size < vertBytes) {
      this.verts?.destroy();
      this.verts = device.createBuffer({
        label: `${this.label} vertices`,
        size: Math.max(144, vertBytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
      });
      this.mesh.buffer = this.verts;
      changed = true;
    }
    if (changed) {
      this.bindGroup = device.createBindGroup({
        label: this.label,
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.params } },
          { binding: 1, resource: { buffer: this.ctrl } },
          { binding: 2, resource: { buffer: this.verts } },
        ],
      });
    }
  }

  /**
   * Rebuild the ribbon on the GPU.
   * @param {number[][][]} segments  cubic Bézier segments [[P0, P1, P2, P3], …], points [x, y]
   * @param {object} o  { samples, halfWidth, twists, z }
   * @returns {number} the vertex count now in `this.mesh`
   */
  build(segments, { samples = 24, halfWidth = 0.03, twists = 0, z = 0.02 } = {}) {
    const { device } = this.gpu;
    const n = segments.length;
    const quads = quadCount(n, samples);
    if (quads === 0) { this.mesh.count = 0; return 0; }

    const packed = packSegments(segments);
    this.#ensure(packed.byteLength, floatCount(n, samples) * 4);

    this.paramU32[0] = n;
    this.paramU32[1] = samples;
    this.paramF32[2] = halfWidth;
    this.paramF32[3] = twists;
    this.paramF32[4] = z;
    this.paramF32[5] = 0;
    this.paramF32[6] = 0;
    this.paramF32[7] = 0;

    device.queue.writeBuffer(this.params, 0, this.paramData);
    device.queue.writeBuffer(this.ctrl, 0, packed);

    const encoder = device.createCommandEncoder({ label: `${this.label} compute` });
    const pass = encoder.beginComputePass({ label: `${this.label} pass` });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(quads / WORKGROUP));
    pass.end();
    device.queue.submit([encoder.finish()]);

    this.mesh.count = vertexCount(n, samples);
    return this.mesh.count;
  }

  destroy() {
    this.ctrl?.destroy();
    this.verts?.destroy();
    this.params?.destroy();
    this.mesh = { buffer: null, count: 0 };
  }
}
