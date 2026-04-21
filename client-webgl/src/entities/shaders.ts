// Sprite shader source strings used by the entities sprite renderer.
// GLSL 300 es (WebGL2).
//
// Conventions:
//   - u_resolution: viewport size in CSS pixels (vec2)
//   - Origin for all screen-space math is top-left, y-down.
//   - Lightmap sampling: the FS reads `u_lightmap` at the sprite's tile
//     position (passed per-draw as `u_spriteTileXY`) and multiplies the
//     sampled RGB. Effects (damage numbers, chat bubbles) flip `u_lit = 0`
//     to skip the multiply so they stay full-brightness.

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

/** Sprite fragment shader — textured sample, alpha cutoff, lightmap multiply,
 *  optional RGB tint. `u_tint` is `(r, g, b, mix)` where `mix` is the blend
 *  weight between the sampled RGB and `u_tint.rgb` (0 = no tint, 1 = full
 *  solid color). Tint applies AFTER the lightmap multiply so a bright red
 *  highlight stays red even in low ambient light. */
export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_alpha;
uniform sampler2D u_lightmap;
uniform vec2 u_lightmapOrigin;  // world-tile coords of lightmap texel (0,0)
uniform vec2 u_lightmapSize;    // lightmap dimensions in tiles
uniform vec2 u_spriteTileXY;    // world-tile position of this sprite's foot
uniform int  u_lit;             // 1 = apply lightmap, 0 = pass-through (UI/effects)
uniform vec4 u_tint;            // rgb = tint color, a = mix weight (0 = off)
out vec4 outColor;

void main() {
  vec4 c = texture(u_texture, v_uv);
  if (c.a < 0.01) discard;
  vec3 rgb = c.rgb;
  if (u_lit == 1) {
    vec2 luv = (u_spriteTileXY - u_lightmapOrigin + 0.5) / u_lightmapSize;
    vec3 light = texture(u_lightmap, luv).rgb;
    rgb *= light;
  }
  if (u_tint.a > 0.0) {
    rgb = mix(rgb, u_tint.rgb, u_tint.a);
  }
  outColor = vec4(rgb, c.a * u_alpha);
}
`;
