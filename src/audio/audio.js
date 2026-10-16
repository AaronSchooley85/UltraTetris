// ============================================================================
// PROCEDURAL AUDIO ENGINE — zero external assets.
// Master chain: [music bus → music filter] + [sfx bus] + [shared reverb]
//               → master gain → limiter → speakers
// ============================================================================
import { G } from '../state.js';

function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Slightly different noise per channel gives a wide stereo tail.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 5;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.22;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    // Shared reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 3.2, 2.6);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.42;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);

    // Music bus with a master low-pass (used by the Chrono Field effect)
    this.musicBus = ctx.createGain();
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicFilter.Q.value = 0.7;
    this.musicBus.connect(this.musicFilter);
    this.musicFilter.connect(this.master);
    this.musicVerb = ctx.createGain();
    this.musicVerb.gain.value = 1;
    this.musicVerb.connect(this.reverb);

    // SFX bus
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.sfxVerb = ctx.createGain();
    this.sfxVerb.gain.value = 1;
    this.sfxVerb.connect(this.reverb);

    // White noise source buffer reused by every noise voice
    const nlen = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    this._buildLoops();
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = G.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : s.masterVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.musicVolume * 0.62, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.sfxVerb.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
  }

  setChrono(active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.cancelScheduledValues(t);
    this.musicFilter.frequency.setTargetAtTime(active ? 650 : 20000, t, active ? 0.18 : 0.5);
  }

  // Distance + stereo pan relative to the camera for world-positioned sounds.
  spatial(pos) {
    const cam = G.camera;
    if (!pos || !cam) return { pan: 0, gain: 1 };
    const dx = pos.x - cam.position.x;
    const dy = pos.y - cam.position.y;
    const dz = pos.z - cam.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const e = cam.matrixWorld.elements; // column 0 = camera right
    const rx = e[0], ry = e[1], rz = e[2];
    const pan = dist > 0.001 ? Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / dist)) : 0;
    const gain = 1 / (1 + dist / 45);
    return { pan: pan * 0.85, gain: Math.max(0.12, gain) };
  }

  // ---------------------------------------------------------------- voices --
  _out(pan, verb) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let node = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    node.connect(this.sfxBus);
    if (verb > 0) {
      const send = ctx.createGain();
      send.gain.value = verb;
      node.connect(send);
      send.connect(this.sfxVerb);
    }
    return g;
  }

  tone({
    type = 'sine',
    f0 = 440,
    f1 = null,
    dur = 0.2,
    vol = 0.2,
    attack = 0.004,
    at = 0,
    pan = 0,
    verb = 0.15,
    curve = 'exp',
    detune = 0,
    filter = null,
  }) {
    if (!this.ctx) return;
    vol = Math.max(0.0002, vol);
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== null) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else osc.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    const env = this._out(pan, verb);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.f || 1000, t);
      if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, t + dur);
      f.Q.value = filter.q || 0.8;
      osc.connect(f);
      src = f;
    }
    src.connect(env);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.2, type = 'bandpass', f0 = 1000, f1 = null, q = 1, at = 0, pan = 0, verb = 0.15, attack = 0.005 }) {
    if (!this.ctx) return;
    vol = Math.max(0.0002, vol);
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const env = this._out(pan, verb);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  // ----------------------------------------------------------------- loops --
  _buildLoops() {
    const ctx = this.ctx;
    // Jetpack: filtered noise roar + low rumble oscillator
    const jn = ctx.createBufferSource();
    jn.buffer = this.noiseBuf;
    jn.loop = true;
    this.jetFilter = ctx.createBiquadFilter();
    this.jetFilter.type = 'bandpass';
    this.jetFilter.frequency.value = 260;
    this.jetFilter.Q.value = 1.4;
    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    jn.connect(this.jetFilter);
    this.jetFilter.connect(this.jetGain);
    this.jetGain.connect(this.sfxBus);
    jn.start();

    // Plasma tether hum: detuned saw pair through a resonant low-pass
    this.plasmaOsc1 = ctx.createOscillator();
    this.plasmaOsc2 = ctx.createOscillator();
    this.plasmaOsc1.type = 'sawtooth';
    this.plasmaOsc2.type = 'sawtooth';
    this.plasmaOsc1.frequency.value = 55;
    this.plasmaOsc2.frequency.value = 55.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    this.plasmaFilter = ctx.createBiquadFilter();
    this.plasmaFilter.type = 'lowpass';
    this.plasmaFilter.frequency.value = 520;
    this.plasmaFilter.Q.value = 6;
    lfo.connect(lfoGain);
    lfoGain.connect(this.plasmaFilter.frequency);
    this.plasmaGain = ctx.createGain();
    this.plasmaGain.gain.value = 0;
    this.plasmaOsc1.connect(this.plasmaFilter);
    this.plasmaOsc2.connect(this.plasmaFilter);
    this.plasmaFilter.connect(this.plasmaGain);
    this.plasmaGain.connect(this.sfxBus);
    this.plasmaOsc1.start();
    this.plasmaOsc2.start();
    lfo.start();
  }

  setJetpack(level, boost = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const l = Math.max(0, Math.min(1, level));
    this.jetGain.gain.setTargetAtTime(l * 0.16 + boost * 0.08, t, 0.06);
    this.jetFilter.frequency.setTargetAtTime(170 + l * 480 + boost * 500, t, 0.08);
  }

  setPlasma(active, tension = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.plasmaGain.gain.setTargetAtTime(active ? 0.075 : 0, t, 0.09);
    if (active) {
      const f = 55 + tension * 22;
      this.plasmaOsc1.frequency.setTargetAtTime(f, t, 0.08);
      this.plasmaOsc2.frequency.setTargetAtTime(f * 1.012, t, 0.08);
      this.plasmaFilter.frequency.setTargetAtTime(420 + tension * 260, t, 0.08);
    }
  }

  silenceLoops() {
    this.setJetpack(0);
    this.setPlasma(false);
  }

  // ------------------------------------------------------------------ SFX --
  shootBeacon(isSky) {
    this.tone({ type: 'sine', f0: isSky ? 1250 : 820, f1: isSky ? 330 : 210, dur: 0.18, vol: 0.2, verb: 0.2 });
    this.tone({ type: 'square', f0: isSky ? 2500 : 1650, f1: 600, dur: 0.06, vol: 0.05, verb: 0 });
    this.noise({ type: 'highpass', f0: 3000, dur: 0.05, vol: 0.06, verb: 0 });
  }

  beaconStick(isSky) {
    const freqs = isSky ? [587.33, 880, 1174.66] : [440, 659.25, 880];
    freqs.forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.24, vol: 0.11, at: i * 0.035, verb: 0.35 }));
  }

  plasmaEngage() {
    this.tone({ type: 'sawtooth', f0: 130, f1: 700, dur: 0.38, vol: 0.13, verb: 0.3, filter: { type: 'lowpass', f: 600, f1: 4000, q: 4 } });
    this.noise({ type: 'bandpass', f0: 400, f1: 3500, dur: 0.35, vol: 0.08, q: 2 });
  }

  torqueShoot() {
    this.tone({ type: 'sawtooth', f0: 540, f1: 120, dur: 0.24, vol: 0.14, verb: 0.15, filter: { type: 'lowpass', f: 3000, f1: 400 } });
    this.noise({ type: 'bandpass', f0: 2500, f1: 500, dur: 0.18, vol: 0.06, q: 3 });
  }

  torqueImpact(pos) {
    const { pan, gain } = this.spatial(pos);
    this.tone({ type: 'sine', f0: 170, f1: 40, dur: 0.5, vol: 0.32 * gain, pan, verb: 0.25 });
    this.tone({ type: 'triangle', f0: 420, f1: 260, dur: 0.35, vol: 0.09 * gain, pan, verb: 0.4 });
    this.noise({ type: 'bandpass', f0: 1800, f1: 600, dur: 0.25, vol: 0.08 * gain, q: 6, pan });
  }

  rotateDenied() {
    this.tone({ type: 'square', f0: 140, dur: 0.12, vol: 0.06, verb: 0 });
    this.tone({ type: 'square', f0: 110, dur: 0.12, vol: 0.06, at: 0.08, verb: 0 });
  }

  dash() {
    this.noise({ type: 'bandpass', f0: 300, f1: 2600, dur: 0.28, vol: 0.18, q: 1.2, verb: 0.1 });
    this.tone({ type: 'sine', f0: 90, f1: 180, dur: 0.2, vol: 0.12, verb: 0 });
  }

  land(pos, power = 1) {
    const { pan, gain } = this.spatial(pos);
    const v = Math.min(1.2, 0.55 + power * 0.5) * gain;
    this.tone({ type: 'sine', f0: 115, f1: 28, dur: 0.55, vol: 0.42 * v, pan, verb: 0.2 });
    this.noise({ type: 'lowpass', f0: 900, f1: 120, dur: 0.35, vol: 0.25 * v, pan, verb: 0.25 });
    this.tone({ type: 'triangle', f0: 220, f1: 180, dur: 0.12, vol: 0.06 * v, pan, verb: 0 });
  }

  lockClick() {
    this.tone({ type: 'square', f0: 1800, f1: 900, dur: 0.04, vol: 0.05, verb: 0 });
  }

  lineCharge(count) {
    const top = 900 + count * 260;
    this.tone({ type: 'sawtooth', f0: 180, f1: top, dur: 0.34, vol: 0.09, verb: 0.3, filter: { type: 'lowpass', f: 800, f1: 6000, q: 6 } });
    this.noise({ type: 'highpass', f0: 1500, f1: 8000, dur: 0.34, vol: 0.05, verb: 0.2 });
  }

  lineClear(count) {
    const base = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093.0];
    const n = Math.min(base.length, 3 + count);
    const mult = 1 + Math.min(4, count - 1) * 0.0595 * 2; // rises a whole tone per extra line
    for (let i = 0; i < n; i++) {
      this.tone({ type: 'triangle', f0: base[i] * mult, dur: 0.55, vol: 0.13, at: i * 0.05, verb: 0.45 });
      this.tone({ type: 'sine', f0: base[i] * mult * 2, dur: 0.4, vol: 0.04, at: i * 0.05 + 0.01, verb: 0.5 });
    }
    this.noise({ type: 'highpass', f0: 5000, f1: 9000, dur: 0.6, vol: 0.06, verb: 0.6 });
    this.tone({ type: 'sine', f0: 80, f1: 35, dur: 0.6, vol: 0.25, verb: 0.1 });
  }

  chain(n) {
    const f = 880 * Math.pow(1.122, Math.min(8, n));
    this.tone({ type: 'sine', f0: f, dur: 0.6, vol: 0.13, verb: 0.6 });
    this.tone({ type: 'sine', f0: f * 1.5, dur: 0.6, vol: 0.08, at: 0.06, verb: 0.6 });
    this.tone({ type: 'triangle', f0: f * 2, dur: 0.5, vol: 0.05, at: 0.12, verb: 0.6 });
  }

  combo(n) {
    const f = 660 * Math.pow(1.0595, Math.min(14, n * 2));
    this.tone({ type: 'square', f0: f, dur: 0.12, vol: 0.05, verb: 0.3, filter: { type: 'lowpass', f: 3000 } });
    this.tone({ type: 'square', f0: f * 1.335, dur: 0.14, vol: 0.05, at: 0.06, verb: 0.3, filter: { type: 'lowpass', f: 3000 } });
  }

  levelUp() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone({ type: 'sawtooth', f0: f, dur: 0.4, vol: 0.07, at: i * 0.08, verb: 0.5, filter: { type: 'lowpass', f: 2600 } });
      this.tone({ type: 'triangle', f0: f / 2, dur: 0.5, vol: 0.08, at: i * 0.08, verb: 0.4 });
    });
    this.noise({ type: 'highpass', f0: 4000, f1: 10000, dur: 1.0, vol: 0.05, at: 0.3, verb: 0.7 });
  }

  explosion(pos, size = 1) {
    const { pan, gain } = this.spatial(pos);
    const v = gain * Math.min(1.3, size);
    this.noise({ type: 'lowpass', f0: 3200, f1: 60, dur: 1.3, vol: 0.45 * v, q: 0.7, pan, verb: 0.4, attack: 0.002 });
    this.tone({ type: 'sine', f0: 72, f1: 22, dur: 1.1, vol: 0.5 * v, pan, verb: 0.1 });
    this.tone({ type: 'sawtooth', f0: 160, f1: 30, dur: 0.6, vol: 0.12 * v, pan, verb: 0.3, filter: { type: 'lowpass', f: 900, f1: 100 } });
  }

  laser() {
    this.tone({ type: 'sawtooth', f0: 2400, f1: 180, dur: 0.6, vol: 0.14, verb: 0.35, filter: { type: 'bandpass', f: 3000, f1: 400, q: 3 } });
    this.tone({ type: 'square', f0: 110, f1: 55, dur: 0.7, vol: 0.12, verb: 0.2, filter: { type: 'lowpass', f: 1200 } });
    this.noise({ type: 'highpass', f0: 6000, f1: 2000, dur: 0.5, vol: 0.08, verb: 0.3 });
  }

  quake() {
    this.noise({ type: 'lowpass', f0: 220, f1: 60, dur: 2.4, vol: 0.5, q: 1.5, verb: 0.3, attack: 0.15 });
    this.tone({ type: 'sine', f0: 48, f1: 30, dur: 2.2, vol: 0.4, verb: 0.1, attack: 0.1 });
    for (let i = 0; i < 6; i++) {
      this.noise({ type: 'bandpass', f0: 300 + Math.random() * 300, dur: 0.25, vol: 0.12, q: 2, at: 0.2 + i * 0.3 + Math.random() * 0.1, verb: 0.3 });
    }
  }

  chronoOn() {
    this.tone({ type: 'sawtooth', f0: 900, f1: 70, dur: 0.9, vol: 0.12, verb: 0.5, filter: { type: 'lowpass', f: 3000, f1: 300 } });
    this.tone({ type: 'sine', f0: 1760, f1: 220, dur: 1.1, vol: 0.06, verb: 0.8 });
  }

  chronoOff() {
    this.tone({ type: 'sawtooth', f0: 70, f1: 900, dur: 0.6, vol: 0.1, verb: 0.4, filter: { type: 'lowpass', f: 300, f1: 3000 } });
  }

  overdriveOn() {
    this.tone({ type: 'sawtooth', f0: 110, f1: 880, dur: 0.7, vol: 0.12, verb: 0.3, filter: { type: 'lowpass', f: 500, f1: 6000, q: 5 } });
    [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.25, vol: 0.05, at: 0.35 + i * 0.06, verb: 0.4, filter: { type: 'lowpass', f: 3500 } }));
  }

  nanoMorph() {
    [1046.5, 1318.5, 1567.98, 2093, 2637].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.1, vol: 0.05, at: i * 0.04, verb: 0.4, filter: { type: 'lowpass', f: 5000 } }));
    this.noise({ type: 'highpass', f0: 6000, dur: 0.3, vol: 0.05, verb: 0.4 });
  }

  oracle() {
    [220, 330, 440, 659.25, 880].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 1.4, vol: 0.06, at: i * 0.07, verb: 0.8, attack: 0.08 }));
    this.noise({ type: 'bandpass', f0: 2000, f1: 6000, dur: 1.2, vol: 0.04, q: 8, verb: 0.8 });
  }

  pickup() {
    [880, 1318.5, 1760, 2637].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.28, vol: 0.11, at: i * 0.05, verb: 0.5 }));
    this.tone({ type: 'triangle', f0: 440, f1: 1760, dur: 0.25, vol: 0.06, verb: 0.3 });
  }

  powerupUse(color = 0) {
    this.tone({ type: 'sawtooth', f0: 220, f1: 1320, dur: 0.3, vol: 0.09, verb: 0.35, filter: { type: 'lowpass', f: 1200, f1: 6000, q: 3 } });
    this.tone({ type: 'sine', f0: 1320, dur: 0.35, vol: 0.06, at: 0.2, verb: 0.5 });
  }

  weaponArmed() {
    this.tone({ type: 'square', f0: 330, f1: 990, dur: 0.18, vol: 0.06, verb: 0.2, filter: { type: 'lowpass', f: 2500 } });
    this.tone({ type: 'square', f0: 990, dur: 0.08, vol: 0.05, at: 0.2, verb: 0.2, filter: { type: 'lowpass', f: 2500 } });
  }

  invFull() {
    this.tone({ type: 'square', f0: 220, dur: 0.1, vol: 0.06, verb: 0 });
    this.tone({ type: 'square', f0: 220, dur: 0.1, vol: 0.06, at: 0.14, verb: 0 });
  }

  holdSwap() {
    this.noise({ type: 'bandpass', f0: 2500, f1: 500, dur: 0.18, vol: 0.08, q: 2 });
    this.tone({ type: 'triangle', f0: 660, f1: 990, dur: 0.12, vol: 0.08, verb: 0.2 });
  }

  hardDrop() {
    this.noise({ type: 'bandpass', f0: 3200, f1: 180, dur: 0.5, vol: 0.16, q: 1.5, verb: 0.2 });
    this.tone({ type: 'sawtooth', f0: 600, f1: 60, dur: 0.45, vol: 0.07, verb: 0.2, filter: { type: 'lowpass', f: 2000, f1: 200 } });
  }

  danger() {
    this.tone({ type: 'square', f0: 880, dur: 0.12, vol: 0.05, verb: 0.2, filter: { type: 'lowpass', f: 2200 } });
    this.tone({ type: 'square', f0: 660, dur: 0.12, vol: 0.05, at: 0.14, verb: 0.2, filter: { type: 'lowpass', f: 2200 } });
  }

  tick(urgent = false) {
    this.tone({ type: 'sine', f0: urgent ? 1400 : 1000, dur: 0.06, vol: urgent ? 0.12 : 0.06, verb: 0.1 });
  }

  orbSpawn(pos) {
    const { pan, gain } = this.spatial(pos);
    this.tone({ type: 'sine', f0: 1318.5, dur: 0.6, vol: 0.06 * gain + 0.02, pan, verb: 0.7 });
    this.tone({ type: 'sine', f0: 1975.5, dur: 0.6, vol: 0.04 * gain + 0.01, at: 0.08, pan, verb: 0.7 });
  }

  crushed() {
    this.tone({ type: 'sawtooth', f0: 200, f1: 60, dur: 0.3, vol: 0.12, verb: 0.2, filter: { type: 'lowpass', f: 1200 } });
    this.noise({ type: 'lowpass', f0: 1200, f1: 200, dur: 0.3, vol: 0.15 });
  }

  gameOver() {
    const notes = [392.0, 349.23, 311.13, 261.63, 196.0];
    notes.forEach((f, i) => {
      this.tone({ type: 'sawtooth', f0: f, f1: f * 0.85, dur: 0.5, vol: 0.12, at: i * 0.2, verb: 0.5, filter: { type: 'lowpass', f: 1800 } });
    });
    this.noise({ type: 'lowpass', f0: 400, f1: 40, dur: 2.5, vol: 0.3, verb: 0.4, attack: 0.3 });
  }

  victory() {
    const seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    seq.forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.22, vol: 0.06, at: i * 0.11, verb: 0.4, filter: { type: 'lowpass', f: 3000 } }));
  }

  uiHover() {
    this.tone({ type: 'sine', f0: 1600, dur: 0.04, vol: 0.025, verb: 0 });
  }

  uiClick() {
    this.tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.08, vol: 0.07, verb: 0.15 });
  }
}

export const audio = new AudioEngine();
