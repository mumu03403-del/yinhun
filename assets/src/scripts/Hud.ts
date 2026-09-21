/**
 * 顶栏 HUD：金币显示 + 图鉴按钮 + 招募(生成单位)按钮。
 * 全部图形化绘制，无素材。
 */
import {
  Node, UITransform, Label, Graphics, Color, NodeEventType,
  HorizontalTextAlignment, VerticalTextAlignment,
} from 'cc';
import { hexToColor } from '../data/GameConfig';

export class Hud {
  coinsLabel!: Label;
  onOpenCollection: (() => void) | null = null;
  onSpawn: (() => void) | null = null;

  build(parent: Node, topY: number, width: number) {
    // 顶栏背景
    const bar = new Node('hudBar');
    bar.parent = parent;
    bar.setPosition(0, topY, 0);
    const bu = bar.addComponent(UITransform);
    bu.setContentSize(width, 70);
    const bg = bar.addComponent(Graphics);
    const c = hexToColor('#14141e');
    bg.fillColor = new Color(c.r, c.g, c.b, c.a);
    bg.roundRect(-width / 2, -35, width, 70, 0);
    bg.fill();

    // 金币文本
    const coinNode = new Node('coins');
    coinNode.parent = bar;
    coinNode.setPosition(-width / 2 + 20, 0, 0);
    const cu = coinNode.addComponent(UITransform);
    cu.setContentSize(300, 50);
    this.coinsLabel = coinNode.addComponent(Label);
    this.coinsLabel.string = '金币: 0';
    this.coinsLabel.fontSize = 28;
    const cc = hexToColor('#f1c40f');
    this.coinsLabel.color = new Color(cc.r, cc.g, cc.b, cc.a);
    this.coinsLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.coinsLabel.verticalAlign = VerticalTextAlignment.CENTER;

    // 图鉴按钮
    const colBtn = this.makeButton('图鉴', width / 2 - 80, 0, 120, 50, hexToColor('#3498db'));
    colBtn.parent = bar;
    colBtn.on(NodeEventType.TOUCH_END, () => {
      if (this.onOpenCollection) this.onOpenCollection();
    });

    // 招募按钮（生成单位），放在顶栏下方
    const spawnBtn = this.makeButton('招募 +1', 0, topY - 60, 160, 48, hexToColor('#2ecc71'));
    spawnBtn.parent = parent;
    spawnBtn.on(NodeEventType.TOUCH_END, () => {
      if (this.onSpawn) this.onSpawn();
    });
  }

  private makeButton(text: string, x: number, y: number, w: number, h: number, color: any): Node {
    const n = new Node('btn');
    n.setPosition(x, y, 0);
    const u = n.addComponent(UITransform);
    u.setContentSize(w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(color.r, color.g, color.b, color.a);
    g.roundRect(-w / 2, -h / 2, w, h, 10);
    g.fill();

    const lbl = new Node('lbl');
    lbl.parent = n;
    const lu = lbl.addComponent(UITransform);
    lu.setContentSize(w, h);
    const l = lbl.addComponent(Label);
    l.string = text;
    l.fontSize = 24;
    l.color = new Color(255, 255, 255, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    return n;
  }

  setCoins(v: number) {
    this.coinsLabel.string = `金币: ${Math.floor(v)}`;
  }
}
