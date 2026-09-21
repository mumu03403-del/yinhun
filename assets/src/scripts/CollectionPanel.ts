/**
 * 图鉴面板：展示占位角色卡，合并到对应档位后解锁。
 * 全屏半透明遮罩 + 卡片网格，无素材。
 */
import {
  Node, UITransform, Label, Graphics, Color, NodeEventType,
  HorizontalTextAlignment, VerticalTextAlignment,
} from 'cc';
import { GameConfig, hexToColor } from '../data/GameConfig';

interface CardRef {
  bg: Graphics;
  label: Label;
}

export class CollectionPanel {
  private cards: CardRef[] = [];
  private highestTier = 1;
  private visible = false;
  private root!: Node;
  onClose: (() => void) | null = null;

  build(parent: Node, width: number, height: number) {
    const root = new Node('collectionPanel');
    root.parent = parent;
    this.root = root;
    const u = root.addComponent(UITransform);
    u.setContentSize(width, height);

    const g = root.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 180);
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

    // 卡片网格 2 列
    const cols = 2;
    const cardW = Math.min(280, width / 2 - 30);
    const cardH = 120;
    const gap = 20;
    const totalW = cols * cardW + (cols - 1) * gap;
    const startX = -totalW / 2 + cardW / 2;
    const startY = height / 2 - 130;

    for (let i = 0; i < GameConfig.maxTier; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const card = new Node(`card_${i}`);
      card.parent = root;
      card.setPosition(startX + c * (cardW + gap), startY - r * (cardH + gap), 0);
      const cu = card.addComponent(UITransform);
      cu.setContentSize(cardW, cardH);
      const cg = card.addComponent(Graphics);
      cg.fillColor = new Color(60, 60, 70, 255);
      cg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
      cg.fill();

      const lbl = new Node('clbl');
      lbl.parent = card;
      const lu = lbl.addComponent(UITransform);
      lu.setContentSize(cardW, cardH);
      const cl = lbl.addComponent(Label);
      cl.string = '???';
      cl.fontSize = 22;
      cl.color = new Color(150, 150, 150, 255);
      cl.horizontalAlign = HorizontalTextAlignment.CENTER;
      cl.verticalAlign = VerticalTextAlignment.CENTER;

      this.cards.push({ bg: cg, label: cl });
    }

    // 关闭按钮
    const closeBtn = new Node('closeBtn');
    closeBtn.parent = root;
    closeBtn.setPosition(width / 2 - 40, height / 2 - 40, 0);
    const cu = closeBtn.addComponent(UITransform);
    cu.setContentSize(60, 60);
    const cg = closeBtn.addComponent(Graphics);
    const cc = hexToColor('#c0392b');
    cg.fillColor = new Color(cc.r, cc.g, cc.b, cc.a);
    cg.roundRect(-30, -30, 60, 60, 8);
    cg.fill();
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

    this.refresh();
    this.root.active = false;
  }

  /** 记录已达到的最高档位并刷新解锁状态 */
  unlockTier(tier: number) {
    if (tier > this.highestTier) this.highestTier = tier;
    this.refresh();
  }

  private refresh() {
    for (let i = 0; i < this.cards.length; i++) {
      const unlocked = this.highestTier >= i + 2; // card i 在达到 tier (i+2) 时解锁
      const card = this.cards[i];
      if (unlocked) {
        const c = hexToColor(GameConfig.tierColors[i]);
        card.bg.fillColor = new Color(c.r, c.g, c.b, c.a);
        card.label.string = GameConfig.characterNames[i];
        card.label.color = new Color(255, 255, 255, 255);
      } else {
        card.bg.fillColor = new Color(60, 60, 70, 255);
        card.label.string = '???';
        card.label.color = new Color(150, 150, 150, 255);
      }
    }
  }

  show() {
    this.root.active = true;
    this.visible = true;
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
