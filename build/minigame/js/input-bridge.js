/* =============================================================================
 * input-bridge.js —— R1「手势语义差异」的落地方案
 *
 * 问题：微信小游戏的触摸事件是「数组式」的（touches / changedTouches，
 *       每项带 identifier），而游戏核心用的是「单指针」语义（down/move/up）。
 *
 * 本模块把数组式触摸事件转成单指针语义，规则如下（四条硬约束）：
 *   1) 只认第一根手指：用 identifier 记住它，拖拽期间第二根手指落下
 *      **必须被忽略**，不能多出一次 down。
 *   2) start / end 只读 changedTouches。touchend 时 touches 里**不含**抬起
 *      的那根手指，读 touches 会拿到 undefined 或错误坐标。
 *   3) clientX / clientY 先减去画布在屏幕上的位置，换算成「画布局部坐标」；
 *      再由可选的 transform 做一次游戏自己的视图换算（逻辑分辨率）。
 *   4) 拖拽中手指抬起 → up；被系统打断（touchcancel）→ 走 cancel 分支，
 *      但**仍然产出一次 up**（带 cancel 标记），游戏侧按 up 收尾。
 *
 * 本文件不引用 document / window / localStorage，可直接在小游戏运行时执行。
 * ========================================================================== */
;(function () {
  "use strict";

  var MODULE_ID = "js/input-bridge.js";

  function isNum(v) { return typeof v === "number" && isFinite(v); }

  function idOf(touch, fallback) {
    if (touch && touch.identifier !== undefined && touch.identifier !== null) {
      return touch.identifier;
    }
    return fallback;
  }

  function findTouch(list, identifier) {
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t && t.identifier === identifier) return t;
    }
    return null;
  }

  /**
   * @param {object} options
   *   platform  {object} 必填，需提供 onTouchStart/Move/End/Cancel 与 getCanvasRect()
   *   onDown    {function(x, y, meta)}
   *   onMove    {function(x, y)}
   *   onUp      {function(x, y, meta)}  meta.cancel === true 表示是被系统打断的那次
   *   onCancel  {function(x, y, meta)}  可选，仅用于观测（up 已经产出过了）
   *   transform {function(localX, localY) -> {x, y}} 可选，画布局部坐标 -> 游戏逻辑坐标
   *   fallbackIdentifier {*} 触摸项没有 identifier 时使用的占位 id，默认 0
   */
  function createInputBridge(options) {
    options = options || {};
    var platform = options.platform;
    if (!platform) throw new Error("input-bridge: 缺少 platform");

    var onDown = options.onDown || function () {};
    var onMove = options.onMove || function () {};
    var onUp = options.onUp || function () {};
    var onCancel = options.onCancel || null;
    var transform = options.transform || null;
    var fallbackIdentifier = options.fallbackIdentifier !== undefined
      ? options.fallbackIdentifier : 0;

    var activeId = null;          // 正在跟踪的手指 identifier；null 表示当前无人跟踪
    var lastX = 0, lastY = 0;     // 最后一次已知的画布局部坐标（兜底用）
    var stats = {
      down: 0, move: 0, up: 0, cancel: 0,
      ignoredDown: 0, ignoredMove: 0, ignoredEnd: 0, ignoredCancel: 0
    };

    function toPoint(touch) {
      var cx = isNum(touch.clientX) ? touch.clientX : 0;
      var cy = isNum(touch.clientY) ? touch.clientY : 0;
      var rect = null;
      try { rect = platform.getCanvasRect ? platform.getCanvasRect() : null; } catch (e) { rect = null; }
      var left = rect && isNum(rect.left) ? rect.left : 0;
      var top = rect && isNum(rect.top) ? rect.top : 0;
      var lx = cx - left;          // 画布局部坐标
      var ly = cy - top;
      if (transform) {
        var p = transform(lx, ly);
        if (p && isNum(p.x) && isNum(p.y)) return p;
      }
      return { x: lx, y: ly };
    }

    function handleStart(e) {
      var changed = e && e.changedTouches;
      var t = changed && changed.length ? changed[0] : null;
      if (!t) return;                                   // 没有可用的起始手指
      if (activeId !== null) { stats.ignoredDown++; return; }  // 约束 1：只认第一根
      activeId = idOf(t, fallbackIdentifier);
      var p = toPoint(t);                               // 约束 2+3
      lastX = p.x; lastY = p.y;
      stats.down++;
      onDown(p.x, p.y, { id: activeId });
    }

    function handleMove(e) {
      if (activeId === null) return;
      // 只认「本次真的发生变化」的那批手指。微信的 touchmove 里 changedTouches **只包含本次移动的手指**：
      // B 移动而 A 静止时，changedTouches 只有 B。此时若退回 touches 去找 A，就会把 A 的旧坐标当成
      // 一次移动报给核心，产生「幽灵 move」—— 这正是 B03 实测抓到的缺陷（期望 move=1，实际 2）。
      // 仅当 changedTouches 整体缺失或为空时才退回 touches，用来兼容不规范的运行时。
      var changed = e && e.changedTouches;
      var list = (changed && changed.length) ? changed : (e && e.touches);
      var t = findTouch(list, activeId);
      if (!t) { stats.ignoredMove++; return; }           // 动的不是我们跟的那根手指
      var p = toPoint(t);
      lastX = p.x; lastY = p.y;
      stats.move++;
      onMove(p.x, p.y, { id: activeId });
    }

    function handleEnd(e) {
      if (activeId === null) { stats.ignoredEnd++; return; }
      // 约束 2：只从 changedTouches 取抬起的那根手指
      var t = findTouch(e && e.changedTouches, activeId);
      if (!t) {
        // 抬起的是别的手指 → 完全忽略，继续保持跟踪
        if (findTouch(e && e.touches, activeId)) { stats.ignoredEnd++; return; }
        // 我们跟的手指确实不在了，但事件里没带坐标 → 用最后一次已知坐标兜底
        var lostId = activeId;
        activeId = null;
        stats.up++;
        onUp(lastX, lastY, { id: lostId, cancel: false, coordFallback: true });
        return;
      }
      var p = toPoint(t);
      var id = activeId;
      activeId = null;
      lastX = p.x; lastY = p.y;
      stats.up++;
      onUp(p.x, p.y, { id: id, cancel: false });
    }

    function handleCancel(e) {
      if (activeId === null) { stats.ignoredCancel++; return; }
      var t = findTouch(e && e.changedTouches, activeId);
      if (!t) {
        // 被打断的不是我们跟的那根手指 → 忽略
        if (findTouch(e && e.touches, activeId)) { stats.ignoredCancel++; return; }
        // 我们的手指已不在 → 仍按打断处理，用最后已知坐标
      }
      var id = activeId;
      activeId = null;
      var x = lastX, y = lastY;
      if (t) {
        var p = toPoint(t);
        x = p.x; y = p.y;
        lastX = x; lastY = y;
      }
      // 约束 4：cancel 分支仍然产出一次 up
      stats.cancel++;
      stats.up++;
      onUp(x, y, { id: id, cancel: true });
      if (onCancel) onCancel(x, y, { id: id });
    }

    /** 生命周期用：静默收起当前手势（等价于一次打断），不产生额外 down */
    function release(reason) {
      if (activeId === null) return false;
      var id = activeId;
      activeId = null;
      stats.cancel++;
      stats.up++;
      onUp(lastX, lastY, { id: id, cancel: true, reason: reason || "release" });
      if (onCancel) onCancel(lastX, lastY, { id: id, reason: reason || "release" });
      return true;
    }

    platform.onTouchStart(handleStart);
    platform.onTouchMove(handleMove);
    platform.onTouchEnd(handleEnd);
    platform.onTouchCancel(handleCancel);

    return {
      stats: stats,
      handlers: { start: handleStart, move: handleMove, end: handleEnd, cancel: handleCancel },
      isTracking: function () { return activeId !== null; },
      activeId: function () { return activeId; },
      lastPoint: function () { return { x: lastX, y: lastY }; },
      release: release
    };
  }

  var api = {
    __moduleId: MODULE_ID,
    createInputBridge: createInputBridge,
    _findTouch: findTouch,
    _idOf: idOf
  };

  var root = typeof globalThis !== "undefined" ? globalThis : this;
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.__WB_REG__ = root.__WB_REG__ || {};
    root.__WB_REG__[MODULE_ID] = api;
  }
})();
