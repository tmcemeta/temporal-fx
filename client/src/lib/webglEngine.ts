// TEMPORAL FX — WebGL2 Rendering Engine
//
// History frames are stored in a single TEXTURE ATLAS to avoid the GLSL
// restriction on dynamic sampler array indexing.
//
// Atlas layout:
//   - Width:  frameWidth  * ATLAS_COLS
//   - Height: frameHeight * ATLAS_ROWS
//   - Frame f occupies tile (col = f % ATLAS_COLS, row = f / ATLAS_COLS)
//
// HSTACK VIDEO FORMAT:
//   The engine accepts a single <video> element whose decoded frames are
//   side-by-side: left half = base, right half = mask.
//   Produced by: ffmpeg -y -i "$BASE" -i "$MASK" -filter_complex hstack "$OUT"
//
//   NOTE: WebGL 2 spec §5.35 states that UNPACK_ROW_LENGTH is IGNORED when the
//   upload source is a TexImageSource (HTMLVideoElement, HTMLCanvasElement, etc.).
//   Splitting is therefore done via a persistent off-screen OffscreenCanvas:
//     splitCtx.drawImage(video, -frameWidth, 0)  → left half  (base)
//     splitCtx.drawImage(video, 0,           0)  → right half (mask)
//   The canvas is then uploaded to the texture with texSubImage2D.
//   The OffscreenCanvas is created once in resize() and reused every frame.
//
// IMPORTANT: All textures used as FBO attachments MUST be pre-allocated with
// explicit dimensions via texImage2D(null) before copyTexSubImage2D is called.

import type { FXState } from "./types";
import {
  VERTEX_SHADER,
  COMPOSITE_SHADER,
  OVERLAY_SHADER,
  MAX_HISTORY,
  ATLAS_COLS,
  ATLAS_ROWS,
} from "./shaders";
import { buildWeightLUT } from "./bezier";

interface Program {
  program: WebGLProgram;
  attribs: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export class TemporalFXEngine {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  private compositeProgram!: Program;
  private overlayProgram!: Program;

  private quadBuffer!: WebGLBuffer;

  // History ring buffer
  private historyHead = 0;
  public historyFilled = 0;

  // Texture atlas (one for original frames, one for processed)
  private atlasOriginal!: WebGLTexture;
  private atlasProcessed!: WebGLTexture;

  // Off-screen composite FBO
  private compositeFBO!: WebGLFramebuffer;
  private compositeTexture!: WebGLTexture;

  // Per-frame textures (pre-allocated to logical frame dimensions)
  private baseFrameTexture!: WebGLTexture;
  private maskFrameTexture!: WebGLTexture;
  private prevFrameTexture!: WebGLTexture;

  // Reusable FBO for copy operations
  private copyFBO!: WebGLFramebuffer;

  // Off-screen canvas used to split the hstack frame into two halves.
  // Created/resized in resize(). drawImage offsets select the correct half.
  private splitCanvas: OffscreenCanvas | null = null;
  private splitCtx: OffscreenCanvasRenderingContext2D | null = null;

  // Logical frame dimensions (half the hstack video width)
  private width = 0;
  private height = 0;

  // Actual atlas layout (computed based on max texture size)
  private atlasCols = ATLAS_COLS;
  private atlasRows = ATLAS_ROWS;
  private maxHistoryFrames = MAX_HISTORY;
  private maxTextureSize = 4096;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      alpha: true,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    // Query max texture size
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    console.log(`[TemporalFX] Max texture size: ${this.maxTextureSize}`);

    this.init();
  }

  private init() {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    this.compositeProgram = this.createProgram(VERTEX_SHADER, COMPOSITE_SHADER, [
      "u_current", "u_historyAtlas", "u_prevFrame",
      "u_histWeights", "u_numHistory",
      "u_blendMode", "u_blendStrength",
      "u_weightMode", "u_chromR", "u_chromB",
      "u_weightCurve", "u_weightCurveLen",
      "u_atlasCols", "u_atlasRows",
      "u_excludeMask", "u_maskTex", "u_numMaskExcludeColors",
    ]);
    for (let i = 0; i < 5; i++) {
      this.compositeProgram.uniforms[`u_maskExcludeColors[${i}]`] =
        gl.getUniformLocation(this.compositeProgram.program, `u_maskExcludeColors[${i}]`);
    }

    this.overlayProgram = this.createProgram(VERTEX_SHADER, OVERLAY_SHADER, [
      "u_fxOutput", "u_baseVideo", "u_maskVideo",
      "u_hasMask", "u_maskColors", "u_numMaskColors", "u_debugView",
    ]);
    for (let i = 0; i < 5; i++) {
      this.overlayProgram.uniforms[`u_maskColors[${i}]`] =
        gl.getUniformLocation(this.overlayProgram.program, `u_maskColors[${i}]`);
    }

    this.quadBuffer = this.createQuadBuffer();
    this.copyFBO = gl.createFramebuffer()!;

    // Create textures (storage allocated later in resize())
    this.baseFrameTexture = this.makeTexture(gl.LINEAR);
    this.maskFrameTexture = this.makeTexture(gl.LINEAR);
    this.prevFrameTexture = this.makeTexture(gl.LINEAR);
    this.compositeTexture = this.makeTexture(gl.LINEAR);
    this.atlasOriginal = this.makeTexture(gl.NEAREST);
    this.atlasProcessed = this.makeTexture(gl.NEAREST);

    this.compositeFBO = gl.createFramebuffer()!;
  }

  private createProgram(vertSrc: string, fragSrc: string, uniformNames: string[]): Program {
    const gl = this.gl;

    const compileShader = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const label = type === gl.VERTEX_SHADER ? "Vertex" : "Fragment";
        throw new Error(`${label} shader error: ${gl.getShaderInfoLog(s)}`);
      }
      return s;
    };

    const vert = compileShader(gl.VERTEX_SHADER, vertSrc);
    const frag = compileShader(gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Program link error: " + gl.getProgramInfoLog(program));
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    return {
      program,
      attribs: {
        a_position: gl.getAttribLocation(program, "a_position"),
        a_texCoord: gl.getAttribLocation(program, "a_texCoord"),
      },
      uniforms,
    };
  }

  private makeTexture(filter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private allocTexture(tex: WebGLTexture, w: number, h: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  private createQuadBuffer(): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  0, 0,
       1, -1,  1, 0,
      -1,  1,  0, 1,
       1,  1,  1, 1,
    ]), gl.STATIC_DRAW);
    return buf;
  }

  private bindQuad(prog: Program) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    if (prog.attribs.a_position >= 0) {
      gl.enableVertexAttribArray(prog.attribs.a_position);
      gl.vertexAttribPointer(prog.attribs.a_position, 2, gl.FLOAT, false, 16, 0);
    }
    if (prog.attribs.a_texCoord >= 0) {
      gl.enableVertexAttribArray(prog.attribs.a_texCoord);
      gl.vertexAttribPointer(prog.attribs.a_texCoord, 2, gl.FLOAT, false, 16, 8);
    }
  }

  /**
   * Draw one half of the hstack video into splitCanvas, then upload to tex.
   *
   * The splitCanvas is frameWidth × frameHeight. drawImage is called with an
   * x-offset so that only the desired half of the hstack frame is visible:
   *   isLeft=true  → drawX = 0           (base, left half)
   *   isLeft=false → drawX = -frameWidth (mask, right half)
   *
   * The canvas is then uploaded to the texture with texSubImage2D. This is the
   * only reliable way to sub-region a TexImageSource in WebGL 2 (spec §5.35).
   */
  private drawHalfAndUpload(
    tex: WebGLTexture,
    video: HTMLVideoElement,
    isLeft: boolean,
  ) {
    const gl = this.gl;
    const ctx = this.splitCtx;
    if (!ctx) return;

    // The hstack video is 2*frameWidth wide. We use the 9-argument drawImage
    // overload to crop exactly one half from the source:
    //   sx = 0           (base, left half)
    //   sx = frameWidth  (mask, right half)
    // The destination is always the full splitCanvas (0, 0, frameWidth, frameHeight).
    const sx = isLeft ? 0 : this.width;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(
      video,
      sx, 0, this.width, this.height,   // source rect
      0,  0, this.width, this.height,   // dest rect
    );

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.splitCanvas!);
  }

  /**
   * Upload the full video frame (no cropping) into a pre-allocated texture.
   * Used for plain (non-hstack) videos where base and mask are the same frame.
   */
  private drawFullFrame(tex: WebGLTexture, video: HTMLVideoElement) {
    const gl = this.gl;
    const ctx = this.splitCtx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(video, 0, 0, this.width, this.height);

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.splitCanvas!);
  }

  /**
   * Copy a texture into a specific tile of the atlas using copyTexSubImage2D.
   * The source texture must be pre-allocated and attached to copyFBO.
   */
  private copyToAtlasTile(srcTex: WebGLTexture, atlasTex: WebGLTexture, slot: number) {
    const gl = this.gl;

    // Use dynamic atlas layout
    if (slot >= this.maxHistoryFrames) return;

    const col = slot % this.atlasCols;
    const row = Math.floor(slot / this.atlasCols);
    const xOffset = col * this.width;
    const yOffset = row * this.height;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFBO);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, srcTex, 0);

    const status = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      return; // Skip silently — can happen on first frame before textures are ready
    }

    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, xOffset, yOffset, 0, 0, this.width, this.height);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    // Compute atlas layout that fits within max texture size
    // We want as many frames as possible while staying under the limit
    const maxCols = Math.floor(this.maxTextureSize / width);
    const maxRows = Math.floor(this.maxTextureSize / height);

    // Limit to reasonable values (shader defines MAX_HISTORY=60)
    this.atlasCols = Math.min(maxCols, ATLAS_COLS);
    this.atlasRows = Math.min(maxRows, ATLAS_ROWS);
    this.maxHistoryFrames = Math.min(this.atlasCols * this.atlasRows, MAX_HISTORY);

    const atlasW = width * this.atlasCols;
    const atlasH = height * this.atlasRows;

    console.log(`[TemporalFX] Frame: ${width}x${height}, Atlas: ${atlasW}x${atlasH} (${this.atlasCols}x${this.atlasRows} = ${this.maxHistoryFrames} frames)`);

    // (Re)create the split canvas to match the new logical frame size.
    // This canvas is frameWidth × frameHeight — exactly one half of the hstack.
    this.splitCanvas = new OffscreenCanvas(width, height);
    this.splitCtx = this.splitCanvas.getContext("2d", { willReadFrequently: false }) as OffscreenCanvasRenderingContext2D;

    // Pre-allocate all textures with explicit dimensions
    this.allocTexture(this.baseFrameTexture, width, height);
    this.allocTexture(this.maskFrameTexture, width, height);
    this.allocTexture(this.prevFrameTexture, width, height);
    this.allocTexture(this.compositeTexture, width, height);
    this.allocTexture(this.atlasOriginal, atlasW, atlasH);
    this.allocTexture(this.atlasProcessed, atlasW, atlasH);

    // Attach compositeTexture to compositeFBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.compositeFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.compositeTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.clearHistory();
  }

  clearHistory() {
    this.historyHead = 0;
    this.historyFilled = 0;
  }

  /**
   * Render one frame.
   *
   * @param video    The <video> element
   * @param state    Current FX parameters
   * @param isHstack true  → video is hstack-encoded (left=base, right=mask)
   *                 false → plain video; base = full frame, mask = same frame
   */
  renderFrame(video: HTMLVideoElement, state: FXState, isHstack: boolean) {
    const gl = this.gl;
    if (!this.width || !this.height) return;
    if (video.readyState < 2) return;

    // 1. Upload base and mask frames
    if (isHstack) {
      // Crop left half → base, right half → mask
      this.drawHalfAndUpload(this.baseFrameTexture, video, true);
      this.drawHalfAndUpload(this.maskFrameTexture, video, false);
    } else {
      // Plain video: upload the full frame as base, reuse it as mask
      this.drawFullFrame(this.baseFrameTexture, video);
      this.drawFullFrame(this.maskFrameTexture, video);
    }

    // 2. Build slot-indexed weight array
    // Limit depth to the actual number of frames we can store
    const effectiveMaxHistory = this.maxHistoryFrames;
    const depth = Math.min(state.historyDepth, this.historyFilled, effectiveMaxHistory);
    const weightLUT = buildWeightLUT(state.historyCurve, Math.max(depth, 1));

    const slotWeights = new Float32Array(MAX_HISTORY);
    for (let i = 0; i < depth; i++) {
      const slot = ((this.historyHead - 1 - i) % effectiveMaxHistory + effectiveMaxHistory) % effectiveMaxHistory;
      const wx = depth <= 1 ? 0.5 : i / (depth - 1);
      const wIdx = Math.round(wx * (weightLUT.length - 1));
      slotWeights[slot] = weightLUT[wIdx];
    }

    // Chromatic spread: compute atlas slots for R and B channel offsets
    const chromROffset = Math.min(Math.round(state.chromaticSpread), Math.max(depth - 1, 0));
    const chromBOffset = Math.min(Math.round(state.chromaticSpread * 1.5), Math.max(depth - 1, 0));
    const chromRSlot = depth > 0
      ? ((this.historyHead - 1 - chromROffset) % effectiveMaxHistory + effectiveMaxHistory) % effectiveMaxHistory
      : -1;
    const chromBSlot = depth > 0
      ? ((this.historyHead - 1 - chromBOffset) % effectiveMaxHistory + effectiveMaxHistory) % effectiveMaxHistory
      : -1;

    const useProcessed = state.feedbackMix >= 0.5;
    const histAtlas = useProcessed ? this.atlasProcessed : this.atlasOriginal;

    // 3. Composite pass (into compositeFBO)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.compositeFBO);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram.program);
    this.bindQuad(this.compositeProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.baseFrameTexture);
    gl.uniform1i(this.compositeProgram.uniforms["u_current"], 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, histAtlas);
    gl.uniform1i(this.compositeProgram.uniforms["u_historyAtlas"], 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.uniform1i(this.compositeProgram.uniforms["u_prevFrame"], 2);

    gl.uniform1fv(this.compositeProgram.uniforms["u_histWeights"], slotWeights);
    gl.uniform1i(this.compositeProgram.uniforms["u_numHistory"], MAX_HISTORY);

    // Pass dynamic atlas layout to shader
    gl.uniform1i(this.compositeProgram.uniforms["u_atlasCols"], this.atlasCols);
    gl.uniform1i(this.compositeProgram.uniforms["u_atlasRows"], this.atlasRows);

    const blendModeIndex = ["screen", "add", "multiply", "overlay", "difference", "average"]
      .indexOf(state.blendMode);
    gl.uniform1i(this.compositeProgram.uniforms["u_blendMode"], Math.max(0, blendModeIndex));
    gl.uniform1f(this.compositeProgram.uniforms["u_blendStrength"], state.blendStrength);

    const weightModeIndex = ["uniform", "luminance", "darkness", "motion"]
      .indexOf(state.pixelWeightMode);
    gl.uniform1i(this.compositeProgram.uniforms["u_weightMode"], Math.max(0, weightModeIndex));

    const weightCurveLUT = buildWeightLUT(state.pixelWeightCurve, 64);
    gl.uniform1fv(this.compositeProgram.uniforms["u_weightCurve"], weightCurveLUT);
    gl.uniform1i(this.compositeProgram.uniforms["u_weightCurveLen"], 64);

    gl.uniform1i(this.compositeProgram.uniforms["u_chromR"],
      state.chromaticSpread > 0 ? chromRSlot : -1);
    gl.uniform1i(this.compositeProgram.uniforms["u_chromB"],
      state.chromaticSpread > 0 ? chromBSlot : -1);

    const activeMaskCount = Math.min(state.maskCount ?? 1, 5);

    // Mask exclusion uniforms — mask is always present in hstack format
    gl.uniform1i(this.compositeProgram.uniforms["u_excludeMask"],
      state.excludeMaskFromEffect ? 1 : 0);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.maskFrameTexture);
    gl.uniform1i(this.compositeProgram.uniforms["u_maskTex"], 3);
    gl.uniform1i(this.compositeProgram.uniforms["u_numMaskExcludeColors"], activeMaskCount);
    for (let i = 0; i < 5; i++) {
      const c = state.maskColors[i];
      gl.uniform3f(this.compositeProgram.uniforms[`u_maskExcludeColors[${i}]`], c.r, c.g, c.b);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 4. Overlay pass (to canvas)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.overlayProgram.program);
    this.bindQuad(this.overlayProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.compositeTexture);
    gl.uniform1i(this.overlayProgram.uniforms["u_fxOutput"], 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.baseFrameTexture);
    gl.uniform1i(this.overlayProgram.uniforms["u_baseVideo"], 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskFrameTexture);
    gl.uniform1i(this.overlayProgram.uniforms["u_maskVideo"], 2);

    // Mask is always present in hstack format
    gl.uniform1i(this.overlayProgram.uniforms["u_hasMask"], 1);
    for (let i = 0; i < 5; i++) {
      const c = state.maskColors[i];
      gl.uniform3f(this.overlayProgram.uniforms[`u_maskColors[${i}]`], c.r, c.g, c.b);
    }
    gl.uniform1i(this.overlayProgram.uniforms["u_numMaskColors"], activeMaskCount);
    gl.uniform1i(this.overlayProgram.uniforms["u_debugView"], state.debugView ?? 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 5. Store current frame into history ring buffer
    const slot = this.historyHead;
    this.copyToAtlasTile(this.baseFrameTexture, this.atlasOriginal, slot);
    this.copyToAtlasTile(this.compositeTexture, this.atlasProcessed, slot);

    // Copy base frame → prevFrameTexture for next frame's motion detection
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFBO);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.baseFrameTexture, 0);
    const prevStatus = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
    if (prevStatus === gl.FRAMEBUFFER_COMPLETE) {
      gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    this.historyHead = (this.historyHead + 1) % this.maxHistoryFrames;
    this.historyFilled = Math.min(this.historyFilled + 1, this.maxHistoryFrames);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.compositeProgram.program);
    gl.deleteProgram(this.overlayProgram.program);
    gl.deleteTexture(this.atlasOriginal);
    gl.deleteTexture(this.atlasProcessed);
    gl.deleteTexture(this.baseFrameTexture);
    gl.deleteTexture(this.maskFrameTexture);
    gl.deleteTexture(this.prevFrameTexture);
    gl.deleteTexture(this.compositeTexture);
    gl.deleteFramebuffer(this.compositeFBO);
    gl.deleteFramebuffer(this.copyFBO);
    gl.deleteBuffer(this.quadBuffer);
  }
}
