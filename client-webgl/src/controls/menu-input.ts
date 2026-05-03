// DOM event listeners that route mouse + keyboard events into the menu
// orchestrator. Symmetric with attachMouseControls / attachKeyboardControls;
// runs in parallel with them when overlay.kind === 'menu'. The world
// listeners already gate on isInputCaptured(scene.overlay) for mouse;
// keyboard.ts gains a parallel early-return for the menu kind.
//
// The menu listener is "always live" and gates internally on the overlay
// kind, so opening/closing the menu doesn't require attach/detach cycles.

import type { Scene } from '../scene.js';
import type { MenuController } from '../ui/menu.js';

export function attachMenuInput(
  canvas: HTMLCanvasElement,
  scene: Scene,
  menu: MenuController,
): void {
  function canvasCoords(ev: MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    return [x, y];
  }

  canvas.addEventListener('mousemove', (ev) => {
    if (scene.overlay.kind !== 'menu') return;
    const [x, y] = canvasCoords(ev);
    menu.onMouseMove(x, y);
  });

  canvas.addEventListener('mousedown', (ev) => {
    if (scene.overlay.kind !== 'menu') return;
    if (ev.button !== 0) return; // left button only — right is reserved
    const [x, y] = canvasCoords(ev);
    menu.onMouseDown(x, y);
  });

  canvas.addEventListener('mouseup', (ev) => {
    if (scene.overlay.kind !== 'menu') return;
    if (ev.button !== 0) return;
    const [x, y] = canvasCoords(ev);
    menu.onMouseUp(x, y);
  });

  canvas.addEventListener('keydown', (ev) => {
    if (scene.overlay.kind !== 'menu') return;
    const consumed = menu.onKey({ key: ev.key, preventDefault: () => ev.preventDefault() });
    if (consumed) ev.preventDefault();
  });
}
