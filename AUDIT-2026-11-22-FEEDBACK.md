# dsh-theme-palette 1.13.6 审计反哺修订报告

日期：2026-11-22  
基线：main / 1b1a20b（本轮开始前）  
关联审计：[AUDIT-2026-11-22.md](AUDIT-2026-11-22.md)  
状态：逐项复核后进入实施；未发布、未提交。本报告区分已核实、实现中、需要运行时证据，不把建议写成既成事实。

## 0. 复核后更正

1. 审计原文“发布任务不跑严格宿主检查”表述过宽。实际 [publish.yml](.github/workflows/publish.yml) 会运行 `npm run check` 和 `npm run report`；但没有显式安装宿主 peer 测试依赖或单独跑 `npm run contract`。总入口 [check-all.mjs](tools/check-all.mjs) 对 exit 78 SKIP 不失败。修订目标是发布任务强制严格执行并记录来源、版本和 SHA，不是说发布完全没有测试。
2. “JSON 有 14 个 token 漏洞”应严格表述为宿主契约输出中的 14 个 token×模式未覆盖落点；本机执行只打印最多 8 个摘要样本，故当前仅有 JSON property/string/number/keyword 各自 light/dark 共 8 个样本的名字证据。完整 14 项、是否均属于应覆盖面，先展开检查和渲染验证；不凭摘要虚构其余名称。
3. presenter 写入正则失败是源码模式断言失败，不等于实际页面已失效。先读当前 app.asar 源码和实际 CSSOM 做验证，再决定改契约脚本或客户端。
4. 早先称 `npm run check` 八项都因 EPERM 失败，后续独立运行已证明 check-audit、check-custom、check-selfheal、check-colormath 和标准/HC palette-dev 报表可以通过。总入口八个子进程确实被当前执行器 EPERM 阻止，check-ui、README、pack 仍缺本轮通过证据。不得把总入口阻断归因成测试 assertion 失败。
5. 工作区已有 .gitignore 修改、PROMO-cover-16x9.jpg、PROMO-zhihu.md 未跟踪；均为用户已有状态，本轮不覆盖、不清理、不纳入本修订。

## 1. 可执行修订批次

顺序约束：发布路径绑定与门禁 → 发布结果语义 → 契约测量可信度 → 颜色覆盖决策 → 验证与文档。每一项完成后跑表中验收，不得因某一项脚本全绿就跳过运行时证据。

### A. P1 发布任务按输入 tag 检出并绑定 SHA

**复核证据：** publish.yml 有 `workflow_dispatch.inputs.tag`；checkout 未指定 ref；版本比较只证 package.json.version 与 tag 版本，不能证明源码提交来源相同。

**改动：** 把 tag 输入作为不可信输入：限定为 `v[0-9]+.[0-9]+.[0-9]+(含可选 prerelease/build 的规范 SemVer)`；push 事件使用 github.ref。用显式 ref checkout 目标 tag，禁止表达式直接拼接 shell；校验 tag 存在、解析 tag commit SHA；输出 tag、SHA、包版本到受控环境变量。npm publish 前再次断言当前 HEAD 等于目标 SHA、tag 指向该 SHA、包名/版本对应 tag。触发来源/手动输入和同 tag 并发均进入稳定 concurrency group。

**验收：** 在临时本地仓库造两个版本号相同但源码不同的提交与 tag：工作流解析结果必须严格等于 tag SHA；非法 tag、缺失 tag、tag/package 版本不符均在任何 npm 发布步骤前 fail closed。检查 YAML 语法与 Actions expression；不得触发真实发布。

### B. P1 发布任务对宿主契约硬失败

**改动：** 当前无锁文件，先沿用普通 CI 的 npm install 与固定版本宿主 peer；双基线验证单列待办；发布步骤在发布前运行 `npm install --no-audit --no-fund`、`npm run contract`、`npm run check`、`npm run report`。合同失败不可被 78 吞掉。保留已有版本比对和包检查。

**验收：** 无 asar、peer 包缺失或契约脚本不能载入时退出非零；严格门覆盖 tag 路径；CI 与发布日志列出插件 SHA、node/npm、宿主 peer 版本及取证来源。检查 npm ci 与 package-lock 的现状后再选择锁文件策略，不擅自生成或升级依赖。

### C. P1/P2 presenter 与颜色覆盖契约

**改动：** 先用当前安装 app.asar 复核 presenter 实际代码。将 brittle 的局部源码正则改成有版本化 fixture 的语义检查；当前引擎已有 JSDOM/仿真测试时复用，不引入新运行时依赖。检查实现透明输出完整覆盖差集、类别和 light/dark；循环链应报 unresolved，不能误判 covered。检查缺 hook/dev API/空 expected 时严格失败。

**验收：** presenter 写入/清理 fixture 对应已验证宿主语义；缺失 setProperty 或 removeProperty 的变异必失败；制造循环 token 必报 unresolved；14 个落点完整列出。JSON 角色是否接管，以真实树组件的前景、背景、明暗切换和语法区分验收后决定，未确认前不调色、不删白名单、不夸大覆盖声明。

### D. P2 GitHub Release Latest 保护

**改动：** 不再对每次 create/edit 无条件传 --latest。显式判定目标是否为仓库当前应当标 latest 的发布版本；历史补资产只更新资产和说明。对于无法判断的情况保持现状并提示，不自动降级 Latest。

**验收：** 模拟新版本创建、当前版本重跑补资产、旧版本补资产三种情形；只有新版本晋升，旧版本前后 Latest 不变。

### E. P2 本地 release --tag 推送失败状态正确

**改动：** 本地发布结束后若 --tag 的 git push 失败，脚本以非零退出，明确提示 npm 版本可能已发布、tag 未推送，不暗示可安全重发 npm。tag 已存在时只允许验证其 peeled commit 等于 HEAD 后幂等推送；不同提交立即失败，不改写 tag。

**验收：** 用临时 Git remote 注入 push 拒绝；确认退出非零、远端 tag 未创建、输出指出不要重发 npm。相同 HEAD 的现存 tag 可安全复用；不同 HEAD 的 tag 拒绝。

### F. P2 工具覆盖报告和例外文档

**改动：** 在完成 C 的真实差集后，更新 README 的“覆盖”计数与类别说明；报告注明宿主构建版本。对刻意不接管的 overlay/mask 等例外逐项说明理由，不使用“全部颜色”描述含例外或尚未测量的对象。

**验收：** 契约报告中的 observed/covered/approved-exception/unresolved 数量可复算；README 数字来自脚本或明确样本口径；文档链接与实际包内容一致。

## 2. 执行记录

| 批次 | 状态 | 修改文件 | 验收证据 |
|---|---|---|---|
| A tag-SHA 绑定 | 见下方实施回执 | .github/workflows/publish.yml | 临时 git fixture + workflow 静态解析 |
| B 发布严格门 | 见下方实施回执 | .github/workflows/publish.yml、必要时 ci.yml/package manifest | 严格 contract 与 npm ci 可复现性 |
| C 契约真实语义 | 见下方实施回执 | tools/check-host-contract.mjs、必要时独立测试 fixture | strict contract、host fixture mutation |
| D Latest 保护 | 见下方实施回执 | .github/workflows/publish.yml | 三情形离线/模拟测试 |
| E release 失败语义 | 见下方实施回执 | tools/release.mjs、必要时测试 | 临时 Git remote 故障注入 |
| F 覆盖口径 | 见下方实施回执 | README、必要时契约报告 | 完整差集与包链接测试 |

## 3. 当前验证基线

通过：`node tools/check-colormath.mjs`、`node tools/check-custom.mjs`、`node tools/check-selfheal.mjs`、`node tools/check-audit.mjs`、`node palette-dev.mjs`、`node palette-dev.mjs --hc`，均 exit 0。

失败：`node tools/check-host-contract.mjs --strict` exit 1；两条：presenter 源码正则不匹配、颜色覆盖漏 14 个 token×模式落点（仅前 8 样本输出）。普通总入口 `npm run check` 受子进程 EPERM 阻断；该运行器下 UI、README、pack 检查未完整执行。后续可直接单跑这些脚本区分环境问题与脚本断言。

**未做：** 未 commit、未 push、未发布；未修改用户既有工作区改动；未将任何静态检查称为 GUI/无障碍运行时通过。

## 4. 第一批实施回执（以下为实际状态）

A/B：工作流已加入按 tag 检出、peeled commit 与 HEAD 对账、显式安装依赖和严格 contract。未执行 Actions；同版本双提交、最低与当前宿主双基线演练仍待验。

C：严格模式已加入非空期望表、消费集和声明集检查；循环单列失败，摘要不再截断。复跑 strict exit 1：46 条别名零漂移；81 个消费 token 中，JSON 树 property、string、number、keyword、punctuation、icon、hover 各有浅深两个 literal，共 14 项。前五项测文字，icon 测图形，hover 测状态背景；不可把同一文字指标套在三者上。presenter 写入仍是源码断言失败；隔离 GUI 行为未测，不放宽断言。

D：历史补包不强制晋升，创建旧 Release 显式 latest=false；仅稳定版本与 npm latest 一致才晋升。未调用远程 Release。

E：本地 --tag 推送失败现以非零退出，明确勿重发 npm；node --check tools/release.mjs 退出 0。已有同提交 tag 的复用及模拟远端拒绝仍待验。

F：完整差集已登记；各语言 README 口径同步尚未完成。下一批先取得 presenter 与实际 JSON 树的计算样式，决定接管或保留哪些角色，再更新覆盖声明。当前不宜发布。

## 5. 后续验收记录

E（标签身份，已验）：本地 --tag 在发布前校验现有标签；重试时仅复用指向 HEAD 的标签，不改写不同提交的标签。`node tools/check-release-tag.mjs` 退出 0：无标签、同提交、不同提交、Git 查询失败四个分支按预期。`node --check tools/release.mjs` 与该文件的 `git diff --check` 均退出 0。此处是注入 Git 替身的单测，不是临时 remote 拒推后的端到端恢复证据；后者仍待验。

F（用户文档）：六语 README 已明确 2026-11-22 所检桌面构建的 JSON 树有七个颜色角色在两种模式下仍取自宿主，撤销跨构建的全覆盖承诺。README 示例短码检查及六语补丁格式检查均退出 0。此处只修正文档；尚无真实树组件的对比度或 presenter 生命周期验收证据。

D（Latest，离线验收）：`bash tools/check-release-latest.sh` 直接回放工作流判定段，npm 与 gh 均由本地函数替代。稳定最新版创建、已有旧版补资产、旧版首次补建、预发布版 4/4 通过。首轮范围截取失败（127），改按外层 fi 定界后复跑退出 0。没有调用 registry 或 GitHub。

C（presenter 静态误报已修）：当前 app.asar 的 ThemePresenter.apply 先从 body 删除 appliedTokens，再写入 snapshot.active.tokens 并登记键；旧表达式依赖空格而漏配压缩代码。`node tools/check-host-contract.mjs --strict --test-presenter-controls` 的写入、先清后写和两个删除循环负对照均通过。严格检查从两项失败降为一项（JSON 树 14 个落点，退出 1）。本项只认源码结构；不据此宣称浏览器渲染或自愈链路已通过。

B（依赖回退和缺失对照）：工作区指定不存在的 asar 时回退到 theme/layout/frontend 三个已安装 peer（版本分别为 0.2.1-rc.2、0.2.1-rc.2、0.2.1-rc.2），strict 退出 0，46 条别名无漂移，66 个消费 token 的覆盖检查通过。将原检查脚本复制到无 node_modules 的临时根目录，两次显式指定不存在的 asar，普通模式退出 78、严格模式退出 1。没有挪动或安装依赖。该正向结果是旧 peer 基线，不代表 81-token 桌面构建也通过。

A（实际工作流源码身份回放）：首次临时克隆因硬链接不可用退出 128，未执行断言。改为 --no-hardlinks 后，`bash tools/check-release-source.sh` 退出 0，4/4：标签 v1.13.5 所指 c8fe56d 通过；同为 1.13.5 的 eaaa990、缺少标签、包版本不符均被拒。仅回放工作流 SHA/版本检查，未执行 GitHub checkout Action。

F（分类计数）：旧 peer 基线 token×模式: {"total":132,"covered":118,"indirect":12,"exception":2,"unresolved":0}；桌面 asar token×模式: {"total":162,"covered":126,"indirect":20,"exception":2,"unresolved":14}。单位为 token×模式，按插件声明集合计算，不是每个配色的实机像素覆盖。两组四类之和均等于总数；严格检查分别退出 0 和 1，未增加白名单。

复核：默认 npm 缓存预演曾因 EPERM 失败；改用临时缓存运行 `npm pack --offline --ignore-scripts --dry-run --json --cache "$(mktemp -d)"` 成功。1.13.6 清单含 28 个文件，tools 下仅 tools/README.md，未包含新演练脚本。来源绑定及 Latest 离线回放分别 4/4；旧 peer 严格契约退出 0，当前 asar 仍退出 1。已移除只产生空 override/ratio 的 --json-matrix 分支；静态链路分类保留，不作 DOM 或像素测量证据。

E（拒推恢复）：node tools/check-release-recovery.mjs 退出 0；回放生产 Git 收尾代码，使用 Git 替身注入拒绝。失败不打印完成，重试使用原标签，标签创建一次、模拟推送两次。未执行真实推送或 npm 发布。

C（隔离 Chrome，宿主呈现器）：从本机 app.asar 取出实际 ThemePresenter 类及其常量，在代理浏览器的独立 about:blank 页执行。输入测试快照含 --dshtp-layer=active 和 --test-canvas=#1a1613；body 背景使用该变量，回退 white。依次观察初始、apply、空快照 apply、再次 apply、dispose；CSSOM 标记依次为空/active/空/active/空，计算背景依次为白色/#1a1613/白色/#1a1613/白色，五次断言通过。此处未启动完整 DSH、未写用户配置，也不是 JSON 树可读性证据。

C（JSON 树承载面及错误态）：`node tools/check-host-contract.mjs --strict --json-tree-css` 从当前 asar 构建提取 14 条相关 CSS 规则。普通树根 ._root_p8yna_1 声明七个本地颜色变量，分别取宿主 JSON 别名，背景为 --dsw-alias-bg-layer-1；不能直接用 body 画布代替承载面。轨迹详情中的 errorPayload 选择器另为五种文字及图标赋错误色，不改 hover。该结果是构建规则取证，非组件级 CSSOM 或可读性结论；严格退出仍为 1。

C（暖砂标准档、普通树 CSS 夹具）：Chrome 加载 asar 中实际选择器、六个前景角色和生产引擎 layer-1 背景；逐节点读取 getComputedStyle 后算 WCAG。不是 React 组件挂载或完整宿主验收。

|模式|角色|背景|前景|比值|
|---|---|---|---|---:|
|light|property|rgb(253, 251, 248)|rgb(136, 19, 145)|7.98|
|light|string|rgb(253, 251, 248)|rgb(196, 26, 22)|5.8|
|light|number|rgb(253, 251, 248)|rgb(28, 0, 207)|10.42|
|light|keyword|rgb(253, 251, 248)|rgb(28, 0, 207)|10.42|
|light|punctuation|rgb(253, 251, 248)|rgb(32, 33, 36)|15.59|
|light|icon|rgb(253, 251, 248)|rgb(95, 99, 104)|5.86|
|dark|property|rgb(34, 29, 25)|rgb(93, 176, 215)|6.88|
|dark|string|rgb(34, 29, 25)|rgb(242, 139, 130)|6.99|
|dark|number|rgb(34, 29, 25)|rgb(153, 200, 255)|9.59|
|dark|keyword|rgb(34, 29, 25)|rgb(153, 200, 255)|9.59|
|dark|punctuation|rgb(34, 29, 25)|rgb(232, 234, 237)|13.85|
|dark|icon|rgb(34, 29, 25)|rgb(154, 160, 166)|6.32|

C（JSON 树七角色已接管，取代上文"仍取自宿主"的记载）：buildTokensRaw 在染色配色下声明 --dsw-alias-json-tree-{property,string,number,keyword,punctuation,icon,hover}：六个前景先按配色色相做温度调和（沿用 8° 封顶 / 0.88 色度），再在树自身承载面（bg-layer-1：浅 00 / 深 875）上求解到 ≥ 5.0；悬停是 ≤8% 的强调色叠加。黑白配色与宿主错误态不动。

验证：`node tools/check-json-tree.mjs` 退出 0，最低 5.14:1（custom / light / string），另断言角色两两 ΔE ≥ 10、黑白不声明、悬停为低位 8 位 hex、同入参可重复。`node tools/check-host-contract.mjs --strict` 由 1 转 0：token×模式 162 项中 covered 140 / indirect 20 / exception 2 / unresolved 0。check-audit、check-custom、check-colormath、check-selfheal、palette-dev 两档均退出 0。六语 README 的覆盖说明同步改成"语法色参与重建"，不再写"仍取自宿主"。

仍未执行：真实 DSH 窗口里的树组件 CSSOM 读取；check-ui 在本机失败是因为它与 preview-settings 需要写 tools/preview-*.html，而该目录在本会话沙箱内禁止写入（`printf x > tools/__perm_probe` 直接被拒），不是断言失败，也未被计入通过。

C（真实插件 token 在浏览器里的树颜色，2026-11-22 收口）：用生产引擎为 5 套配色 × 明暗生成七角色值，在隔离 Chrome 里注入 asar 中的宿主树选择器，按宿主类名挂节点，读 getComputedStyle。共 60 行读数、0 个错误：

- 染色配色的 48 行 **逐行等于插件 token**（浏览器完成了 `--json-tree-* → --dsw-alias-json-tree-*` 的 var 链）；
- 全部 60 行对树自身背景（layer-1）**均 ≥ 5**，最低 5.14（custom / 浅色 / 字符串），其次 5.29、5.41、5.63；
- 黑白配色 12 行仍是宿主原色（property #881391 / 8.24 等），符合"黑白不重建"的约定。

门禁收口（本机，全部退出 0）：`npm run check` **11 / 11 项**（含本轮新增的 check-json-tree 与 check-release-tag）；`node tools/check-ui.mjs` 结构检查通过（此前失败是沙箱禁止写 tools/preview-*.html，放开写权限后即通过，属环境而非断言）。

仍未执行：在完整 DSH 窗口里读树组件的计算样式（需要启动宿主；本次按"不碰日用 profile"的约束未做），以及 GitHub Actions 上的 publish.yml 实跑（本轮明确不发布）。

## 6. 第二批（发版收尾与三项前端改进）

### 版本与变更记录
- package.json、PLUGIN_VERSION、assets/screenshots.meta.json、CHANGELOG.md 全部到 **1.13.7**；
  CHANGELOG 新增一节：JSON 树七角色、契约测量修复、发布链三处改动、新增测试与「未做」两项。
- 升级提示（简/繁/英/日）同步为 1.13.7 的内容；npm run shots 重拍四张截图并重写清单
  （截图与预览页哈希绑定，文案变了必须重拍，否则 check-ui 会红）。

### 阅读样本（审计建议 1）
设置页新增样本区：正文、链接、行内码、代码块、工具 JSON（属性/字符串/数字/关键字四色直接引用新 token）、
diff 的 +/- 行。它跟着当前配色实时变，等于把「日常真会读到的东西」放进设置页。
check-ui 新增三条静态断言（样本区存在、四角色类名齐全、diff 两行存在）。

### 试色撤销（审计建议 2）
换配色、导入、派生、恢复默认之前各留一份「上一次配色 + 三色」快照，只保留最近一次；
「撤销上一次」按钮恢复它，第二次撤销失效，同值再选不留快照。实现收敛在 store 层
（snapshotForUndo / undoLastChange），UI 只多一个按钮。
check-selfheal 里加了 16 条运行时断言（同值不留快照、撤销恢复配色与三色、快照失效、二次撤销无效、
恢复默认可撤销），随总入口一起跑。

### 诊断分层（审计建议 3）
getDiagnostics() 现在给出 layers.engine / layers.host / layers.unmeasured 三段：引擎值照旧
（settings + 对比度报表 + 覆盖报告），宿主值来自 getComputedStyle(document.body)（取不到就写
{ ok:false, reason }，不猜），未测量项显式列出。旧字段保留在顶层，向后兼容。

### 本批门禁
- npm run check **11 / 11** 通过；npm run shots 成功（4 张，插件 1.13.7）。
- 仍**未做**：完整 DSH 窗口里读树组件计算样式；GitHub Actions 实跑 publish.yml。
