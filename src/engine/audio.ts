/**
 * Procedural audio: every SFX and the adaptive BGM are synthesized with Web Audio.
 * No audio files → tiny bundle, instant load, and pitch/intensity can follow gameplay.
 */
import { store } from '../core/store';

const PENTA = [0, 2, 4, 7, 9]; // C major pentatonic — instantly "Chinese" flavoured
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const pentaNote = (base: number, idx: number) =>
  base + PENTA[((idx % 5) + 5) % 5] + 12 * Math.floor(idx / 5);

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private rev!: GainNode;
  private noiseBuf!: AudioBuffer;

  // music sequencer
  private musicOn = false;
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private bpm = 104;
  /** 0 calm … 4 max; drives which layers play */
  intensity = 0;
  private feverOn = false;

  /** Must be called from a user gesture (iOS/Chrome autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = store.settings.sound ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2400;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.34;
    this.musicBus.connect(this.musicFilter).connect(this.master);

    // cheap generated reverb
    const len = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.rev = ctx.createGain();
    this.rev.gain.value = 0.28;
    this.rev.connect(conv).connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  setMuted(muted: boolean) {
    store.settings.sound = !muted;
    store.save();
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private get now() {
    return this.ctx!.currentTime;
  }

  // ------------------------------------------------------------------ primitives
  private tone(
    freq: number,
    dur: number,
    { type = 'sine' as OscillatorType, vol = 0.3, at = 0, glide = 0, attack = 0.004, bus = this.sfxBus, rev = 0 } = {},
  ) {
    const ctx = this.ctx!;
    const t = this.now + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    if (rev) {
      const s = ctx.createGain();
      s.gain.value = rev;
      g.connect(s).connect(this.rev);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dur: number,
    { freq = 2000, q = 1, type = 'bandpass' as BiquadFilterType, vol = 0.3, at = 0, sweep = 0, bus = this.sfxBus } = {},
  ) {
    const ctx = this.ctx!;
    const t = this.now + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** plucked guzheng-ish note */
  private pluck(freq: number, at = 0, vol = 0.22, bus = this.sfxBus, dur = 0.5) {
    this.tone(freq, dur, { type: 'triangle', vol, at, bus, rev: 0.4 });
    this.tone(freq * 2, dur * 0.4, { type: 'sine', vol: vol * 0.35, at, bus });
    this.tone(freq * 1.004, 0.03, { type: 'square', vol: vol * 0.25, at, bus });
  }

  private get ok() {
    return !!this.ctx && store.settings.sound;
  }

  // ------------------------------------------------------------------ SFX
  click() {
    if (!this.ok) return;
    this.tone(900, 0.06, { type: 'square', vol: 0.08, glide: 500 });
  }
  pop(pitch = 1) {
    if (!this.ok) return;
    this.tone(420 * pitch, 0.12, { type: 'sine', vol: 0.3, glide: 900 * pitch });
  }
  whoosh() {
    if (!this.ok) return;
    this.noise(0.35, { freq: 400, sweep: 3200, q: 0.8, vol: 0.22 });
  }
  swoosh() {
    if (!this.ok) return;
    this.noise(0.25, { freq: 3000, sweep: 500, q: 1.2, vol: 0.18 });
  }
  /** rising arpeggio whose root climbs with combo */
  correct(combo: number) {
    if (!this.ok) return;
    const base = 72 + Math.min(combo, 15);
    [0, 1, 2, 3].forEach((i) => this.pluck(midiHz(pentaNote(base, i * 1 + (i > 1 ? 1 : 0))), i * 0.055, 0.2));
    this.tone(midiHz(base + 24), 0.5, { type: 'sine', vol: 0.08, at: 0.2, rev: 0.6 });
  }
  coin(i = 0) {
    if (!this.ok) return;
    const f = 1800 + (i % 6) * 140 + Math.random() * 60;
    this.tone(f, 0.12, { type: 'square', vol: 0.045 });
    this.tone(f * 1.5, 0.22, { type: 'sine', vol: 0.06, at: 0.04, rev: 0.3 });
  }
  wrong() {
    if (!this.ok) return;
    this.tone(220, 0.35, { type: 'sawtooth', vol: 0.16, glide: 110 });
    this.tone(233, 0.35, { type: 'square', vol: 0.08, glide: 104 });
    this.boom(0.5);
  }
  boom(vol = 0.9) {
    if (!this.ok) return;
    this.tone(150, 0.4, { type: 'sine', vol: vol * 0.7, glide: 40 });
    this.noise(0.25, { freq: 900, type: 'lowpass', vol: vol * 0.35 });
  }
  heartbreak() {
    if (!this.ok) return;
    this.tone(660, 0.12, { type: 'triangle', vol: 0.18 });
    this.tone(494, 0.14, { type: 'triangle', vol: 0.18, at: 0.1 });
    this.noise(0.2, { freq: 5000, q: 3, vol: 0.12, at: 0.08 });
  }
  tick(urgent = false) {
    if (!this.ok) return;
    this.tone(urgent ? 1500 : 1100, 0.05, { type: 'square', vol: 0.06 });
  }
  firecracker(n = 6) {
    if (!this.ok) return;
    for (let i = 0; i < n; i++) {
      const at = i * 0.06 + Math.random() * 0.04;
      this.noise(0.08, { freq: 1500 + Math.random() * 3000, q: 0.7, vol: 0.28, at });
      this.tone(90, 0.08, { type: 'sine', vol: 0.3, at, glide: 40 });
    }
  }
  gong() {
    if (!this.ok) return;
    [1, 1.48, 2.02, 2.74, 3.3].forEach((m, i) =>
      this.tone(110 * m, 2.4 - i * 0.3, { type: 'sine', vol: 0.18 / (i + 1), attack: 0.01, glide: 110 * m * 0.985, rev: 0.7 }),
    );
    this.noise(0.4, { freq: 600, q: 0.5, vol: 0.12 });
  }
  drum(at = 0, vol = 0.6) {
    if (!this.ok) return;
    this.tone(120, 0.25, { type: 'sine', vol, at, glide: 50 });
    this.noise(0.1, { freq: 300, type: 'lowpass', vol: vol * 0.4, at });
  }
  countdown(n: number) {
    if (!this.ok) return;
    if (n > 0) {
      this.drum(0, 0.7);
      this.tone(n === 1 ? 880 : 660, 0.18, { type: 'triangle', vol: 0.2 });
    } else {
      this.gong();
      this.fanfare();
    }
  }
  fanfare() {
    if (!this.ok) return;
    [0, 2, 4, 5, 7].forEach((idx, i) => this.pluck(midiHz(pentaNote(67, idx)), i * 0.07, 0.22));
  }
  stageUp(stage: number) {
    if (!this.ok) return;
    for (let i = 0; i < 6; i++) this.pluck(midiHz(pentaNote(64 + stage * 2, i)), i * 0.045, 0.18);
    this.firecracker(4 + stage);
  }
  fever() {
    if (!this.ok) return;
    this.noise(0.9, { freq: 200, sweep: 6000, q: 1.5, vol: 0.25 });
    this.gong();
    this.firecracker(10);
  }
  star(i: number) {
    if (!this.ok) return;
    this.boom(0.7);
    this.pluck(midiHz(pentaNote(72, i * 2)), 0, 0.3, this.sfxBus, 0.9);
  }
  gameOver() {
    if (!this.ok) return;
    [67, 66, 65, 62].forEach((m, i) => this.tone(midiHz(m), i === 3 ? 0.8 : 0.3, { type: 'triangle', vol: 0.2, at: i * 0.28 }));
  }
  newBest() {
    if (!this.ok) return;
    this.fanfare();
    [0, 4, 7, 12].forEach((s, i) => this.tone(midiHz(72 + s), 0.9, { type: 'triangle', vol: 0.12, at: 0.35 + i * 0.02, rev: 0.6 }));
    this.firecracker(12);
  }

  // ------------------------------------------------------------------ vault (gacha)
  /** temple bell: inharmonic partials, long ring */
  bell(freq: number, at = 0, vol = 0.16) {
    if (!this.ok) return;
    [1, 2.76, 5.4, 8.93].forEach((m, i) =>
      this.tone(freq * m, 1.8 - i * 0.35, { type: 'sine', vol: vol / (i * 1.6 + 1), at, attack: 0.002, rev: 0.7 }),
    );
  }
  /** wooden doors rattling against their latch */
  rattle(n = 5) {
    if (!this.ok) return;
    for (let i = 0; i < n; i++) {
      const at = i * 0.075 + Math.random() * 0.02;
      this.noise(0.06, { freq: 380 + Math.random() * 200, q: 4, vol: 0.32, at });
      this.tone(170 + Math.random() * 40, 0.07, { type: 'triangle', vol: 0.18, at, glide: 90 });
    }
  }
  /** rising wind + tone while the vault charges */
  charge(dur = 1.4) {
    if (!this.ok) return;
    this.noise(dur, { freq: 180, sweep: 5200, q: 2.2, vol: 0.2 });
    this.tone(160, dur, { type: 'sawtooth', vol: 0.05, glide: 720, attack: dur * 0.6 });
  }
  /** one step of the rarity escalation */
  rarityStep(i: number) {
    if (!this.ok) return;
    this.bell(midiHz(pentaNote(69, i * 2 + 2)), 0, 0.14 + i * 0.03);
    this.noise(0.25, { freq: 6000, q: 2, vol: 0.06 + i * 0.02 });
  }
  vaultOpen(best: number) {
    if (!this.ok) return;
    this.boom(1);
    this.noise(0.9, { freq: 9000, sweep: 1200, q: 0.7, vol: 0.14 });
    if (best >= 3) this.gong();
    this.firecracker(4 + best * 2);
  }
  /** card lands face up; grander the rarer */
  reveal(r: number) {
    if (!this.ok) return;
    const root = 67 + r * 2;
    const n = 3 + r;
    for (let i = 0; i < n; i++) this.pluck(midiHz(pentaNote(root, i + (i > 2 ? 1 : 0))), i * 0.05, 0.2);
    if (r >= 1) this.bell(midiHz(pentaNote(root + 12, r)), 0.12, 0.1 + r * 0.02);
    if (r >= 2) [0, 4, 7].forEach((s) => this.tone(midiHz(root + s + 12), 1.2, { type: 'triangle', vol: 0.06, at: 0.2, rev: 0.6 }));
    if (r >= 3) {
      this.gong();
      this.firecracker(8 + (r - 3) * 8);
    }
    if (r >= 4) {
      this.newBest();
      for (let i = 0; i < 8; i++) this.tone(midiHz(pentaNote(84, i)), 0.3, { type: 'sine', vol: 0.05, at: 0.4 + i * 0.06, rev: 0.8 });
    }
  }
  spend(n = 6) {
    if (!this.ok) return;
    for (let i = 0; i < n; i++) {
      const f = 2400 - i * 90;
      this.tone(f, 0.08, { type: 'square', vol: 0.035, at: i * 0.045 });
    }
  }

  // ------------------------------------------------------------------ adaptive BGM
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextTime = this.now + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  stopMusic() {
    this.musicOn = false;
    clearInterval(this.timer);
  }
  setIntensity(level: number, fever = false) {
    this.intensity = level;
    this.feverOn = fever;
    this.bpm = fever ? 138 : 104 + level * 6;
    if (this.ctx) {
      this.musicFilter.frequency.setTargetAtTime(fever ? 9000 : 2400 + level * 1400, this.now, 0.3);
    }
  }
  /** briefly duck music (e.g. on mistakes) */
  duck() {
    if (!this.ctx) return;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(this.now);
    g.setTargetAtTime(0.1, this.now, 0.02);
    g.setTargetAtTime(0.34, this.now + 0.5, 0.3);
  }

  private schedule() {
    if (!this.ctx) return;
    const spb = 60 / this.bpm / 4; // 16th notes
    while (this.nextTime < this.now + 0.12) {
      this.playStep(this.step, this.nextTime - this.now);
      this.nextTime += spb;
      this.step++;
    }
  }

  // 4-bar progression in pentatonic space; melody is a fixed hook so it becomes familiar
  private static BASS = [48, 48, 45, 45, 41, 41, 43, 43];
  private static HOOK = [7, -1, 5, 4, 2, -1, 4, -1, 5, 7, -1, 9, 7, -1, 4, 2, 0, -1, 2, 4, 5, -1, 4, 2, 4, -1, -1, 2, 0, -1, -1, -1];

  private playStep(s: number, at: number) {
    if (!store.settings.sound) return;
    const bus = this.musicBus;
    const i16 = s % 16;
    const bar = Math.floor(s / 16) % 8;
    const L = this.intensity + (this.feverOn ? 2 : 0);

    // bass (always) — root on 1 & the "and" of 2
    if (i16 === 0 || i16 === 6 || (L >= 2 && i16 === 10)) {
      this.tone(midiHz(AudioEngine.BASS[bar]), 0.28, { type: 'triangle', vol: 0.32, at, bus });
    }
    // kick
    if (L >= 1 && (i16 % 4 === 0)) {
      this.tone(110, 0.16, { type: 'sine', vol: 0.45, at, bus, glide: 45 });
    }
    // snare / clap
    if (L >= 2 && (i16 === 4 || i16 === 12)) this.noise(0.12, { freq: 1800, q: 0.8, vol: 0.2, at, bus });
    // hats
    if (L >= 1 && i16 % 2 === 1) this.noise(0.04, { freq: 8000, type: 'highpass', vol: L >= 3 ? 0.09 : 0.05, at, bus });
    // melody hook on 8th notes
    if (i16 % 2 === 0) {
      const hi = Math.floor(s / 2) % AudioEngine.HOOK.length;
      const n = AudioEngine.HOOK[hi];
      if (n >= 0 && (L >= 0)) {
        const base = L >= 3 ? 72 : 67;
        const note = base + n;
        this.tone(midiHz(note), 0.32, { type: 'triangle', vol: 0.12, at, bus, rev: 0.2 });
        if (L >= 3) this.tone(midiHz(note + 12), 0.12, { type: 'square', vol: 0.03, at, bus });
      }
    }
    // arpeggio sparkle at high intensity
    if (L >= 4 && i16 % 2 === 1) {
      this.tone(midiHz(pentaNote(79, (s * 3) % 10)), 0.1, { type: 'sine', vol: 0.05, at, bus });
    }
  }
}

export const audio = new AudioEngine();

// ------------------------------------------------------------------ voice (TTS)
let zhVoice: SpeechSynthesisVoice | null | undefined;
function findVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => /zh[-_]CN/i.test(v.lang)) ?? vs.find((v) => /^zh/i.test(v.lang)) ?? null;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => (zhVoice = findVoice());

export function speak(text: string, force = false) {
  if (!('speechSynthesis' in window)) return;
  if (!force && (!store.settings.voice || !store.settings.sound)) return;
  if (zhVoice === undefined) zhVoice = findVoice();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  if (zhVoice) u.voice = zhVoice;
  u.rate = 0.85;
  speechSynthesis.speak(u);
}
