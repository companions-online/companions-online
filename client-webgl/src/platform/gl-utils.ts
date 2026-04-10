// Minimal WebGL2 helpers: shader compile/link, texture-array uploads from
// OffscreenCanvas sources, and a few attribute-setup wrappers.
//
// Everything here throws on GL errors so callers can fail loud at init time.

export function compileShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('gl.createShader returned null');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`${kind} shader compile failed:\n${log}\n--- source ---\n${source}`);
  }
  return shader;
}

export function linkProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error('gl.createProgram returned null');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    gl.deleteProgram(program);
    throw new Error(`program link failed:\n${log}`);
  }
  // Shaders can be flagged for deletion as soon as they're linked into a
  // program — the GL keeps them alive until the program is destroyed.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

/**
 * Allocate a 2D texture array with RGBA8 storage for `numLayers` layers of the
 * given dimensions. Returns a freshly-bound texture — caller is responsible
 * for uploading layers with `uploadCanvasLayer` and leaving it bound if they
 * want to keep using it, or unbinding if not.
 */
export function createTextureArray(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  numLayers: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('gl.createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);

  // Immutable storage — one allocation, then texSubImage3D per layer.
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, numLayers);

  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return tex;
}

/**
 * Upload one layer of an already-allocated texture array from an ImageBitmap
 * source. The caller must have set the desired pixel-store state
 * (FLIP_Y, PREMULTIPLY_ALPHA) before calling; we don't touch it here so
 * callers can batch uploads with identical settings.
 */
export function uploadBitmapLayer(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  layer: number,
  width: number,
  height: number,
  bitmap: ImageBitmap,
): void {
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texSubImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,          // mip
    0, 0, layer,
    width, height, 1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bitmap,
  );
}

/**
 * Create an immutable 2D texture from an image (used for the deer sprite sheet).
 * Uses NEAREST filtering — isometric pixel sprites must not be smoothed.
 */
export function createImageTexture(gl: WebGL2RenderingContext, image: HTMLImageElement): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('gl.createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // Leave UNPACK_FLIP_Y_WEBGL at its default (false) for HTMLImageElement
  // uploads. With this setting, row 0 of the image lands at texture v=0, and
  // our sprite shader computes UV as `srcRect.xy + a_unit * srcRect.zw` where
  // a_unit.y=0 is at the top of the quad — so the top of the quad samples the
  // top of the frame. (Setting FLIP_Y=true here gives vertically flipped
  // sprites — verified empirically against SwiftShader.)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return tex;
}

/**
 * Create and bind a new VBO, filling it with the given data. Returns the
 * buffer handle — caller should keep it bound while setting up attribute
 * pointers on the current VAO.
 */
export function createBuffer(
  gl: WebGL2RenderingContext,
  target: GLenum,
  data: ArrayBufferView | null,
  usage: GLenum,
): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error('gl.createBuffer returned null');
  gl.bindBuffer(target, buf);
  if (data) gl.bufferData(target, data, usage);
  return buf;
}

/** Throw if `gl.getError()` reports anything other than `NO_ERROR`. */
export function checkGLError(gl: WebGL2RenderingContext, context: string): void {
  const err = gl.getError();
  if (err !== gl.NO_ERROR) {
    throw new Error(`GL error at ${context}: 0x${err.toString(16)}`);
  }
}
