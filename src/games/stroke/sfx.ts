// Stroke Master sounds, synthesised on the app's AudioContext (muted by settings.sound).
import { audio } from '../../engine/audio';
import { store } from '../../core/store';

let out: GainNode | null = null;
let outCtx: AudioContext | null = null;

function bus(): { ac: AudioContext; out: GainNode } | null {
  const ac = audio.ctx;
  if (!ac || !store.settings.sound) return null;
  if (!out || outCtx !== ac) {
    outCtx = ac;
    out = ac.createGain();
    out.gain.value = 0.55;
    out.connect(ac.destination);
  }
  return { ac, out };
}

function tone(f: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0, slide = 0) {
  const b = bus();
  if (!b) return;
  const { ac } = b;
  const t = ac.currentTime + when;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(b.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass') {
  const b = bus();
  if (!b) return;
  const { ac } = b;
  const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * dur)), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const s = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  s.buffer = buf;
  f.type = type;
  f.frequency.value = freq;
  g.gain.value = vol;
  s.connect(f);
  f.connect(g);
  g.connect(b.out);
  s.start();
}

const PENTA = [0, 2, 4, 7, 9];
const note = (i: number) => 523.25 * 2 ** ((PENTA[i % 5] + 12 * Math.floor(i / 5)) / 12);

export const sfx = {
  stroke(i: number) {
    tone(note(i), 0.4, 'triangle', 0.2);
    tone(note(i) * 2, 0.25, 'sine', 0.05);
    noise(0.08, 0.06, 3000, 'highpass');
  },
  chime() {
    tone(1318, 0.5, 'sine', 0.12);
    tone(1760, 0.6, 'sine', 0.08, 0.06);
  },
  done(combo: number) {
    const root = 523.25 * 2 ** (Math.min(combo, 7) / 12);
    [0, 4, 7, 12, 16].forEach((s, k) => tone(root * 2 ** (s / 12), 1.4, 'sine', 0.12, k * 0.045));
    tone(70, 0.5, 'sine', 0.45, 0, 0.5);
    noise(0.6, 0.22, 1400);
  },
  miss() {
    tone(196, 0.22, 'square', 0.05, 0, 0.7);
    noise(0.12, 0.06, 500);
  },
  hurt() {
    tone(120, 0.6, 'sawtooth', 0.12, 0, 0.35);
    noise(0.5, 0.35, 260);
  },
  tick() {
    tone(1046, 0.08, 'sine', 0.08);
  },
};
