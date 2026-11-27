// Grid search: A* pathfinding, breadth-first distances, line of sight and field of view.
// Pure JavaScript, no three.js, so it runs in the unit tests too.
//
// LESSON (game-ai skill): A* explores the grid outward from the start, always expanding
// the most promising cell first: the one with the lowest  f = g + h, where
//   g = steps taken so far, and
//   h = a guess of the steps still to go (the "heuristic").
// On a 4-way grid where every step costs 1, Manhattan distance |dx| + |dy| never
// overestimates, so A* returns a shortest path. tests/pathfinding.test.js checks that
// against plain breadth-first search on hundreds of random grids.

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A binary min-heap: push and pop the lowest-priority item in O(log n). */
export class MinHeap {
  constructor() {
    this.items = [];
    this.priorities = [];
  }
  get size() { return this.items.length; }
  push(item, priority) {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastPriority = this.priorities.pop();
    if (this.items.length) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.priorities[l] < this.priorities[m]) m = l;
        if (r < this.items.length && this.priorities[r] < this.priorities[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}

/**
 * A* on a 4-way grid. `passable(x, y)` says whether a cell can be entered.
 * The goal cell is always allowed, so a monster can path to the cell the player stands on.
 * Returns the cells to walk through (excluding the start, including the goal), or null.
 */
export function astar(width, height, passable, start, goal, { maxNodes = 5000 } = {}) {
  const idx = (x, y) => y * width + x;
  const startI = idx(start.x, start.y);
  const goalI = idx(goal.x, goal.y);
  if (startI === goalI) return [];

  const g = new Float32Array(width * height).fill(Infinity);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const open = new MinHeap();
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  g[startI] = 0;
  open.push(startI, h(start.x, start.y));
  let expanded = 0;

  while (open.size) {
    const current = open.pop();
    if (current === goalI) break;
    if (closed[current]) continue; // a stale duplicate entry in the heap
    closed[current] = 1;
    if (++expanded > maxNodes) return null; // give up on huge searches

    const cx = current % width;
    const cy = (current - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = idx(nx, ny);
      if (closed[n]) continue;
      if (n !== goalI && !passable(nx, ny)) continue;
      const cost = g[current] + 1;
      if (cost < g[n]) {
        g[n] = cost;
        cameFrom[n] = current;
        open.push(n, cost + h(nx, ny));
      }
    }
  }

  if (cameFrom[goalI] === -1) return null;
  const path = [];
  for (let i = goalI; i !== startI; i = cameFrom[i]) {
    path.push({ x: i % width, y: Math.floor(i / width) });
  }
  return path.reverse();
}

/** Steps from `start` to every reachable cell (-1 = unreachable). Breadth-first search. */
export function bfsDistances(width, height, passable, start) {
  const dist = new Int32Array(width * height).fill(-1);
  const queue = [start.y * width + start.x];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const cx = c % width, cy = (c - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (dist[n] !== -1 || !passable(nx, ny)) continue;
      dist[n] = dist[c] + 1;
      queue.push(n);
    }
  }
  return dist;
}

/**
 * Bresenham line from (x0,y0) to (x1,y1): true if no opaque cell lies strictly between.
 * The end cell may be opaque (you can see a wall, just not through it).
 */
export function lineOfSight(opaque, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    if (x === x1 && y === y1) return true;
    if (!(x === x0 && y === y0) && opaque(x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** Field of view: which cells within `radius` the viewer can see. Returns a Uint8Array. */
export function computeVisible(width, height, opaque, ox, oy, radius) {
  const visible = new Uint8Array(width * height);
  const r2 = radius * radius + radius; // slightly rounder circle
  for (let y = Math.max(0, oy - radius); y <= Math.min(height - 1, oy + radius); y++) {
    for (let x = Math.max(0, ox - radius); x <= Math.min(width - 1, ox + radius); x++) {
      const dx = x - ox, dy = y - oy;
      if (dx * dx + dy * dy > r2) continue;
      // Look along the line in BOTH directions; a cell counts as seen if either works.
      // That removes most of the one-sided artefacts of plain Bresenham.
      if (lineOfSight(opaque, ox, oy, x, y) || lineOfSight(opaque, x, y, ox, oy)) {
        visible[y * width + x] = 1;
      }
    }
  }
  return visible;
}
