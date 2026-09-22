/**
 * 单个网格格子的视图。
 * 绘制规则对齐 H5 v2.8.0（build/publish/index.html:1781-1891）：
 *   tier 1-12  → 圆形徽章 + 金边圆环（有棋盘贴图时贴图被裁成圆；index.html:1816-1830）
 *   tier 13-24 → 六边形色块 + 金边（H5 里 board 为 null，本来就没有贴图）
 * 档位数字带深色底座，保证在图案上清晰可读。
 * 另负责满级单位的长按（500ms）变现手势、短按点选，以及**拖拽合并**的源格手势
 * （拖拽语义对齐 H5 index.html:1420-1455 的 pointermove / pointerup 分支）。
 *
 * 节点结构（顺序即渲染顺序，Cocos 中节点自身的渲染先于其子节点，故必须分层）：
 *   cell(UnitView, UITransform)
 *     ├─ art   ：Mask(GRAPHICS_ELLIPSE) —— 圆形裁剪容器（仅 1-12 档有贴图时 active）
 *     │    └─ img ：Sprite —— 棋盘贴图，铺满 2r×2r（H5 也是拉伸成正方形再裁圆）
 *     ├─ gfx   ：Graphics —— 平面圆（无贴图时的回落）/ 金边圆环 / 选中环 / 数字底座
 *     └─ tierLabel ：Label —— 档位数字（最上层）
 */
import {
  _decorator, Component, Node, UITransform, Sprite, Mask, Graphics, Label, Color,
  NodeEventType, EventTouch,
} from 'cc';
import { GameConfig, hexToColor, contrastText } from '../data/GameConfig';
import { AssetHub } from './AssetHub';

const { ccclass } = _decorator;

/** 金边色（index.html:1833 / 1878） */
const GOLD = '#e8c15a';
/** 满级额外金边（index.html:1846） */
const GOLD_LIGHT = '#ffe58a';
/** 圆形绘制与六边形绘制的分界档位（index.html:1842 / 1850） */
const CIRCLE_MAX_TIER = 12;
/** 长按过程中允许的手指位移（像素），超过则取消长按；同时也作为「是否算拖拽」的阈值（H5 同为 10px，index.html:1405） */
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
  /** 圆形裁剪容器（含贴图） */
  private art!: Node;
  private img!: Sprite;
  /** 线框 / 圆环 / 数字底座 */
  private gfx!: Graphics;
  private label!: Label;
  private selected = false;
  /** 拖拽悬停高亮（作为落点目标时显示白环） */
  private dropHint = false;

  /** 短按（点选 / 合并）回调 */
  onTap: (() => void) | null = null;
  /** 长按到达阈值（满级变现）回调 */
  onSettle: (() => void) | null = null;
  /** 拖拽开始（手指按下并按住本格）回调 */
  onDragStart: (() => void) | null = null;
  /** 拖拽移动回调，参数：本次触摸的 UI 坐标 */
  onDragMove: ((x: number, y: number) => void) | null = null;
  /** 拖拽结束（抬起）回调，参数：抬起点的 UI 坐标 */
  onDragEnd: ((x: number, y: number) => void) | null = null;

  /** 待触发的长按回调，非空表示正在计时 */
  private longPressCb: (() => void) | null = null;
  /** 本次触摸中长按是否已触发（用于抑制抬起时的短按） */
  private longPressFired = false;
  /** 本次触摸是否已被判定为拖拽（位移超过阈值；H5 的 pointer.moved） */
  private moved = false;
  /** 触摸起点，用于位移判定与长按取消 */
  private touchStartX = 0;
  private touchStartY = 0;

  /**
   * @param tier 初始档位（0 = 空格）
   * @param cellSize 格子边长（像素）
   * @param interactive 是否注册触摸监听。拖拽影子用 false —— 影子只是视觉，
   *        且它是在 TOUCH_START 之后才创建的，不该参与事件分发。
   */
  init(tier: number, cellSize: number, interactive = true) {
    this.tier = tier;
    this.cellSize = cellSize;

    // `||` 之后类型仍是 T | null（addComponent 声明可空），这里断言非空：
    // 组件刚被创建出来，必然存在。
    const ut = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    ut.setContentSize(cellSize, cellSize);

    // ---- 圆形裁剪容器（先创建 → 渲染在最下层）----
    // 用 Mask 的 GRAPHICS_ELLIPSE：引擎会按节点 contentSize 自动生成椭圆模板
    // （见 engine/cocos/2d/components/mask.ts:411-437），无需自己画模板。
    const art = new Node('art');
    art.parent = this.node;
    const au = art.addComponent(UITransform);
    const d = Math.max(1, cellSize - 8);   // 与 H5 的 r = (CELL-8)/2 对应
    au.setContentSize(d, d);
    const mask = art.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_ELLIPSE;
    this.art = art;

    const imgNode = new Node('img');
    imgNode.parent = art;
    const iu = imgNode.addComponent(UITransform);
    iu.setContentSize(d, d);
    const sp = imgNode.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;   // 按节点尺寸铺满（H5 drawImage 为拉伸，非等比）
    sp.type = Sprite.Type.SIMPLE;
    sp.spriteFrame = null;
    this.img = sp;

    // ---- 线框层（创建在 art 之后 → 盖在贴图之上）----
    const gfxNode = new Node('gfx');
    gfxNode.parent = this.node;
    const gu = gfxNode.addComponent(UITransform);
    gu.setContentSize(cellSize, cellSize);
    this.gfx = gfxNode.addComponent(Graphics);

    // ---- 数字（最后创建 → 最上层）----
    const lblNode = new Node('tierLabel');
    lblNode.parent = this.node;
    const lut = lblNode.addComponent(UITransform);
    lut.setContentSize(cellSize, cellSize);
    this.label = lblNode.addComponent(Label);
    this.label.horizontalAlign = 1; // CENTER
    this.label.verticalAlign = 1;   // CENTER

    // 贴图异步就绪后自动重绘（Board 分组通常在本组件创建前就已开始加载）
    AssetHub.get().onBoardReady(() => {
      if (this.isValid) this.redraw();
    });

    this.redraw();

    if (!interactive) return;

    this.node.on(NodeEventType.TOUCH_START, this.handleTouchStart, this);
    this.node.on(NodeEventType.TOUCH_MOVE, this.handleTouchMove, this);
    this.node.on(NodeEventType.TOUCH_END, this.handleTouchEnd, this);
    this.node.on(NodeEventType.TOUCH_CANCEL, this.handleTouchCancel, this);
  }

  // ---------- 触摸与手势 ----------

  private handleTouchStart(ev: EventTouch) {
    const p = ev.getUILocation();
    this.touchStartX = p.x;
    this.touchStartY = p.y;
    this.moved = false;

    // 空格外按下不参与拖拽/长按（H5 只在 state.cells[i] > 0 时记录 pointer.cell）
    if (this.tier <= 0) return;

    // 拖拽源格（H5 pointerdown 里 pointer.cell = i）
    if (this.onDragStart) this.onDragStart();

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
    const p = ev.getUILocation();
    const dx = p.x - this.touchStartX;
    const dy = p.y - this.touchStartY;
    const far = dx * dx + dy * dy > MOVE_CANCEL_DIST_SQ;

    if (far && !this.moved) {
      this.moved = true;
      this.cancelLongPress();   // 位移过大 → 不再是长按（H5 cancelPress）
    }
    if (this.moved && this.onDragMove) this.onDragMove(p.x, p.y);
  }

  private handleTouchEnd(ev: EventTouch) {
    const fired = this.longPressFired;
    const moved = this.moved;
    this.cancelLongPress();
    this.longPressFired = false;
    this.moved = false;

    // 长按已触发（已变现）则不再当作点击 / 拖拽
    if (fired) return;

    if (moved) {
      // 拖拽抬起 → 由上层判定落点并尝试合并（H5 index.html:1447-1455）
      if (this.onDragEnd) {
        const p = ev.getUILocation();
        this.onDragEnd(p.x, p.y);
      }
      return;
    }
    if (this.onTap) this.onTap();
  }

  /**
   * 手势被系统取消。
   *
   * ⚠️ 关键：**拖拽合并的抬手几乎总是走到这里，而不是 TOUCH_END。**
   *   引擎在 node-event-processor.ts:681-685 里做了这个转换：
   *     抬手点仍在「按下时的那个节点」范围内 → 发 TOUCH_END
   *     否则                                  → 改发 TOUCH_CANCEL
   *   拖拽抬手必然落在**别的格子**上，所以源格只会收到 TOUCH_CANCEL。
   *   因此这里必须照样读取真实抬手坐标并交给上层做落点判定；
   *   早先版本在这里传 NaN，导致拖拽看起来「完全无效」（影子会消失、但不合并）。
   */
  private handleTouchCancel(ev: EventTouch) {
    const moved = this.moved;
    this.cancelLongPress();
    this.longPressFired = false;
    this.moved = false;
    if (!moved || !this.onDragEnd) return;
    let x = Number.NaN;
    let y = Number.NaN;
    try {
      const p = ev.getUILocation();
      x = p.x;
      y = p.y;
    } catch (e) {
      // 无法取到坐标：按「取消」处理（上层会判为无效落点并收尾）
    }
    this.onDragEnd(x, y);
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

  /** 作为拖拽落点候选时的高亮（H5 drawDragGhost 里给同档目标描白环，index.html:2161-2173） */
  setDropHint(b: boolean) {
    if (this.dropHint === b) return;
    this.dropHint = b;
    this.redraw();
  }

  clear() {
    this.tier = 0;
    this.selected = false;
    this.dropHint = false;
    this.redraw();
  }

  // ---------- 绘制 ----------

  /** 画一个正六边形路径：起点角 Math.PI/6，逐 60° 连点（对应 index.html:1852-1860） */
  private hexPath(rr: number) {
    for (let q = 0; q < 6; q++) {
      const a = Math.PI / 6 + q * Math.PI / 3;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (q === 0) this.gfx.moveTo(x, y);
      else this.gfx.lineTo(x, y);
    }
    this.gfx.close();
  }

  private redraw() {
    const s = this.cellSize;
    const g = this.gfx;
    g.clear();
    this.label.string = '';

    if (this.tier <= 0) {
      if (this.art) this.art.active = false;
      if (this.img) this.img.spriteFrame = null;
      return;
    }

    const hex = GameConfig.tierColors[this.tier - 1];
    const base = toColor(hex, 255);

    // 棋盘贴图：仅 1-12 档在 H5 里存在（index.html:1816）
    const sf = this.tier <= CIRCLE_MAX_TIER ? AssetHub.get().getBoard(this.tier) : null;
    if (this.img) this.img.spriteFrame = sf;
    if (this.art) this.art.active = !!sf;

    if (this.tier <= CIRCLE_MAX_TIER) {
      // 圆形徽章 + 金边圆环
      const r = (s - 8) / 2;

      // 有贴图时圆底由 art 层负责；无贴图才画平面圆（H5 的回落色块）
      if (!sf) {
        g.fillColor = base;
        g.circle(0, 0, r);
        g.fill();
      }

      g.lineWidth = 2;
      g.strokeColor = toColor(GOLD, 255);
      g.circle(0, 0, r);
      g.stroke();

      if (this.selected || this.dropHint) {
        g.lineWidth = 3;
        g.strokeColor = new Color(255, 255, 255, 255);
        g.circle(0, 0, r + 2);
        g.stroke();
      }
      // 满级额外亮金圈（index.html:1842-1848）
      if (this.tier === GameConfig.maxTier) {
        g.lineWidth = 2;
        g.strokeColor = toColor(GOLD_LIGHT, 255);
        g.circle(0, 0, r + 1.5);
        g.stroke();
      }
    } else {
      // 六边形色块 + 金边
      const hs = (s - 12) / 2;

      g.fillColor = base;
      this.hexPath(hs);
      g.fill();

      // cc.Graphics 不支持线性渐变，用一层半透明亮色近似 H5 的高光渐变
      g.fillColor = new Color(255, 255, 255, 46);
      this.hexPath(hs * 0.72);
      g.fill();

      g.lineWidth = 2;
      g.strokeColor = toColor(GOLD, 255);
      this.hexPath(hs);
      g.stroke();

      if (this.selected || this.dropHint) {
        g.lineWidth = 3;
        g.strokeColor = new Color(255, 255, 255, 255);
        this.hexPath(hs + 2);
        g.stroke();
      }
    }

    // 档位数字底座（深色圆角矩形，保证数字可读；index.html:1883-1887）
    g.fillColor = new Color(0, 0, 0, 115); // 约 rgba(0,0,0,0.45)
    g.roundRect(-16, -10, 32, 20, 6);
    g.fill();

    // 档位数字
    this.label.string = String(this.tier);
    this.label.fontSize = Math.max(11, Math.floor((s - 8) * 0.40));
    this.label.color = toColor(contrastText(hex), 255);
  }
}
