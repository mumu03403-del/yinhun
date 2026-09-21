import fs from 'fs';
const dir = process.argv[2];
const names = process.argv.slice(3);
for (const name of names) {
  const p = dir + '/' + name;
  const buf = fs.readFileSync(p);
  console.log('====', name, 'size', buf.length);
  const audioFormat = buf.readUInt16LE(20);
  const ch = buf.readUInt16LE(22);
  const sr = buf.readUInt32LE(24);
  const bps = buf.readUInt16LE(34);
  console.log('audioFormat(1=PCM):', audioFormat, 'ch:', ch, 'sr:', sr, 'bps:', bps);
  let off = 12, dOff = -1, dLen = 0;
  while (off + 8 <= buf.length) {
    const type = buf.toString('ascii', off, off+4);
    let len = buf.readUInt32LE(off+4);
    if (len > buf.length) len = 0;
    if (type === 'data') { dOff = off + 8; dLen = (len === 0xFFFFFFFF || len === 0) ? (buf.length - (off+8)) : len; break; }
    if (len === 0) break;
    off += 8 + len + (len & 1);
  }
  console.log('dataOff', dOff, 'dataLen', dLen);
  if (dOff >= 0 && audioFormat === 1 && bps === 16) {
    const cnt = Math.min(dLen - 1, 65536);
    let min = 32767, max = -32768, sumsq = 0, n = 0;
    for (let k = 0; k + 1 < cnt; k += 2) { const v = buf.readInt16LE(dOff + k); if (v<min)min=v; if(v>max)max=v; sumsq+=v*v; n++; }
    console.log('min', min, 'max', max, 'rms', Math.sqrt(sumsq/n).toFixed(1), '=>', (max-min<200?'疑似静音/损坏':'有真实音频 ✓'));
  } else {
    console.log('skip PCM sample');
  }
}
