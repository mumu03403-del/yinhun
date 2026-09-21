/**
 * 游戏总控：构建背景/HUD/网格/图鉴，驱动放置收益(idle tick)，连接合并升档与图鉴解锁。
 * 作为组件挂在 GameRoot 节点上（由 Bootstrap 在运行时添加）。
 */
import { _decorator, Component, Node, UITransform, Graphics, Color, view } from 'cc';
import { GameConfig, hexToColor } from '../data/GameConfig';
import { MergeGrid } from './MergeGrid';
import { Hud } from './Hud';
import { CollectionPanel } from './CollectionPanel';

const { ccclass } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {
  private coins = 0;
  private grid!: MergeGrid;
  private hud!: Hud;
  private collection!: CollectionPanel;

  /** 由 Bootstrap 在 start 阶段调用，构建并启动游戏 */
  setup() {
    const size = view.getVisibleSize();
    // 兜底：极少数情况下首帧视口尚未就绪，使用竖屏默认尺寸
    const W = size.width > 0 ? size.width : 720;
    const H = size.height > 0 ? size.height : 1280;

    this.buildBackground(W, H);

    const margin = 24;
    const topBarH = 70;
    const spawnBtnH = 48;
    const gap = 8;

    const availW = W - margin * 2;
    const availH = H - topBarH - spawnBtnH - margin * 3;
    let cell = Math.floor(Math.min(availW / GameConfig.gridCols - gap, availH / GameConfig.gridRows - gap));
    cell = Math.max(40, cell);

    const gridTotalH = GameConfig.gridRows * cell + (GameConfig.gridRows - 1) * gap;

    // 网格根节点
    const gridRoot = new Node('gridRoot');
    gridRoot.parent = this.node;
    const gridCenterY = (H / 2 - topBarH - margin) - gridTotalH / 2;
    gridRoot.setPosition(0, gridCenterY, 0);

    this.grid = new MergeGrid();
    this.grid.build(gridRoot, cell);
    this.grid.onMergeUpgrade = (tier) => this.onUnitUpgraded(tier);

    // HUD（顶栏 + 招募按钮）
    this.hud = new Hud();
    this.hud.build(this.node, H / 2 - 35, W);
    this.hud.onOpenCollection = () => this.collection.toggle();
    this.hud.onSpawn = () => this.grid.spawnTier1();

    // 图鉴面板（全屏）
    this.collection = new CollectionPanel();
    this.collection.build(this.node, W, H);

    // 开局放置初始单位
    for (let i = 0; i < GameConfig.initialUnits; i++) {
      this.grid.spawnTier1();
    }

    this.hud.setCoins(this.coins);

    // 放置收益：每秒结算一次
    this.schedule(this.tick, 1);
  }

  private buildBackground(W: number, H: number) {
    const bg = new Node('bg');
    bg.parent = this.node;
    const u = bg.addComponent(UITransform);
    u.setContentSize(W, H);
    const g = bg.addComponent(Graphics);
    const c = hexToColor('#0f0f17');
    g.fillColor = new Color(c.r, c.g, c.b, c.a);
    g.roundRect(-W / 2, -H / 2, W, H, 0);
    g.fill();
  }

  private tick = () => {
    const rate = this.grid.getCoinsPerSecond();
    this.coins += rate; // rate 为每秒产出，tick 间隔 1s
    this.hud.setCoins(this.coins);
  };

  private onUnitUpgraded(tier: number) {
    this.collection.unlockTier(tier);
  }
}
