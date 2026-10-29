# dsh-theme-palette

[English](README.md) · [中文](README-zh.md) · [日本語](README-ja.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

DeepSeek Harness（Web / 桌面）的主题配色插件：**4 套预设 + 自定义配色 × 明暗两模式**，两个轴互相独立。

![设置页：五套配色、强度与面板表面](assets/screenshot-settings-light.png)

*上图按真机面板宽度（内容区 564 px）静态渲染。*

| 深色 | 自定义面板 | 高对比 |
|---|---|---|
| ![深色](assets/screenshot-settings-dark.png) | ![自定义面板](assets/screenshot-settings-custom.png) | ![高对比](assets/screenshot-settings-hc.png) |

## Compatibility

| 项目 | 状态 |
|---|---|
| DSH 桌面 / Web 客户端 | 0.2.x |
| Node.js | 22.19.0+（22.x 线）或 24.0.0+ |
| 对宿主源码的改动 | 无 |

package.json 的 `engines` 字段写的是 `^22.19.0 || >=24.0.0`——与上表同一要求。

插件只用 `ctx.theme.overrideTokens` 叠一层颜色 token：不注册主题、不改宿主、不动「外观」偏好。

## What it does

- **4 套预设 + 自定义** —— 黑白 / 暖砂 / 靛蓝 / 苔绿各自独立适配明暗两侧，另加由三色派生的自定义配色；
- 色阶**整体重算**而不是替换：OKLCH 重建 → 角色化色度 → **sRGB 色域钳位** → 在真实承载面上求解对比度；
- 覆盖宿主全部颜色 token（自定义/染色档 158 个、黑白档 19 个；1080 组设置全扫描）：正文、次级、三级、注释、链接、侧栏、卡片、主人气泡、主按钮、滚动条、开关、Markdown 标题/加粗、代码块；
- 可调：文字着色三档、侧栏三档、Markdown 强调、滚动条、开关配色；
- **自定义配色**（给 底色/文字/强调 三色，文字色相也参与派生；过亮/过暗的强调色会归一化）、**配置导入导出**（`dshs1.` 短码含三色）、**高对比**档、4 种界面语言；
- **自愈**：宿主丢弃 override 层时自动重放；自动重放连续失败后会停用，并在设置页给出「重新启用」入口；
- **对比度承诺**：正文浅色 12:1、深色 10:1（高对比 15:1），次级 ≥ 6.2 浅 / 8.0 深，三级 ≥ 4.85 浅 / 6.4 深（高对比 7 / 7.6），链接 ≥ 4.95 浅 / 4.62 深（高对比 7；浅色留了色觉缺陷余量），链接深色另过 APCA Lc ≥ 60（高对比 75）—— 都在文字真实落到的承载面上实测（深色要高一些：WCAG 比值在暗底上会高估可读性）；
- 承诺面是浅色 00/60 与深色 950/875；深色 800（模块面）与 850（次级深面）**不为正文兜底**，报表单列为「政策外」（既不算达标也不算失败）；
- 界面支持 简体中文 / 繁體中文 / English / 日本語（跟随宿主，也可手选）。

## Install

```bash
# 从 npm
cd ~/.dsh/profiles/desktop
pnpm add dsh-theme-palette
```

要钉住某个版本，用 `pnpm add dsh-theme-palette@<version>` —— [CHANGELOG.md](CHANGELOG.md) 里标了「未发布」的那些版本从未发到 npm，别钉它们。
从 GitHub Release 的 tarball：在 [Releases 页面](https://github.com/zuoyunlai/dsh-theme-palette/releases) 选好资产后 `pnpm add <tgz 路径>`。

装完**必须重启 GUI**（运行中的进程仍持旧模块）。入口：左下角头像 → **设置** → 「**主题色**」。

## Configuration

| 项 | 选项 |
|---|---|
| 配色 | 黑白 · 暖砂 · 靛蓝 · 苔绿（卡片缩略图跟随明暗） |
| 强度 | 静 / 标准 / 浓 —— 正文与强调的着色程度 |
| 面板表面 | 左侧栏（更浅 / 同色 / 更深）。右侧栏完全不染色：宿主那块面板是整高透明覆盖层，上色会盖住主栏（1.9.10 起整条链路已撤除） |
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
- 文字下限在构建期强制：正文浅色 ≥ 12:1、深色 ≥ 10:1（高对比 15:1），次级 ≥ 6.2 浅 / 8.0 深（HC 9 / 9.6），三级 ≥ 4.85 浅 / 6.4 深（HC 7 / 7.6），链接 ≥ 4.95 浅 / 4.62 深（HC 7），链接另过 APCA Lc ≥ 60 深 / 75 HC；侧栏与气泡文字随色阶派生，实测均 ≥ 7（不设独立对比度门）；
- 承诺面是浅色 00/60 与深色 950/875；深色 800（模块面）与 850（次级深面）**不为正文兜底**，报表单列为「政策外」（既不算达标也不算失败），且每一档承载面仍须过 AA 底线 4.5；
- 报表把三件事分开：声明目标、物理上限（该承载面上黑或白前景能达到的对比度）、政策豁免；0.93 只是求解余量，仅用于判断目标是否高于上限；
- `node palette-dev.mjs` 扫全部 1080 组配置（5 套配色 × 216 组设置，已含标准/高对比两档）并打印承载面报表，`--hc` 把主报表切到高对比档；硬失败时退出码 1。

逐组件设计取舍与对比度表见 [docs/DESIGN.md](docs/DESIGN.md)，版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## Development

```bash
npm run report                        # 全部配色的 token 报表（-- --hc 切高对比档）
npm run sheet                         # 配色看板 → tools/sheet.html
npm run shot-sheet                    # 无头 Chrome/Edge 截看板
npm run compare -- --dir tools/out/<run>   # 与本地基线比
npm run preview -- --lang en          # 渲染设置页
npm run contract                      # 宿主 token / DOM 契约（strict：SKIP 即失败）
npm run release -- --dry              # 发版预检
npm run release -- --tag              # 发 npm + 打 tag
npm run release -- --ci               # CI 发布：只打 tag，Actions 用 Trusted Publishing 发布
npm run clean                         # 清掉本地 tarball / tools/out / dist
```

截图回归分两层：配色看板（免登录）与桌面真机窗口（`tools/shoot-desktop.mjs`，需要 `--remote-debugging-port`）。见 [tools/README.md](tools/README.md)。


## Pitfalls we hit

1.7.0 审计里最反直觉的五条——每一条都是测试逼出来的，不是看截图看出来的。

- **纯白强调色会生成纯白链接**（1.13:1）。对比度求解器原本只朝"远离背景"的单一方向走，强调色比背景还亮时只会一路推向白色。
- **取了色，整页变了，面板没变。** 组件订阅的是配色 id，而取色不会改变它——React 比较快照发现没变，直接跳过重渲染。
- **分享了配置，没分享颜色。** 短码带了各项模式，但没带自定义三色，换台机器导入提示成功，用的仍是本机旧值。
- **「不承诺」不等于「做不到」。** 旧报表把深色模块面标成「表面受限」，因为它拿正文目标去比最深的一面（800）。但 800 用白前景也有约 10.22:1、850 约 15.27:1，都高于 10:1 目标——从来没有什么"物理不可达"，只是这些面不在承诺范围内。现在报表把声明目标、物理上限与政策豁免分开，800/850 单列为「政策外」，不再标「物理不可达」。
- **一个我们以为失效的选择器其实活着。** 审计最初判定 `_markdown_` 相关选择器已失效；契约测试对着实际构建 CSS 证明它还在——错的是结论，不是代码。

## Sharing

所有设置——包括自定义三色——都装进一条短码。粘到导入框点「预览」，先看到将覆盖什么，再确认应用：

```text
dshs1.eyJ2IjoxLCJwIjoiY3VzdG9tIiwicyI6ImRlZXAiLCJ0IjoidGludGVkIiwiYyI6InRpbnRlZCIsImsiOiJhY2NlbnQiLCJtIjoib24iLCJoIjoib2ZmIiwibCI6InpoLUNOIiwieCI6eyJiZyI6IiNmNWVmZTYiLCJ0ZXh0IjoiIzFkMWExNyIsImFjY2VudCI6IiMzZjY2YTMifX0
```

这条真实示例解码后是：

- 配色：自定义 · 侧栏：更深 · 文字：标准
- 滚动条：跟随 · 控件：主题色 · Markdown 强调：开 · 高对比：关 · 语言：zh-CN
- 三色：`#f5efe6`（底色）· `#1d1a17`（文字）· `#3f66a3`（强调）

短码由生产编码器生成、经解码往返自检后才写进本文档——从不手写。

## Trade-offs

这个生态里别的主题插件做玻璃、壁纸、动效。我们刻意不做：

- **不做玻璃与壁纸。** 那条赛道靠截图竞争，我们更愿意靠证据竞争。
- **不做主题市场，也不做 AI 生色。** 两者都会引入我们无法保证的颜色；对比度求解器是资产，往里喂不可预测的输入等于自毁。
- **不再堆配色。** 4 套预设 + 三色生成，强过手挑十套；数量不是护城河。
- **不做护眼宣称。** 我们只报文字真实落在的承载面上的实测对比度；不在承诺范围内的面就写"政策外"——这是陈述，不是借口。


## License

MIT © 2026 Zuoyunlai
