/**
 * 游戏总控：构建背景/网格/右侧控制面板/图鉴/招募弹层，驱动放置收益（idle tick）、
 * 自动放置、本地存档与离线收益。数值全部对齐 H5 v2.8.0（build/publish/index.html）。
 *
 * ⚠️ 挂载方式：作为组件挂在 GameRoot 节点上（由 Bootstrap 在运行时添加）。
 *   · GameAudio（scripts/Audio.ts）会自动补挂到**同一节点**上——音效 clip 需要
 *     在编辑器里给该组件挂资源，没挂时静默降级。
 *   · Hud / CollectionPanel / RecruitPanel 都是运行时纯代码构建，不需要在编辑器里挂节点。
 *
 * 本文件里对 H5 的接线对应关系：
 *   HUD 右侧面板按钮        ← index.html:1366-1388
 *   合并音效 + 原声          ← index.html:767-768
 *   图鉴达成音效            ← index.html:774-775
 *   满级变现音效            ← index.html:805-806
 *   离线收益弹窗/提示        ← index.html:607-615（H5 是 modal，这里是 toast）
 *   重置存档                ← index.html:1384-1388 → resetAll() index.html:619-623
 *   好友入口                ← index.html:1372-1378（无 GinSocial 时的 else 分支）
 */
import {
  _decorator, Component, Node, UITransform, Graphics, Color, Label,
  HorizontalTextAlignment, VerticalTextAlignment, view,
} from 'cc';
import { GameConfig, hexToColor, fmt } from '../data/GameConfig';
import * as SaveStore from '../data/SaveStore';
import { MergeGrid } from './MergeGrid';
import { Hud } from './Hud';
import { CollectionPanel } from './CollectionPanel';
import { RecruitPanel } from './RecruitPanel';
import { GameAudio } from './Audio';

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
  private recruit!: RecruitPanel;
  /** 音频组件（挂在本节点上；资源未导入时静默降级） */
  private audio: GameAudio | null = null;
  /** 棋盘根节点，解锁新行重排时复用 */
  private gridRoot: Node | null = null;
  /** 存档节流计时（秒） */
  private saveTimer = 0;

  /** 由 Bootstrap 在 start 阶段调用，构建并启动游戏 */
  setup() {
    const W = this.viewW();
    const H = this.viewH();

    this.buildBackground(W, H);

    // 音频组件（同节点上，缺则自动补）
    this.audio = this.node.getComponent(GameAudio) || this.node.addComponent(GameAudio);

    // 先读存档，确定已解锁行数 / 金币 / 进度
    const saved = SaveStore.load();
    this.grid = new MergeGrid();
    if (saved) this.grid.applySaveData(saved);

    // 网格回调（必须在第一次建棋盘之前接好）
    this.grid.onMergeUpgrade = (tier) => this.onUnitUpgraded(tier);
    this.grid.onCodexDone = (tier) => this.onCodexDone(tier);
    this.grid.onRowUnlocked = () => this.onRowUnlocked();
    this.grid.onSettle = (tier) => this.onSettle(tier);
    this.grid.onToast = (text, seconds) => this.showToast(text, seconds);

    // 按（存档中的）已解锁行数建棋盘
    this.buildBoard(W, H);

    // 新档：放置开局单位（index.html INITIAL_UNITS）
    if (!saved) {
      for (let i = 0; i < GameConfig.initialUnits; i++) this.grid.spawnTier1();
    }

    // 右侧控制面板（HUD）：建在棋盘之后 => 渲染层级在棋盘之上
    this.hud = new Hud();
    this.hud.build(this.node, W, H);
    this.hud.audio = this.audio;
    this.hud.onOpenCollection = () => this.collection.toggle();
    this.hud.onRecruit = () => this.recruit.toggle();
    this.hud.onUnlockRow = () => this.onUnlockRowPressed();
    this.hud.onRestore = () => this.onRestorePressed();
    this.hud.onReset = () => this.onResetConfirmed();
    this.hud.onFriends = () => this.onFriendsPressed();
    this.hud.bind(this.grid);

    // 图鉴面板（全屏）
    this.collection = new CollectionPanel();
    this.collection.build(this.node, W, H);
    this.collection.bind(this.grid);

    // 高级招募弹层（全屏）
    this.recruit = new RecruitPanel();
    this.recruit.build(this.node, W, H);
    this.recruit.bind(this.grid);
    this.recruit.onRecruit = () => this.saveNow();
    this.recruit.onToast = (text, seconds) => this.showToast(text, seconds);
    this.recruit.onClose = () => this.hud.refresh();

    // 离线收益（index.html:607-616）
    if (saved) {
      const elapsed = SaveStore.elapsedSince(saved.time);
      const gain = SaveStore.offlineGain(this.grid.coinsPerSecond(), elapsed);
      if (gain > 0) {
        this.grid.coins += gain;
        // H5 这里用 modal 弹窗（index.html:2355-2373），移植版沿用轻量 toast
        this.showToast('离线收益 +' + fmt(gain) + ' 金币', 3.0);
      }
    }

    this.hud.refresh();

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
   *
   * 注：H5 的棋盘固定在左侧棋盘区（BOARD_X0..BOARD_X1，index.html:150-155），
   * 移植版目前仍是「整屏居中」的竖屏适配版式，尚未搬进同一 812×375 舞台坐标系
   * （与右侧面板的横屏对齐是下一批次的事）。
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

  /** 每秒：累计金币 + 刷新面板 + 节流存档 */
  private tick = () => {
    const rate = this.grid.coinsPerSecond();
    if (rate > 0) this.grid.coins += rate;
    // 面板全部动态文案（金币/秒产/解锁按钮/统计行/存档提示/招募价）都在 refresh 里刷新
    this.hud.refresh();

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

  // ---------- 面板按钮事件（index.html:1366-1388） ----------

  /** 解锁下一行（index.html:1368 → tryUnlockRow 1970-1988） */
  private onUnlockRowPressed() {
    this.grid.tryUnlockRow();
    this.hud.refresh();
  }

  /** 恢复方块（index.html:1379-1383 → restoreBlocks 698-714） */
  private onRestorePressed() {
    const filled = this.grid.restoreBlocks();
    if (filled > 0) this.saveNow();
    this.hud.refresh();
  }

  /**
   * 好友（index.html:1372-1378）：H5 有 GinSocial 就打开排行榜面板，
   * 否则提示「社交功能加载中…」。移植版没有社交模块，因此走 H5 的 else 分支。
   */
  private onFriendsPressed() {
    this.showToast('社交功能加载中…', 1.6);
  }

  /**
   * 重置存档：Hud 的确认弹窗点「确定」后才进到这里。
   * H5 resetAll()（index.html:619-623）= 抑制存档 + removeItem + location.reload()。
   * Cocos 侧不重载场景，改为「清空存档 → 复位内存状态 → 重铺开局单位」，
   * 等价于 H5 重载后 boot() 的行为（index.html:2512-2515）。
   */
  private onResetConfirmed() {
    SaveStore.clear();
    this.grid.resetState();
    // resetState() 不复位「已解锁行数」（它是构造期字段 + 解锁时自增），这里显式复位
    this.grid.unlockedRows = GameConfig.defaultRows;

    this.buildBoard(this.viewW(), this.viewH());
    for (let i = 0; i < GameConfig.initialUnits; i++) this.grid.spawnTier1();

    this.collection.bind(this.grid);
    this.recruit.bind(this.grid);
    this.hud.refresh();
    this.saveNow();
  }

  // ---------- 玩法事件 ----------

  /** 合并升档（H5 doMerge 的音效：index.html:767-768） */
  private onUnitUpgraded(tier: number) {
    if (this.audio) {
      this.audio.playVoice(tier);
      this.audio.playSfx('sfx_merge');
    }
    this.collection.unlockTier(tier);
    this.hud.refresh();
    this.saveNow();
  }

  /**
   * 某档图鉴集齐。
   * 音效对齐 H5 triggerCodexCelebration（index.html:772-775：sfx_unlock + 该档原声）；
   * H5 还会播一个 3.4 秒的全屏庆祝动效（index.html:1990-2023），移植版只给 toast。
   */
  private onCodexDone(tier: number) {
    if (this.audio) {
      this.audio.playSfx('sfx_unlock');
      this.audio.playVoice(tier);
    }
    this.showToast(tier + ' 档图鉴已完成！', 3.0);
    this.saveNow();
  }

  /** 满级变现（H5 doSettle 的音效：index.html:805-806） */
  private onSettle(tier: number) {
    if (this.audio) {
      this.audio.playVoice(tier);
      this.audio.playSfx('sfx_settle');
    }
    this.hud.refresh();
    this.saveNow();
  }

  /** 解锁新行后需要重排棋盘（格子尺寸随行数变化） */
  private onRowUnlocked() {
    this.buildBoard(this.viewW(), this.viewH());
    this.hud.refresh();
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
