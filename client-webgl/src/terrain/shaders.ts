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

uniform vec2  u_resolution;
uniform vec2  u_cameraPx;
uniform float u_frame;  // current water-anim frame as a float, 0..${WATER_ANIM_FRAMES}

out vec2 v_uv;
flat out int v_srcLayerA;
flat out int v_srcLayerB;
flat out float v_frameBlend;

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
  // terrain), static tiles have stride=0 so fA==fB and the FS mix collapses
  // to identity. We compute two adjacent layers and a blend factor; the FS
  // mixes them to upgrade the discrete frame carousel into continuous flow.
  int fA = int(floor(u_frame));
  int fB = (fA + 1) % ${WATER_ANIM_FRAMES};
  v_srcLayerA = a_srcLayer + fA * a_animStride;
  v_srcLayerB = a_srcLayer + fB * a_animStride;
  v_frameBlend = fract(u_frame);
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

uniform sampler2DArray u_terrain;

out vec4 outColor;

void main() {
  // Sample both adjacent frame layers and blend. For static tiles
  // (animStride=0) layerA == layerB so the mix is identity and the only cost
  // is one redundant texture fetch — accepted cost for terrain fillrate.
  vec4 a = texture(u_terrain, vec3(v_uv, float(v_srcLayerA)));
  vec4 b = texture(u_terrain, vec3(v_uv, float(v_srcLayerB)));
  vec4 c = mix(a, b, v_frameBlend);
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

uniform vec2  u_resolution;
uniform vec2  u_cameraPx;
uniform float u_frame;

out vec2 v_uv;
flat out int v_srcLayerA;
flat out int v_srcLayerB;
flat out float v_frameBlend;
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
  // See TILE_BASE_VS for the frame-blend pattern. Overlays that reference a
  // water/river neighbour pick the same pair of frame layers so shore tiles
  // flow in lockstep with the open-water interior. The mask layer is not
  // animated — only the terrain source sample blends.
  int fA = int(floor(u_frame));
  int fB = (fA + 1) % ${WATER_ANIM_FRAMES};
  v_srcLayerA = a_srcLayer + fA * a_animStride;
  v_srcLayerB = a_srcLayer + fB * a_animStride;
  v_frameBlend = fract(u_frame);
  v_maskLayer = a_maskLayer;
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

uniform sampler2DArray u_terrain;
uniform sampler2DArray u_masks;

out vec4 outColor;

void main() {
  vec4 a = texture(u_terrain, vec3(v_uv, float(v_srcLayerA)));
  vec4 b = texture(u_terrain, vec3(v_uv, float(v_srcLayerB)));
  vec4 src = mix(a, b, v_frameBlend);
  float maskA = texture(u_masks, vec3(v_uv, float(v_maskLayer))).a;

  // Combine source tile alpha (diamond clip) with mask strength.
  float alpha = src.a * maskA;
  if (alpha <= 0.0) discard;

  outColor = vec4(src.rgb, alpha);
}
`;
