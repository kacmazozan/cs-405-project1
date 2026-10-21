# CS405 Project 1 — Transformations, Projection & Curves from Paintings

Starter code for Project 1 (Fall 2026). Read the handout `CS405_Project1_2026.docx`
for the rules, deliverables and grading, and `Project1/index.html` for the live
demos of each part.

> **Replace this README** with your own before you submit (Part E): how to run
> your application and what every control does.

## 1. Getting started

Requirements: **Node.js 20.19 or newer** (`node -v`) and a browser with WebGPU —
current Chrome or Edge, Safari 26+, or Firefox 141+ on Windows.

```bash
npm install
npm run dev        # opens http://localhost:5173
npm test           # unit tests for your maths (they fail until you implement it)
```

You should see your painting and a panel on the right with a frame-time counter.
The Camera box says **PLACEHOLDER view** until `lookAt`, `perspective` and
`multiply` work; after that it switches to your camera on its own.

## 2. Putting it on GitHub

The project is submitted as a GitHub repository. Keep it **private** until the
deadline (sharing code is not allowed), and give the course staff access as
announced on SUCourse.

```bash
git init
git add .
git commit -m "CS405 Project 1 starter"
git branch -M main
git remote add origin https://github.com/<you>/cs405-project1.git
git push -u origin main
```

At the end: `git tag project1-final && git push origin project1-final`.
The tag's timestamp is what gets graded.

## 3. What is provided and what is yours

| Path | Status | Part |
|---|---|---|
| `src/render/gpu.js` | provided — device, canvas, sRGB output, resize | |
| `src/render/renderer.js` | provided — one render pass per frame with depth; vertex counter | E |
| `src/render/painting.js` | provided — the painting as a textured quad; **a complete example draw** | |
| `src/render/texture.js` | provided — image → `rgba8unorm-srgb` texture with mipmaps | |
| `src/render/shaders/*.wgsl` | provided — `toOutput()` for correct sRGB | |
| `src/ui/panel.js`, `stats.js`, `input.js` | provided — panel, frame time, pointer events | E |
| `src/scene/geometry.js` | provided — cube and axes vertex data | |
| `src/math/vec3.js` | **TODO** | A, C |
| `src/math/mat4.js` | **TODO** — `format()` is provided | A, C |
| `src/math/curves.js` | **TODO** | D |
| `src/scene/node.js` | **TODO** `updateWorld()` | B |
| `src/scene/camera.js` | uses your `mat4`; you add orbit controls in `main.js` | C |
| `src/scene/scene.js` | **yours** — objects, scene graph, curves | A, B, D |
| `src/scene/curveExport.js` | **TODO** `curveToJSON()`; `downloadJSON()` is provided | D |
| `src/main.js` | wiring and render loop — you will extend it | C, E |

Every function you still have to write throws `NotImplemented` ("TODO: implement …").
Keep the folder split `math/ scene/ render/ ui/` (Part E grades code structure).
You may add files.

## 4. Conventions — the tests check these

- Matrices are `Float32Array(16)`, **column-major**: element (row r, col c) is at `c*4 + r`;
  translation sits at indices 12, 13, 14. This is exactly what you upload to a WGSL `mat4x4f`.
- Column vectors: `p' = M · p`. `multiply(A, B)` is `A·B`, so `B` acts first.
- Right-handed world; angles in **radians**; `rotateZ(π/2)` takes +x to +y.
- View space: camera at the origin looking down **−z**, +y up.
- Clip space is **WebGPU's**: after dividing by w, x, y ∈ [−1, 1] and **z ∈ [0, 1]**
  (near → 0, far → 1). OpenGL's [−1, 1] depth formulas fail the tests.
- The painting quad: centred at the origin in the plane z = 0, y ∈ [−1, 1],
  x ∈ [−a, a] with a = image width / height. "In front of the painting" means z > 0.
- Colour: shaders work in **linear** RGB and return `toOutput(colour)`. Textures
  you load with `textureFromBitmap()` are sRGB and decode to linear automatically.

## 5. Tests

`npm test` runs `tests/*.test.js` with Node's built-in test runner (no extra
packages). `npm run test:watch` re-runs them when you save. Until you implement
a function its tests fail with `TODO: implement <name>`; the goal is all green.
For the second curve family, implement `catmullRom` **or** `bspline` (+ `bsplineBasis`);
the tests skip the one you leave out.

The tests check the conventions, not your whole project: passing them is
necessary, not sufficient. Do not edit the tests to make them pass.

## 6. Drawing your own objects

`render/painting.js` is a full, small example: vertex buffer → uniform buffer →
bind group → pipeline → `draw()`. Copy its structure for a mesh pipeline
(`scene/geometry.js` gives you a cube with normals). Two things that catch people out:

- `queue.writeBuffer()` calls all run **before** the frame's commands. Objects
  that share one uniform buffer all see the last value. Use one uniform buffer
  per object (or one big buffer with dynamic offsets).
- Every pipeline that draws to the canvas needs
  `targets: [{ format: gpu.viewFormat }]`, `constants: fragmentConstants(gpu)` in its
  fragment stage, and `depthStencil: { format: DEPTH_FORMAT, … }`. Build shaders with
  `createShader()` so `toOutput()` is available.

Call `renderer.countDraw(vertexCount)` after each draw so the vertex counter is right.

## 7. Choosing a painting

Pick one in the panel, with `?painting=<id>` in the URL, or set `DEFAULT_PAINTING`
in `src/config.js`. Bundled: `kavunlu`, `kabatas`, `moda`, `selim-turbesi`,
`ormanda-karaca`. To use another painting from the Sakıp Sabancı Museum collection,
put the image in `public/paintings/` (long side about 1280 px) and add an entry
to `PAINTINGS` in `src/config.js`.

## 8. Curve export format (Part D)

See the comment at the top of `src/scene/curveExport.js`. Control points are in
normalised painting coordinates (u, v ∈ [0, 1], origin top-left, v down).

## 9. Troubleshooting

- **"This browser has no WebGPU"**: update the browser; serve from `localhost`
  (opening `index.html` as a file does not work). Linux Chrome may need
  `chrome://flags/#enable-unsafe-webgpu` and `#enable-vulkan`.
- **Black or blank canvas, no error on the page**: open the browser console. WGSL
  errors are printed with line numbers that match your `.wgsl` file.
- **Everything is too dark or washed out**: you encoded sRGB twice, or not at all.
  Return `toOutput(linearColour)`; do not apply gamma yourself.
- **Objects disappear when the camera moves**: check near/far and that your
  perspective maps depth to [0, 1], not [−1, 1].
