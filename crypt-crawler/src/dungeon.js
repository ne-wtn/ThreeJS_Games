// Procedural dungeon generation: rooms and corridors, then content, then VALIDATION.
// Pure data (no three.js): it produces a grid of numbers plus lists of things to place.
// world3d.js turns that into meshes. tests/dungeon.test.js checks hundreds of seeds.
//
// LESSONS (procedural-gen + roguelike skills):
//  1. One seeded RNG per floor: same seed + depth, same floor, every time.
//  2. Generate into plain data, separate from rendering, so it can be tested.
//  3. Validate every result: is every floor cell reachable? Is the exit reachable?
//     Is the start safe? If not, reject and try again with a derived seed.
//  4. Cap every "keep trying until it fits" loop, or a small map can spin forever.
import { Rng, hashSeeds } from './rng.js';
import { bfsDistances } from './pathfinding.js';
import { MONSTER_TABLE } from './monsters.js';

export const WALL = 0;
export const FLOOR = 1;
const SAFE_START = 7; // no monster within this many steps of the start

export function generateFloor(runSeed, depth, { width = 44, height = 32 } = {}) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const rng = new Rng(hashSeeds(runSeed, depth, attempt));
    const floor = tryGenerate(rng, width, height, depth);
    const problems = validateFloor(floor);
    if (problems.length === 0) return { ...floor, seed: runSeed, depth, attempt };
  }
  throw new Error(`could not generate seed ${runSeed} depth ${depth}`);
}

function tryGenerate(rng, W, H, depth) {
  const grid = new Uint8Array(W * H);   // everything starts as solid rock (WALL)
  const blocked = new Uint8Array(W * H); // floor cells with a solid prop on them
  const idx = (x, y) => y * W + x;

  // --- 1. Rooms: random rectangles that do not overlap (with a 1-cell margin).
  const rooms = [];
  for (let tries = 0; tries < 400 && rooms.length < 11; tries++) {
    const w = rng.int(4, 9), h = rng.int(4, 7);
    const x = rng.int(1, W - w - 1), y = rng.int(1, H - h - 1);
    const overlaps = rooms.some((r) => x <= r.x + r.w && x + w >= r.x && y <= r.y + r.h && y + h >= r.y);
    if (overlaps) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[idx(xx, yy)] = FLOOR;
  }

  // --- 2. Corridors: join each room to the nearest room already joined (a spanning
  //        tree, so everything connects), plus a couple of extra links for loops.
  const carve = (x, y) => { grid[idx(x, y)] = FLOOR; };
  const corridor = (a, b) => {
    const horizontalFirst = rng.chance(0.5);
    let x = a.cx, y = a.cy;
    const stepX = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); carve(x, y); } };
    const stepY = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); carve(x, y); } };
    if (horizontalFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  };
  for (let i = 1; i < rooms.length; i++) {
    let best = rooms[0], bestD = Infinity;
    for (let j = 0; j < i; j++) {
      const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
      if (d < bestD) { bestD = d; best = rooms[j]; }
    }
    corridor(rooms[i], best);
  }
  for (let k = 0; k < 2 && rooms.length > 3; k++) corridor(rng.pick(rooms), rng.pick(rooms));

  // --- 3. Start in the first room; stairs in the room farthest away by walking distance.
  const start = { x: rooms[0].cx, y: rooms[0].cy };
  const walk = (x, y) => grid[idx(x, y)] === FLOOR && !blocked[idx(x, y)];
  const fromStart = bfsDistances(W, H, walk, start);
  let stairsRoom = rooms[rooms.length - 1];
  for (const r of rooms) if (fromStart[idx(r.cx, r.cy)] > fromStart[idx(stairsRoom.cx, stairsRoom.cy)]) stairsRoom = r;
  const stairs = { x: stairsRoom.cx, y: stairsRoom.cy };

  const taken = new Set([idx(start.x, start.y), idx(stairs.x, stairs.y)]);
  const free = (x, y) => walk(x, y) && !taken.has(idx(x, y));
  const randomRoomCell = (room) => ({ x: rng.int(room.x, room.x + room.w - 1), y: rng.int(room.y, room.y + room.h - 1) });

  // --- 4. Solid props (barrels, crates, pots, braziers) against room walls. Each one is
  //        only kept if every floor cell is STILL reachable: props must never seal a door.
  const props = [];
  const floorCount = grid.reduce((n, v) => n + v, 0);
  const propKinds = ['oak-barrel', 'timber-crate', 'clay-storage-pot', 'oak-barrel', 'standing-brazier'];
  for (const room of rooms) {
    const want = rng.int(1, 3);
    for (let n = 0, tries = 0; n < want && tries < 20; tries++) {
      const c = randomRoomCell(room);
      const i = idx(c.x, c.y);
      const nextToWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[idx(c.x + dx, c.y + dy)] === WALL);
      if (!nextToWall || !free(c.x, c.y)) continue;
      blocked[i] = 1;
      const reach = bfsDistances(W, H, walk, start);
      let reached = 0;
      for (let k = 0; k < reach.length; k++) if (reach[k] >= 0) reached++;
      const placed = props.length + 1;
      if (reached !== floorCount - placed) { blocked[i] = 0; continue; } // it sealed something off
      taken.add(i);
      props.push({ kind: rng.pick(propKinds), x: c.x, y: c.y, rot: rng.int(0, 3) * (Math.PI / 2) });
      n++;
    }
  }

  // --- 5. Monsters: a budget that grows with depth, never near the start.
  const dist = bfsDistances(W, H, walk, start);
  const monsters = [];
  const monsterCount = Math.min(4 + depth * 2, 18);
  const normal = MONSTER_TABLE.filter((m) => m.minDepth <= depth);
  const outOfDepth = MONSTER_TABLE.filter((m) => m.minDepth <= depth + 2);
  for (let n = 0, tries = 0; n < monsterCount && tries < 300; tries++) {
    const c = randomRoomCell(rng.pick(rooms));
    if (!free(c.x, c.y) || dist[idx(c.x, c.y)] < SAFE_START) continue;
    const entry = rng.chance(0.05) ? rng.weighted(outOfDepth) : rng.weighted(normal);
    monsters.push({ type: entry.type, x: c.x, y: c.y, asleep: rng.chance(0.6) });
    taken.add(idx(c.x, c.y));
    n++;
  }

  // --- 6. Loot.
  const items = [];
  const place = (kind, amount, room = rng.pick(rooms)) => {
    for (let tries = 0; tries < 30; tries++) {
      const c = randomRoomCell(room);
      if (!free(c.x, c.y)) continue;
      taken.add(idx(c.x, c.y));
      items.push({ kind, x: c.x, y: c.y, amount });
      return;
    }
  };
  const golds = rng.int(4, 7);
  for (let n = 0; n < golds; n++) place('gold', rng.int(4, 12) * depth);
  const potions = rng.int(1, 2) + (depth > 2 ? 1 : 0);
  for (let n = 0; n < potions; n++) place('potion', 1);
  if (rng.chance(0.6)) place('strongbox', rng.int(25, 45) * depth, stairsRoom);

  // --- 7. Decoration that does not block movement (bones, mushrooms).
  const decor = [];
  for (let n = 0; n < rooms.length * 2; n++) {
    const c = randomRoomCell(rng.pick(rooms));
    if (!walk(c.x, c.y)) continue;
    decor.push({
      kind: rng.chance(0.55) ? 'bone-scatter' : 'mushroom-cluster',
      x: c.x, y: c.y, ox: rng.float() - 0.5, oy: rng.float() - 0.5, rot: rng.float() * Math.PI * 2,
    });
  }

  // --- 8. Wall torches on north-facing walls of rooms (the walls the camera looks at).
  const torches = [];
  for (const room of rooms) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (grid[idx(x, room.y - 1)] === WALL && (x - room.x) % 3 === 1 && rng.chance(0.7)) {
        torches.push({ x, y: room.y });
      }
    }
  }

  return { width: W, height: H, grid, blocked, rooms, start, stairs, props, monsters, items, decor, torches };
}

/** Returns a list of problems; empty means the floor is good. */
export function validateFloor(f) {
  const problems = [];
  const W = f.width;
  const idx = (x, y) => y * W + x;
  const walk = (x, y) => f.grid[idx(x, y)] === FLOOR && !f.blocked[idx(x, y)];
  if (f.rooms.length < 5) problems.push('too few rooms');
  if (f.start.x === f.stairs.x && f.start.y === f.stairs.y) problems.push('stairs on the start');

  const dist = bfsDistances(W, f.height, walk, f.start);
  if (dist[idx(f.stairs.x, f.stairs.y)] < 0) problems.push('stairs unreachable');
  for (let i = 0; i < f.grid.length; i++) {
    if (f.grid[i] === FLOOR && !f.blocked[i] && dist[i] < 0) { problems.push('unreachable floor'); break; }
  }
  for (const m of f.monsters) {
    if (dist[idx(m.x, m.y)] < SAFE_START) problems.push(`monster too close to start at ${m.x},${m.y}`);
  }
  for (const it of [...f.items, ...f.monsters]) {
    if (!walk(it.x, it.y)) problems.push(`thing inside a wall at ${it.x},${it.y}`);
  }
  // The outer border must stay solid so nothing walks off the map.
  for (let x = 0; x < W; x++) if (f.grid[idx(x, 0)] || f.grid[idx(x, f.height - 1)]) problems.push('open border');
  for (let y = 0; y < f.height; y++) if (f.grid[idx(0, y)] || f.grid[idx(W - 1, y)]) problems.push('open border');
  return problems;
}
