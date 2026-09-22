/**
 * 单个网格格子的视图。
 * 绘制规则对齐 H5 v2.8.0（build/publish/index.html:1781-1891）：
 *   tier 1-12  → 圆形徽章 + 金边圆环
 *   tier 13-24 → 六边形色块 + 金边
 * 档位数字带深色底座，保证在图案上清晰可读。
 * 另负责满级单位的长按（500ms）变现手势与短按点选。
 */
import {
  _decorator, Component, Node, UITransform, Graphics, Label, Color,
  NodeEventType, EventTouch,
} from 'cc';
import { GameConfig, hexToColor, contrastText } from '../data/GameConfig';

const { ccclass } = _decorator;

/** 金边色（index.html:1833 / 1878） */
const GOLD = '#e8c15a';
/** 满级额外金边（index.html:1846） */
const GOLD_LIGHT = '#ffe58a';
/** 圆形绘制与六边形绘制的分界档位（index.html:1842 / 1850） */
const CIRCLE_MAX_TIER = 12;
/** 长按过程中允许的手指位移（像素），超过则取消长按 */
const MOVE_CANCEL_DIST_SQ = 100;

/** 构造 cc.Color 的小工具 */
function toColor(hex: string, alpha: number): Color {
  const c = hexToColor(hex);
  return new Color(c.r, c.g, c.b, alpha);
}

@ccclass('UnitView')
export class UnitView extends Component {
  /** 0 表示空格，>=1 表示档位 */
  tier = 0;
  cellSize = 0;
  private g!: Graphics;
  private label!: Label;
  private selected = false;

  /** 短按（点选 / 合并）回调 */
  onTap: (() => void) | null = null;
  /** 长按到达阈值（满级变现）回调 */
  onSettle: (() => void) | null = null;

  /** 待触发的长按回调，非空表示正在计时 */
  private longPressCb: (() => void) | null = null;
  /** 本次触摸中长按是否已触发（用于抑制抬起时的短按） */
  private longPressFired = false;
  /** 触摸起点，用于位移取消长按 */
  private touchStartX = 0;
  private touchStartY = 0;

  init(tier: number, cellSize: number) {
    this.tier = tier;
    this.cellSize = cellSize;

    const ut = this.getComponent(UITransform) || this.addComponent(UITransform);
    ut.setContentSize(cellSize, cellSize);

    this.g = this.getComponent(Graphics) || this.addComponent(Graphics);

    const lblNode = new Node('tierLabel');
    lblNode.parent = this.node;
    const lut = lblNode.addComponent(UITransform);
    lut.setContentSize(cellSize, cellSize);
    this.label = lblNode.addComponent(Label);
    this.label.horizontalAlign = 1; // CENTER
    this.label.verticalAlign = 1;   // CENTER

    this.redraw();

    this.node.on(NodeEventType.TOUCH_START, this.handleTouchStart, this);
    this.node.on(NodeEventType.TOUCH_MOVE, this.handleTouchMove, this);
    this.node.on(NodeEventType.TOUCH_END, this.handleTouchEnd, this);
    this.node.on(NodeEventType.TOUCH_CANCEL, this.handleTouchCancel, this);
  }

  // ---------- 触摸与长按 ----------

  private handleTouchStart(ev: EventTouch) {
    const p = ev.getUILocation();
    this.touchStartX = p.x;
    this.touchStartY = p.y;

    // 只有满级单位支持长按变现
    if (this.tier !== GameConfig.maxTier || !this.onSettle) return;

    this.cancelLongPress();
    this.longPressFired = false;
    this.longPressCb = () => {
      this.longPressFired = true;
      this.longPressCb = null;
      const cb = this.onSettle;
      if (cb) cb();
    };
    // scheduleOnce 会随节点销毁自动取消，避免悬挂定时器
    this.scheduleOnce(this.longPressCb, GameConfig.longPressMs / 1000);
  }

  private handleTouchMove(ev: EventTouch) {
    if (!this.longPressCb) return;
    const p = ev.getUILocation();
    const dx = p.x - this.touchStartX;
    const dy = p.y - this.touchStartY;
    if (dx * dx + dy * dy > MOVE_CANCEL_DIST_SQ) this.cancelLongPress();
  }

  private handleTouchEnd() {
    const fired = this.longPressFired;
    this.cancelLongPress();
    this.longPressFired = false;
    // 长按已触发（已变现）则不再当作短按
    if (!fired && this.onTap) this.onTap();
  }

  private handleTouchCancel() {
    this.cancelLongPress();
    this.longPressFired = false;
  }

  /** 取消进行中的长按计时 */
  private cancelLongPress() {
    if (this.longPressCb) {
      this.unschedule(this.longPressCb);
      this.longPressCb = null;
    }
  }

  // ---------- 对外接口 ----------

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

  // ---------- 绘制 ----------

  /** 画一个正六边形路径：起点角 Math.PI/6，逐 60° 连点（对应 index.html:1852-1860） */
  private hexPath(rr: number) {
    for (let q = 0; q < 6; q++) {
      const a = Math.PI / 6 + q * Math.PI / 3;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (q === 0) this.g.moveTo(x, y);
      else this.g.lineTo(x, y);
    }
    this.g.close();
  }

  private redraw() {
    const s = this.cellSize;
    this.g.clear();
    this.label.string = '';

    if (this.tier <= 0) return;

    const hex = GameConfig.tierColors[this.tier - 1];
    const base = toColor(hex, 255);

    if (this.tier <= CIRCLE_MAX_TIER) {
      // 圆形徽章 + 金边圆环
      const r = (s - 8) / 2;

      this.g.fillColor = base;
      this.g.circle(0, 0, r);
      this.g.fill();

      this.g.lineWidth = 2;
      this.g.strokeColor = toColor(GOLD, 255);
      this.g.circle(0, 0, r);
      this.g.stroke();

      if (this.selected) {
        this.g.lineWidth = 3;
        this.g.strokeColor = new Color(255, 255, 255, 255);
        this.g.circle(0, 0, r + 2);
        this.g.stroke();
      }
      // 满级额外亮金圈（index.html:1842-1848）
      if (this.tier === GameConfig.maxTier) {
        this.g.lineWidth = 2;
        this.g.strokeColor = toColor(GOLD_LIGHT, 255);
        this.g.circle(0, 0, r + 1.5);
        this.g.stroke();
      }
    } else {
      // 六边形色块 + 金边
      const hs = (s - 12) / 2;

      this.g.fillColor = base;
      this.hexPath(hs);
      this.g.fill();

      // cc.Graphics 不支持线性渐变，用一层半透明亮色近似 H5 的高光渐变
      this.g.fillColor = new Color(255, 255, 255, 46);
      this.hexPath(hs * 0.72);
      this.g.fill();

      this.g.lineWidth = 2;
      this.g.strokeColor = toColor(GOLD, 255);
      this.hexPath(hs);
      this.g.stroke();

      if (this.selected) {
        this.g.lineWidth = 3;
        this.g.strokeColor = new Color(255, 255, 255, 255);
        this.hexPath(hs + 2);
        this.g.stroke();
      }
    }

    // 档位数字底座（深色圆角矩形，保证数字可读；index.html:1883-1887）
    this.g.fillColor = new Color(0, 0, 0, 115); // 约 rgba(0,0,0,0.45)
    this.g.roundRect(-16, -10, 32, 20, 6);
    this.g.fill();

    // 档位数字
    this.label.string = String(this.tier);
    this.label.fontSize = Math.max(11, Math.floor((s - 8) * 0.40));
    this.label.color = toColor(contrastText(hex), 255);
  }
}
