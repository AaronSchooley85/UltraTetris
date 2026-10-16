// ============================================================================
// PROCEDURAL SYNTHWAVE SOUNDTRACK
// A look-ahead WebAudio sequencer with drums, sidechained bass + pads, a
// delayed arpeggiator and a lead synth. Sections alternate between an original
// progression and a synthwave arrangement of "Korobeiniki" (traditional
// Russian folk song, public domain — the classic Tetris theme).
// Layers fade in with `intensity` (0..1) driven by level, danger and combos.
// ============================================================================
import { audio } from './audio.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = {
  Am: { root: 45, pad: [57, 60, 64], arp: [69, 72, 76, 81] },
  E: { root: 40, pad: [56, 59, 64], arp: [68, 71, 76, 80] },
  F: { root: 41, pad: [57, 60, 65], arp: [69, 72, 77, 81] },
  C: { root: 36, pad: [55, 60, 64], arp: [67, 72, 76, 79] },
  G: { root: 43, pad: [55, 59, 62], arp: [67, 71, 74, 79] },
  Dm: { root: 38, pad: [57, 62, 65], arp: [69, 74, 77, 81] },
};

// Melodies: one array per bar of [midi | null, lengthInEighths]
const KOROBEINIKI = [
  [[76, 2], [71, 1], [72, 1], [74, 2], [72, 1], [71, 1]],
  [[69, 2], [69, 1], [72, 1], [76, 2], [74, 1], [72, 1]],
  [[71, 3], [72, 1], [74, 2], [76, 2]],
  [[72, 2], [69, 2], [69, 2], [null, 2]],
  [[null, 1], [74, 2], [77, 1], [81, 2], [79, 1], [77, 1]],
  [[76, 3], [72, 1], [76, 2], [74, 1], [72, 1]],
  [[71, 2], [71, 1], [72, 1], [74, 2], [76, 2]],
  [[72, 2], [69, 2], [69, 2], [null, 2]],
];

const SKYLINE = [
  [[72, 2], [77, 2], [76, 1], [72, 1], [69, 2]],
  [[71, 2], [74, 2], [79, 3], [null, 1]],
  [[76, 2], [72, 1], [69, 1], [76, 2], [81, 2]],
  [[79, 3], [76, 1], [72, 4]],
  [[77, 2], [76, 1], [74, 1], [72, 2], [69, 2]],
  [[71, 2], [74, 1], [76, 1], [79, 2], [74, 2]],
  [[76, 3], [75, 1], [76, 2], [80, 2]],
  [[83, 4], [80, 2], [76, 2]],
];

const SECTIONS = [
  { chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'], lead: null },
  { chords: ['E', 'Am', 'E', 'Am', 'Dm', 'C', 'E', 'Am'], lead: KOROBEINIKI },
  { chords: ['F', 'G', 'Am', 'Am', 'F', 'G', 'E', 'E'], lead: SKYLINE },
  { chords: ['E', 'Am', 'E', 'Am', 'Dm', 'C', 'E', 'Am'], lead: KOROBEINIKI, double: true },
];

// Pre-compute melody note-on events on a 16-step-per-bar grid.
function melodyEvents(melody) {
  if (!melody) return null;
  return melody.map((bar) => {
    const events = [];
    let step = 0;
    bar.forEach(([note, len]) => {
      if (note !== null) events.push({ step, note, steps: len * 2 });
      step += len * 2;
    });
    return events;
  });
}
SECTIONS.forEach((s) => (s.events = melodyEvents(s.lead)));

const BASS_PATTERN = [0, 0, 12, 0, 0, 12, 0, 12];
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];

export class Music {
  constructor() {
    this.running = false;
    this.intensity = 0.3;
    this.targetIntensity = 0.3;
    this.bpm = 112;
    this.tempoScale = 1;
    this.danger = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
  }

  _ensureGraph() {
    if (this.out || !audio.ctx) return;
    const ctx = audio.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(audio.musicBus);

    // Sidechain bus for bass and pads (ducked by the kick)
    this.duck = ctx.createGain();
    this.duck.connect(this.out);

    // Tempo-synced stereo-ish delay for arp + lead
    this.delay = ctx.createDelay(2.0);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.34;
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 2600;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0.32;
    this.delay.connect(this.delayTone);
    this.delayTone.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delayTone.connect(this.delayWet);
    this.delayWet.connect(this.out);

    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.55;
    this.verbSend.connect(audio.musicVerb);
  }

  stepDur() {
    return 60 / (this.bpm * this.tempoScale) / 4;
  }

  start() {
    if (!audio.ctx) return;
    this._ensureGraph();
    const t = audio.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(1, t, 0.4);
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.nextTime = t + 0.12;
    this.timer = setInterval(() => this._tick(), 25);
  }

  stop(fade = 1.2) {
    if (!this.running || !audio.ctx) return;
    const t = audio.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 4);
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  restart() {
    this.step = 0;
  }

  setIntensity(v) {
    this.targetIntensity = Math.max(0, Math.min(1, v));
  }

  _tick() {
    const ctx = audio.ctx;
    if (!ctx) return;
    // Recover gracefully after the tab was throttled.
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.05;
    this.intensity += (this.targetIntensity - this.intensity) * 0.08;
    this.delay.delayTime.setTargetAtTime(this.stepDur() * 3, ctx.currentTime, 0.1);
    while (this.nextTime < ctx.currentTime + 0.15) {
      this._schedule(this.step, this.nextTime);
      this.nextTime += this.stepDur();
      this.step++;
    }
  }

  _schedule(step, t) {
    const I = this.intensity;
    const sd = this.stepDur();
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const section = SECTIONS[Math.floor(bar / 8) % SECTIONS.length];
    const barIn = bar % 8;
    const chord = CHORDS[section.chords[barIn]];
    const lastBarOfPhrase = barIn === 7;

    // Pads — one sustained chord per bar
    if (s === 0) this._pad(t, chord.pad, sd * 16, 0.5 + I * 0.3);

    // Bass
    if (I >= 0.2) {
      if (I < 0.38) {
        if (s === 0) this._bass(t, chord.root, sd * 15, 0.7);
      } else if (s % 2 === 0) {
        const off = BASS_PATTERN[(s / 2) % 8];
        this._bass(t, chord.root + off, sd * 1.7, off ? 0.75 : 0.95);
      }
    }

    // Drums
    if (I >= 0.35) {
      const four = I >= 0.5;
      if (s % 4 === 0 && (four || s % 8 === 0)) this._kick(t);
      if (I >= 0.58 && (s === 4 || s === 12)) this._snare(t);
      if (I >= 0.58 && lastBarOfPhrase && s >= 12) this._snare(t, 0.6); // fill
      if (I >= 0.45) {
        if (this.danger || I >= 0.85) this._hat(t, false, s % 2 === 0 ? 0.9 : 0.5);
        else if (s % 4 === 2) this._hat(t, false, 0.8);
        if (I >= 0.7 && s === 14) this._hat(t, true, 0.6);
      }
    }

    // Arpeggiator
    if (I >= 0.28) {
      const idx = ARP_PATTERN[s];
      const oct = this.danger ? 12 : 0;
      this._arp(t, chord.arp[idx] + oct, sd * 0.9, s % 4 === 0 ? 1 : 0.7);
    }

    // Lead melody
    if (section.events && I >= 0.42) {
      const evts = section.events[barIn];
      for (const e of evts) {
        if (e.step !== s) continue;
        this._lead(t, e.note, sd * e.steps * 0.92, 1);
        if (section.double) this._lead(t, e.note - 12, sd * e.steps * 0.92, 0.7);
      }
    }
  }

  // ------------------------------------------------------------ instruments --
  _env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  _kick(t) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + 0.36);
    // Sidechain pump
    this.duck.gain.setValueAtTime(0.28, t);
    this.duck.gain.linearRampToValueAtTime(1.0, t + this.stepDur() * 3.2);
  }

  _noiseHit(t, type, freq, q, peak, dur, dest) {
    const ctx = audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
    return g;
  }

  _snare(t, vol = 1) {
    const g = this._noiseHit(t, 'bandpass', 1900, 0.7, 0.32 * vol, 0.2, this.out);
    g.connect(this.verbSend);
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og);
    og.connect(this.out);
    o.start(t);
    o.stop(t + 0.14);
  }

  _hat(t, open, vol = 1) {
    this._noiseHit(t, 'highpass', 7600, 0.6, (open ? 0.09 : 0.075) * vol, open ? 0.28 : 0.045, this.out);
  }

  _bass(t, midi, dur, vol) {
    const ctx = audio.ctx;
    const f = mtof(midi);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    o1.frequency.value = f;
    o2.frequency.value = f / 2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(260 + this.intensity * 900, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + Math.max(0.08, dur));
    const g = ctx.createGain();
    this._env(g, t, 0.16 * vol, 0.005, Math.max(0.01, dur - 0.06), 0.06);
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.duck);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
  }

  _pad(t, notes, dur, vol) {
    const ctx = audio.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + this.intensity * 1600;
    lp.Q.value = 0.6;
    const g = ctx.createGain();
    const attack = Math.min(0.6, dur * 0.25);
    this._env(g, t, 0.05 * vol, attack, Math.max(0.05, dur - attack - 0.1), 0.9);
    lp.connect(g);
    g.connect(this.duck);
    g.connect(this.verbSend);
    notes.forEach((m) => {
      [-9, 9].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = cents;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 1.1);
      });
    });
  }

  _arp(t, midi, dur, accent) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2800 + this.intensity * 2000, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.032 * accent, 0.003, 0.01, Math.max(0.05, dur));
    o.connect(lp);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  _lead(t, midi, dur, vol = 1) {
    const ctx = audio.ctx;
    const f = mtof(midi);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    o1.frequency.value = f;
    o2.frequency.value = f;
    o1.detune.value = -7;
    o2.detune.value = 7;
    // Delayed vibrato
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.35, dur));
    lfo.connect(lfoG);
    lfoG.connect(o1.frequency);
    lfoG.connect(o2.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    lp.Q.value = 1.5;
    const g = ctx.createGain();
    this._env(g, t, 0.065 * vol, 0.012, Math.max(0.02, dur - 0.1), 0.14);
    const mix2 = ctx.createGain();
    mix2.gain.value = 0.45;
    o1.connect(lp);
    o2.connect(mix2);
    mix2.connect(lp);
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    g.connect(this.verbSend);
    const end = t + dur + 0.25;
    [o1, o2, lfo].forEach((o) => {
      o.start(t);
      o.stop(end);
    });
  }
}

export const music = new Music();
