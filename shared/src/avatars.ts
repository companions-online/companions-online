// Player-avatar registry. Maps the integer `BlueprintData.variant` (the
// wire format) to a stable name used by the menu, the /avatar server
// command, and the MCP `identify` tool. Variant 0 is the default
// (catgirl) so a player who never picks an avatar matches the
// server-side default applied at addPlayer time.

export interface Avatar {
  variant: number;
  name: string;
}

export const AVATARS: readonly Avatar[] = [
  { variant: 0, name: 'catgirl'  },
  { variant: 1, name: 'nomad'    },
  { variant: 2, name: 'knight'   },
  { variant: 3, name: 'tinkerer' },
  { variant: 4, name: 'beastkin' },
] as const;

export const AVATAR_NAMES: readonly string[] = AVATARS.map(a => a.name);

export function avatarVariantByName(name: string): number | null {
  const key = name.trim().toLowerCase();
  for (const a of AVATARS) {
    if (a.name === key) return a.variant;
  }
  return null;
}

export function avatarNameByVariant(variant: number): string | null {
  for (const a of AVATARS) {
    if (a.variant === variant) return a.name;
  }
  return null;
}
