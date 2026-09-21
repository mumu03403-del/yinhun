/**
 * H5 兜底版 · 真机等价自动化验收（CDP 真实时钟驱动）
 *
 * 为什么不用 --virtual-time-budget：
 *   虚拟时钟会跳过 rAF 帧与 Date.now() 的真实推进，导致「放置收益随时间增长」
 *   与「离线收益」两项产生假阴性。这里改走 Chrome DevTools Protocol，
 *   用真实时间等待 + 真实指针事件，并逐阶段截图取证。
 *
 * 依赖：本机 Chrome + Node 22 内置 WebSocket（不安装任何全局依赖）
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:8099/index.html';
const OUT = 'C:/Users/37615/Projects/game/build/_evidence';
const PROFILE = 'C:/Users/37615/Projects/game-build-tmp/chrome-cdp-profile';
const PORT = 9333;
// 证据文件前缀：T-007 修复后重跑时不覆盖 v1.0.0 的旧证据
const TAG = process.env.TAG || 'v110_';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail !== undefined ? '  | ' + detail : ''}`);
}

/* ---------------- 1. 启动 Chrome ---------------- */
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank'
], { stdio: 'ignore' });

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('Chrome DevTools 端口未就绪');
}

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const eventWaiters = new Map();

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) rej(new Error(JSON.stringify(m.error)));
    else res(m.result);
    return;
  }
  if (m.method && eventWaiters.has(m.method)) {
    const waiters = eventWaiters.get(m.method);
    eventWaiters.delete(m.method);
    waiters.forEach((w) => w(m.params));
  }
};

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function waitEvent(method, timeout = 20000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('等待事件超时: ' + method)), timeout);
    const arr = eventWaiters.get(method) || [];
    arr.push((p) => { clearTimeout(t); res(p); });
    eventWaiters.set(method, arr);
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error('页面内脚本异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
  }
  return r.result.value;
}

/**
 * 在「新文档创建后、页面自身脚本执行前」注入一段脚本，然后刷新。
 * 用于确定性地清档 / 写入伪造存档 —— 避免旧页面在刷新前的自动存档把数据覆盖掉。
 */
async function reloadWithPreScript(source) {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source });
  const p = waitEvent('Page.loadEventFired');
  await send('Page.reload', { ignoreCache: false });
  await p;
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await sleep(700);
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${TAG}${name}`, Buffer.from(r.data, 'base64'));
  console.log(`  -> 截图 ${TAG}${name}`);
}

/* ---------------- 2. 初始化 ---------------- */
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Log.enable');

// 手机等价视口：375×812 逻辑像素
await send('Emulation.setDeviceMetricsOverride', {
  width: 375, height: 812, deviceScaleFactor: 2, mobile: true
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// 收集页面 console error / 未捕获异常
const pageErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(String(m.params.exceptionDetails.text) + ' ' +
      JSON.stringify(m.params.exceptionDetails.exception?.description || ''));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});

// 网络层监听：捕获美术资源 404 / 加载失败（资源缺失会让 assetsLoaded 计数不足）
const failedAssets = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.responseReceived') {
    const u = m.params.response?.url || '';
    const st = m.params.response?.status || 0;
    if (u.includes('/assets/') && st >= 400) failedAssets.push(st + ' ' + u);
  }
  if (m.method === 'Network.loadingFailed') {
    const u = (m.params.request?.url) || String(m.params.errorText || '');
    if (u.includes('/assets/')) failedAssets.push('FAIL ' + u);
  }
});

const loadP = waitEvent('Page.loadEventFired');
await send('Page.navigate', { url: BASE });
await loadP;
await sleep(400);

/* ---------------- 3. 阶段化验收 ---------------- */
console.log('\n=== 阶段 0：清空存档，干净开局 ===');
await reloadWithPreScript('try{localStorage.clear();}catch(e){}');

console.log('\n=== 阶段 0b（新增）：美术资源异步加载 + 换皮钩子 ===');
let assetsPoll = null;
for (let t = 0; t < 80; t++) {
  const a = await evaluate('(window.__game && window.__game.assetsLoaded) ? JSON.stringify(window.__game.assetsLoaded()) : null');
  if (a) { assetsPoll = JSON.parse(a); if (assetsPoll.board === 12 && assetsPoll.codex === 12 && assetsPoll.audio === 12) break; }
  await sleep(100);
}
check('美术资源全部加载（board/codex/audio 各 12）', assetsPoll && assetsPoll.board === 12 && assetsPoll.codex === 12 && assetsPoll.audio === 12,
  assetsPoll ? `board=${assetsPoll.board}, codex=${assetsPoll.codex}, audio=${assetsPoll.audio}` : 'assetsLoaded 不可用');
check('无美术资源 404 / 加载失败', failedAssets.length === 0,
  failedAssets.length ? failedAssets.slice(0, 5).join(' ;; ') : '0 条');
check('页面无 JS 异常（含资源加载路径）', pageErrors.length === 0,
  pageErrors.length ? pageErrors.slice(0, 3).join(' ;; ') : '0 条异常');
const ver = await evaluate('window.__game.version');
const crm = await evaluate('window.__game.coinRateMax');
check('版本号已升级为 h5-fallback-2.4.0', ver === 'h5-fallback-2.4.0', 'version=' + ver);
check('最高档产出 coinRateMax = 177147', crm === 177147, 'coinRateMax=' + crm);

const viewport = await evaluate(`JSON.stringify({
  iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio,
  ready: !!(window.__game && window.__game.isReady())
})`);
console.log('  视口: ' + viewport);
const vp = JSON.parse(viewport);
check('手机视口 375×812 生效', vp.iw === 375 && vp.ih === 812, `${vp.iw}×${vp.ih} dpr=${vp.dpr}`);
check('页面脚本加载完成（__gameReady）', vp.ready === true);

console.log('\n=== 阶段 1：开局状态 + 放置收益（真实时间等待 2.2s）===');
const p1 = await evaluate(`(() => {
  const g = window.__game;
  return JSON.stringify({
    cells: g.state.cells.length,
    tier1: g.state.cells.filter(v => v === 1).length,
    cps: g.coinsPerSecond(),
    coins: g.state.coins,
    highestTier: g.state.highestTier
  });
})()`);
const s1 = JSON.parse(p1);
check('网格 5 列 × 4 行 = 20 格', s1.cells === 20, '格数=' + s1.cells);
check('开局自动放置 6 个 1 档单位', s1.tier1 === 6, '1 档数量=' + s1.tier1);
check('每秒产出 = 6 × 1/s = 6', s1.cps === 6, 'cps=' + s1.cps);
await sleep(2200);
const coinsAfter = await evaluate('window.__game.state.coins');
check('金币按真实时间自动增长（放置收益生效）', coinsAfter > s1.coins + 5,
  `${s1.coins.toFixed(2)} -> ${coinsAfter.toFixed(2)}（2.2s 内 +${(coinsAfter - s1.coins).toFixed(2)}）`);
await shot('01_开局_6个1档单位_金币增长.png');

console.log('\n=== 阶段 2：拖拽合并（把 1 档拖到同档单位上）===');
const p2 = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const ptOf = (r, c) => g.toClient(
    L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'touch',
    isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: p.x, clientY: p.y
  }));
  const find = t => { const out = []; g.state.cells.forEach((v, i) => {
    if (v === t) out.push({ r: Math.floor(i / L.COLS), c: i % L.COLS }); }); return out; };

  const ones = find(1);
  const before1 = find(1).length, before2 = find(2).length;
  const a = ptOf(ones[0].r, ones[0].c), b = ptOf(ones[1].r, ones[1].c);
  fire('pointerdown', a); await sleep(50);
  fire('pointermove', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); await sleep(50);
  fire('pointermove', b); await sleep(50);
  fire('pointerup', b); await sleep(200);

  return JSON.stringify({
    before1, before2,
    after1: g.state.cells.filter(v => v === 1).length,
    after2: g.state.cells.filter(v => v === 2).length,
    merges: g.state.merges, highestTier: g.state.highestTier
  });
})()`);
const s2 = JSON.parse(p2);
check('拖拽合并成功：1 档 -2、2 档 +1',
  s2.after1 === s2.before1 - 2 && s2.after2 === s2.before2 + 1,
  `1 档 ${s2.before1}->${s2.after1}，2 档 ${s2.before2}->${s2.after2}`);
check('合成次数 +1', s2.merges === 1, 'merges=' + s2.merges);
check('图鉴解锁档位提升到 2 档', s2.highestTier === 2, 'highestTier=' + s2.highestTier);
await shot('02_拖拽合并后_出现2档.png');

console.log('\n=== 阶段 3（改为负向）：点选合并已禁用，仅拖拽可合并 ===');
const p3 = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const ptOf = (r, c) => g.toClient(
    L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const tap = async (p) => {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
      pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
      clientX: p.x, clientY: p.y }));
    await sleep(40);
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
      pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0,
      clientX: p.x, clientY: p.y }));
    await sleep(80);
  };
  const find = t => { const out = []; g.state.cells.forEach((v, i) => {
    if (v === t) out.push({ r: Math.floor(i / L.COLS), c: i % L.COLS }); }); return out; };

  const before1 = find(1).length;
  const beforeMerges = g.state.merges;
  const ones = find(1);
  await tap(ptOf(ones[0].r, ones[0].c));
  await tap(ptOf(ones[1].r, ones[1].c));
  return JSON.stringify({
    before1, after1: g.state.cells.filter(v => v === 1).length,
    beforeMerges, merges: g.state.merges
  });
})()`);
const s3 = JSON.parse(p3);
check('点选两个同档单位不触发合并（仅拖拽可合并）',
  s3.after1 === s3.before1, `1 档 ${s3.before1}->${s3.after1}（应不变）`);
check('点选不增加合成次数',
  s3.merges === s3.beforeMerges, `merges ${s3.beforeMerges}->${s3.merges}`);

console.log('\n=== 阶段 4：招募按钮 ===');
const p4 = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const b = L.SPAWN_BTN;
  const p = g.toClient(b.x + b.w / 2, b.y + b.h / 2);
  const filled = () => g.state.cells.filter(v => v > 0).length;
  const before = filled();
  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
    pointerId: 3, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: p.x, clientY: p.y }));
  await sleep(40);
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
    pointerId: 3, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: p.x, clientY: p.y }));
  await sleep(150);
  return JSON.stringify({ before, after: filled(), spawns: g.state.spawns });
})()`);
const s4 = JSON.parse(p4);
check('点击「招募 +1」放置 1 个新单位', s4.after === s4.before + 1,
  `占用格 ${s4.before}->${s4.after}`);

console.log('\n=== 阶段 5：图鉴面板开关 + 解锁展示 ===');
const p5 = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const b = L.COLL_BTN;
  const p = g.toClient(b.x + b.w / 2, b.y + b.h / 2);
  const tap = async () => {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
      pointerId: 4, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: p.x, clientY: p.y }));
    await sleep(40);
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
      pointerId: 4, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: p.x, clientY: p.y }));
    await sleep(120);
  };
  await tap();
  const opened = g.isCollectionOpen();
  return JSON.stringify({ opened, highestTier: g.state.highestTier });
})()`);
const s5 = JSON.parse(p5);
check('点击「图鉴」面板打开', s5.opened === true);
check('已解锁到 2 档（图鉴首卡应解锁）', s5.highestTier === 2, 'highestTier=' + s5.highestTier);
await shot('03_图鉴面板_已解锁首卡.png');

const p5b = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const b = L.COLL_BTN;
  const p = g.toClient(b.x + b.w / 2, b.y + b.h / 2);
  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
    pointerId: 5, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: p.x, clientY: p.y }));
  await sleep(40);
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
    pointerId: 5, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: p.x, clientY: p.y }));
  await sleep(120);
  return g.isCollectionOpen();
})()`);
check('再次点击「图鉴」面板关闭', p5b === false);

console.log('\n=== 阶段 5c（新增）：门槛负向——累计结算<3 时 6 档→7 档合并被拦截 ===');
const p5c = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const ptOf = (r, c) => g.toClient(L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
                                    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch',
    isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
  for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = 0;
  g.state.cells[0] = 6; g.state.cells[1] = 6;
  g.state.highestTier = 6; g.state.merges = 0; g.state.settles = 0;  // 门槛未达成
  const before6 = g.state.cells.filter(v => v === 6).length;
  const before7 = g.state.cells.filter(v => v === 7).length;
  const beforeMerges = g.state.merges;
  const a = ptOf(0, 0), b = ptOf(0, 1);
  fire('pointerdown', a); await sleep(50);
  fire('pointermove', b); await sleep(50);
  fire('pointerup', b); await sleep(200);
  return JSON.stringify({
    before6, before7, beforeMerges,
    after6: g.state.cells.filter(v => v === 6).length,
    after7: g.state.cells.filter(v => v === 7).length,
    merges: g.state.merges,
    tier7Unlocked: g.tier7Unlocked(),
    codex7Locked: g.codexCardUnlocked(6)
  });
})()`);
const s5c = JSON.parse(p5c);
check('累计结算<3 时 6 档→7 档被拦截（6 档数量不变）',
  s5c.after6 === s5c.before6, `6 档 ${s5c.before6}->${s5c.after6}`);
check('累计结算<3 时未生成 7 档（门槛生效，仍为 2 个 6 档）',
  s5c.after7 === 0 && s5c.after6 === 2, `7 档=${s5c.after7}, 6 档=${s5c.after6}, merges ${s5c.beforeMerges}->${s5c.merges}`);
check('门槛未达成时图鉴 7 档卡显示锁定（codexCardUnlocked(6)=false）',
  s5c.tier7Unlocked === false && s5c.codex7Locked === false,
  `tier7Unlocked=${s5c.tier7Unlocked}, codexCardUnlocked(6)=${s5c.codex7Locked}`);

console.log('\n=== 阶段 6（前置）：确保 7/8 档解锁门槛已满足（settles≥10 且 图鉴6/6）===');
const gateSet = await evaluate(`(() => {
  const g = window.__game;
  g.state.settles = 12;                                        // 累计结算 ≥ 10
  g.state.highestTier = Math.max(g.state.highestTier, 8);      // 图鉴 6/6（highestTier ≥ 6）
  return JSON.stringify({
    settles: g.state.settles, highestTier: g.state.highestTier,
    tier7: g.tier7Unlocked(), tier8: g.tier8Unlocked(),
    codex7: g.codexCardUnlocked(6), codex8: g.codexCardUnlocked(7)
  });
})()`);
const gs = JSON.parse(gateSet);
check('门槛前置满足：settles≥10 且 图鉴6/6（tier7/tier8 均解锁）',
  gs.settles >= 10 && gs.highestTier >= 6 && gs.tier7 === true && gs.tier8 === true,
  `settles=${gs.settles}, highestTier=${gs.highestTier}, tier7=${gs.tier7}, tier8=${gs.tier8}`);
check('门槛满足后图鉴 7/8 档卡均显示解锁',
  gs.codex7 === true && gs.codex8 === true, `codex7=${gs.codex7}, codex8=${gs.codex8}`);

console.log('\n=== 阶段 6：最高档上限（8 档不可再合并）===');
const p6 = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const ptOf = (r, c) => g.toClient(L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
                                    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 6, pointerType: 'touch',
    isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
  for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = 0;
  g.state.cells[0] = g.maxTier; g.state.cells[1] = g.maxTier; g.state.highestTier = g.maxTier;
  const a = ptOf(0, 0), b = ptOf(0, 1);
  fire('pointerdown', a); await sleep(50);
  fire('pointermove', b); await sleep(50);
  fire('pointerup', b); await sleep(200);
  return JSON.stringify({ c0: g.state.cells[0], c1: g.state.cells[1], maxTier: g.maxTier });
})()`);
const s6 = JSON.parse(p6);
check('两个 ' + s6.maxTier + ' 档无法再合并（上限生效）', s6.c0 === s6.maxTier && s6.c1 === s6.maxTier,
  `cells[0]=${s6.c0}, cells[1]=${s6.c1}`);

console.log('\n=== 阶段 6b（新增）：7 档 → 8 档拖拽合并 ===');
const p6b = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const ptOf = (r, c) => g.toClient(L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
                                    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 31, pointerType: 'touch',
    isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
  for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = 0;
  g.state.cells[0] = 7; g.state.cells[1] = 7; g.state.highestTier = 7;
  const before = { c0: g.state.cells[0], c1: g.state.cells[1], merges: g.state.merges };
  const a = ptOf(0, 0), b = ptOf(0, 1);
  fire('pointerdown', a); await sleep(50);
  fire('pointermove', b); await sleep(50);
  fire('pointerup', b); await sleep(200);
  return JSON.stringify({
    before,
    c0: g.state.cells[0], c1: g.state.cells[1],
    merges: g.state.merges, highestTier: g.state.highestTier
  });
})()`);
const s6b = JSON.parse(p6b);
check('拖拽合成 7 档 → 8 档成功（两个 7 档变一个 8 档）',
  (s6b.c0 === 8 && s6b.c1 === 0) || (s6b.c1 === 8 && s6b.c0 === 0),
  `cells[0]=${s6b.c0}, cells[1]=${s6b.c1}`);
check('合成 8 档后最高档位更新为 8', s6b.highestTier === 8, 'highestTier=' + s6b.highestTier);

console.log('\n=== 阶段 7：localStorage 存档写入 ===');
const p7 = await evaluate(`(() => {
  const g = window.__game;
  for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = 0;
  g.state.cells[0] = 3; g.state.cells[1] = 3; g.state.cells[2] = 3;
  g.state.coins = 1234; g.state.highestTier = 3; g.state.merges = 7;
  const ok = g.save();
  const raw = localStorage.getItem(g.saveKey);
  return JSON.stringify({ ok, len: raw ? raw.length : 0, key: g.saveKey, raw });
})()`);
const s7 = JSON.parse(p7);
check('save() 成功写入 localStorage', s7.ok === true && s7.len > 20,
  `key=${s7.key}, 字节数=${s7.len}`);

console.log('\n=== 阶段 8：刷新还原 + 离线收益（2 小时，50% 效率）===');
const cpsNow = await evaluate('window.__game.coinsPerSecond()');
check('3 个 3 档的每秒产出 = 3 × 9 = 27', cpsNow === 27, 'cps=' + cpsNow);

// 写入「2 小时前」的存档：在新文档脚本执行前注入，确保不被旧页面自动存档覆盖
const fake = JSON.parse(s7.raw);
fake.time = Date.now() - 2 * 3600 * 1000;
await reloadWithPreScript(
  `try{localStorage.setItem(${JSON.stringify(s7.key)}, ${JSON.stringify(JSON.stringify(fake))});}catch(e){}`);

const p8 = await evaluate(`(() => {
  const g = window.__game;
  return JSON.stringify({
    tier3: g.state.cells.filter(v => v === 3).length,
    tier1: g.state.cells.filter(v => v === 1).length,
    coins: Math.floor(g.state.coins),
    merges: g.state.merges,
    settles: g.state.settles,
    modal: g.isModalOpen()
  });
})()`);
const s8 = JSON.parse(p8);
check('刷新后存档还原：3 档数量 = 3', s8.tier3 === 3, '3 档数量=' + s8.tier3);
check('刷新后未重复发放开局单位', s8.tier1 === 0, '1 档数量=' + s8.tier1);
check('合成次数随存档保留 = 7', s8.merges === 7, 'merges=' + s8.merges);
check('结算次数随存档持久化（刷新后 settles 仍为 12）', s8.settles === 12, 'settles=' + s8.settles);
const expOff = Math.floor(27 * 7200 * 0.5);
const gotOff = s8.coins - 1234;
check(`离线 2 小时收益 = 27/s × 7200s × 50% = ${expOff}`,
  Math.abs(gotOff - expOff) <= 3, '实际离线收益 = ' + gotOff);
check('离线收益弹窗出现', s8.modal === true);
await shot('04_离线收益弹窗.png');

console.log('\n=== 阶段 9：离线超过 8 小时按 8 小时封顶 ===');
const fake2 = JSON.parse(s7.raw);
fake2.time = Date.now() - 48 * 3600 * 1000;
await reloadWithPreScript(
  `try{localStorage.setItem(${JSON.stringify(s7.key)}, ${JSON.stringify(JSON.stringify(fake2))});}catch(e){}`);
const coins9 = await evaluate('Math.floor(window.__game.state.coins)');
const expCap = Math.floor(27 * 8 * 3600 * 0.5);
check(`离线 48 小时只结算 8 小时：期望 ${expCap}`,
  Math.abs((coins9 - 1234) - expCap) <= 3, '实际离线收益 = ' + (coins9 - 1234));

// 关掉弹窗
await evaluate(`(async () => {
  const g = window.__game;
  const p = g.toClient(187.5, 468);
  const canvas = document.getElementById('cv');
  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
    pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: p.x, clientY: p.y }));
  await new Promise(r => setTimeout(r, 40));
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
    pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: p.x, clientY: p.y }));
  await new Promise(r => setTimeout(r, 200));
  return 1;
})()`);
const modalClosed = await evaluate('window.__game.isModalOpen()');
check('点击「开始游戏」弹窗关闭', modalClosed === false);
await shot('05_离线收益封顶后_弹窗关闭.png');

console.log('\n=== 阶段 10：稳定性（连续运行 3s 无异常）===');
pageErrors.length = 0;
await reloadWithPreScript('try{localStorage.clear();}catch(e){}');
await sleep(3000);
const fresh = await evaluate(`(() => {
  const g = window.__game;
  return JSON.stringify({
    tier1: g.state.cells.filter(v => v === 1).length,
    cps: g.coinsPerSecond(),
    coins: Math.floor(g.state.coins),
    modal: g.isModalOpen()
  });
})()`);
const s10 = JSON.parse(fresh);
check('清档刷新后回到干净开局（6 个 1 档）', s10.tier1 === 6, '1 档数量=' + s10.tier1);
check('清档后金币从 0 重新累积', s10.coins > 0 && s10.coins < 100, 'coins=' + s10.coins);
check('长时间运行无 JS 异常（含动画期间）', pageErrors.length === 0,
  pageErrors.length ? pageErrors.slice(0, 3).join(' ;; ') : '0 条异常');
await shot('06_重置存档后_干净开局.png');

// 再触发一轮连续合成，专门压测动画路径是否抛错
const stress = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const ptOf = (r, c) => g.toClient(L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
                                    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const fire = (t, p) => canvas.dispatchEvent(new PointerEvent(t, {
    bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch',
    isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
  const drag = async (a, b) => { fire('pointerdown', a); await sleep(40);
    fire('pointermove', b); await sleep(40); fire('pointerup', b); await sleep(130); };
  let merges = 0;
  for (let round = 0; round < 6; round++) {
    const ones = [];
    g.state.cells.forEach((v, i) => { if (v === 1) ones.push({ r: Math.floor(i / L.COLS), c: i % L.COLS }); });
    if (ones.length < 2) { for (let k = 0; k < 3; k++) g.spawnTier1(); continue; }
    await drag(ptOf(ones[0].r, ones[0].c), ptOf(ones[1].r, ones[1].c));
    merges++;
  }
  await sleep(900);   // 让所有动画跑完
  return JSON.stringify({ merges, highestTier: g.state.highestTier,
    cps: g.coinsPerSecond(), coins: Math.floor(g.state.coins) });
})()`);
const st = JSON.parse(stress);
check('连续 6 轮快速合成不中断主循环（动画路径无异常）', pageErrors.length === 0,
  pageErrors.length ? pageErrors.slice(0, 2).join(' ;; ') : `${st.merges} 轮合成后 highestTier=${st.highestTier}`);
await shot('07_连续合成压测后.png');

/* ---------------- T-007 新增验收 ---------------- */
console.log('\n=== 阶段 11（新增）：满级单位长按结算 —— 破「满级死锁」===');
pageErrors.length = 0;
await reloadWithPreScript('try{localStorage.clear();}catch(e){}');

const settleConst = await evaluate(`JSON.stringify({
  maxTier: window.__game.maxTier,
  longPressMs: window.__game.longPressMs,
  settleSeconds: window.__game.settleSeconds,
  valueAtMax: window.__game.settleValue(window.__game.maxTier),
  coinRateMax: window.__game.coinRateMax,
  expect: window.__game.settleSeconds * window.__game.coinRateMax
})`);
const sc = JSON.parse(settleConst);
check('结算时长规范 = 30 秒产出', sc.settleSeconds === 30, 'settleSeconds=' + sc.settleSeconds);
check('长按阈值 = 500ms', sc.longPressMs === 500, 'longPressMs=' + sc.longPressMs);
check(sc.maxTier + ' 档结算值 = ' + sc.settleSeconds + ' × ' + sc.coinRateMax + ' = ' + sc.expect,
  sc.valueAtMax === sc.expect,
  'settleValue(' + sc.maxTier + ')=' + sc.valueAtMax + '，独立算式=' + sc.expect);

// 11a 判定价正确（纯逻辑）
const a1 = await evaluate(`JSON.stringify((() => {
  const g = window.__game;
  for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = 0;
  g.state.cells[0] = g.maxTier;
  g.state.coins = 0;
  g.state.settles = 0;
  const ok = g.doSettle(0);
  return { ok, cell0: g.state.cells[0], coins: g.state.coins, settles: g.state.settles,
           cps: g.coinsPerSecond() };
})())`);
const s11a = JSON.parse(a1);
check('满级单位可被结算（不再死锁）', s11a.ok === true && s11a.cell0 === 0,
  `doSettle 返回 ${s11a.ok}，结算后 cells[0]=${s11a.cell0}`);
check('结算满级（' + sc.maxTier + ' 档）单位金额精确 = ' + sc.valueAtMax + ' 金币', s11a.coins === sc.valueAtMax, 'coins=' + s11a.coins);
check('结算后该格不再产出（cps 归零）', s11a.cps === 0, 'cps=' + s11a.cps);
check('结算次数 +1', s11a.settles === 1, 'settles=' + s11a.settles);

// 11b 真机场景：整个棋盘被满级单位填满 → 长按其中一个 → 棋盘恢复可玩
// 拆成两段执行，好让「长按进行中」的进度环能被真实截到图
const a2a = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const ptOf = (r, c) => g.toClient(L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
                                    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const fire = (t, p) => canvas.dispatchEvent(new PointerEvent(t, {
    bubbles: true, cancelable: true, pointerId: 21, pointerType: 'touch',
    isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));

  // 用满级单位塞满全部 20 格 —— 这就是「死锁」场景
  for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = g.maxTier;
  g.state.coins = 0; g.state.settles = 0;
  const fullBefore = g.state.cells.filter(v => v > 0).length;
  const spawnWhileFull = g.spawnTier1();        // 满格时招募应失败
  const p0 = ptOf(0, 0);

  // (1) 短按 250ms（< 500ms 阈值）：不应触发结算
  fire('pointerdown', p0);
  await sleep(250);
  const shortPressActive = g.isPressActive();
  fire('pointerup', p0);
  await sleep(150);
  const afterShort = g.state.settles;

  // (2) 长按：按下后先不松手，停在进度环中途供截图
  fire('pointerdown', p0);
  await sleep(120);
  return JSON.stringify({
    fullBefore, spawnWhileFull, shortPressActive, afterShort,
    pressActive: g.isPressActive(),
    stillFull: g.state.cells.filter(v => v === g.maxTier).length
  });
})()`);
const s11b = JSON.parse(a2a);
check('死锁场景构造成功：20 格全被满级单位填满', s11b.fullBefore === 20, '占用格=' + s11b.fullBefore);
check('满格时招募失败（确实处于死锁态）', s11b.spawnWhileFull === false, 'spawnTier1 返回 ' + s11b.spawnWhileFull);
check('短按 < 阈值时进度已激活但不会误结算',
  s11b.shortPressActive === true && s11b.afterShort === 0,
  `按下 250ms 进度激活=${s11b.shortPressActive}，松手后 settles=${s11b.afterShort}`);
check('长按进行中进度环已激活', s11b.pressActive === true, 'isPressActive=' + s11b.pressActive);
check('进度中棋盘仍为满盘（尚未结算）', s11b.stillFull === 20, '满级格数=' + s11b.stillFull);
await shot('08_满级棋盘_长按进度环进行中.png');

// (3) 越过 500ms 阈值让计时器触发结算，再松手
const a2b = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const ptOf = (r, c) => g.toClient(L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
                                    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const fire = (t, p) => canvas.dispatchEvent(new PointerEvent(t, {
    bubbles: true, cancelable: true, pointerId: 21, pointerType: 'touch',
    isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
  const coinsBefore = g.state.coins;
  await sleep(700);                       // 累计长按 > 500ms
  const afterLongCells = g.state.cells[0];
  const afterLongSettles = g.state.settles;
  const coinsAtSettle = g.state.coins;
  fire('pointerup', ptOf(0, 0));
  await sleep(200);
  const spawnAfterRelease = g.spawnTier1();
  return JSON.stringify({
    afterLongCells, afterLongSettles, spawnAfterRelease,
    coinsGained: coinsAtSettle - coinsBefore,
    occupiedAfter: g.state.cells.filter(v => v > 0).length
  });
})()`);
const s11c = JSON.parse(a2b);
check('越过 500ms 阈值后满级格子被释放', s11c.afterLongCells === 0, 'cells[0]=' + s11c.afterLongCells);
check('长按结算计数 = 1', s11c.afterLongSettles === 1, 'settles=' + s11c.afterLongSettles);
check('结算金币增加（含同时段放置收益，应 ≥ ' + sc.valueAtMax + '）', s11c.coinsGained >= sc.valueAtMax,
  '结算瞬间金币 +' + Math.floor(s11c.coinsGained));
check('释放后棋盘恢复可玩（招募重新成功）', s11c.spawnAfterRelease === true,
  '释放后占用=' + s11c.occupiedAfter + '，spawnTier1 返回 ' + s11c.spawnAfterRelease);
await sleep(900);
await shot('09_长按结算后_格子已释放.png');

console.log('\n=== 阶段 12（新增）：最高档位时最后一张图鉴卡必须解锁 ===');
const b1 = await evaluate(`JSON.stringify((() => {
  const g = window.__game, n = g.maxTier;
  const out = { maxTier: n, cases: [] };
  for (let h = 1; h <= n; h++) {
    g.state.highestTier = h;
    out.cases.push({ highestTier: h, cards: g.unlockedCardCount(), last: g.isLastCardUnlocked() });
  }
  g.state.highestTier = n;
  out.expectedFull = n;
  out.lastCardAtMax = g.cardUnlocked(n - 1);
  out.secondToLast = (g.state.highestTier = n - 1, g.cardUnlocked(n - 1));
  g.state.highestTier = n;
  out.totalCards = g.unlockedCardCount();
  return out;
})())`);
const s12 = JSON.parse(b1);
check('达到最高档位后最后一张卡解锁（off-by-one 已修）', s12.lastCardAtMax === true,
  `highestTier=${s12.maxTier} 时 cardUnlocked(${s12.maxTier - 1})=${s12.lastCardAtMax}`);
check('最高档位时全部 ' + s12.maxTier + ' 张卡都解锁', s12.totalCards === s12.maxTier,
  `已解锁 ${s12.totalCards}/${s12.maxTier}`);
check('未达最高档位时最后一张卡仍锁定（解锁有梯度）', s12.secondToLast === false,
  `highestTier=${s12.maxTier - 1} 时最后一张卡解锁=${s12.secondToLast}`);
check('第 1 张卡对应 1 档形态（开局即可见）', s12.cases[0].cards === 1,
  'highestTier=1 时已解锁 ' + s12.cases[0].cards + ' 张');
check('解锁数量随档位单调递增且逐步 +1',
  s12.cases.every((c, i) => c.cards === i + 1),
  s12.cases.map((c) => c.highestTier + '档:' + c.cards).join(' '));

// 真机路径：合出最高档 → 图鉴面板里确实显示满卡
const b2 = await evaluate(`(async () => {
  const g = window.__game, L = g.layout;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('cv');
  const tapAt = async (p) => {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
      pointerId: 22, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: p.x, clientY: p.y }));
    await sleep(40);
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
      pointerId: 22, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: p.x, clientY: p.y }));
    await sleep(120);
  };
  // 棋盘摆两个 (maxTier-1) 档，真机拖拽合成出最高档
  for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = 0;
  g.state.cells[0] = g.maxTier - 1;
  g.state.cells[1] = g.maxTier - 1;
  g.state.highestTier = g.maxTier - 1;
  g.state.settles = 40; g.state.highestTier = 11;   // 12 档门槛：累计结算 ≥ 40 且 图鉴10/10（highestTier≥10）
  const before = { tier: g.state.cells[0], last: g.isLastCardUnlocked(), cards: g.unlockedCardCount() };

  const ptOf = (r, c) => g.toClient(L.GRID_X + c * (L.CELL + L.GAP) + L.CELL / 2,
                                    L.GRID_Y + r * (L.CELL + L.GAP) + L.CELL / 2);
  const fire = (t, p) => canvas.dispatchEvent(new PointerEvent(t, {
    bubbles: true, cancelable: true, pointerId: 23, pointerType: 'touch',
    isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
  const a = ptOf(0, 0), b = ptOf(0, 1);
  fire('pointerdown', a); await sleep(40); fire('pointermove', b); await sleep(40);
  fire('pointerup', b); await sleep(250);

  const after = { tier: g.state.cells[1], highestTier: g.state.highestTier,
                  last: g.isLastCardUnlocked(), cards: g.unlockedCardCount() };

  // 打开图鉴看一眼
  const cb = L.COLL_BTN;
  await tapAt(g.toClient(cb.x + cb.w / 2, cb.y + cb.h / 2));
  const opened = g.isCollectionOpen();
  return JSON.stringify({ before, after, opened });
})()`);
const s12b = JSON.parse(b2);
check('真机拖拽合出最高档位 (' + s12b.after.tier + ' 档)',
  s12b.after.tier === s12b.before.tier + 1, `${s12b.before.tier} 档 → ${s12b.after.tier} 档`);
check('合出最高档的瞬间最后一张卡解锁',
  s12b.before.last === false && s12b.after.last === true,
  `合成前=${s12b.before.last}，合成后=${s12b.after.last}`);
check('图鉴计数走满 ' + s12b.after.cards + '/' + s12b.after.highestTier,
  s12b.after.cards === s12b.after.highestTier, `已解锁 ${s12b.after.cards} 张`);
check('图鉴面板可打开以查看满卡', s12b.opened === true);
await shot('10_图鉴_最后一张卡已解锁.png');

console.log('\n=== 阶段 13（新增）：档位文字对比度达标（WCAG AA ≥ 4.5:1）===');
const c1 = await evaluate('JSON.stringify(window.__game.allTierContrasts())');
const contrasts = JSON.parse(c1);
console.log('  各档位实测对比度：');
contrasts.forEach((c) => console.log(`    ${c.tier} 档 ${c.color} → 文字 ${c.text}  ${c.ratio}:1`));
const worst = contrasts.reduce((m, c) => (c.ratio < m.ratio ? c : m), contrasts[0]);
check('全部 ' + contrasts.length + ' 个档位的文字对比度均 ≥ 4.5:1（WCAG AA）',
  contrasts.every((c) => c.ratio >= 4.5),
  `最低为 ${worst.tier} 档 ${worst.color}（${worst.ratio}:1）`);
check('4 档黄色 #f1c40f 的对比度已从 1.66:1 提升到 ≥ 4.5:1',
  contrasts[3].ratio >= 4.5, `4 档实测 ${contrasts[3].ratio}:1，文字色 ${contrasts[3].text}`);
check('高亮底色自动改用深色文字（不再压白字）',
  contrasts.filter((c) => c.text !== '#ffffff').length >= 1,
  contrasts.filter((c) => c.text !== '#ffffff').map((c) => c.tier + '档').join('/') + ' 使用深色文字');

const failed = results.filter((r) => !r.ok);
console.log('\n================ 验收汇总 ================');
console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  - ' + f.name + '  |  ' + f.detail));
}
writeFileSync(`${OUT}/selftest_result_${TAG.replace(/_$/, '')}.json`,
  JSON.stringify({ tag: TAG, results, pageErrors }, null, 2));

ws.close();
chrome.kill();
process.exit(failed.length ? 1 : 0);
