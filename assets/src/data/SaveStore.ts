/**
 * 本地存档读写：移植 H5 的 build/publish/index.html:555-632，
 * 存储介质换成 cc.sys.localStorage（微信小游戏 / 浏览器均可用）。
 *
 * 存档结构与 H5 完全对齐，便于后续与 H5 版本互相迁移：
 *   { v, cells, coins, highestTier, merges, spawns, settles,
 *     unlockedRows, fragments, codexDone, recruitCounts, adUnlockedTiers, time }
 */
import { sys } from 'cc';
import { GameConfig } from './GameConfig';

/** 需要持久化的游戏状态（由 GameManager / MergeGrid 提供） */
export interface SaveState {
  /** 格子档位数组，长度 cols*maxRows，0 表示空格 */
  cells: number[];
  coins: number;
  highestTier: number;
  merges: number;
  spawns: number;
  settles: number;
  /** 已解锁行数（5-10） */
  unlockedRows: number;
  /** 各档碎片数，索引 = 档位（长度 maxTier+1） */
  fragments: number[];
  /** 各档图鉴是否已完成（长度 maxTier+1） */
  codexDone: boolean[];
  /** 各档已招募次数，索引 = 档位（长度 maxTier+1） */
  recruitCounts: number[];
  /**
   * 看激励视频广告解锁的档位（key = 档位数字，值恒为 true）。
   * 对齐 H5 `state.adUnlockedTiers`（index.html:510 / 573）。
   */
  adUnlockedTiers: { [tier: number]: boolean };
}

/** 落盘的完整结构 */
export interface SaveData extends SaveState {
  /** 存档版本（H5 固定为 1） */
  v: number;
  /** 存档时间戳，用于计算离线收益 */
  time: number;
}

/** 存档版本号（index.html:553） */
export const SAVE_VERSION = 1;

/** 安全取数：非有限数则用兜底值 */
function num(v: any, fallback: number): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

/** 取整数并钳位到 [lo, hi]（index.html:581 / 585 / 597 的钳位规则） */
function intIn(v: any, lo: number, hi: number, fallback: number): number {
  let n = Math.floor(num(v, fallback));
  if (!isFinite(n)) n = fallback;
  if (n < lo) n = lo;
  if (n > hi) n = hi;
  return n;
}

/** 建立长度 len、初值 init 的定长数组 */
function fixedArray<T>(len: number, init: T): T[] {
  const arr: T[] = new Array(len);
  for (let i = 0; i < len; i++) arr[i] = init;
  return arr;
}

/** 写入存档；失败（如隐私模式禁用 localStorage）返回 false（index.html:549-568） */
export function save(state: SaveState): boolean {
  try {
    const data: SaveData = {
      v: SAVE_VERSION,
      cells: state.cells.slice(),
      coins: state.coins,
      highestTier: state.highestTier,
      merges: state.merges,
      spawns: state.spawns,
      settles: state.settles,
      unlockedRows: state.unlockedRows,
      fragments: state.fragments.slice(),
      codexDone: state.codexDone.slice(),
      recruitCounts: state.recruitCounts.slice(),
      // H5 直接写 state.adUnlockedTiers（index.html:573）；这里拷一份，避免存档对象与运行时状态共享引用
      adUnlockedTiers: { ...state.adUnlockedTiers },
      time: Date.now(),
    };
    sys.localStorage.setItem(GameConfig.saveKey, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 读取存档并按 H5 规则逐字段钳位（index.html:570-611）。
 * 无存档 / 解析失败 / 结构不合法 → 返回 null。
 */
export function load(): SaveData | null {
  let raw: string | null = null;
  try {
    raw = sys.localStorage.getItem(GameConfig.saveKey);
  } catch (e) {
    return null;
  }
  if (!raw) return null;

  let d: any = null;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!d || !d.cells || !d.cells.length) return null;

  const maxTier = GameConfig.maxTier;
  const slotCount = GameConfig.gridCols * GameConfig.maxRows;

  // cells：逐个 clamp(floor(v), 0, MAX_TIER)，长度不足部分补 0（index.html:578-582）
  const cells = fixedArray<number>(slotCount, 0);
  const n = Math.min(d.cells.length, slotCount);
  for (let i = 0; i < n; i++) cells[i] = intIn(d.cells[i], 0, maxTier, 0);

  // unlockedRows：clamp(floor(v), 5, 10)（index.html:584-586）
  const unlockedRows = intIn(
    d.unlockedRows, GameConfig.defaultRows, GameConfig.maxRows, GameConfig.defaultRows,
  );

  // fragments：clamp(floor(v), 0, 10)（index.html:595-599）
  const fragments = fixedArray<number>(maxTier + 1, 0);
  if (d.fragments && d.fragments.length) {
    for (let t = 1; t <= maxTier; t++) {
      fragments[t] = intIn(d.fragments[t], 0, GameConfig.fragmentMax, 0);
    }
  }

  // codexDone：布尔化（index.html:600-602）
  const codexDone = fixedArray<boolean>(maxTier + 1, false);
  if (d.codexDone && d.codexDone.length) {
    for (let t = 1; t <= maxTier; t++) codexDone[t] = !!d.codexDone[t];
  }

  // recruitCounts：>= 0 的整数，不设上限（index.html:603-605）
  const recruitCounts = fixedArray<number>(maxTier + 1, 0);
  if (d.recruitCounts && d.recruitCounts.length) {
    for (let t = 1; t <= maxTier; t++) {
      const v = Math.floor(num(d.recruitCounts[t], 0));
      recruitCounts[t] = v > 0 ? v : 0;
    }
  }

  // adUnlockedTiers：只吸收合法键（整数 1..maxTier 且为真值），杜绝脏数据污染门槛判定
  // （H5 index.html:617-625 的同款过滤）
  const adUnlockedTiers: { [tier: number]: boolean } = {};
  if (d.adUnlockedTiers && typeof d.adUnlockedTiers === 'object') {
    for (const k of Object.keys(d.adUnlockedTiers)) {
      const adt = Math.floor(Number(k));
      if (adt >= 1 && adt <= maxTier && d.adUnlockedTiers[k]) adUnlockedTiers[adt] = true;
    }
  }

  return {
    v: num(d.v, SAVE_VERSION),
    cells,
    coins: Math.max(0, num(d.coins, 0)),
    highestTier: intIn(d.highestTier, 1, maxTier, 1),
    merges: Math.max(0, Math.floor(num(d.merges, 0))),
    spawns: Math.max(0, Math.floor(num(d.spawns, 0))),
    settles: Math.max(0, Math.floor(num(d.settles, 0))),
    unlockedRows,
    fragments,
    codexDone,
    recruitCounts,
    adUnlockedTiers,
    time: num(d.time, Date.now()),
  };
}

/** 清空存档（index.html:621） */
export function clear(): void {
  try {
    sys.localStorage.removeItem(GameConfig.saveKey);
  } catch (e) {
    // 忽略：无 localStorage 时无需清理
  }
}

/** 距存档时刻已过去的秒数（index.html:607） */
export function elapsedSince(time: number): number {
  const t = Number(time);
  if (!isFinite(t) || t <= 0) return 0;
  const sec = (Date.now() - t) / 1000;
  return sec > 0 ? sec : 0;
}

/**
 * 离线收益应补发的金币（index.html:607-611）。
 * 不足 60 秒不给；上限 8 小时；效率 50%；向下取整。
 */
export function offlineGain(rate: number, elapsedSec: number): number {
  if (!(elapsedSec > 60)) return 0;
  const eff = Math.min(elapsedSec, GameConfig.offlineCapSec);
  const gain = Math.floor(rate * eff * GameConfig.offlineEfficiency);
  return gain > 0 ? gain : 0;
}
