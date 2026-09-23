/**
 * 右侧控制面板（HUD）+「档位产出表」弹层 +「重置存档」确认弹窗。
 *
 * 几何 100% 对齐已上线 H5 v2.8.0（build/publish/index.html）的 812×375 逻辑舞台，
 * 坐标映射沿用 H5 自己的 letterbox 规则：k = min(宽/812, 高/375)、舞台居中
 * （index.html:1217-1229）。h5x/h5y 一律是「左上原点、y 向下」的 H5 舞台坐标。
 *
 * ── H5 右侧面板按钮完整枚举（定义行 index.html:213-238，几何单位 = 812×375 逻辑像素）──
 *  #  常量          文案（H5 绘制行）        几何 {x,y,w,h}              定义  点击处理
 *  1  COLL_BTN     '图鉴'            (1663)  {660,  14,  64,  44}       215   1369 → collectionOpen = true
 *  2  MUTE_BTN     '♪' / '✕'        (1664)  {736,  14,  56,  44}       216   1370 → muted = !muted
 *  3  SPAWN_BTN    '高级招募 ▸'      (1933)  {490,  96, 152,  44}       221   1367 → recruitOpen = true
 *  4  UNLOCK_BTN   '解锁第 N 行'     (1945-  {648,  96, 152,  44}       222   1368 → tryUnlockRow()
 *                  +价格副标题        1959)
 *  5  LEGEND_BTN   '档位产出表 ▸'    (2051)  {490, 152, 310,  38}       223   1371 → legendOpen = true
 *  6  FRIEND_BTN   '好友'            (2133)  {490, 224, 152,  44}       224   1372 → friendOpen / 无社交则 toast
 *  7  RESTORE_BTN  '恢复方块'        (2137)  {648, 224, 152,  44}       225   1379 → restoreBlocks()
 *  8  RESET_BTN    '重置存档'        (2115)  {490, 280, 152,  44}       226   1384 → window.confirm → resetAll()
 *  合计 **8 个**（不是 6 个）。
 *  另有 HOME_BTN {12,8,92,30}（index.html:214，'← 首页' 绘制于 index.html:1635）位于**棋盘区左上角**，
 *  不属于右侧面板；Cocos 侧没有 home.html 入口，因此未实现（见汇报）。
 *
 * 面板上的非按钮元素（也已对齐）：
 *   金币图标/金额 + 每秒产出   index.html:1638-1660
 *   免费放置提示行 TIP_Y=84    index.html:227 / 1936-1942
 *   统计行 STATS_BOX{490,190,310,26} + STATS_Y=202   index.html:229 / 2094-2102
 *   右下「自动刷怪」信息框 {648,280,152,50}          index.html:2122-2130
 *   自动存档提示 SAVE_NOTE_Y=336                      index.html:230 / 2118
 */
import {
  Node, UITransform, Label, Graphics, Color, NodeEventType, sys,
  HorizontalTextAlignment, VerticalTextAlignment,
} from 'cc';
import { GameConfig, hexToColor, fmt } from '../data/GameConfig';
import { codexCardUnlocked, isGateTier, gateShort } from '../data/GateConfig';
import { MergeGrid } from './MergeGrid';
import { GameAudio } from './Audio';
import { AdManager } from './AdManager';

/** H5 逻辑舞台（index.html:142-143） */
const DESIGN_W = 812;
const DESIGN_H = 375;

/** 面板底板（index.html:158-159） */
const PANEL_RECT = { x: 478, y: 0, w: 334, h: 375 };
/** 面板顶栏高度（index.html:145） */
const HUD_H = 64;
/** 面板内容左右边界（index.html:160-162：PX0=490、PX1=800、PW=310） */
const PX0 = 490;
const PX1 = 800;

/** 右侧面板按钮几何（index.html:215-226） */
const BUTTONS = {
  coll: { x: 660, y: 14, w: 64, h: 44 },      // index.html:215
  mute: { x: 736, y: 14, w: 56, h: 44 },      // index.html:216
  spawn: { x: 490, y: 96, w: 152, h: 44 },    // index.html:221
  unlock: { x: 648, y: 96, w: 152, h: 44 },   // index.html:222
  legend: { x: 490, y: 152, w: 310, h: 38 },  // index.html:223
  friend: { x: 490, y: 224, w: 152, h: 44 },  // index.html:224
  restore: { x: 648, y: 224, w: 152, h: 44 }, // index.html:225
  reset: { x: 490, y: 280, w: 152, h: 44 },   // index.html:226
};

/** 提示行 / 统计框 / 存档提示（index.html:227-230） */
const TIP_Y = 84;
const STATS_Y = 202;
const STATS_BOX = { x: 490, y: 190, w: 310, h: 26 };
const SAVE_NOTE_Y = 336;
/** 右下「自动刷怪」信息框（index.html:2123） */
const AUTO_BOX = { x: 648, y: 280, w: 152, h: 50 };

/** 档位产出表弹层（index.html:2070-2078） */
const LEGEND_PANEL = { x: 14, y: 64, w: DESIGN_W - 28, h: 288 };
const LEGEND_LIST = { x: 32, y: 148 };                       // drawLegendPanel(px+18, py+84)（index.html:2076）
const LEGEND_ROW_H = 19;                                     // index.html:2026
const LEGEND_COLS = 3;                                       // index.html:2027
const LEGEND_COL_GAP = Math.floor((DESIGN_W - 48) / LEGEND_COLS);  // 254（index.html:2028）
const LEGEND_CLOSE_BTN = { x: DESIGN_W / 2 - 80, y: 300, w: 160, h: 44 };  // index.html:235

/** 弹窗边框几何（H5 popupFrame 的调用方取值，index.html:2073 / 2358） */
const MODAL_RECT = { x: 36, y: (DESIGN_H - 232) / 2, w: DESIGN_W - 72, h: 232 };  // index.html:2358
const MODAL_BTN_Y_OFFSET = 56;   // index.html:2365：y = by + bh - 56

/** 按钮默认圆角（index.html:1671 r=12） */
const BTN_RADIUS = 12;

/** 单个可重绘按钮的引用 */
interface BtnRef {
  node: Node;
  gfx: Graphics;
  label: Label;
  rect: { x: number; y: number; w: number; h: number };
  primary: boolean;
}

function col(hex: string, alpha: number): Color {
  const c = hexToColor(hex);
  return new Color(c.r, c.g, c.b, alpha);
}

export class Hud {
  /** 打开图鉴（index.html:1369） */
  onOpenCollection: (() => void) | null = null;
  /** 打开高级招募弹层（index.html:1367） */
  onRecruit: (() => void) | null = null;
  /** 解锁下一行（index.html:1368） */
  onUnlockRow: (() => void) | null = null;
  /** 恢复方块（index.html:1379-1383） */
  onRestore: (() => void) | null = null;
  /** 重置存档：**仅在确认弹窗点「确定」后**触发（index.html:1386-1387 → resetAll index.html:619-623） */
  onReset: (() => void) | null = null;
  /** 好友入口（Cocos 无 GinSocial，走 H5 的 else 分支 toast，index.html:1376） */
  onFriends: (() => void) | null = null;
  /**
   * 「看视频解锁」确认框点「看视频解锁」后触发（参数：kind = 'tier' | 'row'）。
   * 由 GameManager 接到 AdManager 上（H5 adConfirmYes，index.html:2284-2292）。
   */
  onAdConfirm: ((kind: 'tier' | 'row', tier: number, row: number) => void) | null = null;

  /** 音频组件（由 GameManager 注入）；未注入时静音按钮退化为只切图标 */
  audio: GameAudio | null = null;

  private root!: Node;
  private grid: MergeGrid | null = null;

  /** H5 → Cocos 换算 */
  private k = 1;
  private originX = 0;
  private originY = 0;

  private coinsLabel: Label | null = null;
  private cpsLabel: Label | null = null;
  private tipLabel: Label | null = null;
  private statsLabel: Label | null = null;
  private saveNoteLabel: Label | null = null;
  private autoCpsLabel: Label | null = null;
  private coinIconGfx: Graphics | null = null;
  private panelGfx: Graphics | null = null;

  private collBtn: BtnRef | null = null;
  private muteBtn: BtnRef | null = null;
  private unlockBtn: BtnRef | null = null;
  private unlockSub: Label | null = null;

  /** 档位产出表弹层 */
  private legendRoot: Node | null = null;
  private legendSwatch: Graphics | null = null;
  private legendNames: Label[] = [];
  private legendRates: Label[] = [];
  private legendVisible = false;

  /** 重置确认弹窗 */
  private confirmRoot: Node | null = null;

  /** 「看视频解锁」确认弹窗（H5 openAdModal / drawAdModal，index.html:2257-2282） */
  private adConfirmRoot: Node | null = null;
  private adTitle: Label | null = null;
  private adDesc: Label | null = null;
  private adRemain: Label | null = null;
  /** 当前确认框的请求参数（点「看视频解锁」时回传给 GameManager） */
  private adKind: 'tier' | 'row' = 'tier';
  private adTier = 0;
  private adRow = 0;

  // ---------- 构建 ----------

  /**
   * 构建面板。
   * @param parent 挂载节点（GameManager 的 GameRoot）
   * @param width  可见区宽
   * @param height 可见区高
   */
  build(parent: Node, width: number, height: number) {
    const k = Math.min(width / DESIGN_W, height / DESIGN_H);
    this.k = isFinite(k) && k > 0 ? k : 1;
    this.originX = -(DESIGN_W * this.k) / 2;
    this.originY = (DESIGN_H * this.k) / 2;

    const root = new Node('hudPanel');
    root.parent = parent;
    this.root = root;
    const u = root.addComponent(UITransform);
    u.setContentSize(width, height);

    // 面板底板 + 顶栏 + HUD（金币图标/金额/每秒产出）
    this.drawPanelBg(root);
    this.buildButtons(root);
    this.buildInfoBlocks(root);
    this.buildLegend(root);
    this.buildResetConfirm(root);
    this.buildAdConfirm(root);
  }

  /** 绑定状态源（build 之后调用） */
  bind(grid: MergeGrid) {
    this.grid = grid;
    this.refresh();
  }

  // ---------- 面板底板 / HUD ----------

  /** index.html:1621-1632 drawPanelBg */
  private drawPanelBg(root: Node) {
    const n = new Node('panelBg');
    n.parent = root;
    const u = n.addComponent(UITransform);
    u.setContentSize(PANEL_RECT.w * this.k, PANEL_RECT.h * this.k);
    n.setPosition(this.sx(PANEL_RECT.x + PANEL_RECT.w / 2), this.sy(PANEL_RECT.h / 2), 0);
    const g = n.addComponent(Graphics);
    this.panelGfx = g;
    this.paintPanelBg();

    const bar = new Node('hudBar');
    bar.parent = root;
    const bu = bar.addComponent(UITransform);
    bu.setContentSize(PANEL_RECT.w * this.k, HUD_H * this.k);
    bar.setPosition(this.sx(PANEL_RECT.x + PANEL_RECT.w / 2), this.sy(HUD_H / 2), 0);
    const bg = bar.addComponent(Graphics);
    // 顶栏底色 rgba(20,27,40,0.96)（index.html:1629）
    bg.fillColor = new Color(20, 27, 40, 245);
    bg.roundRect(-PANEL_RECT.w * this.k / 2, -HUD_H * this.k / 2, PANEL_RECT.w * this.k, HUD_H * this.k, 0);
    bg.fill();
    // 金色分隔线 rgba(232,193,90,0.18)（index.html:1630-1631）
    bg.fillColor = col('#e8c15a', 46);
    bg.rect(-PANEL_RECT.w * this.k / 2, -HUD_H * this.k / 2, PANEL_RECT.w * this.k, 1 * this.k);
    bg.fill();

    // 金币图标：金色圆 + 深色内圆 + 「銀」字（index.html:1639-1652）
    const icon = new Node('coinIcon');
    icon.parent = root;
    const iu = icon.addComponent(UITransform);
    iu.setContentSize(30 * this.k, 30 * this.k);
    icon.setPosition(this.sx(PX0 + 14), this.sy(32), 0);
    const ig = icon.addComponent(Graphics);
    this.coinIconGfx = ig;
    this.paintCoinIcon();
    this.makeText(root, PX0 + 14, 32, 13, '#3a2e10', 'center', true).string = '銀';

    // 「金币」小标 + 金额（index.html:1654-1655）
    this.makeText(root, PX0 + 36, 18, 12, '#8a93ad', 'left', false).string = '金币';
    this.coinsLabel = this.makeText(root, PX0 + 36, 40, 24, '#ffd23a', 'left', true);

    // 每秒产出胶囊（index.html:1659-1660）
    const pill = new Node('cpsPill');
    pill.parent = root;
    const pu = pill.addComponent(UITransform);
    pu.setContentSize(150 * this.k, 18 * this.k);
    pill.setPosition(this.sx(PX0 + 36 + 75), this.sy(63), 0);
    const pg = pill.addComponent(Graphics);
    pg.fillColor = new Color(46, 204, 113, 41);   // rgba(46,204,113,0.16)
    pg.roundRect(-75 * this.k, -9 * this.k, 150 * this.k, 18 * this.k, 9 * this.k);
    pg.fill();
    this.cpsLabel = this.makeText(root, PX0 + 111, 63, 12, '#5fe08f', 'center', true);
  }

  private paintPanelBg() {
    const g = this.panelGfx;
    if (!g) return;
    g.clear();
    const w = PANEL_RECT.w * this.k;
    const h = PANEL_RECT.h * this.k;
    // 面板底色 #141b28（index.html:1623）
    g.fillColor = col('#141b28', 255);
    g.roundRect(-w / 2, -h / 2, w, h, 0);
    g.fill();
    // 中线高光 / 阴影各 1px（index.html:1624-1627）
    g.fillColor = new Color(255, 255, 255, 10);
    g.rect(-w / 2, -h / 2, 1 * this.k, h);
    g.fill();
    g.fillColor = new Color(0, 0, 0, 64);
    g.rect(-w / 2 + 1 * this.k, -h / 2, 1 * this.k, h);
    g.fill();
  }

  private paintCoinIcon() {
    const g = this.coinIconGfx;
    if (!g) return;
    g.clear();
    // 外圈 #e8c15a（index.html:1643-1646）
    g.fillColor = col('#e8c15a', 255);
    g.circle(0, 0, 13 * this.k);
    g.fill();
    // 内圈 shade('#e8c15a', -0.18) = rgb(190,158,74) = #be9e4a（index.html:1648-1651）
    g.fillColor = col('#be9e4a', 255);
    g.circle(0, 0, 9 * this.k);
    g.fill();
  }

  // ---------- 按钮 ----------

  /** index.html:1366-1388 的点击语义 */
  private buildButtons(root: Node) {
    // 图鉴（index.html:1369）
    this.collBtn = this.makeButton(root, BUTTONS.coll, '图鉴', '#3aa7d8', false);
    this.collBtn.node.on(NodeEventType.TOUCH_END, () => {
      if (this.onOpenCollection) this.onOpenCollection();
    });

    // 音乐开关：'♪' / '✕'（index.html:1664 / 1370）
    this.muteBtn = this.makeButton(root, BUTTONS.mute, '♪', '#2ecc71', false);
    this.muteBtn.node.on(NodeEventType.TOUCH_END, () => {
      if (this.audio) this.audio.toggleEnabled();
      this.refresh();
    });

    // 高级招募（index.html:1367）
    const spawn = this.makeButton(root, BUTTONS.spawn, '高级招募 ▸', '#e8c15a', true);
    spawn.node.on(NodeEventType.TOUCH_END, () => {
      if (this.onRecruit) this.onRecruit();
    });

    // 解锁第 N 行（文案与副标题动态，index.html:1945-1967 / 1368）
    this.unlockBtn = this.makeButton(root, BUTTONS.unlock, '解锁第 6 行', '#9b7bff', true);
    this.unlockBtn.node.on(NodeEventType.TOUCH_END, () => {
      if (this.onUnlockRow) this.onUnlockRow();
    });
    // 价格副标题：H5 在按钮内底部居中绘制，y = btn.y + h - 11（index.html:1965）
    this.unlockSub = this.makeTextIn(
      this.unlockBtn.node, 0, BUTTONS.unlock.h / 2 - 11, 12, '#e8d6ff', 'center', false,
    );

    // 档位产出表（index.html:1371）
    const legend = this.makeButton(root, BUTTONS.legend, '档位产出表 ▸', '#3aa7d8', false);
    legend.node.on(NodeEventType.TOUCH_END, () => this.showLegend());

    // 好友：H5 有 GinSocial 就开面板，否则 toast（index.html:1372-1378）
    const friend = this.makeButton(root, BUTTONS.friend, '好友', '#3aa7d8', false);
    friend.node.on(NodeEventType.TOUCH_END, () => {
      if (this.onFriends) this.onFriends();
    });

    // 恢复方块（index.html:1379-1383）
    const restore = this.makeButton(root, BUTTONS.restore, '恢复方块', '#2e9e57', false);
    restore.node.on(NodeEventType.TOUCH_END, () => {
      if (this.onRestore) this.onRestore();
    });

    // 重置存档（index.html:1384-1388）
    const reset = this.makeButton(root, BUTTONS.reset, '重置存档', '#7a3b34', false);
    reset.node.on(NodeEventType.TOUCH_END, () => this.showResetConfirm());
  }

  /** H5 drawButton（index.html:1667-1687）的简化版：cc.Graphics 无线性渐变，用纯色代替 */
  private makeButton(
    parent: Node, rect: { x: number; y: number; w: number; h: number },
    label: string, hex: string, primary: boolean,
  ): BtnRef {
    const n = new Node('btn_' + label);
    n.parent = parent;
    n.setPosition(this.sx(rect.x + rect.w / 2), this.sy(rect.y + rect.h / 2), 0);
    const u = n.addComponent(UITransform);
    u.setContentSize(rect.w * this.k, rect.h * this.k);
    const g = n.addComponent(Graphics);
    const ref: BtnRef = { node: n, gfx: g, label: null as any, rect, primary };
    this.paintButton(ref, hex);

    const lbl = new Node('lbl');
    lbl.parent = n;
    const lu = lbl.addComponent(UITransform);
    lu.setContentSize(rect.w * this.k, rect.h * this.k);
    const l = lbl.addComponent(Label);
    l.string = label;
    l.fontSize = Math.max(9, Math.round(16 * this.k));   // index.html:1684 起始字号 16
    l.isBold = true;
    l.color = new Color(255, 255, 255, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    ref.label = l;
    // 吞掉 touch-start，避免点击穿透到棋盘
    n.on(NodeEventType.TOUCH_START, () => { /* 无需处理 */ });
    return ref;
  }

  /** index.html:1673-1681 */
  private paintButton(ref: BtnRef, hex: string) {
    const g = ref.gfx;
    const w = ref.rect.w * this.k;
    const h = ref.rect.h * this.k;
    g.clear();
    g.fillColor = col(hex, 255);
    g.roundRect(-w / 2, -h / 2, w, h, BTN_RADIUS * this.k);
    g.fill();
    // 2px 深色 cel 描边 rgba(11,14,20,0.85)
    g.lineWidth = 2 * this.k;
    g.strokeColor = new Color(11, 14, 20, 217);
    g.roundRect(-w / 2, -h / 2, w, h, BTN_RADIUS * this.k);
    g.stroke();
    // 主按钮金色强调边框 rgba(232,193,90,0.9)
    if (ref.primary) {
      g.lineWidth = 2 * this.k;
      g.strokeColor = col('#e8c15a', 230);
      g.roundRect(-w / 2 + 1.5 * this.k, -h / 2 + 1.5 * this.k, w - 3 * this.k, h - 3 * this.k, (BTN_RADIUS - 1) * this.k);
      g.stroke();
    }
  }

  // ---------- 提示行 / 统计行 / 存档提示 / 自动刷怪 ----------

  private buildInfoBlocks(root: Node) {
    // 提示行 TIP_Y=84（index.html:1936-1942）
    this.tipLabel = this.makeText(root, (PX0 + PX1) / 2, TIP_Y, 12, '#f0e2a8', 'center', true);

    // 统计框（index.html:2094-2102）
    const sb = new Node('statsBox');
    sb.parent = root;
    const su = sb.addComponent(UITransform);
    su.setContentSize(STATS_BOX.w * this.k, STATS_BOX.h * this.k);
    sb.setPosition(this.sx(STATS_BOX.x + STATS_BOX.w / 2), this.sy(STATS_BOX.y + STATS_BOX.h / 2), 0);
    const sg = sb.addComponent(Graphics);
    sg.fillColor = new Color(255, 255, 255, 15);   // rgba(255,255,255,0.06)
    sg.roundRect(-STATS_BOX.w * this.k / 2, -STATS_BOX.h * this.k / 2, STATS_BOX.w * this.k, STATS_BOX.h * this.k, 12 * this.k);
    sg.fill();
    sg.lineWidth = 1;
    sg.strokeColor = col('#e8c15a', 46);           // rgba(232,193,90,0.18)
    sg.roundRect(-STATS_BOX.w * this.k / 2, -STATS_BOX.h * this.k / 2, STATS_BOX.w * this.k, STATS_BOX.h * this.k, 12 * this.k);
    sg.stroke();
    this.statsLabel = this.makeText(root, PX0 + STATS_BOX.w / 2, STATS_Y, 11, '#9a9ab0', 'center', false);

    // 右下「自动刷怪」信息框（index.html:2122-2130）
    const ab = new Node('autoBox');
    ab.parent = root;
    const au = ab.addComponent(UITransform);
    au.setContentSize(AUTO_BOX.w * this.k, AUTO_BOX.h * this.k);
    ab.setPosition(this.sx(AUTO_BOX.x + AUTO_BOX.w / 2), this.sy(AUTO_BOX.y + AUTO_BOX.h / 2), 0);
    const ag = ab.addComponent(Graphics);
    ag.fillColor = new Color(255, 255, 255, 15);
    ag.roundRect(-AUTO_BOX.w * this.k / 2, -AUTO_BOX.h * this.k / 2, AUTO_BOX.w * this.k, AUTO_BOX.h * this.k, 12 * this.k);
    ag.fill();
    ag.lineWidth = 1;
    ag.strokeColor = col('#e8c15a', 64);           // rgba(232,193,90,0.25)
    ag.roundRect(-AUTO_BOX.w * this.k / 2, -AUTO_BOX.h * this.k / 2, AUTO_BOX.w * this.k, AUTO_BOX.h * this.k, 12 * this.k);
    ag.stroke();
    this.makeText(root, AUTO_BOX.x + 12, AUTO_BOX.y + 16, 12, '#e8c15a', 'left', true).string = '自动刷怪';
    this.makeText(root, AUTO_BOX.x + 12, AUTO_BOX.y + 34, 11, '#9a9ab0', 'left', false).string =
      '每 ' + GameConfig.autoSpawnInterval + ' 秒';
    this.autoCpsLabel = this.makeText(root, AUTO_BOX.x + AUTO_BOX.w - 12, AUTO_BOX.y + 26, 13, '#5fe08f', 'right', true);

    // 自动存档提示（index.html:2118）
    this.saveNoteLabel = this.makeText(root, PX0 + STATS_BOX.w / 2, SAVE_NOTE_Y, 10, '#5c5c72', 'center', false);
  }

  // ---------- 档位产出表弹层（index.html:2070-2078 + 2025-2048） ----------

  private buildLegend(root: Node) {
    const lr = new Node('legendOverlay');
    lr.parent = root;
    this.legendRoot = lr;
    const u = lr.addComponent(UITransform);
    u.setContentSize(DESIGN_W * this.k, DESIGN_H * this.k);

    // 全屏黑底 rgba(6,6,12,1)（index.html:2071-2072）
    const g = lr.addComponent(Graphics);
    g.fillColor = new Color(6, 6, 12, 255);
    g.roundRect(-DESIGN_W * this.k / 2, -DESIGN_H * this.k / 2, DESIGN_W * this.k, DESIGN_H * this.k, 0);
    g.fill();

    // 弹窗框 popupFrame（index.html:2054-2068）：#1c1c2a 底 + 44px 深色标题带 + 金色分隔 + 金边
    const frame = new Node('legendFrame');
    frame.parent = lr;
    frame.setPosition(this.sx(LEGEND_PANEL.x + LEGEND_PANEL.w / 2), this.sy(LEGEND_PANEL.y + LEGEND_PANEL.h / 2), 0);
    const fu = frame.addComponent(UITransform);
    fu.setContentSize(LEGEND_PANEL.w * this.k, LEGEND_PANEL.h * this.k);
    const fg = frame.addComponent(Graphics);
    const fw = LEGEND_PANEL.w * this.k;
    const fh = LEGEND_PANEL.h * this.k;
    fg.fillColor = col('#1c1c2a', 255);
    fg.roundRect(-fw / 2, -fh / 2, fw, fh, 14 * this.k);
    fg.fill();
    // 标题带（H5 是 #241d10 → #191509 线性渐变，这里用中间色近似）
    fg.fillColor = col('#1e180c', 255);
    fg.rect(-fw / 2 + 2 * this.k, fh / 2 - 44 * this.k, fw - 4 * this.k, 44 * this.k);
    fg.fill();
    fg.fillColor = col('#e8c15a', 255);
    fg.rect(-fw / 2 + 2 * this.k, fh / 2 - 46 * this.k, fw - 4 * this.k, 2 * this.k);
    fg.fill();
    fg.lineWidth = 2 * this.k;
    fg.strokeColor = col('#e8c15a', 255);
    fg.roundRect(-fw / 2, -fh / 2, fw, fh, 14 * this.k);
    fg.stroke();

    this.makeText(lr, DESIGN_W / 2, LEGEND_PANEL.y + 29, 19, '#e8c15a', 'center', true).string = '档位产出表';
    this.makeText(lr, DESIGN_W / 2, LEGEND_PANEL.y + 64, 12, '#9a9ab0', 'center', false).string =
      '变现 = 长按满级单位换金币';

    // 色块圆点（index.html:2037-2038），与 24 档名字/产出一同刷新
    const sw = new Node('legendSwatch');
    sw.parent = lr;
    sw.setPosition(0, 0, 0);
    const swu = sw.addComponent(UITransform);
    swu.setContentSize(DESIGN_W * this.k, DESIGN_H * this.k);
    this.legendSwatch = sw.addComponent(Graphics);

    for (let i = 0; i < GameConfig.maxTier; i++) {
      const lx = LEGEND_LIST.x + (i % LEGEND_COLS) * LEGEND_COL_GAP;
      const ry = LEGEND_LIST.y + Math.floor(i / LEGEND_COLS) * LEGEND_ROW_H;
      const name = this.makeText(lr, lx + 19, ry, 11, '#8a93ad', 'left', false);
      const rate = this.makeText(lr, lx + LEGEND_COL_GAP - 10, ry, 10, '#8fd8a8', 'right', false);
      this.legendNames.push(name);
      this.legendRates.push(rate);
    }

    // 关闭按钮（index.html:2077）
    const close = this.makeButton(lr, LEGEND_CLOSE_BTN, '关闭', '#e8c15a', false);
    close.node.on(NodeEventType.TOUCH_END, () => this.hideLegend());

    // 点空白关闭（index.html:1356-1359）
    lr.on(NodeEventType.TOUCH_START, () => { /* 吞掉触摸 */ });
    lr.on(NodeEventType.TOUCH_END, () => this.hideLegend());

    lr.active = false;
    this.refreshLegend();
  }

  /** index.html:2029-2047 */
  private refreshLegend() {
    const grid = this.grid;
    const g = this.legendSwatch;
    if (!g || !grid) return;
    g.clear();
    for (let i = 0; i < GameConfig.maxTier; i++) {
      const tierN = i + 1;
      const lx = LEGEND_LIST.x + (i % LEGEND_COLS) * LEGEND_COL_GAP;
      const ry = LEGEND_LIST.y + Math.floor(i / LEGEND_COLS) * LEGEND_ROW_H;
      const colorHex = GameConfig.tierColors[i];
      const c = hexToColor(colorHex);

      // 色块圆点 14×14 r5 + 白色 18% 描边（index.html:2356-2357）
      g.fillColor = new Color(c.r, c.g, c.b, 255);
      g.roundRect(this.sx(lx), this.sy(ry + 7), 14 * this.k, 14 * this.k, 5 * this.k);
      g.fill();
      g.lineWidth = 1;
      g.strokeColor = new Color(255, 255, 255, 46);
      g.roundRect(this.sx(lx), this.sy(ry + 7), 14 * this.k, 14 * this.k, 5 * this.k);
      g.stroke();

      // 解锁态用图鉴口径（index.html:2354 codexCardUnlocked；定义见 1185-1188）
      const unlocked = codexCardUnlocked(tierN, grid);
      const gated = isGateTier(tierN);
      const name = this.legendNames[i];
      const rate = this.legendRates[i];
      if (name) {
        // index.html:2359-2363：门槛档位显示「锁 xxx」，其余显示「合出 N 档解锁」
        const lockLabel = gated ? ('锁 ' + gateShort(tierN)) : ('合出 ' + tierN + ' 档解锁');
        name.string = tierN + '·' + (unlocked ? GameConfig.characterNames[i] : lockLabel);
        name.fontSize = Math.max(8, Math.round((gated ? 10 : 11) * this.k));
        name.color = unlocked ? col('#f0e2a8', 255) : col('#8a93ad', 255);
        name.isBold = unlocked;
      }
      if (rate) rate.string = '+' + GameConfig.coinRate[i] + '/秒';   // index.html:2365
    }
  }

  private showLegend() {
    this.refreshLegend();
    if (this.legendRoot) this.legendRoot.active = true;
    this.legendVisible = true;
  }

  private hideLegend() {
    if (this.legendRoot) this.legendRoot.active = false;
    this.legendVisible = false;
  }

  // ---------- 重置存档确认弹窗 ----------
  //
  // H5 用的是浏览器原生 window.confirm('确定要清空存档、重新开始吗？')（index.html:1386），
  // 确认后才执行 resetAll()（index.html:619-623：抑制存档 + 删除存档 + 重载页面）。
  // Cocos 侧没有原生 confirm / reload，因此这里用「一次确认」的弹窗等价替代，
  // 文案逐字照抄 index.html:1386。弹窗外观沿用 H5 的 popupFrame 与离线弹窗几何
  // （index.html:2054-2068 / 2356-2358），按钮配色取 H5 调色板里的 #2ecc71 / #5c5c72。

  private buildResetConfirm(root: Node) {
    const cr = new Node('resetConfirm');
    cr.parent = root;
    this.confirmRoot = cr;
    const u = cr.addComponent(UITransform);
    u.setContentSize(DESIGN_W * this.k, DESIGN_H * this.k);

    // 遮罩 rgba(0,0,0,0.78)（index.html:2356-2357）
    const g = cr.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 199);
    g.roundRect(-DESIGN_W * this.k / 2, -DESIGN_H * this.k / 2, DESIGN_W * this.k, DESIGN_H * this.k, 0);
    g.fill();

    const frame = new Node('confirmFrame');
    frame.parent = cr;
    frame.setPosition(this.sx(MODAL_RECT.x + MODAL_RECT.w / 2), this.sy(MODAL_RECT.y + MODAL_RECT.h / 2), 0);
    const fu = frame.addComponent(UITransform);
    fu.setContentSize(MODAL_RECT.w * this.k, MODAL_RECT.h * this.k);
    const fg = frame.addComponent(Graphics);
    const fw = MODAL_RECT.w * this.k;
    const fh = MODAL_RECT.h * this.k;
    fg.fillColor = col('#1c1c2a', 255);
    fg.roundRect(-fw / 2, -fh / 2, fw, fh, 14 * this.k);
    fg.fill();
    fg.fillColor = col('#1e180c', 255);
    fg.rect(-fw / 2 + 2 * this.k, fh / 2 - 44 * this.k, fw - 4 * this.k, 44 * this.k);
    fg.fill();
    fg.fillColor = col('#e8c15a', 255);
    fg.rect(-fw / 2 + 2 * this.k, fh / 2 - 46 * this.k, fw - 4 * this.k, 2 * this.k);
    fg.fill();
    fg.lineWidth = 2 * this.k;
    fg.strokeColor = col('#e8c15a', 255);
    fg.roundRect(-fw / 2, -fh / 2, fw, fh, 14 * this.k);
    fg.stroke();

    this.makeText(cr, DESIGN_W / 2, MODAL_RECT.y + 29, 19, '#e8c15a', 'center', true).string = '重置存档';
    // 文案逐字照抄 index.html:1386 的 confirm 文案
    this.makeText(cr, DESIGN_W / 2, MODAL_RECT.y + 96, 16, '#e7ecf5', 'center', true).string =
      '确定要清空存档、重新开始吗？';

    // 两个按钮平分 H5 离线弹窗按钮条（index.html:2365 的 x/y/h）
    const bandY = MODAL_RECT.y + MODAL_RECT.h - MODAL_BTN_Y_OFFSET;
    const btnW = (MODAL_RECT.w - 48 - 12) / 2;
    const okRect = { x: MODAL_RECT.x + 24, y: bandY, w: btnW, h: 44 };
    const cancelRect = { x: okRect.x + btnW + 12, y: bandY, w: btnW, h: 44 };

    const ok = this.makeButton(cr, okRect, '确定', '#2ecc71', false);
    ok.node.on(NodeEventType.TOUCH_END, () => {
      this.hideResetConfirm();
      if (this.onReset) this.onReset();
    });
    const cancel = this.makeButton(cr, cancelRect, '取消', '#5c5c72', false);
    cancel.node.on(NodeEventType.TOUCH_END, () => this.hideResetConfirm());

    // 点空白 = 取消
    cr.on(NodeEventType.TOUCH_START, () => { /* 吞掉触摸 */ });
    cr.on(NodeEventType.TOUCH_END, () => this.hideResetConfirm());

    cr.active = false;
  }

  private showResetConfirm() {
    if (this.confirmRoot) this.confirmRoot.active = true;
  }

  private hideResetConfirm() {
    if (this.confirmRoot) this.confirmRoot.active = false;
  }

  // ---------- 「看视频解锁」确认弹窗 ----------
  //
  // 逐项对齐 H5 的广告确认框（index.html:2246-2293）：
  //   几何 = adModalRects()（bw = W-72、bh = 232、按钮条 y = by+bh-56，与离线/重置弹窗同框）
  //   标题 = '看视频立即解锁 N 档？' / '看视频免费解锁第 N 行？'
  //   正文 = openAdModal 里的 desc（门槛目标文案 / 金币价格与当前金币）
  //   副文案 = '（今日剩余 X 次 / 每日 3 次）'
  //   按钮 = ['看视频解锁' #2ecc71] ['放弃' #5c5c72]

  private buildAdConfirm(root: Node) {
    const cr = new Node('adConfirm');
    cr.parent = root;
    this.adConfirmRoot = cr;
    const u = cr.addComponent(UITransform);
    u.setContentSize(DESIGN_W * this.k, DESIGN_H * this.k);

    // 遮罩 rgba(0,0,0,0.78)（index.html:2271-2272）
    const g = cr.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 199);
    g.roundRect(-DESIGN_W * this.k / 2, -DESIGN_H * this.k / 2, DESIGN_W * this.k, DESIGN_H * this.k, 0);
    g.fill();

    const frame = new Node('adConfirmFrame');
    frame.parent = cr;
    frame.setPosition(this.sx(MODAL_RECT.x + MODAL_RECT.w / 2), this.sy(MODAL_RECT.y + MODAL_RECT.h / 2), 0);
    const fu = frame.addComponent(UITransform);
    fu.setContentSize(MODAL_RECT.w * this.k, MODAL_RECT.h * this.k);
    const fg = frame.addComponent(Graphics);
    const fw = MODAL_RECT.w * this.k;
    const fh = MODAL_RECT.h * this.k;
    fg.fillColor = col('#1c1c2a', 255);
    fg.roundRect(-fw / 2, -fh / 2, fw, fh, 14 * this.k);
    fg.fill();
    fg.fillColor = col('#1e180c', 255);
    fg.rect(-fw / 2 + 2 * this.k, fh / 2 - 44 * this.k, fw - 4 * this.k, 44 * this.k);
    fg.fill();
    fg.fillColor = col('#e8c15a', 255);
    fg.rect(-fw / 2 + 2 * this.k, fh / 2 - 46 * this.k, fw - 4 * this.k, 2 * this.k);
    fg.fill();
    fg.lineWidth = 2 * this.k;
    fg.strokeColor = col('#e8c15a', 255);
    fg.roundRect(-fw / 2, -fh / 2, fw, fh, 14 * this.k);
    fg.stroke();

    // 标题（文案由 showAdConfirm 按 kind 动态设置，index.html:2273-2276）
    this.adTitle = this.makeText(cr, DESIGN_W / 2, MODAL_RECT.y + 29, 19, '#e8c15a', 'center', true);
    // 正文 desc（index.html:2277 的 box.y + 78）
    this.adDesc = this.makeText(cr, DESIGN_W / 2, MODAL_RECT.y + 78, 13, '#e7ecf5', 'center', true);
    // 今日剩余次数（index.html:2278-2279 的 box.y + 108）
    this.adRemain = this.makeText(cr, DESIGN_W / 2, MODAL_RECT.y + 108, 12, '#9a9ab0', 'center', false);

    // 两个按钮平分按钮条（index.html:2248-2253 的 yes / no）
    const bandY = MODAL_RECT.y + MODAL_RECT.h - MODAL_BTN_Y_OFFSET;
    const btnW = (MODAL_RECT.w - 48 - 12) / 2;
    const yes = this.makeButton(cr, { x: MODAL_RECT.x + 24, y: bandY, w: btnW, h: 44 }, '看视频解锁', '#2ecc71', false);
    yes.node.on(NodeEventType.TOUCH_END, () => {
      const k = this.adKind;
      const t = this.adTier;
      const r = this.adRow;
      this.hideAdConfirm();
      if (this.onAdConfirm) this.onAdConfirm(k, t, r);
    });
    const no = this.makeButton(cr, { x: MODAL_RECT.x + 24 + btnW + 12, y: bandY, w: btnW, h: 44 }, '放弃', '#5c5c72', false);
    no.node.on(NodeEventType.TOUCH_END, () => this.hideAdConfirm());

    // 点空白 = 放弃
    cr.on(NodeEventType.TOUCH_START, () => { /* 吞掉触摸 */ });
    cr.on(NodeEventType.TOUCH_END, () => this.hideAdConfirm());

    cr.active = false;
  }

  /**
   * 弹出「看视频解锁」确认框。
   * @param kind 'tier' = 档位门槛被拦；'row' = 解锁行金币不足
   * @param desc 正文（H5 openAdModal 里算好的 desc，index.html:2257-2267）
   */
  showAdConfirm(kind: 'tier' | 'row', tier: number, row: number, desc: string) {
    this.adKind = kind;
    this.adTier = tier;
    this.adRow = row;
    if (this.adTitle) {
      this.adTitle.string = kind === 'tier'
        ? ('看视频立即解锁 ' + tier + ' 档？')
        : ('看视频免费解锁第 ' + row + ' 行？');
    }
    if (this.adDesc) this.adDesc.string = desc || '';
    if (this.adRemain) {
      this.adRemain.string = '（今日剩余 ' + AdManager.get().remainingToday()
        + ' 次 / 每日 ' + AdManager.get().dailyLimit() + ' 次）';
    }
    if (this.adConfirmRoot) this.adConfirmRoot.active = true;
  }

  private hideAdConfirm() {
    if (this.adConfirmRoot) this.adConfirmRoot.active = false;
  }

  // ---------- 刷新 ----------

  /** 每秒由 GameManager 调用，刷新全部动态文案（对应 H5 每帧重绘 render()） */
  refresh() {
    const grid = this.grid;
    if (!grid) return;

    // 金币金额用 fmt 缩写（H5 index.html:1655）
    if (this.coinsLabel) this.coinsLabel.string = fmt(grid.coins);

    const cps = grid.coinsPerSecond();
    // 每秒产出（index.html:1660 / 2129）
    if (this.cpsLabel) this.cpsLabel.string = '+' + fmt(cps) + '/秒';
    if (this.autoCpsLabel) this.autoCpsLabel.string = '+' + fmt(cps) + '/秒';

    // 解锁按钮：文案 / 副标题 / 配色（index.html:1945-1967）
    this.refreshUnlockButton();

    // 音乐图标（index.html:1664）
    if (this.muteBtn && this.muteBtn.label) {
      const on = this.audio ? this.audio.isEnabled() : true;
      this.muteBtn.label.string = on ? '♪' : '✕';
      this.paintButton(this.muteBtn, on ? '#2ecc71' : '#c0392b');
    }

    // 招募提示行（index.html:1940：'点此选择档位招募（一级 N 金币起）'）
    if (this.tipLabel) {
      this.tipLabel.string = '点此选择档位招募（一级 ' + fmt(grid.recruitCost(1)) + ' 金币起）';
    }

    // 统计行（index.html:2413-2421）
    // 图鉴计数必须与图鉴页同口径（H5 `unlockedCardCount()`，index.html:2423-2428）：
    // 按「该档是否解锁」计数，而不是简单的 `highestTier >= i` —— 否则门槛未过的档位
    // 在 HUD 里会算作已解锁，与图鉴页对不上。
    if (this.statsLabel) {
      let unlocked = 0;
      for (let t = 1; t <= GameConfig.maxTier; t++) {
        if (codexCardUnlocked(t, grid)) unlocked++;
      }
      let line = '已合成 ' + grid.merges + ' 次 · 最高档位 ' + grid.highestTier
        + ' · 图鉴 ' + unlocked + '/' + GameConfig.maxTier;
      if (grid.settles > 0) line += ' · 已变现 ' + grid.settles + ' 次';
      this.statsLabel.string = line;
    }

    // 自动存档提示（index.html:2117-2118）
    if (this.saveNoteLabel) {
      let has = false;
      try {
        has = !!sys.localStorage.getItem(GameConfig.saveKey);
      } catch (e) {
        has = false;
      }
      this.saveNoteLabel.string = has ? '自动存档已开启' : '尚无存档（首次开局）';
    }
  }

  /** index.html:1945-1967 */
  private refreshUnlockButton() {
    const grid = this.grid;
    const btn = this.unlockBtn;
    if (!grid || !btn) return;

    if (grid.unlockedRows >= grid.maxRows) {
      btn.label.string = '已解锁满行';
      this.paintButton(btn, '#5c5c72');
      btn.primary = false;
      if (this.unlockSub) this.unlockSub.string = '';
      return;
    }

    const nextRows = grid.unlockedRows + 1;
    const price = GameConfig.rowUnlockPrices[nextRows];
    const enabled = price != null && grid.coins >= price;
    btn.label.string = '解锁第' + nextRows + '行';
    btn.primary = enabled;
    this.paintButton(btn, enabled ? '#9b7bff' : '#5c5c72');
    if (this.unlockSub) {
      this.unlockSub.string = price == null ? '' : (fmt(price) + ' 金币');
      this.unlockSub.color = enabled ? col('#e8d6ff', 255) : col('#9a9ab0', 255);
    }
  }

  // ---------- 坐标换算与零件 ----------

  /** H5 横坐标 → Cocos 横坐标 */
  private sx(x: number): number {
    return this.originX + x * this.k;
  }

  /** H5 纵坐标（左上原点、向下）→ Cocos 纵坐标（中心原点、向上） */
  private sy(y: number): number {
    return this.originY - y * this.k;
  }

  /** 建一个单行 Label（H5 的 text() 用 middle 基线，故这里垂直居中）；坐标 = H5 舞台坐标 */
  private makeText(
    parent: Node, x: number, y: number, size: number, hex: string,
    align: 'left' | 'center' | 'right', bold: boolean,
  ): Label {
    const n = new Node('lbl');
    n.parent = parent;
    const u = n.addComponent(UITransform);
    u.setContentSize(DESIGN_W * this.k, Math.max(12, size * this.k * 1.6));
    u.setAnchorPoint(align === 'left' ? 0 : (align === 'right' ? 1 : 0.5), 0.5);
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

  /** 建一个挂在某个零件内部的 Label：偏移以该零件中心为原点，dy 为「向下为正」的 H5 偏移 */
  private makeTextIn(
    parent: Node, dx: number, dy: number, size: number, hex: string,
    align: 'left' | 'center' | 'right', bold: boolean,
  ): Label {
    const n = new Node('lbl');
    n.parent = parent;
    const u = n.addComponent(UITransform);
    u.setContentSize(DESIGN_W * this.k, Math.max(12, size * this.k * 1.6));
    u.setAnchorPoint(align === 'left' ? 0 : (align === 'right' ? 1 : 0.5), 0.5);
    n.setPosition(dx * this.k, -dy * this.k, 0);
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
}
