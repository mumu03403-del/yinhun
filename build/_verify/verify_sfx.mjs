import fs from 'fs';
const OUT = 'C:/Users/37615/Projects/game/build/assets/audio';
const files = ['sfx_merge.mp3', 'sfx_settle.mp3', 'sfx_unlock.mp3'];
for (const f of files) {
  const fp = OUT + '/' + f;
  const buf = fs.readFileSync(fp);
  const b0 = buf[0], b1 = buf[1];
  const okHeader = b0 === 0xFF && b1 >= 0xE0 && b1 <= 0xFB;
  console.log(`${f.padEnd(18)} size=${buf.length} bytes  header=${b0.toString(16)} ${b1.toString(16)}  valid=${okHeader}`);
}
