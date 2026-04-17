import { createCanvasTexture } from '../platform/gl-utils.js';

export interface TextSurface {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export interface TextSurfaceOpts {
  text: string;
  fillColor: string;
  outlineColor?: string;
  fontPx: number;
  bold?: boolean;
  /** Draw a filled star polygon behind the text. fillColor for the star is
   *  taken from `backgroundColor`; the text uses `fillColor`. */
  background?: 'star';
  backgroundColor?: string;
}

export interface TextSurfaceFactory {
  create(opts: TextSurfaceOpts): TextSurface;
  release(surface: TextSurface): void;
}

// ---------------------------------------------------------------------------
// Cache key from opts
// ---------------------------------------------------------------------------

function cacheKey(opts: TextSurfaceOpts): string {
  return `${opts.text}|${opts.fillColor}|${opts.outlineColor ?? ''}|${opts.fontPx}|${opts.bold ? 1 : 0}|${opts.background ?? ''}|${opts.backgroundColor ?? ''}`;
}

// ---------------------------------------------------------------------------
// Production implementation — OffscreenCanvas + ctx.fillText
// ---------------------------------------------------------------------------

interface CacheEntry {
  surface: TextSurface;
  refcount: number;
}

export function createTextSurfaceFactory(gl: WebGL2RenderingContext): TextSurfaceFactory {
  const cache = new Map<string, CacheEntry>();

  return {
    create(opts) {
      const key = cacheKey(opts);
      const existing = cache.get(key);
      if (existing) {
        existing.refcount++;
        return existing.surface;
      }

      const surface = renderTextSurface(gl, opts);
      cache.set(key, { surface, refcount: 1 });
      return surface;
    },

    release(surface) {
      for (const [key, entry] of cache) {
        if (entry.surface === surface) {
          entry.refcount--;
          if (entry.refcount <= 0) {
            gl.deleteTexture(surface.texture);
            cache.delete(key);
          }
          return;
        }
      }
    },
  };
}

function renderTextSurface(gl: WebGL2RenderingContext, opts: TextSurfaceOpts): TextSurface {
  if (opts.background === 'star') return renderStarSurface(gl, opts);

  const { text, fillColor, outlineColor, fontPx, bold } = opts;
  const font = `${bold ? 'bold ' : ''}${fontPx}px sans-serif`;

  // Measure with a temporary canvas context.
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  measure.font = font;
  const metrics = measure.measureText(text);
  const pad = outlineColor ? 3 : 1;
  const w = Math.ceil(metrics.width) + pad * 2;
  const h = fontPx + pad * 2;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textBaseline = 'top';

  if (outlineColor) {
    ctx.fillStyle = outlineColor;
    // 8-offset pseudo-outline.
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        ctx.fillText(text, pad + dx, pad + dy);
      }
    }
  }

  ctx.fillStyle = fillColor;
  ctx.fillText(text, pad, pad);

  const texture = createCanvasTexture(gl, canvas);
  return { texture, width: w, height: h };
}

// ---------------------------------------------------------------------------
// Star-burst background: filled 12-point star polygon with centered text
// ---------------------------------------------------------------------------

const STAR_POINTS = 12;
const STAR_INNER_RATIO = 0.55;

function renderStarSurface(gl: WebGL2RenderingContext, opts: TextSurfaceOpts): TextSurface {
  const { text, fillColor, fontPx, bold, backgroundColor } = opts;
  const font = `${bold ? 'bold ' : ''}${fontPx}px sans-serif`;

  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  measure.font = font;
  const textW = Math.ceil(measure.measureText(text).width);

  // Star radius sized to comfortably enclose the text.
  const outerR = Math.max(textW, fontPx) / 2 + fontPx * 0.6;
  const innerR = outerR * STAR_INNER_RATIO;
  const size = Math.ceil(outerR * 2) + 2; // +2 for antialiasing margin
  const cx = size / 2;
  const cy = size / 2;

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;

  // Draw star polygon.
  ctx.beginPath();
  for (let i = 0; i < STAR_POINTS * 2; i++) {
    const angle = (i * Math.PI) / STAR_POINTS - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = backgroundColor ?? '#c00';
  ctx.fill();

  // Dark outline on the star for contrast.
  ctx.strokeStyle = '#600';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Center text on top of star.
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Text outline for legibility.
  ctx.fillStyle = '#000';
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue;
      ctx.fillText(text, cx + dx, cy + dy);
    }
  }
  ctx.fillStyle = fillColor;
  ctx.fillText(text, cx, cy);

  const texture = createCanvasTexture(gl, canvas);
  return { texture, width: size, height: size };
}
