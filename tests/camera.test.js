// Extra tests for src/scene/camera.js: frustum drawing and picking rays.
import { test } from 'node:test';
import { createCamera, frustumLines, screenRay, intersectZPlane, viewProjection } from '../src/scene/camera.js';
import { closeArr, project } from './helpers.js';

const aspect = 1.6;

for (const projection of ['perspective', 'orthographic']) {
  const cam = { ...createCamera(), eye: [1.5, 0.8, 2.5], target: [0.2, -0.1, 0], projection };
  const PV = viewProjection(cam, aspect).matrix;

  test(`${projection}: frustum corners land on the clip-space box corners`, () => {
    const { near, far } = frustumLines(cam, aspect);
    const xy = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    near.forEach((p, i) => closeArr(project(PV, p), [...xy[i], 0], 1e-4));
    far.forEach((p, i) => closeArr(project(PV, p), [...xy[i], 1], 1e-4));
    // the cross-section at the target's depth also maps onto the screen's corners
    frustumLines(cam, aspect).section.forEach((p, i) => closeArr(project(PV, p).slice(0, 2), xy[i], 1e-4));
  });

  test(`${projection}: a screen ray hits the painting plane where that pixel shows it`, () => {
    const ndc = [0.3, -0.45];
    const hit = intersectZPlane(screenRay(cam, aspect, ndc), 0);
    closeArr(project(PV, hit).slice(0, 2), ndc, 1e-4);
  });
}
