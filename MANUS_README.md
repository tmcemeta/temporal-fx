# Temporal FX — Technical Reference

**Prepared by:** Manus AI
**Date:** March 10, 2026

---

## 1. Overview

`temporal-fx` is a browser-based, real-time video effects tool. Its core concept is **temporal compositing**: it maintains a rolling ring buffer of past video frames and blends them into the current frame using user-configurable parameters. The result is a range of cinematic effects — motion blur, light leaks, chromatic ghosting, burn-in, and more — all computed on the GPU in real time via WebGL2.

The application is a Vite + React + TypeScript SPA. All visual processing is done client-side; the Express server is a thin static file host with no API surface. There is no database, no authentication, and no network dependency at runtime.

---

## 2. Project Structure

```
temporal-fx/
├── client/
│   ├── index.html                   # Entry HTML; loads DM Mono and Inter fonts
│   └── src/
│       ├── main.tsx                 # React root mount
│       ├── App.tsx                  # Router + providers (Theme, Tooltip, Toaster)
│       ├── index.css                # "Cinematic Void" design tokens + global styles
│       ├── const.ts                 # OAuth/cookie constants (unused in current build)
│       ├── pages/
│       │   ├── Home.tsx             # Top-level page; owns all state
│       │   └── NotFound.tsx         # 404 fallback
│       ├── components/
│       │   ├── VideoPreview.tsx     # WebGL canvas, video elements, RAF loop
│       │   ├── ControlPanel.tsx     # All FX parameter controls (right sidebar)
│       │   ├── BezierEditor.tsx     # Interactive canvas-based curve editor
│       │   ├── MaskColorPicker.tsx  # Color swatch inputs for mask key colors
│       │   ├── ErrorBoundary.tsx    # React error boundary
│       │   ├── ManusDialog.tsx      # Manus login dialog (scaffold artifact, unused)
│       │   ├── Map.tsx              # Google Maps wrapper (scaffold artifact, unused)
│       │   └── ui/                  # Full shadcn/ui component library (mostly unused)
│       ├── contexts/
│       │   └── ThemeContext.tsx     # Dark/light theme context (locked to dark)
│       ├── hooks/
│       │   ├── useComposition.ts    # IME composition event handling
│       │   ├── useMobile.tsx        # Responsive breakpoint hook
│       │   └── usePersistFn.ts      # Stable function reference (alternative to useCallback)
│       └── lib/
│           ├── types.ts             # FXState, BezierCurve, RGBColor, presets
│           ├── webglEngine.ts       # TemporalFXEngine class (core GPU pipeline)
│           ├── shaders.ts           # GLSL source strings + atlas constants
│           ├── bezier.ts            # Cubic bezier math + LUT builder
│           └── utils.ts            # cn() Tailwind class merger
├── server/
│   └── index.ts                     # Express static file server (production only)
├── shared/
│   └── const.ts                     # COOKIE_NAME, ONE_YEAR_MS (scaffold artifact)
├── vite.config.ts                   # Vite config with path aliases, Manus plugins
└── tsconfig.json                    # Strict mode, bundler module resolution
```

**Path aliases:**
- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`

---

## 3. State Model

All user-configurable parameters are captured in a single TypeScript interface, `FXState`, defined in `client/src/lib/types.ts`. This object is the single source of truth for the entire application. It is fully serializable to JSON for save/load functionality.

| Field | Type | Range | Description |
| :--- | :--- | :--- | :--- |
| `historyDepth` | `number` | 0–60 frames | How many past frames to include in the blend |
| `feedbackMix` | `number` | 0.0–1.0 | Selects atlas source: `< 0.5` = original frames, `≥ 0.5` = processed frames |
| `historyCurve` | `BezierCurve` | — | Controls the weight of each history frame (recent → old) |
| `pixelWeightMode` | `"uniform" \| "luminance" \| "darkness" \| "motion"` | — | Determines how per-pixel contribution is modulated |
| `pixelWeightCurve` | `BezierCurve` | — | Maps the pixel weight value to a final contribution factor |
| `blendMode` | `"screen" \| "add" \| "multiply" \| "overlay" \| "difference" \| "average"` | — | How the accumulated history is blended with the current frame |
| `blendStrength` | `number` | 0.0–1.0 | Opacity of the blend effect |
| `chromaticSpread` | `number` | 0–10 frames | Offset in frames between the R and B channel samples (chromatic aberration) |
| `maskColors` | `RGBColor[5]` | — | Up to 5 chroma key colors for subject extraction |
| `maskCount` | `number` | 1–5 | How many of the 5 mask color slots are active |
| `excludeMaskFromEffect` | `boolean` | — | When true, the masked subject region is excluded from temporal processing |
| `debugView` | `0 \| 1 \| 2` | — | `0` = normal, `1` = subject only, `2` = background only |

A `BezierCurve` is defined by two control points (`p1`, `p2`) in normalized 0–1 space, with fixed endpoints at `(0,0)` and `(1,1)`, following the CSS cubic-bezier convention.

Six named presets are defined in `PRESETS` within `types.ts`: **Light Leak**, **Slow Shutter**, **Chromatic Ghost**, **Burn In**, **Memory Dissolve**, and **Glitch Echo**. Each is a partial `FXState` that is merged over the current state on application.

---

## 4. Rendering System: Deep Dive

### 4.1. The History Atlas

The most architecturally significant decision in the codebase is the use of a **texture atlas** to store all history frames. This directly addresses a hard constraint in GLSL/WebGL2: dynamic indexing of sampler arrays is illegal. You cannot write `texture(samplers[i], uv)` where `i` is a runtime variable.

The solution is to pack all frames into a single, large 2D texture. The atlas is a grid of `ATLAS_COLS × ATLAS_ROWS` = **6 × 10 = 60 tiles**, supporting up to 60 frames of history. The atlas dimensions scale with the video resolution:

```
Atlas width  = videoWidth  × 6
Atlas height = videoHeight × 10
```

To access frame `f` at UV coordinate `uv`, the shader computes the tile's column and row, then remaps the UV into the atlas:

```glsl
int col = frameIdx - (frameIdx / ATLAS_COLS) * ATLAS_COLS;
int row = frameIdx / ATLAS_COLS;
float u = (uv.x + float(col)) / float(ATLAS_COLS);
float v = (uv.y + float(row)) / float(ATLAS_ROWS);
return texture(u_historyAtlas, vec2(u, v));
```

There are **two parallel atlases**: `atlasOriginal` (stores raw video frames) and `atlasProcessed` (stores the output of the composite pass). The `feedbackMix` parameter selects which atlas is used as the history source, enabling feedback loop effects.

### 4.2. Ring Buffer

The history frames are managed as a ring buffer in CPU-side state:

- `historyHead`: The index of the next slot to write into (0–59).
- `historyFilled`: How many valid frames are currently in the buffer (0–60).

On every rendered frame, the current frame is written to slot `historyHead`, and `historyHead` is incremented modulo 60. The CPU computes a `slotWeights` array (a `Float32Array` of length 60) that maps each atlas slot to its weight, accounting for the ring buffer's current head position. This array is passed to the shader as the `u_histWeights` uniform.

The mapping from recency index `i` (0 = most recent) to atlas slot is:
```typescript
const slot = ((historyHead - 1 - i) % MAX_HISTORY + MAX_HISTORY) % MAX_HISTORY;
```

### 4.3. Bezier LUTs

Two bezier curves control the temporal weighting:

1. **`historyCurve`**: Determines the weight of each frame based on its age. The CPU builds a `Float32Array` LUT of length `depth` (the current history depth) by sampling the bezier at evenly spaced `x` values. The LUT is indexed by recency, and the resulting weight is stored in the `slotWeights` array at the appropriate atlas slot index.

2. **`pixelWeightCurve`**: Determines how a pixel's intrinsic property (luminance, darkness) maps to its contribution weight. This LUT is always 64 samples long and is passed to the shader as `u_weightCurve`. The shader samples it using linear interpolation between adjacent entries.

The bezier math in `client/src/lib/bezier.ts` uses Newton-Raphson iteration (8 iterations) to solve for the parameter `t` given an `x` value, then evaluates the Y component. This is the standard approach for CSS-compatible cubic beziers.

### 4.4. The Composite Shader (`COMPOSITE_SHADER`)

This is the primary fragment shader. Its execution order per pixel is:

1. **Motion weight** (if `pixelWeightMode === "motion"`): Computes the luminance of the per-pixel difference between the current frame and the previous frame (`u_prevFrame`). This is smoothstep-clamped to produce a clean motion signal.

2. **History accumulation loop**: Iterates over all 60 atlas slots. For any slot with a non-zero weight in `u_histWeights`, it samples the atlas, computes a pixel weight via `getPixelWeight()` (which applies the `pixelWeightCurve` LUT), and accumulates the weighted color into `accum` and `totalWeight`.

3. **Blend mode application**: The normalized `accum` is blended with the current frame using the selected blend mode. For the `average` mode, the raw accumulated value is divided by `totalWeight` directly. For all other modes, `accum` is first normalized by `max(totalWeight, 1.0)` before the blend function is applied.

4. **Mask exclusion**: If `u_excludeMask` is enabled, the shader samples the mask texture and computes a `maskExclusion` factor. This factor is used to `mix()` the blended result back toward the original current frame in the masked region, effectively protecting the subject from the temporal effect.

5. **Chromatic aberration**: The R channel is replaced with a sample from the atlas at `u_chromR` (an atlas slot index pre-computed by the CPU), and the B channel is replaced from `u_chromB`. Both are also subject to the mask exclusion. The G channel is left unchanged.

### 4.5. The Overlay Shader (`OVERLAY_SHADER`)

This shader runs in the second pass and renders to the visible canvas. It:

1. Reads the `compositeTexture` (the FX-processed background from the first pass).
2. If a mask video is present, samples the `maskVideo` texture and computes a subject alpha using the same color-keying logic as the composite shader (matching against up to 5 `maskColors` with `smoothstep`-based tolerance).
3. Composites the subject (from the unprocessed `baseVideo`) over the FX background using standard Porter-Duff over compositing.
4. Supports three debug views: normal output, subject only (subject over black), and background only (FX background with the subject region zeroed out).

### 4.6. Frame Lifecycle: Per-Frame Execution Order

The following sequence executes on every `requestAnimationFrame` call, inside `renderFrame()`:

1. **Upload current frame**: `texSubImage2D` uploads the current decoded video frame from the `<video>` element into `baseFrameTexture`. If a mask video is present and ready, it is uploaded into `maskFrameTexture`.
2. **Compute weights**: The CPU calculates `slotWeights` from the `historyCurve` LUT and the ring buffer's current head position. Chromatic aberration slot indices are also computed.
3. **Composite pass**: The `COMPOSITE_SHADER` runs, reading from `baseFrameTexture`, the selected history atlas, and `prevFrameTexture`. Output is written to `compositeTexture` via `compositeFBO`.
4. **Overlay pass**: The `OVERLAY_SHADER` runs, reading from `compositeTexture`, `baseFrameTexture`, and `maskFrameTexture`. Output is written to the canvas (default framebuffer).
5. **History update**: `copyTexSubImage2D` copies `baseFrameTexture` into the current slot of `atlasOriginal`, and `compositeTexture` into the current slot of `atlasProcessed`.
6. **Previous frame update**: `copyTexSubImage2D` copies `baseFrameTexture` into `prevFrameTexture` for use in the next frame's motion detection.
7. **Ring buffer advance**: `historyHead` is incremented modulo 60; `historyFilled` is incremented up to 60.

### 4.7. Texture and FBO Management

All textures used as FBO attachments are pre-allocated with explicit dimensions via `texImage2D(null)` in the `resize()` method. This is a critical correctness requirement: using `texSubImage2D` or `copyTexSubImage2D` on a texture that was only initialized via `texImage2D(videoElement)` does not guarantee the storage layout required for FBO attachment. The engine comments explicitly document this constraint.

The engine uses two FBOs:

- **`compositeFBO`**: A permanent FBO with `compositeTexture` attached as `COLOR_ATTACHMENT0`. Used for the composite pass.
- **`copyFBO`**: A reusable FBO used for all `copyTexSubImage2D` operations (history atlas writes and `prevFrameTexture` update). The source texture is attached to it transiently, the copy is performed, and the FBO is unbound.

---

## 5. Video Playback System

### 5.1. Architecture

Video playback is managed entirely within `VideoPreview.tsx` using two hidden `<video>` elements:

- **`baseVideoRef`**: The primary video. Its decoded frames are the source of all rendering.
- **`maskVideoRef`**: An optional secondary video carrying the mask/matte. It is kept frame-synchronized with the base video.

Both elements have `muted`, `playsInline`, and `crossOrigin="anonymous"` set. The `crossOrigin` attribute is required for WebGL to be able to read the video's pixel data via `texSubImage2D`.

### 5.2. Render Loop

The render loop is a standard `requestAnimationFrame` callback (`renderLoop`) started in a `useEffect`. On every frame:

1. It checks that the engine and base video are ready (`readyState >= 2`, meaning `HAVE_CURRENT_DATA`).
2. It detects if the video's intrinsic dimensions have changed (using a `videoDimsRef` to avoid stale closure comparisons) and calls `engine.resize()` if so, which also clears the history buffer.
3. It calls `engine.renderFrame()` with the current video elements and the latest `FXState` (read from `stateRef.current` to avoid stale closures).
4. It updates the `bufferWarmup` ratio, which is displayed as a progress bar in the control panel while the history buffer fills up.
5. It syncs the `currentTime` display state.

The `FXState` is kept in a `stateRef` that is updated via a `useEffect` whenever the `state` prop changes. This pattern is critical: it allows the render loop to always read the latest state without needing to be recreated (and thus without cancelling and restarting the RAF loop) on every state change.

### 5.3. Mask Video Synchronization

When a mask video is loaded, a `timeupdate` event listener on the base video continuously checks if the mask video's `currentTime` has drifted more than 50ms from the base video's `currentTime`. If so, it forcibly sets `mask.currentTime = base.currentTime`. On a `seeked` event (triggered by the scrub bar), the mask is immediately snapped to the base video's time, and the history buffer is cleared to prevent temporal artifacts from the discontinuity.

### 5.4. History Invalidation

The history buffer is cleared (`engine.clearHistory()`) in three situations:
1. A new base video is loaded.
2. The user scrubs to a new position in the timeline.
3. A `seeked` event fires on the base video (which also covers the scrub case).

This is necessary because the temporal effects are only meaningful when the history frames are temporally contiguous. A jump in time would produce incorrect blending artifacts if the old history were retained.

### 5.5. Video Loading

Video files are loaded via the browser's `<input type="file">` element. The file is converted to an object URL via `URL.createObjectURL()`, which is then assigned to the `<video>` element's `src`. The previous object URL is revoked before a new one is created to prevent memory leaks. Drag-and-drop onto the preview area is also supported for the base video.

---

## 6. Bezier Curve Editor

The `BezierEditor` component is a custom, canvas-rendered interactive widget. It draws the curve by sampling `evaluateBezier()` at 80 evenly-spaced `x` values, plotting the resulting `(x, y)` pairs on a 2D canvas with a teal glow effect. The two control points (`p1`, `p2`) are rendered as draggable circular handles.

Interaction is handled via `mousedown`, `mousemove`, and `mouseup` events on the canvas. Hit-testing uses Euclidean distance from the mouse position to each handle's canvas coordinates, with a hit radius of `HANDLE_RADIUS + 4 = 10px`. The canvas coordinate system is flipped on the Y-axis (Y=0 is at the bottom, Y=1 is at the top) to match the mathematical convention for the curve.

Double-clicking resets the curve to a linear diagonal (`p1=(0.33, 0.33)`, `p2=(0.67, 0.67)`).

---

## 7. Design System

The visual design is the "Cinematic Void" concept documented in `ideas.md`. Key tokens are defined as CSS custom properties in `client/src/index.css` using OKLCH color space:

| Token | Value | Purpose |
| :--- | :--- | :--- |
| `--background` | `oklch(0.08 0.002 240)` ≈ `#080808` | Page background |
| `--panel-bg` | `oklch(0.10 0.003 240)` ≈ `#0f0f0f` | Control panel background |
| `--teal` | `oklch(0.72 0.12 185)` ≈ `#4ecdc4` | Primary accent (monitor glow) |
| `--teal-dim` | `oklch(0.55 0.09 185)` | Dimmed accent for control lines |
| `--teal-glow` | `oklch(0.72 0.12 185 / 0.15)` | Glow/shadow color |
| `--panel-border` | `oklch(0.20 0.004 240)` | Section dividers |
| `--radius` | `0.2rem` | Near-zero border radius (sharp edges) |

Typography uses `DM Mono` (loaded via Google Fonts) as the primary typeface for all labels, values, and controls, with `Inter` as a secondary option. The body font size is 12px.

---

## 8. Server and Build

The Express server in `server/index.ts` is a minimal static file host. In production, it serves the Vite build output from `dist/public` and falls back to `index.html` for all routes (SPA routing). It has no API routes, no middleware beyond `express.static`, and no database connection. During development, Vite's own dev server handles all requests on port 3000.

The build process compiles the client via Vite and bundles the server via `esbuild` into `dist/index.js`. The `vite.config.ts` includes three Manus-specific plugins: `vitePluginManusRuntime`, `vitePluginManusDebugCollector` (a development-only log aggregator that collects browser console logs, network requests, and session replay events), and `jsxLocPlugin` (adds source location metadata to JSX elements for debugging).

---

## 9. Known Gaps and Observations

Several files exist in the codebase that are scaffold artifacts from the project template and are not used by the application:

- `Map.tsx`: A Google Maps integration component. Not imported anywhere in the active application.
- `ManusDialog.tsx`: A Manus OAuth login dialog. Not imported anywhere.
- `shared/const.ts` and `client/src/const.ts`: OAuth/session constants. Not used in the current build.
- `useComposition.ts` and `useMobile.tsx`: Utility hooks not currently used by any active component.
- The entire `components/ui/` directory (shadcn/ui): A full component library. Only `sonner`, `tooltip`, `button`, and `dialog` are imported at all, and only by the unused `ManusDialog` and the `App.tsx` providers.

The `feedbackMix` parameter has a hard binary behavior: below `0.5` it uses `atlasOriginal`, at or above `0.5` it uses `atlasProcessed`. The UI presents it as a continuous 0–1 slider, which may be misleading — the value only has two functional states. A potential improvement would be to either implement true continuous mixing between the two atlases or change the UI to a toggle.

**Confidence: 98%**
