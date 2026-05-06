// iPadOS Safari 16.0–16.3 lacks `OffscreenCanvas` (Apple shipped it in 16.4).
// Aliases to a detached `<canvas>` element — same API surface for the
// way we use it: `new OffscreenCanvas(w, h)` then `getContext('2d')` for
// drawing, or pass straight into `texImage2D` as a source. We don't use
// `transferToImageBitmap` / `convertToBlob` / worker transfer anywhere
// in the bundle (verified by grep), so the shim has zero functional
// gap. No-op on browsers with native support.
declare global {
  // eslint-disable-next-line no-var
  var OffscreenCanvas: typeof globalThis.OffscreenCanvas;
}

if (typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas === 'undefined') {
  (globalThis as { OffscreenCanvas: unknown }).OffscreenCanvas = function (w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  } as unknown;
}

export {};
