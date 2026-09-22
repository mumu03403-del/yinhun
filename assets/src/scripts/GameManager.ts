/**
 * 游戏总控：构建背景/HUD/网格/图鉴，驱动放置收益（idle tick）、自动放置、
 * 本地存档与离线收益。数值全部对齐 H5 v2.8.0（build/publish/index.html）。
 * 作为组件挂在 GameRoot 节点上（由 Bootstrap 在运行时添加）。
 */
import {
  _decorator, Component, Node, UITransform, Graphics, Color, Label,
  HorizontalTextAlignment, VerticalTextAlignment, view,
} from 'cc';
import { GameConfig, hexToColor } from '../data/GameConfig';
import * as SaveStore from '../data/SaveStore';
import { MergeGrid } from './MergeGrid';
import { Hud } from './Hud';
import { CollectionPanel } from './CollectionPanel';

const { ccclass } = _decorator;

/** 布局常量（与 index.html 的 margin / topBarH 对应） */
const MARGIN = 24;
const TOP_BAR_H = 70;
const SPAWN_BTN_H = 48;
/** 存档节流：每 N 秒落盘一次 */
const SAVE_INTERVAL_SEC = 2;

@ccclass('GameManager')
export class GameManager extends Component {
  private grid!: MergeGrid;
  private hud!: Hud;
  private collection!: CollectionPanel;
  /** 棋盘根节点，解锁新行重排时复用 */
  private gridRoot: Node | null = null;
  /** 存档节流计时（秒） */
  private saveTimer = 0;

  /** 由 Bootstrap 在 start 阶段调用，构建并启动游戏 */
  setup() {
    const W = this.viewW();
    const H = this.viewH();

    this.buildBackground(W, H);

    // 先读存档，确定已解锁行数 / 金币 / 进度
    const saved = SaveStore.load();
    this.grid = new MergeGrid();
    if (saved) this.grid.applySaveData(saved);

    // HUD（顶栏 + 招募按钮）
    this.hud = new Hud();
    this.hud.build(this.node, H / 2 - 35, W);
    this.hud.onOpenCollection = () => this.collection.toggle();
    this.hud.onSpawn = () => this.onSpawnPressed();

    // 图鉴面板（全屏）
    this.collection = new CollectionPanel();
    this.collection.build(this.node, W, H);
    this.collection.bind(this.grid);

    // 网格回调
    this.grid.onMergeUpgrade = (tier) => this.onUnitUpgraded(tier);
    this.grid.onCodexDone = (tier) => this.onCodexDone(tier);
    this.grid.onRowUnlocked = () => this.onRowUnlocked();
    this.grid.onToast = (text, seconds) => this.showToast(text, seconds);

    // 按（存档中的）已解锁行数建棋盘
    this.buildBoard(W, H);

    // 新档：放置开局单位（index.html INITIAL_UNITS）
    if (!saved) {
      for (let i = 0; i < GameConfig.initialUnits; i++) this.grid.spawnTier1();
    }

    // 离线收益（index.html:607-611）
    if (saved) {
      const elapsed = SaveStore.elapsedSince(saved.time);
      const gain = SaveStore.offlineGain(this.grid.coinsPerSecond(), elapsed);
      if (gain > 0) {
        this.grid.coins += gain;
        this.showToast('离线收益 +' + gain + ' 金币', 3.0);
      }
    }

    this.hud.setCoins(this.grid.coins);

    // 放置收益：每秒结算一次
    this.schedule(this.tick, 1);
    // 自动放置：每 15 秒一次（H5 AUTO_SPAWN_INTERVAL）
    this.schedule(this.autoSpawnTick, GameConfig.autoSpawnInterval);
  }

  // ---------- 视口 ----------

  private viewW(): number {
    const s = view.getVisibleSize();
    return s.width > 0 ? s.width : 720;
  }

  private viewH(): number {
    const s = view.getVisibleSize();
    return s.height > 0 ? s.height : 1280;
  }

  // ---------- 棋盘布局 ----------

  /**
   * 依据当前已解锁行数计算格子尺寸并（重）建棋盘。
   * 对应 H5 的 recomputeLayout()：行数变化时格子尺寸随之变化。
   */
  private buildBoard(W: number, H: number) {
    const rows = Math.max(1, this.grid.unlockedRows);

    const availW = W - MARGIN * 2;
    const availH = H - TOP_BAR_H - SPAWN_BTN_H - MARGIN * 3;
    let cell = Math.floor(Math.min(
      availW / GameConfig.gridCols - 8,
      availH / rows - 8,
    ));
    if (!isFinite(cell) || cell < 40) cell = 40;

    const totalH = rows * cell + (rows - 1) * 8;
    const centerY = (H / 2 - TOP_BAR_H - MARGIN) - totalH / 2;

    if (!this.gridRoot || !this.gridRoot.isValid) {
      this.gridRoot = new Node('gridRoot');
      this.gridRoot.parent = this.node;
    }
    this.gridRoot.setPosition(0, centerY, 0);
    this.grid.build(this.gridRoot, cell);
  }

  // ---------- 定时器 ----------

  /** 每秒：累计金币 + 刷新 HUD + 节流存档 */
  private tick = () => {
    const rate = this.grid.coinsPerSecond();
    if (rate > 0) this.grid.coins += rate;
    this.hud.setCoins(this.grid.coins);

    this.saveTimer++;
    if (this.saveTimer >= SAVE_INTERVAL_SEC) {
      this.saveTimer = 0;
      SaveStore.save(this.grid.toSaveState());
    }
  };

  /** 每 15 秒：自动放置一个单位 */
  private autoSpawnTick = () => {
    const tier = this.grid.autoSpawn();
    if (tier > 0) this.saveNow();
  };

  // ---------- 事件 ----------

  /**
   * HUD「招募」按钮。
   * 注：H5 中该按钮打开「高级招募」分档付费弹层；该弹层需要重排右侧面板
   * （P4 批次，依赖 Cocos 编辑器），因此此处保留原有的免费放置 1 档行为，
   * 分档付费逻辑已实现于 MergeGrid.recruitTier()。
   */
  private onSpawnPressed() {
    if (this.grid.spawnTier1()) this.saveNow();
  }

  private onUnitUpgraded(tier: number) {
    this.collection.unlockTier(tier);
    this.saveNow();
  }

  private onCodexDone(tier: number) {
    this.showToast(tier + ' 档图鉴已完成！', 3.0);
    this.saveNow();
  }

  /** 解锁新行后需要重排棋盘（格子尺寸随行数变化） */
  private onRowUnlocked() {
    this.buildBoard(this.viewW(), this.viewH());
    this.saveNow();
  }

  /** 立即落盘并重置节流计时 */
  private saveNow() {
    this.saveTimer = 0;
    SaveStore.save(this.grid.toSaveState());
  }

  // ---------- 背景与提示 ----------

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

  /**
   * 轻量提示气泡：临时 Label 节点，若干秒后自动销毁。
   * 替代 H5 的 canvas toast（后者依赖 812×375 舞台与字体渲染）。
   */
  private showToast(text: string, seconds: number) {
    const W = this.viewW();
    const H = this.viewH();

    const n = new Node('toast');
    n.parent = this.node;
    n.setPosition(0, H / 2 - 132, 0);

    const u = n.addComponent(UITransform);
    u.setContentSize(W - 40, 44);

    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 200);
    g.roundRect(-(W - 40) / 2, -22, W - 40, 44, 10);
    g.fill();

    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = 20;
    l.lineHeight = 24;
    l.color = new Color(255, 255, 255, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;

    const life = seconds > 0 ? seconds : 2;
    this.scheduleOnce(() => {
      if (n && n.isValid) n.destroy();
    }, life);
  }
}
