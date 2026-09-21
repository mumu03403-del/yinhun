'use strict';
// 备份当前线上冻结版 publish/index.html，并把它同步成已通过 57/57 的 h5-fallback/index.html。
// 安全性：先校验 publish 仍是已知冻结 sha256，不一致则中止，绝不盲目覆盖。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const H5 = 'C:/Users/37615/Projects/game/build/h5-fallback/index.html';
const PUB = 'C:/Users/37615/Projects/game/build/publish/index.html';
const BACKUP_DIR = 'C:/Users/37615/Projects/game/build/_backups';
// 已知冻结基线（守卫语义：仅当 publish 等于此 sha 时才覆盖，否则中止，防盲覆盖）：
//  - 占位美术 v1.4.0（e6d9b32…）
//  - 占位美术版（4d9931b…）
//  - 银魂换皮 v2.0.0（815b5d7f…）
//  - 银魂换皮 v2.1.0 同步后线上 publish 实际 sha = 47402ce4…（上一轮守卫常量未及时对齐，本次已校正）。
//  - 银魂换皮 v2.4.0（本次）经 sync_publish 同步后，线上 publish/index.html = ca5583f9…，守卫基线对齐到此。
const EXPECTED_FROZEN = 'ca5583f93599931668557393775837a7e16cab8a72ea6034e3947ae7626db872';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// 整棵资源目录的 sha256（按文件内容拼接），用于校验部署一致性
function sha256Tree(dir) {
  let files = 0;
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { files++; h.update(fs.readFileSync(p)); }
    }
  };
  walk(dir);
  return { files, sha: h.digest('hex') };
}

if (!fs.existsSync(H5)) { console.error('ABORT: h5-fallback/index.html 不存在'); process.exit(2); }
if (!fs.existsSync(PUB)) { console.error('ABORT: publish/index.html 不存在'); process.exit(2); }

const pubBefore = sha256(PUB);
const h5 = sha256(H5);
console.log('h5-fallback     sha256:', h5, 'size:', fs.statSync(H5).size);
console.log('publish before  sha256:', pubBefore, 'size:', fs.statSync(PUB).size);
console.log('frozen expected      :', EXPECTED_FROZEN);

if (pubBefore !== EXPECTED_FROZEN) {
  console.error('ABORT: 当前 publish/index.html 不是已知冻结版（sha256 不符），先人工核对再同步。');
  process.exit(2);
}
if (h5 === pubBefore) {
  console.log('INFO: h5-fallback 与冻结版一致，无需同步（可能未改动或已同步）。');
  process.exit(0);
}

// 1) 备份冻结版（落盘到 build/_backups，避免污染待部署的 build/publish）
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(BACKUP_DIR, `index_publish_frozen_${ts}.html`);
fs.copyFileSync(PUB, backup);
console.log('backup frozen ->', backup, sha256(backup) === pubBefore ? '(sha256 一致)' : '(sha256 异常!)');

// 2) 同步 h5-fallback -> publish
fs.copyFileSync(H5, PUB);
const pubAfter = sha256(PUB);
console.log('publish after   sha256:', pubAfter, 'size:', fs.statSync(PUB).size);
console.log(pubAfter === h5 ? 'OK: publish 已与 h5-fallback 逐字节一致' : 'ERROR: 同步后 sha256 不一致');

// 3) 同步美术资源（index.html 之外还需 assets/）
const ASSETS_SRC = 'C:/Users/37615/Projects/game/build/h5-fallback/assets';
const ASSETS_DST = 'C:/Users/37615/Projects/game/build/publish/assets';
if (!fs.existsSync(ASSETS_SRC)) {
  console.error('WARN: h5-fallback/assets 不存在，跳过资源同步');
} else {
  fs.mkdirSync(ASSETS_DST, { recursive: true });
  fs.cpSync(ASSETS_SRC, ASSETS_DST, { recursive: true });
  const ai = sha256Tree(ASSETS_SRC);
  console.log('assets copied  ->', ASSETS_DST, 'files:', ai.files, 'sha256:', ai.sha);
}

process.exit(pubAfter === h5 ? 0 : 1);
