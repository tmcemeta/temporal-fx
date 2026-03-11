// SIMPLE SUBJECT — WebGL2 Subject Extraction Engine
//
// Minimal WebGL2 engine focused solely on subject extraction.
// No history atlas, no ring buffer, no compositing FBO.
//
// Pipeline per frame:
//   1. Split hstack video into base and mask textures via OffscreenCanvas.
//   2. Run SUBJECT_SHADER: key the mask, apply spill suppression, output composite.
//   3. For Raw Input view, run PASSTHROUGH_SHADER on the selected half.
//
// HSTACK VIDEO FORMAT:
//   A single <video> element whose decoded frames are side-by-side:
//   left half = base, right half = mask.
//   Produced by: ffmpeg -y -i "$BASE" -i "$MASK" -filter_complex hstack "$OUT"
//
//   Splitting is done via a persistent OffscreenCanvas:
//     ctx.drawImage(video, sx, 0, w, h, 0, 0, w, h)
//   where sx=0 for base (left) and sx=w for mask (right).

import type { SubjectState } from "./types";
import { VERTEX_SHADER, SUBJECT_SHADER, PASSTHROUGH_SHADER } from "./shaders";

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
  }

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
   * Render one frame.
   *
   * @param video     The <video> element (hstack or plain)
   * @param state     Current subject extraction parameters
   */
  renderFrame(video: HTMLVideoElement, state: SubjectState) {
    const gl = this.gl;
    if (!this.width || !this.height) return;
    if (video.readyState < 2) return;

    const isHstack = state.isHstack;

    // 1. Upload base and mask frames
    if (isHstack) {
      this.drawHalfAndUpload(this.baseFrameTexture, video, true);
      this.drawHalfAndUpload(this.maskFrameTexture, video, false);
    } else {
      // No separate mask: use the same frame for both
      this.drawFullFrame(this.baseFrameTexture, video);
      this.drawFullFrame(this.maskFrameTexture, video);
    }

    gl.viewport(0, 0, this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 2. Raw Input view: passthrough one half directly
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
      return;
    }

    // 3. Subject extraction pass
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
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.subjectProgram.program);
    gl.deleteProgram(this.passthroughProgram.program);
    gl.deleteTexture(this.baseFrameTexture);
    gl.deleteTexture(this.maskFrameTexture);
    gl.deleteBuffer(this.quadBuffer);
  }
}
