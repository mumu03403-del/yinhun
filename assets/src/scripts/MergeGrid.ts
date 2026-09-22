/**
 * 合并网格：管理格子数据模型与视图，处理「点选两个同档单位合并升档」，
 * 并承载高级招募 / 行解锁 / 满级变现 / 自动放置 / 碎片图鉴等规则。
 * 纯代码构建，无素材依赖。
 *
 * 数值与规则全部对齐 H5 v2.8.0（build/publish/index.html）。
 */
import { Node, UITransform, Graphics, Color } from 'cc';
import { GameConfig, hexToColor } from '../data/GameConfig';
import { tierGateOk, gateGoalText } from '../data/GateConfig';
import type { SaveState } from '../data/SaveStore';
import { UnitView } from './UnitView';

export class MergeGrid {
  readonly cols = GameConfig.gridCols;
  readonly maxRows = GameConfig.maxRows;

  /** 当前已解锁行数（默认 5，最大 10） */
  unlockedRows = GameConfig.defaultRows;

  /** 行间 / 格间间隙 */
  private gap = 8;
  private cellSize = 0;
  private parent: Node | null = null;
  private content: Node | null = null;
  /** 格子视图，索引 = r * cols + c */
  private views: UnitView[] = [];

  /** 格子数值模型：长度 cols*maxRows，0 表示空格，>=1 表示档位 */
  cells: number[] = [];
  /** 各档碎片数，索引 = 档位（长度 maxTier+1） */
  fragments: number[] = [];
  /** 各档图鉴是否已完成（长度 maxTier+1） */
  codexDone: boolean[] = [];
  /** 各档「高级招募」次数，同档重复招募涨价依据（长度 maxTier+1） */
  recruitCounts: number[] = [];

  /** 经济与统计 */
  coins = 0;
  highestTier = 1;
  merges = 0;
  spawns = 0;
  settles = 0;

  /** 当前选中的格子索引，-1 表示未选中 */
  private selected = -1;

  /** 合并升档回调，参数：升档后的新档位 */
  onMergeUpgrade: ((tier: number) => void) | null = null;
  /** 某档图鉴集齐（碎片满 10）回调 */
  onCodexDone: ((tier: number) => void) | null = null;
  /** 解锁新行后回调（调用方通常需要重排棋盘） */
  onRowUnlocked: (() => void) | null = null;
  /** 提示气泡回调，参数：文本、持续秒数 */
  onToast: ((text: string, seconds: number) => void) | null = null;

  constructor() {
    this.resetState();
  }

  /** 复位为初始空状态 */
  resetState() {
    const total = this.cols * this.maxRows;
    this.cells = new Array(total);
    for (let i = 0; i < total; i++) this.cells[i] = 0;

    const tiers = GameConfig.maxTier + 1;
    this.fragments = new Array(tiers);
    this.codexDone = new Array(tiers);
    this.recruitCounts = new Array(tiers);
    for (let t = 0; t < tiers; t++) {
      this.fragments[t] = 0;
      this.codexDone[t] = false;
      this.recruitCounts[t] = 0;
    }

    this.coins = 0;
    this.highestTier = 1;
    this.merges = 0;
    this.spawns = 0;
    this.settles = 0;
    this.selected = -1;
  }

  // ---------- 构建视图 ----------

  /**
   * 构建（或重建）格子视图。可重复调用：会先销毁上一次的内容，
   * 因此解锁新行后重排布局时直接再次调用即可。
   */
  build(parent: Node, cellSize: number) {
    this.parent = parent;
    this.cellSize = cellSize;

    if (this.content && this.content.isValid) {
      this.content.destroy();
    }
    this.views = [];
    this.selected = -1;

    const content = new Node('gridContent');
    content.parent = parent;
    this.content = content;

    const rows = this.unlockedRows;
    const totalW = this.cols * cellSize + (this.cols - 1) * this.gap;
    const totalH = rows * cellSize + (rows - 1) * this.gap;

    // 网格底板（只覆盖已解锁区域，锁行区域不绘制）
    const bg = new Node('gridBg');
    bg.parent = content;
    const bgu = bg.addComponent(UITransform);
    bgu.setContentSize(totalW + 16, totalH + 16);
    const g = bg.addComponent(Graphics);
    const bc = hexToColor('#1e1e28');
    g.fillColor = new Color(bc.r, bc.g, bc.b, bc.a);
    g.roundRect(-(totalW + 16) / 2, -(totalH + 16) / 2, totalW + 16, totalH + 16, 12);
    g.fill();

    const startX = -totalW / 2 + cellSize / 2;
    const startY = totalH / 2 - cellSize / 2;

    for (let r = 0; r < this.maxRows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const cell = new Node('cell_' + r + '_' + c);
        cell.parent = content;
        cell.setPosition(
          startX + c * (cellSize + this.gap),
          startY - r * (cellSize + this.gap),
          0,
        );
        const uv = cell.addComponent(UnitView);
        uv.init(0, cellSize);
        uv.onTap = () => this.onCellTap(idx);
        uv.onSettle = () => this.doSettle(idx);
        // 未解锁行不显示、不响应触摸
        cell.active = r < this.unlockedRows;
        this.views[idx] = uv;
      }
    }

    // 重建后把数据模型同步到视图
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.views[i];
      if (v && v.isValid) v.setTier(this.cells[i]);
    }
  }

  // ---------- 基础查询 ----------

  /** 当前可交互的格子数（仅已解锁行参与放置/合并/结算） */
  activeCells(): number {
    return this.cols * this.unlockedRows;
  }

  /** 索引是否落在已解锁区域内 */
  private inActive(i: number): boolean {
    return i >= 0 && i < this.activeCells();
  }

  /** 在已解锁区域内随机取一个空格索引，无空格返回 -1 */
  private randomEmptyCell(): number {
    const empties: number[] = [];
    const n = this.activeCells();
    for (let i = 0; i < n; i++) {
      if (this.cells[i] === 0) empties.push(i);
    }
    if (empties.length === 0) return -1;
    return empties[Math.floor(Math.random() * empties.length)];
  }

  /** 同时写入数据模型与视图（唯一的格子写入入口） */
  private setCell(i: number, tier: number) {
    if (i < 0 || i >= this.cells.length) return;
    this.cells[i] = tier;
    const v = this.views[i];
    if (v && v.isValid) v.setTier(tier);
  }

  /** 切换视图选中态 */
  private setSelectedView(i: number) {
    if (this.selected >= 0) {
      const old = this.views[this.selected];
      if (old && old.isValid) old.setSelected(false);
    }
    this.selected = i;
    if (i >= 0) {
      const cur = this.views[i];
      if (cur && cur.isValid) cur.setSelected(true);
    }
  }

  private toast(text: string, seconds: number) {
    if (this.onToast) this.onToast(text, seconds);
  }

  // ---------- 放置与合并 ----------

  /** 在已解锁区域随机空格放置一个 1 档单位，满格返回 false（index.html:640-654） */
  spawnTier1(): boolean {
    const idx = this.randomEmptyCell();
    if (idx < 0) {
      this.toast('格子已满，先合并腾出空位', 2.0);
      return false;
    }
    this.setCell(idx, 1);
    this.spawns++;
    return true;
  }

  /** 点选逻辑：先选源格，再点同档目标格即合并（index.html:1185-1205 的短按分支） */
  private onCellTap(i: number) {
    if (!this.inActive(i)) return;
    const tier = this.cells[i];
    if (tier === 0) return; // 空格不可选

    // 再次点击同一格 → 取消选中
    if (this.selected === i) {
      this.setSelectedView(-1);
      return;
    }

    // 尚无选中 → 选中当前格
    if (this.selected < 0) {
      this.setSelectedView(i);
      return;
    }

    const from = this.selected;
    // 同档 → 尝试合并；失败（满级/未过门槛）则改为选中当前格
    if (this.cells[from] === tier) {
      if (this.doMerge(from, i)) {
        this.setSelectedView(-1);
        return;
      }
    }
    this.setSelectedView(i);
  }

  /** 合并（index.html:733-770）：同档 + 未满级 + 门槛通过才生效 */
  doMerge(from: number, to: number): boolean {
    if (from === to) return false;
    if (!this.inActive(from) || !this.inActive(to)) return false;

    const tf = this.cells[from];
    const tt = this.cells[to];
    if (tf <= 0 || tt <= 0) return false;
    if (tf !== tt) return false;

    if (tt >= GameConfig.maxTier) {
      this.toast('已是最高档（' + GameConfig.maxTier + ' 档）：长按可变现金币', 2.0);
      return false;
    }

    const targetTier = tt + 1;
    if (!tierGateOk(targetTier, this)) {
      this.toast(gateGoalText(targetTier, this), 2.4);
      return false;
    }

    this.setCell(to, targetTier);
    this.setCell(from, 0);
    this.merges++;
    if (targetTier > this.highestTier) this.highestTier = targetTier;

    // 图鉴碎片：每合出一次 +1，满 10 标记完成（index.html:756-760）
    const cur = this.fragments[targetTier] || 0;
    this.fragments[targetTier] = Math.min(GameConfig.fragmentMax, cur + 1);
    if (this.fragments[targetTier] >= GameConfig.fragmentMax && !this.codexDone[targetTier]) {
      this.codexDone[targetTier] = true;
      if (this.onCodexDone) this.onCodexDone(targetTier);
    }

    if (this.onMergeUpgrade) this.onMergeUpgrade(targetTier);
    return true;
  }

  // ---------- 高级招募 ----------

  /** 高级招募定价（index.html:657-662）：基础 1000×5^(t-1)，同档每次翻倍、封顶 5 倍 */
  recruitCost(tier: number): number {
    const base = 1000 * Math.pow(5, tier - 1);
    const mult = Math.min(Math.pow(2, this.recruitCounts[tier] || 0), 5);
    return Math.round(base * mult);
  }

  /** 高级招募一个指定档位单位（index.html:664-695） */
  recruitTier(tier: number): boolean {
    if (tier < 1 || tier > GameConfig.maxTier) return false;

    if (this.highestTier < tier) {
      this.toast('需先合出 ' + tier + ' 档才能招募', 2.0);
      return false;
    }
    const cost = this.recruitCost(tier);
    if (this.coins < cost) {
      this.toast('金币不足，招募 ' + tier + ' 档需 ' + cost + ' 金币', 2.0);
      return false;
    }
    const idx = this.randomEmptyCell();
    if (idx < 0) {
      this.toast('格子已满，先合并腾出空位', 2.0);
      return false;
    }

    this.coins -= cost;
    this.recruitCounts[tier] = (this.recruitCounts[tier] || 0) + 1;
    this.setCell(idx, tier);
    this.spawns++;
    return true;
  }

  /** 旧接口别名，等价于 recruitTier */
  spawnHighTier(tier: number): boolean {
    return this.recruitTier(tier);
  }

  // ---------- 行解锁 ----------

  /** 解锁下一行（index.html:1970-1988）；金币不足或已满行返回 false */
  tryUnlockRow(): boolean {
    if (this.unlockedRows >= this.maxRows) return false;
    const price = GameConfig.rowUnlockPrices[this.unlockedRows + 1];
    if (price == null) return false;

    if (this.coins < price) {
      this.toast('金币不足，解锁第' + (this.unlockedRows + 1) + '行需 ' + price + ' 金币', 2.0);
      return false;
    }

    this.coins -= price;
    this.unlockedRows++;
    if (this.onRowUnlocked) this.onRowUnlocked();
    return true;
  }

  // ---------- 满级变现 ----------

  /** 满级变现单格收益（index.html:788）：30 秒产出 */
  settleValue(tier: number): number {
    return GameConfig.settleSeconds * GameConfig.coinRate[tier - 1];
  }

  /** 该格是否为可变现的满级单位（index.html:810） */
  canSettle(i: number): boolean {
    return this.inActive(i) && this.cells[i] === GameConfig.maxTier;
  }

  /** 执行变现：清空该格并加币（index.html:790-808），失败返回 false */
  doSettle(i: number): boolean {
    if (!this.canSettle(i)) return false;

    const tier = this.cells[i];
    const gain = this.settleValue(tier);

    this.setCell(i, 0);
    this.coins += gain;
    this.settles++;
    if (this.selected === i) this.setSelectedView(-1);

    this.toast(tier + ' 档变现 +' + gain + ' 金币（' + GameConfig.settleSeconds + ' 秒产出）', 2.2);
    return true;
  }

  // ---------- 辅助操作 ----------

  /** 恢复方块：把已解锁区域内的空格填回 1 档，不消耗金币（index.html:697-714） */
  restoreBlocks(): number {
    let filled = 0;
    const n = this.activeCells();
    for (let i = 0; i < n; i++) {
      if (this.cells[i] === 0) {
        this.setCell(i, 1);
        filled++;
      }
    }
    if (filled > 0) {
      this.spawns += filled;
      this.toast('已恢复 ' + filled + ' 个方块', 1.8);
    } else {
      this.toast('没有空位需要恢复', 1.6);
    }
    return filled;
  }

  /** 自动放置（index.html:716-731）：档位上限 = 最高档 - 3，按 t^1.3 加权随机；返回放置的档位，失败 0 */
  autoSpawn(): number {
    const idx = this.randomEmptyCell();
    if (idx < 0) return 0;

    const cap = Math.max(1, this.highestTier - 3);
    const weights: number[] = [];
    let total = 0;
    for (let t = 1; t <= cap; t++) {
      const w = Math.pow(t, 1.3);
      weights.push(w);
      total += w;
    }

    let roll = Math.random() * total;
    let chosen = 1;
    for (let k = 0; k < weights.length; k++) {
      roll -= weights[k];
      if (roll <= 0) { chosen = k + 1; break; }
    }

    this.setCell(idx, chosen);
    this.spawns++;
    return chosen;
  }

  /** 已解锁区域内所有单位每秒产出的金币总和（index.html:633） */
  coinsPerSecond(): number {
    let sum = 0;
    const n = this.activeCells();
    for (let i = 0; i < n; i++) {
      const t = this.cells[i];
      if (t > 0 && t <= GameConfig.maxTier) sum += GameConfig.coinRate[t - 1];
    }
    return sum;
  }

  /** 兼容旧调用名 */
  getCoinsPerSecond(): number {
    return this.coinsPerSecond();
  }

  // ---------- 存档 ----------

  /** 导出可存档状态（对齐 index.html:552-565 的字段） */
  toSaveState(): SaveState {
    return {
      cells: this.cells.slice(),
      coins: this.coins,
      highestTier: this.highestTier,
      merges: this.merges,
      spawns: this.spawns,
      settles: this.settles,
      unlockedRows: this.unlockedRows,
      fragments: this.fragments.slice(),
      codexDone: this.codexDone.slice(),
      recruitCounts: this.recruitCounts.slice(),
    };
  }

  /** 应用已钳位的存档数据（由 GameManager 在 SaveStore.load() 之后调用） */
  applySaveData(d: SaveState) {
    this.cells = d.cells.slice();
    this.coins = d.coins;
    this.highestTier = d.highestTier;
    this.merges = d.merges;
    this.spawns = d.spawns;
    this.settles = d.settles;
    this.unlockedRows = d.unlockedRows;
    this.fragments = d.fragments.slice();
    this.codexDone = d.codexDone.slice();
    this.recruitCounts = d.recruitCounts.slice();
    this.selected = -1;
  }
}
