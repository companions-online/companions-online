---
name: No inline `import(...)` types
description: Always use top-of-file imports; never write inline `import('path').Type` in type positions
type: feedback
---

Never use inline `import(...)` syntax in type positions, e.g. `x: import('./foo.js').Bar` or `Parameters<...>[2]` chains that hide types. Always import the actual symbol at the top of the file:

```ts
import type { Bar } from './foo.js';
function f(x: Bar) { ... }
```

Applies to function parameters, return types, generic args, interface fields — anywhere a type annotation appears.

**Why:** inline imports hide dependencies (don't show up in the import list, make refactors and grep harder), repeat the path string at every use site, and force readers to mentally parse a side-channel module reference.

**How to apply:** if you'd write `import('x').Y` anywhere, instead add `import type { Y } from 'x';` at the top of the file and reference `Y` directly. This is true for first-party paths (`./foo.js`, `../bar.js`) and third-party (`'ws'`). No exceptions.
