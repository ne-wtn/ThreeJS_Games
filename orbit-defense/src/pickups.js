// Supply crates dropped by destroyed enemies.
// Each crate is either REPAIR (green ring: +2 hull, +3 beacon) or TRIPLE SHOT (amber ring).
// Crates bob and spin so they read as "collect me", and blink before they expire.
import * as THREE from 'three';
import { MAX_HULL } from './player.js';

const LIFETIME = 11;
const KINDS = {
  repair: { color: 0x9dff7a },
  triple: { color: 0xffc65a },
};

export class Pickups {
  constructor(w) {
    this.w = w;
    this.list = [];
    this.ringGeo = new THREE.TorusGeometry(1.6, 0.12, 6, 28);
    this.ringGeo.rotateX(Math.PI / 2);
    // One shared material per kind, made once (not one per crate).
    this.ringMats = {};
    for (const [kind, k] of Object.entries(KINDS)) {
      this.ringMats[kind] = new THREE.MeshBasicMaterial({ color: k.color, toneMapped: false });
    }
  }

  drop(pos) {
    const kind = Math.random() < 0.5 ? 'repair' : 'triple';
    const group = new THREE.Group();
    const crate = this.w.models['supply-crate'].clone();
    crate.scale.setScalar(1.5);
    crate.position.y = 0.2;
    group.add(crate);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMats[kind]);
    group.add(ring);
    group.position.set(pos.x, 0, pos.z);
    this.w.scene.add(group);
    this.list.push({ group, crate, kind, life: LIFETIME, t: Math.random() * 10 });
  }

  update(dt) {
    const w = this.w;
    const p = w.player;
    for (const item of this.list) {
      item.life -= dt;
      item.t += dt;
      item.crate.rotation.y += dt * 1.6;
      item.crate.position.y = 0.4 + Math.sin(item.t * 3) * 0.3;
      item.group.visible = item.life > 3 || Math.floor(item.life * 8) % 2 === 0;

      if (p.alive && item.group.position.distanceTo(p.pos) < 3.2) {
        if (item.kind === 'repair') {
          p.hull = Math.min(MAX_HULL, p.hull + 2);
          w.beacon.heal(3);
        } else {
          p.tripleShot = 10;
        }
        w.sound.pickup();
        w.particles.burst(item.group.position, { count: 18, color: KINDS[item.kind].color, speed: 12, size: 0.5 });
        item.life = 0;
      }
      if (item.life <= 0) this.w.scene.remove(item.group);
    }
    this.list = this.list.filter((item) => item.life > 0);
  }

  clear() {
    for (const item of this.list) this.w.scene.remove(item.group);
    this.list = [];
  }
}
