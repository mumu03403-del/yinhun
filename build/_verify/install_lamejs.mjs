import fs from 'fs';
import path from 'path';
import cp from 'child_process';

const TMP = 'C:/Users/37615/Projects/game/build/_verify/_tmp_lamejs';
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ name: 'tmp-lamejs', private: true }, null, 2));

const target = path.join(TMP, 'node_modules', '@breezystack', 'lamejs', 'dist', 'lamejs.js');
if (fs.existsSync(target)) {
  console.log('ALREADY_INSTALLED', target);
  process.exit(0);
}
try {
  const out = cp.execSync('npm install @breezystack/lamejs --no-audit --no-fund', { cwd: TMP, encoding: 'utf8' });
  console.log(out);
} catch (e) {
  console.log('INSTALL_ERR', e.message);
  process.exit(1);
}
if (fs.existsSync(target)) console.log('INSTALLED', target);
else console.log('NOT_FOUND', target);
