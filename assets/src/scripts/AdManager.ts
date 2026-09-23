/**
 * 激励视频广告模块（微信小游戏 `wx.createRewardedVideoAd`）。
 *
 * 逐行对齐 H5 的广告模块（真源 build/publish/index.html:2122-2307）：
 *   · 环境判定：`wx.createRewardedVideoAd` 存在 → 小游戏；否则 web（index.html:2136-2138）。
 *   · 广告位未配置（仍是占位串）→ 视同无广告（index.html:2139-2141）。
 *   · **奖励唯一条件**：`onClose(res)` 且 `res.isEnded === true`（完整播放）（index.html:2210-2215）。
 *   · **绝不卡死玩家**：`onError` 自动 `load()` 重试一次；仍失败 / 非小游戏 / 未配置广告位
 *     → 一律兜底放行（直接按成功处理）（index.html:2204-2209 / 2182-2198）。
 *   · 每日上限 3 次，本地存储记 `{date, count}`，跨天自动重置（index.html:2132-2163）。
 *
 * 与 H5 的差异只有一处（不影响语义）：H5 里广告模块直接写全局 `toast`；
 * Cocos 侧改由 `onMessage` 回调把文案交给 GameManager 的 showToast。
 *
 * 自测 / 运行时注入入口：`setAdUnitId(id)`（H5 index.html:2307 的同名钩子）。
 */
import { sys } from 'cc';

/** 微信小游戏全局对象；web 平台不存在，故用 `typeof` 守卫（H5 index.html:2136） */
declare const wx: any;

/** 广告位 id 占位串；上线前由 `setAdUnitId()` 注入真实值（H5 index.html:2131） */
const AD_UNIT_ID_DEFAULT = 'adunit-REPLACE_ME';
/** 每日看广告解锁次数上限（H5 index.html:2132） */
const AD_DAILY_LIMIT = 3;
/** 每日计数的本地存储键（H5 index.html:2133） */
const AD_SAVE_KEY = 'merge_samurai_ad_v1';
/** 占位串特征：出现它即视为「广告位未配置」（H5 index.html:2140） */
const AD_UNIT_PLACEHOLDER = 'REPLACE_ME';

/** 当前运行环境（H5 adEnv，index.html:2136-2138） */
export type AdEnv = 'wx' | 'web';

/** 每日计数记录（H5 index.html:2146-2154） */
interface AdDailyRecord {
  date: string;
  count: number;
}

export class AdManager {
  private static inst: AdManager | null = null;

  /** 单例（全局只有一份广告状态） */
  static get(): AdManager {
    if (!AdManager.inst) AdManager.inst = new AdManager();
    return AdManager.inst;
  }

  /** 广告位 id；默认占位（H5 AD_UNIT_ID，index.html:2131） */
  private adUnitId = AD_UNIT_ID_DEFAULT;
  /** 惰性创建的激励视频实例（H5 adVideoAd，index.html:2134） */
  private videoAd: any = null;

  /**
   * 提示回调，由 GameManager 注入（H5 里直接写全局 toast）。
   * 参数：文案、持续秒数。
   */
  onMessage: ((text: string, seconds: number) => void) | null = null;

  // ---------- 环境与配置 ----------

  /** 当前环境（H5 index.html:2136-2138） */
  env(): AdEnv {
    try {
      if (typeof wx !== 'undefined' && wx && typeof wx.createRewardedVideoAd === 'function') return 'wx';
    } catch (e) {
      // 访问 wx 抛异常 → 视同 web
    }
    return 'web';
  }

  /** 广告位是否已配置（H5 index.html:2139-2141） */
  configured(): boolean {
    return typeof this.adUnitId === 'string'
      && this.adUnitId.length > 0
      && this.adUnitId.indexOf(AD_UNIT_PLACEHOLDER) < 0;
  }

  /** 运行时注入真实广告位 id（H5 setAdUnitId，index.html:2307） */
  setAdUnitId(id: string): string {
    this.adUnitId = String(id);
    this.videoAd = null;      // 换广告位后旧实例作废
    return this.adUnitId;
  }

  /** 当前广告位 id（供自测 / 排查） */
  getAdUnitId(): string {
    return this.adUnitId;
  }

  /** 每日次数上限（H5 AD_DAILY_LIMIT，index.html:2132） */
  dailyLimit(): number {
    return AD_DAILY_LIMIT;
  }

  // ---------- 每日计数（H5 index.html:2142-2163） ----------

  /** 当天标识 'YYYY-M-D'（H5 adTodayStr，index.html:2142-2145） */
  private todayStr(): string {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /** 读今日记录；跨天 / 结构非法 / 计数非法 → 归零（H5 adDaily，index.html:2146-2154） */
  private daily(): AdDailyRecord {
    let raw: string | null = null;
    try {
      raw = sys.localStorage.getItem(AD_SAVE_KEY);
    } catch (e) {
      raw = null;
    }
    let o: any = null;
    try {
      o = raw ? JSON.parse(raw) : null;
    } catch (e) {
      o = null;
    }
    if (!o || typeof o !== 'object' || o.date !== this.todayStr()
      || typeof o.count !== 'number' || !isFinite(o.count) || o.count < 0) {
      o = { date: this.todayStr(), count: 0 };
    }
    return o as AdDailyRecord;
  }

  /** 写今日记录（写入失败静默忽略，如隐私模式）（H5 adSaveDaily，index.html:2155） */
  private saveDaily(o: AdDailyRecord): void {
    try {
      sys.localStorage.setItem(AD_SAVE_KEY, JSON.stringify(o));
    } catch (e) {
      // 忽略：无 localStorage 时计数只在本局有效
    }
  }

  /** 今日剩余可解锁次数（H5 adRemainingToday，index.html:2156） */
  remainingToday(): number {
    return Math.max(0, AD_DAILY_LIMIT - this.daily().count);
  }

  /** 消耗一次今日额度；已用完返回 false（H5 adConsumeDaily，index.html:2157-2163） */
  private consumeDaily(): boolean {
    const o = this.daily();
    if (o.count >= AD_DAILY_LIMIT) {
      this.saveDaily(o);
      return false;
    }
    o.count++;
    this.saveDaily(o);
    return true;
  }

  // ---------- 播放 ----------

  private message(text: string, seconds: number): void {
    if (this.onMessage) this.onMessage(text, seconds);
  }

  /**
   * 播放激励视频；**成功（含兜底放行）后**回调 `onSuccess`。
   * 与 H5 `adShow`（index.html:2179-2243）逐分支一致。
   *
   * @returns 是否走到了「可兑现」的分支（false = 今日次数已用完，未发奖）
   */
  show(onSuccess: () => void): boolean {
    const done = () => {
      if (typeof onSuccess === 'function') onSuccess();
    };

    // ① 非小游戏环境 / 广告位未配置 → 直接放行（index.html:2182-2186）
    if (this.env() !== 'wx' || !this.configured()) {
      this.message('当前环境无广告，已直接解锁', 2.2);
      done();
      return true;
    }

    // ② 今日次数用完 → 不发奖（index.html:2187-2190）
    if (this.remainingToday() <= 0) {
      this.message('今日解锁次数已用完', 2.2);
      return false;
    }

    // ③ 惰性创建实例（index.html:2191-2193）
    if (!this.videoAd) {
      try {
        this.videoAd = wx.createRewardedVideoAd({ adUnitId: this.adUnitId });
      } catch (e) {
        this.videoAd = null;
      }
    }
    // ④ 创建失败 / 无 show 方法 → 直接放行（index.html:2194-2198）
    if (!this.videoAd || typeof this.videoAd.show !== 'function') {
      this.message('当前环境无广告，已直接解锁', 2.2);
      done();
      return true;
    }

    const ad = this.videoAd;
    let finished = false;
    let retried = false;

    const cleanup = () => {
      try {
        if (ad.offClose) ad.offClose(onClose);
      } catch (e) { /* 忽略 */ }
      try {
        if (ad.offError) ad.offError(onError);
      } catch (e) { /* 忽略 */ }
    };

    // 兜底放行（index.html:2204-2209）
    const fallback = () => {
      if (finished) return;
      finished = true;
      cleanup();
      this.message('当前环境无广告，已直接解锁', 2.2);
      done();
    };

    // 只有完整播放才发奖（index.html:2210-2215）
    const onClose = (res: any) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (res && res.isEnded === true) {
        this.consumeDaily();
        done();
      } else {
        this.message('需要看完视频才能解锁', 2.2);
      }
    };

    // 出错 → 自动重试一次；仍失败 → 兜底放行（index.html:2216-2229）
    const onError = () => {
      if (finished) return;
      cleanup();
      if (retried) { fallback(); return; }
      retried = true;
      try {
        ad.load().then(() => {
          if (finished) return;
          ad.onClose(onClose);
          ad.onError(onError);
          ad.show().catch(() => { fallback(); });
        }).catch(() => { fallback(); });
      } catch (e) {
        fallback();
      }
    };

    try {
      ad.onClose(onClose);
      ad.onError(onError);
      ad.show().catch(() => {
        if (finished) return;
        try {
          ad.load().then(() => {
            ad.show().catch(() => { onError(); });
          }).catch(() => { onError(); });
        } catch (e) {
          onError();
        }
      });
    } catch (e) {
      onError();
    }
    return true;
  }
}
