/* =============================================================================
 * mock-wx.js —— 在浏览器/Node 里冒充微信小游戏运行时
 *
 * 目的：本机没有微信开发者工具，无法运行真实小游戏运行时。为了**真正执行**
 *       platform-wx.js（而不是只做静态检查），这里手写一个 wx 打桩对象，
 *       它的行为按微信官方文档对齐：
 *        - wx.createCanvas()：运行期第一次调用返回「上屏画布」，之后返回离屏画布
 *        - 上屏画布的 getContext('2d') 返回一个记录型 2D 上下文
 *        - wx.onTouchStart/Move/End/Cancel：注册回调，由测试按序派发数组式事件
 *        - wx.getSystemInfoSync / wx.setStorageSync / getStorageSync /
 *          removeStorageSync / clearStorageSync / onShow / onHide / onWindowResize
 *        - 触摸事件由**手写序列**驱动，不做任何自动合成
 *
 * 两条工程红线：
 *   1) 记录型上下文的调用日志有上限（默认 4000），长时间跑也不会撑爆内存；
 *   2) flushFrames 有单次帧数上限（默认 240），不会出现停不下来的循环。
 * ========================================================================== */
;(function () {
  "use strict";

  var MODULE_ID = "_harness/mock-wx.js";

  var DEFAULT_SYSTEM_INFO = {
    pixelRatio: 2,
    windowWidth: 375,
    windowHeight: 812,
    safeArea: { left: 0, top: 0, right: 375, bottom: 812, width: 375, height: 812 },
    model: "MockDevice",
    system: "mock 1.0",
    platform: "devtools"
  };

  /** 记录型 2D 上下文：支持小游戏渲染用到的全部方法/属性，调用进 ring 缓冲 */
  function createFakeContext(opts) {
    opts = opts || {};
    var cap = opts.callCap || 4000;
    var calls = [];
    var dropped = 0;

    function push(name) {
      if (calls.length >= cap) { dropped++; return; }
      var args = Array.prototype.slice.call(arguments, 1);
      calls.push({ name: name, args: args.length === 1 ? args[0] : args });
    }

    function noop(name) {
      return function () { push.apply(null, [name].concat(Array.prototype.slice.call(arguments))); };
    }

    var ctx = {
      __isFakeContext: true,
      calls: calls,
      getDroppedCount: function () { return dropped; },
      getCallCount: function () { return calls.length + dropped; },
      countOf: function (name) {
        var n = 0;
        for (var i = 0; i < calls.length; i++) if (calls[i].name === name) n++;
        return n;
      },
      clearLog: function () { calls.length = 0; dropped = 0; }
    };

    var methods = [
      "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo",
      "rect", "fill", "stroke", "clip", "fillRect", "strokeRect", "clearRect",
      "fillText", "strokeText", "translate", "rotate", "scale", "transform", "setTransform",
      "resetTransform", "setLineDash", "drawImage", "quadraticCurveTo", "bezierCurveTo",
      "ellipse"
    ];
    for (var i = 0; i < methods.length; i++) ctx[methods[i]] = noop(methods[i]);

    ctx.createLinearGradient = function () {
      push("createLinearGradient", Array.prototype.slice.call(arguments));
      return { addColorStop: function () { push("addColorStop"); } };
    };
    ctx.createRadialGradient = function () {
      push("createRadialGradient", Array.prototype.slice.call(arguments));
      return { addColorStop: function () { push("addColorStop"); } };
    };
    ctx.createPattern = function () { push("createPattern"); return null; };
    ctx.measureText = function (t) { push("measureText", t); return { width: String(t).length * 8 }; };
    ctx.getImageData = function () { push("getImageData"); return { data: [] }; };
    ctx.putImageData = noop("putImageData");

    // 常用可写属性（普通属性即可）
    ctx.fillStyle = "#000000";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    return ctx;
  }

  function createFakeCanvas(isScreen, opts) {
    var ctx = createFakeContext(opts);
    return {
      __isScreenCanvas: !!isScreen,
      width: 0,
      height: 0,
      getContext: function (type) {
        if (type !== "2d") return null;             // 小游戏同一次不能既取 2d 又取 webgl
        return ctx;
      },
      __ctx: ctx
    };
  }

  function createMockWx(options) {
    options = options || {};
    var systemInfo = JSON.parse(JSON.stringify(options.systemInfo || DEFAULT_SYSTEM_INFO));
    var storageMap = {};
    var canvases = [];
    var callbacks = {
      touchStart: [], touchMove: [], touchEnd: [], touchCancel: [],
      show: [], hide: [], resize: []
    };
    var frameQueue = [];
    var nextFrameId = 1;
    var framesDriven = 0;
    var virtualNow = 1000;
    var frameCap = options.frameCap || 240;

    function fire(list, arg) {
      for (var i = 0; i < list.length; i++) list[i](arg);
    }

    var wx = {
      __isMockWx: true,

      createCanvas: function () {
        var c = createFakeCanvas(canvases.length === 0, options);
        canvases.push(c);
        return c;
      },

      getSystemInfoSync: function () { return JSON.parse(JSON.stringify(systemInfo)); },

      getWindowInfo: function () {
        var w = systemInfo.windowWidth, h = systemInfo.windowHeight;
        return { pixelRatio: systemInfo.pixelRatio, windowWidth: w, windowHeight: h,
                 safeArea: systemInfo.safeArea || { left: 0, top: 0, right: w, bottom: h, width: w, height: h } };
      },

      setStorageSync: function (key, value) {
        if (typeof key !== "string") throw new Error("mock-wx: setStorageSync 的 key 必须是字符串");
        storageMap[key] = String(value);
      },
      getStorageSync: function (key) {
        return Object.prototype.hasOwnProperty.call(storageMap, key) ? storageMap[key] : "";
      },
      removeStorageSync: function (key) { delete storageMap[key]; },
      clearStorageSync: function () { storageMap = {}; },

      onTouchStart: function (cb) { callbacks.touchStart.push(cb); },
      onTouchMove: function (cb) { callbacks.touchMove.push(cb); },
      onTouchEnd: function (cb) { callbacks.touchEnd.push(cb); },
      onTouchCancel: function (cb) { callbacks.touchCancel.push(cb); },
      onShow: function (cb) { callbacks.show.push(cb); },
      onHide: function (cb) { callbacks.hide.push(cb); },
      onWindowResize: function (cb) { callbacks.resize.push(cb); },

      requestAnimationFrame: function (cb) {
        var id = nextFrameId++;
        frameQueue.push({ id: id, cb: cb });
        return id;
      },
      cancelAnimationFrame: function (id) {
        for (var i = 0; i < frameQueue.length; i++) {
          if (frameQueue[i].id === id) { frameQueue.splice(i, 1); return; }
        }
      },
      setPreferredFramesPerSecond: function () { /* noop */ }
    };

    return {
      wx: wx,
      systemInfo: systemInfo,
      storageMap: storageMap,

      setSystemInfo: function (patch) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) systemInfo[k] = patch[k];
      },

      /** 按 kind 派发一个**已经录制好的**数组式触摸事件 */
      emitTouch: function (kind, ev) {
        if (kind === "start") fire(callbacks.touchStart, ev);
        else if (kind === "move") fire(callbacks.touchMove, ev);
        else if (kind === "end") fire(callbacks.touchEnd, ev);
        else if (kind === "cancel") fire(callbacks.touchCancel, ev);
        else throw new Error("mock-wx: 未知触摸类型 " + kind);
      },
      emitShow: function () { fire(callbacks.show); },
      emitHide: function () { fire(callbacks.hide); },
      emitResize: function (res) { fire(callbacks.resize, res || { size: { windowWidth: systemInfo.windowWidth, windowHeight: systemInfo.windowHeight } }); },

      /** 确定性推进 rAF：真正执行排队中的回调（带单次上限，避免死循环刷屏） */
      flushFrames: function (maxFrames) {
        var limit = Math.min(typeof maxFrames === "number" ? maxFrames : frameCap, frameCap);
        var ran = 0;
        while (frameQueue.length > 0 && ran < limit) {
          var item = frameQueue.shift();
          virtualNow += 16;
          framesDriven++;
          ran++;
          item.cb(virtualNow);
        }
        return ran;
      },

      getFramesDriven: function () { return framesDriven; },
      getPendingFrameCount: function () { return frameQueue.length; },
      getCanvasCount: function () { return canvases.length; },
      getScreenCanvas: function () { return canvases[0] || null; },
      getCanvases: function () { return canvases.slice(); },
      getHandlerCounts: function () {
        return {
          touchStart: callbacks.touchStart.length, touchMove: callbacks.touchMove.length,
          touchEnd: callbacks.touchEnd.length, touchCancel: callbacks.touchCancel.length,
          show: callbacks.show.length, hide: callbacks.hide.length, resize: callbacks.resize.length
        };
      },
      snapshotStorage: function () { return JSON.parse(JSON.stringify(storageMap)); }
    };
  }

  // -------------------------------------------------------------------------
  // 手写触摸序列播放器
  // 序列里的每一步都是**显式写死**的（identifier + 坐标），
  // touches / changedTouches 由播放器按微信的真实语义合成：
  //   start  → changedTouches = 本次按下的手指；touches = 按下后的全部手指
  //   move   → changedTouches = 本次移动的手指之一；touches = 全部手指
  //   end    → changedTouches = 本次抬起的手指；  touches = **不含**抬起手指的其余手指
  //   cancel → 同 end
  // -------------------------------------------------------------------------
  function createTouchRecorder(mock) {
    var active = [];
    var log = [];
    var timeStamp = 1000;

    function indexOf(id) {
      for (var i = 0; i < active.length; i++) if (active[i].identifier === id) return i;
      return -1;
    }
    function clone(list) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        out.push({ identifier: list[i].identifier, clientX: list[i].clientX, clientY: list[i].clientY });
      }
      return out;
    }

    return {
      /**
       * @param {string} kind start|move|end|cancel
       * @param {Array<{id:*, x:number, y:number}>} changes 本次发生变化的手指
       * @returns {object} 实际派发出去的事件对象（已冻结现场）
       */
      emit: function (kind, changes) {
        var changed = [];
        for (var i = 0; i < changes.length; i++) {
          var c = changes[i];
          var t = { identifier: c.id, clientX: c.x, clientY: c.y };
          changed.push(t);
          var k = indexOf(c.id);
          if (kind === "start") {
            if (k >= 0) active[k] = t; else active.push(t);
          } else if (kind === "move") {
            if (k >= 0) active[k] = t;
          } else {
            if (k >= 0) active.splice(k, 1);
          }
        }
        timeStamp += 16;
        var ev = {
          touches: clone(active),          // 注意：先做完增删再取快照
          changedTouches: changed,
          timeStamp: timeStamp
        };
        log.push({ kind: kind, ev: JSON.parse(JSON.stringify(ev)) });
        if (mock) mock.emitTouch(kind, ev);
        return ev;
      },
      log: function () { return log.slice(); },
      activeIds: function () {
        var out = [];
        for (var i = 0; i < active.length; i++) out.push(active[i].identifier);
        return out;
      },
      reset: function () { active = []; log = []; }
    };
  }

  var api = {
    __moduleId: MODULE_ID,
    createMockWx: createMockWx,
    createFakeContext: createFakeContext,
    createTouchRecorder: createTouchRecorder,
    DEFAULT_SYSTEM_INFO: DEFAULT_SYSTEM_INFO
  };

  var root = typeof globalThis !== "undefined" ? globalThis : this;
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.__WB_REG__ = root.__WB_REG__ || {};
    root.__WB_REG__[MODULE_ID] = api;
  }
})();
