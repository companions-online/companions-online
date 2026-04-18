/**
 * Entity-level metadata keys — small, rarely-changing, observer-visible
 * string values attached to entities (player name, titles, sign text,
 * ownership tags, etc.). Distinct from ECS components: meta is sparse,
 * variable-length, and read on render/UI/query paths rather than in the
 * tick-dense state.
 *
 * Syncs via ServerOpcode.EntityMeta; values are UTF-8 strings. An empty
 * string clears the key.
 */
export const enum MetaKey {
  Name = 0,
}

export function metaKeyLabel(key: MetaKey): string {
  switch (key) {
    case MetaKey.Name: return 'name';
    default: return `meta#${key as number}`;
  }
}
