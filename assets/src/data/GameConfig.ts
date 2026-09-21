/**
 * 游戏配置（占位数据，无任何版权素材）
 * 所有颜色为纯色十六进制，角色名为占位名称（非银魂 IP）。
 */
export function hexToColor(hex: string): any {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  // 使用 cc.Color 在运行时构造，这里返回普通结构由调用方转成 Color
  return { r, g, b, a: 255 };
}

export const GameConfig = {
  /** 合并网格列数 */
  gridCols: 5,
  /** 合并网格行数 */
  gridRows: 4,
  /** 最高档位（达到后不再合并） */
  maxTier: 6,

  /** 每个档位的占位颜色（tier 从 1 开始索引），纯色无素材 */
  tierColors: [
    '#7f8c8d', // 1 灰
    '#3498db', // 2 蓝
    '#2ecc71', // 3 绿
    '#f1c40f', // 4 黄
    '#e67e22', // 5 橙
    '#e74c3c', // 6 红
  ],

  /** 每个档位每秒产出金币（占位数值，随档位指数增长） */
  coinRate: [1, 3, 9, 27, 81, 243],

  /**
   * 图鉴角色卡占位名称（非银魂版权角色，仅风格化命名）。
   * card[i] 在达到 tier (i+2) 时解锁，例如第一张卡在合出 2 档时解锁。
   */
  characterNames: [
    '见习武士 #1',
    '街头浪人 #2',
    '天然卷剑客 #3',
    '甜党使者 #4',
    '攘夷志士 #5',
    '传说将军 #6',
  ],

  /** 开局自动放置的 1 档单位数量 */
  initialUnits: 6,
};

export type GameConfigType = typeof GameConfig;
