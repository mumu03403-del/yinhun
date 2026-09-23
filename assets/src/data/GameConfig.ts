/**
 * 游戏配置（数值全部对齐 H5 v2.8.0：build/publish/index.html）
 * 所有颜色为纯色十六进制；角色名为银魂风格命名（占位美术，无任何版权素材）。
 *
 * 与 H5 的对应关系：
 *   gridCols         ← GRID_COLS            (index.html:59)
 *   maxRows          ← MAX_ROWS             (index.html:60)
 *   defaultRows      ← GRID_ROWS 默认值      (index.html:61)
 *   maxTier          ← MAX_TIER             (index.html:66)
 *   tierColors       ← TIER_COLORS          (index.html:68-72)
 *   coinRate         ← COIN_RATE            (index.html:74)
 *   characterNames   ← CHARACTER_NAMES      (index.html:76-81)
 *   rowUnlockPrices  ← ROW_UNLOCK_PRICES    (index.html:64)
 */

/** 把 '#rrggbb' 转成 {r,g,b,a} 普通结构，由调用方构造 cc.Color */
export function hexToColor(hex: string): any {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b, a: 255 };
}

/** 字色深/浅常量（index.html:136-137） */
export const TEXT_DARK = '#141414';
export const TEXT_LIGHT = '#ffffff';

/** sRGB 相对亮度（index.html:1524-1532） */
function srgbLum(hex: string): number {
  const h = hex.replace('#', '');
  const ch: number[] = [];
  for (let k = 0; k < 3; k++) {
    const v = parseInt(h.substring(k * 2, k * 2 + 2), 16) / 255;
    ch.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  }
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** 对比度（index.html:1534-1538） */
function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2) + 0.05;
  const lo = Math.min(l1, l2) + 0.05;
  return hi / lo;
}

/** 依背景亮度自动在黑/白之间选字色（index.html:1540-1543） */
export function contrastText(hex: string): string {
  const L = srgbLum(hex);
  return contrastRatio(1, L) >= contrastRatio(L, srgbLum(TEXT_DARK)) ? TEXT_LIGHT : TEXT_DARK;
}

/**
 * 大数缩写：1234 → 1.23K（对齐 H5 index.html:1637-1656）
 *   · NaN / Infinity 一律显示 '0'，杜绝 "NaN" / "InfinityQi"；
 *   · 单位表在 Qi(1e18) 之上补 Si(1e21) / Sp(1e24) / Oc(1e27)；
 *   · 「进位不换单位」修复：四舍五入后若已达 1000，继续升一档
 *     （999500 必须显示 1.00M，而不是 1000K）。
 */
const FMT_UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Si', 'Sp', 'Oc'];
export function fmt(n: number): string {
  let v = Number(n);
  if (!isFinite(v)) return '0';
  v = Math.floor(v);
  if (v < 0) v = 0;
  if (v < 1000) return String(v);
  let u = 0;
  while (v >= 1000 && u < FMT_UNITS.length - 1) { v = v / 1000; u++; }
  let digits = v < 10 ? 2 : (v < 100 ? 1 : 0);
  let rounded = Number(v.toFixed(digits));
  while (rounded >= 1000 && u < FMT_UNITS.length - 1) {
    v /= 1000; u++;
    digits = v < 10 ? 2 : (v < 100 ? 1 : 0);
    rounded = Number(v.toFixed(digits));
  }
  return rounded.toFixed(digits) + FMT_UNITS[u];
}

export const GameConfig = {
  /** 棋盘列数（H5 GRID_COLS = 6） */
  gridCols: 6,
  /** 棋盘行数上限（H5 MAX_ROWS = 10，可解锁） */
  maxRows: 10,
  /** 默认已解锁行数（H5 GRID_ROWS 初始 = 5） */
  defaultRows: 5,
  /** 最高档位，达到后不再合并、可长按变现（H5 MAX_TIER = 24） */
  maxTier: 24,

  /** 每个档位的底色（tier 从 1 开始索引），24 档 */
  tierColors: [
    '#7f8c8d', '#3498db', '#2ecc71', '#f1c40f', '#e67e22', '#e74c3c', '#8e44ad', '#16a085',
    '#154360', '#aed6f1', '#1b2631', '#d4ac0d', '#e84393', '#00cec9', '#6c5ce7', '#fd79a8',
    '#fab1a0', '#00b894', '#0984e3', '#b2bec3', '#636e72', '#e17055', '#a29bfe', '#ffeaa7',
  ],

  /** 每个档位每秒产出金币：coinRate[t-1] = 3^(t-1)，24 档 */
  coinRate: [
    1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683, 59049, 177147,
    531441, 1594323, 4782969, 14348907, 43046721, 129140163, 387420489, 1162261467,
    3486784401, 10460353203, 31381059609, 94143178827,
  ],

  /** 24 档角色名（index.html:76-81） */
  characterNames: [
    '坂田银时', '志村新八', '神乐', '定春', '近藤勋', '土方十四郎',
    '冲田总悟', '桂小太郎', '伊丽莎白', '高杉晋助', '神威', '虚（吉田松阳）',
    '山崎退', '柳生九兵衛', '月詠', 'お登勢', 'キャサリン', '長谷川泰三',
    '武蔵', '岡田似蔵', '来島また子', '徳川茂茂', '幾松', '坂本辰馬',
  ],

  /** 解锁第 N 行的金币价格（key = 解锁后的行数，6→10 共 5 次） */
  rowUnlockPrices: { 6: 1000, 7: 2000, 8: 4000, 9: 8000, 10: 16000 } as { [rows: number]: number },

  /** 长按满级单位多少毫秒触发变现（H5 LONG_PRESS_MS = 500） */
  longPressMs: 500,
  /** 变现折算为该档多少秒的产出（H5 SETTLE_SECONDS = 30） */
  settleSeconds: 30,
  /** 离线收益上限秒数 = 8 小时（H5 OFFLINE_CAP_SEC = 8*3600） */
  offlineCapSec: 8 * 3600,
  /** 离线收益效率（H5 OFFLINE_EFFICIENCY = 0.5） */
  offlineEfficiency: 0.5,
  /** 自动放置间隔秒（H5 AUTO_SPAWN_INTERVAL = 15） */
  autoSpawnInterval: 15,
  /** 本地存档键（H5 SAVE_KEY） */
  saveKey: 'merge_samurai_save_v1',

  /** 开局自动放置的 1 档单位数量（H5 INITIAL_UNITS = 6） */
  initialUnits: 6,

  /** 图鉴每档碎片上限（H5 中为字面量 10） */
  fragmentMax: 10,
};

export type GameConfigType = typeof GameConfig;
