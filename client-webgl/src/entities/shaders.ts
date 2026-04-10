// Sprite shader source strings used by the entities sprite renderer.
// GLSL 300 es (WebGL2).
//
// Conventions:
//   - u_resolution: viewport size in CSS pixels (vec2)
//   - Origin for all screen-space math is top-left, y-down.

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
