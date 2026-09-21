/**
 * 单个网格格子的视图（占位：纯色圆角矩形 + 档位数字）。
 * 不依赖任何图片素材，使用 Graphics 直接绘制。
 */
import { _decorator, Component, Node, UITransform, Graphics, Label, Color, NodeEventType } from 'cc';
import { GameConfig, hexToColor } from '../data/GameConfig';

const { ccclass } = _decorator;

@ccclass('UnitView')
export class UnitView extends Component {
  /** 0 表示空格，>=1 表示档位 */
  tier = 0;
  cellSize = 0;
  private g!: Graphics;
  private label!: Label;
  private selected = false;
  onTap: (() => void) | null = null;

  init(tier: number, cellSize: number) {
    this.tier = tier;
    this.cellSize = cellSize;

    const ut = this.getComponent(UITransform) || this.addComponent(UITransform);
    ut.setContentSize(cellSize, cellSize);

    this.g = this.addComponent(Graphics);

    const lblNode = new Node('tierLabel');
    lblNode.parent = this.node;
    const lut = lblNode.addComponent(UITransform);
    lut.setContentSize(cellSize, cellSize);
    this.label = lblNode.addComponent(Label);
    this.label.fontSize = Math.floor(cellSize * 0.4);
    this.label.color = new Color(255, 255, 255, 255);
    this.label.horizontalAlign = 1; // CENTER
    this.label.verticalAlign = 1;   // CENTER

    this.redraw();
    this.node.on(NodeEventType.TOUCH_END, this.handleTap, this);
  }

  private handleTap() {
    if (this.onTap) this.onTap();
  }

  setTier(tier: number) {
    this.tier = tier;
    this.redraw();
  }

  setSelected(s: boolean) {
    this.selected = s;
    this.redraw();
  }

  clear() {
    this.tier = 0;
    this.selected = false;
    this.redraw();
  }

  private redraw() {
    const s = this.cellSize;
    this.g.clear();
    if (this.tier <= 0) {
      this.label.string = '';
      return;
    }
    const c = hexToColor(GameConfig.tierColors[this.tier - 1]);
    this.g.fillColor = new Color(c.r, c.g, c.b, c.a);
    const pad = 4;
    this.g.roundRect(-s / 2 + pad, -s / 2 + pad, s - pad * 2, s - pad * 2, 8);
    this.g.fill();

    if (this.selected) {
      this.g.lineWidth = 5;
      this.g.strokeColor = new Color(255, 255, 255, 255);
      this.g.roundRect(-s / 2 + pad, -s / 2 + pad, s - pad * 2, s - pad * 2, 8);
      this.g.stroke();
    }
    this.label.string = String(this.tier);
  }
}
