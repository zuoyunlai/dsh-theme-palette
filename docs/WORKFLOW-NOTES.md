# DSH 插件开发 · 流程笔记

> 从 `dsh-theme-palette` 这一轮真实事故里提炼的可复用动作。**每条都有出处**（哪次事故、哪个现象）。
> 配套：反哺报告 [`RETRO-2026-10-22.md`](./RETRO-2026-10-22.md) 记录"发生了什么"，本页只记"下次怎么做"。

---

## 1. 发布前：用**宿主语义**验证兼容性，别用库的默认语义

事故：我用 `semver.satisfies(v, range)` 算出「0.3.0-rc.1 会被拒」，差点发一个给假 bug 打补丁的版本；复核宿主源码发现它调用时带 `{ includePrerelease: true }`，结论**相反**。

宿主的判定函数（`app.asar` → app-boot）：

```js
function satisfies(runtimeVersion, range) {
  return range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })
}
```

规则：

- 声明 `engines.dsh` 之后，**宿主的接入门禁只看它**，peer 不再参与（0.2.1-alpha.4+）；
- 没有 `engines.dsh` 时退回读 `peerDependencies` 里 `@deepseek-ai/dsh*` 的声明；
- 两条都没有 ⇒ "admitted unread"，等于宣称兼容任何版本。

现在 `tools/release.mjs` 已内置断言：拒绝 `0.1.x / 0.2.0`（那一代不是 `exports["./client"]` 加载器），放行 `0.2.2-rc / 0.3-rc`。改 manifest 时它会直接失败。

---

## 2. 客户端插件：`exports["./client"]` 是生死线

事故：1.4.1 加 `exports` 补展示元数据，漏了 `"./client"` → 宿主 `client-modules` 抛错 → `modules`（required）起不来 → **整个 profile 的插件全部不加载**。

判定代码（`client-modules`）：

```js
const client = exportsField['./client']
if (client === undefined) throw new Error(`... declares dsh.client but exports no "./client" bundle`)
```

规则：

- 声明了 `dsh.client` 的包，`exports` 必须含 `"./client"`（且指向真实存在的文件）；
- 最省事的写法是**列全**：`"."`、`"./client"`、`"./client.js"`、`"./index.js"`、`"./cordis.patch.yml"`、`"./package.json"`、`"./locale/*.json"`、`"./icon"`；
- 官方 `dsh-plugin-dev check` **不校验这条**（当时 12 项全绿）；必须自己断言。

---

## 3. 安装/升级检查清单（每个插件都适用）

```bash
# 0) 先备份，再动手
cp ~/.dsh/profiles/<p>/package.json ~/.dsh/_backup/profile-<p>-$(date +%Y%m%d%H%M).json

# 1) 换版本必须删副本（pnpm 对已存在的 file:/目录不刷新内容）
rm -rf node_modules/<pkg> && pnpm install

# 2) 四项核对
node -e "const j=require('./node_modules/<pkg>/package.json');
  console.log('version', j.version);
  console.log('exports[./client]', j.exports && j.exports['./client']);
  console.log('engines.dsh', j.engines && j.engines.dsh);"
node -e "console.log(require('fs').readFileSync('./node_modules/<pkg>/cordis.patch.yml','utf8'))"   # 行名要对

# 3) 清单数量对得上（"插件全没了"多半是这里塌了）
node -e "const j=require('./package.json');console.log('bundles', j.dsh.profile.bundles.length)"
```

**profile 的 `dsh.profile.bundles` 被改写是真实事故**（28 → 2），用户看到的症状是"所有插件消失"。恢复靠备份；没有备份就只能从 `dependencies` 反推。

---

## 4. 别轻信"这个检查会自动重跑"

事故：awesome-dsh-plugin 的 gate 文案写着 "this check re-runs by itself … No need to resubmit, push, or close and reopen"；实际等待 40 分钟，失败结论一直停在旧 check-run 上，定时任务也没扫到我们。

做法：
- 先看 check-run 的 `completed_at` 是否变化（不是看 PR 页面缓存）；
- 仍未刷 → 在 PR 分支上推一个**空提交**（`tree` 不变）触发 `pull_request`，比 close/reopen 干净：

```bash
gh api -X POST repos/<me>/<repo>/git/commits --input - <<'EOF'
{"message":"Re-run checks","tree":"<same tree>","parents":["<head>"]}
EOF
gh api -X PATCH repos/<me>/<repo>/git/refs/heads/<branch> -f sha=<new>
```

---

## 5. Windows + 本机网络的两个固定绕行

| 现象 | 绕行 |
|---|---|
| `execFileSync('npm')` → `ENOENT`；改 `npm.cmd` → `EINVAL`（Node 20+ 拒绝直接 spawn `.cmd`） | 走 `node <npm-cli.js> <args>`，参数用数组，**不经 shell** |
| `git push` → `Connection reset by ... port 22` | `git config core.sshCommand "ssh -p 443 -o HostName=ssh.github.com"`（仓库级，可逆） |
| `npm publish` 打印 `+ pkg@ver` 但 registry 404 | 新包名走**暂存审核**，实测 8–10 分钟；等 `registry.npmjs.org/<pkg>/<ver>` 返回 200 再打 tag |
| 发布后 `latest` 没动 | `npm dist-tag add <pkg>@<ver> latest` |

---

## 6. 生态规范先查再动手

`awesome-dsh-plugin` / 主题目录的硬门槛，缺一条 PR 就会被 CI 拒：

- `package.json` 有 `dsh.bundle.patch` + 根目录 `cordis.patch.yml`；
- 仓库加 `dsh-plugin` topic（主题类再加 `dsh-theme`）；
- **五语 README**：`README.md`（英文源）+ `README-zh.md` / `-es.md` / `-pt.md` / `-hi.md`，且 `## ` 标题**逐字一致**；
- 展示元数据：`locale/<lang>.json` 的 `meta.title` / `meta.description` + `exports["./icon"]`；
- `files` 白名单只放运行时需要的（工具脚本不要进包）；
- 截图放**自己仓库**并声明 `screenshots.json`（1–8 张，相对路径），不要塞进目录仓库的 PR。

---

## 7. 版本号只在一处维护

事故：README 安装示例钉着 `1.4.0`，实际已 1.4.3。

做法：`package.json.version` 是唯一真源；`client.js` 的 `PLUGIN_VERSION` 由发版预检断言一致；README 里要么不写版本号，要么用发版脚本注入。

---

## 8. 承诺了的能力必须有端到端证据

事故：`tools/README.md` 写了"桌面真机截图回归"，实际 `shoot-desktop.mjs` 依赖一个**全仓无人创建**的全局钩子，永远跑不通。

做法：文档写下去的当天跑一次，留截图/日志；跑不通就如实降级说明。

---

## 9. Tag 签名：用 SSH，不一定要 GPG

**事故/现状**：1.5.2–1.6.0 的 tag 全部未签名（GitHub API `reason: unsigned`），但 Release 页面与
tgz 资产正常，很容易被误记成“已验证”。1.7.0 起改用本机 SSH key 签名并复核为 `verified: true`。

规则：

- Git ≥ 2.34 支持 SSH 签名（本机 2.56）；不需要 GPG。
- repo-local 配置（换机器/重新 clone 需重做）：

  ```bash
  git config --local gpg.format ssh
  git config --local user.signingkey "$HOME/.ssh/id_ed25519.pub"
  printf '%s %s\n' "<git email>" "$(cat "$HOME/.ssh/id_ed25519.pub")" > .git/allowed_signers
  git config --local gpg.ssh.allowedSignersFile .git/allowed_signers
  ```

  `user.signingkey` 也可以指向私钥路径；GitHub 只接收**公钥**，私钥绝不外传。

- 打签：`git tag -s vX.Y.Z -m "<pkg> X.Y.Z"`。已有 tag 重签：

  ```bash
  git tag -f -s vX.Y.Z -m "<pkg> X.Y.Z"
  git push --force origin vX.Y.Z
  ```

- 本地验签：`git tag -v vX.Y.Z`，应输出 `Good "git" signature for <email>`。
- **GitHub 验签另有一道门槛**：同一把公钥必须在 Settings → SSH and GPG keys 里以
  **Signing Key** 类型注册；只作 Authentication Key 时，API 返回
  `verified: false, reason: "unknown_key"`（签名本身有效，只是 GitHub 不认这把签名钥）。
- 远端复核：

  ```bash
  sha=$(git rev-parse vX.Y.Z^{tag})
  gh api "repos/<owner>/<repo>/git/tags/$sha" --jq '.verification'
  ```

  期望 `{"verified": true, "reason": "valid"}`。

- `tools/release.mjs` 的逻辑是“`user.signingkey` 有值就加 `-s`”，配置好后发版会自动签名；
  没有配置时只告警、不阻断。tag 签名与 npm publish 是两条链，npm 侧仍由 registry 的
  dist-tag / integrity 负责，签名不会让 npm 自动 Verified。

---

## 10. 设置页截图：改了 UI 就重拍，脚本和检查会替你抓

**事故**：1.9.10 撤掉了「右侧栏底色 / 面板底色」一档，但 `assets/screenshot-*.png` 还是
1.9.0 时拍的 —— 两个目录仓库的预览卡片继续展示一个已经不存在的控件，图里的版本徽标也停在
`v1.9.0`。直到有人肉眼比对才发现。

规则：

- 出图只有一条命令：

  ```bash
  node tools/shoot-settings.mjs        # 等价 --all：重拍 4 张并重写清单
  ```

  它按历史同构出四张（浅/深 折叠态，高对比/自定义 展开对比度矩阵），用无头 Chrome 整页截图，
  写完 `assets/screenshot-*.png` 后同步两份清单。单张模式：`--in <html> --out <png>`。
  本机没有 Chrome/Edge 时退出码 2 并说明原因，不会静默产出一张空图。

- 两份清单分工不同，**不要合并**：

  | 文件 | 形状 | 用途 |
  |---|---|---|
  | `screenshots.json` | 相对路径**数组**（1–8 条） | 目录仓库的提交契约，形状由对方解析，改了会掉卡片 |
  | `assets/screenshots.meta.json` | 对象（版本/尺寸/字节/sha256/源 HTML sha） | 本仓库的校验用清单 |

- 校验接在 `npm run check` / 发版门里（`tools/check-ui.mjs` 第 4 段），任一条红就说明该重拍：
  版本号与 `PLUGIN_VERSION` 不一致、图片字节与清单对不上、**源预览页的 sha 变了**
  （后者意味着设置页结构或配色动过）。

- 重拍后记得推 `main`：列表卡片热链的是本仓库 `main` 上的图片路径，
  推上去 CDN 几分钟后自动换图，**不需要再向目录仓库提 PR**。

- 不要为了“看着绿”用网页上传或重写历史；签名是给 tag 对象加签名块，force-push 只更新那个 tag。
