// Projectiles: a simple pool of meshes.
//
// LESSON: a bullet is just a position, a velocity and a lifetime. Each frame:
//   position += velocity * dt;  lifetime -= dt;  if lifetime <= 0 -> back to the pool.
// Compare this with particles.js, which uses an InstancedMesh. Bullets are few (tens)
// and need per-bullet logic, so plain pooled meshes are fine and easier to read.
import * as THREE from 'three';

export class Bullets {
  constructor(scene) {
    this.scene = scene;
    this.geometry = new THREE.CapsuleGeometry(0.22, 1.6, 2, 6);
    this.geometry.rotateX(Math.PI / 2); // lie along +z, the direction we fire in
    this.materials = {
      player: new THREE.MeshBasicMaterial({ color: 0x9ff3ff, toneMapped: false }),
      enemy: new THREE.MeshBasicMaterial({ color: 0xff5ae0, toneMapped: false }),
    };
    this.list = [];
  }

  fire(team, x, z, dirX, dirZ, { speed = 70, damage = 1, life = 1.1, scale = 1 } = {}) {
    let b = this.list.find((item) => !item.active && item.team === team);
    if (!b) {
      b = { team, mesh: new THREE.Mesh(this.geometry, this.materials[team]) };
      this.scene.add(b.mesh);
      this.list.push(b);
    }
    b.active = true;
    b.mesh.visible = true;
    b.mesh.position.set(x, 1.2, z);
    b.mesh.rotation.y = Math.atan2(dirX, dirZ); // point along the direction of travel
    b.mesh.scale.setScalar(scale);
    b.vx = dirX * speed;
    b.vz = dirZ * speed;
    b.damage = damage;
    b.life = life;
    b.radius = 0.5 * scale;
    return b;
  }

  kill(b) {
    b.active = false;
    b.mesh.visible = false;
  }

  update(dt) {
    for (const b of this.list) {
      if (!b.active) continue;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.z += b.vz * dt;
      b.life -= dt;
      if (b.life <= 0) this.kill(b);
    }
  }

  clear() {
    for (const b of this.list) this.kill(b);
  }
}
