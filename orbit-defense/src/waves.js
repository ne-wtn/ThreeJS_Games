// The wave director: decides WHAT spawns, WHEN and WHERE.
//
// LESSON: a "budget" system. Each wave gets points to spend (more every wave), and each
// enemy has a cost. The director buys a random mix of the enemies unlocked so far. This
// scales difficulty smoothly and keeps every wave a little different.
// Every 5th wave is a boss wave.
import * as THREE from 'three';

const COST = { interceptor: 1, mine: 1, raider: 3, asteroidL: 2 };
const UNLOCK = { interceptor: 1, asteroidL: 1, mine: 3, raider: 2 }; // first wave each appears
const BREAK = 3.5; // seconds between waves

export class WaveDirector {
  constructor(w) {
    this.w = w;
  }

  reset() {
    this.wave = 0;
    this.queue = [];
    this.breakLeft = 1.5;
    this.spawnTimer = 0;
  }

  startWave() {
    this.wave++;
    const n = this.wave;
    const boss = n % 5 === 0;
    let budget = boss ? 4 + n : 5 + n * 3;
    const options = Object.keys(COST).filter((k) => n >= UNLOCK[k]);
    this.queue = [];
    while (budget > 0) {
      const pick = options[Math.floor(Math.random() * options.length)];
      if (COST[pick] > budget) continue; // too expensive: roll again (interceptors cost 1, so this ends)
      budget -= COST[pick];
      this.queue.push(pick);
    }
    if (boss) this.queue.unshift('bomber');
    this.spawnInterval = Math.max(0.35, 1.1 - n * 0.06);
    this.w.announce(boss ? `Wave ${n} · Boss` : `Wave ${n}`, boss);
  }

  update(dt) {
    const w = this.w;
    if (this.queue.length === 0 && w.enemies.count === 0) {
      // Wave cleared (or not started): count down the break, then go.
      if (this.breakLeft <= 0) {
        this.breakLeft = BREAK;
        if (this.wave > 0) w.waveCleared(this.wave);
      }
      this.breakLeft -= dt;
      if (this.breakLeft <= 0) this.startWave();
      return;
    }

    this.spawnTimer -= dt;
    if (this.queue.length && this.spawnTimer <= 0) {
      this.spawnTimer = this.spawnInterval;
      this.spawnOne(this.queue.shift());
    }
  }

  spawnOne(type) {
    const w = this.w;
    const angle = Math.random() * Math.PI * 2;
    if (type === 'asteroidL') {
      // Rocks start outside the arena and fly THROUGH it, aimed near (not at) the centre.
      const r = w.arenaRadius + 25;
      const start = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      const aim = new THREE.Vector3((Math.random() - 0.5) * 50, 0, (Math.random() - 0.5) * 50);
      const vel = aim.sub(start).setLength(5 + Math.random() * 3);
      w.enemies.spawn(type, start.x, start.z, vel);
    } else {
      const r = w.arenaRadius + 8;
      w.enemies.spawn(type, Math.cos(angle) * r, Math.sin(angle) * r);
    }
  }
}
