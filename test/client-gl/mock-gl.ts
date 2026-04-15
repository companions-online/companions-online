// Proxy-based stub for WebGL2RenderingContext. Every method is a no-op that
// returns a fresh integer (so createBuffer/createTexture/createProgram etc.
// return distinct "handles"), every property read returns a unique number
// (so gl.TEXTURE_2D, gl.FLOAT, etc. are stable constants for the duration
// of a test). Uniform locations return a non-null object so
// `gl.getUniformLocation` doesn't trip the "uniform not found" throws.
//
// This is deliberately type-wide and behavior-narrow — it won't catch bugs
// in shader code or GL state machinery, only in the JS-side logic that
// surrounds them. Rendering correctness tests belong in puppeteer.

let handleCounter = 1;

function makeHandle(): number {
  return handleCounter++;
}

export function createMockGL(): WebGL2RenderingContext {
  const constants = new Map<string, number>();

  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      const key = String(prop);

      // Return a stable numeric constant for uppercase properties (GL enums)
      if (/^[A-Z_0-9]+$/.test(key)) {
        let v = constants.get(key);
        if (v === undefined) {
          v = handleCounter++;
          constants.set(key, v);
        }
        return v;
      }

      // All method calls are no-op functions returning fresh handles /
      // plausible values. `getUniformLocation` returning a number is fine
      // here since tests don't dereference the returned WebGLUniformLocation.
      return () => makeHandle();
    },
  };

  return new Proxy({}, handler) as unknown as WebGL2RenderingContext;
}
