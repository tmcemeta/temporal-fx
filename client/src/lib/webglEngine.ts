// TEMPORAL FX — WebGL2 Rendering Engine
// Manages the full pipeline:
//   1. Frame capture from video elements
//   2. History buffer management (ring buffer of textures)
//   3. Temporal composite pass
//   4. Subject overlay pass
//   5. Output to canvas

import type { FXState } from "./types";
import {
  VERTEX_SHADER,
  COMPOSITE_SHADER,
  OVERLAY_SHADER,
  PASSTHROUGH_SHADER,
  MAX_HISTORY,
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

  // Shader programs
  private compositeProgram!: Program;
  private overlayProgram!: Program;
  private passthroughProgram!: Program;

  // History ring buffer: alternates between original and processed textures
  private historyOriginal: WebGLTexture[] = [];  // original input frames
  private historyProcessed: WebGLTexture[] = []; // processed output frames
  private historyHead = 0; // index of the OLDEST slot (next to write)
  public historyFilled = 0; // how many slots are filled

  // FBOs for off-screen rendering
  private compositeFBO!: WebGLFramebuffer;
  private compositeTexture!: WebGLTexture;
  private prevFrameTexture!: WebGLTexture; // for motion detection

  // Temp textures for video frames
  private baseFrameTexture!: WebGLTexture;
  private maskFrameTexture!: WebGLTexture;

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
      "u_current", "u_history", "u_histWeights", "u_numHistory",
      "u_blendMode", "u_blendStrength", "u_weightMode",
      "u_prevFrame", "u_chromR", "u_chromB",
      "u_weightCurve", "u_weightCurveLen",
    ]);

    this.overlayProgram = this.createProgram(VERTEX_SHADER, OVERLAY_SHADER, [
      "u_fxOutput", "u_baseVideo", "u_maskVideo",
      "u_hasMask", "u_maskColors", "u_numMaskColors",
    ]);

    this.passthroughProgram = this.createProgram(VERTEX_SHADER, PASSTHROUGH_SHADER, [
      "u_texture",
    ]);

    this.baseFrameTexture = this.createTexture();
    this.maskFrameTexture = this.createTexture();
    this.prevFrameTexture = this.createTexture();
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

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    // Also get array uniforms for history textures and mask colors
    for (let i = 0; i < MAX_HISTORY; i++) {
      uniforms[`u_history[${i}]`] = gl.getUniformLocation(program, `u_history[${i}]`);
    }
    for (let i = 0; i < 5; i++) {
      uniforms[`u_maskColors[${i}]`] = gl.getUniformLocation(program, `u_maskColors[${i}]`);
    }
    // Weight curve LUT array
    for (let i = 0; i < 64; i++) {
      uniforms[`u_weightCurve[${i}]`] = gl.getUniformLocation(program, `u_weightCurve[${i}]`);
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

  private quadBuffer!: WebGLBuffer;

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

  private createFBO(width: number, height: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
    const gl = this.gl;
    const tex = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
  }

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    // Recreate FBOs
    if (this.compositeFBO) {
      gl.deleteFramebuffer(this.compositeFBO);
      gl.deleteTexture(this.compositeTexture);
    }
    const comp = this.createFBO(width, height);
    this.compositeFBO = comp.fbo;
    this.compositeTexture = comp.tex;

    // Resize prev frame texture
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    // Recreate history textures
    this.clearHistory();
    this.historyOriginal = [];
    this.historyProcessed = [];
    for (let i = 0; i < MAX_HISTORY; i++) {
      const t1 = this.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.historyOriginal.push(t1);

      const t2 = this.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.historyProcessed.push(t2);
    }
  }

  clearHistory() {
    this.historyHead = 0;
    this.historyFilled = 0;
  }

  private uploadVideoFrame(tex: WebGLTexture, video: HTMLVideoElement | HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  /**
   * Render one frame of the pipeline.
   * Call this on every animation frame.
   */
  renderFrame(
    baseVideo: HTMLVideoElement,
    maskVideo: HTMLVideoElement | null,
    state: FXState
  ) {
    const gl = this.gl;
    if (!this.width || !this.height) return;

    // 1. Upload current base frame
    this.uploadVideoFrame(this.baseFrameTexture, baseVideo);

    // 2. Upload mask frame if available
    if (maskVideo) {
      this.uploadVideoFrame(this.maskFrameTexture, maskVideo);
    }

    // 3. Build history weight array
    const depth = Math.min(state.historyDepth, this.historyFilled);
    const weightLUT = buildWeightLUT(state.historyCurve, Math.max(depth, 1));

    // 4. Composite pass: blend history onto current frame
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.compositeFBO);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram.program);

    // Bind quad geometry
    this.bindQuadForProgram(this.compositeProgram);

    // Bind current frame
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.baseFrameTexture);
    gl.uniform1i(this.compositeProgram.uniforms["u_current"], 0);

    // Bind history textures
    // Slot 0 = most recent history frame, slot N-1 = oldest
    const histWeights = new Float32Array(MAX_HISTORY);
    for (let i = 0; i < depth; i++) {
      // i=0 is most recent (historyHead - 1), i=depth-1 is oldest
      const slot = (this.historyHead - 1 - i + MAX_HISTORY) % MAX_HISTORY;
      const texUnit = i + 1; // texture units 1..depth
      gl.activeTexture(gl.TEXTURE0 + texUnit);

      // Mix between original and processed based on feedbackMix
      const origTex = this.historyOriginal[slot];
      const procTex = this.historyProcessed[slot];
      // feedbackMix: 0=always original, 1=always processed output (feedback loop)
      // Values in between use a threshold: below 0.5 = original, above = processed
      const useProcessed = state.feedbackMix >= 0.5;
      gl.bindTexture(gl.TEXTURE_2D, useProcessed ? procTex : origTex);
      gl.uniform1i(this.compositeProgram.uniforms[`u_history[${i}]`], texUnit);

      // Weight: x=0 is most recent (i=0), x=1 is oldest (i=depth-1)
      const wx = depth <= 1 ? 0.5 : i / (depth - 1);
      histWeights[i] = weightLUT[Math.round(wx * (weightLUT.length - 1))];
    }

    gl.uniform1fv(this.compositeProgram.uniforms["u_histWeights"], histWeights);
    gl.uniform1i(this.compositeProgram.uniforms["u_numHistory"], depth);

    // Blend mode
    const blendModeIndex = ["screen", "add", "multiply", "overlay", "difference", "average"]
      .indexOf(state.blendMode);
    gl.uniform1i(this.compositeProgram.uniforms["u_blendMode"], blendModeIndex);
    gl.uniform1f(this.compositeProgram.uniforms["u_blendStrength"], state.blendStrength);

    // Pixel weight mode
    const weightModeIndex = ["uniform", "luminance", "darkness", "motion"]
      .indexOf(state.pixelWeightMode);
    gl.uniform1i(this.compositeProgram.uniforms["u_weightMode"], weightModeIndex);

    // Pixel weight curve LUT (64 samples)
    const weightCurveLUT = buildWeightLUT(state.pixelWeightCurve, 64);
    gl.uniform1fv(this.compositeProgram.uniforms["u_weightCurve"], weightCurveLUT);
    gl.uniform1i(this.compositeProgram.uniforms["u_weightCurveLen"], 64);

    // Prev frame for motion
    const prevUnit = depth + 1;
    gl.activeTexture(gl.TEXTURE0 + prevUnit);
    gl.bindTexture(gl.TEXTURE_2D, this.prevFrameTexture);
    gl.uniform1i(this.compositeProgram.uniforms["u_prevFrame"], prevUnit);

    // Chromatic spread
    const spread = Math.round(state.chromaticSpread);
    gl.uniform1i(this.compositeProgram.uniforms["u_chromR"], Math.min(spread, depth - 1));
    gl.uniform1i(this.compositeProgram.uniforms["u_chromB"], Math.min(spread * 2, depth - 1));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 5. Overlay pass: composite subject over FX background
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.overlayProgram.program);
    this.bindQuadForProgram(this.overlayProgram);

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

    // Mask colors
    for (let i = 0; i < 5; i++) {
      const c = state.maskColors[i];
      gl.uniform3f(this.overlayProgram.uniforms[`u_maskColors[${i}]`], c.r, c.g, c.b);
    }
    gl.uniform1i(this.overlayProgram.uniforms["u_numMaskColors"], 5);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 6. Store current frame into history ring buffer
    // Write original
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // unbind
    // Use a temp FBO to copy base frame into history slot
    this.copyTextureToHistory(this.baseFrameTexture, this.historyOriginal[this.historyHead]);
    // Copy composite output into processed history
    this.copyTextureToHistory(this.compositeTexture, this.historyProcessed[this.historyHead]);
    // Copy current base to prevFrame for next frame's motion detection
    this.copyTextureToHistory(this.baseFrameTexture, this.prevFrameTexture);

    this.historyHead = (this.historyHead + 1) % MAX_HISTORY;
    this.historyFilled = Math.min(this.historyFilled + 1, MAX_HISTORY);
  }

  private copyFBO!: WebGLFramebuffer;

  private copyTextureToHistory(src: WebGLTexture, dst: WebGLTexture) {
    const gl = this.gl;
    if (!this.copyFBO) {
      this.copyFBO = gl.createFramebuffer()!;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFBO);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);
    gl.bindTexture(gl.TEXTURE_2D, dst);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }

  private bindQuadForProgram(prog: Program) {
    const gl = this.gl;
    if (!this.quadBuffer) {
      this.quadBuffer = gl.createBuffer()!;
      const data = new Float32Array([
        -1, -1,  0, 0,
         1, -1,  1, 0,
        -1,  1,  0, 1,
         1,  1,  1, 1,
      ]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    }
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

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.compositeProgram.program);
    gl.deleteProgram(this.overlayProgram.program);
    gl.deleteProgram(this.passthroughProgram.program);
    this.historyOriginal.forEach(t => gl.deleteTexture(t));
    this.historyProcessed.forEach(t => gl.deleteTexture(t));
    gl.deleteTexture(this.baseFrameTexture);
    gl.deleteTexture(this.maskFrameTexture);
    gl.deleteTexture(this.prevFrameTexture);
    gl.deleteTexture(this.compositeTexture);
    gl.deleteFramebuffer(this.compositeFBO);
  }
}
