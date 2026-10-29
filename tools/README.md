# 截图回归

配色插件的回归分两层，**能跑哪层取决于你想要多接近真实界面**。

| 层 | 截的是什么 | 需要什么 | 能发现什么 |
|---|---|---|---|
| **A. 配色看板**（已就绪） | `tools/sheet.html`：每套配色一屏，浅色 + 深色两个面板，内含侧栏条目、气泡、卡片、代码块、按钮、开关、滚动条、正文四档文字 | 只要 Chrome/Edge | 配色系统本身的变化：色相、层次、对比度、气泡/按钮的落色 |
| **B. 真机**（需一次重启） | 桌面版**真实窗口**（Electron 渲染进程） | 桌面版以 `--remote-debugging-port=9333` 启动一次 | 真实内容下的观感、真实间距/组件、宿主改版导致的偏移 |

两层的产物都进 `tools/out/<run>/`，与 `tools/baseline/` 做 sha256 对比。

> **基线是本地产物，不入库**（审计 2026-10-29 P2-15）：`compare.mjs` 不在 CI 里，入库的基线会随机器与
> Chrome 版本悄悄腐烂，看起来像"回归门"，其实没人跑。第一次用先
> `npm run compare -- --dir tools/out/<run> --update` 生成自己机器上的基线；`tools/baseline-desktop/`
> 同理（早已在 `.gitignore` 里）。

## A. 配色看板

```bash
npm run sheet                                     # 生成 tools/sheet.html（颜色来自生产引擎）
npm run shot-sheet                                # 4 张 → tools/out/<时间戳>/
npm run compare -- --dir tools/out/<run>          # 与基线比
npm run compare -- --dir tools/out/<run> --update # 认这次为新基线
npm run clean                                     # 清掉 tarball 与 tools/out（不动 dist/）
```

同一台机器上渲染是确定的：连跑两次哈希一致（已实测 4/4 未变），所以**字节变化 = 像素变化**，
不需要容忍阈值。变了就并排看两张 PNG。

## B. 桌面版真机

桌面版是 Electron，Web GUI 跑在渲染进程里、鉴权由 App 内部完成，所以外部拿不到 token ——
但 Electron 支持标准 CDP，只要**带调试端口启动一次**：

```powershell
# 关掉当前 DSH，然后：
& "D:\Programs\DeepSeek Harness\DeepSeek Harness.exe" --remote-debugging-port=9333
```

> ⚠️ **这个端口没有任何鉴权**：能连上它的人可以在渲染进程里执行任意代码（`Runtime.evaluate`），
> 也能读到同 origin 的全部 `localStorage`（宿主会话凭据就在那儿）。所以：
>
> - **只在需要截图的那一次启动里开**，抓完立刻关掉重开（不要把它写进快捷方式常驻）；
> - 只绑本机、不要在共享网络/远程桌面里开；
> - 更安全的替代：`--remote-debugging-pipe`（走 stdio 而不是 TCP 端口，外部进程够不到）。

然后：

```bash
npm run shot-desktop -- --out tools/out/desk1        # 4 套 × 浅/深 = 8 张
npm run compare -- --dir tools/out/desk1 --baseline tools/baseline-desktop
```

`shoot-desktop.mjs` 的驱动方式不是"点界面"，而是走插件自己的开发期接口：

```js
window.__DSH_THEME_PALETTE_DEV__.setPalette('warm')
window.__DSH_THEME_PALETTE_DEV__.setTheme('dark')
```

这样不依赖按钮文字、不依赖设置页结构，宿主改版也不会把脚本搞坏。**抓完会把原来的配色与
明暗偏好还原**（`setTheme` 会写进宿主设置，不还会改用户配置）。

> 为什么不用 `--profile desktop --dump-config` 之类：那验的是配置层，不是渲染层，
> 而配色的问题全都长在渲染层（色域、层次、对比度）。

**脚本自己完成三件事，不需要手工注入**（2026-10-22 实测跑通）：

1. CDP `Page.addScriptToEvaluateOnNewDocument` 注入 `window.__DSH_THEME_PALETTE_DEV_REQUEST__ = true`
   和一个带 `.attach` 方法的收集器 —— 插件的开发接口默认关闭，桌面版 URL 又改不了，
   这是唯一入口（缺 `.attach` 时插件会静默跳过，这正是 1.4.4 之前 B 层跑不起来的原因）；
2. `Page.reload` 后轮询 `window.__DSH_DEV_API__` 就绪（最多 20s）；
3. 逐套配色 × 浅/深 抓图，**结束时把你原来的配色与明暗偏好还原**（`try/finally`）。

实测：5 套 × 浅/深 = 10 张，每张 0.7 MB 左右；基线存 `tools/baseline-desktop/`
（7.2 MB，已进 `.gitignore`，留在本地做回归）。


## 什么时候跑

- 改 `SCHEMES` / `TEXT_MODES` / `SIDEBAR_MODES` 等参数之后；
- 改 `aliasOverrides`（气泡、按钮、边框、滚动条、注释）之后；
- 升宿版本之后（token 名或步号映射可能变）。

## 已知边界

- A 层是**忠实投影**但不是真机：不含宿主的真实排版、字体回退、外部插件注入的样式；
- B 层依赖调试端口，属于开发期手段，不要常开；
- 两层都只做"变了没有"，不做"变得对不对" —— 判断仍要人看。
