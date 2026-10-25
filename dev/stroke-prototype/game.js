(() => {
const $ = s => document.querySelector(s);
const scene = $('#scene'), sc = scene.getContext('2d');
const ink = $('#ink'), ic = ink.getContext('2d');
const skyEl = $('#sky'), paneEl = $('#pane');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COL = { ivory: '#f3ead7', gold: '#ffc93c', goldHi: '#ffe6a1', red: '#ff5a4e', jade: '#6fe3c1' };
const LENIENCY = 1.15;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = p => 1 - (1 - p) ** 3;
const rand = (a, b) => a + Math.random() * (b - a);

const toChar = (ch, d) => ({
  ch, n: d.s.length,
  paths: d.s.map(s => new Path2D(s)),
  med: d.m.map(m => m.map(([x, y]) => [x, 900 - y])),
});
const CHARS = Object.keys(INFO).filter(c => DATA[c]).map(ch => {
  const [py, th, en] = INFO[ch];
  return { ...toChar(ch, DATA[ch]), py, th, en };
});
const SEAL = toChar('笔', DATA['笔']);

// ---------- audio (synthesised, unlocks on Start) ----------
const Sfx = (() => {
  let ac, out, muted = false;
  const ensure = () => {
    try {
      if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); out = ac.createGain(); out.gain.value = 0.55; out.connect(ac.destination); }
      if (ac.state === 'suspended') ac.resume();
    } catch { ac = null; }
  };
  const tone = (f, dur, type = 'sine', vol = 0.2, when = 0, slide = 0) => {
    if (!ac || muted) return;
    const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  };
  const noise = (dur, vol, freq, type = 'lowpass') => {
    if (!ac || muted) return;
    const t = ac.currentTime, b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = b; f.type = type; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(out); s.start(t);
  };
  const PENTA = [0, 2, 4, 7, 9];
  const note = i => 523.25 * 2 ** ((PENTA[i % 5] + 12 * Math.floor(i / 5)) / 12);
  return {
    ensure,
    get muted() { return muted; }, set muted(v) { muted = v; },
    stroke(i) { tone(note(i), 0.4, 'triangle', 0.2); tone(note(i) * 2, 0.25, 'sine', 0.05); noise(0.08, 0.06, 3000, 'highpass'); },
    done(c) {
      const root = 523.25 * 2 ** (Math.min(c, 7) / 12);
      [0, 4, 7, 12, 16].forEach((s, k) => tone(root * 2 ** (s / 12), 1.4, 'sine', 0.12, k * 0.045));
      tone(70, 0.5, 'sine', 0.45, 0, 0.5); noise(0.6, 0.22, 1400);
    },
    miss() { tone(196, 0.22, 'square', 0.05, 0, 0.7); noise(0.12, 0.06, 500); },
    hurt() { tone(120, 0.6, 'sawtooth', 0.12, 0, 0.35); noise(0.5, 0.35, 260); },
    tick() { tone(1046, 0.08, 'sine', 0.08); },
  };
})();

// ---------- layout + painted backdrop ----------
let W, H, dpr, sky, box, bg, fog;
let stars = [], embers = [];
function charSize() { return clamp(sky.w * 0.18, 58, 92); }
function layout() {
  W = innerWidth; H = innerHeight; dpr = Math.min(2, devicePixelRatio || 1);
  scene.width = W * dpr; scene.height = H * dpr;
  const s = skyEl.getBoundingClientRect();
  sky = { x: s.left, y: s.top, w: s.width, h: s.height };
  const p = paneEl.getBoundingClientRect();
  ink.width = p.width * dpr; ink.height = p.height * dpr;
  const B = Math.min(p.width - 24, p.height - 52);
  box = { x: (p.width - B) / 2, y: 44 + (p.height - 52 - B) / 2, B, px: p.left, py: p.top };
  for (const f of falling) f.s = charSize();
  paintBackdrop();
}
function paintBackdrop() {
  let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  bg = document.createElement('canvas'); bg.width = W * dpr; bg.height = H * dpr;
  const g = bg.getContext('2d'); g.scale(dpr, dpr);
  const sk = g.createLinearGradient(0, 0, 0, H);
  sk.addColorStop(0, '#05070f'); sk.addColorStop(0.35, '#0c1230'); sk.addColorStop(0.62, '#1b1f45'); sk.addColorStop(0.8, '#141734'); sk.addColorStop(1, '#07080f');
  g.fillStyle = sk; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(243,234,215,${0.15 + r() * 0.5})`;
    const z = r() < 0.92 ? 1 : 1.8; g.fillRect(r() * W, r() * H * 0.62, z, z);
  }
  stars = Array.from({ length: 46 }, () => ({ x: r() * W, y: r() * H * 0.55, a: 0.5 + r() * 0.5, f: 0.6 + r() * 2.2, p: r() * 6, z: 1 + r() * 1.4 }));
  // moon, tucked to the column's upper right
  const mx = Math.min(W - 40, sky.x + sky.w - 30), my = sky.y + Math.min(80, sky.h * 0.16);
  const halo = g.createRadialGradient(mx, my, 10, mx, my, 260);
  halo.addColorStop(0, 'rgba(255,236,196,.22)'); halo.addColorStop(0.25, 'rgba(255,220,170,.08)'); halo.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = halo; g.fillRect(0, 0, W, H);
  const md = g.createRadialGradient(mx - 10, my - 10, 4, mx, my, 34);
  md.addColorStop(0, '#fff8e6'); md.addColorStop(1, '#e6cf9f');
  g.fillStyle = md; g.beginPath(); g.arc(mx, my, 32, 0, 7); g.fill();
  g.fillStyle = 'rgba(160,130,90,.16)';
  [[-9, -6, 7], [8, 6, 5], [-4, 12, 4], [12, -10, 3]].forEach(([a, b, c]) => { g.beginPath(); g.arc(mx + a, my + b, c, 0, 7); g.fill(); });
  // ink-wash ranges, far to near
  const layers = [
    { base: 0.5, amp: 0.13, top: '#2a3170', bot: '#151a3d', f: 0.004 },
    { base: 0.6, amp: 0.11, top: '#1f2558', bot: '#0f1330', f: 0.006 },
    { base: 0.71, amp: 0.09, top: '#151a40', bot: '#0a0d22', f: 0.009 },
    { base: 0.84, amp: 0.07, top: '#0c0f27', bot: '#05060f', f: 0.013 },
  ];
  for (const L of layers) {
    const p1 = r() * 9, p2 = r() * 9, p3 = r() * 9, yb = H * L.base, a = H * L.amp;
    const ridge = x => yb - a * (0.65 * Math.abs(Math.sin(x * L.f + p1)) ** 1.6 + 0.25 * Math.sin(x * L.f * 2.7 + p2) + 0.1 * Math.sin(x * L.f * 7.3 + p3));
    const grd = g.createLinearGradient(0, yb - a, 0, H);
    grd.addColorStop(0, L.top); grd.addColorStop(0.5, L.bot); grd.addColorStop(1, '#05060f');
    g.fillStyle = grd; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W + 4; x += 4) g.lineTo(x, ridge(x));
    g.lineTo(W, H); g.closePath(); g.fill();
    const mist = g.createLinearGradient(0, yb - a * 0.2, 0, yb + a * 0.9);
    mist.addColorStop(0, 'rgba(140,155,230,0)'); mist.addColorStop(0.5, 'rgba(140,155,230,.07)'); mist.addColorStop(1, 'rgba(140,155,230,0)');
    g.fillStyle = mist; g.fillRect(0, yb - a * 0.2, W, a * 1.1);
  }
  fog = document.createElement('canvas'); fog.width = 256; fog.height = 96;
  const fg = fog.getContext('2d'), fr = fg.createRadialGradient(128, 48, 0, 128, 48, 128);
  fr.addColorStop(0, 'rgba(150,165,240,.16)'); fr.addColorStop(1, 'rgba(150,165,240,0)');
  fg.setTransform(1, 0, 0, 0.375, 0, 30); fg.fillStyle = fr; fg.fillRect(0, 0, 256, 256);
  if (!embers.length) embers = Array.from({ length: RM ? 10 : 34 }, () => newEmber(true));
}
function newEmber(any) {
  return { x: rand(0, W), y: any ? rand(H * 0.3, H) : H + 10, v: rand(8, 26), r: rand(0.6, 1.8), p: rand(0, 6), w: rand(0.4, 1.4) };
}

// ---------- game state ----------
let state = 'attract', t = 0, last = performance.now();
let falling = [], fx = [], paneFx = [];
let target = null, score = 0, combo = 0, hearts = 3, cleared = 0, written = [];
let spawnT = 0, hitstop = 0, shake = 0, hurtT = -9, showOutline = true, drawing = null, msg = null;
let best = 0; try { best = +localStorage.getItem('stroke-master-best') || 0; } catch {}

const fallTime = () => Math.max(10, 25 - cleared * 0.45);
const spawnGap = () => Math.max(2.4, 6.4 - cleared * 0.17);
const maxOnScreen = () => Math.min(5, 2 + Math.floor(cleared / 4));
const groundY = () => sky.y + sky.h;

function spawn(slow) {
  const maxStrokes = slow ? 6 : Math.min(12, 3 + Math.floor(cleared / 2));
  let pool = CHARS.filter(c => c.n <= maxStrokes && !falling.some(f => f.c === c));
  if (!pool.length) pool = CHARS.filter(c => !falling.some(f => f.c === c));
  const c = pool[Math.floor(Math.random() * pool.length)], s = charSize();
  let x = 0;
  for (let k = 0; k < 12; k++) {
    x = sky.x + s * 0.7 + Math.random() * (sky.w - s * 1.4);
    if (falling.every(f => Math.abs(f.x - x) > s * 1.15 || f.y > sky.y + s * 2.2)) break;
  }
  falling.push({ c, x, dx: x, y: sky.y - s * 0.2, s, vy: sky.h / (slow ? 16 : fallTime()), done: 0, misses: 0, missStroke: 0,
    lit: new Array(c.n).fill(-9), badT: -9, phase: Math.random() * 6, age: 0, tapLocked: false, dead: false });
}

// ---------- input ----------
function local(e) { const r = ink.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, performance.now()]; }
paneEl.addEventListener('pointerdown', e => {
  if (state !== 'play' || drawing) return;
  e.preventDefault(); paneEl.setPointerCapture(e.pointerId);
  drawing = { id: e.pointerId, pts: [local(e)] };
  $('#prompt').style.opacity = 0;
});
paneEl.addEventListener('pointermove', e => {
  if (!drawing || e.pointerId !== drawing.id) return;
  for (const ev of e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) {
    const p = local(ev), q = drawing.pts[drawing.pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.5) drawing.pts.push(p);
  }
});
const endStroke = e => {
  if (!drawing || e.pointerId !== drawing.id) return;
  const pts = drawing.pts; drawing = null;
  submit(pts);
};
paneEl.addEventListener('pointerup', endStroke);
paneEl.addEventListener('pointercancel', endStroke);
skyEl.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  let hit = null, bd = Infinity;
  for (const f of falling) {
    const d = Math.hypot(e.clientX - f.dx, e.clientY - f.y);
    if (!f.dead && d < f.s * 0.8 && d < bd) { bd = d; hit = f; }
  }
  if (hit) { target = hit; hit.tapLocked = true; Sfx.tick(); }
});
$('#outline').addEventListener('click', e => {
  showOutline = !showOutline; e.currentTarget.setAttribute('aria-pressed', showOutline);
});
$('#mute').addEventListener('click', e => {
  Sfx.muted = !Sfx.muted;
  e.currentTarget.setAttribute('aria-pressed', Sfx.muted);
  e.currentTarget.setAttribute('aria-label', Sfx.muted ? 'Unmute sound' : 'Mute sound');
  $('#waves').style.display = Sfx.muted ? 'none' : '';
});

// ---------- grading ----------
function submit(raw) {
  const pts = raw.map(([x, y]) => [(x - box.x) / box.B * 1024, (y - box.y) / box.B * 1024]);
  if (M.length(pts) < 18) return;
  let f = target && !target.dead ? target : null;
  if (f && f.done === 0 && !f.tapLocked) f = null;
  if (f) {
    const r = M.grade(pts, f.c.med, f.done, LENIENCY);
    return r.ok ? accept(f, raw) : reject(f, raw, r.why);
  }
  let pick = null, bestScore = Infinity;
  for (const g of falling) {
    if (g.dead) continue;
    const r = M.grade(pts, g.c.med, g.done, LENIENCY);
    const s = r.avg - 45 * ((g.y - sky.y) / sky.h);
    if (r.ok && s < bestScore) { bestScore = s; pick = g; }
  }
  pick ? accept(pick, raw) : reject(null, raw, 'none');
}
function strokePoint(f, i, at = 0.5) {
  const m = f.c.med[i], p = m[Math.min(m.length - 1, Math.floor((m.length - 1) * at))], s = f.s * 0.84;
  return [f.dx - s / 2 + p[0] * s / 1024, f.y - s / 2 + p[1] * s / 1024];
}
function accept(f, raw) {
  const i = f.done++;
  f.lit[i] = t; f.missStroke = 0; target = f; setMsg(null);
  paneFx.push({ k: 'ok', raw, c: f.c, i, t0: t });
  const [tx, ty] = strokePoint(f, i), end = raw[raw.length - 1];
  fx.push({ k: 'bolt', x0: box.px + end[0], y0: box.py + 6, x1: tx, y1: ty, t0: t, life: 0.26 });
  for (let k = 0; k < (RM ? 4 : 10); k++) {
    const a = rand(0, 6.28), v = rand(40, 140);
    fx.push({ k: 'spark', x: tx, y: ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t + 0.2, life: rand(0.3, 0.55), r: rand(1, 2.2), col: COL.goldHi });
  }
  score += Math.round(10 * (1 + Math.min(combo, 20) * 0.1));
  Sfx.stroke(i);
  if (f.done >= f.c.n) complete(f);
  hud();
}
function reject(f, raw, why) {
  paneFx.push({ k: 'bad', raw, t0: t });
  Sfx.miss();
  if (f) {
    f.misses++; f.missStroke++; f.badT = t;
    if (combo) { combo = 0; hud(); }
  }
  setMsg(why === 'order' ? 'Wrong stroke order' : why === 'backwards' ? 'Wrong direction' : f ? 'Try that stroke again' : 'No match on screen');
  paneEl.classList.remove('nope'); void paneEl.offsetWidth; paneEl.classList.add('nope');
}
function complete(f) {
  f.dead = true; target = null; combo++; cleared++;
  const perfect = f.misses === 0;
  const gain = Math.round(f.c.n * 60 * (1 + Math.min(combo, 20) * 0.15) * (perfect ? 1.5 : 1));
  score += gain;
  written.push({ c: f.c, perfect });
  const s = f.s * 0.84;
  fx.push({ k: 'flash', x: f.dx, y: f.y, r: f.s * 1.6, t0: t, life: 0.35 });
  fx.push({ k: 'ring', x: f.dx, y: f.y, r0: f.s * 0.35, r1: f.s * 1.9, t0: t, life: 0.55, col: COL.gold });
  fx.push({ k: 'ring', x: f.dx, y: f.y, r0: f.s * 0.2, r1: f.s * 1.2, t0: t + 0.06, life: 0.45, col: COL.ivory });
  fx.push({ k: 'shatter', c: f.c, x: f.dx, y: f.y, s, t0: t, life: 0.85,
    parts: f.c.med.map(m => {
      const cx = m.reduce((a, p) => a + p[0], 0) / m.length, cy = m.reduce((a, p) => a + p[1], 0) / m.length;
      const ang = Math.atan2(cy - 512, cx - 512) + rand(-0.4, 0.4), v = rand(90, 220);
      return { cx, cy, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 60, vr: rand(-5, 5) };
    }) });
  const n = RM ? 18 : 60;
  for (let k = 0; k < n; k++) {
    const i = k % f.c.n, [px, py] = strokePoint(f, i, Math.random());
    const a = Math.atan2(py - f.y, px - f.dx) + rand(-0.6, 0.6), v = rand(80, 320);
    fx.push({ k: 'spark', x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t, life: rand(0.5, 1.1), r: rand(1.2, 3.2), col: Math.random() < 0.7 ? COL.gold : COL.ivory, g: 160 });
  }
  fx.push({ k: 'label', x: f.dx, y: f.y, c: f.c, gain, perfect, t0: t, life: 2.4 });
  paneFx.push({ k: 'clear', c: f.c, t0: t });
  hitstop = 0.09; shake = RM ? 0 : 7;
  Sfx.done(combo);
  const el = $('#combo'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function land(f) {
  f.dead = true;
  if (target === f) target = null;
  hearts--; combo = 0; hurtT = t; shake = RM ? 0 : 14;
  Sfx.hurt();
  const gy = groundY();
  for (let k = 0; k < (RM ? 10 : 34); k++) {
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), v = rand(60, 260);
    fx.push({ k: 'spark', x: f.dx + rand(-f.s * 0.3, f.s * 0.3), y: gy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t, life: rand(0.5, 0.9), r: rand(1.5, 3.5), col: Math.random() < 0.6 ? COL.red : COL.ivory, g: 520 });
  }
  fx.push({ k: 'label', x: f.dx, y: gy - f.s * 0.6, c: f.c, miss: true, t0: t, life: 2.2 });
  hud(true);
  if (hearts <= 0) gameOver();
}

// ---------- HUD / messages ----------
const HEART = '<svg viewBox="0 0 24 24"><path fill="#ff5a4e" d="M12 21s-7.5-4.6-9.6-9.3C.9 8.4 3 4.5 6.7 4.5c2.2 0 3.6 1.2 5.3 3 1.7-1.8 3.1-3 5.3-3 3.7 0 5.8 3.9 4.3 7.2C19.5 16.4 12 21 12 21z"/><path fill="rgba(255,255,255,.35)" d="M7 7.2c-1.4.2-2.4 1.5-2.2 3 .1.6.9.6.9 0 0-1 .6-1.8 1.5-2 .6-.1.5-1.1-.2-1z"/></svg>';
$('#hearts').innerHTML = HEART.repeat(3);
function hud(lostHeart) {
  $('#score').textContent = score.toLocaleString('en-US');
  $('#comboN').textContent = '×' + combo;
  $('#combo').classList.toggle('on', combo >= 2);
  const hs = $('#hearts').children;
  for (let i = 0; i < 3; i++) {
    const gone = i >= hearts;
    if (lostHeart && i === hearts) { hs[i].classList.remove('break'); void hs[i].getBoundingClientRect(); hs[i].classList.add('break'); }
    hs[i].classList.toggle('gone', gone);
  }
  $('#hearts').setAttribute('aria-label', `${hearts} ${hearts === 1 ? 'life' : 'lives'} left`);
}
function setMsg(text) { msg = text ? { text, t0: t } : null; }
let chipKey = '';
function chip() {
  const el = $('#chip'), f = target && !target.dead ? target : null;
  const showMsg = msg && t - msg.t0 < 1.5;
  const key = showMsg ? 'm' + msg.text + (f ? f.c.ch + f.done : '') : f ? f.c.ch + f.done : state;
  if (key === chipKey) return; chipKey = key;
  el.className = 'chip' + (showMsg ? ' bad' : f ? '' : ' idle');
  if (f) {
    const dots = Array.from({ length: f.c.n }, (_, i) => `<i class="${i < f.done ? 'on' : ''}"></i>`).join('');
    el.innerHTML = `<span class="g">${f.c.ch}</span>${showMsg ? msg.text : `<span class="dots">${dots}</span>`}`;
  } else el.textContent = showMsg ? msg.text : 'Write any falling character';
}

// ---------- flow ----------
function start() {
  Sfx.ensure();
  falling = []; fx = []; paneFx = [];
  target = null; score = 0; combo = 0; hearts = 3; cleared = 0; written = []; spawnT = 0.5; msg = null;
  state = 'play';
  $('#intro').hidden = true; $('#over').hidden = true; $('#prompt').style.opacity = 1;
  hud();
}
function gameOver() {
  state = 'ending'; target = null; drawing = null;
  for (const f of falling) f.fadeOut = t;
  if (score > best) { best = score; try { localStorage.setItem('stroke-master-best', best); } catch {} }
  setTimeout(() => {
    state = 'over';
    $('#finalScore').textContent = score.toLocaleString('en-US');
    $('#fBest').textContent = best.toLocaleString('en-US');
    $('#fChars').textContent = written.length;
    $('#fPerfect').textContent = written.filter(w => w.perfect).length;
    $('#learned').innerHTML = written.length
      ? written.map(w => `<div class="${w.perfect ? 'p' : ''}"><span class="h">${w.c.ch}</span><span class="py">${w.c.py}</span><span class="th">${w.c.th}</span></div>`).join('')
      : '<p class="empty">No characters written this round.</p>';
    $('#over').hidden = false;
  }, 1100);
}
$('#startBtn').addEventListener('click', start);
$('#againBtn').addEventListener('click', start);

// ---------- update ----------
function update(dt) {
  t += dt;
  if (hitstop > 0) { hitstop -= dt; dt *= 0.1; }
  shake *= Math.pow(0.0015, dt);
  if (state === 'play') {
    spawnT -= dt;
    if (spawnT <= 0 && falling.length < maxOnScreen()) { spawn(); spawnT = spawnGap(); }
    if (!falling.length && spawnT > 0.6) spawnT = 0.6;
  } else if (state === 'attract' || state === 'over') {
    spawnT -= dt;
    if (spawnT <= 0 && falling.length < 4) { spawn(true); spawnT = 2.6; }
  }
  const gy = groundY();
  for (const f of falling) {
    f.age += dt; f.y += f.vy * dt;
    f.dx = f.x + Math.sin(f.age * 1.2 + f.phase) * 3;
    if (f.y > gy - f.s * 0.42 && !f.dead) {
      if (state === 'play') land(f); else f.fadeOut = f.fadeOut ?? t;
    }
    if (f.fadeOut != null && t - f.fadeOut > 0.6) f.dead = true;
  }
  falling = falling.filter(f => !f.dead);
  if (target && target.dead) target = null;
  for (const e of fx) if (e.k === 'spark' && t > e.t0) {
    e.vy += (e.g || 0) * dt; e.vx *= Math.pow(0.12, dt); e.vy *= Math.pow(0.3, dt);
    e.x += e.vx * dt; e.y += e.vy * dt;
  }
  fx = fx.filter(e => t - e.t0 < e.life);
  paneFx = paneFx.filter(e => t - e.t0 < 1);
  for (const e of embers) {
    e.y -= e.v * dt; e.x += Math.sin(t * e.w + e.p) * 6 * dt;
    if (e.y < H * 0.2) Object.assign(e, newEmber(false));
  }
}

// ---------- draw: scene ----------
let so = [0, 0];
const base = (c = sc) => c.setTransform(dpr, 0, 0, dpr, dpr * so[0], dpr * so[1]);
function glyphAt(c, x, y, s) { const k = s / 1024; c.setTransform(dpr * k, 0, 0, -dpr * k, dpr * (x - s / 2 + so[0]), dpr * (y - s / 2 + 900 * k + so[1])); }

function drawScene() {
  const c = sc;
  so = shake > 0.3 ? [rand(-1, 1) * shake, rand(-1, 1) * shake] : [0, 0];
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  c.drawImage(bg, 0, 0);
  base(c);
  for (const s of stars) {
    c.globalAlpha = s.a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.f + s.p)));
    c.fillStyle = COL.ivory; c.fillRect(s.x, s.y, s.z, s.z);
  }
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const fw = W * 1.3, x = ((t * (5 + i * 3) + i * 520) % (W + fw)) - fw;
    c.globalAlpha = 0.9; c.drawImage(fog, x, H * (0.42 + i * 0.11) - 90, fw, 200);
  }
  for (const e of embers) {
    c.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3 + e.p));
    c.fillStyle = COL.gold; c.beginPath(); c.arc(e.x, e.y, e.r, 0, 7); c.fill();
  }
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  drawGround(c);
  for (const f of falling) drawFalling(c, f);
  drawFx(c);
  const ht = t - hurtT;
  if (ht < 0.7) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(255,90,78,0)'); v.addColorStop(1, `rgba(255,60,50,${0.5 * (1 - ht / 0.7)})`);
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }
}
function drawGround(c) {
  const gy = groundY();
  let danger = 0;
  for (const f of falling) danger = Math.max(danger, clamp(((f.y - sky.y) / sky.h - 0.6) / 0.4, 0, 1));
  if (state !== 'play') danger = 0;
  const a = 0.18 + danger * (0.45 + 0.25 * Math.sin(t * 10));
  const g = c.createLinearGradient(sky.x, 0, sky.x + sky.w, 0);
  g.addColorStop(0, 'rgba(255,90,78,0)'); g.addColorStop(0.5, `rgba(255,90,78,${a})`); g.addColorStop(1, 'rgba(255,90,78,0)');
  c.fillStyle = g; c.fillRect(sky.x, gy - 1, sky.w, 2);
  if (danger > 0) {
    const up = c.createLinearGradient(0, gy - 70, 0, gy);
    up.addColorStop(0, 'rgba(255,90,78,0)'); up.addColorStop(1, `rgba(255,90,78,${danger * 0.16})`);
    c.fillStyle = up; c.fillRect(sky.x, gy - 70, sky.w, 70);
  }
}
function drawFalling(c, f) {
  const { dx: x, y, s } = f, isT = f === target;
  const fade = Math.min(1, f.age / 0.6) * (f.fadeOut != null ? clamp(1 - (t - f.fadeOut) / 0.6, 0, 1) : 1);
  const depth = clamp((y - sky.y) / sky.h, 0, 1), danger = state === 'play' && depth > 0.72;
  const bad = t - f.badT < 0.4;
  base(c); c.globalAlpha = fade;
  // falling streak
  const tr = c.createLinearGradient(0, y - s * 2.2, 0, y - s * 0.4);
  tr.addColorStop(0, 'rgba(243,234,215,0)'); tr.addColorStop(1, 'rgba(243,234,215,.07)');
  c.fillStyle = tr; c.fillRect(x - s * 0.22, y - s * 2.2, s * 0.44, s * 1.8);
  // ink plate
  const plate = c.createRadialGradient(x, y, s * 0.1, x, y, s * 0.78);
  plate.addColorStop(0, 'rgba(8,10,24,.9)'); plate.addColorStop(0.72, 'rgba(8,10,24,.6)'); plate.addColorStop(1, 'rgba(8,10,24,0)');
  c.fillStyle = plate; c.beginPath(); c.arc(x, y, s * 0.78, 0, 7); c.fill();
  const ringCol = bad || danger ? `rgba(255,90,78,${danger ? 0.5 + 0.4 * Math.sin(t * 12) : 0.9})` : isT ? COL.gold : 'rgba(243,234,215,.2)';
  c.strokeStyle = ringCol; c.lineWidth = isT ? 1.6 : 1.1;
  c.beginPath(); c.arc(x, y, s * 0.62, 0, 7); c.stroke();
  if (isT) {
    c.save(); c.translate(x, y); c.rotate(t * 1.4);
    c.strokeStyle = COL.gold; c.lineWidth = 2.4; c.shadowColor = COL.gold; c.shadowBlur = 10 * dpr;
    for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(0, 0, s * 0.74, k * Math.PI / 2 + 0.25, k * Math.PI / 2 + 1.0); c.stroke(); }
    c.restore();
  }
  // glyph, done strokes lit gold
  const gx = x + (bad ? Math.sin(t * 90) * 3 : 0);
  glyphAt(c, gx, y, s * 0.84);
  for (let i = 0; i < f.c.n; i++) {
    if (i < f.done) {
      const lt = t - f.lit[i];
      c.fillStyle = lt < 0.25 ? '#fff6dc' : COL.gold;
      c.shadowColor = COL.gold; c.shadowBlur = (lt < 0.5 ? 26 * (1 - lt / 0.5) + 8 : 8) * dpr;
    } else {
      c.fillStyle = bad ? '#ffb3ad' : 'rgba(243,234,215,.94)'; c.shadowBlur = 0;
    }
    c.fill(f.c.paths[i]);
  }
  c.shadowBlur = 0; c.globalAlpha = 1;
}
function drawFx(c) {
  for (const e of fx) {
    const p = (t - e.t0) / e.life;
    if (p < 0) continue;
    base(c);
    switch (e.k) {
      case 'spark':
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1 - p;
        c.fillStyle = e.col; c.beginPath(); c.arc(e.x, e.y, e.r * (1 - p * 0.5), 0, 7); c.fill();
        break;
      case 'ring':
        c.globalAlpha = (1 - p) * 0.9; c.strokeStyle = e.col; c.lineWidth = 3 * (1 - p) + 0.5;
        c.beginPath(); c.arc(e.x, e.y, e.r0 + (e.r1 - e.r0) * ease(p), 0, 7); c.stroke();
        break;
      case 'flash': {
        c.globalCompositeOperation = 'lighter';
        const g = c.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
        g.addColorStop(0, `rgba(255,240,200,${0.8 * (1 - p)})`); g.addColorStop(0.4, `rgba(255,201,60,${0.3 * (1 - p)})`); g.addColorStop(1, 'rgba(255,201,60,0)');
        c.fillStyle = g; c.fillRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
        break;
      }
      case 'bolt': {
        c.globalCompositeOperation = 'lighter';
        const cx = e.x0 + (e.x1 - e.x0) * 0.2, cy = e.y1 + (e.y0 - e.y1) * 0.35;
        const at = q => [(1 - q) ** 2 * e.x0 + 2 * (1 - q) * q * cx + q * q * e.x1, (1 - q) ** 2 * e.y0 + 2 * (1 - q) * q * cy + q * q * e.y1];
        const head = Math.min(1, ease(p * 1.6)), tail = Math.max(0, head - 0.45), fadeA = p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
        c.lineCap = 'round';
        for (let k = 0; k < 10; k++) {
          const q0 = tail + (head - tail) * k / 10, q1 = tail + (head - tail) * (k + 1) / 10, [ax, ay] = at(q0), [bx, by] = at(q1);
          c.globalAlpha = fadeA * (k + 1) / 10; c.strokeStyle = COL.goldHi; c.lineWidth = 0.6 + 3.2 * (k + 1) / 10;
          c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        }
        const [hx, hy] = at(head);
        c.globalAlpha = fadeA; c.fillStyle = '#fff6dc'; c.beginPath(); c.arc(hx, hy, 3.5, 0, 7); c.fill();
        break;
      }
      case 'shatter': {
        const tt = t - e.t0;
        c.globalAlpha = clamp(1 - p * 1.1, 0, 1);
        c.shadowColor = COL.gold; c.shadowBlur = 14 * dpr;
        e.parts.forEach((q, i) => {
          const ox = q.vx * tt, oy = q.vy * tt + 260 * tt * tt;
          glyphAt(c, e.x + ox, e.y + oy, e.s);
          c.translate(q.cx, 900 - q.cy); c.rotate(q.vr * tt); c.translate(-q.cx, -(900 - q.cy));
          c.fillStyle = tt < 0.1 ? '#fff6dc' : COL.gold;
          c.fill(e.c.paths[i]);
        });
        c.shadowBlur = 0;
        break;
      }
      case 'label': {
        const tt = t - e.t0, rise = ease(Math.min(1, tt / 1.2)) * 46;
        const a = tt < 0.15 ? tt / 0.15 : p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
        const y = e.y - rise;
        c.globalAlpha = a; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 6 * dpr;
        if (e.miss) {
          c.font = '700 22px "Noto Sans SC", "PingFang SC", sans-serif'; c.fillStyle = '#ffb3ad';
          c.fillText(e.c.ch, e.x, y - 18);
        } else {
          c.font = '400 16px "Lilita One", sans-serif'; c.fillStyle = COL.goldHi;
          c.fillText('+' + e.gain + (e.perfect ? '  PERFECT' : ''), e.x, y - 22);
        }
        c.font = '900 19px Nunito, system-ui, sans-serif'; c.fillStyle = e.miss ? '#ffb3ad' : COL.gold;
        c.fillText(e.c.py, e.x, y + 2);
        c.font = '500 12.5px Mitr, Nunito, sans-serif'; c.fillStyle = 'rgba(243,234,215,.9)';
        c.fillText(e.c.th + '  ·  ' + e.c.en, clamp(e.x, sky.x + 70, sky.x + sky.w - 70), y + 22);
        c.shadowBlur = 0;
        break;
      }
    }
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  }
}

// ---------- draw: writing pane ----------
function paneGlyph() { const k = box.B / 1024; ic.setTransform(dpr * k, 0, 0, -dpr * k, dpr * box.x, dpr * (box.y + 900 * k)); }
function brush(pts, col, w, alpha, glow) {
  if (pts.length < 2) return;
  ic.globalAlpha = alpha; ic.strokeStyle = col; ic.lineCap = 'round'; ic.lineJoin = 'round';
  ic.shadowColor = col; ic.shadowBlur = glow * dpr; ic.lineWidth = w;
  ic.beginPath(); ic.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    ic.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  const z = pts[pts.length - 1]; ic.lineTo(z[0], z[1]); ic.stroke();
  ic.shadowBlur = 0; ic.globalAlpha = 1;
}
function drawPane() {
  const c = ic, { x, y, B } = box;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ink.width, ink.height);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 米字格 guide
  c.strokeStyle = 'rgba(243,234,215,.16)'; c.lineWidth = 1; c.setLineDash([]);
  c.strokeRect(x + 0.5, y + 0.5, B - 1, B - 1);
  c.strokeStyle = 'rgba(255,90,78,.22)'; c.setLineDash([5, 6]);
  c.beginPath();
  c.moveTo(x + B / 2, y); c.lineTo(x + B / 2, y + B); c.moveTo(x, y + B / 2); c.lineTo(x + B, y + B / 2);
  c.moveTo(x, y); c.lineTo(x + B, y + B); c.moveTo(x + B, y); c.lineTo(x, y + B);
  c.stroke(); c.setLineDash([]);

  const f = target && !target.dead ? target : null;
  if (f) {
    paneGlyph();
    if (showOutline) { c.fillStyle = 'rgba(243,234,215,.075)'; for (const p of f.c.paths) c.fill(p); }
    for (let i = 0; i < f.done; i++) {
      const lt = t - f.lit[i];
      c.globalAlpha = lt < 0.3 ? lt / 0.3 : 1;
      c.fillStyle = lt < 0.35 ? '#fff6dc' : COL.goldHi;
      c.shadowColor = COL.gold; c.shadowBlur = (lt < 0.6 ? 30 * (1 - lt / 0.6) : 0) * dpr;
      c.fill(f.c.paths[i]);
    }
    c.shadowBlur = 0; c.globalAlpha = 1;
    if (f.missStroke >= 2 && f.done < f.c.n) {
      const i = f.done, pulse = 0.35 + 0.25 * Math.sin(t * 6);
      c.fillStyle = `rgba(111,227,193,${pulse})`; c.fill(f.c.paths[i]);
      const m = f.c.med[i], q = (t * 0.9) % 1, k = B / 1024;
      let L = 0; const seg = []; for (let j = 1; j < m.length; j++) { const d = Math.hypot(m[j][0] - m[j - 1][0], m[j][1] - m[j - 1][1]); seg.push(d); L += d; }
      let want = q * L, j = 0; while (j < seg.length - 1 && want > seg[j]) { want -= seg[j]; j++; }
      const u = seg[j] ? want / seg[j] : 0, px = m[j][0] + (m[j + 1][0] - m[j][0]) * u, py = m[j][1] + (m[j + 1][1] - m[j][1]) * u;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = COL.jade; c.shadowColor = COL.jade; c.shadowBlur = 12 * dpr;
      c.beginPath(); c.arc(x + px * k, y + py * k, 6, 0, 7); c.fill(); c.shadowBlur = 0;
      c.fillStyle = 'rgba(111,227,193,.9)';
      c.beginPath(); c.arc(x + m[0][0] * k, y + m[0][1] * k, 3, 0, 7); c.fill();
    }
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const e of paneFx) {
    const tt = t - e.t0;
    if (e.k === 'ok' && tt < 0.35) brush(e.raw, COL.goldHi, B * 0.05, 1 - tt / 0.35, 14);
    if (e.k === 'bad' && tt < 0.6) {
      const jit = tt < 0.25 ? Math.sin(tt * 80) * 4 : 0;
      brush(e.raw.map(p => [p[0] + jit, p[1] + (tt > 0.25 ? (tt - 0.25) * 60 : 0), p[2]]), COL.red, B * 0.05, 1 - tt / 0.6, 10);
    }
    if (e.k === 'clear' && tt < 0.7) {
      paneGlyph();
      c.globalAlpha = 1 - ease(tt / 0.7); c.fillStyle = COL.goldHi; c.shadowColor = COL.gold; c.shadowBlur = 30 * dpr;
      for (const p of e.c.paths) c.fill(p);
      c.shadowBlur = 0; c.globalAlpha = 1;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }
  if (drawing) brush(drawing.pts, COL.ivory, B * 0.05, 1, 10);
}

// ---------- intro seal (笔 written stroke by stroke) ----------
const sealC = $('#seal').getContext('2d');
function drawSeal() {
  const c = sealC, S = 232, n = SEAL.n, cyc = n * 0.32 + 1.6, tt = t % cyc;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, S, S);
  c.strokeStyle = 'rgba(255,201,60,.35)'; c.lineWidth = 2; c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 4, 0, 7); c.stroke();
  c.strokeStyle = 'rgba(255,90,78,.25)'; c.setLineDash([4, 6]); c.beginPath();
  c.moveTo(S / 2, 18); c.lineTo(S / 2, S - 18); c.moveTo(18, S / 2); c.lineTo(S - 18, S / 2); c.stroke(); c.setLineDash([]);
  const s = S * 0.7, k = s / 1024;
  c.setTransform(k, 0, 0, -k, (S - s) / 2, (S - s) / 2 + 900 * k);
  c.fillStyle = 'rgba(243,234,215,.1)'; for (const p of SEAL.paths) c.fill(p);
  const fade = tt > cyc - 0.4 ? (cyc - tt) / 0.4 : 1;
  for (let i = 0; i < n; i++) {
    const lt = tt - i * 0.32;
    if (lt < 0) break;
    c.globalAlpha = Math.min(1, lt / 0.2) * fade;
    c.fillStyle = lt < 0.3 ? '#fff6dc' : COL.gold; c.shadowColor = COL.gold; c.shadowBlur = lt < 0.5 ? 20 : 6;
    c.fill(SEAL.paths[i]);
  }
  c.globalAlpha = 1; c.shadowBlur = 0;
}

// ---------- loop ----------
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt);
  drawScene(); drawPane(); chip();
  if (!$('#intro').hidden) drawSeal();
  requestAnimationFrame(frame);
}
addEventListener('resize', layout);
layout(); hud();
spawn(true); falling[0].y = sky.y + sky.h * 0.25; falling[0].age = 1;
spawn(true); falling[1].y = sky.y + sky.h * 0.05; falling[1].age = 1;
spawnT = 1.5;
requestAnimationFrame(frame);
})();
