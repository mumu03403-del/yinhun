const fs = require('fs');
const { execSync } = require('child_process');
const nodeExe = process.execPath;
const files = [
  'C:/Users/37615/Projects/game/build/publish/index.html',
  'C:/Users/37615/Projects/game/build/publish/action.html',
  'C:/Users/37615/Projects/game/build/publish/sfx_preview.html'
];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  let all = '';
  for (const blk of blocks) all += blk.replace(/^<script>/, '').replace(/<\/script>$/, '') + '\n';
  const tmp = f.replace(/\.html$/, '.check.js');
  fs.writeFileSync(tmp, all);
  try {
    execSync('"' + nodeExe + '" --check "' + tmp + '"', { stdio: 'pipe' });
    console.log('OK   ' + f.split('/').pop());
  } catch (e) {
    console.log('ERR  ' + f.split('/').pop() + '\n' + (e.stderr || e.stdout || e.message));
  }
  try { fs.unlinkSync(tmp); } catch (e) {}
}
