// SIMPLE SUBJECT — WebGL2 Subject Extraction Engine
//
// Minimal WebGL2 engine focused solely on subject extraction.
// No history atlas, no ring buffer, no compositing FBO.
//
// Pipeline per frame:
//   1. Split hstack video into base and mask textures via OffscreenCanvas.
//   2. Run SUBJECT_SHADER: key the mask, apply spill suppression, output composite.
//   3. For Raw Input view, run PASSTHROUGH_SHADER on the selected half.
//   4. If bbox is enabled, run BBOX_SHADER once per active mask color into a 1×1
//      FBO, then readback the pixel to get normalized (x1,y1,x2,y2) coordinates.
//
// HSTACK VIDEO FORMAT:
//   A single <video> element whose decoded frames are side-by-side:
//   left half = base, right half = mask.
//   Produced by: ffmpeg -y -i "$BASE" -i "$MASK" -filter_complex hstack "$OUT"
//
//   Splitting is done via a persistent OffscreenCanvas:
//     ctx.drawImage(video, sx, 0, w, h, 0, 0, w, h)
//   where sx=0 for base (left) and sx=w for mask (right).

import type { SubjectState, BBox } from "./types";
import { VERTEX_SHADER, SUBJECT_SHADER, PASSTHROUGH_SHADER, makeBboxShader } from "./shaders";

interface Program {
  program: WebGLProgram;
  attribs: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export class SubjectEngine {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  private subjectProgram!: Program;
  private passthroughProgram!: Program;

  // Bbox: one program per active color slot (recompiled when bboxSamples changes)
  private bboxProgram: Program | null = null;
  private bboxSamplesCompiled = -1;

  // 1×1 FBO for bbox readback
  private bboxFBO!: WebGLFramebuffer;
  private bboxTexture!: WebGLTexture;

  private quadBuffer!: WebGLBuffer;

  // Per-frame textures
  private baseFrameTexture!: WebGLTexture;
  private maskFrameTexture!: WebGLTexture;

  // Off-screen canvas for splitting the hstack frame
  private splitCanvas: OffscreenCanvas | null = null;
  private splitCtx: OffscreenCanvasRenderingContext2D | null = null;

  // Logical frame dimensions (half the hstack video width)
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

    this.subjectProgram = this.createProgram(VERTEX_SHADER, SUBJECT_SHADER, [
      "u_baseVideo",
      "u_maskVideo",
      "u_numMaskColors",
      "u_edgeSoftness",
      "u_minLuma",
      "u_spillSuppression",
      "u_spillStrength",
      "u_viewMode",
    ]);
    for (let i = 0; i < 5; i++) {
      this.subjectProgram.uniforms[`u_maskColors[${i}]`] =
        gl.getUniformLocation(this.subjectProgram.program, `u_maskColors[${i}]`);
    }

    this.passthroughProgram = this.createProgram(VERTEX_SHADER, PASSTHROUGH_SHADER, [
      "u_texture",
    ]);

    this.quadBuffer = this.createQuadBuffer();

    this.baseFrameTexture = this.makeTexture(gl.LINEAR);
    this.maskFrameTexture = this.makeTexture(gl.LINEAR);

    // 1×1 RGBA32F texture + FBO for bbox readback
    this.bboxTexture = this.makeTexture(gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, this.bboxTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);

    this.bboxFBO = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bboxFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bboxTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ─── Bbox program management ──────────────────────────────────────────────

  private ensureBboxProgram(samples: number) {
    if (this.bboxSamplesCompiled === samples && this.bboxProgram !== null) return;

    // Dispose old program if it exists
    if (this.bboxProgram) {
      this.gl.deleteProgram(this.bboxProgram.program);
      this.bboxProgram = null;
    }

    this.bboxProgram = this.createProgram(
      VERTEX_SHADER,
      makeBboxShader(samples),
      ["u_maskVideo", "u_bboxColor", "u_edgeSoftness", "u_minLuma"],
    );
    this.bboxSamplesCompiled = samples;
  }

  // ─── GL helpers ──────────────────────────────────────────────────────────

  private createProgram(
    vertSrc: string,
    fragSrc: string,
    uniformNames: string[],
  ): Program {
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
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 0,
         1, -1, 1, 0,
        -1,  1, 0, 1,
         1,  1, 1, 1,
      ]),
      gl.STATIC_DRAW,
    );
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

  // ─── Frame upload ─────────────────────────────────────────────────────────

  /**
   * Draw one half of the hstack video into splitCanvas, then upload to tex.
   * isLeft=true → base (left half), isLeft=false → mask (right half)
   */
  private drawHalfAndUpload(
    tex: WebGLTexture,
    video: HTMLVideoElement,
    isLeft: boolean,
  ) {
    const gl = this.gl;
    const ctx = this.splitCtx;
    if (!ctx) return;

    const sx = isLeft ? 0 : this.width;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(
      video,
      sx, 0, this.width, this.height,
      0,  0, this.width, this.height,
    );

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.splitCanvas!);
  }

  /**
   * Upload the full video frame (non-hstack mode).
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

  // ─── Public API ───────────────────────────────────────────────────────────

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.splitCanvas = new OffscreenCanvas(width, height);
    this.splitCtx = this.splitCanvas.getContext("2d", {
      willReadFrequently: false,
    }) as OffscreenCanvasRenderingContext2D;

    this.allocTexture(this.baseFrameTexture, width, height);
    this.allocTexture(this.maskFrameTexture, width, height);
  }

  /**
   * Compute the bounding box for a single mask color slot.
   * Runs the bbox shader into the 1×1 FBO and reads back the result.
   * Returns null if no pixels matched (bbMin > bbMax).
   */
  computeBbox(
    colorIndex: number,
    state: SubjectState,
  ): BBox | null {
    const gl = this.gl;
    if (!this.width || !this.height) return null;

    this.ensureBboxProgram(state.bboxSamples);
    const prog = this.bboxProgram!;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bboxFBO);
    gl.viewport(0, 0, 1, 1);

    gl.useProgram(prog.program);
    this.bindQuad(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskFrameTexture);
    gl.uniform1i(prog.uniforms["u_maskVideo"], 0);

    const c = state.maskColors[colorIndex];
    gl.uniform3f(prog.uniforms["u_bboxColor"], c.r, c.g, c.b);
    gl.uniform1f(prog.uniforms["u_edgeSoftness"], state.edgeSoftness);
    gl.uniform1f(prog.uniforms["u_minLuma"], state.minLuma);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Read back the single RGBA32F pixel
    const pixel = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const x1 = pixel[0], y1 = pixel[1], x2 = pixel[2], y2 = pixel[3];

    // If no pixels matched, x1 > x2 or y1 > y2
    if (x1 > x2 || y1 > y2) return null;

    return { x1, y1, x2, y2 };
  }

  /**
   * Render one frame.
   *
   * @param video     The <video> element (hstack or plain)
   * @param state     Current subject extraction parameters
   * @returns         Array of BBox | null, one per active mask color (only when showBbox is true)
   */
  renderFrame(video: HTMLVideoElement, state: SubjectState): Array<BBox | null> {
    const gl = this.gl;
    if (!this.width || !this.height) return [];
    if (video.readyState < 2) return [];

    const isHstack = state.isHstack;

    // 1. Upload base and mask frames
    if (isHstack) {
      this.drawHalfAndUpload(this.baseFrameTexture, video, true);
      this.drawHalfAndUpload(this.maskFrameTexture, video, false);
    } else {
      this.drawFullFrame(this.baseFrameTexture, video);
      this.drawFullFrame(this.maskFrameTexture, video);
    }

    // 2. Compute bboxes before the main render pass (while FBO is available)
    const bboxes: Array<BBox | null> = [];
    if (state.showBbox) {
      for (let i = 0; i < state.maskCount; i++) {
        bboxes.push(this.computeBbox(i, state));
      }
    }

    // 3. Main render pass to canvas
    gl.viewport(0, 0, this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Raw Input view: passthrough one half directly
    if (state.viewMode === 3) {
      const tex = state.rawInputShowBase
        ? this.baseFrameTexture
        : this.maskFrameTexture;

      gl.useProgram(this.passthroughProgram.program);
      this.bindQuad(this.passthroughProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.passthroughProgram.uniforms["u_texture"], 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return bboxes;
    }

    // Subject extraction pass
    gl.useProgram(this.subjectProgram.program);
    this.bindQuad(this.subjectProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.baseFrameTexture);
    gl.uniform1i(this.subjectProgram.uniforms["u_baseVideo"], 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskFrameTexture);
    gl.uniform1i(this.subjectProgram.uniforms["u_maskVideo"], 1);

    const activeMaskCount = Math.min(state.maskCount, 5);
    gl.uniform1i(this.subjectProgram.uniforms["u_numMaskColors"], activeMaskCount);
    for (let i = 0; i < 5; i++) {
      const c = state.maskColors[i];
      gl.uniform3f(
        this.subjectProgram.uniforms[`u_maskColors[${i}]`],
        c.r, c.g, c.b,
      );
    }

    gl.uniform1f(this.subjectProgram.uniforms["u_edgeSoftness"], state.edgeSoftness);
    gl.uniform1f(this.subjectProgram.uniforms["u_minLuma"], state.minLuma);
    gl.uniform1i(this.subjectProgram.uniforms["u_spillSuppression"], state.spillSuppression ? 1 : 0);
    gl.uniform1f(this.subjectProgram.uniforms["u_spillStrength"], state.spillStrength);
    gl.uniform1i(this.subjectProgram.uniforms["u_viewMode"], state.viewMode);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return bboxes;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.subjectProgram.program);
    gl.deleteProgram(this.passthroughProgram.program);
    if (this.bboxProgram) gl.deleteProgram(this.bboxProgram.program);
    gl.deleteTexture(this.baseFrameTexture);
    gl.deleteTexture(this.maskFrameTexture);
    gl.deleteTexture(this.bboxTexture);
    gl.deleteFramebuffer(this.bboxFBO);
    gl.deleteBuffer(this.quadBuffer);
  }
}
