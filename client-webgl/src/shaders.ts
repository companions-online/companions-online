// All shader source strings live here. GLSL 300 es (WebGL2).
//
// Conventions:
//   - u_resolution: viewport size in CSS pixels (vec2)
//   - u_cameraPx:   world→screen translation in CSS pixels (vec2)
//   - Origin for all screen-space math is top-left, y-down.
//   - Terrain tile textures are uploaded with UNPACK_FLIP_Y_WEBGL=true, so
//     UV (0.5, 0.0) = N corner (top of diamond).

/**
 * Shared tile vertex shader for the BASE terrain pass.
 *
 * Reads per-instance corner positions (4 floats of X, 4 floats of Y — one per
 * diamond vertex in N,E,S,W order) plus a per-vertex corner index selecting
 * which of the 4 to emit. UV is looked up from a constant table.
 */
export const TILE_BASE_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in int  a_cornerId;    // per-vertex: 0=N 1=E 2=S 3=W
layout(location = 1) in vec4 a_cornerX;     // per-instance
layout(location = 2) in vec4 a_cornerY;     // per-instance
layout(location = 3) in int  a_srcLayer;    // per-instance
layout(location = 5) in int  a_animStride;  // per-instance; 0 = static, N = frame stride

uniform vec2 u_resolution;
uniform vec2 u_cameraPx;
uniform int  u_frame;  // current water-anim frame, 0..WATER_ANIM_FRAMES-1

out vec2 v_uv;
flat out int v_srcLayer;

const vec2 CORNER_UV[4] = vec2[4](
  vec2(0.5, 0.0),  // N  — top    of tile image
  vec2(1.0, 0.5),  // E  — right  of tile image
  vec2(0.5, 1.0),  // S  — bottom of tile image
  vec2(0.0, 0.5)   // W  — left   of tile image
);

void main() {
  float px = a_cornerX[a_cornerId] + u_cameraPx.x;
  float py = a_cornerY[a_cornerId] + u_cameraPx.y;

  // px,py are top-left-origin screen pixels; convert to clip space.
  float cx = (px / u_resolution.x) * 2.0 - 1.0;
  float cy = 1.0 - (py / u_resolution.y) * 2.0;
  gl_Position = vec4(cx, cy, 0.0, 1.0);

  v_uv = CORNER_UV[a_cornerId];
  // Frame advance: animated tiles have stride>0 (the variant count of their
  // terrain), static tiles have stride=0 and fall through untouched.
  v_srcLayer = a_srcLayer + u_frame * a_animStride;
}
`;

/** Base fragment shader — one texture sample, discard outside diamond. */
export const TILE_BASE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
flat in int v_srcLayer;

uniform sampler2DArray u_terrain;

out vec4 outColor;

void main() {
  vec4 c = texture(u_terrain, vec3(v_uv, float(v_srcLayer)));
  if (c.a < 0.5) discard;
  outColor = c;
}
`;

/** Overlay vertex shader — same as base + one extra per-instance mask layer. */
export const TILE_OVERLAY_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in int  a_cornerId;
layout(location = 1) in vec4 a_cornerX;
layout(location = 2) in vec4 a_cornerY;
layout(location = 3) in int  a_srcLayer;
layout(location = 4) in int  a_maskLayer;
layout(location = 5) in int  a_animStride;

uniform vec2 u_resolution;
uniform vec2 u_cameraPx;
uniform int  u_frame;

out vec2 v_uv;
flat out int v_srcLayer;
flat out int v_maskLayer;

const vec2 CORNER_UV[4] = vec2[4](
  vec2(0.5, 0.0),
  vec2(1.0, 0.5),
  vec2(0.5, 1.0),
  vec2(0.0, 0.5)
);

void main() {
  float px = a_cornerX[a_cornerId] + u_cameraPx.x;
  float py = a_cornerY[a_cornerId] + u_cameraPx.y;
  float cx = (px / u_resolution.x) * 2.0 - 1.0;
  float cy = 1.0 - (py / u_resolution.y) * 2.0;
  gl_Position = vec4(cx, cy, 0.0, 1.0);

  v_uv = CORNER_UV[a_cornerId];
  // See TILE_BASE_VS for the stride animation pattern. Overlays that
  // reference a water/river neighbour also need frame offsetting so shore
  // tiles flow in sync with the open-water interior.
  v_srcLayer = a_srcLayer + u_frame * a_animStride;
  v_maskLayer = a_maskLayer;
}
`;

/**
 * Overlay fragment shader — sample neighbor terrain × blend mask.
 *
 * The mask texture's RGB is meaningless (we wrote 255,255,255 always), only
 * its alpha channel encodes the blend strength. Output is the neighbor's RGB
 * modulated by the mask alpha, composited with SRC_ALPHA,ONE_MINUS_SRC_ALPHA.
 */
export const TILE_OVERLAY_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
flat in int v_srcLayer;
flat in int v_maskLayer;

uniform sampler2DArray u_terrain;
uniform sampler2DArray u_masks;

out vec4 outColor;

void main() {
  vec4 src = texture(u_terrain, vec3(v_uv, float(v_srcLayer)));
  float maskA = texture(u_masks, vec3(v_uv, float(v_maskLayer))).a;

  // Combine source tile alpha (diamond clip) with mask strength.
  float a = src.a * maskA;
  if (a <= 0.0) discard;

  outColor = vec4(src.rgb, a);
}
`;

/**
 * Sprite vertex shader — draws one textured quad in screen space. Per-draw
 * uniforms describe the destination rectangle (pixels) and source UV rect on
 * the sprite sheet.
 */
export const SPRITE_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_unit;  // 0..1 quad corner

uniform vec2 u_resolution;
uniform vec4 u_dstRect;  // x, y, w, h  (screen px, top-left origin)
uniform vec4 u_srcRect;  // u, v, du, dv (texture UV space)

out vec2 v_uv;

void main() {
  float px = u_dstRect.x + a_unit.x * u_dstRect.z;
  float py = u_dstRect.y + a_unit.y * u_dstRect.w;
  float cx = (px / u_resolution.x) * 2.0 - 1.0;
  float cy = 1.0 - (py / u_resolution.y) * 2.0;
  gl_Position = vec4(cx, cy, 0.0, 1.0);

  v_uv = u_srcRect.xy + a_unit * u_srcRect.zw;
}
`;

/** Sprite fragment shader — straight textured sample with alpha cutoff. */
export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_texture;
out vec4 outColor;

void main() {
  vec4 c = texture(u_texture, v_uv);
  if (c.a < 0.01) discard;
  outColor = c;
}
`;
