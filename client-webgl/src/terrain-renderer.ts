import { linkProgram, createBuffer } from './gl-utils.js';
import {
  TILE_BASE_VS,
  TILE_BASE_FS,
  TILE_OVERLAY_VS,
  TILE_OVERLAY_FS,
} from './shaders.js';
import {
  BASE_INSTANCE_STRIDE,
  OVERLAY_INSTANCE_STRIDE,
  type TerrainInstanceBuffers,
} from './terrain-instances.js';
import { WATER_ANIM_FRAMES, WATER_FRAME_MS } from './config.js';

/**
 * Shared static vertex buffer holding the corner-id sequence for two
 * triangles covering the tile diamond:
 *
 *       0 (N)
 *   3 (W)   1 (E)
 *       2 (S)
 *
 * Triangles: (N, E, S) + (N, S, W)
 *
 * Uses signed BYTE because the shader declares `in int a_cornerId` — ANGLE's
 * SwiftShader backend (and the GLES 3.0 spec, strictly read) rejects
 * unsigned source types for a signed integer shader input. Chrome's GPU
 * backend silently converts, which masks the bug on desktop.
 */
const CORNER_ID_SEQUENCE = new Int8Array([0, 1, 2, 0, 2, 3]);

// Attribute location constants — must match the `layout(location=N)` decls
// in shaders.ts. Keeping them here keeps the JS setup readable without
// querying the program at runtime.
const LOC_CORNER_ID   = 0;
const LOC_CORNER_X    = 1;
const LOC_CORNER_Y    = 2;
const LOC_SRC_LAYER   = 3;
const LOC_MASK_LAYER  = 4;
const LOC_ANIM_STRIDE = 5;

interface BaseUniforms {
  resolution: WebGLUniformLocation;
  cameraPx: WebGLUniformLocation;
  terrain: WebGLUniformLocation;
  frame: WebGLUniformLocation;
}

interface OverlayUniforms extends BaseUniforms {
  masks: WebGLUniformLocation;
}

function getUniformOrThrow(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name);
  if (loc === null) throw new Error(`uniform not found: ${name}`);
  return loc;
}

/**
 * Configure the per-instance attribute slots shared between the base and
 * overlay VAOs: cornerX, cornerY, srcLayer. The overlay VAO additionally sets
 * up a_maskLayer (see overlay constructor path) and both VAOs set up
 * a_animStride which lives at a per-instance offset that depends on the
 * stride (base = 36, overlay = 40). The per-vertex corner-id attribute is
 * configured separately.
 */
function setupBaseInstanceAttribs(gl: WebGL2RenderingContext, stride: number): void {
  // 4 floats at offset 0  → a_cornerX
  gl.enableVertexAttribArray(LOC_CORNER_X);
  gl.vertexAttribPointer(LOC_CORNER_X, 4, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(LOC_CORNER_X, 1);

  // 4 floats at offset 16 → a_cornerY
  gl.enableVertexAttribArray(LOC_CORNER_Y);
  gl.vertexAttribPointer(LOC_CORNER_Y, 4, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(LOC_CORNER_Y, 1);

  // 1 int32 at offset 32 → a_srcLayer (integer attribute — must use IPointer)
  gl.enableVertexAttribArray(LOC_SRC_LAYER);
  gl.vertexAttribIPointer(LOC_SRC_LAYER, 1, gl.INT, stride, 32);
  gl.vertexAttribDivisor(LOC_SRC_LAYER, 1);
}

/**
 * Configure the per-vertex corner-id attribute from the shared corner-id VBO.
 * The buffer holds 6 bytes (one triangle-strip's worth of corner indices).
 * Called after binding the corner-id VBO on the current VAO.
 */
function setupCornerIdAttrib(gl: WebGL2RenderingContext): void {
  gl.enableVertexAttribArray(LOC_CORNER_ID);
  gl.vertexAttribIPointer(LOC_CORNER_ID, 1, gl.BYTE, 0, 0);
  gl.vertexAttribDivisor(LOC_CORNER_ID, 0);
}

export class TerrainRenderer {
  private readonly gl: WebGL2RenderingContext;

  private readonly baseProgram: WebGLProgram;
  private readonly overlayProgram: WebGLProgram;

  private readonly baseVao: WebGLVertexArrayObject;
  private readonly overlayVao: WebGLVertexArrayObject;

  private readonly baseBuffer: WebGLBuffer;
  private readonly overlayBuffer: WebGLBuffer;
  private readonly cornerIdBuffer: WebGLBuffer;

  private readonly baseUniforms: BaseUniforms;
  private readonly overlayUniforms: OverlayUniforms;

  private readonly baseCount: number;
  private readonly overlayCount: number;

  constructor(gl: WebGL2RenderingContext, instances: TerrainInstanceBuffers) {
    this.gl = gl;
    this.baseCount = instances.baseCount;
    this.overlayCount = instances.overlayCount;

    this.baseProgram = linkProgram(gl, TILE_BASE_VS, TILE_BASE_FS);
    this.overlayProgram = linkProgram(gl, TILE_OVERLAY_VS, TILE_OVERLAY_FS);

    // Shared corner-id VBO — tiny (6 bytes), reused by both VAOs.
    this.cornerIdBuffer = createBuffer(gl, gl.ARRAY_BUFFER, CORNER_ID_SEQUENCE, gl.STATIC_DRAW);

    // --- Base VAO ---------------------------------------------------------
    const baseVao = gl.createVertexArray();
    if (!baseVao) throw new Error('createVertexArray returned null');
    this.baseVao = baseVao;
    gl.bindVertexArray(baseVao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerIdBuffer);
    setupCornerIdAttrib(gl);

    this.baseBuffer = createBuffer(
      gl,
      gl.ARRAY_BUFFER,
      new Uint8Array(instances.baseData),
      gl.STATIC_DRAW,
    );
    setupBaseInstanceAttribs(gl, BASE_INSTANCE_STRIDE);

    // a_animStride lives right after a_srcLayer on base instances (offset 36).
    gl.enableVertexAttribArray(LOC_ANIM_STRIDE);
    gl.vertexAttribIPointer(LOC_ANIM_STRIDE, 1, gl.INT, BASE_INSTANCE_STRIDE, 36);
    gl.vertexAttribDivisor(LOC_ANIM_STRIDE, 1);

    // --- Overlay VAO ------------------------------------------------------
    const overlayVao = gl.createVertexArray();
    if (!overlayVao) throw new Error('createVertexArray returned null');
    this.overlayVao = overlayVao;
    gl.bindVertexArray(overlayVao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerIdBuffer);
    setupCornerIdAttrib(gl);

    this.overlayBuffer = createBuffer(
      gl,
      gl.ARRAY_BUFFER,
      new Uint8Array(instances.overlayData),
      gl.STATIC_DRAW,
    );
    setupBaseInstanceAttribs(gl, OVERLAY_INSTANCE_STRIDE);

    // Extra integer attribute: a_maskLayer at offset 36
    gl.enableVertexAttribArray(LOC_MASK_LAYER);
    gl.vertexAttribIPointer(LOC_MASK_LAYER, 1, gl.INT, OVERLAY_INSTANCE_STRIDE, 36);
    gl.vertexAttribDivisor(LOC_MASK_LAYER, 1);

    // a_animStride at offset 40 on overlay instances (after srcLayer + maskLayer).
    gl.enableVertexAttribArray(LOC_ANIM_STRIDE);
    gl.vertexAttribIPointer(LOC_ANIM_STRIDE, 1, gl.INT, OVERLAY_INSTANCE_STRIDE, 40);
    gl.vertexAttribDivisor(LOC_ANIM_STRIDE, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // --- Uniform locations ------------------------------------------------
    this.baseUniforms = {
      resolution: getUniformOrThrow(gl, this.baseProgram, 'u_resolution'),
      cameraPx: getUniformOrThrow(gl, this.baseProgram, 'u_cameraPx'),
      terrain: getUniformOrThrow(gl, this.baseProgram, 'u_terrain'),
      frame: getUniformOrThrow(gl, this.baseProgram, 'u_frame'),
    };
    this.overlayUniforms = {
      resolution: getUniformOrThrow(gl, this.overlayProgram, 'u_resolution'),
      cameraPx: getUniformOrThrow(gl, this.overlayProgram, 'u_cameraPx'),
      terrain: getUniformOrThrow(gl, this.overlayProgram, 'u_terrain'),
      masks: getUniformOrThrow(gl, this.overlayProgram, 'u_masks'),
      frame: getUniformOrThrow(gl, this.overlayProgram, 'u_frame'),
    };
  }

  render(
    resolution: readonly [number, number],
    cameraPx: readonly [number, number],
    terrainTexture: WebGLTexture,
    maskTexture: WebGLTexture,
    time: number,
  ): void {
    const gl = this.gl;

    // Water/river animation frame. WATER_FRAME_MS=160, WATER_ANIM_FRAMES=4
    // → one full cycle every 640 ms. Non-animated tiles have animStride=0 in
    // their instance record so this uniform has no effect on them.
    const frame = Math.floor(time / WATER_FRAME_MS) % WATER_ANIM_FRAMES;

    // Bind both texture arrays up front. Base program only uses unit 0,
    // overlay program uses both — binding twice is free.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, terrainTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, maskTexture);

    // --- Base pass --------------------------------------------------------
    gl.useProgram(this.baseProgram);
    gl.uniform2f(this.baseUniforms.resolution, resolution[0], resolution[1]);
    gl.uniform2f(this.baseUniforms.cameraPx, cameraPx[0], cameraPx[1]);
    gl.uniform1i(this.baseUniforms.terrain, 0);
    gl.uniform1i(this.baseUniforms.frame, frame);

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.baseVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.baseCount);

    // --- Overlay pass -----------------------------------------------------
    gl.useProgram(this.overlayProgram);
    gl.uniform2f(this.overlayUniforms.resolution, resolution[0], resolution[1]);
    gl.uniform2f(this.overlayUniforms.cameraPx, cameraPx[0], cameraPx[1]);
    gl.uniform1i(this.overlayUniforms.terrain, 0);
    gl.uniform1i(this.overlayUniforms.masks, 1);
    gl.uniform1i(this.overlayUniforms.frame, frame);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.overlayVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.overlayCount);

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
