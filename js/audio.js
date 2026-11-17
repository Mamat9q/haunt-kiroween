// audio.js — WebAudio ambience for HAUNT. No audio files: wind is filtered
// noise, creaks are detuned oscillators, heartbeat is a sine thump whose rate
// tracks Warden distance. AudioContext is created only after user interaction.
// Safe to import in Node: every method no-ops when WebAudio is unavailable.

export class HauntAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.muted = false;
    this.started = false;
    this.danger = 0; // 0..1 — heartbeat intensity from Warden proximity
    this.heartTimer = null;
    this.creakTimer = null;
  }

  get supported() {
    return typeof window !== 'undefined'
      && (typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined');
  }

  /** Create/resume the context. Call from a user gesture (click / keypress). */
  ensure() {
    if (!this.supported || this.ctx) {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
      return !!this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    return true;
  }

  /** Start wind + scheduled creaks. Idempotent; safe to call repeatedly. */
  start() {
    if (!this.ensure() || this.started) return;
    this.started = true;
    this.startWind();
    this.creakTimer = setInterval(() => this.creak(), 9000 + Math.random() * 14000);
    this.heartTimer = setInterval(() => this.thump(), 500);
  }

  startWind() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish noise
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.12;
    // Slow swell: wind breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain);
    lfoGain.connect(this.windGain.gain);
    src.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.master);
    src.start();
    lfo.start();
  }

  /** One distant creak: two detuned saws gliding down, very quiet. */
  creak() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90 + Math.random() * 60, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 1.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 300;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 1.6);
  }

  /** Heartbeat thump; called on a timer, rate/intensity follow this.danger. */
  thump() {
    if (!this.ctx || this.muted || this.danger <= 0.03) return;
    const ctx = this.ctx;
    const interval = 1.15 - this.danger * 0.65; // faster when danger is high
    if (Math.random() > this.danger * 1.6) return; // sparse when far away
    const t = ctx.currentTime;
    for (const [offset, vol] of [[0, 0.5], [0.16, 0.28]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(58, t + offset);
      osc.frequency.exponentialRampToValueAtTime(34, t + offset + 0.14);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t + offset);
      gain.gain.exponentialRampToValueAtTime(vol * this.danger, t + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t + offset);
      osc.stop(t + offset + 0.22);
    }
    void interval;
  }

  /** Short dissonant sting for scare / contact events. */
  sting() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [220, 233, 311].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 1);
    });
  }

  /** 0..1 — set from Warden distance each frame by the game loop. */
  setDanger(level) {
    this.danger = Math.max(0, Math.min(1, level));
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  stop() {
    if (this.creakTimer) clearInterval(this.creakTimer);
    if (this.heartTimer) clearInterval(this.heartTimer);
    this.creakTimer = this.heartTimer = null;
    this.started = false;
    if (this.ctx) void this.ctx.suspend();
  }
}
