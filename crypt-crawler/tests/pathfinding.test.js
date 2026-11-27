// A* must find SHORTEST paths: compare its length with breadth-first search (game-ai skill).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { astar, bfsDistances, MinHeap, lineOfSight } from '../src/pathfinding.js';
import { mulberry32 } from '../src/rng.js';

test('MinHeap pops in priority order', () => {
  const h = new MinHeap();
  const rnd = mulberry32(3);
  const values = Array.from({ length: 200 }, () => Math.floor(rnd() * 1000));
  for (const v of values) h.push(v, v);
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepEqual(out, [...values].sort((a, b) => a - b));
});

test('A* path length equals BFS distance on 300 random grids', () => {
  const rnd = mulberry32(42);
  for (let n = 0; n < 300; n++) {
    const W = 20, H = 15;
    const open = Array.from({ length: W * H }, () => rnd() > 0.3);
    const passable = (x, y) => open[y * W + x];
    const start = { x: Math.floor(rnd() * W), y: Math.floor(rnd() * H) };
    const goal = { x: Math.floor(rnd() * W), y: Math.floor(rnd() * H) };
    open[start.y * W + start.x] = true;
    open[goal.y * W + goal.x] = true;
    const dist = bfsDistances(W, H, passable, start)[goal.y * W + goal.x];
    const path = astar(W, H, passable, start, goal);
    if (dist < 0) assert.equal(path, null);
    else {
      assert.equal(path.length, dist, `grid ${n}`);
      // every step is one orthogonal move onto an open cell
      let prev = start;
      for (const c of path) {
        assert.equal(Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y), 1);
        assert.ok(passable(c.x, c.y));
        prev = c;
      }
    }
  }
});

test('line of sight is blocked by a wall in between', () => {
  const wallAt = (x, y) => x === 2 && y === 0;
  assert.equal(lineOfSight(wallAt, 0, 0, 4, 0), false);
  assert.equal(lineOfSight(wallAt, 0, 0, 2, 0), true); // you can see the wall itself
  assert.equal(lineOfSight(wallAt, 0, 1, 4, 1), true);
});
