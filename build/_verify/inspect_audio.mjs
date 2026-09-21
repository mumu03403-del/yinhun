import fs from 'fs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node inspect_audio.mjs <dir>'); process.exit(1); }

const files = fs.readdirSync(dir).filter(f => {
  try { return fs.statSync(dir + '/' + f).isFile(); } catch { return false; }
}).sort();

console.log('DIR:', dir, '  COUNT:', files.length);
console.log('---');

const MP3_BR_V1L3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
const MP3_BR_V2L3 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
const MP3_SR_V1 = [44100,48000,32000];
const MP3_SR_V2 = [22050,24000,16000];
const MP3_SR_V25 = [11025,12000,8000];

function mp3Frame(buf) {
  let off = (buf.toString('ascii',0,3) === 'ID3') ? 10 + ((buf[6]<<21)|(buf[7]<<14)|(buf[8]<<7)|buf[9]) : 0;
  const end = Math.min(buf.length, off + 200_000);
  let i = off;
  while (i + 4 <= end) {
    if ((buf[i] & 0xFF) === 0xFF && (buf[i+1] & 0xE0) === 0xE0) {
      const h1 = buf[i+1], h2 = buf[i+2];
      const ver = (h1 >> 3) & 3, layer = (h1 >> 1) & 3; // version/layer live in byte1
      if (layer !== 1) { i++; continue; }
      const br = (ver === 3 ? MP3_BR_V1L3 : MP3_BR_V2L3)[(h2 >> 4) & 0xF];
      const sr = (ver === 3 ? MP3_SR_V1 : (ver === 2 ? MP3_SR_V2 : MP3_SR_V25))[(h2 >> 2) & 3];
      if (!br || !sr) { i++; continue; }
      const pad = (h2 >> 1) & 1;
      const spf = (ver === 3) ? 1152 : 576;
      const frameLen = Math.floor((spf / 8) * br * 1000 / sr) + pad;
      return { br, sr, frameLen };
    }
    i++;
  }
  return null;
}

// returns {fmt, sr, ch, bps, dataOff, dataLen, maxAbs, dur}
function analyze(buf) {
  // WAV?
  if (buf.toString('ascii',0,4) === 'RIFF' && buf.toString('ascii',8,12) === 'WAVE') {
    const audioFormat = buf.readUInt16LE(20);
    const ch = buf.readUInt16LE(22);
    const sr = buf.readUInt32LE(24);
    const bps = buf.readUInt16LE(34);
    let off = 12, dOff = -1, dLen = 0;
    while (off + 8 <= buf.length) {
      const type = buf.toString('ascii', off, off+4);
      let len = buf.readUInt32LE(off+4);
      if (len > buf.length) len = 0;
      if (type === 'data') { dOff = off+8; dLen = (len === 0xFFFFFFFF || len === 0) ? (buf.length - (off+8)) : len; break; }
      if (len === 0) break;
      off += 8 + len + (len & 1);
    }
    let maxAbs = 0;
    if (dOff >= 0 && audioFormat === 1 && bps === 16) {
      const step = Math.max(2, Math.floor(dLen / (20 * 2))); // ~20 sample windows
      for (let k = 0; k + 1 < dLen; k += step) { const v = Math.abs(buf.readInt16LE(dOff + k)); if (v > maxAbs) maxAbs = v; }
    }
    const dur = (dLen > 0) ? dLen / (sr * ch * (bps/8)) : 0;
    return { fmt: 'WAV', sr, ch, bps, dOff, dLen, maxAbs, dur };
  }
  // MP3?
  const fr = mp3Frame(buf);
  if (fr) { const dur = buf.length / (fr.br * 125); return { fmt: 'MP3', sr: fr.sr, ch: 0, bps: 0, dOff: -1, dLen: 0, maxAbs: -1, dur }; }
  // M4A?
  if (buf.toString('ascii',4,8) === 'ftyp') return { fmt: 'M4A', sr: 0, ch: 0, bps: 0, dOff: -1, dLen: 0, maxAbs: -1, dur: 0 };
  if (buf.toString('ascii',0,4) === 'OggS') return { fmt: 'OGG', sr: 0, ch: 0, bps: 0, dOff: -1, dLen: 0, maxAbs: -1, dur: 0 };
  return { fmt: 'UNKNOWN', sr: 0, ch: 0, bps: 0, dOff: -1, dLen: 0, maxAbs: -1, dur: 0 };
}

const rows = [];
for (const f of files) {
  const p = dir + '/' + f;
  const st = fs.statSync(p);
  let buf;
  try { buf = fs.readFileSync(p); } catch (e) { rows.push({ f, sizeKB: '?', info: 'READ_ERR ' + e.code, ok: false, silent: null }); continue; }
  let a;
  try { a = analyze(buf); } catch (e) { rows.push({ f, sizeKB: (st.size/1024).toFixed(1), info: 'PARSE_ERR ' + e.message, ok: false, silent: null }); continue; }
  const sizeKB = (st.size / 1024).toFixed(1);
  let info = `${a.fmt} ${a.sr}Hz ${a.ch}ch ${a.bps}bit ~${a.dur.toFixed(2)}s`;
  let silent = null;
  if (a.fmt === 'WAV' && a.maxAbs >= 0) { silent = a.maxAbs < 100; if (silent) info += ' [⚠疑似静音/损坏]'; }
  const ok = a.fmt !== 'UNKNOWN';
  rows.push({ f, sizeKB, info, ok, silent });
}

for (const r of rows) console.log(`${r.f.padEnd(46)} ${String(r.sizeKB).padStart(9)}KB  ${r.info}`);
const fmtCount = {};
for (const r of rows) { const k = r.info.split(' ')[0]; fmtCount[k] = (fmtCount[k]||0)+1; }
const silentFiles = rows.filter(r => r.silent === true);
console.log('---');
console.log('格式分布:', JSON.stringify(fmtCount));
console.log('可识别:', rows.filter(r => r.ok).length, '/', rows.length);
console.log('疑似静音/损坏:', silentFiles.length ? silentFiles.map(r=>r.f).join(' | ') : '无');
