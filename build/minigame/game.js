/* =============================================================================
 * game.js —— 微信小游戏入口
 *
 * 装配顺序：平台层（wx / h5 自动探测） -> 画布与视图换算 -> input-bridge -> 游戏核心 -> 主循环
 *
 * 关于「游戏核心」：
 *   本文件通过 `boot({ core })` 暴露核心挂载点。传入的 core 需要实现：
 *       onDown(x, y) / onMove(x, y) / onUp(x, y, meta) / update(dt) / render(ctx, dt)
 *       （可选 save() / load()）
 *   若不传 core，则使用内置的 probeCore —— 它是**指针状态机探针**：把
 *   h5-fallback 的输入语义（10px 拖拽阈值、满级单位长按 500ms 结算、
 *   点选两格合并）按同一套规则重写了一遍，用来证明
 *   「平台层 -> input-bridge -> 核心」这条链路真的跑得通。
 *   完整玩法核心的搬迁属于下一阶段工作，不改变本文件对外接口。
 *
 * 约束：本文件不得引用任何 BOM / DOM 对象，否则在小游戏运行时直接白屏。
 * ========================================================================== */
;(function () {
  "use strict";

  var MODULE_ID = "game.js";

  // 逻辑分辨率与布局（与 build/h5-fallback/index.html 完全一致）
  var W = 375;
  var H = 812;
  var GRID_COLS = 5;
  var GRID_ROWS = 4;
  var MAX_TIER = 6;
  var GRID_GAP = 8;
  var CELL = 62;
  var GRID_W = GRID_COLS * CELL + (GRID_COLS - 1) * GRID_GAP;   // 342
  var GRID_H = GRID_ROWS * CELL + (GRID_ROWS - 1) * GRID_GAP;   // 272
  var GRID_X = (W - GRID_W) / 2;
  var GRID_Y = 132;
  var COIN_RATE = [1, 3, 9, 27, 81, 243];
  var LONG_PRESS_MS = 500;
  var SETTLE_SECONDS = 30;
  var SAVE_KEY_DEFAULT = "merge_samurai_minigame_v1";

  function globalRoot() {
    if (typeof GameGlobal !== "undefined" && GameGlobal) return GameGlobal;
    if (typeof globalThis !== "undefined" && globalThis) return globalThis;
    if (typeof global !== "undefined" && global) return global;
    return {};
  }

  /** 跨端 require：浏览器里走 __WB_REG__ 注册表，小游戏/Node 里走 CommonJS */
  function req(path) {
    var key = String(path).replace(/^\.\//, "");
    var reg = globalRoot().__WB_REG__;
    if (reg && reg[key]) return reg[key];
    if (typeof require === "function") return require(path);
    throw new Error("game.js: 模块未注册 " + path);
  }

  function cellCenterX(c) { return GRID_X + c * (CELL + GRID_GAP) + CELL / 2; }
  function cellCenterY(r) { return GRID_Y + r * (CELL + GRID_GAP) + CELL / 2; }
  function idx(r, c) { return r * GRID_COLS + c; }

  // ===========================================================================
  // 内置探针核心
  // ===========================================================================
  function createProbeCore(opts) {
    opts = opts || {};
    var storage = opts.storage || null;
    var saveKey = opts.saveKey || SAVE_KEY_DEFAULT;
    var defer = opts.setTimeout || setTimeout;
    var cancelDefer = opts.clearTimeout || clearTimeout;

    var state = {
      cells: new Array(GRID_COLS * GRID_ROWS).fill(0),
      coins: 0,
      merges: 0,
      spawns: 0,
      settles: 0,
      highestTier: 1
    };
    var pointer = { down: false, startX: 0, startY: 0, moved: false, cell: -1, settled: false };
    var press = { i: -1, t: 0, timer: null };
    var selected = -1;
    var saveTimer = 0;
    var frames = 0;
    var settleEvents = 0;
    var events = [];            // 输入流水，供自测断言（有上限，不会无限增长）
    var EVENT_CAP = 400;

    function record(kind, x, y, extra) {
      if (events.length >= EVENT_CAP) return;
      events.push({ kind: kind, x: x, y: y, extra: extra || null });
    }

    function coinsPerSecond() {
      var sum = 0;
      for (var i = 0; i < state.cells.length; i++) {
        var t = state.cells[i];
        if (t > 0) sum += COIN_RATE[t - 1];
      }
      return sum;
    }

    function hitCell(x, y) {
      for (var r = 0; r < GRID_ROWS; r++) {
        for (var c = 0; c < GRID_COLS; c++) {
          var cx = cellCenterX(c), cy = cellCenterY(r);
          if (x >= cx - CELL / 2 && x <= cx + CELL / 2 &&
              y >= cy - CELL / 2 && y <= cy + CELL / 2) return idx(r, c);
        }
      }
      return -1;
    }

    function handleTap(i) {
      if (i < 0) return;
      if (state.cells[i] === 0) { selected = -1; return; }
      if (selected < 0) { selected = i; return; }
      if (selected === i) { selected = -1; return; }
      if (state.cells[selected] === state.cells[i] && state.cells[i] < MAX_TIER) {
        state.cells[i] += 1;
        state.cells[selected] = 0;
        state.merges++;
        if (state.cells[i] > state.highestTier) state.highestTier = state.cells[i];
        selected = -1;
        return;
      }
      selected = i;
    }

    function settleValue(tier) { return SETTLE_SECONDS * COIN_RATE[tier - 1]; }

    function cancelPress() {
      if (press.timer) { cancelDefer(press.timer); press.timer = null; }
      press.i = -1;
      press.t = 0;
    }

    function startPress(i) {
      cancelPress();
      if (state.cells[i] !== MAX_TIER) return;      // 只有满级单位才启动长按
      press.i = i;
      press.t = 0;
      press.timer = defer(function () {
        press.timer = null;
        var target = press.i;
        press.i = -1;
        press.t = 0;
        if (target >= 0 && state.cells[target] === MAX_TIER) {
          state.coins += settleValue(MAX_TIER);
          state.cells[target] = 0;
          state.settles++;
          settleEvents++;
          pointer.settled = true;                   // 压住本次 up，避免再被当成点选
        }
      }, LONG_PRESS_MS);
    }

    function onDown(x, y) {
      record("down", x, y);
      cancelPress();
      pointer.down = true;
      pointer.startX = x; pointer.startY = y;
      pointer.moved = false;
      pointer.settled = false;
      var i = hitCell(x, y);
      pointer.cell = (i >= 0 && state.cells[i] > 0) ? i : -1;
      if (pointer.cell >= 0) startPress(pointer.cell);
    }

    function onMove(x, y) {
      if (!pointer.down) return;
      var dx = x - pointer.startX, dy = y - pointer.startY;
      if (!pointer.moved && (dx * dx + dy * dy) > 100) {     // 10px 阈值
        pointer.moved = true;
        cancelPress();                                       // 一旦拖动就取消长按
        record("move-threshold", x, y);
        return;
      }
      record("move", x, y);
    }

    function onUp(x, y, meta) {
      var cancelled = !!(meta && meta.cancel);
      record(cancelled ? "up-cancel" : "up", x, y);
      if (!pointer.down) return;
      pointer.down = false;
      if (pointer.settled) {                                 // 本次手势已被长按消费
        pointer.settled = false;
        cancelPress();
        pointer.cell = -1;
        return;
      }
      cancelPress();
      if (cancelled) { pointer.cell = -1; return; }           // 被系统打断：收尾但不结算点选
      if (pointer.moved) {
        var target = hitCell(x, y);
        if (target >= 0 && target !== pointer.cell && pointer.cell >= 0 &&
            state.cells[target] > 0 && state.cells[target] === state.cells[pointer.cell] &&
            state.cells[target] < MAX_TIER) {
          state.cells[target] += 1;
          state.cells[pointer.cell] = 0;
          state.merges++;
          if (state.cells[target] > state.highestTier) state.highestTier = state.cells[target];
          selected = -1;
        }
        pointer.cell = -1;
        return;
      }
      if (pointer.cell >= 0) handleTap(pointer.cell);
      pointer.cell = -1;
    }

    function update(dt) {
      var cps = coinsPerSecond();
      if (cps > 0) state.coins += cps * dt;
      if (press.i >= 0) press.t += dt * 1000;
      saveTimer += dt;
      if (saveTimer >= 2) { saveTimer = 0; save(); }
      frames++;
    }

    function render(ctx) {
      ctx.fillStyle = "#0b0b14";
      ctx.fillRect(0, 0, W, H);
      for (var r = 0; r < GRID_ROWS; r++) {
        for (var c = 0; c < GRID_COLS; c++) {
          var tier = state.cells[idx(r, c)];
          var x = cellCenterX(c) - CELL / 2, y = cellCenterY(r) - CELL / 2;
          ctx.fillStyle = tier > 0 ? "#3498db" : "rgba(255,255,255,0.05)";
          ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
        }
      }
      ctx.fillStyle = "#f7d774";
      ctx.font = "700 26px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.floor(state.coins)), 48, 39);
    }

    function save() {
      if (!storage) return false;
      try {
        storage.set(saveKey, JSON.stringify({
          v: 1, cells: state.cells, coins: state.coins, highestTier: state.highestTier,
          merges: state.merges, spawns: state.spawns, settles: state.settles, time: Date.now()
        }));
        return true;
      } catch (e) { return false; }
    }

    function load() {
      if (!storage) return false;
      var raw = storage.get(saveKey);
      if (!raw) return false;
      var d = null;
      try { d = JSON.parse(raw); } catch (e) { return false; }
      if (!d || !d.cells || d.cells.length !== state.cells.length) return false;
      for (var i = 0; i < d.cells.length; i++) {
        state.cells[i] = Math.max(0, Math.min(MAX_TIER, Math.floor(Number(d.cells[i]) || 0)));
      }
      state.coins = Number(d.coins) || 0;
      state.highestTier = Math.max(1, Number(d.highestTier) || 1);
      state.merges = Number(d.merges) || 0;
      state.spawns = Number(d.spawns) || 0;
      state.settles = Number(d.settles) || 0;
      return true;
    }

    return {
      kind: "probe",
      state: state,
      pointer: pointer,
      press: press,
      layout: { W: W, H: H, COLS: GRID_COLS, ROWS: GRID_ROWS, CELL: CELL, GRID_X: GRID_X, GRID_Y: GRID_Y },
      constants: { MAX_TIER: MAX_TIER, LONG_PRESS_MS: LONG_PRESS_MS, SETTLE_SECONDS: SETTLE_SECONDS, COIN_RATE: COIN_RATE },
      onDown: onDown,
      onMove: onMove,
      onUp: onUp,
      update: update,
      render: render,
      save: save,
      load: load,
      coinsPerSecond: coinsPerSecond,
      hitCell: hitCell,
      cellCenterX: cellCenterX,
      cellCenterY: cellCenterY,
      settleValue: settleValue,
      getSettleEventCount: function () { return settleEvents; },
      getFrameCount: function () { return frames; },
      getEvents: function () { return events.slice(); },
      getSelected: function () { return selected; }
    };
  }

  // ===========================================================================
  // 装配
  // ===========================================================================
  function detectPlatform() {
    if (typeof wx !== "undefined" && wx && typeof wx.createCanvas === "function") {
      return req("js/platform-wx.js").createPlatformWx(wx);
    }
    return req("js/platform-h5.js").createPlatformH5();
  }

  function createGame(opts) {
    opts = opts || {};
    var platform = opts.platform || detectPlatform();
    var canvas = platform.createCanvas();
    var ctx = platform.getContext(canvas);
    var view = { scale: 1, ox: 0, oy: 0, dpr: 1, safeBottom: 0 };
    var saveKey = opts.saveKey || SAVE_KEY_DEFAULT;
    var core = opts.core || createProbeCore({ storage: platform.storage, saveKey: saveKey });
    var running = false;
    var rafId = null;
    var lastFrame = 0;
    var frames = 0;

    function safeBottomInset(info) {
      var sa = info && info.safeArea;
      if (!sa || typeof sa.height !== "number") return 0;
      return Math.max(0, (info.windowHeight || 0) - (sa.height + (sa.top || 0)));
    }

    function resize() {
      var info = platform.getDeviceInfo();
      var dpr = Math.min(info.pixelRatio || 1, 3);
      var vw = info.windowWidth, vh = info.windowHeight;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      var pad = 12;
      var scale = Math.min((vw - pad * 2) / W, (vh - pad * 2) / H);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      var inset = safeBottomInset(info);
      view.dpr = dpr;
      view.scale = scale;
      view.ox = (vw - W * scale) / 2;
      view.oy = (vh - H * scale) / 2 - inset / 2;   // R4：底部安全区上移半个内缩量
      view.safeBottom = inset;
      if (typeof ctx.setTransform === "function") {
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * view.ox, dpr * view.oy);
      }
      if (typeof platform.syncCanvasCssSize === "function") platform.syncCanvasCssSize();
      return view;
    }

    /** 画布局部坐标 -> 游戏逻辑坐标（input-bridge 的 transform 钩子） */
    function transform(localX, localY) {
      return { x: (localX - view.ox) / view.scale, y: (localY - view.oy) / view.scale };
    }

    /** 游戏逻辑坐标 -> 画布/屏幕坐标（自测派发触摸用） */
    function toClient(x, y) {
      var rect = platform.getCanvasRect ? platform.getCanvasRect() : { left: 0, top: 0 };
      return { clientX: (rect.left || 0) + view.ox + x * view.scale,
               clientY: (rect.top || 0) + view.oy + y * view.scale };
    }

    var inputCancelLog = [];
    var hiddenCount = 0;
    var shownCount = 0;

    var input = req("js/input-bridge.js").createInputBridge({
      platform: platform,
      transform: transform,
      onDown: function (x, y) { core.onDown(x, y); },
      onMove: function (x, y) { core.onMove(x, y); },
      onUp: function (x, y, meta) { core.onUp(x, y, meta); },
      onCancel: function (x, y, meta) { inputCancelLog.push({ x: x, y: y, meta: meta }); }
    });

    platform.onHide(function () {
      hiddenCount++;
      input.release("onHide");                 // 切后台：静默收起手势，避免回前台时状态残留
      try { if (core.save) core.save(); } catch (e) { /* 存档失败不应打断生命周期 */ }
    });
    platform.onShow(function () { shownCount++; });
    platform.onResize(function () { resize(); });

    function loop(ts) {
      if (!running) return;
      var t = (typeof ts === "number" && isFinite(ts) ? ts : platform.now()) / 1000;
      var dt = lastFrame ? Math.min(0.1, t - lastFrame) : 0;
      lastFrame = t;
      if (core.update) core.update(dt);
      if (core.render) core.render(ctx, dt);
      frames++;
      rafId = platform.raf(loop);
    }

    function start() {
      if (running) return api;
      running = true;
      resize();
      if (core.load) core.load();
      lastFrame = 0;
      rafId = platform.raf(loop);
      return api;
    }

    function stop() {
      running = false;
      if (rafId !== null && platform.caf) platform.caf(rafId);
      rafId = null;
      return api;
    }

    /** 确定性地推进 n 帧（自测用，不依赖 rAF） */
    function step(n, dt) {
      var d = typeof dt === "number" ? dt : 1 / 60;
      var count = typeof n === "number" ? n : 1;
      for (var i = 0; i < count; i++) {
        if (core.update) core.update(d);
        if (core.render) core.render(ctx, d);
        frames++;
      }
      return frames;
    }

    var api = {
      platform: platform,
      canvas: canvas,
      ctx: ctx,
      view: view,
      core: core,
      input: input,
      resize: resize,
      transform: transform,
      toClient: toClient,
      start: start,
      stop: stop,
      step: step,
      isRunning: function () { return running; },
      getFrameCount: function () { return frames; },
      getHiddenCount: function () { return hiddenCount; },
      getShownCount: function () { return shownCount; },
      getInputCancelLog: function () { return inputCancelLog.slice(); }
    };
    return api;
  }

  function boot(opts) { return createGame(opts).start(); }

  var api = {
    __moduleId: MODULE_ID,
    boot: boot,
    createGame: createGame,
    createProbeCore: createProbeCore,
    detectPlatform: detectPlatform,
    layout: { W: W, H: H, COLS: GRID_COLS, ROWS: GRID_ROWS, CELL: CELL, GRID_X: GRID_X, GRID_Y: GRID_Y },
    constants: { MAX_TIER: MAX_TIER, LONG_PRESS_MS: LONG_PRESS_MS, SETTLE_SECONDS: SETTLE_SECONDS, COIN_RATE: COIN_RATE },
    saveKeyDefault: SAVE_KEY_DEFAULT
  };

  var root = globalRoot();
  root.__minigameAdapter = api;
  root.__WB_REG__ = root.__WB_REG__ || {};

  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
    if (!root.__WB_NO_AUTOBOOT__) root.__autoBootGame = boot();   // Node 里由测试显式控制
  } else {
    root.__WB_REG__[MODULE_ID] = api;
    if (!root.__WB_NO_AUTOBOOT__) {
      // 自动引导失败必须「响」，不能被静默吞掉（否则会出现 pageErrors 为空但游戏其实没起来）
      root.__autoBootGame = boot();
    }
  }
})();
