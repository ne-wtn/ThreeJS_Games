// Explosion and thruster particles with ONE InstancedMesh.
//
// LESSON: every separate Mesh costs a "draw call" (a request to the GPU). 800 particle
// meshes would be 800 draw calls. An InstancedMesh draws all 800 copies of one shape in a
// SINGLE draw call; we only update each copy's matrix (position/rotation/scale) and colour.
//
// The particles live in a ring buffer: when all 800 are busy, the oldest one is reused.
import * as THREE from 'three';

const MAX = 800;

export class Particles {
  constructor(scene) {
    const geometry = new THREE.IcosahedronGeometry(0.5, 0); // a low-poly chunk
    const material = new THREE.MeshBasicMaterial({ toneMapped: false }); // unlit, so it glows
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // we rewrite it every frame
    // The mesh's bounding sphere is that of ONE chunk at the origin, so the camera would
    // wrongly cull everything once the origin is off screen. Turn culling off.
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.items = Array.from({ length: MAX }, () => ({
      life: 0, maxLife: 1, size: 1,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      color: new THREE.Color(), spin: 0, drag: 3,
    }));
    this.next = 0;
    this.dummy = new THREE.Object3D();
    const black = new THREE.Color(0);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setColorAt(i, black); // creates the per-instance colour buffer
      this.hide(i);
    }
  }

  hide(i) {
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  /** Spray `count` particles out from `pos`. */
  burst(pos, { count = 14, speed = 14, color = 0xffaa33, size = 0.7, life = 0.6, drag = 3 } = {}) {
    for (let n = 0; n < count; n++) {
      const p = this.items[this.next];
      this.next = (this.next + 1) % MAX;
      const angle = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      p.pos.copy(pos);
      p.vel.set(Math.cos(angle) * sp, (Math.random() - 0.3) * sp * 0.4, Math.sin(angle) * sp);
      p.life = p.maxLife = life * (0.6 + Math.random() * 0.6);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.color.set(color).offsetHSL((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.2);
      p.spin = (Math.random() - 0.5) * 12;
      p.drag = drag;
    }
  }

  /** A single puff with a given velocity (engine exhaust). */
  puff(pos, vel, color, size = 0.45, life = 0.35) {
    const p = this.items[this.next];
    this.next = (this.next + 1) % MAX;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = p.maxLife = life;
    p.size = size;
    p.color.set(color);
    p.spin = 0;
    p.drag = 2;
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.hide(i);
        continue;
      }
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife; // 1 -> 0 over the particle's life
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.set(p.spin * k, p.spin * k * 0.7, 0);
      this.dummy.scale.setScalar(p.size * k);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
