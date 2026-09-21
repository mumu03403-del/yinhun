/* =============================================================================
 * run-node.js —— 适配层自测的 Node 驱动
 *
 * 作用：在**不依赖微信开发者工具、不依赖浏览器**的前提下，用 mock wx 真实执行
 *       platform-wx.js / input-bridge.js / game.js，并把结果落盘为证据。
 *
 * 用法：node _harness/run-node.js
 * 产出：_evidence/selftest_wx.json
 *
 * 两个关键点（改动时注意保留）：
 *   1. 必须在 require("game.js") **之前**设置 globalThis.__WB_NO_AUTOBOOT__ = true，
 *      否则 game.js 会在模块加载时自动 boot，而 Node 里没有 document/window，会直接抛错。
 *   2. deps.readFile 的路径是**相对 minigame 根目录**的（selftest.js 里写的是
 *      "game.js" / "js/platform-wx.js" 这种相对路径），所以必须在此处拼接根目录。
 * ========================================================================== */
"use strict";

globalThis.__WB_NO_AUTOBOOT__ = true;

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var HERE = __dirname;
var MINIGAME_ROOT = path.resolve(HERE, "..");
var PROJECT_ROOT = path.resolve(MINIGAME_ROOT, "..", "..");
var EVIDENCE_DIR = path.join(MINIGAME_ROOT, "_evidence");
var OUT_FILE = path.join(EVIDENCE_DIR, "selftest_wx.json");

// 冻结保护：线上已在跑的两个文件，适配层工作绝不能碰它们
var FROZEN = [
  path.join(PROJECT_ROOT, "build", "h5-fallback", "index.html"),
  path.join(PROJECT_ROOT, "build", "publish", "index.html")
];

var pageErrors = [];
process.on("uncaughtException", function (e) {
  pageErrors.push(String((e && e.stack) || e));
});
process.on("unhandledRejection", function (e) {
  pageErrors.push("unhandledRejection: " + String((e && e.stack) || e));
});

function sha256File(p) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch (e) {
    return "UNREADABLE: " + String(e && e.message);
  }
}

// 微信小游戏的 require 是「相对项目根」解析的（例如 require("js/input-bridge.js")），
// 而 Node 会把这种裸标识符当成 node_modules 查找并抛 MODULE_NOT_FOUND。
// 因此在加载 game.js 之前打一层补丁：原生解析失败时，退回按 minigame 根目录解析。
var Module = require("module");
var origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return origResolveFilename.call(this, request, parent, isMain, options);
  } catch (err) {
    var candidate = path.join(MINIGAME_ROOT, request);
    if (fs.existsSync(candidate)) return candidate;
    throw err;
  }
};

var mockWx = require(path.join(HERE, "mock-wx.js"));
var selftest = require(path.join(HERE, "selftest.js"));
var platformWx = require(path.join(MINIGAME_ROOT, "js", "platform-wx.js"));
var inputBridge = require(path.join(MINIGAME_ROOT, "js", "input-bridge.js"));
var game = require(path.join(MINIGAME_ROOT, "game.js"));

var deps = {
  createMockWx: mockWx.createMockWx,
  createTouchRecorder: mockWx.createTouchRecorder,
  platformWx: platformWx,
  inputBridge: inputBridge,
  game: game,
  now: function () { return Date.now(); },
  readFile: function (rel) { return fs.readFileSync(path.join(MINIGAME_ROOT, rel), "utf8"); }
};

var frozenBefore = FROZEN.map(sha256File);

selftest
  .createSuite(deps)
  .run({ mode: "node", pageErrors: pageErrors })
  .then(function (report) {
    var frozenAfter = FROZEN.map(sha256File);
    var frozenIntact =
      frozenBefore.length === frozenAfter.length &&
      frozenBefore.every(function (h, i) { return h === frozenAfter[i]; });

    report.frozenGuard = {
      expectedSha256: "e6d9b32c122e99023f97a2c4834b5f223278afdb3a3a1d83aa9379cab2208f54",
      files: FROZEN.map(function (p, i) {
        return {
          path: path.relative(PROJECT_ROOT, p).replace(/\\/g, "/"),
          sha256Before: frozenBefore[i],
          sha256After: frozenAfter[i]
        };
      }),
      expectBothFilesIdentical: frozenAfter[0] === frozenAfter[1],
      allMatchExpected: frozenAfter.every(function (h) {
        return h === "e6d9b32c122e99023f97a2c4834b5f223278afdb3a3a1d83aa9379cab2208f54";
      }),
      intact: frozenIntact
    };

    try { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); } catch (e) { /* 已存在 */ }
    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");

    var lines = [];
    lines.push("总计 " + report.total + " / 通过 " + report.passed + " / 失败 " + report.failed + " / 跳过 " + report.skipped);
    lines.push("pageErrors: " + report.pageErrors.length);
    lines.push("冻结文件未被污染: " + (frozenIntact ? "是" : "否"));
    for (var i = 0; i < report.results.length; i++) {
      var r = report.results[i];
      if (!r.ok) lines.push("  [FAIL] " + r.id + " " + r.name + " -> " + r.detail);
      if (r.skipped) lines.push("  [SKIP] " + r.id + " " + r.name + " -> " + r.detail);
    }
    lines.push("证据: " + path.relative(PROJECT_ROOT, OUT_FILE).replace(/\\/g, "/"));
    console.log(lines.join("\n"));

    process.exitCode = (report.failed === 0 && frozenIntact) ? 0 : 1;
  })
  .catch(function (e) {
    console.log("驱动自身异常: " + String((e && e.stack) || e));
    process.exitCode = 1;
  });
