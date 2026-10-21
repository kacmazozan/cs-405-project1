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
| left-drag on empty space | orbit the camera around its target |
| right- or middle-drag | pan (move eye and target together) |
| mouse wheel | zoom (perspective: dolly; orthographic: change the visible height) |
| shift + click on the painting | add a curve control point (keep dragging to place it) |
| drag a control point | move it (Bézier: the joint stays C¹) |
| alt + click a control point | delete it (on a Bézier handle: deletes its anchor) |

## Panel

**Painting** — choose the painting. Each painting keeps its own curve.

**C · Camera**
- *projection* — perspective / orthographic.
- *fov y*, *near*, *far*, *ortho height* — projection parameters.
- *front / three-quarter / side / top* — preset views. *top* looks straight
  down with up parallel to the view direction, which tests the `lookAt` fallback.
- The readout shows eye, target, fov, near and far.

**C · Matrices** (collapsed) — the current view matrix V and projection matrix P.

**Scene** — show or hide the Part A objects and the robot arm; *debug axes*
draws the local frame of every transform node (x red, y green, z blue).

**Scene graph** (collapsed) — the whole node tree (○ = transform-only node, ■ = node with a mesh).

**A · Transforms** — the orange cube is placed with the chosen *order*, and
the transparent blue *ghost* with the other order:
- *translate x/y/z*, *rotation axis*, *angle*, *scale x/y/z* — the T, R and S parameters.
- *spin* animates the angle.
- Both T·R·S and S·R·T are printed as 4×4 matrices.

**B · Scene graph (robot arm)** — *animate*, or set the *turret yaw*,
*shoulder*, *elbow*, *wrist* and *grip* angles by hand. The readout shows the
gripper tip's world position (product of every matrix along the chain).

**D · Curves**
- *kind* — `bezier-c1`, `catmull-rom` or `bspline`. Converting a spline to
  Bézier is exact; Catmull-Rom ↔ B-spline keeps the control points, so the
  same points can be compared interpolated vs approximated.
- *closed* — close or open the curve.
- *edit with the mouse* — turns the mouse editing above on or off.
- *control polygon*, *de Casteljau construction*, *tangent* — what is drawn at
  the current position (the construction works on every kind, through its Bézier form).
- *follower object* — a cone that rides along the curve, oriented by the tangent.
- *animate*, *position* — the global parameter u ∈ [0, 1] (segment i covers [i/n, (i+1)/n]).
- *constant speed (arc length)* — re-parametrise by arc length so the follower moves at constant speed.
- *samples / segment* — how finely the curve is drawn.
- The readout shows the kind, segment count, whether the Bézier joints are C¹,
  u → (segment, t), and the (u, v) of the hovered or dragged point.
- *export JSON* / *import JSON* — save or load the curve (format below).
  *reset curve* restores the preset, *clear* removes all points.

**View** — *reset* restores the camera, the objects and the curve settings.
The stats box shows frame time, CPU time, draw calls and vertices per frame.

## Curve export format

Control points are in normalised painting coordinates (u, v ∈ [0, 1], origin
top-left, v down): `u = (x + a) / (2a)`, `v = (1 − y) / 2`, with a = width / height.

```json
{ "painting": "kavunlu", "kind": "bezier-c1",
  "segments": [[[0.186, 0.632], [0.204, 0.712], [0.33, 0.814], [0.47, 0.818]], …] }
```

Catmull-Rom and B-spline curves use `"points": [[u, v], …]` instead. A closed
spline is exported "unrolled" (last point first, the first two points again at
the end), so evaluating `points` as an open spline gives the same closed curve.
A closed Bézier curve's last P3 equals its first P0.

## Code structure

| Path | Contents |
|---|---|
| `src/math/vec3.js`, `mat4.js` | vectors; matrices, rigid inverse, normal matrix, lookAt, WebGPU projections |
| `src/math/curves.js` | Bernstein / Bézier, de Casteljau, C¹ joints, Catmull–Rom, B-spline, basis conversions |
| `src/scene/node.js` | scene-graph node, `world = parent.world · local` |
| `src/scene/camera.js` | camera data, P·V, orbit / zoom / pan, preset views, screen ray for picking |
| `src/scene/scene.js` | builds the scene graph and draws it |
| `src/scene/objects.js` | Part A objects and the T·R·S demo |
| `src/scene/arm.js` | Part B robot arm |
| `src/scene/curve.js` | curve model: evaluation, C¹ editing, conversions, arc length, presets |
| `src/scene/curveEditor.js` | Part D UI, picking, drawing, follower |
| `src/scene/curveExport.js` | JSON export / import |
| `src/scene/shapes.js`, `geometry.js` | sphere, cylinder, cone; cube, axes |
| `src/render/mesh.js` | lit mesh pipeline; one uniform slot per draw (dynamic offsets) |
| `src/render/overlay.js` | thick lines and point markers (instanced quads) |
| `src/render/*` (others) | WebGPU setup, painting, textures, sRGB handling (provided) |
| `src/ui/*` | panel, stats, pointer events (provided) |
| `tests/` | unit tests (`curve.test.js` is ours, the rest are the course's) |

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
│              ├─ wrist joint · palm · tip
│              ├─ finger L (Rz grip) ── mesh
│              └─ finger R (Rz −grip) ── mesh
└─ curve follower
```

Joint nodes hold only rotation + translation; the scale that shapes each link
lives in a leaf mesh node, so it does not stretch the nodes below it.
