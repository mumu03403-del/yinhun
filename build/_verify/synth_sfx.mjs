import fs from 'fs';
import path from 'path';

// Reuse the working lamejs import pattern from convert_audio.mjs
const Lmod = await import('file:///C:/Users/37615/Projects/game/build/_verify/_tmp_lamejs/node_modules/@breezystack/lamejs/dist/lamejs.js');
const L = Lmod.Mp3Encoder ? Lmod : Lmod.default;

const SR = 44100;
const KBPS = 96;
const OUT = 'C:/Users/37615/Projects/game/build/assets/audio';
fs.mkdirSync(OUT, { recursive: true });

// ---- Procedural PCM generators (Float32, -1..1, mono, 44100) ----

function genMerge() {
  // ~0.25s short rising "blip" — merge success
  const dur = 0.25;
  const buf = new Float32Array(Math.floor(dur * SR));
  const f0 = 440, f1 = 880;
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const p = i / buf.length;
    const freq = f0 + (f1 - f0) * p;
    const e = Math.sin(Math.PI * p); // smooth up/down envelope
    buf[i] = 0.6 * e * Math.sin(2 * Math.PI * freq * t)
           + 0.15 * e * Math.sin(2 * Math.PI * freq * 2 * t);
  }
  return buf;
}

function addBell(buf, t0, dur, freq, amp) {
  const n = Math.floor(dur * SR);
  const start = Math.floor(t0 * SR);
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const p = i / n;
    const e = Math.pow(1 - p, 2.2); // exponential-ish decay
    buf[idx] += amp * e * (
        Math.sin(2 * Math.PI * freq * i / SR)
      + 0.5 * Math.sin(2 * Math.PI * freq * 2.01 * i / SR)
      + 0.25 * Math.sin(2 * Math.PI * freq * 3.0 * i / SR));
  }
}

function genSettle() {
  // ~0.4s coin/chime "ding" — settle/兑换
  const dur = 0.4;
  const buf = new Float32Array(Math.floor(dur * SR));
  addBell(buf, 0.0, 0.13, 988.0, 0.5);   // B5
  addBell(buf, 0.10, 0.30, 1318.5, 0.55); // E6
  return buf;
}

function genUnlock() {
  // ~0.8s ascending arpeggio + sparkle — 图鉴解锁庆祝
  const dur = 0.8;
  const buf = new Float32Array(Math.floor(dur * SR));
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  const step = 0.13;
  notes.forEach((f, k) => addBell(buf, k * step, 0.26, f, 0.42));
  // sparkle: shimmering high freq with tremolo near the tail
  const sp = Math.floor(0.5 * SR);
  for (let i = 0; i < buf.length - sp; i++) {
    const idx = sp + i;
    const p = i / (buf.length - sp);
    const e = Math.pow(1 - p, 1.5);
    const trem = 0.5 + 0.5 * Math.sin(2 * Math.PI * 32 * i / SR);
    const f = 4000 + 2200 * Math.sin(2 * Math.PI * 7 * i / SR);
    buf[idx] += 0.18 * e * trem * Math.sin(2 * Math.PI * f * i / SR);
  }
  return buf;
}

function toInt16(buf) {
  let max = 0;
  for (const v of buf) { const a = Math.abs(v); if (a > max) max = a; }
  const norm = max > 0 ? 0.92 / max : 1;
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const s = Math.round(buf[i] * norm * 32767);
    out[i] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
  }
  return out;
}

function encodeMp3(mono, sr, kbps) {
  const enc = new L.Mp3Encoder(1, sr, kbps);
  const block = 1152;
  const chunks = [];
  for (let i = 0; i < mono.length; i += block) {
    const b = mono.subarray(i, i + block);
    const o = enc.encodeBuffer(b);
    if (o.length) chunks.push(Buffer.from(o));
  }
  const f = enc.flush();
  if (f.length) chunks.push(Buffer.from(f));
  return Buffer.concat(chunks);
}

const jobs = [
  ['sfx_merge.mp3', genMerge()],
  ['sfx_settle.mp3', genSettle()],
  ['sfx_unlock.mp3', genUnlock()],
];

const sizes = {};
for (const [name, pcm] of jobs) {
  const mono = toInt16(pcm);
  const mp3 = encodeMp3(mono, SR, KBPS);
  const fp = path.join(OUT, name);
  fs.writeFileSync(fp, mp3);
  sizes[name] = mp3.length;
  console.log(`${name.padEnd(18)} ${(mp3.length / 1024).toFixed(1)}KB`);
}
console.log('OUT:', OUT);
process.stdout.write('SIZES_JSON:' + JSON.stringify(sizes) + '\n');
