/**
 * 验证「双击本地文件直接打开」这条路径是否可用（file:// 协议）
 * 老板最省事的玩法就是把 index.html 拖进浏览器 —— 必须确认它真的能跑。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FILE_URL = 'file:///C:/Users/37615/Projects/game/build/h5-fallback/index.html';
const PORT = 9334;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/37615/Projects/game-build-tmp/chrome-file-profile',
  'about:blank'
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map(); const evs = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method && evs.has(m.method)) { const a = evs.get(m.method); evs.delete(m.method); a.forEach((f) => f(m.params)); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params })); });
const waitEv = (m) => new Promise((res) => { const a = evs.get(m) || []; a.push(res); evs.set(m, a); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
});

await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
const lp = waitEv('Page.loadEventFired');
await send('Page.navigate', { url: FILE_URL });
await lp;
await sleep(800);

// 先确定性清档再测：否则上一轮遗留的存档会弹「离线收益」弹窗，
// 而弹窗会吞掉第一次手势（这是正确行为，但会让测试误判）
async function reloadClean() {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try{localStorage.clear();}catch(e){}'
  });
  const p = waitEv('Page.loadEventFired');
  await send('Page.reload', {});
  await p;
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await sleep(700);
}
await reloadClean();

const r = await evaluate(`(async () => {
  const g = window.__game;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (!g) return JSON.stringify({ ready: false, reason: '__game 未定义' });
  let lsOk = true, lsMsg = '';
  try { localStorage.setItem('__filetest', '1'); localStorage.removeItem('__filetest'); }
  catch (e) { lsOk = false; lsMsg = String(e.name + ': ' + e.message); }
  const modalAtStart = g.isModalOpen();
  const c0 = g.coinsPerSecond(), coins0 = g.state.coins;
  await sleep(1200);
  const coins1 = g.state.coins;
  // 触发一次合并，确认交互在 file:// 下同样可用
  const L = g.layout;
  const canvas = document.getElementById('cv');
  const ptOf = (rr, cc) => g.toClient(L.GRID_X + cc * (L.CELL + L.GAP) + L.CELL / 2,
                                      L.GRID_Y + rr * (L.CELL + L.GAP) + L.CELL / 2);
  const ones = []; g.state.cells.forEach((v, i) => { if (v === 1) ones.push({ r: Math.floor(i / L.COLS), c: i % L.COLS }); });
  const a = ptOf(ones[0].r, ones[0].c), b = ptOf(ones[1].r, ones[1].c);
  const fire = (t, p) => canvas.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true,
    pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
  fire('pointerdown', a); await sleep(40); fire('pointermove', b); await sleep(40); fire('pointerup', b); await sleep(200);

  // T-007 三项修复在 file:// 下同样生效
  const cs = g.allTierContrasts();
  const minRatio = cs.reduce((m, c) => Math.min(m, c.ratio), 99);
  g.state.highestTier = g.maxTier;
  const lastCard = g.isLastCardUnlocked();
  let settleOk = false, settleGain = 0;
  {
    const keep = g.state.cells.slice();
    for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = 0;
    g.state.cells[0] = g.maxTier;
    const c0 = g.state.coins;
    settleOk = g.doSettle(0) === true && g.state.cells[0] === 0;
    settleGain = g.state.coins - c0;
    for (let i = 0; i < g.state.cells.length; i++) g.state.cells[i] = keep[i];
    g.state.highestTier = 2;
  }

  return JSON.stringify({
    ready: g.isReady(), tier1: g.state.cells.filter(v => v === 1).length,
    tier2: g.state.cells.filter(v => v === 2).length, cps: c0, coins0, coins1,
    idleWorks: coins1 > coins0, lsOk, lsMsg, merges: g.state.merges,
    modalAtStart, settleOk, settleGain, lastCard, minContrast: minRatio
  });
})()`);

console.log('file:// 直开检测结果:');
console.log(r);
console.log('页面异常数: ' + errs.length + (errs.length ? ' -> ' + errs.slice(0, 2).join(' ;; ') : ''));
writeResult(r, errs);

function writeResult(r, errs) {
  const tag = process.env.TAG || 'v110_';
  import('node:fs').then((fs) => {
    fs.writeFileSync(`C:/Users/37615/Projects/game/build/_evidence/file_protocol_check_${tag.replace(/_$/, '')}.json`,
      JSON.stringify({ tag, result: JSON.parse(r), pageErrors: errs }, null, 2));
  });
}

ws.close();
chrome.kill();
