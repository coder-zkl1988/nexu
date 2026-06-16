/**
 * MirrorGLRenderer - WebGL2-based YUV renderer for phone mirroring
 *
 * Eliminates ~150-200ms JPEG encode/decode latency by rendering VideoFrames
 * directly to WebGL textures. Supports multiple rendering paths for
 * compatibility across browsers.
 */

interface MirrorFrame {
  width: number;
  height: number;
  timestamp: number;
}

/** Decode a base64 string to an ArrayBuffer (for building a Blob to decode off-thread). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return buffer;
}

interface RendererCapabilities {
  directVideoFrameUpload: boolean;
  imageBitmap: boolean;
  offscreenCanvas: boolean;
}

export class MirrorGLRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private rgbaProgram: WebGLProgram | null = null;
  private rgbaPositionLoc = 0;
  private rgbaTextureLoc: WebGLUniformLocation | null = null;
  private texScaleLoc: WebGLUniformLocation | null = null;
  private rgbaTexScaleLoc: WebGLUniformLocation | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  // Single reusable RGBA texture for all upload paths (VideoFrame / offscreen /
  // JPEG). Reused across frames to avoid per-frame createTexture/deleteTexture
  // driver churn at 30fps. texImage2D re-specifies its storage each frame.
  private rgbaTexture: WebGLTexture | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private offscreenCanvas: OffscreenCanvas | null = null;
  private offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

  private jpegImg: HTMLImageElement | null = null;
  // Monotonic counter so async ImageBitmap decodes can drop stale frames.
  private jpegSeq = 0;

  private displayWidth = 0;
  private displayHeight = 0;
  private streamWidth = 0;
  private streamHeight = 0;
  // texScale clips macroblock padding: (displayWidth/codedWidth, displayHeight/codedHeight)
  // For direct VideoFrame upload, texture has coded dims → texScale < 1.0
  // For offscreen canvas fallback, texture has display dims → texScale = 1.0
  private texScaleX = 1.0;
  private texScaleY = 1.0;

  private capabilities: RendererCapabilities = {
    directVideoFrameUpload: false,
    imageBitmap: false,
    offscreenCanvas: false,
  };

  private fallbackTo2D = false;
  private ctx2D: CanvasRenderingContext2D | null = null;

  // Shader locations
  private positionLoc = 0;

  /** Initialize the renderer on the given canvas element */
  init(canvas: HTMLCanvasElement): void {
    if (this.gl !== null) {
      console.warn("[MirrorGLRenderer] Already initialized, destroying first");
      this.destroy();
    }

    this.canvas = canvas;

    // Try WebGL2 first
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      console.warn(
        "[MirrorGLRenderer] WebGL2 not available, falling back to Canvas 2D",
      );
      this.initFallback2D(canvas);
      return;
    }

    this.gl = gl;

    // Detect capabilities
    this.detectCapabilities();

    // Initialize shaders and buffers
    try {
      this.initShaders();
      this.initBuffers();
    } catch (e) {
      console.error("[MirrorGLRenderer] WebGL init failed, falling back:", e);
      this.cleanupWebGL();
      this.initFallback2D(canvas);
      return;
    }

    // Initialize offscreen canvas for fallback paths
    if (this.capabilities.offscreenCanvas) {
      this.offscreenCanvas = new OffscreenCanvas(1, 1);
      this.offscreenCtx = this.offscreenCanvas.getContext("2d");
    }

    console.log(
      "[MirrorGLRenderer] Initialized, capabilities:",
      this.capabilities,
    );
  }

  private detectCapabilities(): void {
    this.capabilities = {
      directVideoFrameUpload: false, // We'll test this at first render
      imageBitmap: typeof createImageBitmap !== "undefined",
      offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    };
  }

  private initFallback2D(canvas: HTMLCanvasElement): void {
    this.fallbackTo2D = true;
    this.ctx2D = canvas.getContext("2d");
    if (!this.ctx2D) {
      throw new Error("Neither WebGL2 nor Canvas 2D available");
    }
  }

  private initShaders(): void {
    if (!this.gl) return;

    const vertexSource = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
uniform vec2 u_texScale;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = (a_position + 1.0) * 0.5 * u_texScale;
    v_texCoord.y = u_texScale.y - v_texCoord.y;
}`;

    const fragmentSource = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_yTexture;
uniform sampler2D u_uTexture;
uniform sampler2D u_vTexture;

void main() {
    float y = texture(u_yTexture, v_texCoord).r;
    float u = texture(u_uTexture, v_texCoord).r - 0.5;
    float v = texture(u_vTexture, v_texCoord).r - 0.5;
    // BT.601 full range
    float r = y + 1.402 * v;
    float g = y - 0.344136 * u - 0.714136 * v;
    float b = y + 1.772 * u;
    fragColor = vec4(r, g, b, 1.0);
}`;

    const vertexShader = this.compileShader(
      vertexSource,
      this.gl.VERTEX_SHADER,
    );
    const fragmentShader = this.compileShader(
      fragmentSource,
      this.gl.FRAGMENT_SHADER,
    );

    if (!vertexShader || !fragmentShader) {
      throw new Error("Shader compilation failed");
    }

    this.program = this.gl.createProgram();
    if (!this.program) {
      throw new Error("Failed to create shader program");
    }

    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(this.program);
      throw new Error(`Program link failed: ${info}`);
    }

    this.gl.useProgram(this.program);

    // Get attribute and uniform locations
    this.positionLoc = this.gl.getAttribLocation(this.program, "a_position");
    this.texScaleLoc = this.gl.getUniformLocation(this.program, "u_texScale");
    if (this.texScaleLoc !== null) {
      this.gl.uniform2f(this.texScaleLoc, 1.0, 1.0);
    }

    // Initialize RGBA program for non-YUV rendering paths
    this.initRGBAProgram();
  }

  private compileShader(source: string, type: number): WebGLShader | null {
    if (!this.gl) return null;

    const shader = this.gl.createShader(type);
    if (!shader) return null;

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      console.error("[MirrorGLRenderer] Shader compile error:", info);
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /** Set texture params required for non-mipmapped textures (prevents black rendering) */
  private setTextureParams(): void {
    if (!this.gl) return;
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE,
    );
  }

  /**
   * Get the shared RGBA texture, creating and configuring it on first use.
   * Bound to TEXTURE_2D on return so callers can upload via texImage2D.
   */
  private acquireRgbaTexture(): WebGLTexture | null {
    if (!this.gl) return null;
    if (this.rgbaTexture === null) {
      const tex = this.gl.createTexture();
      if (!tex) return null;
      this.rgbaTexture = tex;
      this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
      this.setTextureParams();
      return tex;
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.rgbaTexture);
    return this.rgbaTexture;
  }

  private initBuffers(): void {
    if (!this.gl) return;

    // Fullscreen quad (TRIANGLE_STRIP): [-1,-1, 1,-1, -1,1, 1,1]
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

    const vbo = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

    this.vao = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.vao);
    this.gl.enableVertexAttribArray(this.positionLoc);
    this.gl.vertexAttribPointer(
      this.positionLoc,
      2,
      this.gl.FLOAT,
      false,
      0,
      0,
    );
  }

  private updateViewport(): void {
    if (!this.gl) return;
    // Canvas CSS uses aspect-ratio to match stream dimensions, so the canvas
    // already has the correct proportions — no letterbox/pillarbox needed.
    this.gl.viewport(0, 0, this.displayWidth, this.displayHeight);
  }

  private renderWithVideoFrameDirect(
    frame: VideoFrame,
    contentW: number,
    contentH: number,
  ): boolean {
    if (!this.gl || !this.program) return false;

    try {
      // Try direct VideoFrame upload (Chromium 94+)
      // This works because Chrome can upload VideoFrame directly to RGBA texture
      // and we bypass the YUV conversion (let browser handle it)

      // Reuse the shared RGBA texture (bound on return)
      const texture = this.acquireRgbaTexture();
      if (!texture) return false;

      // Try to upload VideoFrame directly via TexImageSource overload
      // (Chromium 94+). Must use the 6-arg form: (target, level, internalformat, format, type, source)
      // The 9-arg form with width/height/border expects ArrayBufferView pixels, not VideoFrame.
      try {
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.RGBA,
          this.gl.RGBA,
          this.gl.UNSIGNED_BYTE,
          frame as unknown as TexImageSource,
        );
      } catch {
        return false;
      }

      // Check for silent WebGL errors (texImage2D doesn't throw on invalid overloads)
      if (this.gl.getError() !== this.gl.NO_ERROR) {
        return false;
      }

      // If we get here, direct upload worked!
      // Direct upload creates a texture with codedWidth×codedHeight (includes macroblock padding).
      // Scale to the content size to clip both the macroblock padding and any
      // right/bottom encoder padding the stream carries.
      const cw = frame.codedWidth || frame.displayWidth;
      const ch = frame.codedHeight || frame.displayHeight;
      this.texScaleX = contentW / cw;
      this.texScaleY = contentH / ch;

      this.renderRGBATexture(texture);

      this.capabilities.directVideoFrameUpload = true;
      return true;
    } catch {
      return false;
    }
  }

  private renderWithOffscreenCanvas(
    frame: VideoFrame,
    contentW: number,
    contentH: number,
  ): boolean {
    if (
      !this.gl ||
      !this.program ||
      !this.offscreenCanvas ||
      !this.offscreenCtx
    ) {
      return false;
    }

    try {
      const width = frame.displayWidth;
      const height = frame.displayHeight;

      // Resize offscreen canvas if needed
      if (
        this.offscreenCanvas.width !== width ||
        this.offscreenCanvas.height !== height
      ) {
        this.offscreenCanvas.width = width;
        this.offscreenCanvas.height = height;
      }

      // Draw VideoFrame to offscreen canvas
      this.offscreenCtx.drawImage(frame, 0, 0);

      // Read pixels and upload to WebGL
      const imageData = this.offscreenCtx.getImageData(0, 0, width, height);

      // Reuse the shared RGBA texture (bound on return)
      const texture = this.acquireRgbaTexture();
      if (!texture) return false;

      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        width,
        height,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        imageData.data,
      );

      // The texture is the frame's display size (width×height); scale to the
      // content size to clip any right/bottom encoder padding the stream carries.
      this.texScaleX = contentW / width;
      this.texScaleY = contentH / height;

      this.renderRGBATexture(texture);

      return true;
    } catch {
      return false;
    }
  }

  private renderRGBATexture(texture: WebGLTexture): void {
    if (!this.gl) return;

    // Initialize RGBA program on first use
    this.initRGBAProgram();
    if (!this.rgbaProgram) return;

    this.gl.useProgram(this.rgbaProgram);

    // Set texScale for RGBA program based on the rendering path used
    if (this.rgbaTexScaleLoc !== null) {
      this.gl.uniform2f(this.rgbaTexScaleLoc, this.texScaleX, this.texScaleY);
    }

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    if (this.rgbaTextureLoc !== null) {
      this.gl.uniform1i(this.rgbaTextureLoc, 0);
    }

    this.gl.bindVertexArray(this.vao);
    this.gl.enableVertexAttribArray(this.rgbaPositionLoc);
    this.gl.vertexAttribPointer(
      this.rgbaPositionLoc,
      2,
      this.gl.FLOAT,
      false,
      0,
      0,
    );

    this.updateViewport();
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private initRGBAProgram(): void {
    if (!this.gl || this.rgbaProgram) return;

    const vertexSource = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
uniform vec2 u_texScale;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = (a_position + 1.0) * 0.5 * u_texScale;
    v_texCoord.y = u_texScale.y - v_texCoord.y;
}`;

    const fragmentSource = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;
void main() {
    fragColor = texture(u_texture, v_texCoord);
}`;

    const vertexShader = this.compileShader(
      vertexSource,
      this.gl.VERTEX_SHADER,
    );
    const fragmentShader = this.compileShader(
      fragmentSource,
      this.gl.FRAGMENT_SHADER,
    );
    if (!vertexShader || !fragmentShader) return;

    this.rgbaProgram = this.gl.createProgram();
    if (!this.rgbaProgram) return;

    this.gl.attachShader(this.rgbaProgram, vertexShader);
    this.gl.attachShader(this.rgbaProgram, fragmentShader);
    this.gl.linkProgram(this.rgbaProgram);

    // Shaders are attached to program — safe to delete (they'll be freed when program is deleted)
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);

    if (!this.gl.getProgramParameter(this.rgbaProgram, this.gl.LINK_STATUS)) {
      this.gl.deleteProgram(this.rgbaProgram);
      this.rgbaProgram = null;
      return;
    }

    this.rgbaPositionLoc = this.gl.getAttribLocation(
      this.rgbaProgram,
      "a_position",
    );
    this.rgbaTextureLoc = this.gl.getUniformLocation(
      this.rgbaProgram,
      "u_texture",
    );
    this.rgbaTexScaleLoc = this.gl.getUniformLocation(
      this.rgbaProgram,
      "u_texScale",
    );
  }

  private renderWith2DFallback(
    frame: VideoFrame,
    contentW: number,
    contentH: number,
  ): void {
    if (!this.ctx2D || !this.canvas) return;

    // Size the canvas to the content (cropped) dimensions
    if (this.canvas.width !== contentW || this.canvas.height !== contentH) {
      this.canvas.width = contentW;
      this.canvas.height = contentH;
    }

    // Draw only the top-left content region, dropping right/bottom padding
    this.ctx2D.drawImage(
      frame,
      0,
      0,
      contentW,
      contentH,
      0,
      0,
      contentW,
      contentH,
    );
  }

  /**
   * Render a decoded VideoFrame directly to the WebGL canvas.
   *
   * `streamWidth`/`streamHeight` are the real content dimensions reported by the
   * stream. The decoded frame may be larger (the encoder pads to 16-px
   * macroblocks; when it doesn't emit SPS cropping, that padding shows up as the
   * frame's coded/display size). Cropping to the stream size removes the
   * right/bottom padding so no black edge appears. They default to the frame's
   * own display size when not provided.
   */
  render(frame: VideoFrame, streamWidth?: number, streamHeight?: number): void {
    const contentW =
      streamWidth && streamWidth > 0 ? streamWidth : frame.displayWidth;
    const contentH =
      streamHeight && streamHeight > 0 ? streamHeight : frame.displayHeight;

    if (this.fallbackTo2D) {
      this.renderWith2DFallback(frame, contentW, contentH);
      frame.close();
      return;
    }

    if (!this.gl || !this.program) {
      frame.close();
      return;
    }

    // Track the content dimensions (used for coordinate mapping via getFrameInfo)
    this.streamWidth = contentW;
    this.streamHeight = contentH;

    // Try rendering paths in order of efficiency
    let rendered = false;

    // Path 1: Direct VideoFrame upload (fastest, zero-copy in Chromium)
    if (this.capabilities.directVideoFrameUpload) {
      rendered = this.renderWithVideoFrameDirect(frame, contentW, contentH);
    }

    // Path 2: Try direct upload once to test capability
    if (!rendered && !this.capabilities.directVideoFrameUpload) {
      rendered = this.renderWithVideoFrameDirect(frame, contentW, contentH);
    }

    // Path 3: OffscreenCanvas + RGBA texture
    if (!rendered) {
      rendered = this.renderWithOffscreenCanvas(frame, contentW, contentH);
    }

    // Path 4: 2D fallback within WebGL canvas
    if (!rendered) {
      this.renderWith2DFallback(frame, contentW, contentH);
    }

    frame.close();
  }

  /**
   * Render a base64-encoded JPEG/PNG frame to the canvas (STABLE mode).
   * Uses a cached Image object — rapid calls reuse the same element and the
   * browser cancels any in-flight load.
   */
  renderJPEG(
    screenshot: string,
    width: number,
    height: number,
    format: "jpeg" | "png" = "jpeg",
  ): void {
    this.streamWidth = width;
    this.streamHeight = height;

    // Prefer createImageBitmap: decodes off the main thread and avoids the
    // implicit frame-drop of reusing one <img> (a new src cancels the in-flight
    // decode). Fall back to <img> + data URL where it's unavailable.
    if (this.capabilities.imageBitmap) {
      const seq = ++this.jpegSeq;
      const blob = new Blob([base64ToArrayBuffer(screenshot)], {
        type: `image/${format}`,
      });
      createImageBitmap(blob)
        .then((bitmap) => {
          // A newer frame already arrived — drop this stale one.
          if (seq !== this.jpegSeq) {
            bitmap.close();
            return;
          }
          this.uploadJpegSource(bitmap);
          bitmap.close();
        })
        .catch(() => {});
      return;
    }

    // Legacy fallback: reuse a single Image object to avoid allocations.
    if (!this.jpegImg) {
      this.jpegImg = new Image();
    }
    const img = this.jpegImg;
    img.onload = () => this.uploadJpegSource(img);
    img.src = `data:image/${format};base64,${screenshot}`;
  }

  /** Upload a decoded JPEG/PNG source (ImageBitmap or HTMLImageElement) and render it. */
  private uploadJpegSource(source: TexImageSource): void {
    // 2D fallback path
    if (this.fallbackTo2D) {
      if (this.ctx2D && this.canvas) {
        this.ctx2D.drawImage(
          source as CanvasImageSource,
          0,
          0,
          this.canvas.width,
          this.canvas.height,
        );
      }
      return;
    }

    // WebGL path: upload to the shared RGBA texture
    if (!this.gl) return;

    const texture = this.acquireRgbaTexture();
    if (!texture) return;

    try {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        source,
      );
    } catch {
      return;
    }

    // JPEG/PNG images have no macroblock padding
    this.texScaleX = 1.0;
    this.texScaleY = 1.0;

    this.renderRGBATexture(texture);
  }

  /** Update the display dimensions (called on resize) */
  resize(displayWidth: number, displayHeight: number): void {
    const w = Math.round(displayWidth);
    const h = Math.round(displayHeight);
    this.displayWidth = w;
    this.displayHeight = h;

    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    if (this.gl) {
      this.gl.viewport(0, 0, w, h);
    }
  }

  /** Get the current canvas for coordinate mapping */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /** Get current frame info for coordinate mapping */
  getFrameInfo(): MirrorFrame | null {
    if (this.streamWidth === 0 || this.streamHeight === 0) return null;
    return {
      width: this.streamWidth,
      height: this.streamHeight,
      timestamp: Date.now(),
    };
  }

  /** Clean up GPU resources */
  destroy(): void {
    this.cleanupWebGL();

    if (this.ctx2D) {
      this.ctx2D = null;
    }

    this.canvas = null;
    this.fallbackTo2D = false;
    this.streamWidth = 0;
    this.streamHeight = 0;
    this.texScaleX = 1.0;
    this.texScaleY = 1.0;
    this.displayWidth = 0;
    this.displayHeight = 0;
    this.jpegImg = null;
  }

  private cleanupWebGL(): void {
    if (!this.gl) return;

    if (this.rgbaTexture) {
      this.gl.deleteTexture(this.rgbaTexture);
      this.rgbaTexture = null;
    }
    if (this.rgbaProgram) {
      this.gl.deleteProgram(this.rgbaProgram);
      this.rgbaProgram = null;
    }
    if (this.vao) {
      this.gl.deleteVertexArray(this.vao);
      this.vao = null;
    }
    if (this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }

    this.gl = null;
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
  }
}
