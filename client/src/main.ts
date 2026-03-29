const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Placeholder render loop
function frame() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#4a4';
  ctx.font = '16px monospace';
  ctx.fillText('Companions Online — client ready', 20, 30);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

import { TICK_RATE, MAP_SIZE } from '@shared/constants.js';
console.log(`Client initialized (${TICK_RATE}Hz, ${MAP_SIZE}x${MAP_SIZE} map)`);
