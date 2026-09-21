import fs from 'fs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node inspect_assets.mjs <dir>'); process.exit(1); }

const files = fs.readdirSync(dir).sort();
console.log('DIR:', dir);
console.log('COUNT:', files.length);
console.log('---');

function inspectPNG(buf) {
  // signature 8 bytes, then IHDR chunk: length(4) 'IHDR'(4) width(4) height(4) bitDepth(1) colorType(1)...
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const hasAlpha = (colorType === 4 || colorType === 6);
  const palette = (colorType === 3);
  // detect tRNS chunk (palette transparency) by scanning chunks
  let hasTRNS = false;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tRNS') { hasTRNS = true; break; }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return { w, h, bitDepth, colorType, hasAlpha: hasAlpha || (palette && hasTRNS), palette };
}

function inspectJPEG(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  let w = 0, h = 0, found = false;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    // SOF0..SOF15 except SOF8..SOF11 (extended/arithmetic/progressive variants still have dims)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      h = buf.readUInt16BE(off + 5);
      w = buf.readUInt16BE(off + 7);
      found = true;
      break;
    }
    const len = buf.readUInt16BE(off + 2);
    off += 2 + len;
  }
  return found ? { w, h } : null;
}

const rows = [];
for (const f of files) {
  const p = dir + '/' + f;
  let stat;
  try { stat = fs.statSync(p); } catch { continue; }
  if (!stat.isFile()) continue;
  const sizeKB = (stat.size / 1024).toFixed(1);
  const buf = fs.readFileSync(p);
  let info = 'UNKNOWN';
  if (buf.length >= 26) {
    const png = inspectPNG(buf);
    if (png) info = `PNG ${png.w}x${png.h} bit${png.bitDepth} ctype${png.colorType} alpha:${png.hasAlpha}`;
    else {
      const jpg = inspectJPEG(buf);
      if (jpg) info = `JPEG ${jpg.w}x${jpg.h} (NO alpha)`;
    }
  }
  rows.push({ f, sizeKB, info });
}

for (const r of rows) {
  console.log(`${r.f.padEnd(40)} ${String(r.sizeKB).padStart(8)}KB  ${r.info}`);
}

// summary
const pngs = rows.filter(r => r.info.startsWith('PNG'));
const jpgs = rows.filter(r => r.info.startsWith('JPEG'));
const alpha = pngs.filter(r => r.info.includes('alpha:true'));
const noalpha = pngs.filter(r => r.info.includes('alpha:false'));
console.log('---');
console.log(`PNG: ${pngs.length}  JPEG: ${jpgs.length}  PNG-with-alpha: ${alpha.length}  PNG-no-alpha: ${noalpha.length}`);
