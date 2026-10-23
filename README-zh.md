# dsh-theme-palette

[English](README.md) · [中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

DeepSeek Harness（Web / 桌面）的主题配色插件：**4 套配色 × 明暗两模式**，两个轴互相独立。

![设置页：五套配色、强度与面板表面](assets/screenshot-settings-light.png)

*上图按真机面板宽度（内容区 564 px）静态渲染。*

| 深色 | 自定义面板 | 高对比 |
|---|---|---|
| ![深色](assets/screenshot-settings-dark.png) | ![自定义面板](assets/screenshot-settings-custom.png) | ![高对比](assets/screenshot-settings-hc.png) |

## Compatibility

| 项目 | 状态 |
|---|---|
| DSH 桌面 / Web 客户端 | 0.2.x |
| Node.js | ≥ 20 |
| 对宿主源码的改动 | 无 |

插件只用 `ctx.theme.overrideTokens` 叠一层颜色 token：不注册主题、不改宿主、不动「外观」偏好。

## What it does

- **4 套配色** —— 黑白 / 暖砂 / 靛蓝 / 苔绿，各自独立适配明暗两侧；
- 色阶**整体重算**而不是替换：OKLCH 重建 → 角色化色度 → **sRGB 色域钳位** → 在真实承载面上求解对比度；
- 覆盖 27,000+ 处 token 引用：正文、次级、三级、注释、链接、侧栏、卡片、主人气泡、主按钮、滚动条、开关、Markdown 标题/加粗、代码块；
- 可调：文字着色三档、侧栏三档、右栏两档、Markdown 强调、滚动条、开关配色；
- **自定义配色**（给 底色/文字/强调 三色，文字色相也参与派生；过亮/过暗的强调色会归一化）、**配置导入导出**（`dshs1.` 短码含三色）、**高对比**档、4 种界面语言；
- **自愈**：宿主丢弃 override 层时自动重放；
- 高对比的 15:1 以浅色卡层/深色 950 为承诺面；深色模块面 800 受表面亮度限制，报表会标“表面上限”。
- 界面支持 简体中文 / 繁體中文 / English / 日本語（跟随宿主，也可手选）。

## Install

```bash
# 从 npm
cd ~/.dsh/profiles/desktop
pnpm add dsh-theme-palette

# 或指定版本
pnpm add dsh-theme-palette@1.4.3
```

从 GitHub Release 的 tarball：

```bash
pnpm add "https://github.com/zuoyunlai/dsh-theme-palette/releases/download/v1.4.3/dsh-theme-palette-1.4.3.tgz"
```

装完**必须重启 GUI**（运行中的进程仍持旧模块）。入口：左下角头像 → **设置** → 「**主题色**」。

## Configuration

| 项 | 选项 |
|---|---|
| 配色 | 黑白 · 暖砂 · 靛蓝 · 苔绿（卡片缩略图跟随明暗） |
| 强度 | 静 / 标准 / 浓 —— 正文与强调的着色程度 |
| 面板表面 | 左侧栏（更浅 / 同色 / 更深）、右侧栏（同左栏 / 跟随画布） |
| 更多选项 | 语言、Markdown 强调、滚动条、开关 / 勾选 |

选择即时生效并存在 `localStorage`；明暗仍由宿主「外观」控制。

## Palette engine

```
OKLCH(L, C, hue) ──► 色域钳位（对 C 二分） ──► sRGB hex
        ▲
        └── 角色色度 × 强度，再在 {画布, 卡层, 侧栏, 悬浮层} 上求解对比度
```

- 语义别名保留 `var(--dsw-static-neutral-bluish-NN)` 引用链，跟 token 的元素就跟着配色走；
- 浅色面用色阶 00–300，深色面用 800–950；
- 文字下限在构建期强制：正文 ≥ 12、次级 ≥ 6.2、三级/链接 ≥ 4.62、侧栏内 ≥ 7、气泡内 ≥ 7；深色模块面按可达上限钳位并标注；
- `node palette-dev.mjs` 跑标准档承载面报表，`--hc` 跑高对比档；硬失败时退出码 1。

逐组件设计取舍与对比度表见 [docs/DESIGN.md](docs/DESIGN.md)，版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## Development

```bash
node palette-dev.mjs                  # 全部配色的 token 报表
node tools/sheet.mjs                  # 配色看板 → tools/sheet.html
node tools/shoot-sheet.mjs            # 无头 Chrome 截看板
node tools/compare.mjs --dir tools/out/<run>        # 与基线比
node tools/preview-settings.mjs --lang en           # 渲染设置页
node tools/release.mjs --dry          # 发版预检
node tools/release.mjs --tag          # 发 npm + 打 tag
```

截图回归分两层：配色看板（免登录）与桌面真机窗口（`tools/shoot-desktop.mjs`，需要 `--remote-debugging-port`）。见 [tools/README.md](tools/README.md)。


## Pitfalls we hit

1.7.0 审计里最反直觉的五条——每一条都是测试逼出来的，不是看截图看出来的。

- **纯白强调色会生成纯白链接**（1.13:1）。对比度求解器原本只朝"远离背景"的单一方向走，强调色比背景还亮时只会一路推向白色。
- **取了色，整页变了，面板没变。** 组件订阅的是配色 id，而取色不会改变它——React 比较快照发现没变，直接跳过重渲染。
- **分享了配置，没分享颜色。** 短码带了各项模式，但没带自定义三色，换台机器导入提示成功，用的仍是本机旧值。
- **深色模块面有硬上限。** 即使纯白，在最深的模块面上也只有约 10.99:1，10:1（高对比 15:1）物理上不可达。现在按该面可达上限钳位并标注"表面受限"，而不是默默不达标。
- **一个我们以为失效的选择器其实活着。** 审计最初判定 `_markdown_` 相关选择器已失效；契约测试对着实际构建 CSS 证明它还在——错的是结论，不是代码。

## Sharing

所有设置——包括自定义三色——都装进一条短码。粘到导入框点「预览」，先看到将覆盖什么，再确认应用：

```text
dshs1.eyJ2IjoxLCJwIjoiY3VzdG9tIiwicyI6ImRlZXAiLCJ0IjoidGludGVkIiwiciI6InNpZGViYXIiLCJjIjoidGludGVkIiwiayI6ImFjY2VudCIsIm0iOiJvbiIsImgiOiJvZmYiLCJsIjoiemgtQ04iLCJ4Ijp7ImJnIjoiI2Y1ZWZlNiIsInRleHQiOiIjMWQxYTE3IiwiYWNjZW50IjoiIzNmNjZhMyJ9fQ
```

这条真实示例解码后是：

- 配色：自定义 · 侧栏：更深 · 文字：标准 · 右栏：同左栏
- 滚动条：跟随 · 控件：主题色 · Markdown 强调：开 · 高对比：关 · 语言：zh-CN
- 三色：`#f5efe6`（底色）· `#1d1a17`（文字）· `#3f66a3`（强调）

短码由生产编码器生成、经解码往返自检后才写进本文档——从不手写。

## Trade-offs

这个生态里别的主题插件做玻璃、壁纸、动效。我们刻意不做：

- **不做玻璃与壁纸。** 那条赛道靠截图竞争，我们更愿意靠证据竞争。
- **不做主题市场，也不做 AI 生色。** 两者都会引入我们无法保证的颜色；对比度求解器是资产，往里喂不可预测的输入等于自毁。
- **不再堆配色。** 4 套预设 + 三色生成，强过手挑十套；数量不是护城河。
- **不做护眼宣称。** 我们只报文字真实落在的承载面上的实测对比度，到顶就写"表面受限"，不做医学声明。


## License

MIT © 2026 Zuoyunlai
