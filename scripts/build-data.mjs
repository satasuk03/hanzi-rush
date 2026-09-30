// Merge enriched vocab chunks (data/raw/hsk{n}_{k}.json) into public/data/hsk{n}.json.
// - fixes pinyin where the source list picked a surname/variant reading
// - trims glosses so they fit on quiz buttons
// Source word lists: data/source/hsk{n}.json (complete-hsk-vocabulary, CC-CEDICT based).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(root, 'data/raw');
const SRC = path.join(root, 'data/source');
const OUT = path.join(root, 'public/data');
fs.mkdirSync(OUT, { recursive: true });
const OVERRIDES = JSON.parse(fs.readFileSync(path.join(root, 'data/overrides.json'), 'utf8'));

const BAD_SENSE = /^(surname|variant of|old variant|archaic|used in|see |\(old\)|abbr\. for|Japanese variant)/i;

/** join CEDICT-style "Zhōng guó" → "Zhōngguó", adding ' before a/e/o-initial syllables */
function joinPinyin(p) {
  const parts = p.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.some((s) => /[，,·]/.test(s))) return p;
  return parts
    .map((s, i) => (i > 0 && /^[aeoāáǎàēéěèōóǒò]/i.test(s) ? "'" + s : s))
    .join('');
}

function bestSourcePinyin(entry) {
  const forms = entry.forms ?? [];
  const good = forms.find((f) => f.meanings?.length && !BAD_SENSE.test(f.meanings[0])) ?? forms[0];
  return good?.transcriptions?.pinyin ?? '';
}

function cleanEn(s) {
  let v = String(s).split(';')[0].trim();
  v = v.replace(/\s*\((?:surname|classifier|measure word)[^)]*\)/gi, '').trim();
  return v;
}

function cleanTh(s) {
  const segs = String(s)
    .split(/\s*[\/;,，]\s*/)
    .map((x) => x.replace(/\s*\([^)]*\)\s*/g, ' ').trim())
    .filter(Boolean);
  let v = (segs.find((x) => !/นามสกุล|แซ่/.test(x)) ?? segs[0] ?? '').trim();
  // "สัญลักษณ์ เครื่องหมาย" = two synonyms separated by a space → keep the first
  if (v.length > 14 && v.includes(' ')) v = v.split(' ')[0];
  return v;
}

/** surname readings leak capitals ("Xuě") — lowercase unless the meaning is a proper noun */
function fixCase(p, en) {
  return /^[A-Z]/.test(en) ? p : p.charAt(0).toLowerCase() + p.slice(1);
}

const totals = [];
for (let n = 1; n <= 6; n++) {
  const src = JSON.parse(fs.readFileSync(path.join(SRC, `hsk${n}.json`), 'utf8'));
  const srcFirst = new Map(src.map((e) => [e.simplified, e.forms[0].transcriptions.pinyin]));
  const srcBest = new Map(src.map((e) => [e.simplified, bestSourcePinyin(e)]));

  const chunks = fs
    .readdirSync(RAW)
    .filter((f) => f.startsWith(`hsk${n}_`))
    .sort();
  const words = [];
  const seen = new Set();
  let fixed = 0;
  for (const f of chunks) {
    for (const w of JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'))) {
      if (seen.has(w.h)) continue;
      seen.add(w.h);
      const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
      let p = w.p;
      // agent kept the (possibly wrong) first-form reading → use the better source form
      if (norm(p) === norm(srcFirst.get(w.h) ?? '') && srcBest.get(w.h) && norm(srcBest.get(w.h)) !== norm(p)) {
        p = srcBest.get(w.h);
        fixed++;
      }
      const o = OVERRIDES[w.h] ?? {};
      const en = o.en ?? cleanEn(w.en);
      words.push({
        h: w.h,
        p: o.p ?? fixCase(joinPinyin(p), en),
        en,
        th: o.th ?? cleanTh(w.th),
        ex: o.ex ?? { zh: w.ex.zh, py: w.ex.py, en: w.ex.en, th: w.ex.th },
      });
    }
  }
  fs.writeFileSync(path.join(OUT, `hsk${n}.json`), JSON.stringify(words));
  totals.push(`HSK${n}: ${words.length} words (${fixed} pinyin fixed)`);
}
console.log(totals.join('\n'));
