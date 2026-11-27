// The player's starfighter: twin-stick movement, mouse aiming and shooting.
//
// LESSONS:
//  - Movement uses ACCELERATION and DRAG instead of setting the position directly.
//    The ship has momentum, so it feels like a spaceship, but drag keeps it controllable.
//  - Aiming: the direction to the mouse is (aim - position), normalised to length 1.
//    Math.atan2(dir.x, dir.z) turns that direction into a rotation around the y axis.
import * as THREE from 'three';
import { cloneWithOwnMaterials, setFlash } from './assets.js';

const ACCEL = 95;       // m/s² of thrust
const DRAG = 3.2;       // higher = stops sooner
const FIRE_RATE = 9;    // shots per second
const BULLET_SPEED = 75;
export const MAX_HULL = 6;

const tmp = new THREE.Vector3();

export class Player {
  constructor(w) {
    this.mesh = cloneWithOwnMaterials(w.models['agile-starfighter']);
    this.mesh.scale.setScalar(0.5);
    w.scene.add(this.mesh);
    this.radius = 1.6;
    this.pos = this.mesh.position;
    this.vel = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 10);
    this.vel.set(0, 0, 0);
    this.hull = MAX_HULL;
    this.invulnerable = 0; // seconds of mercy after being hit
    this.cooldown = 0;
    this.tripleShot = 0;   // seconds of power-up left
    this.flash = 0;
    this.alive = true;
    this.mesh.visible = true;
    this.mesh.rotation.set(0, Math.PI, 0);
  }

  /** input: { moveX, moveZ, aim: Vector3, firing: bool } */
  update(dt, input, w) {
    if (!this.alive) return;

    // --- movement: input -> acceleration -> velocity -> position
    tmp.set(input.moveX, 0, input.moveZ);
    if (tmp.lengthSq() > 1) tmp.normalize(); // diagonals are not faster
    this.vel.addScaledVector(tmp, ACCEL * dt);
    this.vel.multiplyScalar(Math.exp(-DRAG * dt));
    this.pos.addScaledVector(this.vel, dt);

    // Soft arena wall: past the edge, push back towards the centre.
    const dist = Math.hypot(this.pos.x, this.pos.z);
    if (dist > w.arenaRadius) {
      const nx = this.pos.x / dist, nz = this.pos.z / dist; // outward direction
      const pull = (dist - w.arenaRadius) * (1 - Math.exp(-10 * dt));
      this.pos.x -= nx * pull;
      this.pos.z -= nz * pull;
      const outward = this.vel.x * nx + this.vel.z * nz;
      if (outward > 0) this.vel.addScaledVector(tmp.set(nx, 0, nz), -outward); // cancel outward speed
    }

    // --- aiming: face the mouse
    const aimX = input.aim.x - this.pos.x;
    const aimZ = input.aim.z - this.pos.z;
    const aimLen = Math.hypot(aimX, aimZ) || 1;
    const dirX = aimX / aimLen;
    const dirZ = aimZ / aimLen;
    this.mesh.rotation.y = Math.atan2(dirX, dirZ);
    // Bank (roll) into sideways movement: a small touch that makes it feel alive.
    const sideways = this.vel.x * dirZ - this.vel.z * dirX;
    this.mesh.rotation.z = THREE.MathUtils.clamp(-sideways * 0.02, -0.5, 0.5);

    // --- shooting
    this.cooldown -= dt;
    this.tripleShot = Math.max(0, this.tripleShot - dt);
    if (input.firing && this.cooldown <= 0) {
      this.cooldown = 1 / FIRE_RATE;
      const noseX = this.pos.x + dirX * 2.2;
      const noseZ = this.pos.z + dirZ * 2.2;
      const angles = this.tripleShot > 0 ? [-0.16, 0, 0.16] : [0];
      for (const a of angles) {
        const c = Math.cos(a), s = Math.sin(a);
        w.bullets.fire('player', noseX, noseZ, dirX * c - dirZ * s, dirX * s + dirZ * c, { speed: BULLET_SPEED });
      }
      w.sound.shoot();
    }

    // --- engine exhaust: puff particles out of the back, faster when thrusting
    const thrusting = input.moveX || input.moveZ;
    if (Math.random() < (thrusting ? 0.9 : 0.25)) {
      tmp.set(this.pos.x - dirX * 1.8, 0.8, this.pos.z - dirZ * 1.8);
      const back = new THREE.Vector3(-dirX, 0, -dirZ).multiplyScalar(thrusting ? 14 : 5);
      w.particles.puff(tmp, back, thrusting ? 0x6fe3ff : 0x2d6f99, thrusting ? 0.55 : 0.35);
    }

    // --- damage feedback: blink while invulnerable, white flash on hit
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.mesh.visible = this.invulnerable <= 0 || Math.floor(this.invulnerable * 16) % 2 === 0;
    this.flash = Math.max(0, this.flash - dt * 6);
    setFlash(this.mesh, this.flash, 0xff6060);
  }

  /** Returns true if the hit landed (not during the mercy window). */
  damage(amount, w) {
    if (!this.alive || this.invulnerable > 0) return false;
    this.hull -= amount;
    this.invulnerable = 1.2;
    this.flash = 1;
    w.feel.shake(0.55);
    w.feel.hitStop(0.07);
    w.sound.hurt();
    w.particles.burst(this.pos, { count: 10, color: 0xff7070, speed: 10 });
    if (this.hull <= 0) {
      this.alive = false;
      this.mesh.visible = false;
      w.particles.burst(this.pos, { count: 60, color: 0x9ff3ff, speed: 26, size: 1, life: 1.1 });
      w.particles.burst(this.pos, { count: 30, color: 0xffc65a, speed: 16, size: 1.2, life: 0.9 });
      w.feel.shake(1);
      w.feel.hitStop(0.15);
      w.sound.bigExplode();
    }
    return true;
  }
}
