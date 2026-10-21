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
import { createCamera, viewProjection, orbit, zoom, pan, setView, VIEWS } from './scene/camera.js';
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
  // what the scene needs for picking: the camera and this frame's P · V
  const view = { camera, canvas, aspect: 1, viewProj: mat4.identity() };

  const cf = panel.folder('C · Camera');
  const camStatus = cf.text('');
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
    scene.reset();
  });
  vf.note(gpu.encodeSRGB ? 'sRGB: encoded in shader (fallback)' : 'sRGB: canvas -srgb view');

  /* -------------- input --------------- */
  // A press either grabs a curve point (Part D) or moves the camera (Part C).
  let mode = null;
  attachPointer(canvas, {
    down(e) {
      if (scene.pointerDown(e)) mode = 'scene';
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
    move(e) { scene.pointerMove(e); },
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

    scene.update(dt, now / 1000);

    const aspect = canvas.width / canvas.height;
    const vp = viewProjection(camera, aspect, painting.aspect);
    view.aspect = aspect;
    view.viewProj = vp.matrix;
    camStatus.set(vp.fallback
      ? `PLACEHOLDER view (no camera yet)\n${vp.missing}`
      : `camera: P · V (${camera.projection})`);
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
      scene.draw(pass, vp.matrix);
    });

    stats.end(renderer.stats);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  showFatal(e.message ?? String(e));
});
