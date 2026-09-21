const fs = require('fs');
const root = 'C:/Users/37615/Projects/game/build';
function walk(p, depth) {
  let out = '';
  try {
    const items = fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const it of items) {
      const full = p + '/' + it.name;
      if (it.isDirectory()) { out += '  '.repeat(depth) + '[' + it.name + ']\n' + walk(full, depth + 1); }
      else { const sz = fs.statSync(full).size; out += '  '.repeat(depth) + it.name + ' (' + Math.round(sz / 1024) + 'KB)\n'; }
    }
  } catch (e) { out += '  ERR ' + e.message + '\n'; }
  return out;
}
let r = '';
for (const d of ['publish/assets', 'assets']) {
  r += '== ' + d + ' == (exists ' + fs.existsSync(root + '/' + d) + ')\n';
  if (fs.existsSync(root + '/' + d)) r += walk(root + '/' + d, 1);
}
fs.writeFileSync(root + '/_verify/fs_map3.txt', r);

// concise summary to stdout
function countDir(d, pred) {
  const dir = root + '/' + d;
  if (!fs.existsSync(dir)) return 'MISSING';
  return fs.readdirSync(dir).filter(pred).length;
}
const pubCodex = countDir('publish/assets/codex', f => f.endsWith('.png'));
const pubAudio = countDir('publish/assets/audio', f => f.endsWith('.mp3'));
const bAudio = countDir('assets/audio', f => f.endsWith('.mp3'));
const sfxInPub = fs.existsSync(root + '/publish/assets/audio/sfx_merge.mp3');
const sfxInBuild = fs.existsSync(root + '/assets/audio/sfx_merge.mp3');
console.log('PUB codex png=' + pubCodex + ' audio mp3=' + pubAudio + ' sfxInPub=' + sfxInPub);
console.log('BUILD audio mp3=' + bAudio + ' sfxInBuild=' + sfxInBuild);
