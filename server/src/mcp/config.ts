/**
 * MCP feature flags. Mutable so tests and ad-hoc tools can flip a flag
 * without touching the registration path; defaults match the production
 * shape exposed to LLM clients.
 */
export const mcpConfig = {
  /**
   * Prefix every map row with its Y coordinate (right-aligned to the longest
   * Y in the viewport) and emit a `y` header line above the grid. Helps the
   * LLM correlate map glyphs to coordinates without counting rows.
   */
  mapLinePrefix: false,
};
