// Monster data and AI. Pure logic (no three.js).
//
// LESSON (game-ai skill): each monster is a small FINITE STATE MACHINE.
//
//   sleep  --sees you (and wakes)-->  hunt  --loses you for 5 turns-->  search
//   wander --sees you------------->  hunt  <--sees you again--------   search
//                                                search --reaches your last known spot--> wander
//
// Monsters do NOT read your live position once they lose sight of you. They go to where
// they LAST saw you. That makes them feel fair instead of psychic.
// "Seeing" uses the player's own field of view, so sight is symmetric: if you can see
// the goblin, the goblin can see you.
import { astar } from './pathfinding.js';

export const MONSTERS = {
  rat: { name: 'dungeon rat', model: 'dungeon-rat', hp: 3, atk: [1, 2], speed: 200, sight: 6, scale: 1.6 },
  goblin: { name: 'goblin', model: 'goblin', hp: 6, atk: [1, 3], speed: 100, sight: 7, scale: 1.05 },
  ghoul: { name: 'shambling ghoul', model: 'shambling-ghoul', hp: 13, atk: [2, 4], speed: 50, sight: 8, scale: 1 },
  orc: { name: 'orc brute', model: 'orc-brute', hp: 18, atk: [3, 6], speed: 100, sight: 7, scale: 1 },
};

// Which monsters can appear, from which depth, and how often (relative weights).
export const MONSTER_TABLE = [
  { type: 'rat', minDepth: 1, weight: 4 },
  { type: 'goblin', minDepth: 1, weight: 4 },
  { type: 'ghoul', minDepth: 2, weight: 3 },
  { type: 'orc', minDepth: 3, weight: 2 },
];

export function createMonster(spawn, depth, id) {
  const t = MONSTERS[spawn.type];
  const hp = Math.round(t.hp * (1 + 0.2 * (depth - 1))); // tougher deeper down
  return {
    id, kind: 'monster', type: spawn.type, name: t.name,
    x: spawn.x, y: spawn.y, hp, maxHp: hp,
    atk: [t.atk[0] + Math.floor((depth - 1) / 2), t.atk[1] + Math.floor((depth - 1) / 2)],
    speed: t.speed, sight: t.sight, energy: 0,
    state: spawn.asleep ? 'sleep' : 'wander',
    lastKnown: null, lostTurns: 0, alive: true,
  };
}

/**
 * Decide what a monster does this turn.
 * ctx: { width, height, isWalkable(x,y), monsterAt(x,y), player, playerSees(x,y), rng() }
 * Returns { type: 'attack' } | { type: 'move', x, y } | { type: 'wait' }, plus an optional
 * `say` message when its state changes in a way the player should hear about.
 */
export function decide(m, ctx) {
  const p = ctx.player;
  const dist = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
  const sees = ctx.playerSees(m.x, m.y) && dist <= m.sight;
  let say = null;

  // --- perception -> state transitions
  if (sees) {
    if (m.state === 'sleep') {
      if (ctx.rng() < 0.35) return { type: 'wait' }; // still dozing (stealth!)
      say = `The ${m.name} wakes up!`;
    } else if (m.state !== 'hunt') {
      say = `The ${m.name} spots you.`;
    }
    m.state = 'hunt';
    m.lastKnown = { x: p.x, y: p.y };
    m.lostTurns = 0;
  } else if (m.state === 'hunt') {
    // Hysteresis: keep hunting for a few turns after losing sight, so it doesn't flicker.
    if (++m.lostTurns > 5) m.state = 'search';
  }

  // --- act on the current state
  switch (m.state) {
    case 'sleep':
      return { type: 'wait' };

    case 'wander': {
      if (ctx.rng() < 0.6) return { type: 'wait' };
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const [dx, dy] = dirs[Math.floor(ctx.rng() * 4)];
      const nx = m.x + dx, ny = m.y + dy;
      if (ctx.isWalkable(nx, ny) && !ctx.monsterAt(nx, ny) && !(nx === p.x && ny === p.y)) {
        return { type: 'move', x: nx, y: ny };
      }
      return { type: 'wait' };
    }

    case 'hunt':
    case 'search': {
      if (sees && dist === 1) return { type: 'attack', say };
      const goal = m.state === 'hunt' && sees ? p : m.lastKnown;
      if (!goal) { m.state = 'wander'; return { type: 'wait', say }; }
      if (goal.x === m.x && goal.y === m.y) {
        m.state = 'wander'; // reached the last known spot and you are not here
        return { type: 'wait', say };
      }
      // Other monsters count as walls, so they queue up and spread out instead of overlapping.
      const passable = (x, y) => ctx.isWalkable(x, y) && !ctx.monsterAt(x, y);
      const path = astar(ctx.width, ctx.height, passable, m, goal, { maxNodes: 800 });
      if (!path || !path.length) return { type: 'wait', say };
      const step = path[0];
      if (step.x === p.x && step.y === p.y) return { type: 'attack', say };
      if (ctx.monsterAt(step.x, step.y)) return { type: 'wait', say };
      return { type: 'move', x: step.x, y: step.y, say };
    }
  }
  return { type: 'wait' };
}
