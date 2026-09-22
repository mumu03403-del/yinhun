/**
 * 图鉴面板：展示 24 档角色卡，含碎片进度、每秒产出与门槛目标文案。
 * 卡片左上角为「醒目档位角标」——金边圆点 + 档位数字（对齐 H5 index.html:2235-2244）。
 * 全屏半透明遮罩 + 卡片网格，无素材依赖。
 *
 * 说明：H5 的图鉴卡是 2 列 × 12 行可滚动（竖屏/横屏不同），
 * 这里按需求改为 3 列 × 8 行并在可用高度内动态收缩卡片，
 * 以便在竖屏下一次性完整展示 24 档（横屏版式待编辑器批次处理）。
 */
import {
  Node, UITransform, Label, Graphics, Color, NodeEventType,
  HorizontalTextAlignment, VerticalTextAlignment,
} from 'cc';
import { GameConfig, hexToColor } from '../data/GameConfig';
import { codexCardUnlocked, isGateTier, gateGoalText, gateShort } from '../data/GateConfig';
import { MergeGrid } from './MergeGrid';

/** 单张卡片的可更新引用 */
interface CardRef {
  gfx: Graphics;
  badge: Label;
  name: Label;
  rate: Label;
  frag: Label;
  goal: Label;
  tier: number;
  cardW: number;
  cardH: number;
  badgeR: number;
}

/** 角标金边色（index.html:2242） */
const GOLD_LIGHT = '#ffe58a';

export class CollectionPanel {
  private cards: CardRef[] = [];
  private highestTier = 1;
  private visible = false;
  private root!: Node;
  /** 状态来源：碎片 / 图鉴完成 / 最高档位 */
  private grid: MergeGrid | null = null;
  onClose: (() => void) | null = null;

  /** 绑定棋盘状态源（必须在 build 之后调用） */
  bind(grid: MergeGrid) {
    this.grid = grid;
    this.highestTier = grid.highestTier;
    this.refresh();
  }

  build(parent: Node, width: number, height: number) {
    const root = new Node('collectionPanel');
    root.parent = parent;
    this.root = root;
    const u = root.addComponent(UITransform);
    u.setContentSize(width, height);

    // 全屏遮罩
    const g = root.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 200);
    g.roundRect(-width / 2, -height / 2, width, height, 0);
    g.fill();

    // 标题
    const title = new Node('title');
    title.parent = root;
    title.setPosition(0, height / 2 - 40, 0);
    const tu = title.addComponent(UITransform);
    tu.setContentSize(width, 50);
    const tl = title.addComponent(Label);
    tl.string = '角色图鉴';
    tl.fontSize = 32;
    tl.color = new Color(255, 255, 255, 255);
    tl.horizontalAlign = HorizontalTextAlignment.CENTER;
    tl.verticalAlign = VerticalTextAlignment.CENTER;

    // 卡片网格：3 列 × 8 行 = 24 档，按可用高度动态收缩
    const cols = 3;
    const rows = Math.ceil(GameConfig.maxTier / cols);
    const marginX = 20;
    const topReserve = 92;
    const bottomReserve = 66;
    const gap = 14;

    const cardW = Math.floor((width - marginX * 2 - (cols - 1) * gap) / cols);
    const availH = height - topReserve - bottomReserve - (rows - 1) * gap;
    let cardH = Math.floor(availH / rows);
    if (cardH > 150) cardH = 150;
    if (cardH < 70) cardH = 70;

    const totalW = cols * cardW + (cols - 1) * gap;
    const startX = -totalW / 2 + cardW / 2;
    const startY = height / 2 - topReserve - cardH / 2;

    for (let i = 0; i < GameConfig.maxTier; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const tierN = i + 1;

      const card = new Node('card_' + tierN);
      card.parent = root;
      card.setPosition(
        startX + c * (cardW + gap),
        startY - r * (cardH + gap),
        0,
      );
      const cu = card.addComponent(UITransform);
      cu.setContentSize(cardW, cardH);
      const cg = card.addComponent(Graphics);

      // 角标半径：目标 19（对齐 H5），卡片过小时等比收缩避免压住文字
      let badgeR = Math.min(19, Math.floor(cardH * 0.15), Math.floor((cardW - 24) / 6));
      if (badgeR < 10) badgeR = 10;
      const bx = -cardW / 2 + 12 + badgeR;
      const by = cardH / 2 - 12 - badgeR;

      // 角标数字（由 refresh() 更新文本与颜色）
      const badge = this.makeLabel(card, bx, by, badgeR * 2, badgeR * 2, 17, true);
      badge.isBold = true;
      badge.node.name = 'badgeLabel';

      // 角色名 / 门槛短标
      const nameLb = this.makeLabel(
        card,
        -cardW / 2 + 12 + badgeR * 2 + 8,
        by,
        cardW - badgeR * 2 - 40,
        badgeR * 2,
        13,
        false,
      );
      nameLb.node.name = 'nameLabel';

      // 每秒产出
      const rateLb = this.makeLabel(
        card,
        -cardW / 2 + 12,
        cardH / 2 - 12 - badgeR * 2 - 14,
        cardW - 24,
        16,
        11,
        false,
      );
      rateLb.node.name = 'rateLabel';

      // 碎片进度
      const fragLb = this.makeLabel(
        card,
        -cardW / 2 + 12,
        cardH / 2 - 12 - badgeR * 2 - 30,
        cardW - 24,
        16,
        10,
        false,
      );
      fragLb.node.name = 'fragLabel';

      // 门槛目标 / 未解锁提示（与 rateLabel 占据同一区域，二者互斥）
      const goalLb = this.makeLabel(
        card,
        -cardW / 2 + 12,
        cardH / 2 - 12 - badgeR * 2 - 14,
        cardW - 24,
        Math.max(28, cardH * 0.4),
        10,
        false,
      );
      goalLb.node.name = 'goalLabel';
      goalLb.enableWrapText = true;

      this.cards.push({
        gfx: cg, badge, name: nameLb, rate: rateLb, frag: fragLb, goal: goalLb,
        tier: tierN, cardW, cardH, badgeR,
      });
    }

    // 关闭按钮
    const closeBtn = new Node('closeBtn');
    closeBtn.parent = root;
    closeBtn.setPosition(width / 2 - 40, height / 2 - 40, 0);
    const cu2 = closeBtn.addComponent(UITransform);
    cu2.setContentSize(60, 60);
    const cg2 = closeBtn.addComponent(Graphics);
    const cc = hexToColor('#c0392b');
    cg2.fillColor = new Color(cc.r, cc.g, cc.b, cc.a);
    cg2.roundRect(-30, -30, 60, 60, 8);
    cg2.fill();
    const cl = new Node('cl');
    cl.parent = closeBtn;
    const clu = cl.addComponent(UITransform);
    clu.setContentSize(60, 60);
    const cll = cl.addComponent(Label);
    cll.string = 'X';
    cll.fontSize = 28;
    cll.color = new Color(255, 255, 255, 255);
    cll.horizontalAlign = HorizontalTextAlignment.CENTER;
    cll.verticalAlign = VerticalTextAlignment.CENTER;
    closeBtn.on(NodeEventType.TOUCH_END, () => this.hide());

    // 底部提示
    const tip = new Node('tip');
    tip.parent = root;
    tip.setPosition(0, -height / 2 + 34, 0);
    const tiu = tip.addComponent(UITransform);
    tiu.setContentSize(width - 40, 24);
    const til = tip.addComponent(Label);
    til.string = '点击右上角 X 关闭 · 碎片满 10 即点亮图鉴';
    til.fontSize = 12;
    til.color = new Color(150, 155, 175, 255);
    til.horizontalAlign = HorizontalTextAlignment.CENTER;
    til.verticalAlign = VerticalTextAlignment.CENTER;

    this.refresh();
    this.root.active = false;
  }

  /** 建一个左对齐 Label 节点，返回 Label 组件 */
  private makeLabel(
    parent: Node, x: number, y: number, w: number, h: number, fontSize: number, centered: boolean,
  ): Label {
    const n = new Node('lbl');
    n.parent = parent;
    n.setPosition(x, y, 0);
    const u = n.addComponent(UITransform);
    u.setContentSize(w, h);
    // 左对齐时把锚点移到左边缘，使文本从节点 x 处起排
    u.setAnchorPoint(centered ? 0.5 : 0, 0.5);
    const l = n.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = fontSize + 3;
    l.horizontalAlign = centered ? HorizontalTextAlignment.CENTER : HorizontalTextAlignment.LEFT;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    return l;
  }

  /** 合并升档后刷新解锁状态（最高档位以棋盘状态为准） */
  unlockTier(tier: number) {
    if (this.grid) {
      this.highestTier = this.grid.highestTier;
    } else if (tier > this.highestTier) {
      this.highestTier = tier;
    }
    this.refresh();
  }

  /** 重绘全部卡片（解锁态 / 角标 / 碎片 / 产出 / 门槛文案） */
  private refresh() {
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const tierN = card.tier;
      const colorHex = GameConfig.tierColors[i];

      // 解锁判定：有门槛的档位需「已达该档 + 门槛满足」（index.html:1156-1159）
      const unlocked = this.grid
        ? codexCardUnlocked(tierN, this.grid)
        : this.highestTier >= tierN;
      const gated = isGateTier(tierN);
      const done = this.grid ? !!this.grid.codexDone[tierN] : false;
      const frags = this.grid ? (this.grid.fragments[tierN] || 0) : 0;

      // 卡片底板 + 档位色描边（index.html:2218-2225）
      const kind = hexToColor(colorHex);
      card.gfx.clear();
      card.gfx.fillColor = unlocked
        ? new Color(28, 28, 42, 255)          // 已解锁：#1c1c2a
        : new Color(255, 255, 255, 15);       // 未解锁：rgba(255,255,255,0.06)
      card.gfx.roundRect(-card.cardW / 2, -card.cardH / 2, card.cardW, card.cardH, 16);
      card.gfx.fill();

      card.gfx.lineWidth = 2.5;
      card.gfx.strokeColor = new Color(kind.r, kind.g, kind.b, 255);
      card.gfx.roundRect(-card.cardW / 2, -card.cardH / 2, card.cardW, card.cardH, 16);
      card.gfx.stroke();

      // 醒目角标：档位色实心圆 + 金边（index.html:2235-2244）
      const bx = -card.cardW / 2 + 12 + card.badgeR;
      const by = card.cardH / 2 - 12 - card.badgeR;
      card.gfx.fillColor = unlocked
        ? new Color(kind.r, kind.g, kind.b, 255)
        : new Color(255, 255, 255, 31);       // rgba(255,255,255,0.12)
      card.gfx.circle(bx, by, card.badgeR);
      card.gfx.fill();
      card.gfx.lineWidth = 2.5;
      const gold = hexToColor(GOLD_LIGHT);
      card.gfx.strokeColor = unlocked
        ? new Color(gold.r, gold.g, gold.b, 255)
        : new Color(255, 255, 255, 51);       // rgba(255,255,255,0.2)
      card.gfx.circle(bx, by, card.badgeR);
      card.gfx.stroke();

      // 角标数字
      card.badge.string = String(tierN);
      card.badge.color = unlocked
        ? new Color(255, 255, 255, 255)
        : new Color(109, 109, 131, 255);      // #6d6d83

      if (unlocked) {
        // 已解锁：角色名 + 每秒产出 + 碎片进度
        card.name.string = GameConfig.characterNames[i];
        card.name.color = new Color(255, 255, 255, 255);
        card.rate.string = '+' + GameConfig.coinRate[i] + '/秒';
        card.rate.color = new Color(143, 216, 168, 255);   // #8fd8a8
        card.frag.string = '碎片 ' + frags + '/' + GameConfig.fragmentMax;
        card.frag.color = done
          ? new Color(232, 193, 90, 255)                   // #e8c15a：已集齐
          : new Color(207, 207, 224, 255);                 // #cfcfe0
        card.goal.string = '';
      } else {
        card.rate.string = '';
        card.frag.string = '';
        if (gated) {
          // 门槛档位：短标 + 完整目标文案
          card.name.string = gateShort(tierN);
          card.name.color = new Color(216, 216, 230, 255);
          card.goal.string = gateGoalText(tierN, this.grid ? this.grid : undefined);
          card.goal.color = new Color(216, 216, 230, 255);
        } else {
          card.name.string = '未解锁';
          card.name.color = new Color(150, 150, 150, 255);
          card.goal.string = '需要 ' + tierN + ' 档';
          card.goal.color = new Color(92, 92, 114, 255);   // #5c5c72
        }
      }
    }
  }

  show() {
    this.root.active = true;
    this.visible = true;
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
}
