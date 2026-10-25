// Stroke grader. Same rules as Hanzi Writer's strokeMatches (avg distance,
// start/end gates, direction, Frechet shape, "a later stroke fits better"),
// but callable against any character's median list so one drawn stroke can
// be tested against every falling word at once. Pure, no DOM.
// Coordinates: 1024 box, y down.
export type Pt = readonly [number, number];
export type Median = readonly Pt[];

export interface MatchResult {
  ok: boolean;
  /** mean two-way distance to the median, in box units */
  avg: number;
}

export type WhyNot = 'order' | 'backwards' | 'miss';

export interface GradeResult extends MatchResult {
  /** set when ok is false: fits a later stroke / right stroke drawn backwards / no fit */
  why?: WhyNot;
}

const d = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function length(p: Median): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += d(p[i - 1], p[i]);
  return L;
}

function resample(p: Median, n: number): Pt[] {
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + d(p[i - 1], p[i]));
  const L = cum[cum.length - 1];
  if (p.length < 2 || !L) return Array.from({ length: n }, () => p[0]);
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = (L * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < t) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const u = Math.min(1, Math.max(0, (t - cum[j]) / seg));
    out.push([p[j][0] + (p[j + 1][0] - p[j][0]) * u, p[j][1] + (p[j + 1][1] - p[j][1]) * u]);
  }
  return out;
}

function oneWay(a: Pt[], b: Pt[]): number {
  let s = 0;
  for (const p of a) {
    let m = Infinity;
    for (const q of b) m = Math.min(m, d(p, q));
    s += m;
  }
  return s / a.length;
}

function normalize(p: Pt[]): Pt[] {
  let cx = 0;
  let cy = 0;
  for (const q of p) {
    cx += q[0];
    cy += q[1];
  }
  cx /= p.length;
  cy /= p.length;
  let r = 0;
  for (const q of p) r += (q[0] - cx) ** 2 + (q[1] - cy) ** 2;
  r = Math.sqrt(r / p.length) || 1;
  return p.map((q): Pt => [(q[0] - cx) / r, (q[1] - cy) / r]);
}

function frechet(a: Pt[], b: Pt[]): number {
  const n = a.length;
  const m = b.length;
  const ca = new Float64Array(n * m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const dd = d(a[i], b[j]);
      ca[i * m + j] =
        i === 0 && j === 0 ? dd
        : i === 0 ? Math.max(ca[j - 1], dd)
        : j === 0 ? Math.max(ca[(i - 1) * m], dd)
        : Math.max(Math.min(ca[(i - 1) * m + j], ca[(i - 1) * m + j - 1], ca[i * m + j - 1]), dd);
    }
  }
  return ca[n * m - 1];
}

function direction(u: Pt[], m: Pt[]): number {
  const k = 4;
  let s = 0;
  for (let i = 0; i < k; i++) {
    const a = Math.floor((i * (u.length - 1)) / k);
    const b = Math.floor(((i + 1) * (u.length - 1)) / k);
    const vu = [u[b][0] - u[a][0], u[b][1] - u[a][1]];
    const vm = [m[b][0] - m[a][0], m[b][1] - m[a][1]];
    const nu = Math.hypot(vu[0], vu[1]);
    const nm = Math.hypot(vm[0], vm[1]);
    s += !nu || !nm ? 1 : (vu[0] * vm[0] + vu[1] * vm[1]) / (nu * nm);
  }
  return s / k;
}

/** Does the drawn stroke fit this median? `lv` is the leniency multiplier. */
export function match(user: Median, median: Median, lv = 1): MatchResult {
  const N = 24;
  const u = resample(user, N);
  const m = resample(median, N);
  const uL = length(user);
  const mL = length(median);
  const avg = (oneWay(u, m) + oneWay(m, u)) / 2;
  const r: MatchResult = { ok: false, avg };
  if (avg > 165 * lv) return r;
  if (d(u[0], m[0]) > 260 * lv || d(u[N - 1], m[N - 1]) > 260 * lv) return r;
  if (uL < 0.35 * mL - 30 || uL > 2.6 * mL + 160) return r;
  if (mL > 90 && direction(u, m) < 0.1) return r;
  if (mL > 220 && frechet(normalize(u), normalize(m)) > 0.65 * lv) return r;
  r.ok = true;
  return r;
}

/**
 * Grade a drawn stroke against stroke `i` of a character.
 * why: 'order' (fits a later stroke), 'backwards' (right stroke, wrong way), 'miss'.
 */
export function grade(user: Median, medians: readonly Median[], i: number, lv = 1): GradeResult {
  const r = match(user, medians[i], lv);
  const later = (): boolean => {
    for (let j = i + 1; j < medians.length; j++) {
      const r2 = match(user, medians[j], lv);
      if (r2.ok && (!r.ok || r2.avg < r.avg * 0.6)) return true;
    }
    return false;
  };
  if (r.ok) return later() ? { ok: false, avg: r.avg, why: 'order' } : r;
  if (match(user.slice().reverse(), medians[i], lv).ok) return { ok: false, avg: r.avg, why: 'backwards' };
  return { ok: false, avg: r.avg, why: later() ? 'order' : 'miss' };
}
