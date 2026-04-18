import { linkProgram, createBuffer } from '../platform/gl-utils.js';
import {
  TILE_BASE_VS,
  TILE_BASE_FS,
  TILE_OVERLAY_VS,
  TILE_OVERLAY_FS,
} from './shaders.js';
import { BASE_INSTANCE_STRIDE, OVERLAY_INSTANCE_STRIDE } from './terrain-instances.js';
import { WATER_ANIM_FRAMES, WATER_FRAME_MS } from '../platform/config.js';

// Corner-id sequence covering the tile diamond as two triangles.
// See the vertex shader for the expected layout.
const CORNER_ID_SEQUENCE = new Int8Array([0, 1, 2, 0, 2, 3]);

const LOC_CORNER_ID    = 0;
const LOC_CORNER_X     = 1;
const LOC_CORNER_Y     = 2;
const LOC_SRC_LAYER    = 3;
const LOC_MASK_LAYER   = 4;
const LOC_ANIM_STRIDE  = 5;
const LOC_TILE_XY      = 6;

interface BaseUniforms {
  resolution: WebGLUniformLocation;
  cameraPx: WebGLUniformLocation;
  terrain: WebGLUniformLocation;
  frame: WebGLUniformLocation;
  lightmap: WebGLUniformLocation;
  lightmapOrigin: WebGLUniformLocation;
  lightmapSize: WebGLUniformLocation;
}

interface OverlayUniforms extends BaseUniforms {
  masks: WebGLUniformLocation;
}

export interface LightmapBinding {
  texture: WebGLTexture;
  originX: number;
  originY: number;
  size: number;
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

function setupBaseInstanceAttribs(gl: WebGL2RenderingContext, stride: number): void {
  gl.enableVertexAttribArray(LOC_CORNER_X);
  gl.vertexAttribPointer(LOC_CORNER_X, 4, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(LOC_CORNER_X, 1);
  gl.enableVertexAttribArray(LOC_CORNER_Y);
  gl.vertexAttribPointer(LOC_CORNER_Y, 4, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(LOC_CORNER_Y, 1);
  gl.enableVertexAttribArray(LOC_SRC_LAYER);
  gl.vertexAttribIPointer(LOC_SRC_LAYER, 1, gl.INT, stride, 32);
  gl.vertexAttribDivisor(LOC_SRC_LAYER, 1);
}

function setupCornerIdAttrib(gl: WebGL2RenderingContext): void {
  gl.enableVertexAttribArray(LOC_CORNER_ID);
  gl.vertexAttribIPointer(LOC_CORNER_ID, 1, gl.BYTE, 0, 0);
  gl.vertexAttribDivisor(LOC_CORNER_ID, 0);
}

/**
 * Owns the GPU programs, VAOs, and buffers for terrain rendering. Instance
 * data is uploaded via `uploadInstances()` — the Scene rebuilds the full
 * buffers from per-chunk data each time a chunk is added, updated, or
 * evicted. Boot state is empty (zero draw counts).
 */
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

  private baseCount = 0;
  private overlayCount = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    this.baseProgram = linkProgram(gl, TILE_BASE_VS, TILE_BASE_FS);
    this.overlayProgram = linkProgram(gl, TILE_OVERLAY_VS, TILE_OVERLAY_FS);

    this.cornerIdBuffer = createBuffer(gl, gl.ARRAY_BUFFER, CORNER_ID_SEQUENCE, gl.STATIC_DRAW);

    // Allocate empty per-instance buffers with DYNAMIC_DRAW usage. Actual
    // contents are uploaded via uploadInstances() when the scene has chunks
    // to draw.
    const emptyBase = gl.createBuffer();
    if (!emptyBase) throw new Error('createBuffer returned null');
    this.baseBuffer = emptyBase;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.baseBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);

    const emptyOverlay = gl.createBuffer();
    if (!emptyOverlay) throw new Error('createBuffer returned null');
    this.overlayBuffer = emptyOverlay;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);

    // --- Base VAO ---------------------------------------------------------
    const baseVao = gl.createVertexArray();
    if (!baseVao) throw new Error('createVertexArray returned null');
    this.baseVao = baseVao;
    gl.bindVertexArray(baseVao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerIdBuffer);
    setupCornerIdAttrib(gl);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.baseBuffer);
    setupBaseInstanceAttribs(gl, BASE_INSTANCE_STRIDE);
    gl.enableVertexAttribArray(LOC_ANIM_STRIDE);
    gl.vertexAttribIPointer(LOC_ANIM_STRIDE, 1, gl.INT, BASE_INSTANCE_STRIDE, 36);
    gl.vertexAttribDivisor(LOC_ANIM_STRIDE, 1);
    gl.enableVertexAttribArray(LOC_TILE_XY);
    gl.vertexAttribPointer(LOC_TILE_XY, 2, gl.FLOAT, false, BASE_INSTANCE_STRIDE, 40);
    gl.vertexAttribDivisor(LOC_TILE_XY, 1);

    // --- Overlay VAO ------------------------------------------------------
    const overlayVao = gl.createVertexArray();
    if (!overlayVao) throw new Error('createVertexArray returned null');
    this.overlayVao = overlayVao;
    gl.bindVertexArray(overlayVao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerIdBuffer);
    setupCornerIdAttrib(gl);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayBuffer);
    setupBaseInstanceAttribs(gl, OVERLAY_INSTANCE_STRIDE);
    gl.enableVertexAttribArray(LOC_MASK_LAYER);
    gl.vertexAttribIPointer(LOC_MASK_LAYER, 1, gl.INT, OVERLAY_INSTANCE_STRIDE, 36);
    gl.vertexAttribDivisor(LOC_MASK_LAYER, 1);
    gl.enableVertexAttribArray(LOC_ANIM_STRIDE);
    gl.vertexAttribIPointer(LOC_ANIM_STRIDE, 1, gl.INT, OVERLAY_INSTANCE_STRIDE, 40);
    gl.vertexAttribDivisor(LOC_ANIM_STRIDE, 1);
    gl.enableVertexAttribArray(LOC_TILE_XY);
    gl.vertexAttribPointer(LOC_TILE_XY, 2, gl.FLOAT, false, OVERLAY_INSTANCE_STRIDE, 44);
    gl.vertexAttribDivisor(LOC_TILE_XY, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.baseUniforms = {
      resolution: getUniformOrThrow(gl, this.baseProgram, 'u_resolution'),
      cameraPx: getUniformOrThrow(gl, this.baseProgram, 'u_cameraPx'),
      terrain: getUniformOrThrow(gl, this.baseProgram, 'u_terrain'),
      frame: getUniformOrThrow(gl, this.baseProgram, 'u_frame'),
      lightmap: getUniformOrThrow(gl, this.baseProgram, 'u_lightmap'),
      lightmapOrigin: getUniformOrThrow(gl, this.baseProgram, 'u_lightmapOrigin'),
      lightmapSize: getUniformOrThrow(gl, this.baseProgram, 'u_lightmapSize'),
    };
    this.overlayUniforms = {
      resolution: getUniformOrThrow(gl, this.overlayProgram, 'u_resolution'),
      cameraPx: getUniformOrThrow(gl, this.overlayProgram, 'u_cameraPx'),
      terrain: getUniformOrThrow(gl, this.overlayProgram, 'u_terrain'),
      masks: getUniformOrThrow(gl, this.overlayProgram, 'u_masks'),
      frame: getUniformOrThrow(gl, this.overlayProgram, 'u_frame'),
      lightmap: getUniformOrThrow(gl, this.overlayProgram, 'u_lightmap'),
      lightmapOrigin: getUniformOrThrow(gl, this.overlayProgram, 'u_lightmapOrigin'),
      lightmapSize: getUniformOrThrow(gl, this.overlayProgram, 'u_lightmapSize'),
    };
  }

  /**
   * Replace the full base + overlay instance data. Called by Scene whenever
   * any chunk's contribution changes (chunk arrival, tile delta, eviction).
   *
   * `baseData` must contain exactly `baseCount × BASE_INSTANCE_STRIDE` bytes
   * and `overlayData` exactly `overlayCount × OVERLAY_INSTANCE_STRIDE` bytes.
   */
  uploadInstances(
    baseData: ArrayBuffer,
    baseCount: number,
    overlayData: ArrayBuffer,
    overlayCount: number,
  ): void {
    const gl = this.gl;
    this.baseCount = baseCount;
    this.overlayCount = overlayCount;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.baseBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, baseData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, overlayData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  render(
    resolution: readonly [number, number],
    cameraPx: readonly [number, number],
    terrainTexture: WebGLTexture,
    maskTexture: WebGLTexture,
    time: number,
    lightmap: LightmapBinding,
  ): void {
    if (this.baseCount === 0) return;

    const gl = this.gl;
    const frame = (time / WATER_FRAME_MS) % WATER_ANIM_FRAMES;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, terrainTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, maskTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lightmap.texture);
    gl.activeTexture(gl.TEXTURE0);

    // --- Base pass --------------------------------------------------------
    gl.useProgram(this.baseProgram);
    gl.uniform2f(this.baseUniforms.resolution, resolution[0], resolution[1]);
    gl.uniform2f(this.baseUniforms.cameraPx, cameraPx[0], cameraPx[1]);
    gl.uniform1i(this.baseUniforms.terrain, 0);
    gl.uniform1f(this.baseUniforms.frame, frame);
    gl.uniform1i(this.baseUniforms.lightmap, 2);
    gl.uniform2f(this.baseUniforms.lightmapOrigin, lightmap.originX, lightmap.originY);
    gl.uniform2f(this.baseUniforms.lightmapSize, lightmap.size, lightmap.size);

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.baseVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.baseCount);

    // --- Overlay pass -----------------------------------------------------
    if (this.overlayCount > 0) {
      gl.useProgram(this.overlayProgram);
      gl.uniform2f(this.overlayUniforms.resolution, resolution[0], resolution[1]);
      gl.uniform2f(this.overlayUniforms.cameraPx, cameraPx[0], cameraPx[1]);
      gl.uniform1i(this.overlayUniforms.terrain, 0);
      gl.uniform1i(this.overlayUniforms.masks, 1);
      gl.uniform1f(this.overlayUniforms.frame, frame);
      gl.uniform1i(this.overlayUniforms.lightmap, 2);
      gl.uniform2f(this.overlayUniforms.lightmapOrigin, lightmap.originX, lightmap.originY);
      gl.uniform2f(this.overlayUniforms.lightmapSize, lightmap.size, lightmap.size);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.overlayVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.overlayCount);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
