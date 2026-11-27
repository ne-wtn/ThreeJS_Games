// The 3D view of a character (the knight or a monster): skinned model, animation, tweens.
//
// LESSONS (threejs-gltf-loading skill):
//  1. Skinned characters must be cloned with SkeletonUtils.clone(). A plain .clone()
//     shares one skeleton, so every goblin would move as one.
//  2. One AnimationMixer per character. Clips (Idle, Walk, Run) come from the GLB.
//     Cross-fading between them avoids snapping from one pose to another.
//  3. Logic vs view: the game rules move a monster from cell to cell INSTANTLY.
//     This class then glides the model there over a fraction of a second.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const easeOut = (t) => 1 - (1 - t) * (1 - t);

export class ActorView {
  constructor(parent, model, scale = 1) {
    this.root = new THREE.Group();   // position + facing
    this.body = skeletonClone(model.scene); // the animated character inside
    this.body.scale.setScalar(scale);
    this.root.add(this.body);
    parent.add(this.root);

    // Own materials, so a red hurt-flash only affects this character.
    this.materials = [];
    this.body.traverse((n) => {
      if (!n.isMesh) return;
      n.material = n.material.clone();
      this.materials.push(n.material);
    });

    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = Object.fromEntries(model.animations.map((clip) => [clip.name, this.mixer.clipAction(clip)]));
    this.current = null;
    this.play('Idle');
    this.mixer.setTime(Math.random() * 2); // idle out of sync

    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.moveT = 1;
    this.moveDuration = 0.16;
    this.lungeT = 1;
    this.lungeDir = new THREE.Vector3();
    this.hurt = 0;
    this.dying = false;
    this.deathT = 0;
    this.done = false; // true once the death animation finished
  }

  play(name, fade = 0.15) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().play();
    if (this.current) this.current.crossFadeTo(next, fade, false);
    this.current = next;
  }

  place(pos) {
    this.root.position.copy(pos);
    this.to.copy(pos);
    this.moveT = 1;
  }

  face(dx, dz) {
    if (dx || dz) this.root.rotation.y = Math.atan2(dx, dz);
  }

  moveTo(pos) {
    this.from.copy(this.root.position);
    this.to.copy(pos);
    this.face(pos.x - this.from.x, pos.z - this.from.z);
    this.moveT = 0;
    this.play('Walk', 0.08);
  }

  lunge(dx, dz) {
    this.face(dx, dz);
    this.lungeDir.set(dx, 0, dz).normalize();
    this.lungeT = 0;
  }

  flashHurt() { this.hurt = 1; }

  die() {
    this.dying = true;
    this.deathT = 0;
  }

  update(dt) {
    this.mixer.update(dt);

    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / this.moveDuration);
      this.root.position.lerpVectors(this.from, this.to, easeOut(this.moveT));
      if (this.moveT === 1) this.play('Idle', 0.25);
    }

    // Lunge: jab forward and back along a sine curve (0 -> 1 -> 0).
    if (this.lungeT < 1) {
      this.lungeT = Math.min(1, this.lungeT + dt / 0.22);
      const k = Math.sin(this.lungeT * Math.PI) * 0.7;
      this.body.position.set(0, 0, k); // local +z is "forward" for these models
    }

    if (this.hurt > 0) {
      this.hurt = Math.max(0, this.hurt - dt * 5);
      for (const m of this.materials) {
        if (!m.emissive) continue;
        m.emissive.setRGB(1, 0.1, 0.05);
        m.emissiveIntensity = this.hurt;
      }
    }

    if (this.dying) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.35);
      this.body.rotation.x = -k * (Math.PI / 2) * 0.95; // topple backwards
      this.body.position.y = -Math.max(0, this.deathT - 0.6) * 1.5; // then sink away
      if (this.deathT > 1.4) {
        this.done = true;
        this.root.removeFromParent();
      }
    }
  }
}
