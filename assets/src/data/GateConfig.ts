/**
 * 解锁门槛（GATE）：移植 H5 v2.8.0 的 build/publish/index.html:120-131, 1156-1183。
 *
 * ⚠️ 语义保持与 H5 完全一致：`GATE[8].codex = 6` / `GATE[12].codex = 10` 比较的是
 *    `state.highestTier`（当前最高档位），而不是「已完成的图鉴数量」。
 *    H5 的界面文案写成「集齐图鉴 6/6」，但代码判定用的是 highestTier。
 *    这里照抄代码语义，不要按文案「修正」，否则会改变现有平衡。
 */

/** 单个档位的门槛条件 */
export interface GateRequest {
  /** 需要累计满级变现次数 */
  settle?: number;
  /** 需要达到的最高档位（注意：不是图鉴完成数） */
  codex?: number;
}

/** 门槛判定所需的游戏状态视图 */
export interface GateState {
  /** 累计满级变现次数 */
  settles: number;
  /** 当前达到过的最高档位 */
  highestTier: number;
}

/** 9 个门槛档位（index.html:120-123） */
export const GATE: { [tier: number]: GateRequest } = {
  7: { settle: 3 },
  8: { settle: 10, codex: 6 },
  11: { settle: 20 },
  12: { settle: 40, codex: 10 },
  13: { settle: 5 },
  16: { settle: 8 },
  19: { settle: 12 },
  22: { settle: 18 },
  24: { settle: 25 },
};

/** 门槛档位集合，便于 O(1) 判断（index.html:124） */
export const GATE_TIERS: { [tier: number]: boolean } = {
  7: true, 8: true, 11: true, 12: true, 13: true, 16: true, 19: true, 22: true, 24: true,
};

/** 是否属于「有门槛」的档位 */
export function isGateTier(tier: number): boolean {
  return !!GATE_TIERS[tier];
}

/** 门槛是否已满足（index.html:125-131）；无门槛档位恒为 true */
export function tierGateOk(tier: number, state: GateState): boolean {
  const g = GATE[tier];
  if (!g) return true;
  if (g.settle && state.settles < g.settle) return false;
  if (g.codex && state.highestTier < g.codex) return false;
  return true;
}

/**
 * 图鉴卡片是否解锁（index.html:1156-1159）
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

/** 完整目标文案（index.html:1160-1171）；传入 state 时追加当前进度 */
export function gateGoalText(tier: number, state?: GateState): string {
  let txt = '';
  if (tier === 7) txt = '把满级单位长按变现满 3 次，解锁 7 档（初露锋芒）';
  else if (tier === 8) txt = '满级变现满 10 次 且 集齐图鉴 6/6，解锁 8 档（登峰造极）';
  else if (tier === 11) txt = '满级变现满 20 次，解锁 11 档';
  else if (tier === 12) txt = '满级变现满 40 次 且 集齐图鉴 10/10，解锁 12 档';
  else if (tier === 13) txt = '累计变现满 5 次，解锁 13 档';
  else if (tier === 16) txt = '累计变现满 8 次，解锁 16 档';
  else if (tier === 19) txt = '累计变现满 12 次，解锁 19 档';
  else if (tier === 22) txt = '累计变现满 18 次，解锁 22 档';
  else if (tier === 24) txt = '累计变现满 25 次，解锁 24 档（终焉）';
  if (txt && state) {
    const p = gateProgress(tier, state);
    if (p) txt = txt + '（当前 ' + p + '）';
  }
  return txt;
}

/** 门槛短标（index.html:1172-1183） */
export function gateShort(tier: number): string {
  if (tier === 7) return '变现3次';
  if (tier === 8) return '变现10·图6/6';
  if (tier === 11) return '变现20次';
  if (tier === 12) return '变现40·图10/10';
  if (tier === 13) return '变现5次';
  if (tier === 16) return '变现8次';
  if (tier === 19) return '变现12次';
  if (tier === 22) return '变现18次';
  if (tier === 24) return '变现25次';
  return '';
}
