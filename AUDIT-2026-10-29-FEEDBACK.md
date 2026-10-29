# 审计反哺报告：对 `AUDIT-2026-10-29.md` 的逐条核实与修订

> **核实对象**：`dsh-theme-palette` v1.13.1 工作树（`client.js` 3920 行、`tools/` 21 个脚本、`.github/workflows/` 2 个）。
> **核实日期**：2026-10-29。**方法**：逐条读码定位 → 在**临时副本**（`%TEMP%\tp-mut`，不动工作树）上跑变异测试 → 独立复算色彩数学 → 用 registry 实测对账版本表。
> **本文与审计报告的关系**：审计报告是「提问题的一方」，本文是「被审方逐条回执」。**不是二审，也不替代审计**；凡是与报告不一致的地方，本文给出可复现的命令与读数。

---

## 0. 结论摘要

审计共列 **34 条**（P0 × 2、P1 × 8、P2 × 16、P3 × 8）。逐条核实后：

| 分类 | 条数 | 说明 |
|---|---|---|
| **结论成立** | **34 / 34** | 无驳回。两处"证据与实测不一致"（2.1 的变异结果、2.2 的数字）**不影响**该条结论 |
| **证据或数据需更正** | 7 处 | 见 §2：一行变异结果、一个 ΔE 数字、一个版本范围、一个体积、一条后果链、一条修复公式（差 100 倍）、一处计数表述 |
| **另发现、审计未列** | 1 条 | `export-theme-pack.mjs` 用浅色 12:1 卡深色包 → 深色主题包一直被静默丢弃（§9.2，已修） |

> 口径说明：§1–§4 给逐条判定与证据，§2 集中列报告里**需要更正**的七处，§5 是处置计划，§7–§9 是回执与验证。

**一句话结论**：审计的核心判断（"引擎正确、防回归的工程能力不足"）站得住，且给出了本仓库此前三轮审计都没有的方法增量 —— **变异测试**。本轮按它的方法重跑八次变异：修改前两个"全绿"复现，修改后**八个全部被抓**（§8.2）。唯一"结果与报告相反"的是 `MIN_LINK_DARK` 那一行 —— 它其实会红，但红在截图预览哈希门，不是对比度断言，反而更证明"承诺没有自己的断言"。

---

## 1. P0 —— 逐条核实

### P0-1 版本漂移在 CI 里完全不可见 —— **成立**

| 核实项 | 读数 |
|---|---|
| `package.json.version` | `1.13.1` |
| `client.js:30` `PLUGIN_VERSION` | `'1.13.1'` |
| `assets/screenshots.meta.json` `pluginVersion` | `1.13.1` |
| 断言 `package.json === PLUGIN_VERSION` 的位置 | 只有 `tools/release.mjs:89-95` |
| `release.mjs` 是否在 CI 里 | **否**（`ci.yml` 只跑 `npm run check` + `npm run report`） |
| 变异实测（临时副本） | `package.json → 1.99.0` 后 `node tools/check-all.mjs` **EXIT=0**、`palette-dev.mjs` **EXIT=0** |

CI 走 `publish.yml`（tag 触发 → OIDC publish），那条路径**不过** `release.mjs`，所以"`package.json` 单方面 bump"确实能一路发出去，而设置页角标读的是 `PLUGIN_VERSION`。**报告的后果链成立。**

> 补充一处报告没写的细节：`check-ui.mjs` 已经断言 `screenshots.meta.json.pluginVersion === PLUGIN_VERSION`，但**没有任何断言把 `package.json` 拉进同一组**。所以三个版本号是"两两各钉一条、缺一条边"的三角，缺口正好是发版实际依赖的那条边（`package.json` → 发布物）。

### P0-2 npm 包页有 6 条死链 —— **成立**

`npm pack --dry-run --json` 实测 **22 个文件 / 444552 B（434.1 KiB）/ 717473 B 解包**，`tools/` 与根目录 `AUDIT-*.md` 都不在 `files` 里：

| 死链 | 处数 | 目标在包里吗 |
|---|---|---|
| `[tools/README.md](tools/README.md)` | 5（`README.md:93` / `-zh:93` / `-es:92` / `-pt:92` / `-hi:92`） | 否 |
| `[AUDIT-2026-10-27.md](AUDIT-2026-10-27.md)` | 1（`CHANGELOG.md:44`） | 否 |

`tools/README.md` 在仓库里存在（4383 B）。**报告结论与计数一致**，采用方案 A（打进包，自包含）。

---

## 2. P1 —— 逐条核实

### P1-1 对比度承诺没有字面量锚点 —— **成立**（但表格第二行的变异结果与实测相反）

复现报告的第一行（临时副本，不改工作树）：

```
CONTRAST_FLOOR = 4.5 → 1.0
  node tools/check-all.mjs      → EXIT=0   ← 全绿（报告复现）
  node palette-dev.mjs          → EXIT=0
  node palette-dev.mjs --hc     → EXIT=0
```

**根因核实**：`check-audit.mjs` 的期望值来自 dev 钩子导出的同一个 `floors()` 函数（`const F = floors(false)`），常量改了，期望值跟着改 —— 典型的自指。`physicalCeiling` / `limitedByPhysics` 两条断言（`:308`、`:324`）同样出自被测的 `buildContrastReport`，一起漂移时照样过。**成立。**

**但**报告表格第二行（`MIN_LINK_DARK 4.62 → 1.5 | 0 红`）与实测不符：

```
MIN_LINK_DARK = 4.62 → 1.5
  node tools/check-all.mjs      → EXIT=1
  ✗ screenshot-settings-custom.png 的源预览页未变（变了就重跑 node tools/shoot-settings.mjs）
```

原因是 `check-ui.mjs:195` 有一条**截图预览 HTML 哈希**断言：改任何影响 token 的常量都会让预览页变字节，从而红。所以"改小下限"**不会静默通过** —— 但抓它的不是对比度断言，而是"该重拍截图了"的提示。这有两个后果，都支持报告结论：

1. 红的是"喂，重跑截图"，不是"你把 README 承诺的 4.62 改掉了"；照提示重拍一遍就绿了；
2. 唯一真正钉住承诺数值的地方仍然不存在。

**判定：结论成立，证据行需更正。**（修订内容见 §3 P1-1。）

### P1-2 `publish.yml` 不校验 tag 与 `package.json` 版本一致 —— **成立**（后果链需收窄）

`publish.yml:72-77` 从 tag 推 `VERSION`，只用于"registry 是否已有该版本"的探针；`npm publish` 读的是 `package.json`。缺口成立。

报告写"探针 404 → `npm publish` 去发 1.13.1 → 与 P0-1 叠加"，这条链只在"`package.json` 的版本尚未出现在 registry"时成立；若该版本**已在** registry，`npm publish` 会直接 `E409` 变红。真正危险的分支是另一种：

- tag `v1.14.0` / `package.json` 仍是 `1.13.1` → 探针查 `1.14.0` 404 → 发布 `1.13.1`（若未发布则发出去；若已发布则 E409）；
- 就算 publish 侥幸成功，后面"取 tarball"用的是 tag 版本（`$PKG-1.14.0.tgz`），registry 上没有 → curl 拿到 404 页面 → sha1 核对/Release 全崩。

结论：**该加 tag ↔ package.json 的断言**，位置在 publish 之前（最早，能挡住后续所有步骤）。

### P1-3 `release.mjs` 的版本闸门一改引号就静默失效 —— **成立**

`release.mjs:91`：`/const PLUGIN_VERSION = '([^']+)'/`（只认单引号），`:92` 命中不到时走 `warn(...)` 后**继续发版**。`check-ui.mjs:165` 用的是宽松版 `/PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/`。两份正则不一致 + 发版路径上"找不到就跳过"= 闸门可被一次引号风格变更静默拆掉。**成立。**

### P1-4 宿主契约测试在 CI 上断言数为 0 —— **成立**

`check-host-contract.mjs:26` 硬编码 `D:/Programs/DeepSeek Harness/resources/app.asar`；找不到时 `exit 78`；`check-all.mjs` 把 78 记成"未执行（不计失败）"；`ci.yml` 既不给 `DSH_ASAR` 也不加 `--strict` → **ubuntu-latest 上这一层确实 0 条断言**。本地实测通过（asar 存在）。

**修订可行性已验证**：宿主三件套在 npm 上有公开发布 —— `@deepseek-ai/dsh-client-ui-theme@0.2.1-rc.2`、`dsh-client-ui-layout@0.2.1-rc.2`、`dsh-web-frontend@0.2.1-rc.2`。实测安装后把契约脚本里的 16 条断言原样跑在这三个包上：**全部通过**（10 个 token 名齐全、两条 `--dsw-alias-bg-base` 链路、`background-color` 规则、presenter 的两条正则、CSS 的 `_markdown_` / `md-code-block`）。所以"契约进 CI"不必依赖 Windows 路径，也不必上传 asar —— 让 CI 装 peer 包即可。

### P1-5 `release.mjs` 与 `check-all.mjs` 各维护一份脚本清单 —— **成立**

`release.mjs:157` 5 个（audit/custom/ui/selfheal/colormath）+ 单独调用 host-contract（`:167`）与 check-pack（`:204`）；`check-all.mjs:19-27` 7 个。今天**功能等价**，但清单两处维护 —— 加第 8 个脚本时 `npm run check` 会绿、发版门会瞎。`check-pack.mjs` 头部注释里"两条路径共用同一份清单"只对**文件清单**成立，对**脚本清单**不成立。**成立。**

### P1-6 `tools/insert-readme-sections.mjs` 休眠且已损坏 —— **成立**

```
node tools/insert-readme-sections.mjs --check
  ✗ README.md / -zh / -es / -pt / -hi: 缺少示例短码   → EXIT=1（干净检出上）
```

根因核实：脚本里 `SAMPLE` 是硬编码的 1.9.10 之前生成的码，解码后**仍带 `"r":"sidebar"`**（右栏字段，1.9.10 已撤除）；README 里的码是 `sample-code.mjs` 重新生成的（无 `r`），所以字符串比对必然失败。脚本没有被任何 npm script / CI / README 引用（`grep` 只命中 CHANGELOG 的历史记录）。**成立。**

### P1-7 色阶排序归一化漏掉了 `900` —— **成立**

`client.js:1449` 的 `RAMP_ORDER` 18 项、**不含 `'900'`**；`client.js:41` 的 `BASE.bluish` 有 `'900': '#1b1b1c'`。`enforceRampOrder` 用 `RAMP_ORDER.filter(...)` 取待比较档位（`:1453`），所以 900 既不参与比较也不被钳制。**成立。**

补充：`RAMP_ORDER` 里 `1000` 在末尾、`900` 缺失，属于"加档时忘了同步顺序表"的典型漏项 —— 值得在测试里钉住"BASE 的每个 numeric 档都在 RAMP_ORDER 里"，否则下一档还会漏。

### P1-8 APCA 的 Lc 被取整到整数 —— **成立**

`client.js:733`：`return Math.round(out * 100) / 100`，而 `out` 本身就是 Lc/100 → 实际返回 `round(Lc)/100`。实测：

```
20000 组随机采样的 apcaContrast(...)*100 → 0 个非整数   ← 引擎产出的 Lc 全是整数
apcaContrast('#888888','#ffffff')*100 = 63              ← 公开参考值 63.06
apcaContrast('#000000','#ffffff')*100 = 106             ← 参考 106.04
apcaContrast('#ffffff','#000000')*100 = -108            ← 参考 -107.88
```

`raiseToLc`（`:1013`）里的 `Math.abs(apcaContrast(...)) * 100` 是「Lc/100 → Lc」的关键换算，**没有任何断言钉住它**。**成立。**

---

## 3. P2 —— 逐条核实

| # | 判定 | 核实读数 |
|---|---|---|
| P2-1 | **成立** | `client.js:749` 注释写"线性混色"，`:750-753` 实现是 gamma 编码 sRGB 直接插值（`mixHex('#000000','#ffffff',0.5)` = `#808080`，线性光应为 `#bcbcbc`）。结果本身合法，错的是注释 |
| P2-2 | **成立** | 实测 `toOklch('#abc')` → `[NaN,NaN,NaN]` → `#NaNNaNNaN`；`toOklch(null)` 抛 `TypeError`（`hexToRgb` 裸 `parseInt`）。用户路径不可达（`readCustom` 有 `HEX_RE` 守卫），属潜伏风险 |
| P2-3 | **成立（标签），数字有误** | `deltaE` = OKLab 欧氏距离 ×100（`client.js:791-799`），UI 文案却写 `ΔE {dE}`。但报告"红 vs 绿给 22.33"与实测不符：**实测 51.98**（CIE76 的 170.58 复算无误）。量级差异说明"同一个名字、两套刻度"，结论仍成立 |
| P2-4 | **成立** | `client.js:2686-2687` `TEXT[locale] \|\| TEXT['zh-CN']`、`:3901` `LABELS[loc] \|\| LABELS['zh-CN']`；而 `pickLocale`（`:2298-2303`）明确"兜底必须是 en" —— 同一文件里两套回退口径 |
| P2-5 | **成立** | `client.js:2683-2685` `langAttr` 在 `auto` 时取宿主 `document.documentElement.lang`，不是插件解析出的 `locale`；宿主是 fr 时面板标 `lang="fr"` 却渲染英文 |
| P2-6 | **成立** | `README.md:33` 有「自定义配色 + 短码导入导出 + 高对比 + 4 语界面」一条；`-es` / `-pt` / `-hi` 的 `## What it does` 里没有（逐条比对：三者都少了这一条，其余 7 条齐全） |
| P2-7 | **成立** | `DESIGN.md` 548 行、`grep -n "i18n\|locale\|语言"` **0 命中**；`## 自愈判据与健康反馈（1.9.8）`（`:538-548`）未提 1.12.0 的可见性探针（`client.js:3387`）、连续失败停用（`healStopped`）、重新启用按钮；`:14` 说三套共用 `paperC 0.0053`，`:189` 说逐套 0.014/0.009/0.0125（后者是纸面**有效值**口径，混在同一节里没有换算说明） |
| P2-8 | **成立** | `DESIGN.md:95` 写 `+0.022 / +0.014`，代码是 `inkC 0.021 / inkDarkC 0.016`（`client.js:527`）；`:203` 写 `0.008`，常量 `RAMP_MIN_GAP = 0.006`（`:1446`） |
| P2-9 | **成立，范围有误** | registry 实测 28 个版本；CHANGELOG 未发布的版本**节 27 个**（26 个不同版本号 —— `1.0.0` 有两节）。报告写"1.9.0–1.9.7"不对：**1.9.7 已发布**（registry 有）。真实缺口是 `1.9.0–1.9.6`、`1.9.8`、`1.8.4`、`1.0.0–1.2.0`、`0.7.0–0.18.0` |
| P2-10 | **成立** | 4 份 locale 只有 `meta.title` / `meta.description`；`grep -rn "locale/"` 的消费者只有 `package.json` 的 `exports` 与 `check-pack.mjs:29` 的必需清单，运行时 0 读取 |
| P2-11 | **成立** | README 集 = {en,zh,es,pt,hi}；locale 集 = {en,zh,zh-TW,ja}；UI 语言集 = {zh-CN,zh-TW,en,ja}。三套互不覆盖 |
| P2-12 | **成立** | `release.mjs:218` `catch { /* 网络不可达就当"没有" */ }` —— 网络错误被当成"版本不存在"；`:298` `catch { warn('前移失败，需要人工处理') }` 之后仍 `exit 0`，`latest` 继续指旧版 |
| P2-13 | **成立** | `client.js:2912` `(sf.label \|\| sf.id)` —— 数字面直接印 id，`menuL/menuD` 四个语种都印英文 `menu` |
| P2-14 | **成立** | `package.json` 的 `scripts` 只有 `check/report/packs/shots/sample-code`；`measure-preview` / `shoot-desktop` / `shoot-html` / `shoot-sheet` / `compare` 无别名。`ci.yml` 只跑 `check` + `report`，`packs` 不在 CI |
| P2-15 | **成立** | `git ls-files tools/baseline` = 4 张 PNG（`sheet-v1..v4`，各 ~410KB）；`tools/baseline-desktop/` 已 gitignore；`tools/compare.mjs` 无任何脚本/CI 引用，其输入目录 `tools/out/<run>` 也不在 CI 产物里 |
| P2-16 | **成立，体积略高** | 6 个 `.tgz`（`1.3.0`、`1.9.9`、`1.10.0`、`1.11.0`、`1.12.0`、`1.13.0`）实测合计 **1571.6 KB（1.57 MB）**，报告写 ~1.9MB；`.gitignore:11` 有 `*.tgz`，确为未跟踪的本地噪音 |

---

## 4. P3 —— 逐条核实（8 条全部成立）

| # | 判定 | 读数 |
|---|---|---|
| `check-audit.mjs:397` `seen.every(...)` | **成立** | 空数组上恒真；前面 `for` 循环若一条 warn 都没打出，这条"告警文案附带合法值清单"会空转通过 |
| `check-colormath.mjs:84` 恒真子句 | **成立** | `Math.abs(((h2-h+540)%360)-180-0) <= 180` 的值域恒在 `[0,180]`，永真；真正有色相断言的是下一行 `dh <= 2.5` |
| `check-custom.mjs:70` `fail()` printf | **成立** | `fail('...%d 种强调只出 %d 种滚动条色', ACCENTS.length, scrolls.size)`，而 `fail` 只接收 `msg` —— 失败时打印字面 `%d` |
| `check-all.mjs` 头部"六件套" | **成立** | 实际 7 个脚本；`ci.yml` 的步骤名也写"六件套" |
| `CONTRAST_ROLES[].step` 死数据 | **成立** | `client.js:349-354` 的 `step` 全仓 0 引用（真正渲染用 `CONTRAST_ROLE_TOKENS`，`:366-371`），两者可无声漂移 |
| `enforceRampOrder` 的 `changed` 没人读 | **成立** | `client.js:1451` 返回 `changed`，唯一调用点 `:1815` 丢弃返回值 |
| `check-audit.mjs` 分组编号乱序 | **成立** | 输出顺序是 …`17)` → **`19)`** → **`18)`** → `20)`；`19)`（高对比边框）在 `18)`（右栏不接管）之前 |
| `client.js:690` 锚点注释 | **成立** | 注释写 `106.04 / -107.88`，实际发出 `106 / -108`（整数取整）—— 修 P1-8 后注释会自动变正确 |

---

## 5. 审计报告自身需要更正的七处

> 这一节是"被审方的回执"里最该写清楚的部分：报告的 34 条结论全部成立，但证据与修复建议里有七处需要更正。
> 不更正它们，下一轮会照着错数字复现，或者照抄一个**会让换算差 100 倍**的修法。

| # | 报告原文 | 实测 | 性质 |
|---|---|---|---|
| 2.1 | P1-1 表格：`MIN_LINK_DARK 4.62 → 1.5 \| 0 红` | `check-all` **EXIT=1**（红在 `check-ui` 的预览页哈希门，不在对比度断言） | **变异的结论方向相反**；该行反而证明"下限没有自己的断言" |
| 2.2 | P2-3："红 vs 绿本插件给 22.33" | **51.98**（CIE76 的 170.58 正确） | 数字错 |
| 2.3 | P2-9："无 1.9.8、1.9.0–1.9.7…" | `1.9.7` **在** registry；未发布版本节共 27 个（26 个版本号，`1.0.0` 两节） | 范围错（总数对） |
| 2.4 | P2-16："~1.9MB" | 1.57 MB | 体积高估 |
| 2.5 | P1-2："探针 404 → npm publish 去发 1.13.1 → 与 P0-1 叠加" | 若该版本已在 registry 则 **E409 变红**；危险分支是"tag 向前、package.json 未发布" | 后果链收窄 |
| 2.6 | P0-2 表格把 6 条死链压成两行 | 计数正确（5×`tools/README.md` + 1×`AUDIT-2026-10-27.md`） | 表述（非错误），记录以免误读 |
| **2.7** | **P1-8 修复："返回 `Math.round(out * 10000) / 100`（0.01 Lc 精度）"** | **这个公式返回的是 `Lc` 本身，差 100 倍** —— `out` 已经是 `Lc/100`，0.01 Lc 精度必须 `/ 10000`。照抄的后果：`raiseToLc` 里那个 `×100` 换算变成 ×1，实测 `worst()` 算出 **−4708**，深色链接被压暗成 `#c8a28b`（原 `#e0b9a1`），CVD 断言当场变红 | **修复建议本身是错的**（实装验证后改用 `/ 10000`，并在代码注释里写明原因） |

---

## 6. 处置计划（按报告 §6 的顺序）

| 序号 | 条目 | 处置 |
|---|---|---|
| 1 | P0-1 | `tools/check-pack.mjs` 增加四条一致性断言：`package.json` ↔ `PLUGIN_VERSION` ↔ `screenshots.meta.json` ↔ CHANGELOG 最新 `### 版本` |
| 2 | P0-2 | 方案 A：`files` 加 `tools/README.md` 与 `AUDIT-2026-10-27.md`；`check-pack` 的 REQUIRED 同步；**另加"包内相对链接不得指向包外文件"的通用断言**（防下一个死链） |
| 3 | P1-1 | dev 钩子导出下限常量；`check-audit` 加字面量断言；`physicalCeiling` / `limitedByPhysics` 改为**独立复算**（用渲染 token 现算，不再读被测字段） |
| 4 | P1-2 | `publish.yml` 在发布前断言 `tag 版本 === package.json 版本` |
| 5 | P1-3 | `release.mjs` 换宽松正则，找不到 `PLUGIN_VERSION` 从 `warn` 改 `die` |
| 6 | P1-7 | `RAMP_ORDER` 补 `'900'`；`check-audit` 加"BASE 每个 numeric 档都在 RAMP_ORDER 里"的断言 |
| 7 | P1-8 | `apcaContrast` 精度改 0.01 Lc；`check-audit` 钉 APCA 公开参考值与 ×100 换算 |
| 8 | P1-4 | 契约脚本支持从 `node_modules` 的宿主 peer 包取证（asar 优先）；host 三包进 devDependencies；CI 加 `--strict` 硬门 |
| 9 | P1-5 | `check-all.mjs` 导出 `SCRIPTS`（可导入不执行）；`release.mjs` 改成调用同一入口 |
| 10 | P1-6 | `insert-readme-sections.mjs` 改为运行时用 `sample-code` 生成 `SAMPLE`；接入 `check-all` |
| 11 | P2-1…P2-16 | 逐条：注释/校验/文案/回退/lang/README 补齐/DESIGN 章节与数字/CHANGELOG 标注/locale 定性与键集断言/README-ja 与 locale 补齐/release 网络错误/矩阵面名/脚本别名/baseline 出库/.tgz 清理 |
| 12 | P3-1…P3-8 | 逐条：空数组守卫/删恒真子句/模板字符串/件数动态/删死数据/删死变量/编号对调/（P1-8 修复后锚点注释自动成立） |

---

## 7. 处置结果

> 全部 34 条都已落地，工作树状态：`client.js` / `package.json` / 6 份 README / `CHANGELOG.md` /
> `docs/DESIGN.md` / `docs/WORKFLOW-NOTES.md` / 2 个 workflow / 11 个 tools 脚本 / 新增 3 份 locale 与 `tools/clean.mjs` /
> 新增反哺报告；6 个遗留 `.tgz` 与 `tools/baseline/*.png` 出库。**未 commit、未打 tag、未发 npm**（见 §9）。

| # | 条目 | 状态 | 落点 | 验证（可复现） |
|---|---|---|---|---|
| 1 | P0-1 版本漂移 | ✅ 已修 | `tools/check-pack.mjs` 四路对账（package.json / PLUGIN_VERSION / screenshots.meta / CHANGELOG 最新节）；`check-ui` 第四条 notice 断言 | 变异：`version → 1.99.0` → `check-pack` 红 |
| 2 | P0-2 包内死链 | ✅ 已修 | `files` 加 `tools/README.md` + `AUDIT-2026-10-27.md`；`check-pack` 新增**包内相对链接自包含**扫描（扫 10 份 markdown） | 变异：从 `files` 删 `tools/README.md` → 红 |
| 3 | P1-1 承诺无锚点 | ✅ 已修 | dev 钩子补导出 `MIN_*` / `FLOORS_HC*` / `RAMP_MIN_GAP` / `RAMP_ORDER` / `hexToRgb`；`check-audit` 第 22 组 8 条**字面量**断言；第 23 组 216 格**独立复算** | 变异：`CONTRAST_FLOOR 4.5→1.0`、`MIN_LINK_DARK→1.5` 均红（原先全绿） |
| 4 | P1-2 tag 不校验 | ✅ 已修 | `publish.yml` 新增「断言 tag 与 package.json 版本一致」步骤（发布前第一道） | 代码走查 + `release.mjs --dry` 全流程通过 |
| 5 | P1-3 正则静默失效 | ✅ 已修 | `release.mjs` 换宽松正则，匹配不到改 `die` | `--dry` 打印「PLUGIN_VERSION 与 package.json 一致：1.13.2」 |
| 6 | P1-4 契约 0 断言 | ✅ 已修 | `check-host-contract.mjs` 支持 asar **或** `node_modules` 宿主 peer 包；三包进 devDependencies（钉 `0.2.1-rc.2`）；CI 加 `npm install` + `npm run contract`（`--strict`） | `--asar C:/nonexistent/app.asar --strict` 走 peer 包路径**通过**（16 条断言） |
| 7 | P1-5 清单两处维护 | ✅ 已修 | `release.mjs` 直接调用 `tools/check-all.mjs`，删掉自己那份 5 脚本清单；SKIP 仍单独告警 | `--dry` 输出「8 / 8 项」 |
| 8 | P1-6 insert 休眠损坏 | ✅ 已修 | `insert-readme-sections.mjs` 改为 `import { generateSampleCode }`（`sample-code.mjs` 导出函数 + main 守卫），接入 `check-all` 第 7 项 | `npm run check` 里它 ✓（此前干净检出必红） |
| 9 | P1-7 漏 900 | ✅ 已修 | `RAMP_ORDER` 补 `'900'`；`check-audit` 第 25 组断言「构建出的每档都在顺序表里」+ 严格递减 | 变异：抽掉 `'900'` → 红 |
| 10 | P1-8 Lc 取整 | ✅ 已修 | `apcaContrast` 精度 0.01 Lc；第 24 组钉 106.04 / −107.88 / 63.06 + `raiseToLc` 的 ×100 | 变异：退回整数 → 红 |
| 11 | P2-1…P2-16 | ✅ 16 条全修 | 见下表 | 见 §8 |
| 12 | P3-1…P3-8 | ✅ 8 条全修 | 空数组守卫 / 删恒真子句 / 模板字符串 / 件数动态 / 删死数据 / 删死值 / 分组 18-19 升序 / 锚点注释随 P1-8 变正确 | `check-audit` 26 组全绿 |

### P2 逐条落点

| 条目 | 处置 |
|---|---|
| P2-1 `mixHex` 注释 | 注释改成真相（gamma 编码 sRGB 分量插值），并说明为什么**刻意**不在线性光里混（黑→白中点会从 `#808080` 变 `#bcbcbc`） |
| P2-2 `hexToRgb` 无校验 | 加 `HEX6_RE` → 非法返回 `null`；`toOklch` / `luminance` / `apcaY` / `mixHex` / `flatten` / `simulateCvd` 全部有定义回退；`check-audit` 第 26 组断言 |
| P2-3 `ΔE` 标签 | UI 四语文案改「OKLab ΔE」，`deltaE` 注释写明与 CIE76 的量级差（实得 51.98 vs 170.58） |
| P2-4 回退语言 | `TEXT[locale] \|\| TEXT['en']` / `LABELS[loc] \|\| LABELS['en']`，与 `pickLocale` 同口径 |
| P2-5 `<section lang>` | 改用解析后的 `locale`（不再读宿主 `documentElement.lang`） |
| P2-6 es/pt/hi 少一条 | 三条补齐；`check-ui` 新增「六语 `## What it does` 要点条数一致」断言 |
| P2-7 DESIGN 缺 i18n / 自愈过时 / 自相矛盾 | 新增「## 国际化（i18n）」整节；自愈节补 1.12.0 四件事（可见性探针 / 停用提示与重试 / 重入 / notice 联动）；`paperC` 矛盾改为「三套共用 0.0053，×paperScale 后 ≈0.0127」并说明旧的逐套值 |
| P2-8 DESIGN 数字 | `+0.022/+0.014` → `+0.021/+0.016`（两处）；`0.008` → `0.006` 并补 900 补漏说明 |
| P2-9 CHANGELOG 谎报版本 | 27 个未发布版本节加「（未发布）」+ 文件头口径说明；六语 README 的钉版本说明改成「标了未发布的别钉」 |
| P2-10 locale 死负载 | 定性为**市场页元数据**并写进 DESIGN / WORKFLOW-NOTES；`check-ui` 断言「只有 meta 两键 + 键集一致」 |
| P2-11 集合互不覆盖 | 补 `README-ja.md`（六语）与 `locale/es\|pt\|hi.json`；`check-ui` 断言 README 语言 ⊆ locale 语言、UI 四语齐全 |
| P2-12 release 吞失败 | registry 探针区分「网络/HTTP 错误」（die）与「404 不存在」；`dist-tag add` 失败改 die 并给出人工命令 |
| P2-13 矩阵面名 | `TEXT.surfaceNames` 四语；表头按 `sf.label` 查表（数字档仍印档位号） |
| P2-14 脚本无别名 / packs 不在 CI | 新增 `measure` / `shot-desktop` / `shot-html` / `shot-sheet` / `compare` / `sheet` / `preview` / `release` / `clean` 别名；六语 README 的 Development 段统一改 `npm run *`；CI 加 `npm run packs` |
| P2-15 baseline 入库 | `git rm --cached tools/baseline/*.png` + `.gitignore` 加 `tools/baseline/`；`tools/README.md` 说明基线是本地产物、用 `--update` 生成 |
| P2-16 6 个 .tgz | `tools/clean.mjs`（`npm run clean`，`--dry` 可预览）删除 6 个 tarball + `tools/out`；**刻意不删 `dist/`**（那是导出的主题包，可能是要交付的产物） |

---

## 8. 回归验证

### 8.1 门禁（工作树）

```
node tools/check-all.mjs        → 回归全部通过：8 / 8 项
node palette-dev.mjs            → EXIT 0（1080 组，硬失败 0）
node palette-dev.mjs --hc       → EXIT 0
npm run contract                → 契约检查通过（16 条，本机走 app.asar）
node tools/check-host-contract.mjs --asar C:/nonexistent/app.asar --strict
                                → 契约检查通过（改走 node_modules 的宿主 peer 包 —— CI 路径）
npm run packs                   → 8 个主题包（此前深色 3 个被静默丢弃，见 §9.2）
npm pack --dry-run              → 28 文件 / 455.9 KB（解包 751.1 KB）
node tools/release.mjs --dry    → 全流程通过（临时 git 仓：版本闸门 → 8/8 回归 → 两档 1080 组 →
                                  工作区干净 → registry 探针「没有 1.13.2」）
```

`check-audit` 的断言数 **389 → 411**（新增第 22–26 组共 22 条：字面量下限 8、独立复算 2（覆盖 216 格）、
APCA 5、色阶 4、畸形 hex 3）；`check-ui` **70 → 106**（六语 README 要点条数 7 条、locale 元数据 18 条、
以及 README-ja 带来的既有断言）；`insert-readme-sections --check` 作为第 7 项进了 `check-all`。

### 8.2 变异测试（证明门有牙齿）

八个变异逐个应用到**临时副本**，跑完整 `check-all`，全部被抓：

| 变异 | 期望红在 | 实测 |
|---|---|---|
| `package.json version → 1.99.0` | check-pack | ✗ 版本四处一致（1.99.0 ≠ 1.13.2） |
| `files` 去掉 `tools/README.md` | check-pack | ✗ 包里少了必需文件 + 死链 |
| `CONTRAST_FLOOR 4.5 → 1.0` | check-audit | ✗ CONTRAST_FLOOR === 4.5（实得 1） |
| `MIN_LINK_DARK 4.62 → 1.5` | check-audit | ✗ 链接下限（实得 4.95 / 1.5） |
| `RAMP_ORDER` 去掉 `'900'` | check-audit | ✗ 顺序表含 900（实得位置 -1） |
| APCA 精度退回整数 | check-audit | ✗ 黑 on 白 Lc 106.00 ≈ 106.04 |
| `hexToRgb` 退回无校验 | check-audit | ✗ 对畸形输入返回 null |
| 一份 README 的示例短码改一个字符 | check-ui / insert | ✗ README-ja 示例码解码/往返 |

对照：修改前同样两个变异（`CONTRAST_FLOOR`、`package.json` 版本）**全绿**。

### 8.3 截图与包

四张设置页截图已用 `npm run shots` 重拍（设置页文案/`lang`/矩阵表头都变了），
`screenshots.meta.json` 的 `pluginVersion` 随之更新到 `1.13.2`。

---

## 9. 留给用户的决定

### 9.1 版本与发布

工作树已 bump 到 **1.13.2**（`PLUGIN_VERSION` / `package.json` / 四语 notice / 截图元数据 / CHANGELOG 五处联动）。
**没有 commit、没有打 tag、没有发 npm**。要发布仍是两步：

```bash
git add -A && git commit -m "fix: 2026-10-29 审计反哺（34 条）"
node tools/release.mjs --ci        # 门禁 → 打签名 tag → 推 main+tag → Actions 用 Trusted Publishing 发布
```

> 1.13.1 带着 6 条死链发布上去了，1.13.2 是把它修掉的那个版本 —— 建议尽快发；不发的话，
> npm 上的 latest 会一直是那个自包含性有问题的包。

### 9.2 额外发现（审计没列，已修）

`tools/export-theme-pack.mjs` 用 `floors(false).main`（12:1，浅色口径）去卡**深色**包，
而深色正文的承诺是 10:1 —— 三套深色包一直被静默丢弃（`npm run packs` 退出 1）。
它从不在 CI 里跑，所以红了一年也没人看见。已改为按 `CONTRAST_TARGETS.main[mode].normal` 取目标，
8 个包全部导出。这条写进 §9 而不是 §1，是因为它不在审计范围内，属于"顺手撞见的"。

### 9.3 没做（明确不纳入本批）

- **拆文件（报告 §5.1）**：`client.js` 3920 → 多模块，是一次重构，不是修订；本轮动它会淹没 34 条的 diff。
- **迁到 `node:test`（§5.2）**、**黄金快照（§5.3）**、**变异测试入库（§5.4）**、**契约单源 JSON（§5.5）**、
  **i18n 真外置（§5.6）**、**端到端浏览器断言（§5.7）**：都是"进一步优化方向"，各自需要独立设计。
  其中 §5.4 的方法本轮**已经用了一次**（§8.2 的八个变异），只是没做成常驻脚本。
- 报告 §5 的 7 条方向本身我认同，尤其是 §5.3（黄金快照）：`check-audit` 现在守的是"承诺"，不是"逐 token 快照"，
  改一个常数仍可能连锁改 200 个 token 而只红一处。

