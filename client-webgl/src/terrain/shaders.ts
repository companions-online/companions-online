// Terrain shader source strings. GLSL 300 es (WebGL2).
//
// Conventions:
//   - u_resolution: viewport size in CSS pixels (vec2)
//   - u_cameraPx:   world→screen translation in CSS pixels (vec2)
//   - Origin for all screen-space math is top-left, y-down.
//   - Terrain tile textures are uploaded with UNPACK_FLIP_Y_WEBGL=true, so
//     UV (0.5, 0.0) = N corner (top of diamond).
//   - u_frame is a FLOAT — the fractional part drives temporal blending
//     between two adjacent animation-frame layers so 8 discrete baked frames
//     read as continuous flow at the refresh rate.
//   - Lighting: each instance carries its world-tile coords (a_tileXY). The FS
//     samples `u_lightmap` at that tile (offset into the per-player window
//     origin) and multiplies final RGB.

import { WATER_ANIM_FRAMES } from '../platform/config.js';

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
layout(location = 6) in vec2 a_tileXY;      // per-instance world-tile coords

uniform vec2  u_resolution;
uniform vec2  u_cameraPx;
uniform float u_frame;  // current water-anim frame as a float, 0..${WATER_ANIM_FRAMES}

out vec2 v_uv;
flat out int v_srcLayerA;
flat out int v_srcLayerB;
flat out float v_frameBlend;
out vec2 v_tileXY;

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
  int fA = int(floor(u_frame));
  int fB = (fA + 1) % ${WATER_ANIM_FRAMES};
  v_srcLayerA = a_srcLayer + fA * a_animStride;
  v_srcLayerB = a_srcLayer + fB * a_animStride;
  v_frameBlend = fract(u_frame);
  v_tileXY = a_tileXY;
}
`;

/** Base fragment shader — two texture samples mixed by frame blend, discard outside diamond. */
export const TILE_BASE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
flat in int v_srcLayerA;
flat in int v_srcLayerB;
flat in float v_frameBlend;
in vec2 v_tileXY;

uniform sampler2DArray u_terrain;
uniform sampler2D u_lightmap;
uniform vec2 u_lightmapOrigin;
uniform vec2 u_lightmapSize;

out vec4 outColor;

void main() {
  vec4 a = texture(u_terrain, vec3(v_uv, float(v_srcLayerA)));
  vec4 b = texture(u_terrain, vec3(v_uv, float(v_srcLayerB)));
  vec4 c = mix(a, b, v_frameBlend);
  if (c.a < 0.5) discard;
  vec2 luv = (v_tileXY - u_lightmapOrigin + 0.5) / u_lightmapSize;
  vec3 light = texture(u_lightmap, luv).rgb;
  outColor = vec4(c.rgb * light, c.a);
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
layout(location = 6) in vec2 a_tileXY;

uniform vec2  u_resolution;
uniform vec2  u_cameraPx;
uniform float u_frame;

out vec2 v_uv;
flat out int v_srcLayerA;
flat out int v_srcLayerB;
flat out float v_frameBlend;
flat out int v_maskLayer;
out vec2 v_tileXY;

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
  int fA = int(floor(u_frame));
  int fB = (fA + 1) % ${WATER_ANIM_FRAMES};
  v_srcLayerA = a_srcLayer + fA * a_animStride;
  v_srcLayerB = a_srcLayer + fB * a_animStride;
  v_frameBlend = fract(u_frame);
  v_maskLayer = a_maskLayer;
  v_tileXY = a_tileXY;
}
`;

/**
 * Overlay fragment shader — sample neighbor terrain × blend mask.
 *
 * The mask texture's RGB is meaningless (we wrote 255,255,255 always), only
 * its alpha channel encodes the blend strength. Output is the neighbor's RGB
 * modulated by the mask alpha, composited with SRC_ALPHA,ONE_MINUS_SRC_ALPHA.
 *
 * The source terrain sample is frame-blended like the base pass. The mask
 * itself is static — we only sample one mask layer.
 */
export const TILE_OVERLAY_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
flat in int v_srcLayerA;
flat in int v_srcLayerB;
flat in float v_frameBlend;
flat in int v_maskLayer;
in vec2 v_tileXY;

uniform sampler2DArray u_terrain;
uniform sampler2DArray u_masks;
uniform sampler2D u_lightmap;
uniform vec2 u_lightmapOrigin;
uniform vec2 u_lightmapSize;

out vec4 outColor;

void main() {
  vec4 a = texture(u_terrain, vec3(v_uv, float(v_srcLayerA)));
  vec4 b = texture(u_terrain, vec3(v_uv, float(v_srcLayerB)));
  vec4 src = mix(a, b, v_frameBlend);
  float maskA = texture(u_masks, vec3(v_uv, float(v_maskLayer))).a;

  float alpha = src.a * maskA;
  if (alpha <= 0.0) discard;

  vec2 luv = (v_tileXY - u_lightmapOrigin + 0.5) / u_lightmapSize;
  vec3 light = texture(u_lightmap, luv).rgb;
  outColor = vec4(src.rgb * light, alpha);
}
`;
