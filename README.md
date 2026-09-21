# 银魂风 MERGE + IDLE 微信小游戏（原型脚手架）

> 极速原型 / Fast Prototype。引擎：**Cocos Creator 3.x**（默认；详见末尾“引擎切换成本”）。
> **美术全部为占位（纯色/图形/程序生成），不含任何银魂或第三方版权素材。**

## 核心循环（已实现最小可玩）

1. **合并网格 (Merge)**：5×4 网格，点选两个**同档位**单位 → 合并为下一档（最高 6 档）。
2. **放置收益 (Idle)**：每个单位按档位每秒产出金币，HUD 实时显示，每秒结算一次。
3. **图鉴入口 (Collection)**：顶栏“图鉴”按钮打开面板；合并升档达到阈值即解锁一张占位角色卡（合并出 2 档解锁第 1 张，依此类推）。
4. **招募 +1**：顶栏下方按钮，在随机空格放置 1 档单位（原型免费，用于快速试玩合并）。

## 目录结构

```
game/
├── project.json                 # Cocos Creator 工程标识
├── tsconfig.json                # TypeScript 配置
├── package.json
├── settings/                    # program / project / builder（可空，编辑器会自动补全）
│   ├── program.json
│   ├── project.json
│   └── builder.json             # 含微信小游戏平台占位配置
└── assets/
    ├── src/
    │   ├── scenes/
    │   │   ├── Main.scene        # 极简场景：Canvas + Camera + GameRoot(Bootstrap)
    │   │   └── Main.scene.meta
    │   ├── scripts/
    │   │   ├── Bootstrap.ts      # 入口：运行时挂载 GameManager
    │   │   ├── GameManager.ts    # 总控：构建 UI、idle tick、连接合并与图鉴
    │   │   ├── MergeGrid.ts      # 网格数据与合并逻辑
    │   │   ├── UnitView.ts       # 单格视图（Graphics 绘制）
    │   │   ├── Hud.ts            # 顶栏：金币 / 图鉴按钮 / 招募按钮
    │   │   └── CollectionPanel.ts# 图鉴面板
    │   └── data/
    │       └── GameConfig.ts     # 全部可调参数（档位/颜色/产出/角色名）
    └── (脚本对应的 .meta 已生成)
```

> 整个游戏界面由 `GameManager` 在运行时用代码构建（节点 + Graphics + Label），
> 因此场景文件只需包含 Canvas / Camera / GameRoot 三个节点，最小化序列化失败风险。

## 打开与预览步骤

### 1. 用 Cocos Creator 打开
- 安装 **Cocos Dashboard** → 安装 **Cocos Creator 3.8.x**。
- 打开 Cocos Creator → “项目” → “导入/打开” → 选择本目录 `C:\Users\37615\Projects\game`。
- 首次打开会提示“用更新版本创建”等，确认即可；缺失的 `settings` 会被自动补全。
- 在 **资源管理器** 双击 `assets/src/scenes/Main.scene` 打开场景。

### 2. 浏览器/模拟器预览（最快验证）
- 点击编辑器顶部 **“预览”**（浏览器图标），或按 `Ctrl/Cmd + P`。
- 即可在浏览器中试玩：点单位合并、看金币增长、开图鉴。

### 3. 微信开发者工具预览（真机/小游戏环境）
- 在 Cocos Dashboard 中勾选安装 **“微信小游戏”** 构建支持（部分版本内置）。
- Cocos Creator 内：**项目 → 构建发布** → 平台选 **“微信小游戏”** → 填入你的 **AppID**（无账号可用 `touristappid` 游客模式）→ 点击“构建”。
- 构建完成后点“运行”（或手动用 **微信开发者工具** 打开 `build/wechatgame` 目录）。
- 微信开发者工具中即可预览；如需真机，用工具扫码。

> 若编辑器提示场景导入异常：直接删除 `assets/src/scenes/Main.scene`（及其 .meta），
> 新建空场景，在层级管理器选中 Canvas → 属性检查器添加 `Bootstrap` 组件，
> 保存并设为启动场景即可（游戏逻辑完全由代码构建，不依赖手工拼节点）。

## 已实现 vs 未实现

| 模块 | 状态 | 说明 |
|------|------|------|
| 合并玩法 | ✅ | 点选两同档合并升档，最高 6 档 |
| 放置收益 | ✅ | 每秒结算，HUD 显示 |
| 图鉴解锁 | ✅ | 达到档位阈值解锁占位卡 |
| 招募生成 | ✅ | 免费在空格放 1 档单位 |
| 拖拽合并 | ❌ | 当前为点选式，拖拽可后续加 |
| 动画/音效 | ❌ | 无，纯功能原型 |
| 存档/离线收益 | ❌ | 未接入 `sys.localStorage` / 微信存档 |
| 真实美术/角色 | ❌ | 全部占位纯色，无版权素材 |
| 数值平衡/商业化 | ❌ | `GameConfig` 为占位参数 |

## 自定义

改 `assets/src/data/GameConfig.ts` 即可调整：网格尺寸、档位数、各档颜色、每秒产出、角色卡名称与解锁阈值、初始单位数。

## 引擎切换成本（若改用 LayaAir / 原生）

- **切到 LayaAir 3.x**：两者都支持导出“微信小游戏”，平台目标不变。但 Laya 用自己的 IDE 与 API（`Laya.Scene` / `Laya.Sprite` / `Laya.Label` / 事件模型），**渲染与 UI 代码需整体重写**。可复用约 30%：`GameConfig.ts` 数据层基本可直接搬；`MergeGrid`/`Hud`/`CollectionPanel` 的**逻辑**可复用，但所有 `cc.*` 调用需改为 `Laya.*`，并重建场景/预制体结构。预计重写量 **60%~70%**。
- **切到原生（Unity / 自研 C++ 等）**：架构与渲染全换，重写量 **90%+**，仅保留 `GameConfig` 数值与玩法设计文档。
- **仍在 Cocos 家族内换版本（如 3.6 ↔ 3.8）**：几乎零成本，直接用对应 Creator 打开并迁移 `settings` 即可。
- **结论**：当前用 Cocos Creator 3.x 是微信小游戏最低成本路径；若未来确定换引擎，建议先把 `GameConfig` 与玩法逻辑沉淀为引擎无关模块以降低迁移成本。

## 已知限制 / 注意事项

- 本脚手架在沙箱内**无法运行 Cocos Creator**（无 GUI/无 CLI 构建环境），已交付完整工程源码 + 本说明。请按上面步骤在本地编辑器打开预览。
- 手写的 `Main.scene` 采用 Cocos Creator 3.x 标准序列化格式；如你本地 Creator 版本差异导致导入警告，按上文“重建场景”三步即可恢复，不影响游戏逻辑。
- 未做任何 git 提交、未删除任何文件。
