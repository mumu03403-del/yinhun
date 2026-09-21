# 微信小游戏移植技术评估报告

| 项 | 值 |
|---|---|
| 评估问题 | 这个纯 Canvas 的 H5 游戏，改造成微信小游戏需要做什么、工作量多大、有哪些致命风险？能不能替代 Cocos 成为开发主线？ |
| 评估对象（Evidence Baseline） | `build/h5-fallback/index.html` — 33,258 字节 / 960 行 / sha256 `6070ce9552da6efe…` / mtime 2026-09-20 11:10 UTC |
| 对照物 | `build/publish/index.html` — 26,483 字节 / sha256 `6710ac4bcd2e5995…`（**已上线的那一份，比被评估对象旧一版**，见 §7 附带发现） |
| 评估方式 | 只读代码 + 官方文档核对（微信开放文档 / 小游戏 Quick Start、渲染、代码包、配置）。**未运行任何微信环境**——本机未安装微信开发者工具，理由见 §5 |
| 约束声明 | 本报告只新增 `docs/` 目录内的文件；未修改、未删除任何现有文件；未执行 git 操作 |

---

## ① 结论先行（给产品负责人，20 秒版）

**建议走路线 A：把 H5 定为开发主线，在它外面加一层微信小游戏适配。**

三句话说清为什么：

1. **这游戏的画面是自己用代码一笔一笔画出来的**（Canvas 2D 即时模式：每帧擦掉整屏、重画一遍），不依赖任何网页控件、不依赖图片素材、不依赖外部脚本。微信小游戏**原生支持**这套画法——官方《快速开始》的示例代码就是 `wx.createCanvas()` 之后 `getContext('2d')`。所以**画面部分不用重写**，改的是"从哪拿到画布""手指点在哪"这类接口名字。

2. **改造量是可数的、不是玄学**：全文 960 行里，需要触碰约 **150–200 行（16%–21%）**；其中只有 **3 处需要重写逻辑**（触摸手势、清空存档、清档确认框），**约 700 行玩法和渲染代码零改动**。**没有任何一处会阻断整个路线**（无致命风险）。

3. **最关键的是"谁来验证"**：现在的 H5 版本，团队自己就能在浏览器里跑、自己就能证明对不对（已有 29 项自动化测试 29/29 通过）。而 **Cocos 在本机既构建不了也验证不了**（登录服务器连不上 + 没有显卡渲染环境），选 Cocos 就等于**把"能不能构建、有没有 BUG"全部压到您本机那台 Cocos 编辑器上**。选 H5，您只需要做一件事：**装一次微信开发者工具，扫一眼真机效果**。

**一句话**：路线 A 把您的工作量压缩成"装一次工具 + 看一次真机"；路线 B 把您变成团队里唯一能构建、唯一能验证的人。

---

## ② H5 技术依赖清单（精确行号）

### 2.1 先给个好消息：外部依赖为零

对文件做了穷举扫描，以下**全部为 0 次出现**：

| 检查项 | 命中数 | 说明 |
|---|---|---|
| `<script src=…>` 外部脚本 | 0 | 脚本是内联的（L24–L958），无任何 CDN/库 |
| `<link>` / `url(…)` 外部样式与资源 | 0 | 样式全部内联（L9–L20） |
| `<img>` / `.src=` 图片 | 0 | 美术 100% 为代码绘制的纯色块（L31 注释亦声明） |
| `new Audio` / `AudioContext` | 0 | **本作完全没有音频**（所以音频适配工作量为 0） |
| `fetch` / `XMLHttpRequest` / `WebSocket` | 0 | 无网络请求，纯离线单机 |
| `require(` / `import` | 0 | 无模块系统，单文件 IIFE |
| `eval(` / `new Function` | 0 | ✅ 关键：微信小游戏**禁用动态执行代码**，本作未使用，天然合规 |

**这一条价值很高**：意味着没有资源打包、没有加载器、没有分包需求、没有音频权限，改造面被压缩到"接口调用"这一层。

### 2.2 必须改的调用点（共 30 处，逐条列行号）

**A. 浏览器全局对象 `window` / `document` —— 小游戏环境不存在这两个对象**

微信官方《适配层》文档原文：*"iOS 上小游戏的运行环境是 JavaScriptCore，Android 上是 V8。两个环境都不提供 BOM 和 DOM，即没有全局的 `document` 和 `window` 对象。"*

| # | 行号 | 现有写法 | 性质 |
|---|---|---|---|
| 1 | L23 | `<canvas id="cv"></canvas>` HTML 标签 | 小游戏没有 HTML 文档 |
| 2 | L270 | `document.getElementById('cv')` | 无 DOM |
| 3 | L271 | `cv.getContext('2d')` | 依赖上一行拿到的元素 |
| 4 | L275 | `window.devicePixelRatio` | 无 BOM |
| 5 | L276 | `window.innerWidth` / `window.innerHeight` | 无 BOM |
| 6 | L279–280 | `cv.style.width = …` / `cv.style.height = …` | 无 CSSOM |
| 7 | L290 | `window.addEventListener('resize', resize)` | 无 BOM |
| 8 | L291 | `window.addEventListener('orientationchange', …)` | 无 BOM |
| 9 | L294 | `cv.getBoundingClientRect()` | 无 DOM 布局 |
| 10 | L318 | `cv.addEventListener('pointerdown', …)` | 无 DOM 事件 |
| 11 | L320 | `cv.setPointerCapture(ev.pointerId)` | 无指针捕获机制 |
| 12 | L341 | `window.confirm('确定要清空存档…')` | ⚠️ 且是**同步返回**语义 |
| 13 | L352 | `cv.addEventListener('pointermove', …)` | 无 DOM 事件 |
| 14 | L366 | `cv.addEventListener('pointerup', …)` | 无 DOM 事件 |
| 15 | L397 | `cv.addEventListener('pointercancel', …)` | 无 DOM 事件 |
| 16 | L403 | `cv.addEventListener('contextmenu', …)` | 小游戏无右键菜单 |
| 17 | L405 | `document.addEventListener('visibilitychange', …)` | 无 DOM |
| 18 | L406 | `document.hidden` | 无 DOM |
| 19 | L408 | `window.addEventListener('pagehide', save)` | 无 BOM |
| 20 | L409 | `window.addEventListener('beforeunload', save)` | 无 BOM |
| 21 | L157 | `location.reload()` | ⚠️ 小游戏无地址栏、无页面重载概念 |
| 22 | L903 | `window.__gameReady = true` | 测试钩子 |
| 23 | L908 | `window.__game = { … }` | 测试钩子（L908–L954，供自动化断言） |
| 24 | L920 | `window.__gameReady === true` | 测试钩子 |
| 25 | L951 | `cv.getBoundingClientRect()`（`toClient`，测试用） | 无 DOM 布局 |

**B. 本地存储 `localStorage` —— 小游戏无 Web Storage**

| # | 行号 | 现有写法 | 用途 |
|---|---|---|---|
| 26 | L109 | `localStorage.setItem(SAVE_KEY, …)` | 存档写入 |
| 27 | L125 | `localStorage.getItem(SAVE_KEY)` | 读档 |
| 28 | L156 | `localStorage.removeItem(SAVE_KEY)` | 清档 |
| 29 | L745 | `localStorage.getItem(SAVE_KEY)` | 底部文案"自动存档已开启/尚无存档" |

**C. CSS 样式表整体失效（非 JS，但不处理会导致画面尺寸全错）**

| # | 行号 | 内容 | 在小游戏的命运 |
|---|---|---|---|
| 30 | L9–L20 | `<style>` 块：`html,body{margin/width/height/background/overflow}`、`-webkit-tap-highlight-color`、`user-select`、`-webkit-touch-callout`、`font-family` 字体栈、`#cv{display:block;width:100%;height:100%;touch-action:none}` | 全部失效。其中 `width/height:100%`、`overflow:hidden` 这两条**必须用 JS 逻辑替代**（小游戏画布默认即全屏，需自行按屏幕尺寸设画布宽高） |

**D. `<meta>` 标签（L5–L7）**：viewport / apple-mobile-web-app-capable / theme-color —— 全部失效。竖屏方向改为由 `game.json` 的 `deviceOrientation: "portrait"` 声明（官方配置项，默认值就是 portrait，本作恰好匹配）。

### 2.3 天然兼容、无需改动的部分

| 能力 | 行号 | 说明 |
|---|---|---|
| `requestAnimationFrame` | L892, L904 | 小游戏官方《快速开始》明确列出提供了 `setInterval / setTimeout / requestAnimationFrame / clearInterval / clearTimeout / cancelAnimationFrame` |
| `setTimeout` / `clearTimeout`（长按计时） | L252, L264 | 可用。⚠️ 但小游戏**禁止把代码字符串传给第一个参数**，本作传的是函数对象（`setTimeout(function(){…}, 500)`），合规 |
| 手写主循环 + 手动 `dt` 积分 | L886–L893, L866–L884 | 本作**不依赖任何引擎的时间系统**，自己算帧间隔；小游戏无需改动这套循环结构 |
| Canvas 2D 绘图指令 | L415–L443, L514–L863 等 | `beginPath/moveTo/arcTo/arc/fill/stroke/fillRect/clearRect/save/restore/globalAlpha/textAlign/textBaseline/font/fillText` 等，官方称"小游戏基本上支持 2d 和 WebGL 1.0 所有的属性和方法" |
| ES 语法 | L81 `new Array().fill(0)`、L899 `.every()`、`JSON`、`Math` | JSCore / V8 均支持 ES6+ |
| 资源体积 | 全文 | **26–33 KB**。微信小游戏限制为「主包 ≤ 4 MB，主包+分包总计 ≤ 30 MB」——**体积完全不是问题，余量 100 倍以上** |

### 2.4 需要"真机确认"的渲染子集缺口（不阻断，但影响观感）

这几项在文档里属于"支持"，但社区有**真机上不生效**的历史反馈（2018–2022，微信官方社区帖；官方回复前后矛盾：2022 年有运营专员称"现在应该都支持了"，但同月仍有开发者反馈真机阴影不显示）。**不能凭文档下结论，必须真机看一次。**

| 行号 | 用法 | 若真机不生效的后果 |
|---|---|---|
| L515 | `createLinearGradient` 背景渐变 | 背景变成纯色，画面变平 |
| L523 | `createRadialGradient` 顶部柔光 | 顶部光晕消失 |
| L621 | `createLinearGradient` 单位色块渐变 | 方块变成纯色 |
| L616–L618, L627–L629 | `shadowColor` / `shadowBlur` / `shadowOffsetY` | 方块与按钮失去阴影；**且这是性能大户** |
| L438 | `ctx.font` 里写了 CSS 字体栈（`-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`） | 字体串若解析失败会回落到默认字体，文字宽度/位置略有偏移（低风险，建议改成 `sans-serif` 单字体） |

---

## ③ H5 API → 微信小游戏 API 映射表

以下每个目标 API 均已核对官方文档，**非凭记忆**（来源列在表后）。

| H5 现有用法（行号） | 微信小游戏对应写法 | 改动性质 | 备注 |
|---|---|---|---|
| `<canvas id="cv">`（L23） | **删除**。小游戏无 HTML | 删 | 入口是 `game.js` + `game.json` |
| `document.getElementById('cv')`（L270） | `var cv = wx.createCanvas()` | 替换 | **约定：整个运行期第一次调用 `wx.createCanvas()` 返回的是"上屏画布"**（与屏幕等宽等高），之后调用返回离屏画布。本作只需要一块画布，天然契合 |
| `cv.getContext('2d')`（L271） | `var ctx = cv.getContext('2d')` | **不变** | 官方《快速开始》示例即对上屏画布取 2d 上下文。注意：同一块画布取过 `'2d'` 后不能再取 `'webgl'` |
| `window.devicePixelRatio`（L275） | `wx.getSystemInfoSync().pixelRatio` | 替换 | 另有新版拆分接口 `wx.getWindowInfo()`（基础库 2.20.1+）可取 `pixelRatio / windowWidth / windowHeight / safeArea` |
| `window.innerWidth / innerHeight`（L276） | `wx.getSystemInfoSync().windowWidth / .windowHeight` | 替换 | `game.json` 里 `showStatusBar: false`（默认）时，窗口即全屏 |
| `cv.style.width/height = …`（L279–280） | **删除**，只保留 `cv.width = Math.round(vw * dpr)` / `cv.height = …` | 删 | 上屏画布本身就是全屏，没有 CSS 尺寸概念。官方提示：改 `canvas.width/height` 会清空画布内容并**重置渲染上下文**——本作 `resize()` 里紧随其后就调 `ctx.setTransform(...)`，顺序天然正确 |
| `cv.getBoundingClientRect()`（L294） | **删除该调用**，直接用 `ev.clientX / ev.clientY` | 删（简化） | 小游戏画布永远在原点 (0,0) 且全屏，`r.left`/`r.top` 恒为 0，换算公式里这两项可以直接去掉 |
| `cv.addEventListener('pointerdown')`（L318） | `wx.onTouchStart(function (e) { … })` | 替换 | 见 §4.3 手势状态机重写 |
| `cv.setPointerCapture(ev.pointerId)`（L320） | **无对应 API，删除** | 删 | 小游戏触摸事件是全局的、且自带多指数组，不需要也不存在"捕获" |
| `cv.addEventListener('pointermove')`（L352） | `wx.onTouchMove(function (e) { … })` | 替换 | |
| `cv.addEventListener('pointerup')`（L366） | `wx.onTouchEnd(function (e) { … })` | 替换 | ⚠️ 语义差异：抬手时 `e.touches` 为空数组，必须读 `e.changedTouches[0]` |
| `cv.addEventListener('pointercancel')`（L397） | `wx.onTouchCancel(function (e) { … })` | 替换 | 对应来电/弹窗打断 |
| `cv.addEventListener('contextmenu')`（L403） | **删除** | 删 | 小游戏无右键 |
| `window.addEventListener('resize' / 'orientationchange')`（L290–291） | `wx.onWindowResize(function (res) { … })`；竖屏方向由 `game.json` 的 `deviceOrientation: "portrait"` 锁定 | 替换 | 锁竖屏后可视为常量，`resize()` 主要用途变成"启动时算一次布局" |
| `document.addEventListener('visibilitychange')` + `document.hidden`（L405–406） | `wx.onHide(save)` / `wx.onShow(…)` | 替换 | |
| `window.addEventListener('pagehide' / 'beforeunload', save)`（L408–409） | `wx.onHide(save)` | 替换 | 两者在小游戏里是同一个事件 |
| `window.confirm(…)`（L341） | 方案一：`wx.showModal({ …, success: function (res) { if (res.confirm) resetAll(); } })`；**方案二（推荐）**：用本作已有的自绘弹窗体系（`modal` / `drawModal`，L822–837）做一个"确认清档"弹窗 | ⚠️ **逻辑重写** | `confirm` 是**同步阻塞并返回布尔值**，`wx.showModal` 是**异步回调**。原代码写的是 `if (window.confirm(...)) resetAll();`，直接换成 `showModal` 会导致 `success` 回调执行时函数已经返回——**必须改成回调/状态机结构**。方案二还能顺手统一视觉风格、并让这段逻辑在浏览器里也能被自动化测试覆盖 |
| `location.reload()`（L157） | **无对应 API**，改为**纯内存重置**：清 cells 数组、coins/merges/spawns/settles 归零、`anim`/`floats`/`toast`/`modal`/`selected`/`drag` 全部复位，然后重绘 | ⚠️ **逻辑重写** | 小游戏不是网页，没有"重新加载"这件事。原代码用 `suppressSave`（L104, L155）防回写的那套技巧，在内存重置方案下**可以整段删掉**（反而更简单、更不容易出 BUG） |
| `localStorage.setItem`（L109） | `wx.setStorageSync(SAVE_KEY, JSON.stringify({…}))` | 替换 | 签名：`wx.setStorageSync(key, data)`；存储上限 10 MB/用户/小游戏 |
| `localStorage.getItem`（L125, L745） | `wx.getStorageSync(SAVE_KEY)` | 替换 | |
| `localStorage.removeItem`（L156） | `wx.removeStorageSync(SAVE_KEY)` | 替换 | 另有 `wx.clearStorageSync()`（清全部，本作只有 1 个 key，等价） |
| `window.__gameReady` / `window.__game`（L903, L908–954, L920） | 挂到 **`GameGlobal`** 上：`GameGlobal.__game = { … }` | 替换 | 小游戏没有 `window`，官方提供的全局对象叫 **`GameGlobal`**（"所有全局定义的变量都是 GameGlobal 的属性"）。**建议保留这套测试钩子**——它是复用现有 29 项测试的唯一入口，见 §5 |
| `requestAnimationFrame`（L892, L904） | `requestAnimationFrame` | **不变** | 官方基础库直接提供。可选优化：`wx.setPreferredFramesPerSecond(60)` 锁帧 |
| `setTimeout` / `clearTimeout`（L252, L264） | `setTimeout` / `clearTimeout` | **不变** | 禁止传代码字符串（本作没传） |
| 音频 | —— | **无工作量** | 本作没有任何音频。将来要加则用 `wx.createInnerAudioContext()` |
| 页面生命周期/首屏 | —— | **新增** | `game.js`（唯一入口）+ `game.json`（`{"deviceOrientation":"portrait","showStatusBar":false}`）+ `project.config.json` |

**官方文档来源（已核对）**
- 小游戏《快速开始》—— `wx.createCanvas` / `getContext('2d')` / 上屏与离屏画布约定 / `wx.onTouchStart|Move|End|Cancel` / `requestAnimationFrame` 等计时 API / **无 window，改用 GameGlobal** / 上传文件类型白名单
  `https://developers.weixin.qq.com/minigame/dev/` 与英文版 `https://developers.weixin.qq.com/minigame/en/dev/`
- 《适配层》—— "iOS 是 JavaScriptCore、Android 是 V8，均无 BOM 与 DOM" `https://developers.weixin.qq.com/minigame/dev/guide/base-ability/`
- 《渲染》—— 只有一个上屏画布；`wx.setPreferredFramesPerSecond` 锁帧 `https://developers.weixin.qq.com/minigame/dev/guide/base-ability/render.html`
- 《代码包》—— 主包 ≤ 4 MB、总计 ≤ 30 MB、文件后缀白名单（**注意：`.html` 不在白名单内**） `https://developers.weixin.qq.com/minigame/dev/guide/base-ability/code-package.html`
- 《小游戏配置》—— `game.json` 的 `deviceOrientation` / `showStatusBar` `https://developers.weixin.qq.com/minigame/dev/reference/configuration/app.html`
- 存储 —— `wx.setStorageSync/getStorageSync/removeStorageSync/clearStorageSync`，上限 10 MB `https://developers.weixin.qq.com/minigame/dev/api/`
- 生命周期 —— `wx.onShow` / `wx.onHide`（亦见上《API 索引》页）
- `wx.getSystemInfoSync` 返回 `pixelRatio` / `windowWidth` / `windowHeight` / `safeArea`，以及新版 `wx.getWindowInfo` `https://developers.weixin.qq.com/minigame/dev/api/`
- `wx.showModal`（异步，`success(res)` 里看 `res.confirm`） `https://developers.weixin.qq.com/miniprogram/dev/api/ui/interaction/wx.showModal.html`
- 触摸事件对象字段 `touches` / `changedTouches` / `identifier` / `clientX` / `clientY` `https://developers.weixin.qq.com/miniprogram/dev/framework/view/tap`

---

## ④ 工作量与风险判定

### 4.1 工作量：按"改动点数量 + 涉及行数"清点（不用人天估）

| 类别 | 数量 | 涉及行数 | 说明 |
|---|---|---|---|
| **简单替换**（改名字，一行换一行） | **22 处** | 约 **40 行** | 上表全部"替换"类：canvas 获取、dpr/窗口尺寸、6 个事件监听的注册、4 处存储读写、3 处 window 全局 |
| **直接删除**（删掉即可，无替代） | **6 处** | 约 **10 行** | L23 canvas 标签、L279–280 样式尺寸、L294 里的 rect 取法、L320 指针捕获、L403 右键菜单、整套 L104/L155 的 `suppressSave` 防回写技巧 |
| **逻辑重写**（不能一行换一行） | **3 处** | 约 **80 行** | ① 触摸状态机（L316–L402，约 60 行）② 清档（L154–L158 `resetAll` → 内存重置，约 10 行）③ 清档确认（L340–L343 `confirm` → 自绘确认弹窗，约 10 行） |
| **新增文件** | **3 个** | 约 **50 行** | `game.js`（入口 + 适配层装配）、`game.json`、`project.config.json` |
| **合计** | **31 个改动点** | **约 150–200 行** | 占全文 960 行的 **16%–21%** |
| **零改动** | —— | **约 700 行** | 全部玩法逻辑（L160–L267 合并/结算/长按）、全部绘制代码（L411–L863）、主循环结构（L865–L893） |

**关于"是否需要重写渲染循环"——明确回答：不需要。**
理由有三条硬证据：
1. 微信小游戏上屏画布**支持 `getContext('2d')`**，官方《快速开始》示例就是 `wx.createCanvas().getContext('2d')` 后直接 `fillRect`；
2. 本作的渲染是**手写即时模式**（L848–L863 每帧 `clearRect` 后全量重画），**不依赖引擎的场景图、不依赖 CSS 布局、不依赖 DOM 测量**，所以"渲染层"和"平台层"本来就是分开的；
3. 主循环是自实现的 `requestAnimationFrame` + 手动 `dt`（L886–L893），而小游戏**直接提供全局 `requestAnimationFrame`**。
→ 所以改造是**「替换平台调用 + 重写输入层」**，不是**「重写渲染」**。

### 4.2 有没有致命风险（会让整条路走不通的）？

**判定：没有。** 逐项核对了任务书点名的四个可能致命项：

| 可能致命项 | 判定 | 依据 |
|---|---|---|
| 微信小游戏是否只支持 WebGL、不支持纯 Canvas 2D？ | ❌ **不成立，不是风险** | 上屏画布 `getContext('2d')` 是官方文档中的标准用法；官方原文"小游戏基本上支持 2d 和 WebGL 1.0 所有的属性和方法"。→ 改造是**替换 API**，不是**重写渲染** |
| 包体限制会不会卡住？ | ❌ **不成立，完全不卡** | 文件 26–33 KB vs 主包上限 4 MB → **余量约 120 倍**。且无任何图片/音频资源需要塞进去 |
| 首屏加载会不会慢？ | ❌ **不成立，反而是优势** | 无网络请求、无外部资源、单文件代码。对比 Cocos 产物的引擎运行时（通常数 MB 级）+ 资源清单加载，H5 方案首屏是"打开即玩"级别 |
| 竖屏适配会不会有问题？ | ⚠️ **有，但不是致命，是"要处理"** | `game.json` 里 `deviceOrientation: "portrait"` 锁竖屏即可。**但有一处需要补**：本作底部"重置存档"按钮在 L77 定位到 `y = H - 62`（=750），文案在 `H - 22`（=790），在刘海屏/带 Home Indicator 的机型上会贴到系统手势区。**需要用 `safeArea` 做一次底部内缩**（`wx.getWindowInfo().safeArea`，基础库 2.7.0+ 提供）。这是 **10 行以内**的适配，属于"必须做但不难" |
| `wx.onTouch*` 与 pointer events 的语义差异 | ⚠️ **有，且这是最需要认真对待的一项 → 见 4.3** | |

### 4.3 最大的真实风险：手势层的语义差异（这是唯一可能产生"真 BUG"的地方）

**现状（浏览器）**：L316 维护一个**单指针状态机** `pointer = { down, startX, startY, moved, cell, settled }`，配合 L320 的 `setPointerCapture` 把这一次触摸"锁"在这块画布上。整套逻辑默认"同一时刻只有一根手指"，且 10px 阈值（L357）区分点选与拖拽、L358 一旦拖动就取消长按。

**移植到小游戏后**：事件变成全局的 `wx.onTouchStart/Move/End/Cancel`，回调参数是**数组**（`e.touches` 是屏上所有仍按住的手指，`e.changedTouches` 是本次变化的手指；每个手指带 `identifier`）。**不存在** pointer capture 这种"这次触摸归我"的概念。

**如果不做处理，会出的真 BUG**（这些不是观感问题，是功能问题）：
- **抬手事件取错对象**：`onTouchEnd` 时 `e.touches` 是空数组，若照搬 `e.touches[0]` 会读到 `undefined` → 直接抛异常或"抬手没反应"，合并/结算全部失灵。
- **多指产生幽灵操作**：第二根手指按下会**再次触发** `onTouchStart`，把 `pointer.down`、`startX/startY`、`pointer.cell` 全部覆盖。玩家两指同时点两个同档方块时，可能出现**预期外的合并**或**满级单位被意外长按结算**（损失金币）。
- **长按计时器被跨手指污染**：L252 的长按 `setTimeout` 只记 `press.i`，不记手指身份；多指场景下会出现"手指 A 抬起、手指 B 的按下被当成 A 的长按结果"。

**必须做的处理（这就是"重写 60 行"的内容）**：
1. 用一个 `activeId` 只跟踪**第一根手指**的 `identifier`（其余手指的 `changedTouches` 直接忽略）；`onTouchEnd` / `onTouchCancel` 里比对 `identifier`，不匹配就丢弃。
2. 坐标一律从 `changedTouches[0].clientX / clientY` 取，**绝不从 `e.touches` 取**。
3. 长按计时器同时绑定 `identifier`，`cancelPress()` 一并清掉。
4. 删掉 `setPointerCapture`，等价语义改由第 1 条的 `activeId` 提供。

**验证方式**：这三类 BUG **都可以在"无微信环境"下被抓出来**——用打桩的多指事件序列喂给移植后的代码即可（见 §5）。这是本报告建议的**强制门槛项**。

### 4.4 风险清单汇总

| 编号 | 风险 | 等级 | 会不会阻断上线 | 缓解手段 | 能否本地验证 |
|---|---|---|---|---|---|
| R1 | 多指手势状态机语义差异（4.3） | **高（真 BUG 风险）** | 不会阻断，但不处理会出功能 BUG | 加 `activeId` 单指过滤 + 只读 `changedTouches` | ✅ 可（打桩多指事件） |
| R2 | Canvas 2D 的 `shadow*` / `createLinearGradient` / `createRadialGradient` 在真机历史上不生效（L515/L523/L616–618/L621/L627–629） | **中（观感降级）** | 不会 | 代码里已有 `shade()`（L445–458）能算纯色，准备"无阴影/无渐变"降级分支 | ⚠️ 只能真机看（打桩验证不了像素） |
| R3 | `shadowBlur` 在中低端机上开销大（本作每帧全量重绘 + 每方块带阴影） | **中（性能）** | 不会 | `wx.setPreferredFramesPerSecond(60)` 锁帧；或真机掉帧时降级阴影 | ⚠️ 只能真机测 |
| R4 | 底部 UI 侵入 Home Indicator 区（L77 / L746） | **低** | 不会 | 用 `safeArea` 做底部内缩 | ⚠️ 只能真机看 |
| R5 | `ctx.font` 字体栈（L438）解析失败导致字宽偏移 | **低** | 不会 | 简化为 `sans-serif` | ⚠️ 只能真机看 |
| R6 | `wx.showModal` 异步化后清档流程的时序 bug（L341） | **低** | 不会 | 用自绘确认弹窗，绕开异步语义 | ✅ 可（状态断言） |

**结论：无 A 级（阻断性）风险。R1 必须在移植阶段就修掉，R2/R3/R4/R5 属于"必须真机看一次"的观感类收尾项。**

---

## ⑤ 验证可行性（诚实回答）

### 5.1 本机现状：**无法做微信环境验证**——这一点不编

已实测确认（`ls` 三个可能路径，均无结果）：

| 检查位置 | 结果 |
|---|---|
| `C:\Program Files (x86)\Tencent\` | 只有 Androws / QQMusic / UpdateSvr，**无微信开发者工具** |
| `C:\Program Files\Tencent\` | 只有 Androws / WeMeet / WeType / Weixin（微信客户端），**无开发者工具** |
| `%LOCALAPPDATA%\微信web开发者工具\` | 不存在 |

且沙箱无外网（Cocos Creator 的 CLI 构建就是因为 `Failed to connect to login server: socket hang up` 失败的），**无法下载安装微信开发者工具**。本机也没有 GPU/GL 环境（`FATAL:gles2_cmd_decoder.cc(2961) Validating command decoder is not supported`）。

**所以必须明确说清：**
- ❌ **做不了**：真机/模拟器的**像素级**验证（阴影、渐变到底显不显示）→ R2。
- ❌ **做不了**：真机**性能/手感**验证（帧率、触摸跟手度）→ R3。
- ❌ **做不了**：`wx.showModal`、`wx.onHide`、`wx.getStorageSync` 等 **wx API 的真实行为**验证（能验证的是"我们调用得对不对"，不是"微信实现得对不对"）。
- ❌ **做不了**：小游戏上传/审核链路。
- ✅ **能做**（下面 5.2 是三件真实有效的部分验证）。

**即：不存在"不装微信开发者工具也能完整验证"的路径。任何声称能的说法都是假的。** 完整的验证终点只有一条：**在您本机装微信开发者工具 → 导入项目目录 → 真机预览一次**。

### 5.2 但在拿到开发者工具之前，团队能做的三件真实验证（有实际价值）

**验证 V1 —— 静态兼容性断言（机器可查、可复现）**
用 `Grep` 对移植后的产物做"零残留"断言：`\bwindow\b`、`\bdocument\b`、`localStorage`、`location\.`、`getBoundingClientRect`、`setPointerCapture`、`addEventListener` **命中数必须为 0**。
→ **能抓出**：所有"忘了改的 DOM 引用"（这类问题在真机上表现为**直接白屏/首帧报错**，是最常见的移植事故）。这是当前环境下置信度最高的一道门。

**验证 V2 —— `wx` 打桩的无头冒烟测试（Node 22 已就绪，已实测 `node -v` = v22.22.2）**
写一个约 60 行的 `wx-stub`：`createCanvas()` 返回假 canvas（`getContext('2d')` 返回一个把所有绘图调用记录进数组的假 ctx）、`getSystemInfoSync()` 返回 `{pixelRatio:2, windowWidth:375, windowHeight:812, safeArea:{…}}`、`setStorageSync/getStorageSync` 用内存 Map、`onTouchStart/Move/End/Cancel` 只把回调存进数组（不自动触发，测试自己按序喂事件）。
然后 `require` 移植后的 `game.js`（用一个 5 行的 `GameGlobal` 垫片），断言：
- 加载不抛异常、`rAF` 循环能推进 N 帧不出错；
- **多指事件序列**：按序喂 `down(A) → down(B) → up(A)`，断言**没有发生第二次状态覆盖、没有幽灵合并、没有幽灵结算** ← **这正是 R1 的验收点**；
- 纯逻辑断言（见 V3 的清单）全部通过；
- 清档后不再依赖 `location.reload()`，状态确实归零。
→ **能抓出**：R1（多指 BUG）、R6（清档时序）、以及所有残留 DOM 引用导致的运行期异常。**抓不出**：R2/R3/R4/R5（像素与性能）。

**验证 V3 —— 复用现有 29 项自动化测试（29/29 已通过，证据 `build/_evidence/selftest_result.json`）**
对 29 项逐条分类（已清点）：

| 分类 | 条数 | 移植后处置 |
|---|---|---|
| **与浏览器无关的纯逻辑断言** | **13 条** | **零改动直接复用**。例：网格 5×4=20（#3）、开局 6 个 1 档（#4）、cps=6（#5）、两个 6 档不能合并（#16）、3 个 3 档 cps=27（#18）、离线 2 小时 = 97200（#22）、离线 48 小时封顶 = 388800（#24）、合成计数（#8/#11）、最高档位（#9）、长时间无异常（#28）、连续合成不断循环（#29） |
| **依赖浏览器环境的断言** | **16 条** | 断言**内容不变**，只需把驱动方式从"派发 DOM 指针事件 / 刷新页面 / 读写 localStorage"改成"喂 wx 打桩的多指事件序列 / 直接调 `GameGlobal.__game` 上的方法 / 走 `wx.setStorageSync`"。对应 #1/#2（视口与加载就绪）、#7/#10/#12/#13/#15/#25（点击类）、#17（存档）、#19/#20/#21/#26/#27（刷新与清档）、#23（弹窗） |

→ **结论：29 项测试一项都不会丢**，其中 13 项原样可跑，16 项改驱动方式。这是"主线放 H5"最被低估的价值：**它把已有测试资产完整带到新平台**，而 Cocos 路线因为根本构建不出来，这 29 项在新平台上一条都用不上。

### 5.3 必须由产品负责人完成的一次性验证（无法转移）

| 步骤 | 谁做 | 为什么不能由团队代替 |
|---|---|---|
| 1. 安装微信开发者工具 | 您 | 需要扫码登录微信账号；沙箱无外网且无安装权限 |
| 2. 导入小游戏项目目录、点"编译" | 您 | 需要登录态 |
| 3. 点"预览"、手机扫码真机看一眼 | 您 | 真机预览依赖您的手机与微信账号 |
| 4. 看一眼清单：阴影/渐变是否显示（R2）、滚动是否跟手/掉帧（R3）、底部按钮是否被手势条挡住（R4） | 您 | 只有真机能回答这 3 个问题 |

**预计占用您的时间：一次性安装 + 每次改版看一眼真机。** 团队负责把"编译前就该对的东西"全部在 V1/V2/V3 三道门里卡住，让您看到的不是半成品。

---

## ⑥ 建议

### 6.1 明确结论（二选一）

> **路线 A：H5 为主线 + 加一层微信小游戏适配 → 可行（推荐）**
>
> - 渲染层**零重写**（微信小游戏上屏画布支持 `getContext('2d')`）；
> - 31 个改动点 / 约 150–200 行 / 约 700 行不动；
> - **无阻断性风险**；唯一必须认真做的是手势层单指化（R1）；
> - 团队**能自验证**：V1 静态断言 + V2 wx 打桩无头测试 + V3 复用 29 项测试 → **可以在没有微信环境的条件下证明"逻辑没坏、API 改对了"**；
> - 剩余的观感/性能验证收敛为**您本机的一次真机预览**。
>
> **路线 B：坚持 Cocos → 代价是团队永久失去自验证能力（不建议）**
>
> - 本机 Cocos Creator 3.8.8 CLI **构建本身就跑不通**，两个硬阻塞都是环境级的、不是代码级的：
>   ① 需连 Cocos 账号服务器（`Failed to connect to login server: socket hang up`），沙箱无外网；
>   ② 无 GPU/GL（`FATAL:gles2_cmd_decoder.cc(2961) Validating command decoder is not supported`）。
>   `build/web-mobile/` **从未生成过**。
> - 后果不是"慢一点"，而是：**任何一次改动（改个数值、修个 BUG）都必须您本机打开 Cocos Creator 编辑器来构建**；团队既不能构建、也不能跑测试、也不能给出"已验证"的证据。已有 29 项自动化测试**在 Cocos 路线下一条都用不上**。
> - 沉没成本目前很低：`assets/src/` 下只有 **7 个 `.ts` 文件 + 1 个场景文件**，尚未形成"改不动"的规模。**现在切换是成本最低的时刻。**
> - 公平地说一句 Cocos 的好话：如果这个游戏将来要做复杂骨骼动画、粒子特效、可视化的关卡/动画编辑器、多平台（抖音/OV 小游戏）批量发布，Cocos 的长期上限更高。**但那是在团队能构建、能验证的前提下才有意义的上限。** 现在的瓶颈不是"引擎能力不够"，而是"在这台机器上根本构建不出东西"。

### 6.2 落地顺序建议（若采纳路线 A）

| 阶段 | 内容 | 完成标志 | 谁验证 |
|---|---|---|---|
| P0（今天可做） | 把 H5 单文件重构为**一份源码 + 薄平台层**：`platform.browser.js` 与 `platform.wx.js` 各提供 `getCanvas/getCtx/getWindowInfo/storage/touch/lifecycle`；游戏主体只调平台层，不直接碰 `window`/`wx` | 浏览器版功能与现在**完全一致**，29/29 依然全过 | **团队（浏览器）** |
| P1 | 落地 `game.js` / `game.json` / `project.config.json` + `platform.wx.js`；按 §3 映射表逐条替换；**重点修 R1 手势单指化** | V1 静态断言全 0 命中 + V2 wx 打桩冒烟全过（含多指序列） | **团队（无微信环境）** |
| P2 | `safeArea` 底部内缩（R4）、`ctx.font` 收敛为 `sans-serif`（R5）、`wx.setPreferredFramesPerSecond(60)`（R3）、阴影/渐变降级开关（R2） | 代码就位，等真机看 | **团队** |
| P3 | **一次性真机预览**：装工具 → 编译 → 真机看一眼 → 按 §5.3 的四项清单反馈 | 真机可玩、顺畅、无 BUG（您的验收标准） | **您** |

> 为什么 P0 这一步值得单独做：它让**浏览器版和小游戏版永远同源**。以后每改一个玩法，团队在浏览器里跑一遍 29 项测试就能确定"逻辑没坏"，您那边只需要偶尔看一眼真机——**验证责任被合理分摊，而不是全部压在您身上**。

### 6.3 附带发现（需要 team-lead 处理，非本报告结论）

| 发现 | 证据 | 建议 |
|---|---|---|
| **`build/publish/index.html`（已上线的那一份）比被评估的 `build/h5-fallback/index.html` 旧一版** | publish = 26,483 B / sha256 `6710ac4bcd2e5995…` / mtime 11:03 UTC；fallback = 33,258 B / sha256 `6070ce9552da6efe…` / mtime 11:10 UTC（版本号 `h5-fallback-1.1.0`，含 T-007 三项修复） | **线上玩家看到的是修复前的版本。** 需确认是否要把 T-007 修复重新发布上线，否则"已上线版"与"已测通过版"不是同一个东西 |
| 任务书写的是"26KB 单文件 / 770 行" | 实际被评估对象是 **33,258 字节 / 960 行**（T-007 修复后增长） | 报告已按实测数据编写；若对外引用体积/行数请用实测值 |
| `.html` 不在微信小游戏可上传文件后缀白名单内 | 官方《代码包》白名单：`js/json/png/jpg/…`，**无 html** | 移植产物必须是 `game.js` + `game.json`，**不能把 index.html 直接丢进去**。P1 的产物形态已按此设计 |
| `game.js` 需作为一个入口整体存在 | 小游戏约定根目录 `game.js` 为入口 | 单文件 H5 的 IIFE 主体可以直接搬进 `game.js`，无需引入 `weapp-adapter`（官方明确说明 adapter 不是基础库的一部分、且模拟不全，本作零 DOM 需求，**自写 50 行薄适配层比引入 adapter 更可控**） |

---

*本报告为只读评估。未修改、未删除任何现有文件；未新增 `docs/` 以外的任何文件；未执行 git 操作。*
