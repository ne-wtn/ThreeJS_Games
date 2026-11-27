// Game feel: screen shake + hit-stop (from the `game-feel` skill).
//
// SHAKE: events add "trauma" (0..1); the camera offset is trauma squared, so big hits
// punch and small ones barely register. Trauma drains in REAL time.
//
// HIT-STOP: on a big impact, the game nearly freezes for a few hundredths of a second.
// Your brain reads that pause as weight. We do it by scaling the game's dt, and we count
// the stop down in REAL time, or the timer itself would be frozen and never finish.
export class Feel {
  constructor() {
    this.trauma = 0;
    this.t = 0;
    this.offsetX = 0;
    this.offsetZ = 0;
    this.timeScale = 1;
    this.stopLeft = 0;
    this.shakeStrength = 1; // accessibility: set to 0 to turn shake off
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Freeze-frame. An overlapping shorter stop does not cut a longer one short. */
  hitStop(seconds, slow = 0.05) {
    if (seconds <= this.stopLeft) return;
    this.stopLeft = seconds;
    this.timeScale = slow;
  }

  update(realDt) {
    if (this.stopLeft > 0) {
      this.stopLeft -= realDt;
      if (this.stopLeft <= 0) {
        this.stopLeft = 0;
        this.timeScale = 1; // always snap back to exactly 1
      }
    }
    this.trauma = Math.max(0, this.trauma - 1.3 * realDt);
    const s = this.trauma * this.trauma * this.shakeStrength * 2.2;
    this.t += realDt * 32;
    this.offsetX = s * Math.sin(this.t * 1.7);
    this.offsetZ = s * Math.sin(this.t * 2.3);
  }
}
