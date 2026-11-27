// Seeded random numbers.
//
// LESSON (procedural-gen skill): Math.random() can't be replayed. A seeded generator
// gives the SAME sequence for the SAME seed, so a dungeon can be regenerated, shared
// ("try seed 1234!") and debugged. Each floor gets its own seed derived from the run
// seed and the depth. Fighting on floor 1 never changes the layout of floor 2.

/** mulberry32: a tiny, fast 32-bit generator. Returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix several integers into one 32-bit seed (FNV-1a style). Same inputs, same output. */
export function hashSeeds(...values) {
  let h = 2166136261;
  for (const v of values) {
    h ^= v >>> 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}

/** Convenience wrapper with the helpers a generator needs. */
export class Rng {
  constructor(seed) {
    this.float = mulberry32(seed);
  }
  /** Integer from min to max, inclusive. */
  int(min, max) {
    return min + Math.floor(this.float() * (max - min + 1));
  }
  chance(p) {
    return this.float() < p;
  }
  pick(array) {
    return array[Math.floor(this.float() * array.length)];
  }
  /** Weighted pick: entries are objects with a `weight`. */
  weighted(entries) {
    const total = entries.reduce((sum, e) => sum + e.weight, 0);
    let roll = this.float() * total;
    for (const e of entries) {
      roll -= e.weight;
      if (roll < 0) return e;
    }
    return entries[entries.length - 1];
  }
  /** Fisher-Yates shuffle, in place. */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}
