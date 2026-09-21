import fs from 'fs';
import path from 'path';
const Lmod = await import('file:///C:/Users/37615/.workbuddy/binaries/node/workspace/node_modules/@breezystack/lamejs/dist/lamejs.js');
const L = Lmod.Mp3Encoder ? Lmod : Lmod.default;

const SRC = 'C:/Users/37615/Downloads/银魂口头禅音频 (2)/银魂口头禅音频';
const OUT = 'C:/Users/37615/Projects/game/build/assets/audio';
const TARGET_SR = 44100;
const KBPS = 96;
const SILENCE_THRESH = 300; // |Int16| below this ~ silence

fs.mkdirSync(OUT, { recursive: true });

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  const audioFormat = buf.readUInt16LE(20);
  const ch = buf.readUInt16LE(22);
  const sr = buf.readUInt32LE(24);
  const bps = buf.readUInt16LE(34);
  let off = 12, dOff = -1, dLen = 0;
  while (off + 8 <= buf.length) {
    const type = buf.toString('ascii', off, off + 4);
    let len = buf.readUInt32LE(off + 4);
    if (len > buf.length) len = 0;
    if (type === 'data') { dOff = off + 8; dLen = (len === 0xFFFFFFFF || len === 0) ? (buf.length - (off + 8)) : len; break; }
    if (len === 0) break;
    off += 8 + len + (len & 1);
  }
  if (dOff < 0 || audioFormat !== 1 || bps !== 16) return null;
  // interleaved Int16
  const total = Math.floor(dLen / 2);
  const pcm = new Int16Array(total);
  for (let i = 0; i < total; i++) pcm[i] = buf.readInt16LE(dOff + i * 2);
  return { pcm, ch, sr };
}

function toMono(pcm, ch) {
  if (ch === 1) return pcm;
  const n = Math.floor(pcm.length / ch);
  const mono = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; for (let c = 0; c < ch; c++) s += pcm[i * ch + c];
    mono[i] = (s / ch) | 0;
  }
  return mono;
}

function resample(inBuf, inSr, outSr) {
  if (inSr === outSr) return inBuf;
  const ratio = outSr / inSr;
  const outLen = Math.round(inBuf.length * ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src), i1 = Math.min(i0 + 1, inBuf.length - 1);
    const frac = src - i0;
    out[i] = (inBuf[i0] * (1 - frac) + inBuf[i1] * frac) | 0;
  }
  return out;
}

function trimSilence(samples) {
  let start = 0; while (start < samples.length && Math.abs(samples[start]) < SILENCE_THRESH) start++;
  let end = samples.length - 1; while (end > start && Math.abs(samples[end]) < SILENCE_THRESH) end--;
  return samples.subarray(start, end + 1);
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

const files = fs.readdirSync(SRC).filter(f => f.toLowerCase().endsWith('.wav'));
const manifest = [];
console.log('SRC:', SRC, 'files:', files.length);
for (const f of files) {
  const buf = fs.readFileSync(path.join(SRC, f));
  const w = parseWav(buf);
  if (!w) { console.log(`SKIP ${f} (not PCM16 WAV)`); continue; }
  const inDur = w.pcm.length / w.ch / w.sr;
  let mono = toMono(w.pcm, w.ch);
  mono = resample(mono, w.sr, TARGET_SR);
  mono = trimSilence(mono);
  const mp3 = encodeMp3(mono, TARGET_SR, KBPS);
  const char = f.split('_')[0];
  const outName = `voice_${char}.mp3`;
  fs.writeFileSync(path.join(OUT, outName), mp3);
  const outDur = mono.length / TARGET_SR;
  manifest.push({ original: f, output: outName, inDur: +inDur.toFixed(2), outDur: +outDur.toFixed(2), kb: +(mp3.length/1024).toFixed(1) });
  console.log(`${outName.padEnd(22)} in ${inDur.toFixed(2)}s -> out ${outDur.toFixed(2)}s  ${(mp3.length/1024).toFixed(1)}KB`);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('---');
console.log('输出目录:', OUT, ' 共', manifest.length, '个');
