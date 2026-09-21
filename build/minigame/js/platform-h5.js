/* =============================================================================
 * platform-h5.js —— 浏览器侧的平台实现
 *
 * 与 platform-wx.js **完全同一套接口**，因此同一份核心逻辑（game.js 的装配、
 * input-bridge、以及后续接入的玩法核心）可以同时跑在两端。
 *
 * 关键设计：本文件把浏览器的 pointer 事件**合成为微信那套数组式触摸事件**
 * （touches / changedTouches / identifier / clientX / clientY），
 * 于是 input-bridge 在浏览器里走的是与小游戏完全相同的代码路径 ——
 * 这正是「本地能验证」的前提。
 *
 * 特别注意：pointerup 时合成的 touches **不包含**刚抬起的那根手指，
 * 与 wx.onTouchEnd 的真实语义一致。
 * ========================================================================== */
;(function () {
  "use strict";

  var MODULE_ID = "js/platform-h5.js";

  function num(v, dflt) {
    return (typeof v === "number" && isFinite(v)) ? v : dflt;
  }

  /**
   * @param {object} [options]
   *   canvas   {HTMLCanvasElement} 可选，不给则找 #cv，找不到就自建
   *   win      {object} 可选，默认当前浏览器 window
   *   doc      {object} 可选，默认当前浏览器 document
   */
  function createPlatformH5(options) {
    options = options || {};
    var win = options.win || (typeof window !== "undefined" ? window : null);
    var doc = options.doc || (typeof document !== "undefined" ? document : null);
    if (!win || !doc) {
      throw new Error("platform-h5: 当前环境没有浏览器 window/document");
    }

    var canvas = options.canvas || null;
    var ctx = null;
    var activeTouches = [];            // [{identifier, clientX, clientY}] 等价于 wx 的 touches
    var handlers = { start: [], move: [], end: [], cancel: [] };
    var showHandlers = [];
    var hideHandlers = [];
    var resizeHandlers = [];
    var bound = false;
    var seq = 1;

    // ---------- 画布 ----------
    function createCanvas() {
      if (canvas) return canvas;
      canvas = doc.getElementById("cv");
      if (!canvas) {
        canvas = doc.createElement("canvas");
        canvas.id = "cv";
        if (doc.body) doc.body.appendChild(canvas);
      }
      if (canvas.style) {
        canvas.style.display = "block";
        canvas.style.touchAction = "none";              // 关掉浏览器手势，等价于小游戏
        canvas.style.webkitTapHighlightColor = "transparent";
        canvas.style.userSelect = "none";
      }
      return canvas;
    }

    function getContext(c) {
      if (ctx) return ctx;
      var target = c || createCanvas();
      ctx = target.getContext("2d");
      return ctx;
    }

    function getDeviceInfo() {
      var w = num(win.innerWidth, 375);
      var h = num(win.innerHeight, 812);
      return {
        pixelRatio: num(win.devicePixelRatio, 1),
        windowWidth: w,
        windowHeight: h,
        safeArea: { left: 0, top: 0, right: w, bottom: h, width: w, height: h },
        model: "browser",
        system: (typeof win.navigator !== "undefined" && win.navigator && win.navigator.userAgent) || "",
        platform: "h5",
        source: null
      };
    }

    function refreshDeviceInfo() { return getDeviceInfo(); }

    function getCanvasRect() {
      var c = createCanvas();
      if (c && typeof c.getBoundingClientRect === "function") {
        var r = c.getBoundingClientRect();
        return { left: num(r.left, 0), top: num(r.top, 0), width: num(r.width, 0), height: num(r.height, 0) };
      }
      var info = getDeviceInfo();
      return { left: 0, top: 0, width: info.windowWidth, height: info.windowHeight };
    }

    // ---------- 存储 ----------
    var store = null;
    function storeOrNull() {
      if (store) return store;
      try { store = win.localStorage || null; } catch (e) { store = null; }
      return store;
    }

    var storage = {
      set: function (key, value) {
        var s = storeOrNull();
        if (!s) return false;
        try { s.setItem(key, value); return true; } catch (e) { return false; }
      },
      get: function (key) {
        var s = storeOrNull();
        if (!s) return null;
        try {
          var v = s.getItem(key);
          return (v === "" || v === null || v === undefined) ? null : v;
        } catch (e) { return null; }
      },
      remove: function (key) {
        var s = storeOrNull();
        if (!s) return false;
        try { s.removeItem(key); return true; } catch (e) { return false; }
      },
      clear: function () {
        var s = storeOrNull();
        if (!s) return false;
        try { s.clear(); return true; } catch (e) { return false; }
      }
    };

    // ---------- 生命周期 ----------
    function dispatch(list, args) {
      for (var i = 0; i < list.length; i++) list[i].apply(null, args);
    }

    function bindLifecycle() {
      if (bound) return;
      bound = true;
      doc.addEventListener("visibilitychange", function () {
        if (doc.hidden) dispatch(hideHandlers, []);
        else dispatch(showHandlers, []);
      });
      win.addEventListener("pagehide", function () { dispatch(hideHandlers, []); });
      win.addEventListener("resize", function () { dispatch(resizeHandlers, [getDeviceInfo()]); });
      win.addEventListener("orientationchange", function () {
        setTimeout(function () { dispatch(resizeHandlers, [getDeviceInfo()]); }, 120);
      });
    }

    function onShow(cb) { bindLifecycle(); showHandlers.push(cb); }
    function onHide(cb) { bindLifecycle(); hideHandlers.push(cb); }
    function onResize(cb) { bindLifecycle(); resizeHandlers.push(cb); }

    // ---------- 触摸：pointer 事件 -> 微信式数组事件 ----------
    function toTouch(ev, identifier) {
      return {
        identifier: identifier,
        clientX: num(ev.clientX, 0),
        clientY: num(ev.clientY, 0),
        pageX: num(ev.pageX, num(ev.clientX, 0)),
        pageY: num(ev.pageY, num(ev.clientY, 0))
      };
    }

    function snapshotActive() {
      var out = [];
      for (var i = 0; i < activeTouches.length; i++) {
        var t = activeTouches[i];
        out.push({ identifier: t.identifier, clientX: t.clientX, clientY: t.clientY });
      }
      return out;
    }

    function indexOfIdentifier(identifier) {
      for (var i = 0; i < activeTouches.length; i++) {
        if (activeTouches[i].identifier === identifier) return i;
      }
      return -1;
    }

    function emit(kind, changedTouches) {
      // touches 用「变化之后」的活性手指集合 —— 与 wx.onTouchEnd 语义一致
      var ev = {
        touches: snapshotActive(),
        changedTouches: changedTouches,
        timeStamp: Date.now()
      };
      dispatch(handlers[kind], [ev]);
    }

    function bindPointer() {
      var c = createCanvas();
      c.addEventListener("pointerdown", function (ev) {
        if (ev.preventDefault) ev.preventDefault();
        var id = (ev.pointerId === undefined || ev.pointerId === null) ? (seq++) : ev.pointerId;
        var t = toTouch(ev, id);
        if (indexOfIdentifier(id) < 0) activeTouches.push({ identifier: id, clientX: t.clientX, clientY: t.clientY });
        emit("start", [t]);
      });
      c.addEventListener("pointermove", function (ev) {
        var t = toTouch(ev, ev.pointerId);
        var k = indexOfIdentifier(t.identifier);
        if (k < 0) return;
        activeTouches[k].clientX = t.clientX;
        activeTouches[k].clientY = t.clientY;
        emit("move", [t]);
      });
      c.addEventListener("pointerup", function (ev) {
        var t = toTouch(ev, ev.pointerId);
        var k = indexOfIdentifier(t.identifier);
        if (k < 0) return;
        activeTouches.splice(k, 1);          // 先摘掉，再合成事件：touches 里不含抬起的那根
        emit("end", [t]);
      });
      c.addEventListener("pointercancel", function (ev) {
        var t = toTouch(ev, ev.pointerId);
        var k = indexOfIdentifier(t.identifier);
        if (k >= 0) activeTouches.splice(k, 1);
        emit("cancel", [t]);
      });
      c.addEventListener("contextmenu", function (ev) { if (ev.preventDefault) ev.preventDefault(); });
    }

    function subscribe(kind, cb) {
      if (kind === null) return function () {};
      bindPointer();
      handlers[kind].push(cb);
      return function () {
        var i = handlers[kind].indexOf(cb);
        if (i >= 0) handlers[kind].splice(i, 1);
      };
    }

    function onTouchStart(cb) { return subscribe("start", cb); }
    function onTouchMove(cb) { return subscribe("move", cb); }
    function onTouchEnd(cb) { return subscribe("end", cb); }
    function onTouchCancel(cb) { return subscribe("cancel", cb); }

    // ---------- 时间 ----------
    function now() { return Date.now(); }
    function raf(cb) { return win.requestAnimationFrame(cb); }
    function caf(id) { return win.cancelAnimationFrame(id); }
    function setFps() { return false; }

    /** 仅浏览器版需要：让画布 CSS 尺寸跟随窗口 */
    function syncCanvasCssSize() {
      var c = createCanvas();
      var info = getDeviceInfo();
      if (c.style) { c.style.width = info.windowWidth + "px"; c.style.height = info.windowHeight + "px"; }
    }

    return {
      kind: "h5",
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
      syncCanvasCssSize: syncCanvasCssSize,
      subscribeTouch: subscribe
    };
  }

  var api = { __moduleId: MODULE_ID, createPlatformH5: createPlatformH5 };

  var root = typeof globalThis !== "undefined" ? globalThis : this;
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.__WB_REG__ = root.__WB_REG__ || {};
    root.__WB_REG__[MODULE_ID] = api;
  }
})();
