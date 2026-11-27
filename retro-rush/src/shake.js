// Trauma-based screen shake (from the `game-feel` skill).
//
// LESSON: events ADD trauma (0..1). Trauma drains over real time. The shake you see
// is trauma SQUARED, so small bumps barely move the camera and big crashes really punch.
// We use summed sine waves instead of Math.random() every frame: random offsets
// look like static, sines look like a camera being knocked about.
export class Shake {
  constructor({ decay = 1.4, maxOffset = 0.6, maxRoll = 0.05 } = {}) {
    this.decay = decay;
    this.maxOffset = maxOffset;
    this.maxRoll = maxRoll;
    this.strength = 1; // a player setting: 0 turns shake off
    this.trauma = 0;
    this.t = 0;
    this.x = 0;
    this.y = 0;
    this.roll = 0;
  }

  add(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Call once per frame with REAL (unscaled) seconds, so shake still decays during slow-mo. */
  update(realDt) {
    this.trauma = Math.max(0, this.trauma - this.decay * realDt);
    const s = this.trauma * this.trauma * this.strength;
    this.t += realDt * 30;
    this.x = this.maxOffset * s * Math.sin(this.t * 1.7);
    this.y = this.maxOffset * s * Math.sin(this.t * 2.3);
    this.roll = this.maxRoll * s * Math.sin(this.t * 1.1);
  }
}
