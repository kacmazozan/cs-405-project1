# CS405 Project 1 — Transformations, Projection & Curves from Paintings

A WebGPU application that places 3D objects in front of a painting from the
Sakıp Sabancı Museum collection, views them through a camera built from our
own matrices, and lets you trace the painting with editable curves.
All maths (vectors, matrices, projections, curves) is written from scratch
in `src/math/`; no maths or 3D libraries are used.

## Running

Requirements: **Node.js 20.19+** and a browser with WebGPU (current Chrome or
Edge, Safari 26+, Firefox 141+ on Windows).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (node --test)
npm run build      # static build in dist/
```

Choose the painting in the panel, or with `?painting=<id>` in the URL
(`kavunlu`, `kabatas`, `moda`, `selim-turbesi`, `ormanda-karaca`).

## Mouse

| Action | Effect |
|---|---|
| left-drag on empty space | orbit the camera around its target (quaternion rotation, elevation clamped at ±89°) |
| drag inside the inset (top left) | always moves the main camera, never a curve point |
| right- or middle-drag | pan (move eye and target together) |
| mouse wheel | zoom (perspective: dolly; orthographic: change the visible height) |
| shift + click on the painting | add a curve control point (keep dragging to place it) |
| drag a control point | move it (Bézier: the joint stays C¹) |
| alt + click a control point | delete it (on a Bézier handle: deletes its anchor) |
| left-drag on the painting, *freehand trace* on | draw a stroke; release to fit a curve to it (bonus) |

## Panel

**Painting** — choose the painting. Each painting keeps its own curve.

**C · Camera**
- *look through* — the main camera, or a fixed **inspection camera** that shows
  the main camera's frustum: yellow edges, near plane blue, far plane red, and in
  white the cross-section at the target's depth (what fills the main camera's screen).
  The mouse keeps moving the main camera, so you can watch its frustum move.
- *inset: the other camera* — draws the camera you are not looking through in a
  small view at the top left (on by default: the main view with the inspection
  camera and its frustum next to it).
- *projection* — perspective / orthographic.
- *fov y*, *near*, *far*, *ortho height* — projection parameters (near 0.1 and
  far 10 by default; see the report for the depth-precision reasoning).
- *front / three-quarter / side / top* — preset views. The camera flies there
  smoothly (quaternion slerp of its orientation). *top* looks straight down with
  up parallel to the view direction, which tests the `lookAt` fallback.
- The readout shows eye, target, fov, near and far.

**C · Matrices** (collapsed) — the current view matrix V and projection matrix P.

**Scene** — show or hide the Part A objects and the robot arm; *debug axes*
draws the local frame of every node (x red, y green, z blue; the axes are drawn at
one length, so a node's scale does not hide them).

**Scene graph** (collapsed) — the whole node tree with each node's local transform
(○ = transform-only node, ■ = node with a mesh), updated live while the arm moves.

**A · Transforms** — the orange cube is placed with the chosen *order*, and
the transparent blue *ghost* with the other order:
- *translate x/y/z*, *rotation axis*, *angle*, *scale x/y/z* — the T, R and S parameters.
- *spin* animates the angle.
- Both T·R·S and S·R·T are printed as 4×4 matrices.

**B · Scene graph (robot arm)** — the arm carries a fruit (a child of the wrist).
*animate*, or set the *turret yaw*, *shoulder*, *elbow*, *wrist* and *grip* angles
by hand. The readout shows the world matrix of the leaf node `tip` (the product of
every matrix along the chain) and its position.

**D · Bézier & de Casteljau** — one cubic Bézier with four control points
P0…P3 on the painting (on *kavunlu* it traces the top contour of the melon;
drag the points to move them).
- *on the painting* — show this single Bézier, the piecewise curve below, or both.
- *degree* — cubic (4 control points, what the project asks for) or quadratic
  (3 control points) to compare. A Bézier of degree n has n + 1 control points;
  going from quadratic back to cubic uses degree elevation, which is exact.
- *t* — the curve parameter t ∈ [0, 1]; *animate t* sweeps it back and forth.
- de Casteljau's construction at t is always drawn (cubic): grey = control polygon
  (level 0), green = level 1 (3 points), blue = level 2 (2 points, the segment is
  tangent to the curve), red = B(t). *tangent at t* adds B′(t)/n in pink.
- The readout shows the Bernstein weights at t, the point computed as
  Σ Bᵢ(t)·Pᵢ and by de Casteljau (with their difference), a check that
  B′(t) = n·(last level's segment), and the (u, v) of the hovered point.

**D · Curves** — the piecewise curve (on *kavunlu*: the outline of the melon slice).
- *kind* — `bezier-c1`, `catmull-rom` or `bspline`. The Catmull–Rom spline passes
  through every control point (an open one repeats its end points, so the first
  and last point are on the curve too); the uniform B-spline approximates them.
  Converting a spline to Bézier is exact; Catmull-Rom ↔ B-spline keeps the control
  points, so the same points can be compared interpolated vs approximated.
- *closed* — close or open the curve.
- *edit with the mouse* — turns the mouse editing above on or off.
- *control polygon*, *de Casteljau construction*, *tangent* — what is drawn at
  the current position (the construction works on every kind, through its Bézier
  form; it is off by default because the single Bézier above already shows it).
- *follower object* — a cone that rides along the curve, oriented by the tangent.
- *animate*, *position* — the global parameter u ∈ [0, 1] (segment i covers [i/n, (i+1)/n]).
- *constant speed (arc length)* — re-parametrise by arc length so the follower moves at constant speed.
- *samples / segment* — how finely the curve is drawn.
- The readout shows the kind, segment count, whether the Bézier joints are C¹,
  u → (segment, t), and the (u, v) of the hovered or dragged point.
- *export JSON* / *import JSON* — save or load the curve (format below).
  *reset curve* restores the preset, *clear* removes all points.

**Bonus · fitting & surfaces**
- *freehand trace* — drag over the painting to draw a stroke; on release a C¹
  piecewise Bézier with *fit segments* segments is fitted to it by least squares
  and becomes the curve (a stroke that ends near its start gives a closed curve).
  The stroke stays visible in pink; the RMS error in painting pixels is shown in
  the D readout. Turn it off to edit the fitted control points.
- *swept surface* — builds a mesh from the curve: *revolve* about a horizontal or
  vertical axis through the curve's centroid (placed in front of the painting), or
  *extrude* it out of the painting by *extrude depth*. It updates while you edit.

**View** — *reset* restores the camera, the objects and the curve settings.
The stats box shows frame time, CPU time, draw calls and vertices per frame.

## Deliverables in this repository

- `curves/kavunlu-curve.json` — the exported curve (outline of the melon slice).
- `report/report.pdf` — the report. Its source is `report/report.html` (with the
  screenshots in `report/img/`): open it in Chrome or Edge, *Print → Save as PDF*,
  A4, default margins, "Background graphics" on. Places still to fill in are yellow.

## Curve export format

Control points are in normalised painting coordinates (u, v ∈ [0, 1], origin
top-left, v down): `u = (x + a) / (2a)`, `v = (1 − y) / 2`, with a = width / height.

```json
{ "painting": "kavunlu", "kind": "bezier-c1", "closed": true,
  "segments": [[[0.186, 0.632], [0.204, 0.712], [0.33, 0.814], [0.47, 0.818]], …] }
```

Catmull-Rom and B-spline curves use `"points": [[u, v], …]` instead. `"closed"` is
an extra key (readers that do not know it can ignore it); without it a closed
spline could not be told apart from an open one. A closed Bézier curve's last P3
equals its first P0.

## Code structure

| Path | Contents |
|---|---|
| `src/math/vec3.js`, `mat4.js` | vectors; matrices, rigid inverse, normal matrix, lookAt, WebGPU projections |
| `src/math/quat.js` | quaternions: axis-angle, product, rotation, from basis, slerp (bonus) |
| `src/math/fit.js` | least-squares Bézier fitting, Newton reparametrisation, C¹ piecewise fit (bonus) |
| `src/scene/sweep.js` | surface of revolution and extrusion of a curve (bonus) |
| `src/math/curves.js` | Bernstein / Bézier, de Casteljau, C¹ joints, Catmull–Rom, B-spline, basis conversions |
| `src/scene/node.js` | scene-graph node, `world = parent.world · local` |
| `src/scene/camera.js` | camera data, P·V, orbit / zoom / pan, preset views, inspection camera and frustum, screen ray for picking |
| `src/scene/scene.js` | builds the scene graph and draws it |
| `src/scene/objects.js` | Part A objects and the T·R·S demo |
| `src/scene/arm.js` | Part B robot arm |
| `src/scene/curve.js` | curve model: evaluation, C¹ editing, conversions, arc length, presets |
| `src/scene/bezierDemo.js` | Part D: one cubic Bézier, de Casteljau at an adjustable t |
| `src/scene/curveEditor.js` | Part D: piecewise curve editor, drawing, follower |
| `src/scene/picking.js` | mouse ray → painting plane, screen-space point picking |
| `src/scene/curveExport.js` | JSON export / import |
| `src/scene/shapes.js`, `geometry.js` | sphere, cylinder, cone; cube, axes |
| `src/render/mesh.js` | lit mesh pipeline; one uniform slot per draw (dynamic offsets) |
| `src/render/overlay.js` | thick lines and point markers (instanced quads) |
| `src/render/renderer.js` | provided frame pass, plus `renderInset()` for the picture-in-picture view |
| `src/render/*` (others) | WebGPU setup, painting, textures, sRGB handling (provided) |
| `src/ui/*` | panel, stats, pointer events (provided) |
| `tests/` | unit tests (`curve.test.js`, `camera.test.js`, `bonus.test.js` and `bezierDemo.test.js` are ours, the rest are the course's) |

### Scene graph

```
world
├─ objects
│  ├─ melon (ellipsoid) · pedestal · cone       fixed, each T·R·S
│  ├─ T·R·S demo                                 chosen order
│  └─ other order (ghost)
├─ arm
│  ├─ base
│  └─ turret (Ry yaw)
│     ├─ turret mesh
│     └─ shoulder (Rz)
│        ├─ shoulder joint · upper arm
│        └─ elbow (Rz)
│           ├─ elbow joint · forearm
│           └─ wrist (Rz)
│              ├─ wrist joint · palm · tip · held fruit
│              ├─ finger L (Rz grip) ── mesh
│              └─ finger R (Rz −grip) ── mesh
├─ curve follower
└─ swept surface (bonus)
```

28 nodes on 8 levels. Joint nodes hold only rotation + translation; the scale
that shapes each link lives in a leaf mesh node, so it does not stretch the nodes
below it. The fruit is a child of the wrist, so the arm carries it.
