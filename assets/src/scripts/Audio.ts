/**
 * 音频组件：把 H5 v2.8.0 的音效系统移植到 Cocos Creator 3.8.8。
 *
 * ⚠️ 挂载方式（编辑器手动步骤，必须做）：
 *   在场景里选中 GameRoot 节点（Bootstrap / GameManager 所在的那个节点），
 *   「添加组件」→ GameAudio；然后在属性面板里挂 clip：
 *     · sfxClips   ：按 clip **资源名** 索引，命名必须是 sfx_merge / sfx_unlock / sfx_settle
 *     · voiceClips ：按 **档位 - 1** 索引（长度 24），索引 12..23 在 H5 里本来就没有音频，留空即可
 *   音频文件尚未导入工程时本组件必须静默降级（不报错、不卡住）——这是已知状态。
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
  /** 音效 clip（按 clip.name 建索引；命名须与 SFX_NAMES 一致） */
  @property([AudioClip])
  sfxClips: AudioClip[] = [];

  /** 各档原声 clip，索引 = 档位 - 1（对应 VOICE_CLIP_NAMES） */
  @property([AudioClip])
  voiceClips: AudioClip[] = [];

  /** 播放音量（0-1）；H5 未做音量滑杆，这里只是给编辑器一个可调档位 */
  @property
  volume = 1;

  /** 是否开启声音；来自 localStorage（audio.js:2-4），默认开启。
   *  注意：不能叫 `enabled` —— cc.Component 已经有公开的 `enabled` 属性。 */
  private soundOn = true;
  /** AudioSource 惰性获取 */
  private source: AudioSource | null = null;
  /** sfx 名字 → clip 的惰性索引 */
  private sfxByName: { [name: string]: AudioClip } = {};
  private sfxIndexBuilt = false;

  onLoad() {
    this.soundOn = this.readEnabled();
  }

  // ---------- 开关（audio.js:2-4 / 38-39） ----------

  isEnabled(): boolean {
    return this.soundOn;
  }

  /** 设置开关并持久化；关闭时停掉正在播的声音（audio.js:38） */
  setEnabled(v: boolean) {
    this.soundOn = !!v;
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
    if (!this.soundOn) return;
    if (!name) return;
    try {
      this.buildSfxIndex();
      const clip = this.sfxByName[name];
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
    if (!this.soundOn) return;
    if (!(tier >= 1)) return;
    try {
      const idx = Math.floor(tier) - 1;
      if (idx < 0 || idx >= this.voiceClips.length) return;   // 未导入：静默降级
      const clip = this.voiceClips[idx];
      if (!clip) return;
      const src = this.getSource();
      if (!src) return;
      src.playOneShot(clip, this.volume);
    } catch (e) {
      // 同上：静默降级
    }
  }

  // ---------- 内部 ----------

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

  /** 用 clip.name 建「名字 → clip」索引（只建一次；编辑器里改过 clip 后可手动清空重建） */
  private buildSfxIndex() {
    if (this.sfxIndexBuilt) return;
    this.sfxIndexBuilt = true;
    const list = this.sfxClips || [];
    for (let i = 0; i < list.length; i++) {
      const clip = list[i];
      if (!clip) continue;
      const n = clip.name;
      if (n && this.sfxByName[n] === undefined) this.sfxByName[n] = clip;
    }
  }
}
