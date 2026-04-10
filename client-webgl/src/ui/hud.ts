// HUD chrome (top bar, bottom bar, right sidebar). Currently a no-op
// placeholder — the HUD regions are visible as black space because the
// renderer scissors the game pass to GAME_X/Y/W/H. Real UI (inventory, action
// bar, minimap) lives here when added.

export function drawHud(_gl: WebGL2RenderingContext): void {
  // Nothing yet.
}
