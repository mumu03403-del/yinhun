/**
 * 高级招募弹层：对齐 H5 v2.8.0 的 drawRecruitOverlay()（build/publish/index.html:2270-2329）
 * 与弹层点击处理（index.html:1346-1357）。
 *
 * ⚠️ 挂载方式：与 CollectionPanel 同风格，是一个**纯代码类（非 @ccclass 组件）**，
 *   由 GameManager.setup() 在运行时 `new RecruitPanel()` + `build(...)` 构建，
 *   **不需要在编辑器里挂到任何节点上**。
 *
 * 几何映射：H5 是 812×375 逻辑舞台（index.html:142-143），Cocos 侧沿用 H5 自己的
 * letterbox 规则 k = min(width/812, height/375)、舞台居中（index.html:1217-1229）。
 *
 * 卡片布局全部照抄 H5（index.html:2278-2320）：
 *   2 列 × 12 行（i → col = i%2, row = floor(i/2)，index.html:2290）
 *   cardW = (812-32-12)/2 = 384、cardH = 72、gap = 12、首行顶部 y = 70（index.html:2278-2282）
 *   列表可视带 = H5 的 rect(0, 70, 812, 200) → y ∈ [70, 270]（index.html:2286）
 *   滚动上限 = max(0, 12*(72+12) - 200) = 808（index.html:2282）
 *   卡内角标圆心 = 卡片左上角 + (14+17, 14+17) = (31,31)，半径 17（index.html:2300-2308）
 */
import {
  Node, UITransform, Label, Graphics, Color, NodeEventType,
  HorizontalTextAlignment, VerticalTextAlignment, EventTouch,
} from 'cc';
import { GameConfig, hexToColor, contrastText, fmt } from '../data/GameConfig';
import { MergeGrid } from './MergeGrid';

/** H5 逻辑舞台（index.html:142-143） */
const DESIGN_W = 812;
const DESIGN_H = 375;

/** 卡片几何（index.html:2278-2282） */
const CARD_W_H5 = (DESIGN_W - 32 - 12) / 2;   // 384
const CARD_H_H5 = 72;
const CARD_GAP_H5 = 12;
const LIST_TOP_H5 = 70;                        // 列表可视带顶部（index.html:2281）
const LIST_H_H5 = 200;                         // rect(0, 70, W, H-175) → 高 200（index.html:2286）
const COLS = 2;                                // index.html:2290
const ROWS = GameConfig.maxTier / COLS;        // 12 行

/** 关闭按钮 = H5 的 CODEX_CLOSE_BTN（index.html:233，招募弹层复用它，index.html:2323） */
const CLOSE_BTN_H5 = { x: DESIGN_W / 2 - 80, y: DESIGN_H - 96, w: 160, h: 48 };

/** 角标半径（index.html:2300：bgr = 17） */
const BADGE_R_H5 = 17;
/** 角标相对卡片左上角的内缩量（index.html:2300：bgx = x + 14、bgy = y + 14） */
const BADGE_INSET_H5 = 14;
/** 角标圆心相对卡片左上角的偏移（= 14 + 17 = 31，即 H5 的卡片内 (31,31)） */
const BADGE_CENTER_OFF_H5 = BADGE_INSET_H5 + BADGE_R_H5;
/** 滚动节流：手指位移超过该像素（H5 单位）即视为滑动而非点击（index.html:1417） */
const SCROLL_THRESHOLD_H5 = 8;

/** 单张卡片的可更新引用 */
interface CardRef {
  node: Node;
  gfx: Graphics;
  badge: Label;
  name: Label;
  cost: Label;
  count: Label;
  tier: number;
  /** 卡片在 H5 坐标系下的顶部 y（未加滚动偏移） */
  baseTopY: number;
}

/** 构造 cc.Color */
function col(hex: string, alpha: number): Color {
  const c = hexToColor(hex);
  return new Color(c.r, c.g, c.b, alpha);
}

export class RecruitPanel {
  /** 弹层关闭（含点空白）时回调 */
  onClose: (() => void) | null = null;
  /** 成功招募一次后回调（调用方据此存档） */
  onRecruit: (() => void) | null = null;
  /** 提示气泡回调（注入自 GameManager；未注入则静默） */
  onToast: ((text: string, seconds: number) => void) | null = null;

  private grid: MergeGrid | null = null;
  private root!: Node;
  private cards: CardRef[] = [];
  private footer: Label | null = null;
  private visible = false;

  /** 滚动偏移（H5 单位，等价 H5 的 recruitScrollY，index.html:519） */
  private scrollY = 0;
  /** 滚动上限（H5 单位，等价 recruitMaxScroll，index.html:520） */
  private maxScroll = 0;

  /** H5 → Cocos 的横向/纵向换算因子 */
  private k = 1;
  private originX = 0;
  private originY = 0;

  /** 本次触摸是否已判定为滑动（滑动抬起不当作点击，index.html:1408/1417） */
  private moved = false;
  /** 触摸起点 y 与上一次 y（Cocos UI 坐标，y 向上） */
  private startY = 0;
  private lastY = 0;
  /** 本次触摸序列是否起始于卡片（起始于卡片则抬起时不关闭弹层） */
  private startedOnCard = false;

  // ---------- 构建 ----------

  /** 绑定棋盘状态源（必须在 build 之后调用） */
  bind(grid: MergeGrid) {
    this.grid = grid;
    this.refresh();
  }

  build(parent: Node, width: number, height: number) {
    const k = Math.min(width / DESIGN_W, height / DESIGN_H);
    this.k = isFinite(k) && k > 0 ? k : 1;
    this.originX = -(DESIGN_W * this.k) / 2;
    this.originY = (DESIGN_H * this.k) / 2;

    const root = new Node('recruitPanel');
    root.parent = parent;
    this.root = root;
    const u = root.addComponent(UITransform);
    u.setContentSize(width, height);

    // 全屏不透明遮罩（index.html:2271-2272）
    const g = root.addComponent(Graphics);
    g.fillColor = new Color(6, 6, 12, 255);
    g.roundRect(-width / 2, -height / 2, width, height, 0);
    g.fill();

    // 标题 / 副标题 / 金色分隔线（index.html:2273-2275）
    this.makeText(root, DESIGN_W / 2, 30, 24, '#e8c15a', 'center', true).string = '高级招募';
    this.makeText(root, DESIGN_W / 2, 54, 12, '#9a9ab0', 'center', false).string =
      '选择档位 · 金币付费 · 同档重复招募涨价（封顶 5 倍）';
    const sep = new Node('sep');
    sep.parent = root;
    sep.setPosition(this.sx(DESIGN_W / 2), this.sy(62), 0);
    const sepu = sep.addComponent(UITransform);
    sepu.setContentSize(360 * this.k, 2);
    const sepg = sep.addComponent(Graphics);
    sepg.strokeColor = col('#e8c15a', 89);   // rgba(232,193,90,0.35)
    sepg.lineWidth = 1 * this.k;
    sepg.moveTo(-180 * this.k, 0);
    sepg.lineTo(180 * this.k, 0);
    sepg.stroke();

    // 卡片（2 列 × 12 行）
    this.maxScroll = Math.max(0, ROWS * (CARD_H_H5 + CARD_GAP_H5) - LIST_H_H5);
    for (let i = 0; i < GameConfig.maxTier; i++) {
      const r = Math.floor(i / COLS);
      const c = i % COLS;
      // H5: x = 16 + c*(cardW+12)；y = 70 + r*(cardH+gap) - scrollY（index.html:2289-2292）
      const leftH5 = 16 + c * (CARD_W_H5 + CARD_GAP_H5);
      const baseTopY = LIST_TOP_H5 + r * (CARD_H_H5 + CARD_GAP_H5);

      const card = new Node('recruitCard_' + (i + 1));
      card.parent = root;
      const cu = card.addComponent(UITransform);
      cu.setContentSize(CARD_W_H5 * this.k, CARD_H_H5 * this.k);
      const cg = card.addComponent(Graphics);

      const halfW = (CARD_W_H5 * this.k) / 2;
      const halfH = (CARD_H_H5 * this.k) / 2;
      const bx = BADGE_CENTER_OFF_H5 * this.k - halfW;     // 角标圆心 = H5 卡片内 (31,31)
      const by = halfH - BADGE_CENTER_OFF_H5 * this.k;

      const badge = this.makeCardLabel(card, bx, by, 16, 'center', true);
      const name = this.makeCardLabel(card, 44 * this.k - halfW, halfH - 26 * this.k, 14, 'left', true);
      const cost = this.makeCardLabel(card, 44 * this.k - halfW, halfH - 50 * this.k, 13, 'left', true);
      const count = this.makeCardLabel(card, halfW - 12 * this.k, halfH - 50 * this.k, 11, 'right', false);

      card.on(NodeEventType.TOUCH_START, () => { this.startedOnCard = true; });
      card.on(NodeEventType.TOUCH_END, () => this.onCardTouchEnd(i + 1));

      this.cards.push({
        node: card, gfx: cg, badge, name, cost, count,
        tier: i + 1, baseTopY,
      });
    }

    // 底部提示（index.html:2324-2328）
    this.footer = this.makeText(root, DESIGN_W / 2, DESIGN_H - 30, 11, '#8a93ad', 'center', false);

    // 关闭按钮（index.html:2323）
    this.makeButton(root, CLOSE_BTN_H5, '关闭', '#e8c15a', () => this.hide());

    // 手势：整屏承载「滑动 / 点空白关闭」，并吞掉下层棋盘的触摸
    root.on(NodeEventType.TOUCH_START, (ev: EventTouch) => this.onRootTouchStart(ev));
    root.on(NodeEventType.TOUCH_MOVE, (ev: EventTouch) => this.onRootTouchMove(ev));
    root.on(NodeEventType.TOUCH_END, () => this.onRootTouchEnd());
    root.on(NodeEventType.TOUCH_CANCEL, () => this.onRootTouchCancel());

    this.refresh();
    this.root.active = false;
  }

  // ---------- 显示 / 隐藏 ----------

  show() {
    this.root.active = true;
    this.visible = true;
    // 注意：H5 不在打开时重置 recruitScrollY（index.html:2319 之后也没有重置），此处照做
    this.refresh();
  }

  hide() {
    this.root.active = false;
    this.visible = false;
    if (this.onClose) this.onClose();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  // ---------- 手势 ----------

  private onRootTouchStart(ev: EventTouch) {
    // 记录起点；同时通过「注册了 touch-start」把下层棋盘格子的点击吞掉
    const p = ev.getUILocation();
    this.startY = p.y;
    this.lastY = p.y;
    this.moved = false;
  }

  private onRootTouchMove(ev: EventTouch) {
    const p = ev.getUILocation();
    if (!this.moved && Math.abs(p.y - this.startY) > SCROLL_THRESHOLD_H5 * this.k) {
      this.moved = true;
    }
    // Cocos 的 UI y 向上，H5 的 y 向下：H5 的 rsdy = -(dy)，H5 里 scrollY -= rsdy ⇒ scrollY += dy
    const dy = p.y - this.lastY;
    this.lastY = p.y;
    if (this.maxScroll <= 0) return;
    let next = this.scrollY + dy / this.k;
    if (next < 0) next = 0;
    if (next > this.maxScroll) next = this.maxScroll;
    if (next !== this.scrollY) {
      this.scrollY = next;
      this.layoutCards();
    }
  }

  /**
   * 抬起：只有「起于空白的一次短按」才算点击空白关闭。
   * 判定对齐 H5 的「滑动 / 点击」分离（index.html:1405-1408 的 pointer.moved 阈值、
   * 1418-1426 的滚动分支）：本次手势一旦被判为滑动，抬起就只结束滚动，不关闭弹层。
   */
  private onRootTouchEnd() {
    const scrolled = this.moved;
    const fromCard = this.startedOnCard;
    this.moved = false;
    this.startedOnCard = false;
    if (scrolled || fromCard) return;   // 滑动结束 / 起点在卡片：交给卡片自己的点击处理，不关闭
    if (!this.visible) return;          // 关闭按钮已经关过了（事件冒泡到根节点），不重复回调
    this.hide();                        // 点空白关闭（index.html:1356）
  }

  /**
   * 手势被取消（典型：起于卡片、滑出卡片后抬起 —— 卡片侧只会收到 TOUCH_CANCEL，
   * TOUCH_END 两个回调都不会触发）。必须在这里复位手势标志，否则 startedOnCard 会残留，
   * 把下一次「点空白关闭」吞掉。H5 同样在 pointercancel 里复位手势状态（index.html:1459-1464）。
   */
  private onRootTouchCancel() {
    this.moved = false;
    this.startedOnCard = false;
  }

  /** 卡片抬起：滑动则不当作点击（index.html:1408/1417） */
  private onCardTouchEnd(tier: number) {
    if (this.moved) return;
    const grid = this.grid;
    if (!grid) return;

    if (grid.highestTier < tier) {
      // index.html:1351-1352（未解锁档位点按 → toast 1.8s）
      if (this.onToast) this.onToast('需先合出 ' + tier + ' 档才能招募', 1.8);
      return;
    }
    if (grid.recruitTier(tier)) {
      // 失败时的 toast 由 MergeGrid 内部给出（index.html:668/674/681）
      if (this.onRecruit) this.onRecruit();
      this.refresh();
    }
  }

  // ---------- 刷新 ----------

  /** 重绘全部卡片（解锁态 / 角标 / 费用 / 招募次数），index.html:2294-2319 */
  refresh() {
    const grid = this.grid;
    const k = this.k;
    const halfW = (CARD_W_H5 * k) / 2;
    const halfH = (CARD_H_H5 * k) / 2;

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const tierN = card.tier;
      const colorHex = GameConfig.tierColors[i];
      const kind = hexToColor(colorHex);
      // 注意：招募弹层的解锁判定只看最高档位，不看门槛（index.html:2294）
      const unlocked = !!grid && grid.highestTier >= tierN;

      card.gfx.clear();
      // 底色：已解锁 rgba(28,28,42,0.92)，未解锁 rgba(20,20,30,0.6)（index.html:2296）
      card.gfx.fillColor = unlocked ? new Color(28, 28, 42, 235) : new Color(20, 20, 30, 153);
      card.gfx.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 16 * k);
      card.gfx.fill();
      // 描边：已解锁用档位色，未解锁 rgba(120,120,140,0.4)（index.html:2297）
      card.gfx.lineWidth = 2.5 * k;
      card.gfx.strokeColor = unlocked
        ? new Color(kind.r, kind.g, kind.b, 255)
        : new Color(120, 120, 140, 102);
      card.gfx.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 16 * k);
      card.gfx.stroke();
      // 角标：档位色实心圆 + 深色描边（index.html:2300-2307）
      const bx = BADGE_CENTER_OFF_H5 * k - halfW;
      const by = halfH - BADGE_CENTER_OFF_H5 * k;
      card.gfx.fillColor = new Color(kind.r, kind.g, kind.b, 255);
      card.gfx.circle(bx, by, BADGE_R_H5 * k);
      card.gfx.fill();
      card.gfx.lineWidth = 2 * k;
      card.gfx.strokeColor = new Color(0, 0, 0, 115);   // rgba(0,0,0,0.45)
      card.gfx.circle(bx, by, BADGE_R_H5 * k);
      card.gfx.stroke();

      card.badge.string = String(tierN);
      card.badge.color = col(contrastText(colorHex), 255);

      if (unlocked) {
        // index.html:2310-2315
        card.name.string = GameConfig.characterNames[i];
        card.name.color = new Color(255, 255, 255, 255);
        const cost = grid ? grid.recruitCost(tierN) : 0;
        const enough = !!grid && grid.coins >= cost;
        card.cost.string = '招募 · ' + fmt(cost) + ' 金币';
        card.cost.color = enough ? col('#ffe58a', 255) : col('#d84a3b', 255);
        // 费用字号 13（index.html:2314）
        card.cost.fontSize = Math.max(9, Math.round(13 * k));
        card.count.string = '已招募 ' + (grid ? (grid.recruitCounts[tierN] || 0) : 0) + ' 次';
        card.count.color = col('#9a9ab0', 255);
      } else {
        // index.html:2310 / 2317
        card.name.string = '未解锁';
        card.name.color = col('#7a7a90', 255);
        card.cost.string = '需先合出 ' + tierN + ' 档解锁';
        card.cost.color = col('#6d6d83', 255);
        // 未解锁提示字号 12（index.html:2317），与已解锁的 13 不同，不可复用
        card.cost.fontSize = Math.max(9, Math.round(12 * k));
        card.count.string = '';
      }
    }

    if (this.footer) {
      this.footer.string = this.maxScroll > 0
        ? '上下滑动查看更多'
        : '（点击任意空白处也可关闭）';
    }

    this.layoutCards();
  }

  /** 按当前滚动偏移摆放卡片，并把越出可视带的卡片整卡隐藏（廉价裁剪） */
  private layoutCards() {
    const k = this.k;
    const bandTop = LIST_TOP_H5;
    const bandBottom = LIST_TOP_H5 + LIST_H_H5;

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const topH5 = card.baseTopY - this.scrollY;          // H5：y = startY + r*(h+gap) - scrollY
      const col = i % COLS;
      const leftH5 = 16 + col * (CARD_W_H5 + CARD_GAP_H5);
      card.node.setPosition(
        this.sx(leftH5 + CARD_W_H5 / 2),
        this.sy(topH5 + CARD_H_H5 / 2),
        0,
      );
      card.node.active = this.visible
        && topH5 < bandBottom
        && topH5 + CARD_H_H5 > bandTop;
    }
  }

  // ---------- 坐标换算与零件 ----------

  /** H5 横坐标 → Cocos 横坐标 */
  private sx(x: number): number {
    return this.originX + x * this.k;
  }

  /** H5 纵坐标（向下）→ Cocos 纵坐标（中心原点、向上） */
  private sy(y: number): number {
    return this.originY - y * this.k;
  }

  /** 建一个居中/左/右对齐的单行 Label（H5 的 text() 用 middle 基线，故这里垂直居中） */
  private makeText(
    parent: Node, x: number, y: number, size: number, hex: string,
    align: 'left' | 'center' | 'right', bold: boolean,
  ): Label {
    const n = new Node('lbl');
    n.parent = parent;
    const w = DESIGN_W * this.k;
    const u = n.addComponent(UITransform);
    u.setContentSize(w, Math.max(12, size * this.k * 1.6));
    const anchorX = align === 'left' ? 0 : (align === 'right' ? 1 : 0.5);
    u.setAnchorPoint(anchorX, 0.5);
    n.setPosition(this.sx(x), this.sy(y), 0);
    const l = n.addComponent(Label);
    l.string = '';
    l.fontSize = Math.max(9, Math.round(size * this.k));
    l.lineHeight = Math.max(10, Math.round(size * this.k * 1.25));
    l.isBold = bold;
    l.color = col(hex, 255);
    l.horizontalAlign = align === 'left'
      ? HorizontalTextAlignment.LEFT
      : (align === 'right' ? HorizontalTextAlignment.RIGHT : HorizontalTextAlignment.CENTER);
    l.verticalAlign = VerticalTextAlignment.CENTER;
    return l;
  }

  /** 建卡片内的 Label（坐标已在卡片本地坐标系里） */
  private makeCardLabel(
    parent: Node, x: number, y: number, size: number,
    align: 'left' | 'center' | 'right', bold: boolean,
  ): Label {
    const n = new Node('lbl');
    n.parent = parent;
    const u = n.addComponent(UITransform);
    u.setContentSize(CARD_W_H5 * this.k, Math.max(12, size * this.k * 1.6));
    const anchorX = align === 'left' ? 0 : (align === 'right' ? 1 : 0.5);
    u.setAnchorPoint(anchorX, 0.5);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label);
    l.string = '';
    l.fontSize = Math.max(9, Math.round(size * this.k));
    l.lineHeight = Math.max(10, Math.round(size * this.k * 1.25));
    l.isBold = bold;
    l.color = new Color(255, 255, 255, 255);
    l.horizontalAlign = align === 'left'
      ? HorizontalTextAlignment.LEFT
      : (align === 'right' ? HorizontalTextAlignment.RIGHT : HorizontalTextAlignment.CENTER);
    l.verticalAlign = VerticalTextAlignment.CENTER;
    return l;
  }

  /** 建一个纯色圆角按钮（H5 drawButton 的简化版：cc.Graphics 无渐变） */
  private makeButton(parent: Node, rect: { x: number; y: number; w: number; h: number }, label: string, hex: string, onClick: () => void) {
    const n = new Node('btn');
    n.parent = parent;
    n.setPosition(this.sx(rect.x + rect.w / 2), this.sy(rect.y + rect.h / 2), 0);
    const u = n.addComponent(UITransform);
    u.setContentSize(rect.w * this.k, rect.h * this.k);
    const g = n.addComponent(Graphics);
    const c = hexToColor(hex);
    g.fillColor = new Color(c.r, c.g, c.b, 255);
    g.roundRect(-rect.w * this.k / 2, -rect.h * this.k / 2, rect.w * this.k, rect.h * this.k, 12 * this.k);
    g.fill();
    g.lineWidth = 2 * this.k;
    g.strokeColor = new Color(11, 14, 20, 217);   // rgba(11,14,20,0.85)
    g.roundRect(-rect.w * this.k / 2, -rect.h * this.k / 2, rect.w * this.k, rect.h * this.k, 12 * this.k);
    g.stroke();

    const lbl = new Node('lbl');
    lbl.parent = n;
    const lu = lbl.addComponent(UITransform);
    lu.setContentSize(rect.w * this.k, rect.h * this.k);
    const l = lbl.addComponent(Label);
    l.string = label;
    l.fontSize = Math.max(9, Math.round(16 * this.k));
    l.isBold = true;
    l.color = new Color(255, 255, 255, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;

    n.on(NodeEventType.TOUCH_START, () => { /* 吞掉触摸，避免穿透到弹层下方 */ });
    n.on(NodeEventType.TOUCH_END, onClick);
    return n;
  }
}
