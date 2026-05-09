# Asset Import Scripts

Two ingest scripts coexist for character sprite sheets, one per Pixellab export format. Both write to the same on-disk layout: 7 cols × 8 rows × 92px PNG at `client-webgl/assets/creatures/<name>.png` (col 0 = standing, cols 1–6 = walk; rows in game-Direction order N, NE, E, SE, S, SW, W, NW).

## `scripts/import-character.ts` — current (Pixellab v2)

For exports that come as a directory tree:

```
assets/<variant>/
  metadata.json                                      # size, directions, frames map
  rotations/<dir>.png                                # 8 standing PNGs, one per direction
  animations/<animName>/<dir>/frame_NNN.png          # walk frames per direction
```

Run: `tsx scripts/import-character.ts <variant-dir> <output-name> [animation-name]`

- Frame size and direction set come from `metadata.json` — no hardcoded dims.
- Picks the first animation in `frames.animations` if `animation-name` is omitted (Pixellab names them e.g. `Walking-674ab877`).
- Walk-frame count is whatever the animation provides; output sheet width adapts.
- Missing direction in an animation → repeats the standing frame for that row + warns. No mirror fallback (the v2 export is expected to be complete).

## `scripts/import-sprite.ts` — legacy (Pixellab v1, GIF-based)

For the older flat dump in `assets/import/` of `<prefix>_rotations_8dir.gif` + per-direction walk GIFs. Hardcoded 92×92, 6 walk frames, with a `CREATURES` map of known prefixes. Has E↔W / SE↔SW / NE↔NW mirror fallback for missing walks. Still used by the existing non-player creatures (deer, fox, rabbit, skeleton, wolf) — don't delete until those are re-exported.

## Adding a new player variant

1. Drop the v2 export into `assets/<name>/`.
2. Add a row to `AVATARS` in `shared/src/avatars.ts` (the variant integer is the wire format).
3. Bump `variantCount` on the `Player` blueprint in `shared/src/blueprints.ts` — the sprite registry derives the load count from there, no manifest change needed.
4. `tsx scripts/import-character.ts <name> player-<N>.png`.
5. Update the lineup comment in `client-webgl/src/entities/sprite-manifest.ts` near the NPC alias block (it lists which variant each NPC reuses).

## Items (one-off PNGs)

Pixellab item exports are single PNGs at native resolution (often 64×64). Existing item sheets are 32×32 with `detectFoot: true, align: 'south', layout: 'static'` in the manifest. To ingest:

1. Resize to 32×32 with nearest-neighbor (preserves pixel-art edges) and write to `client-webgl/assets/items/<category>/<name>.png`.
2. Add a manifest row mirroring an existing weapon/tool entry.
3. The blueprint's `sprite:` field already names the file stem.
