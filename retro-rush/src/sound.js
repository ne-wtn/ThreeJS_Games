// Tiny synthesiser: every sound is made in code with the Web Audio API, so the game
// needs no audio files.
//
// LESSON: browsers block audio until the player interacts with the page. That is why
// `start()` is called from a key press or tap, never on page load.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // Engine: a low sawtooth through a low-pass filter. Its pitch follows the speed.
    this.engine = this.ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 50;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engine.start();

    // One second of white noise, reused by crash and whoosh sounds.
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** speed in m/s; `on` false silences the engine (menus, after a crash). */
  setEngine(speed, on, boosting) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.engine.frequency.setTargetAtTime(38 + speed * 2.1 + (boosting ? 25 : 0), now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(boosting ? 1400 : 500, now, 0.1);
    this.engineGain.gain.setTargetAtTime(on ? 0.06 : 0, now, 0.15);
  }

  // A short pitched beep that slides from f0 to f1.
  blip(f0, f1, dur = 0.12, type = 'square', vol = 0.12) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  // Filtered noise burst: crashes, whooshes.
  noise(dur, freq, vol = 0.4, sweepTo = freq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  laneChange() { this.noise(0.12, 2500, 0.08, 900); }
  nearMiss() { this.noise(0.35, 600, 0.35, 3000); this.blip(660, 1320, 0.15, 'triangle', 0.1); }
  crash() { this.noise(0.9, 900, 0.9, 120); this.blip(120, 40, 0.5, 'sawtooth', 0.25); }
  start_beep() { this.blip(440, 880, 0.18, 'square', 0.1); }
}
