// Seed sweep for the dungeon generator (procedural-gen skill, "Check it").
// Run with `npm test` from the polyfork-games folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateFloor, validateFloor } from '../src/dungeon.js';

const digest = (f) => createHash('sha1')
  .update(Buffer.from(f.grid)).update(Buffer.from(f.blocked))
  .update(JSON.stringify([f.start, f.stairs, f.monsters, f.items, f.props]))
  .digest('hex');

test('same seed and depth give the same floor', () => {
  for (let seed = 1; seed <= 50; seed++) {
    for (const depth of [1, 3]) {
      assert.equal(digest(generateFloor(seed, depth)), digest(generateFloor(seed, depth)));
    }
  }
});

test('300 seeds x 4 depths all pass validation', () => {
  const digests = new Set();
  let retries = 0;
  for (let seed = 1; seed <= 300; seed++) {
    for (let depth = 1; depth <= 4; depth++) {
      const f = generateFloor(seed * 7919, depth);
      assert.deepEqual(validateFloor(f), [], `seed ${seed * 7919} depth ${depth}`);
      retries += f.attempt;
      if (depth === 1) digests.add(digest(f));
    }
  }
  console.log(`  distinct depth-1 floors: ${digests.size}/300, regenerations needed: ${retries}`);
  assert.ok(digests.size > 295, 'seeds should give different floors');
});

test('deeper floors hold more monsters', () => {
  let shallow = 0, deep = 0;
  for (let seed = 1; seed <= 40; seed++) {
    shallow += generateFloor(seed, 1).monsters.length;
    deep += generateFloor(seed, 5).monsters.length;
  }
  assert.ok(deep > shallow);
});
