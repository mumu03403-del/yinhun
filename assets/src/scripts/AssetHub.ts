/**
 * 资源总管：统一从 Cocos `resources` bundle 载入美术/音频，**纯代码加载**。
 *
 * 为什么不用「编辑器里拖 @property 引用」的方式：
 *   本项目走无头（headless）构建链，必须在没有人工编辑器步骤的前提下可用。
 *   放进 `assets/resources/**` 后即可用 `resources.load()` 按路径取用，
 *   构建时会自动随 resources bundle 打包（settings.json 的 projectBundles 会多出 "resources"）。
 *
 * 资源来源与改名映射（真源 = H5 v2.8.0 `build/publish/assets/`，见 index.html:86-111 的 TIER_META）：
 *   · board（仅 tier1-12 有图；H5 里 tier13-24 的 board 为 null → 回落扁平六边形）
 *       tier1.png  ← board/tier1.png
 *       …
 *       tier12.png ← board/tier12.png
 *   · codex（24 张全有；原名 `NN_名字.png` 含中文，微信小游戏路径保险起见改 ASCII）
 *       tier1.png  ← 01_坂田银时.png        tier13.png ← 13_山崎退.png
 *       tier2.png  ← 02_志村新八.png        tier14.png ← 14_柳生九兵衛.png
 *       tier3.png  ← 03_神乐.png            tier15.png ← 15_月詠.png
 *       tier4.png  ← 04_定春.png            tier16.png ← 16_お登勢.png
 *       tier5.png  ← 05_近藤勋.png          tier17.png ← 17_キャサリン.png
 *       tier6.png  ← 06_土方十四郎.png      tier18.png ← 18_長谷川泰三.png
 *       tier7.png  ← 07_冲田总悟.png        tier19.png ← 19_武蔵.png
 *       tier8.png  ← 08_桂小太郎.png        tier20.png ← 20_岡田似蔵.png
 *       tier9.png  ← 09_伊丽莎白.png        tier21.png ← 21_来島また子.png
 *       tier10.png ← 10_高杉晋助.png        tier22.png ← 22_徳川茂茂.png
 *       tier11.png ← 11_神威.png            tier23.png ← 23_幾松.png
 *       tier12.png ← 12_虚_吉田松阳.png      tier24.png ← 24_坂本辰馬.png
 *   · sfx（3 条，保持原名）
 *       audio/sfx_merge.mp3  ← assets/audio/sfx_merge.mp3
 *       audio/sfx_settle.mp3 ← assets/audio/sfx_settle.mp3
 *       audio/sfx_unlock.mp3 ← assets/audio/sfx_unlock.mp3
 *   · voice（仅 tier1-12 有；tier13-24 在 H5 里 audio 为 null）
 *       voice1.mp3  ← voice_坂田银时.mp3        voice7.mp3  ← voice_冲田总悟.mp3
 *       voice2.mp3  ← voice_志村新八.mp3        voice8.mp3  ← voice_桂小太郎.mp3
 *       voice3.mp3  ← voice_神乐.mp3            voice9.mp3  ← voice_伊丽莎白.mp3
 *       voice4.mp3  ← voice_定春.mp3            voice10.mp3 ← voice_高杉晋助.mp3
 *       voice5.mp3  ← voice_近藤勋.mp3          voice11.mp3 ← voice_神威.mp3
 *       voice6.mp3  ← voice_土方十四郎.mp3      voice12.mp3 ← voice_虚吉田松阳.mp3
 *
 * 设计原则：任何一条资源缺失都**静默降级为 null**，绝不抛异常、绝不阻塞开局。
 * （微信主包体积限制导致 codex 可能被裁时，游戏必须照常可玩。）
 */
import { resources, SpriteFrame, AudioClip, Rect } from 'cc';

type ReadyCb = () => void;

/** board 图存在的最大档位（H5 TIER_META 里 board 只到 12 档） */
export const BOARD_MAX_TIER = 12;
/** codex 图覆盖全部档位 */
export const CODEX_MAX_TIER = 24;
/** voice 存在的最大档位（H5 TIER_META 里 audio 只到 12 档） */
export const VOICE_MAX_TIER = 12;

/** H5 真正会调用的 3 个音效名（index.html:768 / 774 / 806） */
export const SFX_ALL: string[] = ['sfx_merge', 'sfx_unlock', 'sfx_settle'];

export class AssetHub {
  private static inst: AssetHub | null = null;

  /** 单例（全局只有一份资源表） */
  static get(): AssetHub {
    if (!AssetHub.inst) AssetHub.inst = new AssetHub();
    return AssetHub.inst;
  }

  private boardMap: { [tier: number]: SpriteFrame } = {};
  private codexMap: { [tier: number]: SpriteFrame } = {};
  private voiceMap: { [tier: number]: AudioClip } = {};
  private sfxMap: { [name: string]: AudioClip } = {};

  private boardDone = false;
  private codexDone = false;
  private audioDone = false;
  private started = false;

  private boardCbs: ReadyCb[] = [];
  private codexCbs: ReadyCb[] = [];
  private audioCbs: ReadyCb[] = [];

  /** codex 卡片裁剪缓存，键 = tier + '@' + 目标尺寸 */
  private coverCache: { [key: string]: SpriteFrame } = {};

  // ---------- 加载 ----------

  /**
   * 启动异步加载。可重复调用（幂等）。**不阻塞**：调用后立即返回，
   * 各分组自己完成后触发对应回调。
   */
  preload() {
    if (this.started) return;
    this.started = true;
    this.loadBoard();
    this.loadCodex();
    this.loadAudio();
  }

  private loadBoard() {
    let left = BOARD_MAX_TIER;
    const done = () => {
      left--;
      if (left <= 0) this.finishBoard();
    };
    for (let t = 1; t <= BOARD_MAX_TIER; t++) {
      const tier = t;
      this.loadSpriteFrame('art/board/tier' + tier, (sf) => {
        if (sf) this.boardMap[tier] = sf;
        done();
      });
    }
  }

  private loadCodex() {
    let left = CODEX_MAX_TIER;
    const done = () => {
      left--;
      if (left <= 0) this.finishCodex();
    };
    for (let t = 1; t <= CODEX_MAX_TIER; t++) {
      const tier = t;
      this.loadSpriteFrame('art/codex/tier' + tier, (sf) => {
        if (sf) this.codexMap[tier] = sf;
        done();
      });
    }
  }

  private loadAudio() {
    let left = SFX_ALL.length + VOICE_MAX_TIER;
    const done = () => {
      left--;
      if (left <= 0) this.finishAudio();
    };
    for (const name of SFX_ALL) {
      const n = name;
      this.loadClip('audio/' + n, (clip) => {
        if (clip) this.sfxMap[n] = clip;
        done();
      });
    }
    for (let t = 1; t <= VOICE_MAX_TIER; t++) {
      const tier = t;
      this.loadClip('audio/voice' + tier, (clip) => {
        if (clip) this.voiceMap[tier] = clip;
        done();
      });
    }
  }

  /**
   * 载入单张 SpriteFrame。
   * 图片资源的子资源名固定为 `spriteFrame`，故路径要带上 `/spriteFrame`。
   */
  private loadSpriteFrame(pathNoExt: string, cb: (sf: SpriteFrame | null) => void) {
    try {
      resources.load(pathNoExt + '/spriteFrame', SpriteFrame, (err: Error | null, sf: SpriteFrame) => {
        cb(err || !sf ? null : sf);
      });
    } catch (e) {
      cb(null);   // 资源不存在 / 环境不支持：静默降级
    }
  }

  private loadClip(pathNoExt: string, cb: (clip: AudioClip | null) => void) {
    try {
      resources.load(pathNoExt, AudioClip, (err: Error | null, clip: AudioClip) => {
        cb(err || !clip ? null : clip);
      });
    } catch (e) {
      cb(null);
    }
  }

  private finishBoard() {
    if (this.boardDone) return;
    this.boardDone = true;
    this.fire(this.boardCbs);
  }

  private finishCodex() {
    if (this.codexDone) return;
    this.codexDone = true;
    this.fire(this.codexCbs);
  }

  private finishAudio() {
    if (this.audioDone) return;
    this.audioDone = true;
    this.fire(this.audioCbs);
  }

  private fire(cbs: ReadyCb[]) {
    const list = cbs.slice();
    cbs.length = 0;
    for (const cb of list) {
      try {
        cb();
      } catch (e) {
        // 回调异常不能影响其它回调
      }
    }
  }

  // ---------- 就绪回调 ----------
  // 注意：若注册时该分组**已经**就绪，回调会立刻同步执行（调用方需能接受这一点）。

  onBoardReady(cb: ReadyCb) {
    if (this.boardDone) { cb(); return; }
    this.boardCbs.push(cb);
  }

  onCodexReady(cb: ReadyCb) {
    if (this.codexDone) { cb(); return; }
    this.codexCbs.push(cb);
  }

  onAudioReady(cb: ReadyCb) {
    if (this.audioDone) { cb(); return; }
    this.audioCbs.push(cb);
  }

  isBoardReady(): boolean { return this.boardDone; }
  isCodexReady(): boolean { return this.codexDone; }
  isAudioReady(): boolean { return this.audioDone; }

  // ---------- 取用 ----------

  /** 棋盘贴图（仅 1-12 档存在；缺失返回 null → 调用方回落扁平色块） */
  getBoard(tier: number): SpriteFrame | null {
    return this.boardMap[tier] || null;
  }

  /** 图鉴原图（1-24 档；缺失返回 null） */
  getCodex(tier: number): SpriteFrame | null {
    return this.codexMap[tier] || null;
  }

  /** 某档原声（仅 1-12 档存在；缺失返回 null） */
  getVoice(tier: number): AudioClip | null {
    return this.voiceMap[tier] || null;
  }

  /** 音效（sfx_merge / sfx_unlock / sfx_settle；缺失返回 null） */
  getSfx(name: string): AudioClip | null {
    return this.sfxMap[name] || null;
  }

  /**
   * 图鉴卡的「cover 裁剪」版本：等价 H5 index.html:2182-2189 的 `drawCover()`。
   *
   * H5 逻辑：按目标宽高比居中裁一块源图区域，再拉伸铺满目标矩形（不变形、会裁边）。
   * Cocos 做法：clone 一份 SpriteFrame 并把 `rect` 改成裁后的子矩形
   *   —— 与原图共用同一个 Texture2D，零额外 draw call，也不需要 Mask 组件。
   * 调用方需把节点的 `SizeMode` 设为 CUSTOM 并把 contentSize 设为目标尺寸。
   *
   * @param tier 档位（1-24）
   * @param targetW 目标宽（像素）
   * @param targetH 目标高（像素）
   */
  getCodexCover(tier: number, targetW: number, targetH: number): SpriteFrame | null {
    const src = this.getCodex(tier);
    if (!src) return null;
    if (!(targetW > 0) || !(targetH > 0)) return src;

    const key = tier + '@' + targetW + 'x' + targetH;
    const cached = this.coverCache[key];
    if (cached && cached.isValid) return cached;

    try {
      const r = src.rect;
      const sw = r.width;
      const sh = r.height;
      if (!(sw > 0) || !(sh > 0)) return src;

      const ir = sw / sh;              // 源图宽高比
      const dr = targetW / targetH;    // 目标宽高比
      let cx = r.x;
      let cy = r.y;
      let cw = sw;
      let ch = sh;
      if (ir > dr) {
        // 源图更宽 → 裁左右
        cw = sh * dr;
        cx = r.x + (sw - cw) / 2;
      } else {
        // 源图更高 → 裁上下
        ch = sw / dr;
        cy = r.y + (sh - ch) / 2;
      }

      const out = src.clone();
      out.setRect(new Rect(cx, cy, cw, ch));
      this.coverCache[key] = out;
      return out;
    } catch (e) {
      return src;   // 裁剪失败时退回原图，至少不是空白
    }
  }
}
