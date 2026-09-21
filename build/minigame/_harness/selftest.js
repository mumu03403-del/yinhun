/* =============================================================================
 * selftest.js —— 适配层自测套件（同一份代码，浏览器与 Node 都可跑）
 *
 * 分三组：
 *   B*  输入桥单元测试 —— 由**手写录制**的触摸序列驱动，覆盖 R1 的全部语义
 *   P*  平台层测试（wx 侧）—— 用 mock wx 真实执行 platform-wx.js
 *   I*  集成测试 —— 平台层 -> input-bridge -> 游戏核心 全链路，确定性推进
 *
 * 调用方需注入依赖（见文末 createSuite 的 deps 说明），因此本文件既能在
 * _harness/index.html 里被浏览器执行，也能被 _harness/run-node.js 驱动落盘。
 * ========================================================================== */
;(function () {
  "use strict";

  var MODULE_ID = "_harness/selftest.js";
  var SUITE_VERSION = "minigame-adapter-0.1.0";

  function near(a, b, eps) {
    if (typeof a !== "number" || typeof b !== "number") return false;
    return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * 静态扫描前剔除注释。
   * 原因：P07 会扫描源码里是否残留 document / window / localStorage 等浏览器专有对象，
   * 但源码的**说明性注释**本身就会提到这些词（例如 input-bridge.js 的头部写着
   * "本文件不引用 document / window / localStorage"）。不剔除注释会把注释当成真实引用，
   * 产生假阳性——这不是放宽标准，而是让扫描器只检查真正会被执行的代码。
   */
  function stripComments(src) {
    return String(src)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  }

  function createSuite(deps) {
    var results = [];
    var current = null;

    function assert(cond, msg) {
      if (!cond) throw new Error(msg || "断言失败");
    }
    function assertNear(a, b, eps, msg) {
      if (!near(a, b, eps)) {
        throw new Error((msg || "数值不等") + "：期望 " + b + "，实际 " + a);
      }
    }
    function assertEq(a, b, msg) {
      if (a !== b) throw new Error((msg || "取值不等") + "：期望 " + b + "，实际 " + a);
    }

    function test(id, name, fn, opts) {
      return { id: id, name: name, fn: fn, nodeOnly: !!(opts && opts.nodeOnly) };
    }

    // -----------------------------------------------------------------------
    // 构造工具
    // -----------------------------------------------------------------------
    function makeBridge(options) {
      options = options || {};
      var mock = deps.createMockWx(options.mockOptions);
      var platform = deps.platformWx.createPlatformWx(mock.wx);
      var events = { down: [], move: [], up: [], cancel: [] };
      var bridge = deps.inputBridge.createInputBridge({
        platform: platform,
        transform: options.transform || null,
        onDown: function (x, y, m) { events.down.push({ x: x, y: y, meta: m }); },
        onMove: function (x, y) { events.move.push({ x: x, y: y }); },
        onUp: function (x, y, m) { events.up.push({ x: x, y: y, meta: m }); },
        onCancel: function (x, y, m) { events.cancel.push({ x: x, y: y, meta: m }); }
      });
      var rec = deps.createTouchRecorder(mock);
      return { mock: mock, platform: platform, bridge: bridge, events: events, rec: rec };
    }

    function stubPlatform(rect) {
      var handlers = { start: [], move: [], end: [], cancel: [] };
      return {
        registered: handlers,
        getCanvasRect: function () { return rect; },
        onTouchStart: function (cb) { handlers.start.push(cb); },
        onTouchMove: function (cb) { handlers.move.push(cb); },
        onTouchEnd: function (cb) { handlers.end.push(cb); },
        onTouchCancel: function (cb) { handlers.cancel.push(cb); },
        emit: function (kind, ev) {
          for (var i = 0; i < handlers[kind].length; i++) handlers[kind][i](ev);
        }
      };
    }

    /** 造一个「只跑一个 game 实例」的确定性环境 */
    function makeGame(mockOptions) {
      var mock = deps.createMockWx(mockOptions);
      var platform = deps.platformWx.createPlatformWx(mock.wx);
      var game = deps.game.createGame({ platform: platform });
      game.start();
      var rec = deps.createTouchRecorder(mock);
      return { mock: mock, platform: platform, game: game, rec: rec };
    }

    function downCount(env) { return env.game.core.getEvents().filter(function (e) { return e.kind === "down"; }).length; }
    function upCount(env) { return env.game.core.getEvents().filter(function (e) { return e.kind === "up" || e.kind === "up-cancel"; }).length; }

    // -----------------------------------------------------------------------
    // B 组：输入桥（手写录制的触摸序列）
    // -----------------------------------------------------------------------
    var TESTS = [

      test("B01", "单指 start→move→end 依次产出 down/move/up，坐标正确", function () {
        var env = makeBridge();
        var rec = env.rec;
        // —— 手写录制：单指按下 (100,200)，拖到 (130,240)，原地抬起 ——
        rec.emit("start", [{ id: 7, x: 100, y: 200 }]);
        rec.emit("move", [{ id: 7, x: 130, y: 240 }]);
        rec.emit("end", [{ id: 7, x: 130, y: 240 }]);

        assertEq(env.events.down.length, 1, "down 次数");
        assertEq(env.events.move.length, 1, "move 次数");
        assertEq(env.events.up.length, 1, "up 次数");
        assertNear(env.events.down[0].x, 100, 1e-9, "down.x");
        assertNear(env.events.down[0].y, 200, 1e-9, "down.y");
        assertNear(env.events.move[0].x, 130, 1e-9, "move.x");
        assertNear(env.events.move[0].y, 240, 1e-9, "move.y");
        assertNear(env.events.up[0].x, 130, 1e-9, "up.x");
        assertNear(env.events.up[0].y, 240, 1e-9, "up.y");
        assertEq(env.events.up[0].meta.cancel, false, "up 不应带 cancel");
        assertEq(env.bridge.isTracking(), false, "抬手后不应还在跟踪");
        return "down/move/up 各 1 次，坐标 (100,200)/(130,240)/(130,240)";
      }),

      test("B02", "touchend 只读 changedTouches：touches 为空或只剩别的手指时仍取对坐标", function () {
        // 场景 1：单指抬起 —— touches 会变成空数组，读 touches[0] 必然出错
        var env = makeBridge();
        env.rec.emit("start", [{ id: 3, x: 10, y: 20 }]);
        var endEv1 = env.rec.emit("end", [{ id: 3, x: 11, y: 21 }]);
        assertEq(endEv1.touches.length, 0, "touchend 时 touches 应为空数组");
        assertEq(env.events.up.length, 1, "up 次数");
        assertNear(env.events.up[0].x, 11, 1e-9, "up.x");
        assertNear(env.events.up[0].y, 21, 1e-9, "up.y");

        // 场景 2：两根手指，我们跟的是 A；A 抬起时 touches 里只剩 B
        //         若误读 touches[0] 会拿到 B 的坐标 (900,900) —— 这就是必须避开的那类真 BUG
        var env2 = makeBridge();
        env2.rec.emit("start", [{ id: 11, x: 50, y: 60 }]);
        env2.rec.emit("start", [{ id: 22, x: 900, y: 900 }]);
        var endEv2 = env2.rec.emit("end", [{ id: 11, x: 55, y: 65 }]);
        assertEq(endEv2.touches.length, 1, "A 抬起后 touches 只剩 B");
        assertEq(endEv2.touches[0].clientX, 900, "剩余手指确实是 B");
        assertEq(env2.events.up.length, 1, "up 次数");
        assertNear(env2.events.up[0].x, 55, 1e-9, "up.x 必须是 A 的 55，而不是 B 的 900");
        assertNear(env2.events.up[0].y, 65, 1e-9, "up.y 必须是 A 的 65，而不是 B 的 900");
        return "touches 为空 / 只剩别手指两种情况下，up 坐标都取自 changedTouches";
      }),

      test("B03", "拖拽中第二根手指落下 → 不产生额外 down，其 move/end 也被忽略", function () {
        var env = makeBridge();
        var rec = env.rec;
        // —— 手写录制：A 按下 → B 按下 → B 拖动 → B 抬起 → A 拖动 → A 抬起 ——
        rec.emit("start", [{ id: 11, x: 100, y: 200 }]);
        rec.emit("start", [{ id: 22, x: 300, y: 400 }]);
        rec.emit("move", [{ id: 22, x: 320, y: 420 }]);
        rec.emit("end", [{ id: 22, x: 320, y: 420 }]);
        rec.emit("move", [{ id: 11, x: 110, y: 210 }]);
        rec.emit("end", [{ id: 11, x: 110, y: 210 }]);

        assertEq(env.events.down.length, 1, "down 必须只有 1 次（第二根手指不能产生幽灵 down）");
        assertNear(env.events.down[0].x, 100, 1e-9, "down.x 应属于 A");
        assertNear(env.events.down[0].y, 200, 1e-9, "down.y 应属于 A");
        assertEq(env.events.move.length, 1, "move 只有 A 的那次");
        assertNear(env.events.move[0].x, 110, 1e-9, "move.x 应属于 A");
        assertEq(env.events.up.length, 1, "up 只有 A 的那次");
        assertEq(env.bridge.stats.ignoredDown, 1, "被忽略的第二根手指按下");
        assertEq(env.bridge.stats.ignoredMove, 1, "被忽略的 B 移动");
        assertEq(env.bridge.stats.ignoredEnd, 1, "被忽略的 B 抬起");
        return "down=1 move=1 up=1，忽略 down/move/end 各 1";
      }),

      test("B04", "touchcancel → 产出 up 且带 cancel 标记", function () {
        var env = makeBridge();
        env.rec.emit("start", [{ id: 5, x: 60, y: 70 }]);
        env.rec.emit("cancel", [{ id: 5, x: 62, y: 72 }]);
        assertEq(env.events.up.length, 1, "cancel 也必须产出一次 up");
        assertEq(env.events.up[0].meta.cancel, true, "up 应带 cancel 标记");
        assertNear(env.events.up[0].x, 62, 1e-9, "up.x");
        assertEq(env.bridge.isTracking(), false, "打断后不应还在跟踪");
        assertEq(env.events.cancel.length, 1, "onCancel 观测回调应被调用一次");
        return "cancel → up(cancel=true)，tracking 已释放";
      }),

      test("B05", "按住 500ms 不动 → down 立即可得、期间无额外事件、随后 up", async function () {
        var env = makeBridge();
        var t0 = deps.now();
        env.rec.emit("start", [{ id: 9, x: 50, y: 60 }]);
        var latency = deps.now() - t0;

        assertEq(env.events.down.length, 1, "down 必须在 start 当次同步产出（不能被长按判定吃掉）");
        assert(latency < 5, "down 产出延迟应 < 5ms，实际 " + latency + "ms");
        assertEq(env.bridge.isTracking(), true, "按住期间应保持跟踪");

        await sleep(520);                       // 长按判定窗口（满级单位 500ms 结算）

        assertEq(env.events.down.length, 1, "500ms 期间不得多出 down");
        assertEq(env.events.move.length, 0, "500ms 期间不得多出 move");
        assertEq(env.events.up.length, 0, "500ms 期间不得提前 up");

        env.rec.emit("end", [{ id: 9, x: 50, y: 60 }]);
        assertEq(env.events.up.length, 1, "随后应产出 up");
        return "down 同步产出(延迟 " + latency + "ms)，520ms 静默，随后 up";
      }),

      test("B06", "手指抬起后新手指可以重新开始（activeId 正确释放）", function () {
        var env = makeBridge();
        env.rec.emit("start", [{ id: 1, x: 1, y: 2 }]);
        env.rec.emit("end", [{ id: 1, x: 1, y: 2 }]);
        assertEq(env.bridge.isTracking(), false, "第一次手势已结束");
        env.rec.emit("start", [{ id: 2, x: 3, y: 4 }]);
        assertEq(env.events.down.length, 2, "第二次手势应产生第二个 down");
        assertNear(env.events.down[1].x, 3, 1e-9, "第二个 down.x");
        assertNear(env.events.down[1].y, 4, 1e-9, "第二个 down.y");
        assertEq(env.bridge.stats.ignoredDown, 0, "不应有被忽略的 down");
        return "第二次手势正常开始，down 计数 2";
      }),

      test("B07", "clientX/clientY → 画布局部坐标换算（画布不在原点时）", function () {
        // 画布左上角位于屏幕 (30,50)
        var platform = stubPlatform({ left: 30, top: 50, width: 375, height: 812 });
        var events = { down: [] };
        deps.inputBridge.createInputBridge({
          platform: platform,
          onDown: function (x, y) { events.down.push({ x: x, y: y }); }
        });
        var ev = {
          touches: [{ identifier: 1, clientX: 100, clientY: 200 }],
          changedTouches: [{ identifier: 1, clientX: 100, clientY: 200 }]
        };
        platform.emit("start", ev);
        assertEq(events.down.length, 1, "down 次数");
        assertNear(events.down[0].x, 70, 1e-9, "局部 x = 100-30");
        assertNear(events.down[0].y, 150, 1e-9, "局部 y = 200-50");

        // 再叠一层 transform：局部坐标 -> 逻辑坐标
        var p2 = stubPlatform({ left: 0, top: 0, width: 375, height: 812 });
        var d2 = [];
        deps.inputBridge.createInputBridge({
          platform: p2,
          transform: function (lx, ly) { return { x: lx / 2, y: ly / 2 }; },
          onDown: function (x, y) { d2.push({ x: x, y: y }); }
        });
        p2.emit("start", { touches: [{ identifier: 1, clientX: 80, clientY: 120 }],
                           changedTouches: [{ identifier: 1, clientX: 80, clientY: 120 }] });
        assertNear(d2[0].x, 40, 1e-9, "transform 后的 x");
        assertNear(d2[0].y, 60, 1e-9, "transform 后的 y");
        return "局部换算 (100,200)-(30,50)=(70,150)；transform 后 (40,60)";
      }),

      test("B08", "changedTouches 缺失时的抬手兜底：用最后一次已知坐标产出 up", function () {
        var env = makeBridge();
        env.rec.emit("start", [{ id: 4, x: 70, y: 80 }]);
        // 手工构造一个「事件里没带坐标」的异常抬手
        env.mock.emitTouch("end", { touches: [], changedTouches: [] });
        assertEq(env.events.up.length, 1, "仍应产出 up（不能把手指状态永久挂在 tracking 上）");
        assertEq(env.events.up[0].meta.coordFallback, true, "应标记为坐标兜底");
        assertNear(env.events.up[0].x, 70, 1e-9, "兜底 x = 最后一次已知值");
        assertNear(env.events.up[0].y, 80, 1e-9, "兜底 y = 最后一次已知值");
        return "无坐标的 end 仍产出 up(coordFallback=true)，坐标取最后一次已知值";
      }),

      test("B09", "抬起的是别的手指时不产生 up（继续保持跟踪）", function () {
        var env = makeBridge();
        env.rec.emit("start", [{ id: 4, x: 70, y: 80 }]);
        env.rec.emit("start", [{ id: 8, x: 90, y: 100 }]);   // 被忽略
        env.rec.emit("end", [{ id: 8, x: 90, y: 100 }]);     // 抬的不是我们跟的手指
        assertEq(env.events.up.length, 0, "不应产出 up");
        assertEq(env.bridge.isTracking(), true, "应继续保持跟踪");
        env.rec.emit("end", [{ id: 4, x: 71, y: 81 }]);
        assertEq(env.events.up.length, 1, "我们的手指抬起时才产出 up");
        assertNear(env.events.up[0].x, 71, 1e-9, "up.x");
        return "别的手指抬起被忽略，自己的手指抬起才 up";
      }),

      // ---------------------------------------------------------------------
      // P 组：平台层（wx 侧，用 mock wx 真实执行）
      // ---------------------------------------------------------------------
      test("P01", "createCanvas 第一次调用返回上屏画布，getContext('2d') 可用且被缓存", function () {
        var mock = deps.createMockWx();
        var platform = deps.platformWx.createPlatformWx(mock.wx);
        assertEq(mock.getCanvasCount(), 0, "调用前不应创建画布");
        var c1 = platform.createCanvas();
        assertEq(c1.__isScreenCanvas, true, "第一次调用应为上屏画布");
        assertEq(platform.createCanvas(), c1, "createCanvas 应被缓存（同一块画布）");
        var ctx = platform.getContext(c1);
        assert(ctx && ctx.__isFakeContext, "应拿到 2D 上下文");
        assertEq(platform.getContext(c1), ctx, "上下文应被缓存");
        var c2 = mock.wx.createCanvas();
        assertEq(c2.__isScreenCanvas, false, "第二次调用应为离屏画布");
        assertEq(mock.getCanvasCount(), 2, "画布总数");
        return "上屏画布 + 离屏画布判定正确，上下文缓存生效";
      }),

      test("P02", "存储走 wx.setStorageSync / getStorageSync / removeStorageSync", function () {
        var mock = deps.createMockWx();
        var platform = deps.platformWx.createPlatformWx(mock.wx);
        assertEq(platform.storage.get("nope"), null, "未写入时应返回 null（wx 返回空串）");
        assertEq(platform.storage.set("k1", "hello"), true, "写入应成功");
        assertEq(platform.storage.get("k1"), "hello", "读回值");
        assertEq(mock.storageMap.k1, "hello", "确实落在 wx 的存储里");
        assertEq(platform.storage.remove("k1"), true, "删除应成功");
        assertEq(platform.storage.get("k1"), null, "删除后读不到");
        return "set/get/remove 往返正确，且真实穿过 wx 存储 API";
      }),

      test("P03", "生命周期 onShow / onHide 注册后被 mock 触发", function () {
        var mock = deps.createMockWx();
        var platform = deps.platformWx.createPlatformWx(mock.wx);
        var n = { show: 0, hide: 0 };
        platform.onShow(function () { n.show++; });
        platform.onHide(function () { n.hide++; });
        var counts = mock.getHandlerCounts();
        assertEq(counts.show, 1, "应向 wx 注册一个 onShow");
        assertEq(counts.hide, 1, "应向 wx 注册一个 onHide");
        mock.emitShow(); mock.emitHide(); mock.emitHide();
        assertEq(n.show, 1, "show 回调次数");
        assertEq(n.hide, 2, "hide 回调次数");
        return "show=1 hide=2，多次 onHide 都穿透到业务回调";
      }),

      test("P04", "设备信息来自 wx.getSystemInfoSync；上屏画布 rect 恒为原点全屏", function () {
        var mock = deps.createMockWx();
        var platform = deps.platformWx.createPlatformWx(mock.wx);
        var info = platform.getDeviceInfo();
        assertEq(info.pixelRatio, 2, "pixelRatio");
        assertEq(info.windowWidth, 375, "windowWidth");
        assertEq(info.windowHeight, 812, "windowHeight");
        assert(info.safeArea && info.safeArea.height === 812, "safeArea 应存在");
        var rect = platform.getCanvasRect();
        assertEq(rect.left, 0, "上屏画布 left 恒为 0");
        assertEq(rect.top, 0, "上屏画布 top 恒为 0");
        assertEq(rect.width, 375, "rect.width");
        return "pixelRatio=2 / 375x812 / safeArea 就绪；rect 原点全屏";
      }),

      test("P05", "onTouch* 注册后 mock 派发的数组式事件能穿透到回调", function () {
        var mock = deps.createMockWx();
        var platform = deps.platformWx.createPlatformWx(mock.wx);
        var seen = [];
        platform.onTouchStart(function (e) { seen.push(["start", e.changedTouches.length, e.touches.length]); });
        platform.onTouchMove(function (e) { seen.push(["move", e.changedTouches.length, e.touches.length]); });
        platform.onTouchEnd(function (e) { seen.push(["end", e.changedTouches.length, e.touches.length]); });
        platform.onTouchCancel(function (e) { seen.push(["cancel", e.changedTouches.length, e.touches.length]); });
        mock.emitTouch("start", { touches: [{ identifier: 1 }], changedTouches: [{ identifier: 1 }] });
        mock.emitTouch("move", { touches: [{ identifier: 1 }], changedTouches: [{ identifier: 1 }] });
        mock.emitTouch("end", { touches: [], changedTouches: [{ identifier: 1 }] });
        mock.emitTouch("cancel", { touches: [], changedTouches: [{ identifier: 1 }] });
        assertEq(seen.length, 4, "应收到 4 个事件");
        assertEq(seen[2][0], "end", "第 3 个是 end");
        assertEq(seen[2][2], 0, "end 时 touches 长度为 0（真实语义）");
        return "4 类触摸事件全部穿透，touchend 的 touches 为空数组";
      }),

      test("P06", "重复订阅同一类别只向 wx 注册一次（不会叠加回调）", function () {
        var mock = deps.createMockWx();
        var platform = deps.platformWx.createPlatformWx(mock.wx);
        var hits = 0;
        platform.onTouchStart(function () { hits++; });
        platform.onTouchStart(function () { hits++; });
        platform.onTouchStart(function () { hits++; });
        assertEq(mock.getHandlerCounts().touchStart, 1, "wx 侧只应注册 1 个 onTouchStart");
        mock.emitTouch("start", { touches: [], changedTouches: [{ identifier: 1, clientX: 0, clientY: 0 }] });
        assertEq(hits, 3, "3 个业务回调都应被调用一次");
        assertEq(hits, 3, "不应出现重复叠加");
        return "wx 侧注册 1 个，业务回调 3 个各触发 1 次";
      }),

      test("P07", "静态零残留：wx 侧三个文件不含任何 BOM/DOM/Web 存储引用", function () {
        var files = ["game.js", "js/platform-wx.js", "js/input-bridge.js"];
        var patterns = [
          ["浏览器全局对象", /\bwindow\b/],
          ["文档对象", /\bdocument\b/],
          ["Web 存储", /\blocalStorage\b/],
          ["地址栏对象", /\blocation\b/],
          ["DOM 布局测量", /getBoundingClientRect/],
          ["指针捕获", /setPointerCapture/],
          ["DOM 事件绑定", /addEventListener/],
          ["网络请求", /XMLHttpRequest/],
          ["动态执行代码", /\beval\s*\(/],
          ["动态构造函数", /new\s+Function\s*\(/]
        ];
        var hits = [];
        var rawHits = [];
        for (var i = 0; i < files.length; i++) {
          var raw = deps.readFile(files[i]);
          var text = stripComments(raw);
          for (var j = 0; j < patterns.length; j++) {
            var re = new RegExp(patterns[j][1].source, "g");
            var m = text.match(re);
            if (m && m.length) hits.push(files[i] + " 命中 " + patterns[j][0] + " x" + m.length);
            var mr = raw.match(re);
            if (mr && mr.length) rawHits.push(files[i] + " 原始命中 " + patterns[j][0] + " x" + mr.length);
          }
        }
        assertEq(hits.length, 0, "存在 DOM 残留：" + hits.join(" / "));
        return files.length + " 个文件 x " + patterns.length + " 条规则，剔除注释后 0 命中"
          + (rawHits.length
              ? "（未剔除注释时有 " + rawHits.length + " 处命中：" + rawHits.join(" / ") + "，均位于说明性注释中）"
              : "");
      }, { nodeOnly: true }),

      // ---------------------------------------------------------------------
      // I 组：集成（平台层 -> input-bridge -> 核心）
      // ---------------------------------------------------------------------
      test("I01", "boot 后画布像素尺寸与 setTransform 换算正确", function () {
        var env = makeGame();
        var g = env.game;
        var mock = env.mock;
        assertEq(g.view.dpr, 2, "dpr 应被限制为 min(pixelRatio,3)");
        assertNear(g.view.scale, 0.936, 1e-9, "scale = min((375-24)/375,(812-24)/812)");
        assertEq(g.canvas.width, 750, "canvas.width = round(375*2)");
        assertEq(g.canvas.height, 1624, "canvas.height = round(812*2)");
        var screen = mock.getScreenCanvas();
        assertEq(screen.width, 750, "上屏画布宽度应为像素尺寸");
        assertEq(screen.height, 1624, "上屏画布高度应为像素尺寸");
        var st = null;
        for (var i = 0; i < screen.__ctx.calls.length; i++) {
          if (screen.__ctx.calls[i].name === "setTransform") { st = screen.__ctx.calls[i].args; break; }
        }
        assert(st, "应调用过 setTransform");
        assertNear(st[0], 1.872, 1e-9, "setTransform a");
        assertNear(st[4], 24, 1e-6, "setTransform e = dpr*ox");
        assertNear(st[5], 51.968, 1e-6, "setTransform f = dpr*oy");
        assertEq(g.isRunning(), true, "主循环应已启动");
        return "dpr=2 scale=0.936 canvas=750x1624 setTransform=(1.872,0,0,1.872,24,51.968)";
      }),

      test("I02", "单指 tap 经全链路口径到核心，逻辑坐标落在正确格心", function () {
        var env = makeGame();
        var g = env.game;
        var cx = g.core.cellCenterX(0), cy = g.core.cellCenterY(0);   // (47.5, 163)
        var c = g.toClient(cx, cy);
        env.rec.emit("start", [{ id: 1, x: c.clientX, y: c.clientY }]);
        env.rec.emit("end", [{ id: 1, x: c.clientX, y: c.clientY }]);

        var ev = g.core.getEvents().filter(function (e) { return e.kind === "down" || e.kind === "up"; });
        assertEq(ev.length, 2, "应收到 down + up");
        assertEq(ev[0].kind, "down", "第一个是 down");
        assertEq(ev[1].kind, "up", "第二个是 up");
        assertNear(ev[0].x, cx, 1e-6, "核心收到的 down.x 应等于格心逻辑 x");
        assertNear(ev[0].y, cy, 1e-6, "核心收到的 down.y 应等于格心逻辑 y");
        assertEq(g.core.hitCell(ev[0].x, ev[0].y), 0, "命中的应是 0 号格");
        return "屏幕坐标 -> 逻辑坐标往返无损，命中 0 号格 (47.5,163)";
      }),

      test("I03", "R1 验收：down(A) → down(B) → up(A) 不产生幽灵 down/结算", function () {
        var env = makeGame();
        var g = env.game;
        g.core.state.cells[0] = 6;      // 放一个满级单位在 0 号格，用于确认不会被幽灵操作结算
        var a = g.toClient(g.core.cellCenterX(0), g.core.cellCenterY(0));
        var b = g.toClient(g.core.cellCenterX(1), g.core.cellCenterY(1));   // 第二根手指点别处
        env.rec.emit("start", [{ id: 100, x: a.clientX, y: a.clientY }]);
        env.rec.emit("start", [{ id: 200, x: b.clientX, y: b.clientY }]);
        env.rec.emit("end", [{ id: 100, x: a.clientX, y: a.clientY }]);

        assertEq(downCount(env), 1, "核心只应收到 1 次 down");
        assertEq(upCount(env), 1, "核心只应收到 1 次 up");
        assertEq(g.input.stats.ignoredDown, 1, "第二根手指的按下应被忽略");
        assertEq(g.core.getSettleEventCount(), 0, "不应发生幽灵结算");
        assertEq(g.core.state.cells[0], 6, "满级单位应原样留在棋盘上");
        assertEq(g.core.state.settles, 0, "settles 计数应为 0");
        return "down=1 up=1 ignoredDown=1，满级单位未被幽灵操作吃掉";
      }),

      test("I04", "满级单位长按 500ms 经适配层正常结算（不被适配层吃掉）", async function () {
        var env = makeGame();
        var g = env.game;
        g.core.state.cells[0] = 6;
        var c = g.toClient(g.core.cellCenterX(0), g.core.cellCenterY(0));
        env.rec.emit("start", [{ id: 7, x: c.clientX, y: c.clientY }]);
        assertEq(downCount(env), 1, "down 应立即可得");
        var coinsBefore = g.core.state.coins;

        await sleep(560);               // 覆盖 500ms 长按窗口

        assertEq(g.core.getSettleEventCount(), 1, "长按 500ms 应触发 1 次结算");
        assertEq(g.core.state.cells[0], 0, "满级单位应被释放");
        assertEq(g.core.state.settles, 1, "settles 计数");
        var expected = 30 * 243;        // SETTLE_SECONDS * COIN_RATE[5]
        assert(g.core.state.coins - coinsBefore >= expected, "结算金币应 >= " + expected);
        assertEq(downCount(env), 1, "长按期间不得多出 down");

        env.rec.emit("end", [{ id: 7, x: c.clientX, y: c.clientY }]);
        assertEq(upCount(env), 1, "随后应产出 up");
        assertEq(g.core.getSettleEventCount(), 1, "抬起不得二次结算");
        return "长按 560ms → 结算 1 次、格释放、金币 +" + expected + "；抬手不再二次结算";
      }),

      test("I05", "拖拽超过 10px 阈值 → 长按被取消并完成一次合并", function () {
        var env = makeGame();
        var g = env.game;
        g.core.state.cells[0] = 1;
        g.core.state.cells[1] = 1;
        // 注意：cells[1] 是「第 0 行第 1 列」，坐标应为 (cellCenterX(1), cellCenterY(0))，
        // 而非 (cellCenterX(1), cellCenterY(1))（那会是第 1 行第 1 列的空格，自然不会合并）。
        var s = g.toClient(g.core.cellCenterX(0), g.core.cellCenterY(0));
        var m = g.toClient(g.core.cellCenterX(0) + 20, g.core.cellCenterY(0));
        var t = g.toClient(g.core.cellCenterX(1), g.core.cellCenterY(0));
        env.rec.emit("start", [{ id: 3, x: s.clientX, y: s.clientY }]);
        env.rec.emit("move", [{ id: 3, x: m.clientX, y: m.clientY }]);
        env.rec.emit("move", [{ id: 3, x: t.clientX, y: t.clientY }]);
        env.rec.emit("end", [{ id: 3, x: t.clientX, y: t.clientY }]);

        var kinds = g.core.getEvents().map(function (e) { return e.kind; });
        assert(kinds.indexOf("move-threshold") >= 0, "应触发过一次 10px 阈值（并取消长按）");
        assertEq(g.core.state.merges, 1, "应完成 1 次合并");
        assertEq(g.core.state.cells[1], 2, "目标格升为 2 档");
        assertEq(g.core.state.cells[0], 0, "源格应被清空");
        return "阈值触发 + 合并成功：1 档 + 1 档 → 2 档";
      }),

      test("I06", "onHide：静默收起手势 + 走 wx.setStorageSync 落盘", function () {
        var env = makeGame();
        var g = env.game;
        g.core.state.cells[3] = 2;
        g.core.state.coins = 1234;
        var c = g.toClient(g.core.cellCenterX(3), g.core.cellCenterY(0));
        env.rec.emit("start", [{ id: 9, x: c.clientX, y: c.clientY }]);
        assertEq(g.input.isTracking(), true, "切后台前应有一根手指在跟踪");

        env.mock.emitHide();

        assertEq(g.getHiddenCount(), 1, "onHide 应触发");
        assertEq(g.input.isTracking(), false, "切后台应静默收起手势");
        assertEq(g.input.stats.cancel, 1, "应收起到 cancel 分支");
        var raw = env.mock.storageMap["merge_samurai_minigame_v1"];
        assert(raw, "存档应写入 wx 存储");
        var d = JSON.parse(raw);
        assertEq(d.cells[3], 2, "存档中的格子状态");
        assertEq(d.coins, 1234, "存档中的金币");
        return "onHide → 手势收起到 cancel + 存档落盘 (cells[3]=2, coins=1234)";
      }),

      test("I07", "确定性推进 60 帧不抛异常，渲染调用随之增长", function () {
        var env = makeGame();
        var g = env.game;
        var screen = env.mock.getScreenCanvas();
        var before = screen.__ctx.getCallCount();
        var f0 = g.getFrameCount();
        g.step(60, 1 / 60);
        assertEq(g.getFrameCount() - f0, 60, "应推进 60 帧");
        assert(screen.__ctx.getCallCount() > before, "渲染调用数应增长");
        assertEq(screen.__ctx.getDroppedCount(), 0, "记录型上下文不应溢出（说明调用量在预算内）");
        return "60 帧正常渲染，ctx 调用 +" + (screen.__ctx.getCallCount() - before) + " 次";
      }),

      test("I08", "底部安全区（safeArea）参与视图换算，避免 UI 掉进手势条", function () {
        var mock = deps.createMockWx();
        mock.setSystemInfo({ safeArea: { left: 0, top: 0, right: 375, bottom: 780, width: 375, height: 780 } });
        var platform = deps.platformWx.createPlatformWx(mock.wx);
        var g = deps.game.createGame({ platform: platform });
        g.start();
        assertEq(g.view.safeBottom, 32, "底部内缩量 = 812-780");
        assertNear(g.view.oy, 25.984 - 16, 1e-6, "oy 应上移半个内缩量");
        // 输入换算必须与渲染用同一套 view，否则会出现点偏
        var c = g.toClient(0, 0);
        var p = g.transform(c.clientX - 0, c.clientY - 0);
        assertNear(p.x, 0, 1e-6, "逻辑坐标往返 x");
        assertNear(p.y, 0, 1e-6, "逻辑坐标往返 y");
        return "safeBottom=32，oy 上移 16，输入与渲染共用同一 view";
      })

    ];

    // -----------------------------------------------------------------------
    async function run(options) {
      options = options || {};
      var mode = options.mode || "unknown";
      var startedAt = new Date().toISOString();
      var t0 = deps.now();

      for (var i = 0; i < TESTS.length; i++) {
        var t = TESTS[i];
        var rec = { id: t.id, name: t.name, ok: false, skipped: false, detail: "", durationMs: 0 };
        if (t.nodeOnly && !deps.readFile) {
          rec.skipped = true;
          rec.ok = true;
          rec.detail = "浏览器环境无法读源码文件，本条仅在 Node 运行中执行";
          results.push(rec);
          continue;
        }
        var ts = deps.now();
        try {
          rec.detail = await t.fn();
          rec.ok = true;
        } catch (e) {
          rec.ok = false;
          rec.detail = (e && e.message) ? e.message : String(e);
        }
        rec.durationMs = deps.now() - ts;
        results.push(rec);
      }

      var passed = 0, failed = 0, skipped = 0;
      for (var j = 0; j < results.length; j++) {
        if (results[j].skipped) skipped++;
        else if (results[j].ok) passed++;
        else failed++;
      }

      return {
        suite: "minigame-adapter-wx",
        version: SUITE_VERSION,
        mode: mode,
        startedAt: startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: deps.now() - t0,
        total: results.length,
        passed: passed,
        failed: failed,
        skipped: skipped,
        pageErrors: options.pageErrors || [],
        results: results,
        notes: [
          "本套件用 mock wx 真实执行 platform-wx.js，而不是纯静态检查。",
          "本机未安装微信开发者工具，因此真机像素/性能类风险（阴影、渐变、帧率）不在本套件覆盖范围内。"
        ]
      };
    }

    return { run: run, tests: TESTS };
  }

  var api = { __moduleId: MODULE_ID, createSuite: createSuite, SUITE_VERSION: SUITE_VERSION };

  var root = typeof globalThis !== "undefined" ? globalThis : this;
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.__WB_REG__ = root.__WB_REG__ || {};
    root.__WB_REG__[MODULE_ID] = api;
  }
})();
