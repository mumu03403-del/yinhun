// 横板平A小游戏逻辑烟测：提取 index.html 内联 <script>，桩 DOM 后 boot + 模拟 update 帧。
// 仅验证：spawn / attack / score / win 流程不抛错；金币接到 state.coins。
import fs from 'fs';

const htmlPath = 'C:/Users/37615/Projects/game/build/h5-fallback/index.html';
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('NO_SCRIPT'); process.exit(2); }
const code = m[1];

// ---- 桩 DOM ----
const gradient = { addColorStop() {} };
const ctxStub = new Proxy({}, {
  get(t, p) {
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => gradient;
    if (p === 'canvas') return { width: 375, height: 812 };
    if (p === 'measureText') return () => ({ width: 10 });
    return () => undefined; // 其余全部 no-op
  },
  set() { return true; }
});
const canvasStub = {
  width: 0, height: 0, style: {},
  getContext() { return ctxStub; },
  addEventListener() {},
  setPointerCapture() {},
  getBoundingClientRect() { return { left: 0, top: 0, width: 375, height: 812 }; }
};
function setG(name, val) {
  try { Object.defineProperty(globalThis, name, { value: val, writable: true, configurable: true }); }
  catch (e) { try { globalThis[name] = val; } catch (_) {} }
}
setG('window', global);
setG('navigator', { userAgent: 'node' });
setG('innerWidth', 375);
setG('innerHeight', 812);
setG('devicePixelRatio', 2);
setG('location', { reload() {} });
setG('confirm', () => false);
setG('addEventListener', () => {});
global.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};
global.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
global.requestAnimationFrame = () => 0; // 不自动循环，手动 tick
global.Image = function () { this.onload = null; this.onerror = null; this.src = ''; };
global.Audio = function () { this.play = () => ({ catch() {} }); this.preload = ''; this.currentTime = 0; this.src = ''; };
global.document = {
  getElementById(id) {
    if (id === 'cv') return canvasStub;
    if (id === 'rot') return { classList: { toggle() {} } };
    return { style: {}, classList: { toggle() {} }, appendChild() {} };
  },
  createElement() { return { style: {}, classList: { toggle() {} }, appendChild() {} }; },
  documentElement: { appendChild() {} },
  addEventListener() {},
  hidden: false
};
global.addEventListener = () => {};

// ---- 执行脚本 ----
try {
  (0, eval)(code);
} catch (e) {
  console.error('BOOT_THROW', e && e.stack || e);
  process.exit(3);
}

const G = global.window.__game;
console.log('ready=', G.isReady(), 'version=', G.version);
if (!G.isReady()) { console.error('NOT_READY'); process.exit(4); }

// 校验：菜单按钮避开 GOMOKU_BTN(584-632) / RESET_BTN(740-788)
const BB = G.brawler.buttons;
const overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const GOMOKU = G.gomoku.buttons.entry, RESET = G.layout.RESET_BTN;
console.log('BRAWLER_BTN y=', BB.entry.y, 'vs GOMOKU y=', GOMOKU.y, 'RESET y=', RESET.y);
console.log('overlapGomoku=', overlap(BB.entry, GOMOKU), 'overlapReset=', overlap(BB.entry, RESET));

// 打开横板平A并模拟战斗
G.brawler.open();
const coinsAtOpen = G.state.coins;
let sawEnemy = false, sawScore = false, threw = null;
let frames = 0;
try {
  for (let t = 0; t < 3000; t++) {
    if (t % 3 === 0) G.brawler.attack();     // 每 ~0.15s 平A 一次（窗口 0.2s 连续覆盖）
    G.tick(0.05);
    G.brawler.draw();                          // 每帧也跑绘制路径，确保不抛错
    if (G.brawler.enemies() > 0) sawEnemy = true;
    if (G.brawler.score() > 0) sawScore = true;
    frames++;
    if (G.brawler.isOver()) break;
  }
} catch (e) { threw = e && e.stack || e; }

const coinsAfter = G.state.coins;
console.log('frames=', frames, 'over=', G.brawler.isOver(), 'result=', G.brawler.result(),
  'wave=', G.brawler.wave(), 'score=', G.brawler.score());
console.log('sawEnemy=', sawEnemy, 'sawScore=', sawScore, 'drawThrow=', threw ? ('YES ' + threw) : 'no');
console.log('coinsAtOpen=', Math.floor(coinsAtOpen), 'coinsAfter=', Math.floor(coinsAfter),
  'delta=', Math.floor(coinsAfter - coinsAtOpen));

// 断言
let ok = true;
if (threw) { console.error('FAIL: draw/update threw'); ok = false; }
if (!sawEnemy) { console.error('FAIL: 未生成敌人'); ok = false; }
if (!sawScore) { console.error('FAIL: 未击杀计分'); ok = false; }
if (!G.brawler.isOver()) { console.error('FAIL: 3000 帧未结束'); ok = false; }
if (G.brawler.result() !== '通关！') { console.error('FAIL: 未通关, result=' + G.brawler.result()); ok = false; }
if (G.brawler.score() !== 14) { console.error('FAIL: 计分应为 14, 实际 ' + G.brawler.score()); ok = false; }
if ((coinsAfter - coinsAtOpen) < 2000) { console.error('FAIL: 通关奖励未接到 state.coins'); ok = false; }
console.log(ok ? 'SMOKE_OK' : 'SMOKE_FAIL');
process.exit(ok ? 0 : 1);
