/**
 * Overlay: thick lines and round point markers in world space (curves,
 * control polygons, de Casteljau construction, debug axes).
 *
 * Usage, every frame:
 *   overlay.line(a, b, colour, width)        // a, b: [x, y, z] world
 *   overlay.polyline(points, colour, width)
 *   overlay.point(p, colour, size)
 *   overlay.draw(pass, viewProj)             // uploads, draws, clears
 *
 * Widths and sizes are in CSS pixels. Everything queued is batched into one
 * instanced draw per kind, so a curve with hundreds of samples costs one draw.
 */
import overlayWGSL from './shaders/overlay.wgsl?raw';
import { createShader, fragmentConstants } from './shader.js';
import { DEPTH_FORMAT } from './renderer.js';

const LINE_FLOATS = 10; // a xyz, b xyz, colour rgb, width
const POINT_FLOATS = 7; // pos xyz, colour rgb, size

/** A growable instance buffer: CPU array + GPU vertex buffer. */
class Batch {
  constructor(device, floats, label) {
    this.device = device;
    this.floats = floats;
    this.label = label;
    this.data = new Float32Array(floats * 256);
    this.count = 0;
    this.buffer = null;
  }

  push(...values) {
    if ((this.count + 1) * this.floats > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data.set(values, this.count * this.floats);
    this.count++;
  }

  upload() {
    const bytes = this.count * this.floats * 4;
    if (!this.buffer || this.buffer.size < bytes) {
      this.buffer?.destroy();
      this.buffer = this.device.createBuffer({
        label: this.label,
        size: Math.max(bytes, this.data.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.buffer, 0, this.data, 0, this.count * this.floats);
  }
}

export class Overlay {
  constructor(gpu, renderer) {
    const { device } = gpu;
    this.gpu = gpu;
    this.renderer = renderer;

    this.uniforms = device.createBuffer({
      label: 'overlay uniforms',
      size: 80, // mat4x4f + vec4f
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    this.bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniforms } }] });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const module = createShader(device, overlayWGSL, 'overlay');

    const pipeline = (label, vs, fs, attributes, stride, onTop) => device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module, entryPoint: vs, buffers: [{ arrayStride: stride, stepMode: 'instance', attributes }] },
      fragment: { module, entryPoint: fs, targets: [{ format: gpu.viewFormat }], constants: fragmentConstants(gpu) },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      // depth-tested lines hide behind objects; "on top" ones are drawn last and always pass
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: onTop ? 'always' : 'less-equal' },
    });
    const lineAttrs = [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' },
      { shaderLocation: 3, offset: 36, format: 'float32' },
    ];
    const pointAttrs = [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32' },
    ];
    this.linePipeline = pipeline('overlay lines', 'vsLine', 'fsLine', lineAttrs, LINE_FLOATS * 4, false);
    this.lineTopPipeline = pipeline('overlay lines (on top)', 'vsLine', 'fsLine', lineAttrs, LINE_FLOATS * 4, true);
    this.pointPipeline = pipeline('overlay points', 'vsPoint', 'fsPoint', pointAttrs, POINT_FLOATS * 4, true);

    this.lines = new Batch(device, LINE_FLOATS, 'overlay lines');
    this.linesOnTop = new Batch(device, LINE_FLOATS, 'overlay lines (on top)');
    this.points = new Batch(device, POINT_FLOATS, 'overlay points');
  }

  /** Device pixels per CSS pixel, so widths look the same on every screen. */
  get #dpr() {
    const c = this.gpu.canvas;
    return c.clientWidth > 0 ? c.width / c.clientWidth : 1;
  }

  /** One segment. `onTop`: ignore depth (debug axes, constructions). */
  line(a, b, colour, width = 2, onTop = false) {
    (onTop ? this.linesOnTop : this.lines).push(...a, ...b, ...colour, width * this.#dpr);
  }

  polyline(points, colour, width = 2, onTop = false, closed = false) {
    for (let i = 0; i + 1 < points.length; i++) this.line(points[i], points[i + 1], colour, width, onTop);
    if (closed && points.length > 2) this.line(points[points.length - 1], points[0], colour, width, onTop);
  }

  /** A round marker, `size` = diameter in CSS pixels; always drawn on top. */
  point(p, colour, size = 10) {
    this.points.push(...p, ...colour, size * this.#dpr);
  }

  /** Upload everything queued this frame, draw it, and start empty again. */
  draw(pass, viewProj) {
    const { device, canvas } = this.gpu;
    device.queue.writeBuffer(this.uniforms, 0, viewProj);
    device.queue.writeBuffer(this.uniforms, 64, new Float32Array([canvas.width, canvas.height, 0, 0]));

    for (const [batch, pipe] of [
      [this.lines, this.linePipeline],
      [this.linesOnTop, this.lineTopPipeline],
      [this.points, this.pointPipeline],
    ]) {
      if (batch.count === 0) continue;
      batch.upload();
      pass.setPipeline(pipe);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, batch.buffer);
      pass.draw(6, batch.count);
      this.renderer.countDraw(6, batch.count);
      batch.count = 0;
    }
  }
}
