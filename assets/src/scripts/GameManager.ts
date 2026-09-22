/**
 * 游戏总控：构建背景/网格/右侧控制面板/图鉴/招募弹层，驱动放置收益（idle tick）、
 * 自动放置、本地存档与离线收益。数值全部对齐 H5 v2.8.0（build/publish/index.html）。
 *
 * ⚠️ 挂载方式：作为组件挂在 GameRoot 节点上（由 Bootstrap 在运行时添加）。
 *   · GameAudio（scripts/Audio.ts）会自动补挂到**同一节点**上——音频/美术资源
 *     由 AssetHub 从 resources bundle 按路径加载，**无需在编辑器里挂任何引用**；
 *     资源缺失时静默降级（不报错、不阻塞）。
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
import { AssetHub } from './AssetHub';

const { ccclass } = _decorator;

/**
 * 布局常量 —— 全部照抄 H5 v2.8.0 的 812×375 逻辑舞台（build/publish/index.html），
 * 使 Cocos 版与 H5 版落在同一套舞台坐标系里（Hud.ts 用的也是这套换算）。
 *
 * ⚠️ 关键：棋盘的**水平可用区不是整屏宽**，而是「棋盘区」BOARD_X0..BOARD_X1：
 *   REGION_W = BOARD_X1 - BOARD_X0 = 454（index.html:150-152），
 *   右侧面板自 PANEL_X = 478 起（index.html:158 → Hud.ts:44 PANEL_RECT.x）。
 *   旧实现用 W - MARGIN*2（整屏宽）算格子尺寸并整屏居中，棋盘右半因此被面板压住。
 */
const DESIGN_W = 812;                         // index.html:142
const DESIGN_H = 375;                         // index.html:143
const CELL_MAX = 86;                          // 单格上限（index.html:147）
const BOARD_X0 = 12;                          // 棋盘区左边界（index.html:150）
const BOARD_X1 = 466;                         // 棋盘区右边界（index.html:151）
const REGION_W = BOARD_X1 - BOARD_X0;         // 454（index.html:152）
const REGION_TOP = 46;                        // 棋盘区上边界（index.html:153）
const REGION_BOTTOM = 366;                    // 棋盘区下边界（index.html:154）
const REGION_H = REGION_BOTTOM - REGION_TOP;  // 320（index.html:155）
/**
 * 格间距：必须与 MergeGrid.build 内部实际使用的 gap 完全一致（MergeGrid.ts:22 gap = 8），
 * 否则「按 REGION_W 算出的格子尺寸」与「实际渲染出的棋盘宽度」对不上，居中量算会偏。
 * （H5 的 GAP 是 6；Cocos 侧不动物理渲染代码，这里统一取 8。）
 */
const BOARD_GAP = 8;
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

    // 资源预载（幂等、非阻塞）：美术/音频都从 resources bundle 按路径异步载入，
    // 不再依赖编辑器里手工挂 @property 引用。
    AssetHub.get().preload();

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

    // 棋盘贴图异步就绪后补画一次（此前回落平面色圆，不会空一格）
    AssetHub.get().onBoardReady(() => {
      if (this.grid) this.grid.refreshViews();
    });

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
   * 逐条对齐 H5 的 recomputeLayout()（index.html:176-211）：
   *   cellW  = floor((REGION_W - (COLS-1)*GAP) / COLS)   ← 用「棋盘区宽度」，不是整屏宽
   *   cellH  = floor((regionAvailH - (rows-1)*GAP) / rows)
   *   CELL   = min(CELL_MAX, cellH, cellW)
   *   GRID_X = BOARD_X0 + (REGION_W - GRID_W)/2           ← 在自己的棋盘区内水平居中
   * 与 H5 的唯一差异：regionAvailH 不再扣除「未解锁行锁定迷你格预留条」（index.html:186-187），
   * 因为本移植版的锁定行整行 active=false、什么都不画。棋盘因此恒落在
   * [BOARD_X0, BOARD_X1] × [REGION_TOP, REGION_BOTTOM] 内，与右侧面板（PANEL_X=478 起）
   * 全程无重叠；行数 5→10 逐档验算（cell = 57/46/38/33/28/24，totalH ≤ 320）均不越界。
   */
  private buildBoard(W: number, H: number) {
    const cols = GameConfig.gridCols;
    const rows = Math.max(1, this.grid.unlockedRows);

    // 与 Hud.build 相同的舞台换算系数（Hud.ts:158-161）；设计分辨率 812×375 下 k=1
    const kRaw = Math.min(W / DESIGN_W, H / DESIGN_H);
    const k = isFinite(kRaw) && kRaw > 0 ? kRaw : 1;

    // 1) 单格尺寸：宽度受「棋盘区宽度」约束，高度受「棋盘区可用高度」约束。
    //    注：H5 的 recomputeLayout() 还会从可用高度里再扣掉「未解锁行的锁定迷你格预留条」
    //    （index.html:186-187）。本移植版不绘制锁定格（MergeGrid.build 里整行
    //    `cell.active = r < unlockedRows`），没有东西要画，故不预留这条空白带。
    //    若将来补上锁定迷你格，应改回 REGION_H - (lockZoneH + LOCK_ZONE_GAP)
    //    （lockZoneH = min(108, 22 + 未解锁行数 * 20)，LOCK_ZONE_GAP = 8）。
    const regionAvailH = REGION_H;
    const cellH = Math.floor((regionAvailH - (rows - 1) * BOARD_GAP) / rows);
    const cellW = Math.floor((REGION_W - (cols - 1) * BOARD_GAP) / cols);
    let cell = Math.min(CELL_MAX, cellH, cellW);
    if (!isFinite(cell) || cell < 12) cell = 12;
    const cellPx = cell * k;

    // 2) 棋盘外框（gap 与 MergeGrid.build 内部一致，保证居中量算不偏）
    const totalW = cols * cellPx + (cols - 1) * BOARD_GAP;
    const totalH = rows * cellPx + (rows - 1) * BOARD_GAP;
    const regionW = REGION_W * k;
    const availH = regionAvailH * k;

    // 3) H5（左上原点）棋盘左上角 → 在自己的可用区域内居中 → Cocos（中心原点、y 向上）
    const gridLeft = BOARD_X0 * k + (regionW - totalW) / 2;
    const gridTop = REGION_TOP * k + (availH - totalH) / 2;
    const cx = gridLeft + totalW / 2 - (DESIGN_W * k) / 2;
    const cy = (DESIGN_H * k) / 2 - gridTop - totalH / 2;

    if (!this.gridRoot || !this.gridRoot.isValid) {
      this.gridRoot = new Node('gridRoot');
      this.gridRoot.parent = this.node;
    }
    this.gridRoot.setPosition(cx, cy, 0);
    this.grid.build(this.gridRoot, cellPx);
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

    // ⚠️ Graphics 与 Label 都派生自 UIRenderer，而一个节点只能注册一个可渲染组件：
    // 第二个会被引擎 warnID 12002 拒绝（"Can't add renderable component to this node
    // because it already have one."），结果气泡只剩黑底、文字完全不渲染。
    // 因此文字挂在子节点上 —— 与本项目其余面板（Hud / RecruitPanel / UnitView）一致。
    const lblNode = new Node('toastLabel');
    lblNode.parent = n;
    const lu = lblNode.addComponent(UITransform);
    lu.setContentSize(W - 40, 44);
    const l = lblNode.addComponent(Label);
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
