// TEMPORAL FX — WebGL2 Rendering Engine
//
// History frames are stored in a single TEXTURE ATLAS to avoid the GLSL
// restriction on dynamic sampler array indexing.
//
// Atlas layout:
//   - Width:  videoWidth  * ATLAS_COLS
//   - Height: videoHeight * ATLAS_ROWS
//   - Frame f occupies tile (col = f % ATLAS_COLS, row = f / ATLAS_COLS)
//   - The atlas holds up to MAX_HISTORY = ATLAS_COLS * ATLAS_ROWS frames
//
// Ring buffer: historyHead points to the NEXT slot to write.
// Frame 0 (most recent) = slot (historyHead - 1 + MAX_HISTORY) % MAX_HISTORY
// Frame i (i-th most recent) = slot (historyHead - 1 - i + MAX_HISTORY) % MAX_HISTORY

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

  // Geometry buffer
  private quadBuffer!: WebGLBuffer;

  // History ring buffer metadata
  private historyHead = 0;   // next slot to write
  public historyFilled = 0;  // how many slots contain valid data

  // Texture atlas: one atlas for original frames, one for processed frames
  private atlasOriginal!: WebGLTexture;
  private atlasProcessed!: WebGLTexture;

  // Off-screen FBOs
  private compositeFBO!: WebGLFramebuffer;
  private compositeTexture!: WebGLTexture;
  private prevFrameTexture!: WebGLTexture;

  // Current frame textures
  private baseFrameTexture!: WebGLTexture;
  private maskFrameTexture!: WebGLTexture;

  // Copy FBO (reused)
  private copyFBO!: WebGLFramebuffer;

  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      alpha: true,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
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
    ]);

    this.overlayProgram = this.createProgram(VERTEX_SHADER, OVERLAY_SHADER, [
      "u_fxOutput", "u_baseVideo", "u_maskVideo",
      "u_hasMask", "u_maskColors", "u_numMaskColors",
    ]);

    // Register mask color array uniforms
    for (let i = 0; i < 5; i++) {
      this.overlayProgram.uniforms[`u_maskColors[${i}]`] =
        gl.getUniformLocation(this.overlayProgram.program, `u_maskColors[${i}]`);
    }

    this.quadBuffer = this.createQuadBuffer();
    this.baseFrameTexture = this.createTexture();
    this.maskFrameTexture = this.createTexture();
    this.prevFrameTexture = this.createTexture();
    this.copyFBO = gl.createFramebuffer()!;
  }

  private createProgram(
    vertSrc: string,
    fragSrc: string,
    uniformNames: string[]
  ): Program {
    const gl = this.gl;

    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      throw new Error("Vertex shader error: " + gl.getShaderInfoLog(vert));
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      throw new Error("Fragment shader error: " + gl.getShaderInfoLog(frag));
    }

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

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private createAtlasTexture(atlasW: number, atlasH: number): WebGLTexture {
    const gl = this.gl;
    const tex = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Use NEAREST for atlas to avoid bleeding between tiles
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, atlasW, atlasH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    const atlasW = width * ATLAS_COLS;
    const atlasH = height * ATLAS_ROWS;

    // Recreate atlas textures
    if (this.atlasOriginal) gl.deleteTexture(this.atlasOriginal);
    if (this.atlasProcessed) gl.deleteTexture(this.atlasProcessed);
    this.atlasOriginal = this.createAtlasTexture(atlasW, atlasH);
    this.atlasProcessed = this.createAtlasTexture(atlasW, atlasH);

    // Recreate composite FBO
    if (this.compositeFBO) {
      gl.deleteFramebuffer(this.compositeFBO);
      gl.deleteTexture(this.compositeTexture);
    }
    this.compositeTexture = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.compositeTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.compositeFBO = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.compositeFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.compositeTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Resize prev frame texture
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.clearHistory();
  }

  clearHistory() {
    this.historyHead = 0;
    this.historyFilled = 0;
  }

  private uploadVideoFrame(tex: WebGLTexture, video: HTMLVideoElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  /**
   * Copy a texture into a specific tile of the atlas.
   * tile = slot index (0..MAX_HISTORY-1)
   */
  private copyToAtlasTile(srcTex: WebGLTexture, atlasTex: WebGLTexture, slot: number) {
    const gl = this.gl;
    const col = slot % ATLAS_COLS;
    const row = Math.floor(slot / ATLAS_COLS);
    const xOffset = col * this.width;
    const yOffset = row * this.height;

    // Read from srcTex via copyFBO
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFBO);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, srcTex, 0);

    // Write into atlas at tile position
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, xOffset, yOffset, 0, 0, this.width, this.height);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }

  /**
   * Render one frame of the full pipeline.
   */
  renderFrame(
    baseVideo: HTMLVideoElement,
    maskVideo: HTMLVideoElement | null,
    state: FXState
  ) {
    const gl = this.gl;
    if (!this.width || !this.height) return;

    // 1. Upload current base frame to texture
    this.uploadVideoFrame(this.baseFrameTexture, baseVideo);
    if (maskVideo) this.uploadVideoFrame(this.maskFrameTexture, maskVideo);

    // 2. Build history weight array
    const depth = Math.min(state.historyDepth, this.historyFilled);
    const weightLUT = buildWeightLUT(state.historyCurve, Math.max(depth, 1));

    // Map slot indices: frame 0 = most recent = (historyHead-1), frame i = (historyHead-1-i)
    // The atlas stores slots 0..MAX_HISTORY-1 in fixed tile positions.
    // We need to tell the shader which atlas tile corresponds to history frame i.
    // We do this by building a remapping: for each history frame index i (0=most recent),
    // compute its slot in the ring buffer, then pass that as the atlas tile index.
    // The shader's sampleHistory(i, uv) uses i directly as the atlas tile index,
    // so we pre-sort the weight array to match atlas tile order.

    // Build weight array indexed by atlas slot (not by recency)
    const slotWeights = new Float32Array(MAX_HISTORY);
    for (let i = 0; i < depth; i++) {
      const slot = ((this.historyHead - 1 - i) % MAX_HISTORY + MAX_HISTORY) % MAX_HISTORY;
      const wx = depth <= 1 ? 0.5 : i / (depth - 1);
      const wIdx = Math.round(wx * (weightLUT.length - 1));
      slotWeights[slot] = weightLUT[wIdx];
    }

    // Chromatic spread: find atlas slots for chromR and chromB offsets
    const chromRSlot = depth > 0
      ? ((this.historyHead - 1 - Math.min(Math.round(state.chromaticSpread), depth - 1)) % MAX_HISTORY + MAX_HISTORY) % MAX_HISTORY
      : 0;
    const chromBSlot = depth > 0
      ? ((this.historyHead - 1 - Math.min(Math.round(state.chromaticSpread * 2), depth - 1)) % MAX_HISTORY + MAX_HISTORY) % MAX_HISTORY
      : 0;

    // Choose atlas: original or processed based on feedbackMix
    const useProcessed = state.feedbackMix >= 0.5;
    const histAtlas = useProcessed ? this.atlasProcessed : this.atlasOriginal;

    // 3. Composite pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.compositeFBO);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram.program);
    this.bindQuad(this.compositeProgram);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.baseFrameTexture);
    gl.uniform1i(this.compositeProgram.uniforms["u_current"], 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, histAtlas);
    gl.uniform1i(this.compositeProgram.uniforms["u_historyAtlas"], 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.uniform1i(this.compositeProgram.uniforms["u_prevFrame"], 2);

    // Uniforms
    gl.uniform1fv(this.compositeProgram.uniforms["u_histWeights"], slotWeights);
    gl.uniform1i(this.compositeProgram.uniforms["u_numHistory"], MAX_HISTORY); // shader iterates all slots

    const blendModeIndex = ["screen", "add", "multiply", "overlay", "difference", "average"]
      .indexOf(state.blendMode);
    gl.uniform1i(this.compositeProgram.uniforms["u_blendMode"], blendModeIndex);
    gl.uniform1f(this.compositeProgram.uniforms["u_blendStrength"], state.blendStrength);

    const weightModeIndex = ["uniform", "luminance", "darkness", "motion"]
      .indexOf(state.pixelWeightMode);
    gl.uniform1i(this.compositeProgram.uniforms["u_weightMode"], weightModeIndex);

    const weightCurveLUT = buildWeightLUT(state.pixelWeightCurve, 64);
    gl.uniform1fv(this.compositeProgram.uniforms["u_weightCurve"], weightCurveLUT);
    gl.uniform1i(this.compositeProgram.uniforms["u_weightCurveLen"], 64);

    gl.uniform1i(this.compositeProgram.uniforms["u_chromR"],
      state.chromaticSpread > 0 ? chromRSlot : -1);
    gl.uniform1i(this.compositeProgram.uniforms["u_chromB"],
      state.chromaticSpread > 0 ? chromBSlot : -1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 4. Overlay pass: composite subject over FX background
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

    gl.uniform1i(this.overlayProgram.uniforms["u_hasMask"], maskVideo ? 1 : 0);

    for (let i = 0; i < 5; i++) {
      const c = state.maskColors[i];
      gl.uniform3f(this.overlayProgram.uniforms[`u_maskColors[${i}]`], c.r, c.g, c.b);
    }
    gl.uniform1i(this.overlayProgram.uniforms["u_numMaskColors"], 5);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 5. Store current frame into history ring buffer
    const slot = this.historyHead;
    this.copyToAtlasTile(this.baseFrameTexture, this.atlasOriginal, slot);
    this.copyToAtlasTile(this.compositeTexture, this.atlasProcessed, slot);

    // Copy base frame to prevFrame for next frame's motion detection
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFBO);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.baseFrameTexture, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    this.historyHead = (this.historyHead + 1) % MAX_HISTORY;
    this.historyFilled = Math.min(this.historyFilled + 1, MAX_HISTORY);
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
