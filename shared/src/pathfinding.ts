export interface PathResult {
  path: { x: number; y: number }[];
  found: boolean;
}

// 8 directions: N, NE, E, SE, S, SW, W, NW
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

// Octile distance heuristic (approximates alternating diagonal cost)
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const diag = Math.min(dx, dy);
  const straight = dx + dy - 2 * diag;
  return straight + diag * 1.4;
}

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parentKey: number;
}

const NO_PARENT = -1;

export function findPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  isBlocked: (x: number, y: number) => boolean,
  mapWidth: number,
  mapHeight: number,
  maxSearchNodes = 1000,
): PathResult {
  if (startX === endX && startY === endY) {
    return { path: [], found: true };
  }

  const key = (x: number, y: number) => y * mapWidth + x;
  const startKey = key(startX, startY);
  const endKey = key(endX, endY);

  // If destination is blocked, find path to nearest adjacent tile
  let goalX = endX;
  let goalY = endY;
  let goalKey = endKey;
  if (isBlocked(endX, endY)) {
    // Try to path to an adjacent walkable tile
    let bestDist = Infinity;
    let found = false;
    for (let d = 0; d < 8; d++) {
      const ax = endX + DX[d];
      const ay = endY + DY[d];
      if (ax < 0 || ax >= mapWidth || ay < 0 || ay >= mapHeight) continue;
      if (isBlocked(ax, ay)) continue;
      const dist = heuristic(startX, startY, ax, ay);
      if (dist < bestDist) {
        bestDist = dist;
        goalX = ax;
        goalY = ay;
        goalKey = key(ax, ay);
        found = true;
      }
    }
    if (!found) return { path: [], found: false };
    if (goalX === startX && goalY === startY) return { path: [], found: true };
  }

  const gScore = new Map<number, number>();
  const nodes = new Map<number, Node>();
  const closed = new Set<number>();

  // Simple binary heap by f-score
  const open: number[] = [];
  const fScores = new Map<number, number>();

  function pushOpen(k: number, f: number) {
    fScores.set(k, f);
    open.push(k);
    // Bubble up
    let i = open.length - 1;
    while (i > 0) {
      const pi = (i - 1) >> 1;
      if (fScores.get(open[pi])! <= fScores.get(open[i])!) break;
      [open[pi], open[i]] = [open[i], open[pi]];
      i = pi;
    }
  }

  function popOpen(): number {
    const top = open[0];
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < open.length && fScores.get(open[l])! < fScores.get(open[smallest])!) smallest = l;
        if (r < open.length && fScores.get(open[r])! < fScores.get(open[smallest])!) smallest = r;
        if (smallest === i) break;
        [open[smallest], open[i]] = [open[i], open[smallest]];
        i = smallest;
      }
    }
    return top;
  }

  const startNode: Node = {
    x: startX, y: startY, g: 0,
    f: heuristic(startX, startY, goalX, goalY),
    parentKey: NO_PARENT,
  };
  gScore.set(startKey, 0);
  nodes.set(startKey, startNode);
  pushOpen(startKey, startNode.f);

  let searched = 0;

  while (open.length > 0 && searched < maxSearchNodes) {
    const currentKey = popOpen();
    if (currentKey === goalKey) {
      // Reconstruct path
      return { path: reconstructPath(nodes, goalKey, mapWidth), found: true };
    }

    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    searched++;

    const current = nodes.get(currentKey)!;

    for (let d = 0; d < 8; d++) {
      const nx = current.x + DX[d];
      const ny = current.y + DY[d];
      if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) continue;

      const nKey = key(nx, ny);
      if (closed.has(nKey)) continue;
      if (nKey !== goalKey && isBlocked(nx, ny)) continue;

      const isDiag = (d & 1) === 1;

      // Diagonal: check that both cardinal neighbors are passable (no corner cutting)
      if (isDiag) {
        const cx1 = current.x + DX[d];
        const cy1 = current.y;
        const cx2 = current.x;
        const cy2 = current.y + DY[d];
        if (isBlocked(cx1, cy1) || isBlocked(cx2, cy2)) continue;
      }

      const stepCost = isDiag ? 1.4 : 1;

      const tentativeG = current.g + stepCost;
      const prevG = gScore.get(nKey);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      const f = tentativeG + heuristic(nx, ny, goalX, goalY);

      gScore.set(nKey, tentativeG);
      nodes.set(nKey, {
        x: nx, y: ny, g: tentativeG, f,
        parentKey: currentKey,
      });
      pushOpen(nKey, f);
    }
  }

  return { path: [], found: false };
}

function reconstructPath(
  nodes: Map<number, Node>,
  goalKey: number,
  mapWidth: number,
): { x: number; y: number }[] {
  const path: { x: number; y: number }[] = [];
  let k = goalKey;
  while (k !== NO_PARENT) {
    const node = nodes.get(k)!;
    if (node.parentKey !== NO_PARENT) { // skip start
      path.push({ x: node.x, y: node.y });
    }
    k = node.parentKey;
  }
  path.reverse();
  return path;
}
