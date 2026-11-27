// Sound effects synthesised with Web Audio (no audio files).
// Browsers only allow audio after the player interacts, so start() runs on the first input.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastShot = 0;
  }

  start() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, len);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.45;
  }

  tone(f0, f1, dur, type = 'square', vol = 0.1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  noise(dur, f0, f1, vol = 0.4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur);
  }

  shoot() {
    // Rapid fire would stack dozens of sounds per second; cap it.
    if (!this.ctx || this.ctx.currentTime - this.lastShot < 0.05) return;
    this.lastShot = this.ctx.currentTime;
    this.tone(1400, 500, 0.07, 'square', 0.04);
  }
  enemyShoot() { this.tone(500, 180, 0.15, 'sawtooth', 0.05); }
  hit() { this.tone(300, 120, 0.06, 'square', 0.05); }
  explode() { this.noise(0.45, 3000, 120, 0.45); }
  bigExplode() { this.noise(1.2, 2500, 60, 0.8); this.tone(90, 30, 0.9, 'sine', 0.4); }
  hurt() { this.tone(220, 60, 0.3, 'sawtooth', 0.15); this.noise(0.2, 1500, 200, 0.3); }
  pickup() { this.tone(520, 1560, 0.18, 'triangle', 0.14); }
  wave() { this.tone(220, 440, 0.25, 'triangle', 0.12); setTimeout(() => this.tone(330, 660, 0.3, 'triangle', 0.12), 160); }
  alarm() { for (let i = 0; i < 3; i++) setTimeout(() => this.tone(700, 350, 0.25, 'square', 0.08), i * 300); }
}
