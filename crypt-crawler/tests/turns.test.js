// The energy scheduler gives turns in proportion to speed (roguelike skill, "Check it").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReady, ACTION_COST } from '../src/turns.js';

test('speeds 50/100/200 act in a 1:2:4 ratio', () => {
  const actors = [50, 100, 200].map((speed) => ({ speed, energy: 0, turns: 0 }));
  const clock = { time: 0 };
  while (clock.time < 1000) {
    const a = nextReady(actors, clock);
    a.turns++;
    a.energy -= ACTION_COST;
  }
  const [slow, normal, fast] = actors.map((a) => a.turns);
  assert.ok(Math.abs(normal / slow - 2) < 0.02, `${slow}:${normal}:${fast}`);
  assert.ok(Math.abs(fast / slow - 4) < 0.02, `${slow}:${normal}:${fast}`);
});

test('two equal-speed actors alternate', () => {
  const a = { speed: 100, energy: 0, name: 'a' };
  const b = { speed: 100, energy: 0, name: 'b' };
  const order = [];
  for (let i = 0; i < 6; i++) {
    const x = nextReady([a, b]);
    order.push(x.name);
    x.energy -= ACTION_COST;
  }
  assert.deepEqual(order, ['a', 'b', 'a', 'b', 'a', 'b']);
});
