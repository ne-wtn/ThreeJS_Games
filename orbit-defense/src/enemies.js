// Enemies: types, steering AI, collisions and deaths.
//
// LESSONS:
//  1. DATA-DRIVEN TYPES: every enemy kind is a row in the TYPES table. Adding a new enemy
//     is mostly adding a row, not writing a new class.
//  2. STEERING (Craig Reynolds' "steering behaviours"):
//       desired = (target - position) normalised * maxSpeed
//       steer   = desired - velocity          (how we must change course)
//       velocity += steer, limited by accel * dt
//     That gives smooth, curving pursuit instead of robotic straight lines.
//     SEPARATION pushes enemies apart so they don't stack into one blob.
//  3. TARGET SELECTION: interceptors go for the beacon unless the player gets close.
//  4. CIRCLE COLLISION: in a top-down game, two things touch when the distance between
//     their centres is less than the sum of their radii. Compare SQUARED distances to
//     skip the square root.
import * as THREE from 'three';
import { cloneWithOwnMaterials, setFlash } from './assets.js';

export const TYPES = {
  interceptor: { model: 'interceptor', scale: 0.42, radius: 1.7, hp: 2, speed: 17, accel: 34, score: 100 },
  raider: { model: 'alien-raider', scale: 0.38, radius: 2.3, hp: 7, speed: 11, accel: 16, score: 300, fireEvery: 1.9 },
  mine: { model: 'space-mine', scale: 1.4, radius: 1.2, hp: 1, speed: 3.5, accel: 6, score: 50, blast: 8 },
  asteroidL: { model: 'large-asteroid', scale: 0.55, radius: 2.7, hp: 8, speed: 6, score: 60, splitInto: 'asteroidM', rock: true },
  asteroidM: { model: 'medium-asteroid', scale: 0.6, radius: 1.5, hp: 4, speed: 8, score: 40, splitInto: 'asteroidS', rock: true },
  asteroidS: { model: 'small-asteroid', scale: 0.7, radius: 0.8, hp: 2, speed: 10, score: 20, rock: true },
  bomber: { model: 'heavy-bomber', scale: 0.6, radius: 4.6, hp: 90, speed: 4.5, accel: 4, score: 2500, boss: true, fireEvery: 2.4 },
};

const v = new THREE.Vector3(); // scratch vectors, reused to avoid garbage every frame
const steer = new THREE.Vector3();

export class Enemies {
  constructor(w) {
    this.w = w;
    this.list = [];  // active enemies
    this.pools = {}; // inactive enemies, per type, ready for reuse
  }

  get count() { return this.list.length; }
  get boss() { return this.list.find((e) => e.type.boss); }

  spawn(typeName, x, z, velocity = null) {
    const type = TYPES[typeName];
    const pool = (this.pools[typeName] ??= []);
    let e = pool.pop();
    if (!e) {
      const mesh = cloneWithOwnMaterials(this.w.models[type.model]);
      mesh.scale.setScalar(type.scale);
      e = { mesh, pos: mesh.position, vel: new THREE.Vector3(), typeName, type };
    }
    this.w.scene.add(e.mesh);
    e.pos.set(x, 0, z);
    e.vel.set(0, 0, 0);
    if (velocity) e.vel.copy(velocity);
    e.hp = type.hp;
    e.flash = 0;
    e.fireTimer = (type.fireEvery ?? 0) * (0.5 + Math.random());
    e.spawnTimer = 5;
    e.orbitDir = Math.random() < 0.5 ? 1 : -1;
    e.spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2);
    e.dead = false;
    this.list.push(e);
    return e;
  }

  update(dt) {
    const w = this.w;
    for (const e of this.list) {
      if (e.dead) continue;
      const t = e.type;

      if (t.rock) {
        // Asteroids just drift and tumble. They leave when far outside the arena.
        e.pos.addScaledVector(e.vel, dt);
        e.mesh.rotation.x += e.spin.x * dt;
        e.mesh.rotation.y += e.spin.y * dt;
        if (e.pos.length() > w.arenaRadius + 45) this.remove(e);
      } else {
        this.think(e, dt);
        // Limit speed, then move. Face the direction of travel.
        if (e.vel.length() > t.speed) e.vel.setLength(t.speed);
        e.pos.addScaledVector(e.vel, dt);
        if (e.typeName === 'mine') {
          e.mesh.rotation.y += dt * 1.5;
        } else if (e.vel.lengthSq() > 0.5) {
          const want = Math.atan2(e.vel.x, e.vel.z);
          e.mesh.rotation.y = lerpAngle(e.mesh.rotation.y, want, 1 - Math.exp(-8 * dt));
        }
      }

      if (e.dead) continue;
      this.collide(e);

      e.flash = Math.max(0, e.flash - dt * 8);
      setFlash(e.mesh, e.flash);
    }
    // Tidy up AFTER the loop: changing an array while looping over it skips items, and
    // returning an enemy to its pool mid-loop could let a spawn reuse it in the same frame.
    for (const e of this.list) if (e.dead) this.pools[e.typeName].push(e);
    this.list = this.list.filter((e) => !e.dead);
  }

  // --- AI: decide where to go, then steer there --------------------------------------
  think(e, dt) {
    const w = this.w;
    const p = w.player;
    const t = e.type;

    if (e.typeName === 'interceptor') {
      // Target selection: the beacon, unless the player is close enough to be tempting.
      const nearPlayer = p.alive && e.pos.distanceToSquared(p.pos) < 15 * 15;
      this.seek(e, nearPlayer ? p.pos : w.beacon.pos, dt);
      this.separate(e, dt);
    }

    if (e.typeName === 'raider') {
      // Orbit the player at a distance and shoot. Target point: a spot on a circle
      // around the player, a little ahead of where the raider is now.
      const target = p.alive ? p.pos : w.beacon.pos;
      const angle = Math.atan2(e.pos.z - target.z, e.pos.x - target.x) + 0.5 * e.orbitDir;
      v.set(target.x + Math.cos(angle) * 18, 0, target.z + Math.sin(angle) * 18);
      this.seek(e, v, dt);
      this.separate(e, dt);
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && p.alive) {
        e.fireTimer = t.fireEvery;
        this.shootAt(e, p.pos, 32);
      }
    }

    if (e.typeName === 'mine') {
      this.seek(e, w.beacon.pos, dt);
    }

    if (e.typeName === 'bomber') {
      // Arrive: approach the beacon but stop at a stand-off distance.
      const d = e.pos.distanceTo(w.beacon.pos);
      if (d > 22) this.seek(e, w.beacon.pos, dt);
      else e.vel.multiplyScalar(Math.exp(-2 * dt));
      // Attack: a ring of bullets, then launch interceptors.
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        e.fireTimer = t.fireEvery;
        const offset = Math.random() * Math.PI;
        for (let i = 0; i < 14; i++) {
          const a = offset + (i / 14) * Math.PI * 2;
          w.bullets.fire('enemy', e.pos.x, e.pos.z, Math.cos(a), Math.sin(a), { speed: 20, life: 3, scale: 1.4 });
        }
        w.sound.enemyShoot();
      }
      e.spawnTimer -= dt;
      if (e.spawnTimer <= 0) {
        e.spawnTimer = 6;
        for (const side of [-1, 1]) this.spawn('interceptor', e.pos.x + side * 6, e.pos.z);
      }
    }
  }

  seek(e, target, dt) {
    steer.subVectors(target, e.pos).setY(0).setLength(e.type.speed).sub(e.vel); // desired - velocity
    const maxChange = e.type.accel * dt;
    if (steer.length() > maxChange) steer.setLength(maxChange);
    e.vel.add(steer);
  }

  separate(e, dt) {
    for (const o of this.list) {
      if (o === e || o.dead || o.type.rock) continue;
      const minDist = e.type.radius + o.type.radius + 1.5;
      const dsq = e.pos.distanceToSquared(o.pos);
      if (dsq > minDist * minDist || dsq === 0) continue;
      const d = Math.sqrt(dsq);
      v.subVectors(e.pos, o.pos).divideScalar(d); // away from the neighbour
      e.vel.addScaledVector(v, (minDist - d) * 12 * dt);
    }
  }

  shootAt(e, target, speed) {
    const dx = target.x - e.pos.x, dz = target.z - e.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.w.bullets.fire('enemy', e.pos.x, e.pos.z, dx / len, dz / len, { speed, life: 2.5, scale: 1.2 });
    this.w.sound.enemyShoot();
  }

  // --- collisions ----------------------------------------------------------------------
  collide(e) {
    const w = this.w;
    const r = e.type.radius;

    // Player bullets hitting this enemy.
    for (const b of w.bullets.list) {
      if (!b.active || b.team !== 'player') continue;
      if (touching(e.pos, r, b.mesh.position, b.radius)) {
        w.bullets.kill(b);
        this.damage(e, b.damage);
        if (e.dead) return;
      }
    }

    // Ramming the player.
    const p = w.player;
    if (p.alive && touching(e.pos, r, p.pos, p.radius)) {
      if (e.typeName === 'mine') return this.kill(e, { byPlayer: false });
      if (e.type.boss) { p.damage(2, w); return; }
      if (p.damage(e.type.rock ? 1 : 2, w)) {
        // Bounce the player away from what it hit.
        v.subVectors(p.pos, e.pos).setY(0).setLength(22);
        p.vel.copy(v);
      }
      if (!e.type.rock) return this.kill(e, { byPlayer: false });
    }

    // Reaching the beacon.
    if (!e.type.boss && touching(e.pos, r, w.beacon.pos, w.beacon.radius)) {
      if (e.typeName === 'mine') return this.kill(e, { byPlayer: false });
      w.beacon.damage(e.type.rock ? 2 : 1);
      this.kill(e, { byPlayer: false });
    }
  }

  damage(e, amount) {
    e.hp -= amount;
    e.flash = 1;
    this.w.sound.hit();
    this.w.particles.burst(e.pos, { count: 3, color: 0xffffff, speed: 8, size: 0.4, life: 0.25 });
    if (e.hp <= 0) this.kill(e, { byPlayer: true });
  }

  kill(e, { byPlayer }) {
    if (e.dead) return;
    const w = this.w;
    const t = e.type;
    e.dead = true;
    this.remove(e);

    if (byPlayer) w.addScore(t.score);

    // Feedback scaled to the size of the event (game-feel "tiers").
    if (t.boss) {
      w.particles.burst(e.pos, { count: 120, color: 0xffc65a, speed: 34, size: 1.6, life: 1.4 });
      w.particles.burst(e.pos, { count: 60, color: 0xff5ae0, speed: 22, size: 1.2, life: 1.2 });
      w.feel.shake(1);
      w.feel.hitStop(0.18);
      w.sound.bigExplode();
    } else if (t.rock) {
      w.particles.burst(e.pos, { count: 10 + t.radius * 6, color: 0x9a8f86, speed: 10 + t.radius * 2, size: 0.4 + t.radius * 0.25, life: 0.8 });
      w.feel.shake(0.12 + t.radius * 0.05);
      w.sound.explode();
    } else {
      w.particles.burst(e.pos, { count: 26, color: 0xffa040, speed: 18, size: 0.9 });
      w.particles.burst(e.pos, { count: 10, color: 0xfff1b0, speed: 8, size: 0.6, life: 0.3 });
      w.feel.shake(0.3);
      w.feel.hitStop(0.035);
      w.sound.explode();
    }

    // Mines explode and damage everything nearby: chain reactions!
    if (t.blast) {
      w.particles.burst(e.pos, { count: 50, color: 0xff4040, speed: 30, size: 1.1, life: 0.7 });
      w.feel.shake(0.5);
      for (const o of [...this.list]) { // a copy: damage may spawn rock fragments
        if (!o.dead && o.pos.distanceTo(e.pos) < t.blast + o.type.radius) this.damage(o, 3);
      }
      if (w.player.alive && w.player.pos.distanceTo(e.pos) < t.blast) w.player.damage(2, w);
      if (w.beacon.pos.distanceTo(e.pos) < t.blast + w.beacon.radius) w.beacon.damage(2);
    }

    // Asteroids split into two smaller rocks flying apart.
    if (t.splitInto) {
      const base = Math.atan2(e.vel.z, e.vel.x);
      for (const side of [-1, 1]) {
        const a = base + side * (0.5 + Math.random() * 0.4);
        const sp = TYPES[t.splitInto].speed;
        const vel = new THREE.Vector3(Math.cos(a) * sp, 0, Math.sin(a) * sp);
        this.spawn(t.splitInto, e.pos.x + vel.x * 0.2, e.pos.z + vel.z * 0.2, vel);
      }
    }

    // Sometimes drop a supply crate.
    if (byPlayer && !t.rock && Math.random() < (t.boss ? 1 : 0.1)) w.pickups.drop(e.pos);
  }

  /** Take an enemy out of the world. update() returns it to its pool afterwards. */
  remove(e) {
    e.dead = true;
    this.w.scene.remove(e.mesh);
  }

  clear() {
    for (const e of this.list) {
      this.remove(e);
      this.pools[e.typeName].push(e);
    }
    this.list = [];
  }
}

function touching(a, ra, b, rb) {
  const dx = a.x - b.x, dz = a.z - b.z, r = ra + rb;
  return dx * dx + dz * dz < r * r;
}

// Turn the shortest way round: going from 350° to 10° should be +20°, not -340°.
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
