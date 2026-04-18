---
name: Use existing systems
description: client-webgl — prefer existing infrastructure (sprite registry, manifest) over parallel loaders
type: feedback
---

In `client-webgl/`: use the existing sprite manifest and registry system for new sprite types rather than loading textures directly. Merge multiple related images into a single spritesheet and use frame indexing.

**Why:** Keeps loading paths unified and avoids proliferating one-off loaders. The existing system works — use it.

**How to apply:** When adding new visual assets, combine them into a spritesheet that fits the manifest/registry pattern (`frameW`/`frameH` slicing, variant support). Don't create custom texture loading code when the registry can handle it.
