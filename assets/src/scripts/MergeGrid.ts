/**
 * 合并网格：管理格子数据模型与视图，处理“点选两个同档单位合并升档”的逻辑。
 * 纯代码构建，无素材依赖。
 */
import { Node, UITransform, Graphics, Color } from 'cc';
import { GameConfig, hexToColor } from '../data/GameConfig';
import { UnitView } from './UnitView';

export class MergeGrid {
  private cols = GameConfig.gridCols;
  private rows = GameConfig.gridRows;
  private gap = 8;
  private cellSize = 0;
  private parent: Node | null = null;
  private cells: (UnitView | null)[][] = [];

  /** 选中状态：{r,c} 或 null */
  private selected: { r: number; c: number } | null = null;

  /** 合并升档回调，参数：升档后的新档位 */
  onMergeUpgrade: ((tier: number) => void) | null = null;

  build(parent: Node, cellSize: number) {
    this.parent = parent;
    this.cellSize = cellSize;

    const totalW = this.cols * cellSize + (this.cols - 1) * this.gap;
    const totalH = this.rows * cellSize + (this.rows - 1) * this.gap;

    // 网格背景
    const bg = new Node('gridBg');
    bg.parent = parent;
    const bgu = bg.addComponent(UITransform);
    bgu.setContentSize(totalW + 16, totalH + 16);
    const g = bg.addComponent(Graphics);
    const bc = hexToColor('#1e1e28');
    g.fillColor = new Color(bc.r, bc.g, bc.b, bc.a);
    g.roundRect(-(totalW + 16) / 2, -(totalH + 16) / 2, totalW + 16, totalH + 16, 12);
    g.fill();

    const startX = -totalW / 2 + cellSize / 2;
    const startY = totalH / 2 - cellSize / 2;

    for (let r = 0; r < this.rows; r++) {
      this.cells[r] = [];
      for (let c = 0; c < this.cols; c++) {
        const cell = new Node(`cell_${r}_${c}`);
        cell.parent = parent;
        cell.setPosition(startX + c * (cellSize + this.gap), startY - r * (cellSize + this.gap), 0);
        const uv = cell.addComponent(UnitView);
        uv.init(0, cellSize);
        const rr = r;
        const cc2 = c;
        uv.onTap = () => this.onTap(rr, cc2);
        this.cells[r][c] = uv;
      }
    }
  }

  /** 在随机空格放置一个 1 档单位，满格返回 false */
  spawnTier1(): boolean {
    const empties: { r: number; c: number }[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c]!.tier === 0) empties.push({ r, c });
      }
    }
    if (empties.length === 0) return false;
    const p = empties[Math.floor(Math.random() * empties.length)];
    this.cells[p.r][p.c]!.setTier(1);
    return true;
  }

  private onTap(r: number, c: number) {
    const uv = this.cells[r][c]!;
    if (uv.tier === 0) return; // 空格不可选

    if (!this.selected) {
      this.selected = { r, c };
      uv.setSelected(true);
      return;
    }

    if (this.selected.r === r && this.selected.c === c) {
      uv.setSelected(false);
      this.selected = null;
      return;
    }

    const sel = this.selected;
    const suv = this.cells[sel.r][sel.c]!;

    if (suv.tier === uv.tier && uv.tier < GameConfig.maxTier) {
      // 合并：目标格升一档，原格清空
      uv.setTier(uv.tier + 1);
      suv.clear();
      this.selected = null;
      if (this.onMergeUpgrade) this.onMergeUpgrade(uv.tier);
    } else {
      // 不同档 / 已满级：切换选择
      suv.setSelected(false);
      this.selected = { r, c };
      uv.setSelected(true);
    }
  }

  /** 当前所有单位每秒产出的金币总和 */
  getCoinsPerSecond(): number {
    let sum = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const t = this.cells[r][c]!.tier;
        if (t > 0) sum += GameConfig.coinRate[t - 1];
      }
    }
    return sum;
  }
}
