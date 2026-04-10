import { linkProgram, createBuffer } from '../platform/gl-utils.js';
import { SPRITE_VS, SPRITE_FS } from './shaders.js';

/**
 * Unit quad corners in 0..1 space, two triangles (TL, TR, BL) + (BL, TR, BR).
 * The VS turns these into a destination rectangle + UV rect via uniforms.
 */
const UNIT_QUAD = new Float32Array([
  0, 0,
  1, 0,
  0, 1,
  0, 1,
  1, 0,
  1, 1,
]);

interface SpriteUniforms {
  resolution: WebGLUniformLocation;
  dstRect: WebGLUniformLocation;
  srcRect: WebGLUniformLocation;
  texture: WebGLUniformLocation;
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
 * Simple sprite renderer: one shared program + one shared VAO, issues a draw
 * call per `drawSprite` invocation. No batching — sufficient for a handful of
 * entities in this prototype.
 *
 * Call `begin(resolution)` once per frame to bind state, then `drawSprite`
 * per entity, then `end()` to unbind.
 */
export class SpriteRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms: SpriteUniforms;
  private resolution: readonly [number, number] = [0, 0];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    this.program = linkProgram(gl, SPRITE_VS, SPRITE_FS);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray returned null');
    this.vao = vao;

    gl.bindVertexArray(vao);
    createBuffer(gl, gl.ARRAY_BUFFER, UNIT_QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.uniforms = {
      resolution: getUniformOrThrow(gl, this.program, 'u_resolution'),
      dstRect: getUniformOrThrow(gl, this.program, 'u_dstRect'),
      srcRect: getUniformOrThrow(gl, this.program, 'u_srcRect'),
      texture: getUniformOrThrow(gl, this.program, 'u_texture'),
    };
  }

  /** Bind program, VAO, blending state, and resolution uniform for a frame. */
  begin(resolution: readonly [number, number]): void {
    const gl = this.gl;
    this.resolution = resolution;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.uniforms.resolution, resolution[0], resolution[1]);
    gl.uniform1i(this.uniforms.texture, 0);
  }

  /**
   * Draw a textured rectangle in screen-space pixels, sampling the given UV
   * rect from texture unit 0. Caller must have bound the desired texture
   * (usually once per frame or per sprite sheet).
   */
  drawSprite(
    dstX: number, dstY: number, dstW: number, dstH: number,
    srcU: number, srcV: number, srcDU: number, srcDV: number,
  ): void {
    const gl = this.gl;
    gl.uniform4f(this.uniforms.dstRect, dstX, dstY, dstW, dstH);
    gl.uniform4f(this.uniforms.srcRect, srcU, srcV, srcDU, srcDV);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  end(): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    // Cast to satisfy lint — we just hold onto the last-begin value.
    void this.resolution;
  }
}
