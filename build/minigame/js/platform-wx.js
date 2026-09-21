/* =============================================================================
 * platform-wx.js —— 微信小游戏侧的平台实现
 *
 * 职责（与 platform-h5.js 完全同一套接口）：
 *   createCanvas()            wx.createCanvas()。运行期第一次调用返回「上屏画布」
 *   getContext(canvas)        canvas.getContext('2d')
 *   getDeviceInfo()           wx.getSystemInfoSync()（缺失时回落 wx.getWindowInfo()）
 *   getCanvasRect()           上屏画布恒等于全屏且位于原点，故 left/top 恒为 0
 *   storage.{get,set,remove}  wx.getStorageSync / setStorageSync / removeStorageSync
 *   onShow / onHide / onResize
 *   onTouchStart/Move/End/Cancel   原样透传 wx 的数组式触摸事件（交给 input-bridge 归一化）
 *   now / raf / caf
 *
 * 约束：本文件不得引用任何 BOM / DOM 对象（浏览器全局对象、文档对象、Web 存储），
 *       否则在小游戏运行时（JSCore / V8，无 BOM 无 DOM）会直接白屏。
 * ========================================================================== */
;(function () {
  "use strict";

  var MODULE_ID = "js/platform-wx.js";

  function num(v, dflt) {
    return (typeof v === "number" && isFinite(v)) ? v : dflt;
  }

  /** 取到小游戏运行时提供的全局对象 wx（此处不做任何 DOM 猜测） */
  function resolveWx() {
    if (typeof globalThis !== "undefined" && globalThis.wx) return globalThis.wx;
    if (typeof wx !== "undefined") return wx;
    return null;
  }

  /**
   * @param {object} [wxApi] 微信小游戏全局对象。省略时自动解析。
   */
  function createPlatformWx(wxApi) {
    var wx = wxApi || resolveWx();
    if (!wx) {
      throw new Error("platform-wx: 当前环境没有 wx，小游戏适配层无法工作");
    }

    var canvas = null;
    var ctx = null;
    var canvasInfo = null;                 // getCanvasRect() 的缓存
    var bound = { start: false, move: false, end: false, cancel: false };
    var touchHandlers = { start: [], move: [], end: [], cancel: [] };
    var showHandlers = [];
    var hideHandlers = [];
    var resizeHandlers = [];
    var touchDispatchCount = 0;

    // ---------- 画布 ----------
    function createCanvas() {
      if (canvas) return canvas;
      if (typeof wx.createCanvas !== "function") {
        throw new Error("platform-wx: wx.createCanvas 不可用");
      }
      canvas = wx.createCanvas();          // 运行期第一次调用 = 上屏画布
      return canvas;
    }

    function getContext(c) {
      if (ctx) return ctx;
      var target = c || createCanvas();
      if (!target || typeof target.getContext !== "function") {
        throw new Error("platform-wx: 画布没有 getContext");
      }
      ctx = target.getContext("2d");
      return ctx;
    }

    // ---------- 设备信息 ----------
    function getDeviceInfo() {
      var raw = {};
      try {
        if (typeof wx.getSystemInfoSync === "function") raw = wx.getSystemInfoSync() || {};
      } catch (e) { raw = {}; }
      if (raw.windowWidth === undefined || raw.windowWidth === null) {
        try {
          if (typeof wx.getWindowInfo === "function") {
            var alt = wx.getWindowInfo() || {};
            for (var k in alt) if (Object.prototype.hasOwnProperty.call(alt, k) && raw[k] === undefined) raw[k] = alt[k];
          }
        } catch (e2) { /* 忽略：保持现有 raw */ }
      }
      var w = num(raw.windowWidth, 375);
      var h = num(raw.windowHeight, 812);
      var info = {
        pixelRatio: num(raw.pixelRatio, 1),
        windowWidth: w,
        windowHeight: h,
        safeArea: raw.safeArea || { left: 0, top: 0, right: w, bottom: h, width: w, height: h },
        model: raw.model || "",
        system: raw.system || "",
        platform: raw.platform || "",
        source: raw
      };
      canvasInfo = { left: 0, top: 0, width: w, height: h };   // 上屏画布：原点 + 全屏
      return info;
    }

    /** 尺寸变化后刷新缓存；getCanvasRect 只读缓存，避免每个触摸事件都调一次同步 API */
    function refreshDeviceInfo() { return getDeviceInfo(); }

    function getCanvasRect() {
      if (!canvasInfo) getDeviceInfo();
      return canvasInfo;
    }

    // ---------- 存储 ----------
    var storage = {
      set: function (key, value) {
        try { wx.setStorageSync(key, value); return true; } catch (e) { return false; }
      },
      get: function (key) {
        try {
          var v = wx.getStorageSync(key);
          return (v === "" || v === undefined || v === null) ? null : v;
        } catch (e) { return null; }
      },
      remove: function (key) {
        try { wx.removeStorageSync(key); return true; } catch (e) { return false; }
      },
      clear: function () {
        try { wx.clearStorageSync(); return true; } catch (e) { return false; }
      }
    };

    // ---------- 生命周期 ----------
    function onShow(cb) {
      showHandlers.push(cb);
      if (showHandlers.length === 1 && typeof wx.onShow === "function") {
        wx.onShow(function () { dispatch(showHandlers, []); });
      }
    }
    function onHide(cb) {
      hideHandlers.push(cb);
      if (hideHandlers.length === 1 && typeof wx.onHide === "function") {
        wx.onHide(function () { dispatch(hideHandlers, []); });
      }
    }
    function onResize(cb) {
      resizeHandlers.push(cb);
      if (resizeHandlers.length === 1 && typeof wx.onWindowResize === "function") {
        wx.onWindowResize(function (res) {
          getDeviceInfo();
          dispatch(resizeHandlers, [res]);
        });
      }
    }
    function dispatch(list, args) {
      for (var i = 0; i < list.length; i++) list[i].apply(null, args);   // 不吞异常：真出错要能被看见
    }

    // ---------- 触摸（原样透传给 input-bridge）----------
    function subscribe(kind, cb) {
      ensureBound(kind);
      touchHandlers[kind].push(cb);
      return function () {
        var i = touchHandlers[kind].indexOf(cb);
        if (i >= 0) touchHandlers[kind].splice(i, 1);
      };
    }

    function ensureBound(kind) {
      if (bound[kind]) return;
      bound[kind] = true;
      var fn = function (e) {
        touchDispatchCount++;
        dispatch(touchHandlers[kind], [e]);
      };
      if (kind === "start" && typeof wx.onTouchStart === "function") wx.onTouchStart(fn);
      if (kind === "move" && typeof wx.onTouchMove === "function") wx.onTouchMove(fn);
      if (kind === "end" && typeof wx.onTouchEnd === "function") wx.onTouchEnd(fn);
      if (kind === "cancel" && typeof wx.onTouchCancel === "function") wx.onTouchCancel(fn);
    }

    function onTouchStart(cb) { return subscribe("start", cb); }
    function onTouchMove(cb) { return subscribe("move", cb); }
    function onTouchEnd(cb) { return subscribe("end", cb); }
    function onTouchCancel(cb) { return subscribe("cancel", cb); }

    // ---------- 时间 ----------
    function now() { return Date.now(); }

    function raf(cb) {
      if (typeof wx.requestAnimationFrame === "function") return wx.requestAnimationFrame(cb);
      if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
      return setTimeout(function () { cb(Date.now()); }, 16);
    }

    function caf(id) {
      if (typeof wx.cancelAnimationFrame === "function") return wx.cancelAnimationFrame(id);
      if (typeof cancelAnimationFrame === "function") return cancelAnimationFrame(id);
      return clearTimeout(id);
    }

    /** 可选：锁帧（R3 性能缓解手段）。失败不抛出。 */
    function setFps(fps) {
      try {
        if (typeof wx.setPreferredFramesPerSecond === "function") {
          wx.setPreferredFramesPerSecond(fps);
          return true;
        }
      } catch (e) { /* 忽略 */ }
      return false;
    }

    return {
      kind: "wx",
      createCanvas: createCanvas,
      getContext: getContext,
      getDeviceInfo: getDeviceInfo,
      refreshDeviceInfo: refreshDeviceInfo,
      getCanvasRect: getCanvasRect,
      storage: storage,
      onShow: onShow,
      onHide: onHide,
      onResize: onResize,
      onTouchStart: onTouchStart,
      onTouchMove: onTouchMove,
      onTouchEnd: onTouchEnd,
      onTouchCancel: onTouchCancel,
      now: now,
      raf: raf,
      caf: caf,
      setFps: setFps,
      subscribeTouch: subscribe,
      stats: {
        get touchDispatchCount() { return touchDispatchCount; }
      }
    };
  }

  var api = { __moduleId: MODULE_ID, createPlatformWx: createPlatformWx };

  var root = typeof globalThis !== "undefined" ? globalThis : this;
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.__WB_REG__ = root.__WB_REG__ || {};
    root.__WB_REG__[MODULE_ID] = api;
  }
})();
