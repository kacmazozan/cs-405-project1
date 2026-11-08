/**
 * Entry point: wires GPU, painting, camera, scene and UI together and runs
 * the render loop. You will edit this file a little (camera controls, views);
 * most of your work goes into src/math/ and src/scene/.
 *
 *   p_clip = P · V · M · p_object
 */
import './ui/style.css';
import { initWebGPU, showFatal } from './render/gpu.js';
import { Renderer } from './render/renderer.js';
import { Painting } from './render/painting.js';
import {
  createCamera, createInspectionCamera, viewProjection, frustumLines, orbit, zoom, pan, setView, updateCamera, VIEWS,
} from './scene/camera.js';
import { hex } from './render/colour.js';
import { createScene } from './scene/scene.js';
import { createPanel } from './ui/panel.js';
import { Stats } from './ui/stats.js';
import { attachPointer } from './ui/input.js';
import { PAINTINGS, DEFAULT_PAINTING, paintingURL } from './config.js';
import * as mat4 from './math/mat4.js';

async function main() {
  const canvas = document.getElementById('gfx');
  const gpu = await initWebGPU(canvas);
  const renderer = new Renderer(gpu);
  const painting = new Painting(gpu);

  const params = new URLSearchParams(location.search);
  let current = PAINTINGS.find((p) => p.id === params.get('painting'))
    ?? PAINTINGS.find((p) => p.id === DEFAULT_PAINTING);
  await painting.load(paintingURL(current));

  /* ---------------- UI ---------------- */
  const panelRoot = document.getElementById('panel');
  const panel = createPanel(panelRoot);
  const title = document.createElement('h1');
  title.textContent = 'CS405 · Project 1';
  panelRoot.appendChild(title);
  const stats = new Stats(panelRoot);

  const pf = panel.folder('Painting');
  pf.select('painting', PAINTINGS.map((p) => ({ value: p.id, label: `${p.artist} — ${p.title}` })), current.id,
    async (id) => {
      current = PAINTINGS.find((p) => p.id === id);
      await painting.load(paintingURL(current));
      scene.setPainting(id);
      history.replaceState(null, '', `?painting=${id}`);
    });

  const camera = createCamera();
  // Part C: a second, fixed camera that shows the main camera and its frustum.
  // The mouse always moves the MAIN camera, so you can watch its frustum follow.
  // One of the two fills the canvas; the other one is drawn in a small inset.
  const inspection = createInspectionCamera();
  const views = { active: 'main camera', inset: true };
  // what the scene needs for picking: the camera we render with and this frame's P · V
  const view = { camera, canvas, aspect: 1, viewProj: mat4.identity() };

  const cf = panel.folder('C · Camera');
  const camStatus = cf.text('');
  const viewSel = cf.select('look through', ['main camera', 'inspection camera'], views.active, (v) => (views.active = v));
  const insetToggle = cf.toggle('inset: the other camera', views, 'inset');
  const projSel = cf.select('projection', ['perspective', 'orthographic'], camera.projection, (v) => (camera.projection = v));
  const camUI = { fovDeg: camera.fovY * 180 / Math.PI };
  const camSliders = [
    cf.slider('fov y (°)', camUI, 'fovDeg', 10, 120, 1, (v) => (camera.fovY = v * Math.PI / 180)),
    cf.slider('near', camera, 'near', 0.01, 2, 0.01),
    cf.slider('far', camera, 'far', 3, 200, 1),
    cf.slider('ortho height', camera, 'orthoHeight', 0.2, 10, 0.05),
  ];
  for (const name of Object.keys(VIEWS)) cf.button(name, () => setView(camera, name));
  cf.note('drag: orbit · right/middle-drag: pan · wheel: zoom');
  const camReadout = cf.text('');
  const mf = panel.folder('C · Matrices', { open: false });
  mf.note('V = lookAt(eye, target, up)');
  const viewText = mf.text('');
  mf.note('P (WebGPU depth 0…1)');
  const projText = mf.text('');

  const scene = createScene({ gpu, renderer, painting, panel, view, paintingId: current.id });

  const vf = panel.folder('View');
  vf.button('reset', () => {
    Object.assign(camera, createCamera());
    camUI.fovDeg = camera.fovY * 180 / Math.PI;
    camSliders.forEach((s) => s.update());
    projSel.set(camera.projection);
    views.active = 'main camera';
    views.inset = true;
    viewSel.set(views.active);
    insetToggle.update();
    scene.reset();
  });
  vf.note('reset: back to the start-up state — camera, every checkbox, slider and selection, and the curves (export a curve first to keep it).');
  vf.note(gpu.encodeSRGB ? 'sRGB: encoded in shader (fallback)' : 'sRGB: canvas -srgb view');

  /** The inset's rectangle: top-left corner, 30 % of the width, same aspect as the canvas. */
  function insetRect() {
    const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
    const w = Math.max(16, Math.round(canvas.width * 0.3));
    const h = Math.max(16, Math.round((w * canvas.height) / canvas.width));
    const m = Math.round(10 * dpr);
    return { x: m, y: m, w, h, dpr };
  }
  const inInset = (px) => {
    if (!views.inset) return false;
    const r = insetRect();
    const x = px[0] * r.dpr, y = px[1] * r.dpr;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  };

  /* -------------- input --------------- */
  // A press either grabs a curve point (Part D) or moves the camera (Part C).
  // Inside the inset a drag always moves the main camera.
  let mode = null;
  attachPointer(canvas, {
    down(e) {
      if (!inInset(e.px) && scene.pointerDown(e)) mode = 'scene';
      else mode = e.button === 0 ? 'orbit' : 'pan';
    },
    drag(e) {
      if (mode === 'scene') scene.pointerDrag(e);
      else if (mode === 'orbit') orbit(camera, -e.dx * 0.008, e.dy * 0.008);
      else if (mode === 'pan') pan(camera, (2 * e.dx) / canvas.clientWidth, (-2 * e.dy) / canvas.clientHeight, view.aspect);
    },
    up(e) {
      if (mode === 'scene') scene.pointerUp(e);
      mode = null;
    },
    move(e) { scene.pointerMove(inInset(e.px) ? { ...e, px: [-1e6, -1e6] } : e); },
    wheel(e) {
      zoom(camera, Math.exp(e.delta * 0.001));
      camSliders[3].update();
    },
  });

  /* ------------ render loop ----------- */
  let last = performance.now();
  function frame(now) {
    stats.begin(now);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    updateCamera(camera, dt);
    scene.update(dt, now / 1000);

    const aspect = canvas.width / canvas.height;
    const inspecting = views.active === 'inspection camera';
    view.camera = inspecting ? inspection : camera;
    const vp = viewProjection(view.camera, aspect, painting.aspect);
    view.aspect = aspect;
    view.viewProj = vp.matrix;
    camStatus.set(vp.fallback
      ? `PLACEHOLDER view (no camera yet)\n${vp.missing}`
      : `view: ${inspecting ? 'INSPECTION camera' : 'main camera'}, P · V (${camera.projection})` +
        (inspecting ? '\nthe mouse still moves the main camera' : '') +
        (views.inset ? `\ninset: ${inspecting ? 'main' : 'inspection'} camera` : ''));
    camStatus.el.classList.toggle('warn', vp.fallback);
    camReadout.set(
      `eye    ${camera.eye.map((x) => x.toFixed(2)).join(', ')}\n` +
      `target ${camera.target.map((x) => x.toFixed(2)).join(', ')}\n` +
      `fovY ${(camera.fovY * 180 / Math.PI).toFixed(1)}°  near ${camera.near}  far ${camera.far}`
    );

    {
      viewText.set(mat4.format(mat4.lookAt(camera.eye, camera.target, camera.up)));
      projText.set(mat4.format(camera.projection === 'orthographic'
        ? mat4.orthographic(-camera.orthoHeight / 2 * aspect, camera.orthoHeight / 2 * aspect, -camera.orthoHeight / 2, camera.orthoHeight / 2, camera.near, camera.far)
        : mat4.perspective(camera.fovY, aspect, camera.near, camera.far)));
    }

    const paintingMVP = vp.fallback ? vp.matrix : mat4.multiply(vp.matrix, painting.model);
    renderer.render((pass) => {
      painting.draw(pass, paintingMVP, renderer);
      scene.draw(pass, vp.matrix, { extra: inspecting ? (overlay) => drawCamera(overlay, camera, aspect) : undefined });
    });

    // the other camera in a small inset, with the same aspect (so the frustum matches it)
    if (views.inset && !vp.fallback) {
      const rect = insetRect();
      const other = inspecting ? camera : inspection;
      const ivp = viewProjection(other, aspect, painting.aspect).matrix;
      renderer.renderInset(rect, (pass) => {
        painting.draw(pass, mat4.multiply(ivp, painting.model), renderer);
        scene.draw(pass, ivp, {
          eye: other.eye,
          viewport: [rect.w, rect.h],
          extra: inspecting ? undefined : (overlay) => drawCamera(overlay, camera, aspect),
        });
      });
    }

    stats.end(renderer.stats);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/** The main camera as seen from the inspection camera: its frustum, eye and view direction. */
const FRUSTUM = hex('#ffe066'), NEAR = hex('#5ad1ff'), FAR = hex('#ff7a7a');
function drawCamera(overlay, cam, aspect) {
  const { lines, near, far, section } = frustumLines(cam, aspect);
  for (const [a, b] of lines) overlay.line(a, b, FRUSTUM, 1.5, true);
  overlay.polyline(near, NEAR, 3, true, true);
  overlay.polyline(far, FAR, 3, true, true);
  overlay.polyline(section, hex('#ffffff'), 1.5, true, true); // the screen at the target's depth
  overlay.line(cam.eye, cam.target, hex('#ffffff'), 1, true);
  overlay.point(cam.eye, FRUSTUM, 12);
  overlay.point(cam.target, hex('#ffffff'), 7);
}

main().catch((e) => {
  console.error(e);
  showFatal(e.message ?? String(e));
});
