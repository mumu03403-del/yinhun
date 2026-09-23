/**
 * 解锁门槛（GATE）：移植 H5 的 build/publish/index.html:119-134, 1182-1213。
 *
 * ⚠️ 语义保持与 H5 完全一致：`GATE[8].codex = 6` / `GATE[12].codex = 10` 比较的是
 *    `state.highestTier`（当前最高档位），而不是「已完成的图鉴数量」。
 *    因此界面文案的分母是**图鉴总数 24**（H5 已把「6/6」「10/10」改为「6/24」「10/24」，
 *    见 index.html:1192 / 1194），不要按「图鉴完成数」理解这两行门槛。
 *
 * H5 提交 5883fa6（+ 紧随其后的门槛数值调整）带来的两处变化：
 *   1. GATE 必须**严格递增**（index.html:120-125）：变现会销毁该单位，早先
 *      45/60/80/105/140 的后期门槛完全不可达，故回调到 7→24 的合理量级。
 *   2. `tierGateOk` 先查「看广告解锁」白名单（index.html:128），再看 GATE。
 */

/** 单个档位的门槛条件 */
export interface GateRequest {
  /** 需要累计变现次数 */
  settle?: number;
  /** 需要达到的最高档位（注意：不是图鉴完成数） */
  codex?: number;
}

/** 门槛判定所需的游戏状态视图 */
export interface GateState {
  /** 累计变现次数 */
  settles: number;
  /** 当前达到过的最高档位 */
  highestTier: number;
  /**
   * 看广告立即解锁的档位（key = 档位数字，值恒为 true）。
   * 对齐 H5 `state.adUnlockedTiers`（index.html:510 / 128）。允许缺省，兼容老存档。
   */
  adUnlockedTiers?: { [tier: number]: boolean };
}

/**
 * 9 个门槛档位（index.html:122-125）。
 * 必须严格递增；7/8/11/12 的 settle 与 codex 条件与 H5 逐字一致。
 */
export const GATE: { [tier: number]: GateRequest } = {
  7: { settle: 3 }, 8: { settle: 4, codex: 6 }, 11: { settle: 6 }, 12: { settle: 8, codex: 10 },
  13: { settle: 10 }, 16: { settle: 13 }, 19: { settle: 16 }, 22: { settle: 20 }, 24: { settle: 25 },
};

/** 门槛档位集合，便于 O(1) 判断（index.html:126） */
export const GATE_TIERS: { [tier: number]: boolean } = {
  7: true, 8: true, 11: true, 12: true, 13: true, 16: true, 19: true, 22: true, 24: true,
};

/** 是否属于「有门槛」的档位 */
export function isGateTier(tier: number): boolean {
  return !!GATE_TIERS[tier];
}

/**
 * 门槛是否已满足（index.html:127-134）；无门槛档位恒为 true。
 *
 * ⚠️ 「看广告解锁」的判定必须放在 GATE 查表**之前**（H5 index.html:128 就是第一行），
 *    否则广告解锁的档位会被下面的 settle/codex 条件重新拦住。
 */
export function tierGateOk(tier: number, state: GateState): boolean {
  if (state.adUnlockedTiers && state.adUnlockedTiers[tier]) return true;
  const g = GATE[tier];
  if (!g) return true;
  if (g.settle && state.settles < g.settle) return false;
  if (g.codex && state.highestTier < g.codex) return false;
  return true;
}

/**
 * 图鉴卡片是否解锁（index.html:1185-1188）
 * 有门槛的档位需要「已达该档位」且「门槛满足」；其余档位只需达到该档位。
 */
export function codexCardUnlocked(tier: number, state: GateState): boolean {
  if (GATE_TIERS[tier]) return state.highestTier >= tier && tierGateOk(tier, state);
  return state.highestTier >= tier;
}

/** 当前进度补充说明，供 UI 展示「x/y」 */
export function gateProgress(tier: number, state: GateState): string {
  const g = GATE[tier];
  if (!g) return '';
  const parts: string[] = [];
  if (g.settle) parts.push('变现 ' + state.settles + '/' + g.settle);
  if (g.codex) parts.push('最高档 ' + state.highestTier + '/' + g.codex);
  return parts.join(' · ');
}

/**
 * 完整目标文案（index.html:1190-1201）；传入 state 时追加当前进度。
 * 文案里的数字必须与上面的 GATE 一一对应，分母 24 是图鉴总数，勿改。
 */
export function gateGoalText(tier: number, state?: GateState): string {
  let txt = '';
  if (tier === 7) txt = '把满级单位长按变现满 3 次，解锁 7 档（初露锋芒）';
  else if (tier === 8) txt = '满级变现满 4 次 且 集齐图鉴 6/24，解锁 8 档（登峰造极）';
  else if (tier === 11) txt = '满级变现满 6 次，解锁 11 档';
  else if (tier === 12) txt = '满级变现满 8 次 且 集齐图鉴 10/24，解锁 12 档';
  else if (tier === 13) txt = '累计变现满 10 次，解锁 13 档';
  else if (tier === 16) txt = '累计变现满 13 次，解锁 16 档';
  else if (tier === 19) txt = '累计变现满 16 次，解锁 19 档';
  else if (tier === 22) txt = '累计变现满 20 次，解锁 22 档';
  else if (tier === 24) txt = '累计变现满 25 次，解锁 24 档（终焉）';
  if (txt && state) {
    const p = gateProgress(tier, state);
    if (p) txt = txt + '（当前 ' + p + '）';
  }
  return txt;
}

/** 门槛短标（index.html:1202-1213） */
export function gateShort(tier: number): string {
  if (tier === 7) return '变现3次';
  if (tier === 8) return '变现4·图6/24';
  if (tier === 11) return '变现6次';
  if (tier === 12) return '变现8·图10/24';
  if (tier === 13) return '变现10次';
  if (tier === 16) return '变现13次';
  if (tier === 19) return '变现16次';
  if (tier === 22) return '变现20次';
  if (tier === 24) return '变现25次';
  return '';
}
