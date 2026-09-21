import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire('C:/Users/37615/.workbuddy/binaries/node/workspace/');
const jpeg = require('jpeg-js');

const IN_DIR = 'C:/Users/37615/Downloads/银魂二创角色图_12张/银魂二创角色图';
const OUT_DIR = 'C:/Users/37615/Projects/game/build/assets/codex_compare';
fs.mkdirSync(OUT_DIR, { recursive: true });

const cards = ['01_坂田银时.png', '09_伊丽莎白.png'];

for (const name of cards) {
  const raw = fs.readFileSync(path.join(IN_DIR, name));
  const img = jpeg.decode(raw, { useTArray: true });
  const { width: W, height: H, data } = img;

  // sample background color from bottom-right corner
  let r = 0, g = 0, b = 0, n = 0;
  const x0 = Math.floor(W * 0.7), y0 = Math.floor(H * 0.85);
  for (let y = y0; y < H; y++) for (let x = x0; x < W; x++) {
    const i = (y * W + x) * 4; r += data[i]; g += data[i+1]; b += data[i+2]; n++;
  }
  r /= n; g /= n; b /= n;

  // masked variant: hide left calligraphy region by blending toward bg
  const masked = Buffer.from(data); // copy
  const m1 = W * 0.30, m2 = W * 0.42;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    if (x < m1) a = 1; else if (x < m2) a = 1 - (x - m1) / (m2 - m1);
    if (a <= 0) continue;
    const i = (y * W + x) * 4;
    masked[i]   = data[i]   * (1 - a) + r * a;
    masked[i+1] = data[i+1] * (1 - a) + g * a;
    masked[i+2] = data[i+2] * (1 - a) + b * a;
  }

  const base = name.replace(/\.png$/i, '');
  // A: original (re-encode for consistent viewing)
  const aBuf = jpeg.encode({ width: W, height: H, data }, 88);
  fs.writeFileSync(path.join(OUT_DIR, `${base}_A_原图.jpg`), Buffer.from(aBuf.data));
  // B: masked
  const bBuf = jpeg.encode({ width: W, height: H, data: masked }, 88);
  fs.writeFileSync(path.join(OUT_DIR, `${base}_B_遮字.jpg`), Buffer.from(bBuf.data));
  console.log(`OK ${base}: W${W} maskHide<${Math.round(m1)}px blendTo<${Math.round(m2)}px bg=(${r|0},${g|0},${b|0})`);
}
console.log('输出:', OUT_DIR);
