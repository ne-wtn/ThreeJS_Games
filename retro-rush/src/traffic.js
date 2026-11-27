// Traffic: spawning, moving, recycling and collision.
//
// LESSONS in this file:
//  1. Object pooling: we create every car ONCE at load time and reuse them. Creating
//     and deleting objects mid-game causes stutters (garbage collection, GPU uploads).
//  2. Fair spawning: each "row" of traffic always leaves at least one lane open, and all
//     traffic drives at the same speed, so rows can never merge into a wall.
//  3. Box collision (AABB): two boxes overlap when they overlap on BOTH axes.
//     We shrink the boxes a little on purpose: forgiving hitboxes feel fair.
import { LANES } from './road.js';
import { sizeOf } from './assets.js';

export const TRAFFIC_SPEED = 6; // m/s, every car the same so rows never catch each other
const SPAWN_Z = -135;          // just inside the fog, so cars fade in instead of popping
const DESPAWN_Z = 22;
const COPIES_PER_KIND = 3;

export class Traffic {
  constructor(scene, models, kinds) {
    this.pool = [];
    for (const kind of kinds) {
      const size = sizeOf(models[kind]);
      for (let i = 0; i < COPIES_PER_KIND; i++) {
        const obj = models[kind].clone(); // clones share geometry and material: cheap
        obj.rotation.y = Math.PI;         // models face +z; traffic drives towards -z like us
        obj.visible = false;
        scene.add(obj);
        this.pool.push({ obj, kind, halfW: size.x / 2, halfL: size.z / 2, active: false, passed: false });
      }
    }
    // Every car starts hidden and inactive; reset() puts the first rows on the road.
  }

  reset() {
    for (const car of this.pool) {
      car.active = false;
      car.obj.visible = false;
    }
    // Start with two rows already on the road so the action begins right away.
    this.spawnRow(0, -70);
    this.spawnRow(0, -115);
    this.untilNextRow = 20; // metres of relative travel before the next row
  }

  /**
   * difficulty: 0 at the start, 1 when the game is at its hardest.
   * Returns { crash: car|null, nearMisses: number }.
   */
  update(dt, playerSpeed, player, difficulty) {
    const relSpeed = playerSpeed - TRAFFIC_SPEED; // how fast traffic approaches us
    const dz = relSpeed * dt;
    const events = { crash: null, nearMisses: 0 };

    // --- spawning, measured in relative metres so gaps stay fair at any speed
    this.untilNextRow -= dz;
    if (this.untilNextRow <= 0) {
      this.spawnRow(difficulty);
      const minGap = 22 + (1 - difficulty) * 18;           // rows get closer as you go
      this.untilNextRow = Math.max(minGap, relSpeed * 0.85) + Math.random() * 14;
    }

    // --- movement, near misses, collision
    for (const car of this.pool) {
      if (!car.active) continue;
      car.obj.position.z += dz;
      const z = car.obj.position.z;

      if (z > DESPAWN_Z || z < SPAWN_Z - 40) {
        car.active = false;
        car.obj.visible = false;
        continue;
      }

      const dxAbs = Math.abs(car.obj.position.x - player.x);
      const dzAbs = Math.abs(z - player.z);

      // AABB overlap on the ground plane (x and z), with a forgiving margin.
      const overlapX = dxAbs < car.halfW + player.halfW - 0.25;
      const overlapZ = dzAbs < car.halfL + player.halfL - 0.35;
      if (overlapX && overlapZ) events.crash = car;

      // Near miss: the car has just gone fully past us, in the lane next to ours.
      if (!car.passed && z - car.halfL > player.z + player.halfL) {
        car.passed = true;
        if (dxAbs < 4.6) events.nearMisses++;
      }
    }
    return events;
  }

  spawnRow(difficulty, z = SPAWN_Z) {
    // Shuffle lane indices, then fill 1 or 2 of them. Never 3: there is always a way through.
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const twoCars = Math.random() < 0.15 + difficulty * 0.45;
    const count = twoCars ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const car = this.takeFromPool();
      if (!car) return; // pool exhausted: skipping a car is better than a stutter
      car.active = true;
      car.passed = false;
      car.obj.visible = true;
      car.obj.position.set(LANES[lanes[i]], 0, z - Math.random() * 6);
    }
  }

  takeFromPool() {
    const free = this.pool.filter((c) => !c.active);
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }
}
