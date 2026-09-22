/**
 * 音频组件：把 H5 v2.8.0 的音效系统移植到 Cocos Creator 3.8.8。
 *
 * 资源来源（v2.9.0 起改为**纯代码加载**，不再要求编辑器手动挂 clip）：
 *   通过 `AssetHub` 从 `assets/resources/audio/**` 异步载入，见 AssetHub.ts 的映射表。
 *   若某个 clip 同时在编辑器里被手工指到 `sfxClips` / `voiceClips` 上，
 *   则以**手工指定的为准**（保留这条覆盖通道，便于将来替换素材）。
 *
 * 与 H5 的对应关系（真源：build/publish/index.html v2.8.0 + build/publish/assets/js/audio.js）：
 *   playSfx(name)          ← index.html:1104-1119（sfxCache + assets/audio/<name>.mp3）
 *                            实际被调用的名字只有 3 个：'sfx_merge' index.html:768、
 *                            'sfx_unlock' index.html:774、'sfx_settle' index.html:806
 *   playVoice(tier)        ← index.html:1087-1102（voiceAud[tier] + 静音判定）
 *   静音开关（持久化）      ← assets/js/audio.js:2-4（键 'gin_audio_v1'，'1'/'0'）
 *   muted 二次判定          ← index.html:1088 / 1106（muted 与 GinAudio.isEnabled() 双闸）
 *
 * 未移植的部分（H5 侧是纯 WebAudio 程序化合成，工程里没有对应音频资产）：
 *   GinAudio.click/locked/unlock/hit/beep/sweep/blip/jump/fanfare/lose/startBgm/stopBgm
 *   —— audio.js:42-101 / 106-123 全部用 OscillatorNode 现场合成，Cocos 侧无等价资产，故不移植。
 */
import { _decorator, Component, AudioClip, AudioSource, sys } from 'cc';
import { AssetHub } from './AssetHub';

const { ccclass, property } = _decorator;

/** 静音开关的存储键（audio.js:2） */
const ENABLED_KEY = 'gin_audio_v1';

/**
 * H5 侧真正存在的音效资源名（assets/audio/<name>.mp3）。
 * 来源：index.html:768 'sfx_merge'、index.html:774 'sfx_unlock'、index.html:806 'sfx_settle'。
 */
export const SFX_NAMES: string[] = ['sfx_merge', 'sfx_unlock', 'sfx_settle'];

/**
 * 各档原声的 H5 文件名（index.html:87-110 的 TIER_META[i].audio），索引 = 档位 - 1。
 * 注意两个坑：
 *   · tier12 的文件名没有下划线 —— 'voice_虚吉田松阳.mp3'（index.html:98、注释 index.html:85）
 *   · tier13-24 在 H5 里 audio 为 null（index.html:99-110），即本来就没有原声
 */
export const VOICE_CLIP_NAMES: (string | null)[] = [
  'voice_坂田银时', 'voice_志村新八', 'voice_神乐', 'voice_定春', 'voice_近藤勋', 'voice_土方十四郎',
  'voice_冲田总悟', 'voice_桂小太郎', 'voice_伊丽莎白', 'voice_高杉晋助', 'voice_神威', 'voice_虚吉田松阳',
  null, null, null, null, null, null,
  null, null, null, null, null, null,
];

@ccclass('GameAudio')
export class GameAudio extends Component {
  /** 音效 clip（可选覆盖通道：按 clip.name 索引，命名须与 SFX_NAMES 一致）。留空即走 AssetHub。 */
  @property([AudioClip])
  sfxClips: AudioClip[] = [];

  /** 各档原声 clip（可选覆盖通道），索引 = 档位 - 1（对应 VOICE_CLIP_NAMES）。留空即走 AssetHub。 */
  @property([AudioClip])
  voiceClips: AudioClip[] = [];

  /** 播放音量（0-1）；H5 未做音量滑杆，这里只是给编辑器一个可调档位 */
  @property
  volume = 1;

  /** 是否开启声音；来自 localStorage（audio.js:2-4），默认开启。
   *  注意：不能叫 `enabled` —— cc.Component 已经有公开的 `enabled` 属性。 */
  private soundOn = true;

  /**
   * H5 的全局静音开关（index.html:1088/1106 与 GinAudio.isEnabled() 构成双闸）。
   * H5 里它由静音按钮直接翻转；这里保持**内部字段**（对外不加 setter），
   * 由 `setEnabled` / `toggleEnabled` 一并驱动，语义与 H5 等价。
   */
  private muted = false;

  /** AudioSource 惰性获取 */
  private source: AudioSource | null = null;
  /** sfx 名字 → clip 的惰性索引（手工指定优先） */
  private sfxByName: { [name: string]: AudioClip } = {};
  /** 手工指定的 voice oversides 索引 */
  private voiceOverride: { [tier: number]: AudioClip } = {};
  private overrideBuilt = false;

  onLoad() {
    this.soundOn = this.readEnabled();
    this.muted = !this.soundOn;
    // 触发资源预载（幂等）；音频就绪后无需额外动作——播放时按需取用
    AssetHub.get().preload();
  }

  // ---------- 开关（audio.js:2-4 / 38-39） ----------

  isEnabled(): boolean {
    return this.soundOn;
  }

  /** 设置开关并持久化；关闭时停掉正在播的声音（audio.js:38） */
  setEnabled(v: boolean) {
    this.soundOn = !!v;
    this.muted = !this.soundOn;   // 与 H5 双闸保持一致
    try {
      sys.localStorage.setItem(ENABLED_KEY, this.soundOn ? '1' : '0');
    } catch (e) {
      // 隐私模式 / 无 localStorage：忽略，开关仍在本局生效
    }
    if (!this.soundOn) {
      try {
        if (this.source) this.source.stop();
      } catch (e) {
        // 忽略：无音频源时无需停
      }
    }
  }

  /** 切换开关，返回切换后的状态（H5 MUTE_BTN 的 muted = !muted，index.html:1370） */
  toggleEnabled(): boolean {
    this.setEnabled(!this.soundOn);
    return this.soundOn;
  }

  private readEnabled(): boolean {
    try {
      return sys.localStorage.getItem(ENABLED_KEY) !== '0';
    } catch (e) {
      return true;
    }
  }

  // ---------- 播放 ----------

  /**
   * 播放一个音效（index.html:1105-1119）。
   * 名字不存在 / 静音 / clip 未导入 → 静默返回，绝不抛异常。
   */
  playSfx(name: string) {
    if (!this.canPlay()) return;
    if (!name) return;
    try {
      this.buildOverrideIndex();
      const clip = this.sfxByName[name] || AssetHub.get().getSfx(name);
      if (!clip) return;                       // 资源尚未导入：静默降级
      const src = this.getSource();
      if (!src) return;
      src.playOneShot(clip, this.volume);
    } catch (e) {
      // 任何播放异常都吞掉：音频不可用不应影响玩法
    }
  }

  /**
   * 播放某档原声（index.html:1087-1102）。
   * 越界 / 该档无原声（H5 tier13-24 为 null）/ 静音 → 静默返回。
   */
  playVoice(tier: number) {
    if (!this.canPlay()) return;
    if (!(tier >= 1)) return;
    try {
      const idx = Math.floor(tier) - 1;
      this.buildOverrideIndex();
      const clip = this.voiceOverride[tier] || AssetHub.get().getVoice(tier);
      if (!clip) return;                       // 未导入：静默降级
      const src = this.getSource();
      if (!src) return;
      src.playOneShot(clip, this.volume);
    } catch (e) {
      // 同上：静默降级
    }
  }

  // ---------- 内部 ----------

  /** 双闸：muted 与 soundOn 任一为「关」都不出声（index.html:1088/1106） */
  private canPlay(): boolean {
    return this.soundOn && !this.muted;
  }

  /** 惰性取 AudioSource（挂在同一节点上，缺失时自行补一个） */
  private getSource(): AudioSource | null {
    try {
      if (!this.source || !this.source.isValid) {
        this.source = this.getComponent(AudioSource) || this.addComponent(AudioSource);
      }
      return this.source;
    } catch (e) {
      return null;
    }
  }

  /**
   * 用编辑器手工指定的 clip 建索引（**覆盖通道**，优先级高于 AssetHub）。
   * sfx 按 clip.name 索引；voice 按 VOICE_CLIP_NAMES 的名字反查档位。
   */
  private buildOverrideIndex() {
    if (this.overrideBuilt) return;
    this.overrideBuilt = true;

    const sfxList = this.sfxClips || [];
    for (let i = 0; i < sfxList.length; i++) {
      const clip = sfxList[i];
      if (!clip) continue;
      const n = clip.name;
      if (n && this.sfxByName[n] === undefined) this.sfxByName[n] = clip;
    }

    const voiceList = this.voiceClips || [];
    for (let i = 0; i < voiceList.length; i++) {
      const clip = voiceList[i];
      if (!clip) continue;
      const n = clip.name;
      for (let t = 1; t <= VOICE_CLIP_NAMES.length; t++) {
        if (VOICE_CLIP_NAMES[t - 1] === n) {
          this.voiceOverride[t] = clip;
          break;
        }
      }
    }
  }
}
