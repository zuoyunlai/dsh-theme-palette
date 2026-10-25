/**
 * dsh-theme-palette — DSH Web/Desktop 主题配色（与明暗模式正交）
 *
 * 设计要点
 *   1. 不注册新主题、不写 ThemeRuntime 的 preference —— 用 ctx.theme.overrideTokens()
 *      叠一层 token 覆盖层。明暗仍由官方「外观」行控制（light / dark / system），
 *      两个轴完全独立。
 *   2. 覆盖「静态色阶」（--dsw-static-*）：官方别名几乎都是
 *      var(--dsw-static-neutral-bluish-NN) 这类引用，色阶一改，bg-base / bg-layer-* /
 *      label-* / link / brand 全部自动跟随，不会出现半套颜色。
 *   3. 色阶在 OKLCH 空间重建：**亮度保留、色相与色度按角色重给**。
 *      近白端略微压暗（纯白上不了色），正文只给极低色度（保证字形锐利），
 *      深色底给足够色度（深咖 / 深靛 / 墨绿读得出来）。
 *   4. 文字与链接再做一次对比度求解：达不到阈值就微调亮度（最多 ±0.09），
 *      三级文字与链接在浅色、深色两套底色上都达到 AA。
 *   5. 边框、遮罩、骨架屏这些**字面量**别名单独染色（用色阶两端做 alpha），
 *      否则暖色底配纯黑发丝线会显脏。
 *
 * 约束：不 require 任何 @deepseek-ai/dsh-client-* 包；不往 document.body 追加东西；
 *      所有注册走 ctx.effect / ctx.slots。
 */
window.__ModuleLoader__.load({
  id: 'dsh-theme-palette',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const PLUGIN_VERSION = '1.9.10'
    const STORE_KEY = 'dsh-theme-palette.v1'
    const OVERRIDE_SOURCE = 'dsh-theme-palette'

    /* ================= 官方基础色阶（取自 app.asar 内置样式表） ================= */
    const BASE = {
      bluish: {
        '00': '#ffffff', '50': '#f9fafb', '60': '#f5f6f7', '75': '#f1f3f5',
        '100': '#ebeef2', '150': '#e9ecf2', '200': '#e1e5ee', '300': '#cfd3d6',
        '400': '#adb2b8', '500': '#979da6', '600': '#81858c', '700': '#61666b',
        '750': '#43454a', '800': '#353638', '850': '#2c2c2e', '875': '#232324',
        '900': '#1b1b1c', '950': '#151517', '1000': '#0f1115',
      },
      neutral: {
        '00': '#ffffff', '50': '#fafafa', '100': '#f5f5f5', '150': '#ededed',
        '200': '#e5e5e5', '250': '#dcdcdc', '300': '#d4d4d4', '400': '#a2a4a6',
        '500': '#7f8287', '550': '#65676b', '600': '#545557', '700': '#3c3c3d',
        '800': '#292929', '850': '#212123', '900': '#0f0f0f', '1000': '#000000',
      },
      deepseek: {
        '50': '#edf3fe', '100': '#e4edfd', '200': '#d3e2ff', '300': '#b7c8fe',
        '400': '#7aaaff', '450': '#5686fe', '500': '#4176e6', '600': '#4868b2',
        '800': '#34415b', '900': '#283142',
      },
      blue: {
        '50': '#eff6ff', '50p': '#eaf3ff', '75': '#e5f0ff', '100': '#dbeafe',
        '300': '#93c5fd', '400': '#60a5fa', '450': '#4d93f8', '500': '#3b82f6',
        '600': '#2563eb', '800': '#1e40af', '900': '#0e3074', '950': '#172554',
      },
    }

    /**
     * 每一步在 UI 里的角色 → 色度权重来源。
     * light = 浅色模式的底/卡片/悬浮层；mid = 中间灰（边框、次级 UI）；
     * text = 浅色模式正文（只给极低色度，保证锐利）；
     * paper = 深色模式的正文（近白但带明显色味，否则深色下就是纯白字）；
     * dark = 深色模式的层与底。
     *
     * 深色这几档的权重**故意接近 1**（0.95–1.0，不随明度递减）：深色层之间只该用明度分层
     * （950→875→850→800 的 ΔL 本来就够，实测 ΔE 5.9 / 3.9 / 3.7）。若让权重随明度递减
     * （旧值 0.6 / 0.75 / 0.85 / 1.0），卡片与模块的色度会比画布低 30–45%，
     * 观感是「浮起来了，但换了一种材质」——画布有色、卡片发灰；
     * 而且三套配色在 850/800 两层上互相只差 ΔE 1.0–1.6（低于 JND 2，等于分不出）。
     */
    const ROLE = {
      '00': ['light', 1.0], '50': ['paper', 1.0], '60': ['light', 0.95], '75': ['light', 0.9],
      '100': ['light', 0.8], '150': ['light', 0.72], '200': ['light', 0.62],
      '300': ['mid', 0.85], '400': ['mid', 0.68], '500': ['mid', 0.55], '600': ['mid', 0.45],
      '700': ['text', 1.0], '750': ['text', 0.9],
      '800': ['dark', 1.0], '850': ['dark', 1.0], '875': ['dark', 0.95],
      '900': ['dark', 0.9], '950': ['dark', 1.0], '1000': ['text', 1.0],
    }

    /* ================= 配色表 ================= */
    /**
     * darkC  = 深色底层的色度（内置深色是中性灰，所以这里要给够，深色才有配色属性）
     * darkLift = 深色层的明度错位（OKLab L 增量，正 = 更亮）—— 内置深底 L≈0.205 偏暗；
     *            三套必须错开（暖砂更深、苔绿更亮），否则低色度下分不出彼此。
     * paperC = 深色模式正文的色度（近白但要看得出色味）
     *
     * darkC 必须**按色相分别给**，不能三套同一个数：它是绝对色度，而 L 0.23 处的可用色域
     * 差 3 倍以上（暖砂 0.048 / 苔绿 0.061 / 靛蓝 0.157）。同一个 0.016 会得到
     * 35% / 23% / 11% 三种相对饱和度 —— 暖砂读成「脏咖」、靛蓝读成「发灰」是同一个原因。
     * 下面括号里是 C ÷ 该处可用色域（20–30% 是「有色但不脏」的区间）。
     *
     * 明度也一样要错开：三套原本都落在 L 0.230，区分度全压在色度上，结果暖砂↔苔绿
     * 在深色层上只差 ΔE 1.15。darkLift 分开给（0.026 / 0.032 / 0.042）后 ΔE 2.05 起。
     *
     * accentHue / accentC / accentL 是**设计稿给的标准色值**，对应色阶中段 500：
     *   暖砂 #A9683E → L 0.5799 C 0.1012 h 52.3
     *   靛蓝 #3F66A3 → L 0.5108 C 0.1071 h 259.0
     *   苔绿 #4F7A42 → L 0.5335 C 0.0962 h 138.7
     * accentScale 保持 1.0 —— 见 accent() 里的注释：锚档用 accentL 定死明度，
     * 不用乘性 scale，否则选中态软底（deepseek-50/100/200）会跟着整条压暗。
     */
    const ACCENT_ANCHOR = '500'
    const SCHEMES = [
      { id: 'mono', label: '黑白', desc: '无色调 · 默认', tinted: false },
      {
        id: 'warm', label: '暖砂', desc: '米白 + 棕调', tinted: true,
        hue: 72, darkHue: 66, lightC: 0.010, midC: 0.010, textC: 0.004,
        darkC: 0.010, darkLift: 0.006, paperC: 0.0053, // 深正文按色域归一：×2.4 后 ≈0.0127
        accentHue: 60, accentC: 0.101, accentL: 0.58, // 标准色 #A9683E
        accentScale: 1.0,
      },
      {
        id: 'indigo', label: '靛蓝', desc: '冷白 + 蓝调', tinted: true,
        hue: 266, lightC: 0.010, midC: 0.010, textC: 0.004,
        darkC: 0.019, darkLift: 0.006, paperC: 0.0053, // 同上：三套统一，避免被色域裁成两倍差
        accentHue: 259, accentC: 0.107, accentL: 0.5108, // 标准色 #3F66A3
        accentScale: 1.0,
      },
      {
        id: 'moss', label: '苔绿', desc: '浅灰绿 + 绿调', tinted: true,
        hue: 162, lightC: 0.009, midC: 0.010, textC: 0.004,
        darkC: 0.010, darkLift: 0.006, paperC: 0.0053, // 同上
        accentHue: 139, accentC: 0.096, accentL: 0.5335, // 标准色 #4F7A42
        accentScale: 1.0,
      },
      { id: 'custom', label: '自定义', desc: '三色派生', tinted: true, custom: true, hue: 60, darkHue: 60, lightC: 0.02, whiteLift: 0.012, midC: 0.02, textC: 0.004, darkC: 0.014, darkLift: 0.03, paperC: 0.012, accentHue: 60, accentC: 0.1, accentL: 0.58, accentScale: 1 },
    ]

    /**
     * 参考实现（web.yily.top）的 surface token 精确对齐。
     * 参数化色阶只能逼近，这里对三套预置做表面级覆写：页面/卡片/控件/深色四层取参考值，
     * 中间层按 60→150 的明度插值，避免边框/悬浮态跳变。custom 不走这张表。
     */
    /* 1.9.9 修正（用户实测：苔绿纸面偏黄绿、左栏与主栏差距过大）：浅色三层**回归参考实现原值**，
       不再自造「拉开三张纸」的取值。参考实现的纸面本来就是近中性白（00 两两 ΔE 0.5–1.0），
       配色身份靠**次层**（surface-subtle / surface-strong / border）与强调色区分：
       60 取 surface-subtle、150 取 surface-strong（同套 00↔150 有 6–8 ΔE，跨套 2.5–4.1）。
       深色仍按 subtle / muted / raised / strong 四级落位，**不取参考的 surface-dark(#0d1310)**：
       本插件的侧栏在画布**下方**（更深），画布若压到 #0d1310，侧栏会掉到近黑（实测 #050a07）。*/
    const SURFACE_TARGETS = {
      warm: { '00': '#fcfbf9', '60': '#f9f6f2', '150': '#e6e0d6', '950': '#1a1613', '875': '#221d19', '850': '#2b241f', '800': '#4a3f36' },
      indigo: { '00': '#f9fafb', '60': '#f4f6f9', '150': '#e2e7ec', '950': '#121924', '875': '#18212e', '850': '#1b2533', '800': '#2c3a4e' },
      moss: { '00': '#f9fbf8', '60': '#f5f7f2', '150': '#e0e7dd', '950': '#131b16', '875': '#1a241d', '850': '#1d2a22', '800': '#2f3f34' },
    }

    /* 对比度下限：主文本 16 / 次文本 6 / 三级文本 4.6（AA）/ 链接 4.6 */
    /* 对比度下限：按**真实承载面**定（卡层/模块层比画布更难达标），不是按画布定。
       正文 15.5 / 次级 6.2 / 三级 4.62（AA）/ 链接 4.62（AA） */
    /* ---------- 自定义配色（反哺 A-3）----------
     * 只取三色的**色相与色度**，明度由引擎按明暗模式决定；
     * 色度夹在安全区间，避免用户选纯白/纯黑时引擎退化。
     */
    const CUSTOM_KEY = 'dsh-theme-palette.custom.v1'
    const CUSTOM_FIELDS = ['bg', 'text', 'accent']
    const CUSTOM_DEFAULT = { bg: '#f5efe6', text: '#1d1a17', accent: '#a9683e' }
    const HEX_RE = /^#[0-9a-f]{6}$/i

    /**
     * 自定义色的**不可变快照**。
     *
     * useSyncExternalStore 要求 getSnapshot 在数据未变时返回同一引用，否则每次渲染都会
     * 得到新对象并陷入重渲染；但也不能让快照永远不变 —— 取色/重置/导入都必须换新对象。
     * 所以这里缓存一份冻结对象，写入时替换缓存。
     */
    let customCache = null
    // undefined = 内存里的写入没落盘（隐私模式），缓存仍然有效；字符串 = 与存储内容对应
    let customCacheRaw

    function readCustom() {
      let raw = null
      try { raw = localStorage.getItem(CUSTOM_KEY) } catch (err) { /* 读取失败按空处理 */ }
      if (customCache !== null && (customCacheRaw === undefined || raw === customCacheRaw)) return customCache
      const out = Object.assign({}, CUSTOM_DEFAULT)
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          for (const k of CUSTOM_FIELDS) if (parsed && typeof parsed[k] === 'string' && HEX_RE.test(parsed[k])) out[k] = parsed[k].toLowerCase()
        } catch (err) { /* 退回默认 */ }
      }
      customCache = Object.freeze(out)
      customCacheRaw = raw
      return customCache
    }

    function writeCustom(next) {
      const clean = {}
      for (const k of CUSTOM_FIELDS) {
        const v = next && typeof next[k] === 'string' && HEX_RE.test(next[k]) ? next[k].toLowerCase() : CUSTOM_DEFAULT[k]
        clean[k] = v
      }
      const serialized = JSON.stringify(clean)
      // 值没变就保持同一引用：useSyncExternalStore 的快照在数据未变时必须稳定
      const unchanged = customCache !== null && CUSTOM_FIELDS.every((k) => customCache[k] === clean[k])
      try {
        localStorage.setItem(CUSTOM_KEY, serialized)
        customCacheRaw = serialized
      } catch (err) {
        customCacheRaw = undefined
      }
      if (!unchanged) customCache = Object.freeze(clean)
      return customCache
    }

    function customScheme(colors) {
      const bg = toOklch(colors.bg)
      const tx = toOklch(colors.text)
      const ac = toOklch(colors.accent)
      const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
      /* 无彩色底（纯黑/纯白/正灰）的色相是数值噪声（C≈0 时 atan2 给 0° 或 ±180°），
       * 直接用会派生出一整套「淡粉」色阶（审计 3.10：黑底 + 白字 + 黄强调 → 画布 #f5eef0）。
       * 取色相的顺序：底 → 字 → 强调；三者都无彩（C < 0.004）时置中性，整套色阶不再染色。
       */
      const ACHROMATIC_C = 0.004
      let hue = bg[2]
      let achromatic = false
      if (bg[1] < ACHROMATIC_C) {
        if (tx[1] >= ACHROMATIC_C) hue = tx[2]
        else if (ac[1] >= ACHROMATIC_C) hue = ac[2]
        else { hue = 0; achromatic = true }
      }
      const lightC = achromatic ? 0 : clampN(bg[1] * 0.9, 0.008, 0.045)
      const darkC = achromatic ? 0 : clampN(bg[1] * 0.75, 0.006, 0.035)
      return {
        id: 'custom', label: '自定义', desc: '三色派生', tinted: true, custom: true,
        hue, darkHue: hue, achromatic,
        lightC, midC: achromatic ? 0 : 0.010,
        // 文字色相必须真的来自「文字」这一项：只用色度会让「同色度、不同色相」完全同效，
        // 与 UI 上「三色的色相与色度」的承诺不符。
        textC: achromatic ? 0 : clampN(tx[1], 0.002, 0.030), textHue: achromatic ? hue : tx[2],
        darkC, darkLift: 0.030,
        paperC: achromatic ? 0 : clampN(tx[1], 0.004, 0.030), paperHue: achromatic ? hue : tx[2],
        // accentL 必须钳位：500 档同时是 --dsw-alias-link、button-info-fill 与勾选支点的来源。
        // 纯白/荧光黄会让填充与白字同色；只在极端输入时归一化，预设色不受影响。
        accentHue: ac[2], accentC: clampN(ac[1], 0.04, 0.18), accentL: clampN(ac[0], 0.30, 0.64), accentScale: 1.0,
      }
    }

    const MIN_MAIN = 12
    const MIN_SECONDARY = 6.2
    const MIN_TERTIARY = 4.62
    const MIN_LINK = 4.62
    /* 深色链接不再用 WCAG 比值兜底（1.9.9 补）：深色面上同一比值换到的 Lc 差得远，
       4.62 在自定义配色的 875 面上只有 Lc 52.7，低于本插件给文字定的 Lc 60 下限。
       tuneRamps 里改为沿亮度把 Lc 顶到 60（高对比 75），这里只保留浅色侧的下限。 */
    const MIN_LINK_DARK = 4.62

    /* ---------- 深色侧单独一套文字下限（审计 3.1）----------
     * WCAG 2.x 的比值是「相对亮度之比」，它在暗底上系统性高估可读性：
     * 同一个 4.62，在亮底 #f5eee3 上相当于 APCA Lc≈71，在深色模块面 #4a3f36 上只有 Lc≈48。
     * 所以「过 AA」在深色模块面上是纸面达标 —— 三级文字实测 Lc 45–48（APCA 里属于「勉强、
     * 只适合大字号」）。这里给深色侧单独定下限：
     *   次级 8.0 / 三级 6.4 —— 对最亮的深色面(800)换算下来是 Lc≈78 / ≈63，
     *   仍保留 1.25 的层级比（次级/三级），不会把三级抬到跟次级一样亮。
     * 浅色侧不动：它的 6.2 / 4.62 换算成 Lc 是 79 / 71，本来就够。
     * 黑白配色同样受益（它走的是同一条求解路径）。
     */
    const MIN_SECONDARY_DARK = 8.0
    const MIN_TERTIARY_DARK = 6.4

    /**
     * 高对比模式（反哺 A-4）：把四档文字下限整体抬到 WCAG AAA 级别。
     * 不改配色，只让求解器把文字压得更狠；默认关闭。
     * 深色侧另有一套（HC 深色二级/三级在 800 面上已到 Lc 66–72，再抬会让三级逼近正文）。
     */
    const FLOORS_HC = { main: 15, secondary: 9, tertiary: 7, link: 7, linkDark: 7 }
    const FLOORS_HC_DARK = { secondary: 9.6, tertiary: 7.6 }
    function floors(hc) {
      return hc === true
        ? FLOORS_HC
        : { main: MIN_MAIN, secondary: MIN_SECONDARY, tertiary: MIN_TERTIARY, link: MIN_LINK, linkDark: MIN_LINK_DARK }
    }
    /** 深色侧的同一张下限表（只把 secondary/tertiary 换成暗底口径）。 */
    function floorsDark(hc) {
      const F = floors(hc)
      return {
        main: F.main,
        secondary: hc === true ? FLOORS_HC_DARK.secondary : MIN_SECONDARY_DARK,
        tertiary: hc === true ? FLOORS_HC_DARK.tertiary : MIN_TERTIARY_DARK,
        link: F.link,
        linkDark: F.linkDark,
      }
    }
    const HC_KEY = 'dsh-theme-palette.hc.v1'
    // 只记录“已读哪个版本”的升级提示，不参与配色，也不迁移任何用户数据
    const NOTICE_KEY = 'dsh-theme-palette.notice.v1'

    /* ================= 对比度矩阵（设置页 UI 与 palette-dev 报表共用的唯一定义） =================
     * 这是 1.7.0 反哺里发现的隐性重复：报表自带一份承载面清单，UI 又要一份，两套口径必然漂移。
     * 现在常量只在这里定义一次，dev 钩子把它交给 palette-dev，设置页直接引用。
     * scope=false 的面不计入达标判定（当前宿主中 150 只作为图标/悬浮底，未发现三级正文用法）。
     */
    const CONTRAST_SURFACES = [
      { id: '00', mode: 'light', scope: true },
      { id: '60', mode: 'light', scope: true },
      { id: '150', mode: 'light', scope: false },
      { id: '950', mode: 'dark', scope: true },
      { id: '875', mode: 'dark', scope: true },
      { id: '850', mode: 'dark', scope: true },
      { id: '800', mode: 'dark', scope: true },
      // 菜单是半透明面，实际颜色取决于 backdrop；这里按"合成在画布上"给出参考值，
      // 标 scope:false（不计硬门），并在 UI 用 ※ 注明依赖 backdrop
      { id: 'menuL', label: 'menu', mode: 'light', scope: false, token: '--dsw-specific-menu' },
      { id: 'menuD', label: 'menu', mode: 'dark', scope: false, token: '--dsw-specific-menu' },
    ]
    const CONTRAST_ROLES = [
      { id: 'main', step: { light: '1000', dark: '50' } },
      { id: 'secondary', step: { light: '700', dark: '300' } },
      { id: 'tertiary', step: { light: '600', dark: '400' } },
      { id: 'link', step: { light: 'link', dark: 'link' } },
    ]
    /**
     * 角色 → **屏幕上真正渲染的那个 token**（按顺序取第一个存在的）。
     * 只看色阶步进会报错数：宿主把
     *   --dsw-alias-label-primary   = bluish-1000 / bluish-50
     *   --dsw-alias-label-secondary = bluish-700  / bluish-300
     *   --dsw-alias-label-tertiary  = bluish-600  / bluish-400
     * 而本插件会**再覆盖** label-secondary / label-tertiary（vivid：提高色度后按真实承载面求解），
     * 覆盖值才是屏幕上的字色。用步进值代替，等于拿一个不渲染的颜色去报对比度
     *（自定义配色下会把三级文字报成 4.21，实际渲染的别名色已被求解器兜到 ≥ 4.62）。
     * 黑白配色不覆盖这些别名 → 回落到色阶步进（本来就没有可测读数）。
     */
    const CONTRAST_ROLE_TOKENS = {
      main: { light: ['--dsw-static-neutral-bluish-1000'], dark: ['--dsw-static-neutral-bluish-50'] },
      secondary: { light: ['--dsw-alias-label-secondary', '--dsw-static-neutral-bluish-700'], dark: ['--dsw-alias-label-secondary', '--dsw-static-neutral-bluish-300'] },
      tertiary: { light: ['--dsw-alias-label-tertiary', '--dsw-static-neutral-bluish-600'], dark: ['--dsw-alias-label-tertiary', '--dsw-static-neutral-bluish-400'] },
      link: { light: ['--dsw-alias-link'], dark: ['--dsw-alias-link'] },
    }

    /* ================= 承诺口径：目标 / 物理上限 / 政策豁免 三者分开 =================
     * 1.9.7 之前这三件事混在一列里，报表与 UI 还各算各的：
     *   - 设置页 UI 用 floors(hc)（深色正文 12:1），palette-dev 报表把深色正文截到 10，
     *     HC 档的 15 被一起截没了（高档反而更松）；
     *   - 政策豁免的 800/850 被标成「△表面上限」，读起来像「物理上做不到」；
     *   - 物理上限里混进了 0.93 的求解余量，「上限」不再是纯计算结果。
     * 1.9.8 起只有一个模型（buildContrastReport），UI / palette-dev 报表 / check-audit 共用。
     *
     * 每个格子给出六个量：
     *   measured         实测对比度（null = 无法测量：黑白配色不覆盖承载面，报出来是假数字）
     *   declaredTarget   声明目标（政策承诺值）
     *   physicalCeiling  物理上限（纯计算：该面上黑/白前景能达到的对比度）
     *   policyApplicable 该格是否在承诺范围内
     *   limitedByPhysics 声明目标是否高于物理上限（真·物理不可达）
     *   pass             是否达标（政策外 = null：不计入达标统计，也不算失败）
     */
    // 承诺目标：普通档深色正文 10:1（1.9.7 策略 A），浅色正文仍是 12:1；HC 档整体抬到 AAA。
    const CONTRAST_TARGETS = {
      main: { light: { normal: MIN_MAIN, hc: FLOORS_HC.main }, dark: { normal: 10, hc: FLOORS_HC.main } },
      secondary: { light: { normal: MIN_SECONDARY, hc: FLOORS_HC.secondary }, dark: { normal: MIN_SECONDARY_DARK, hc: FLOORS_HC_DARK.secondary } },
      tertiary: { light: { normal: MIN_TERTIARY, hc: FLOORS_HC.tertiary }, dark: { normal: MIN_TERTIARY_DARK, hc: FLOORS_HC_DARK.tertiary } },
      link: { light: { normal: MIN_LINK, hc: FLOORS_HC.link }, dark: { normal: MIN_LINK_DARK, hc: FLOORS_HC.linkDark } },
    }
    // 政策豁免：1.9.7 策略 A —— 深色 800（模块面）与 850（次级深面）不为正文兜底。
    // 850 的物理上限（暖砂 15.27:1）远高于 10:1 目标：它不是「物理不可达」，只是策略上不承诺，
    // 所以这里登记的是 policy 豁免，绝不能挂「△物理不可达」的标签。
    const CONTRAST_EXEMPT = [
      { mode: 'dark', role: 'main', surface: '800', reason: 'module-surface' },
      { mode: 'dark', role: 'main', surface: '850', reason: 'sub-surface' },
    ]
    // 政策外也有底线：低于 AA 4.5:1 仍然是真违例，不能拿「政策外」当免罪金牌。
    const CONTRAST_FLOOR = 4.5
    // 求解余量：求解器把目标钳到「该面上限 × 0.93」，避免贴着物理极限出字。
    const CONTRAST_SOLVER_MARGIN = 0.93

    function contrastTarget(role, mode, hc) {
      const row = CONTRAST_TARGETS[role]
      if (!row) return null
      return row[mode][hc ? 'hc' : 'normal']
    }
    function contrastExemptReason(role, mode, surfaceId) {
      const hit = CONTRAST_EXEMPT.find((e) => e.mode === mode && e.role === role && e.surface === surfaceId)
      return hit ? hit.reason : null
    }
    /**
     * 唯一对比度报告模型。
     * tokens 必须是**覆盖层实际写出去的那张表**：插件没覆盖的承载面（黑白配色就是如此）
     * 会被标成无法测量，而不是拿插件自己的期望色冒充屏幕上的颜色。
     */
    function buildContrastReport(tokens, hc, meta) {
      const round2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100)
      const rows = CONTRAST_ROLES.map((role) => ({
        role: role.id,
        cells: CONTRAST_SURFACES.map((sf) => {
          const candidates = CONTRAST_ROLE_TOKENS[role.id][sf.mode]
          let fgPair = null
          for (const name of candidates) {
            if (tokens[name]) { fgPair = tokens[name]; break }
          }
          const bgPair = sf.token ? tokens[sf.token] : tokens['--dsw-static-neutral-bluish-' + sf.id]
          const fgHex = fgPair ? fgPair[sf.mode] : null
          const bgHex = bgPair ? bgPair[sf.mode] : null
          const canvasPair = tokens['--dsw-static-neutral-bluish-' + (sf.mode === 'light' ? '00' : '950')]
          const unmeasured = !fgHex || !bgHex || (sf.token ? !canvasPair : false)
          const bg = unmeasured
            ? null
            : (sf.token ? flatten(bgHex, canvasPair[sf.mode]) : bgHex)
          const declaredTarget = contrastTarget(role.id, sf.mode, hc)
          const measured = unmeasured ? null : contrast(fgHex, bg)
          const physicalCeiling = unmeasured ? null : contrast(sf.mode === 'light' ? '#000000' : '#ffffff', bg)
          const scopeExempt = sf.scope === false
          const policyExempt = contrastExemptReason(role.id, sf.mode, sf.id)
          const policyApplicable = !unmeasured && !scopeExempt && !policyExempt
          const limitedByPhysics = !unmeasured && declaredTarget > physicalCeiling
          const feasibleTarget = policyApplicable
            ? (limitedByPhysics ? physicalCeiling * CONTRAST_SOLVER_MARGIN : declaredTarget)
            : declaredTarget
          const meetsFloor = unmeasured ? null : measured >= CONTRAST_FLOOR - 0.02
          const pass = policyApplicable ? measured >= feasibleTarget - 0.02 : null
          return {
            surface: sf.id, mode: sf.mode, scope: sf.scope,
            measured: round2(measured),
            // APCA 感知对比度（审计 3.1）：WCAG 只管「比值」，感知上暗底会虚高；
            // 这一列不改判定，只让报表能看出「过 AA 但看着淡」的格子。
            apca: unmeasured ? null : Math.round(apcaContrast(fgHex, bg) * 1000) / 10,
            declaredTarget,
            physicalCeiling: round2(physicalCeiling),
            feasibleTarget: round2(feasibleTarget),
            policyApplicable,
            limitedByPhysics,
            meetsFloor,
            pass,
            exemptReason: scopeExempt ? 'surface-scope' : policyExempt,
            unmeasured,
          }
        }),
      }))
      const cells = rows.reduce((acc, row) => acc.concat(row.cells), [])
      const summary = {
        cells: cells.length,
        passed: cells.filter((c) => c.pass === true).length,
        failed: cells.filter((c) => c.pass === false).length,
        exempt: cells.filter((c) => c.pass === null && !c.unmeasured).length,
        unmeasured: cells.filter((c) => c.unmeasured).length,
        floorViolations: cells.filter((c) => !c.unmeasured && c.pass === null && c.meetsFloor === false).length,
        physicallyLimited: cells.filter((c) => c.policyApplicable && c.limitedByPhysics).length,
        // 感知口径提示（不改判定）：正文至少要 Lc 60 才算「舒适」，低于 60 的格子标出来。
        apcaBelowBody: cells.filter((c) => !c.unmeasured && Math.abs(c.apca) < 60).length,
        apcaBelowLarge: cells.filter((c) => !c.unmeasured && Math.abs(c.apca) < 45).length,
      }
      return {
        hc: hc === true,
        mono: !!(meta && meta.mono),
        applicable: summary.passed + summary.failed > 0,
        rows,
        summary,
        targets: CONTRAST_TARGETS,
        exempt: CONTRAST_EXEMPT,
        floor: CONTRAST_FLOOR,
        margin: CONTRAST_SOLVER_MARGIN,
      }
    }

    /**
     * 区块底色：左侧栏相对主画布的深浅档位。
     * lift = OKLab 亮度增量（正 = 更浅）；chroma = 保留多少色度（越浅越该少）。
     * 深色模式：**提亮**按 0.6 倍施加（深色底上大幅提亮会发灰），**下沉**用全量
     * （见 sidebarTokens，压正不压负 —— 同一档要能在明暗两侧给出同样的可辨度）。
     */
    const SIDEBAR_MODES = [
      // darkLift 是深色模式独立的幅度：深色底在 L≈0.22，可用明度空间比浅色小得多，
      // 沿用浅色步长只有 ΔE 1.9–2.3（正好卡在 JND 上 → 左栏与中栏看不出界线）。
      { id: 'light', label: '更浅', lift: 0.032, darkLift: 0.048, chroma: 0.62 },
      { id: 'match', label: '同色', lift: 0, darkLift: 0, chroma: 1 },
      { id: 'deep', label: '更深', lift: -0.020, darkLift: -0.042, chroma: 1.15 },
    ]
    // 默认给「更深」：侧栏压在画布之下，悬停/选中继续向下走，不会穿过画布；
    // 「更浅」仍在同一行第一档，但它离纯白的余量太小，三档层次只能挤在 0.005 内。
    const DEFAULT_SIDEBAR = 'deep'
    const SIDEBAR_KEY = 'dsh-theme-palette.sidebar.v1'

    /**
     * 文字着色强度。textScale 作用于浅色模式正文（textC），paperScale 作用于深色模式正文（paperC）。
     * 底色不动、只加文字色度 —— 对比度仍由求解器兜底，所以「浓一些」也不会掉到 AA 以下。
     *
     * inkC / inkDarkC（审计 3.3）：预置配色的正/次/三级文字走的是 TEXT_TARGETS 里的**参考墨色**，
     * 它们不读 textC，于是 1.9.0 起「静 / 标准 / 浓」三档对预置完全无效（实测 ΔE 0）。
     * 这两项按档位给参考墨色加减色度（色相不动），让三档真的能看出来：
     *   静 −0.026 / 标准 0 / 浓 +0.021（浅色）；深色侧幅度小一些（−0.018 / 0 / +0.016），
     * 因为深色画面上的彩色文字更容易显脏。标准档加减为 0 —— 1.9.0 的参考对齐原样保留。
     */
    const TEXT_MODES = [
      { id: 'neutral', label: '静', textScale: 1, paperScale: 1, textLift: 0, inkC: -0.026, inkDarkC: -0.018 },
      { id: 'tinted', label: '标准', textScale: 3.0, paperScale: 2.4, textLift: 0.055, inkC: 0, inkDarkC: 0 },
      { id: 'deep', label: '浓', textScale: 4.6, paperScale: 3.6, textLift: 0.085, inkC: 0.021, inkDarkC: 0.016 },
    ]
    const DEFAULT_TEXT = 'tinted'
    const TEXT_KEY = 'dsh-theme-palette.text.v1'

    const MARKDOWN_STYLE_ID = 'dsh-theme-palette/markdown.css'

    /**
     * Markdown 的标题 / 加粗可否用比正文更「有色」的颜色。
     * 宿主的标题与正文同色（都继承 label-primary），只靠字号字重区分；
     * 这里把标题与加粗各染一档强调色的混合值，让结构在纯色版里也看得出来。
     */
    const MD_MODES = [
      { id: 'on', label: '着色' },
      { id: 'off', label: '同正文' },
    ]
    const DEFAULT_MD = 'on'
    /** 高对比开关（反哺 A-4）：不改配色，把文字下限抬到 AAA。 */
    const HC_MODES = [
      { id: 'off', label: '关' },
      { id: 'on', label: '开' },
    ]
    const DEFAULT_HC = 'off'
    const MD_KEY = 'dsh-theme-palette.md.v1'

    /**
     * 滚动条着色。宿主四条滚动条 token 全指向 `neutral` 色阶（200/300 浅、700/600/550 深），
     * 我们本来就染了那条色阶，但它的色度只有 0.006，肉眼看仍是灰。
     * 这里按档位把色度抬到可见范围：色相跟配色（跟随）或跟强调色（强调）。
     */
    const SCROLL_MODES = [
      { id: 'neutral', label: '中性', chroma: 0, useAccent: false },
      { id: 'tinted', label: '跟随', chroma: 0.026, useAccent: false },
      { id: 'accent', label: '强调', chroma: 0.055, useAccent: true },
    ]
    const DEFAULT_SCROLL = 'tinted'
    const SCROLL_KEY = 'dsh-theme-palette.scroll.v1'

    /**
     * 控件（开关 / 复选框 / 单选 / 表单焦点边）。
     * 宿主把这些全部压在 `--dsw-alias-brand-primary` 上，而它是 near-black / near-white
     * （bluish-1000 / 50），所以开关开态是「黑白拨杆」，跟配色无关。
     * 换成强调色后，开关、勾选、原生 radio/checkbox 的 accent-color 一起跟主题。
     * 对比度要求是**非文本** 3:1（这些是 UI 组件边界），实测强调色对画布 4.0–5.6，够用。
     */
    const CONTROL_MODES = [
      { id: 'accent', label: '主题色' },
      { id: 'mono', label: '黑白' },
    ]
    const DEFAULT_CONTROL = 'accent'
    const CONTROL_KEY = 'dsh-theme-palette.control.v1'

    /* ---------- 未知模式 id 必须告警（审计 3.9）----------
     * 各 mode 的取用都是 `TEXT_MODES.find(x => x.id === mode) || TEXT_MODES[1]`：
     * 拼错一个 id 就整套配色静默退回默认，而所有检查都是绿的 —— 这是最容易埋雷的一种。
     * UI 只给合法值，所以这里只 warn、不抛错（palette-dev 这类开发工具会自己抛）。
     */
    const warnedModeIds = {}
    function warnUnknownModes(ids) {
      const tables = [
        ['sidebarMode', SIDEBAR_MODES], ['textMode', TEXT_MODES],
        ['scrollMode', SCROLL_MODES], ['controlMode', CONTROL_MODES], ['mdMode', MD_MODES],
      ]
      for (const [field, table] of tables) {
        const value = ids[field]
        if (value === undefined || value === null || value === '') continue
        if (table.some((x) => x.id === value)) continue
        const sig = field + '=' + value
        if (warnedModeIds[sig]) continue
        warnedModeIds[sig] = true
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[dsh-theme-palette] unknown ' + field + ' id "' + value + '"，已回落默认值；合法值：' +
            table.map((x) => x.id).join(' / '))
        }
      }
    }

    /* ================= 颜色数学（sRGB <-> OKLab） ================= */
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
    const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

    function hexToRgb(hex) {
      return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    }

    function rgbToHex(rgb) {
      return '#' + rgb
        .map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'))
        .join('')
    }

    /** hex -> [L, C, h]（OKLCH；h 为角度）。 */
    function toOklch(hex) {
      const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v / 255))
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
      const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
      const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
      return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI]
    }

    /** 给 (L,C,hue) 求三个线性通道（不做钳位，用来判断是否出色域）。 */
    function linearChannels(L, C, hueDeg) {
      const rad = (hueDeg * Math.PI) / 180
      const A = C * Math.cos(rad)
      const B = C * Math.sin(rad)
      const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
      const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
      const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
      return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ]
    }

    function inGamut(rgb) {
      return rgb.every((v) => v >= -0.0005 && v <= 1.0005)
    }

    /**
     * OKLCH → hex。**先做色域钳位**：请求的色度超出 sRGB 时二分收色度，
     * 而不是把通道硬钳到 0/255 —— 后者会让通道顶满（暖砂气泡曾算出 #ffede0、
     * R 一直是 255），颜色被压成另一个色相。
     */
    function fromOklch(L, C, hueDeg) {
      let c = Math.max(0, C)
      if (!inGamut(linearChannels(L, c, hueDeg))) {
        let lo = 0
        let hi = c
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2
          if (inGamut(linearChannels(L, mid, hueDeg))) lo = mid
          else hi = mid
        }
        c = lo
      }
      return rgbToHex(linearChannels(L, c, hueDeg).map((v) => linearToSrgb(clamp(v, 0, 1)) * 255))
    }

    function luminance(hex) {
      const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v / 255))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    function contrast(a, b) {
      const la = luminance(a)
      const lb = luminance(b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }

    /* ---------- APCA（审计 3.1：报表要同时给出感知对比度）----------
     * WCAG 2.x 的比值只与相对亮度有关，不看极性、不看空间频率，
     * 在暗底上会系统性高估可读性（同样 4.62，亮底 Lc≈71，暗底 Lc≈48）。
     * APCA（SAPC-98G-4g，0.0.98G）是目前唯一广泛使用的感知对比度模型：
     * 它的低对比端用 1.14 次幂「软钳位」，高对比端用 0.65 次幂压缩，
     * 两个锚点 106.04 / -107.88 对应 0–100 的刻度。
     * 这里只用来**报告**（不改求解目标）：求解仍走 WCAG —— 被广泛承诺的仍是 AA/AAA。
     */
    const APCA_MAIN_TRC = 2.4
    const APCA_R_CO = 0.2126729
    const APCA_G_CO = 0.7151522
    const APCA_B_CO = 0.072175
    const APCA_NORM_BG = 0.56
    const APCA_NORM_TXT = 0.57
    const APCA_REV_TXT = 0.62
    const APCA_REV_BG = 0.65
    const APCA_BLK_THRS = 0.022
    const APCA_BLK_CLMP = 1.414
    const APCA_SCALE = 1.14
    const APCA_LO_OFF = 0.027
    const APCA_LO_CLIP = 0.1
    const APCA_DELTA_Y_MIN = 0.0005

    function apcaY(hex) {
      const [r, g, b] = hexToRgb(hex).map((v) => Math.pow(v / 255, APCA_MAIN_TRC))
      return APCA_R_CO * r + APCA_G_CO * g + APCA_B_CO * b
    }
    /**
     * APCA 亮度对比（Lc）。前景比背景亮为正值，反之负值；
     * 返回 0 表示「对比不可用」（亮度差过小，低于模型的分辨下限）。
     */
    function apcaContrast(fgHex, bgHex) {
      let txt = apcaY(fgHex)
      let bg = apcaY(bgHex)
      // 软钳位：极暗的文字/背景统一抬到阈值上，避免 0.0x 段的病态放大
      txt = txt > APCA_BLK_THRS ? txt : txt + Math.pow(APCA_BLK_THRS - txt, APCA_BLK_CLMP)
      bg = bg > APCA_BLK_THRS ? bg : bg + Math.pow(APCA_BLK_THRS - bg, APCA_BLK_CLMP)
      if (Math.abs(bg - txt) < APCA_DELTA_Y_MIN) return 0
      let out
      if (bg > txt) {
        // 亮底黑字（正常极性）
        out = (Math.pow(bg, APCA_NORM_BG) - Math.pow(txt, APCA_NORM_TXT)) * APCA_SCALE
        out = out < APCA_LO_CLIP ? 0 : out - APCA_LO_OFF
      } else {
        // 暗底白字（反极性）：极性换了，指数也要换
        out = (Math.pow(bg, APCA_REV_BG) - Math.pow(txt, APCA_REV_TXT)) * APCA_SCALE
        out = out > -APCA_LO_CLIP ? 0 : out + APCA_LO_OFF
      }
      return Math.round(out * 100) / 100
    }

    /** 沿亮度把 fg 压暗，直到与 bg 的对比度达标（用于「实心按钮 + 浅色文字」）。 */
    function darkenUntil(hex, bgHex, target) {
      const [L, C, hue] = toOklch(hex)
      let cur = L
      for (let i = 0; i < 40; i++) {
        const candidate = fromOklch(cur, C, hue)
        if (contrast(candidate, bgHex) >= target) return candidate
        cur -= 0.004
      }
      return fromOklch(cur, C, hue)
    }

    /** 线性混色：a 占 weight，其余取 b。 */
    function mixHex(a, b, weight) {
      const x = hexToRgb(a)
      const y = hexToRgb(b)
      return rgbToHex(x.map((v, i) => v * weight + y[i] * (1 - weight)))
    }

    function withAlpha(hex, alpha) {
      return hex + Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, '0')
    }

    /** 8 位 hex（带 alpha）按「覆盖在 bg 上」合成为不透明色；不带 alpha 时原样返回。 */
    function flatten(hex, bgHex) {
      if (typeof hex !== 'string' || hex.length !== 9) return hex
      const fg = hexToRgb(hex.slice(0, 7))
      const bg = hexToRgb(bgHex)
      const a = parseInt(hex.slice(7, 9), 16) / 255
      return rgbToHex(fg.map((v, i) => v * a + bg[i] * (1 - a)))
    }

    /**
     * 语义色温度调和：保留色相为主（绿仍是绿、红仍是红），只把色相往配色的暖/冷方向
     * 拉一小段、并压低饱和度。用于 file diff 这种大面积色块——不能整块换成主题色，
     * 那会让「新增/删除」失去语义。
     */
    function harmonize(hex, targetHue, pull, chromaScale) {
      const [L, C, h] = toOklch(hex)
      const dh = ((targetHue - h + 540) % 360) - 180
      return fromOklch(L, C * chromaScale, h + dh * pull)
    }

    /**
     * 区块底色微调：在 OKLab 里给亮度加 delta，同时按需削减色度。
     *
     * 两点约束（都是踩过的）：
     *   1. 提亮的上限压在 L=0.980 —— 再往上就只剩纯白，配色的色味全丢，
     *      左侧栏会变成「不管选哪套配色都是白」。
     *   2. 只有真正贴到纯白（L>0.980 之后）才把色度掐到 0，否则 sRGB 削通道会让冷白泛青。
     */
    /* 1.9.9：上限从 0.985 抬到 0.995 —— 参考实现的暖砂纸面 L 已经是 0.9888，
       低于上限时 clamp 会把「更浅」推到比画布**更暗**（实测 #fdfbf8 → #fafaf9）。 */
    const LIGHT_CAP = 0.995

    function lift(hex, delta, chromaScale) {
      const [L, C, hue] = toOklch(hex)
      let nextL = clamp(L + delta, 0, LIGHT_CAP)
      if (delta > 0 && nextL < L) nextL = L   // 提亮不许把亮度压下去（贴顶时不反向）
      const headroom = clamp((1 - nextL) / 0.02, 0, 1)
      return fromOklch(nextL, C * chromaScale * headroom, hue)
    }

    /* ================= 色阶重建 ================= */
    /**
     * 近白端必须压暗一点：纯白在任何色度下都还是白，颜色出不来。
     * 近黑端同理，轻微上提。中间亮度原样保留 —— 对比度基线因此不变。
     *
     * 审计 3.3：这里原来是两段硬阈值（L>=0.92 减 0.044、L<0.14 乘 1.06），
     * 在阈值处**跳变 0.044**，而浅色 60 档（卡片面）恰好落在 0.917，被推过边界就成了白。
     * 现在改成平滑过渡：同样的位移量（0.044 / ×1.06），但用 smoothstep 在阈值附近
     * 0.07 的窗口内渐进生效，曲线在两端连续、导数也连续，不再有断层。
     */
    const COMPRESS_TOP = 0.92        // 近白端起点
    const COMPRESS_TOP_EDGE = 0.07   // 过渡窗口宽度
    const COMPRESS_TOP_DROP = 0.044  // 最大下移量（与原实现一致）
    const COMPRESS_BOTTOM = 0.14     // 近黑端起点
    const COMPRESS_BOTTOM_EDGE = 0.06
    const COMPRESS_BOTTOM_GAIN = 0.06 // 最大上提比例（与原实现一致）

    function smoothstep(edge0, edge1, x) {
      const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
      return t * t * (3 - 2 * t)
    }

    function compressL(L) {
      // 等量下移而不是压缩斜率：压缩会把「画布↔卡层」的 ΔL 从 0.031 压到 0.0147，
      // 而 L<0.93 的那一段又没压，明度节奏会在边界处断层。
      const top = smoothstep(COMPRESS_TOP - COMPRESS_TOP_EDGE, COMPRESS_TOP + COMPRESS_TOP_EDGE / 4, L)
      const bottom = smoothstep(COMPRESS_BOTTOM + COMPRESS_BOTTOM_EDGE, COMPRESS_BOTTOM - COMPRESS_BOTTOM_EDGE, L)
      return L - COMPRESS_TOP_DROP * top + L * (COMPRESS_BOTTOM_GAIN * bottom)
    }

    function roleChroma(role, weight, scheme, scales) {
      if (role === 'light') return scheme.lightC * weight
      if (role === 'dark') return scheme.darkC * weight
      if (role === 'paper') return scheme.paperC * weight * scales.paperScale
      if (role === 'text') return scheme.textC * weight * scales.textScale
      // mid = 注释/说明/次级文字（label-caption 400、label-tertiary 600、label-dimmed 200 等）。
      // 它同时被按钮边框、代码段选择等静默 UI 使用，所以只跟**部分**文字着色强度，别整份加上去。
      const midScale = 1 + (scales.textScale - 1) * 2.0
      return scheme.midC * weight * midScale
    }

    function buildRamps(scheme, scales) {
      const bluish = {}
      for (const [step, hex] of Object.entries(BASE.bluish)) {
        const L = toOklch(hex)[0]
        const [role, weight] = ROLE[step]
        // 深色层整体提亮：内置深底 L≈0.18 在全屏下偏「死黑」，
        // 提一档既让配色显出来，也让层与层之间的关系更清楚。
        // 浅色正文（近黑）色域很窄：只加色度到 ΔE 1.6 就顶到 8-bit 量化上限，
        // 所以「文字着色」还要抬一点明度，色相才真正显出来（对比度由求解器兜底）。
        // 只有「近黑」那一步需要抬明度（色域太窄）；次级 700 在中明度，靠色度就够，
        // 抬它反而会把 700/卡层 的对比压到 6.2 以下（求解器的 0.13 位移上限拉不回来）。
        const liftText = role === 'text' && L < 0.30 ? (scales.textLift || 0) : 0
        const lifted = role === 'dark' ? L + scheme.darkLift : L + liftText + (role === 'light' ? (scheme.whiteLift || 0) : 0)
        // 深色层单独给色相：暖砂的 88° 是「黄」，在 L≈0.22 的暗部读成橄榄绿；
        // 换成 60°（橙棕）才是咖啡色。浅色侧仍是 88°（米白）。
        // 文字档（含深色正文 paper）跟随「文字」这一项自己的色相；预设没有 textHue，行为不变。
        const tintRole = role === 'text' || role === 'paper'
        // 深色角色（含深色正文 paper）统一走 darkHue，避免「深色面橙棕、正文黄绿」的双色相
        const hue = tintRole && scheme.textHue !== undefined
          ? scheme.textHue
          : ((role === 'dark' || role === 'paper') && scheme.darkHue !== undefined ? scheme.darkHue : scheme.hue)
        bluish[step] = fromOklch(clamp(compressL(lifted), 0, 0.995), roleChroma(role, weight, scheme, scales), hue)
      }
      const neutral = {}
      for (const [step, hex] of Object.entries(BASE.neutral)) {
        const L = toOklch(hex)[0]
        // 这条色阶只在少数深色 token 里用，按亮度分档即可
        const c = L > 0.9 ? scheme.lightC * 0.8 : L > 0.45 ? scheme.midC : scheme.darkC * 0.8
        // 深端的 neutral（深色模式滚动条等）跟着同一个「夜色」相，否则一半棕一半橄榄
        const hue = L <= 0.45 && scheme.darkHue !== undefined ? scheme.darkHue : scheme.hue
        neutral[step] = fromOklch(compressL(L), c, hue)
      }
      const accent = (ramp) => {
        const out = {}
        for (const [step, hex] of Object.entries(ramp)) {
          const L = toOklch(hex)[0]
          let c
          if (L > 0.86) c = scheme.accentC * 0.3      // 浅底上的柔和强调底
          else if (L > 0.72) c = scheme.accentC * 0.55
          else if (L > 0.4) c = scheme.accentC
          else c = scheme.accentC * 0.6                // 深色模式用的深端
          // 品牌基准档（500 = 宿主 --dsw-alias-link / button-info-fill / state-business-primary /
          // 本插件卡片预览色的共同来源）明度**定死**在设计稿给的 accentL，不乘 accentScale：
          // accentScale 是乘性的，为了把 500 压到设计色而设 0.87，会把 deepseek-50/100/200
          // （宿主的选中态软底）整条压暗 13%，软底就不再是软底。
          const Lout = step === ACCENT_ANCHOR && scheme.accentL !== undefined
            ? scheme.accentL
            : L * scheme.accentScale
          out[step] = fromOklch(clamp(Lout, 0.06, 0.96), c, scheme.accentHue)
        }
        return out
      }
      const T = SURFACE_TARGETS[scheme.id]
      if (scheme.tinted && T) {
        /* ---------- 承载面色度跟随档位（审计 3.7）----------
         * SURFACE_TARGETS 是 1.9.0 为「与参考实现精确对齐」定死的，连色度一起钉住，
         * 于是三套预置在浅色下几乎是同一张白纸（画布 ΔE 1.3–1.6，刚过 JND），
         * 而切到「浓」档时正文明显加深、承载面却一动不动（C 恒定 0.0035–0.0104）。
         * 这里保留参考实现的**明度**（明暗节奏与对比度身份不变），只缩放色度：
         *   静 档 ≈ 参考原值（1.01×，几乎就是 1.9.8 的像素）
         *   标准档 1.60×  → 画布/模块面的色温真正可辨，三套预置能分出来
         *   浓 档 2.10×  → 与正文着色强度同步加码
         * 明度不动、只动色度，因此承载面之间的对比度关系不变，文字求解结果只受极小幅影响。
         */
        const SURFACE_CHROMA_REF = 2.4
        const SURFACE_CHROMA_BASE = 1.6
        const surfaceK = SURFACE_CHROMA_BASE + (scales.paperScale - SURFACE_CHROMA_REF) * 0.42
        const retint = (hex) => {
          if (Math.abs(surfaceK - 1) < 0.01) return hex
          const [Ls, Cs, hs] = toOklch(hex)
          return fromOklch(Ls, Cs * surfaceK, hs)
        }
        const pin = {}
        for (const step of ['00', '60', '150', '950', '875', '850', '800']) {
          if (!T[step]) continue
          // 深色面（950/875/850/800）保持钉死：深色侧的层次由 darkLift 与 12:1 求解决定，
          // 动它的色度会连带改掉压暗曲线的落点。
          pin[step] = ['00', '60', '150'].includes(step) ? retint(T[step]) : T[step]
          bluish[step] = pin[step]
        }
        // 60→150 之间按 OKLCH 插值，保证 75/100/200 与两端连续。
        // 200 用**外推**（t=1.25）而不是内插：150 与 200 原来只差 ΔE 0.36，两档撞成同色，
        // 而「比 150 更深→更浅」的语义要求 200 继续沿着 60→150 的斜率往下走。
        const [l60, c60, h60] = toOklch(pin['60'])
        const [l150, c150, h150] = toOklch(pin['150'])
        const dh = ((h150 - h60 + 540) % 360) - 180
        const lerp = (t) => fromOklch(l60 + (l150 - l60) * t, c60 + (c150 - c60) * t, h60 + dh * t)
        bluish['75'] = lerp(0.25)
        bluish['100'] = lerp(0.55)
        bluish['200'] = lerp(1.25)
      }
      return { bluish, neutral, deepseek: accent(BASE.deepseek), blue: accent(BASE.blue) }
    }

    /**
     * 对比度求解：前景达不到 target 就沿亮度微调，**两个方向都找**（取离原色最近的可行解）。
     *
     * 只朝「远离背景」一个方向走会漏掉可行解：当强调色比浅色背景还亮（纯白/荧光黄），
     * 继续往白走只会更不可读，正确解在暗的一侧。bgs 可以是多个承载面，要求同时达标。
     */
    /**
     * 朝 fg 方向按比例混掉 bg 的底，取「刚好达到 target 对比度」的实色（审计 3.4 用）。
     *
     * `solveForeground` 找的是「第一步就够」的解，从墨色出发时常常原地返回 ——
     * HC 边框如果直接返回墨色就是 16:1 的黑框，比发丝线还难看。这里做的是**定量**：
     * 在 bg→fg 直线上二分混合比，命中 3.0 / 3.4 / 4.0 这些目标值本身。
     * 混合比越大越靠近 fg，对比度单调上升，二分安全；bgs 取一组时要保证**最差的那一面**达标。
     */
    function mixToContrast(bgs, fg, target) {
      const list = Array.isArray(bgs) ? bgs : [bgs]
      const worst = (candidate) => Math.min(...list.map((bg) => contrast(candidate, bg)))
      if (worst(fg) <= target) return fg
      // 以最难达标的那一面为混合终点：混色的另一端选最差面，才能保证这条线上单调
      const bgWorst = list.reduce((a, b) => (contrast(fg, b) < contrast(fg, a) ? b : a))
      const at = (w) => mixHex(fg, bgWorst, w)
      let lo = 0
      let hi = 1
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2
        if (worst(at(mid)) < target) lo = mid
        else hi = mid
      }
      // 命中的是「刚好够」，四舍五入成 8 位 hex 可能掉回一点点，往上多推半格留余量
      const out = at(Math.min(1, hi + 0.004))
      return worst(out) >= target ? out : at(1)
    }

    /**
     * 沿亮度把颜色顶到 APCA Lc 下限（只往亮的方向走：用于深色面上的浅色文字/链接）。
     *
     * 为什么需要它：`solveOn` / `solveForeground` 守的是 WCAG 比值，而深色面上
     * 「比值达标」并不等于「看得清」—— 链接的 4.62 在 875 面上只有 Lc 52，
     * 低于本插件给文字定的 Lc 60。直接抬 WCAG 下限又会过度：要让最亮的深色面(800)
     * 到 Lc 60，比值得抬到 8 以上，而 8 在 950 面上已是 Lc≈85 的近白链接。
     * 所以这里按 Lc 本身收敛：以最难的一面为准，够到就停。
     */
    function raiseToLc(hex, bgs, lcMin) {
      const list = Array.isArray(bgs) ? bgs : [bgs]
      // apcaContrast 返回 Lc/100（暗底浅字为负），取绝对值再 ×100 才是 Lc 读数
      const worst = (candidate) => Math.min(...list.map((bg) => Math.abs(apcaContrast(candidate, bg)) * 100))
      if (worst(hex) >= lcMin) return hex
      const [L0, C, hue] = toOklch(hex)
      let best = hex
      let bestLc = worst(hex)
      for (let i = 1; i <= 80; i++) {
        const L = L0 + i * 0.004
        if (L > 0.97) break
        const candidate = fromOklch(L, C, hue)
        const lc = worst(candidate)
        if (lc > bestLc) { best = candidate; bestLc = lc }
        if (lc >= lcMin) return candidate
      }
      return best
    }

    function solveForeground(hexes, step, bgs, target, cap) {
      const list = Array.isArray(bgs) ? bgs : [bgs]
      const maxShift = typeof cap === 'number' ? cap : 0.13
      const [L0, C, hue] = toOklch(hexes[step])
      const passes = (candidate) => list.every((bg) => contrast(candidate, bg) >= target)
      if (passes(hexes[step])) return hexes[step]
      const steps = Math.ceil(maxShift / 0.004)
      for (let i = 1; i <= steps; i++) {
        // 同距离先试暗侧：浅色模式下正文/链接的可行解绝大多数在暗侧
        for (const dir of [-1, 1]) {
          const L = L0 + dir * i * 0.004
          if (L < 0 || L > 1) continue
          const candidate = fromOklch(L, C, hue)
          if (passes(candidate)) return candidate
        }
      }
      // 位移上限内无解：黑/白里取「最差承载面」更高的那个，保证可读性优先
      const score = (candidate) => Math.min(...list.map((bg) => contrast(candidate, bg)))
      return score('#000000') >= score('#ffffff') ? '#000000' : '#ffffff'
    }

    function tuneRamps(ramps, scheme, hc) {
      const F = floors(hc)
      // 靶点必须用**真实承载面**，不能用画布：三级文字与链接大量落在卡层(60)、
      // 深色模块层(800)上，只对 00/950 求解会得到「画布达标、卡层不达标」。
      //
      // 深色侧还要面对**物理上限**：白色对 800 面最多只有 10.1–11.0:1，
      // 12:1（HC 15:1）不可能达成。这里按「目标与可达上限取小」求解，并留 7% 色彩余量，
      // 由 palette-dev 报告「承诺 / 可达 / 实际」，不再假装能到 15。
      const lightCanvas = ramps.bluish['00']
      const lightCard = ramps.bluish['60']
      const darkCanvas = ramps.bluish['950']
      const darkModule = ramps.bluish['800']
      const darkCard = ramps.bluish['850']
      const maxOn = (bg, lightFg) => contrast(lightFg ? '#ffffff' : '#000000', bg)
      // 0.93 而不是 0.995：贴着上限求解会把深色正文推成纯白，文字色味（paperC）全丢；
      // 留出余量才能既达到可见的最高档，又保住「近白但有色味」的设计意图。
      const clampTarget = (bg, target, lightFg) => Math.min(target, Math.max(1, maxOn(bg, lightFg) * 0.93))
      const jobs = [
        ['1000', [lightCard, lightCanvas], F.main, false],
        ['700', [lightCard], F.secondary, false],
        ['600', [lightCard], F.tertiary, false],
        // 深色次级：(300) 之前从未被求解；800 是最亮的深色面，对浅色文字最难
        ['300', [darkModule, darkCard, darkCanvas], F.secondary, true],
        ['400', [darkModule], F.tertiary, true],
      ]
      for (const [step, bgs, target, lightFg] of jobs) {
        const effective = bgs.reduce((acc, bg) => Math.min(acc, clampTarget(bg, target, lightFg)), target)
        ramps.bluish[step] = solveForeground(ramps.bluish, step, bgs, effective, hc ? 0.30 : 0.13)
      }
      // 深色正文：以最亮的深色面（800）为求解面。它对浅色文字最难；把它抬到可达上限后，
      // 850/875/950 会自然更高。12/15 在 800 上物理不可达，所以目标按该面上限钳位，
      // 由 palette-dev 报告「承诺 / 可达 / 实际」，不再假装能到 15。
      {
        const target = Math.min(F.main, maxOn(darkModule, true) * 0.93)
        ramps.bluish['50'] = solveForeground(ramps.bluish, '50', darkModule, target, hc ? 0.30 : 0.13)
      }
      /* 深色链接：按 **APCA Lc** 兜底，而不是 WCAG 比值（1.9.9 补）。
       *
       * 为什么不用比值：深色面上同一比值换到的 Lc 差得远 —— 自定义配色在 875 面上
       * 4.62 只等于 Lc 52.7，而本插件给所有文字定的可读下限是 Lc 60。
       * 直接抬 WCAG 下限也不行：要让最亮的深色面(800)达到 Lc 60，比值得抬到 8 以上，
       * 而 8 在 950 面上已经是 Lc≈85 的「近白链接」，链接与正文的层级感全没了。
       * 所以这里沿亮度走，**以最难达标的那一面(800)为准**把 Lc 顶到下限：
       *   普通档 60（正文/次级的下限同档）· 高对比 75
       * 只改 deepseek-400：500 是设计稿的品牌基准，浅色链接从它派生（见 lightLink）。
       */
      {
        const linkSurfaces = [ramps.bluish['800'], ramps.bluish['850'], ramps.bluish['875'], ramps.bluish['950']]
        ramps.deepseek['400'] = raiseToLc(ramps.deepseek['400'], linkSurfaces, hc ? 75 : 60)
      }
      return ramps
    }

    /**
     * 浅色链接：从品牌基准色（`deepseek-500`）派生一条够 AA 的色。
     *
     * 为什么不能直接用 500：设计稿给的标准值（暖砂 `#A9683E`）在浅色悬浮面 `150` 上只有
     * 3.46:1、画布上 4.06 —— 那是「品牌色」不是「链接色」。链接要 4.62 起，所以同色相同色度、
     * 明度往可行的一侧收（两个方向都找），收到达标为止。
     * 这样宿主里 500 的其它用途（info 按钮填充、焦点环、deep-diving 文字、卡片预览色）
     * 全部保持标准值，只有「当文字用」的链接换一条。
     */
    function lightLink(r, hc) {
      const target = floors(hc).link
      if (r === BASE) return BASE.deepseek['500'] // 黑白配色没被覆盖，走宿主原值
      // 链接出现在卡层(60)、画布(00) 与悬浮层(150) 上；150 最难，要求同时达标。
      const surfaces = [r.bluish['150'], r.bluish['60'], r.bluish['00']]
      if (surfaces.every((bg) => contrast(r.deepseek['500'], bg) >= target)) return r.deepseek['500']
      // 链接允许比正文移动更大：语义色必须可读，宁可偏离品牌色
      return solveForeground(r.deepseek, '500', surfaces, target, hc ? 0.60 : 0.45)
    }

    /* ================= token 组装 ================= */
    /** 重建结果缓存：一个配色只算一次（渲染时每张卡片都会取预览色）。 */
    // 审计 3.11：从 48 提到 96 —— 设置页连着拖色时，48 会在两个方向上反复淘汰重建。
    const RAMP_CACHE_LIMIT = 96
    const rampCache = new Map()
    // 自定义取色会持续产生新键；给一个小上限，避免长会话里只增不减
    function rememberRamp(key, value) {
      rampCache.set(key, value)
      while (rampCache.size > RAMP_CACHE_LIMIT) rampCache.delete(rampCache.keys().next().value)
      return value
    }
    function scalesFor(textMode) {
      const m = TEXT_MODES.find((x) => x.id === textMode) || TEXT_MODES[1]
      return {
        textScale: m.textScale, paperScale: m.paperScale, textLift: m.textLift || 0,
        // 审计 3.3：预置参考墨色的档位色度增减（自定义配色不读这两项，它的档位走 textScale）
        inkC: m.inkC || 0, inkDarkC: m.inkDarkC || 0,
      }
    }
    function rampsFor(scheme, textMode, hc) {
      const hcKey = hc === true ? ':hc' : ''
      // 自定义配色：按当前三色派生参数，缓存键必须带上三色
      let params = scheme
      let customKey = ''
      if (scheme && scheme.custom === true) {
        const colors = readCustom()
        params = customScheme(colors)
        customKey = ':' + colors.bg + colors.text + colors.accent
      }
      // 黑白配色：色相/色度都是 0，但**仍然过一次引擎** —— 否则它会保留宿主的三级 3.71、
      // 链接 4.23（都没到 AA），而它正是默认配色。引擎在这里只做两件事：原样重建（C=0）+ 求解对比度。
      if (!params.tinted) {
        const monoKey = 'mono:aa' + hcKey
        let mono = rampCache.get(monoKey)
        if (mono === undefined) {
          const clone = (o) => Object.fromEntries(Object.entries(o))
          mono = tuneRamps(
            { bluish: clone(BASE.bluish), neutral: clone(BASE.neutral), deepseek: clone(BASE.deepseek), blue: clone(BASE.blue) },
            scheme,
            hc,
          )
          rememberRamp(monoKey, mono)
        }
        return mono
      }
      const key = params.id + ':' + textMode + hcKey + customKey
      let cached = rampCache.get(key)
      if (cached === undefined) {
        cached = tuneRamps(buildRamps(params, scalesFor(textMode)), params, hc)
        rememberRamp(key, cached)
      }
      return cached
    }

    /**
     * 字面量别名的染色表：这些 token 在官方样式表里是写死的 rgba，
     * 不跟着色阶走，必须单独覆盖，否则暖底上会出现冷灰发丝线。
     * 值按「浅色 / 深色」给一对（overrideTokens 的硬性要求）。
     */
    function aliasOverrides(r, hc) {
      const ink = r.bluish['1000'] // 浅色模式的墨色
      const paper = r.bluish['50'] // 深色模式的纸白
      const grey = r.bluish['700'] // 悬浮在媒体上的工具条用中性灰
      /* ---- 边框：默认低噪、高对比档必须过 3:1（审计 3.4）----
       * 默认档是 4%–16% 墨色叠加，合成后在画布上只有 1.2–1.9:1 —— 这是**有意**的低噪设计
       * （参考实现也是这个量级，界面不会变成表格）。但高对比模式继续用 alpha 就说不过去了：
       * 1.9.8 的 HC 只改了文字，边框 alpha 没动，实测数值完全一样，HC 名不副实。
       * 现在 HC 下按 SC 1.4.11 对承载面反解到 3:1 / 3.4:1 / 4:1，三档保留层级。
       */
      const inkOf = (mode) => (mode === 'light' ? ink : paper)
      const alphaBorder = (mode, alpha) => withAlpha(inkOf(mode), alpha)
      /**
       * HC 的边框要的是**定量**：3.0 / 3.4 / 4.0。之前用 solveForeground 求解，
       * 从墨色起步时它一步都不用挪就「已达标」→ 直接返回墨色，实测 16.9:1 ——
       * 发丝线变成黑框，比不改还难看。混色求解才命中目标本身。
       * 承载面取该模式**最亮的那一层**（浅：00/60），因为边框是深于背景的那一侧，
       * 最亮的承载面对它才是最难的一关。
       *
       * 深色侧例外（1.9.10 内调整）：深色有四层面（950 侧栏 / 875 / 850 / 800 模块面），
       * 一根线不可能对四层等强。取最亮的 800 定标时，同一根线在 950 上读 5.3–7.1:1，
       * 比浅色侧还硬（用户实测「边框全变了、扎眼」）；只对 950 定标又会让 800 掉到 1.9。
       * 所以深色取**中间两层 875/850** 定标，并把目标抬一档（3.2 / 3.6 / 4.1）：
       * 950 落 3.5–4.6（稳过 3:1 但不再比浅色硬），800 落 2.3–3.0（仍看得见分界）。
       */
      const solidBorder = (mode, target) => mixToContrast(
        mode === 'light' ? [r.bluish['00'], r.bluish['60']] : [r.bluish['875'], r.bluish['850']],
        inkOf(mode),
        target,
      )
      const border = (mode, alpha, target) => (hc ? solidBorder(mode, target) : alphaBorder(mode, alpha))
      return {
        /* ---- 链接：唯一一条「不是标准色、而是从标准色派生」的强调色 ----
           宿主 `--dsw-alias-link` 指 deepseek-500（浅）/ 400（深），而 500 是品牌基准色。
           标准值当正文链接时过不了 AA（暖砂 #A9683E 在 150 面上 3.46），所以浅色链接
           用同色相的派生色；深色链接直接用 400（已由求解器兜到 4.62 起）。 */
        '--dsw-alias-link': { light: lightLink(r, hc), dark: r.deepseek['400'] },

        '--dsw-alias-border-l1': { light: alphaBorder('light', 0.04), dark: alphaBorder('dark', 0.06) },
        '--dsw-alias-border-l2': { light: border('light', 0.10, 3.0), dark: border('dark', 0.12, 3.2) },
        '--dsw-alias-border-l2-darkmode-thin': { light: alphaBorder('light', 0.10), dark: alphaBorder('dark', 0.06) },
        '--dsw-alias-border-l3': { light: border('light', 0.12, 3.4), dark: border('dark', 0.16, 3.6) },
        '--dsw-alias-border-l4': { light: border('light', 0.16, 4.0), dark: border('dark', 0.20, 4.1) },
        /* 组件边界（勾选框 / 输入框 / 开关 / 焦点环）：宿主只有 l1..l4 四级，没有
           「装饰性分隔线」与「组件边界」的区分，而 SC 1.4.11 只管后者。
           这里额外给一档 3:1 的实色，本插件设置页自己的控件用它（审计 3.5）；
           宿主自身的控件边框仍由宿主负责，不在本插件的覆盖范围内。 */
        '--dshtp-border-control': { light: solidBorder('light', 3.0), dark: solidBorder('dark', 3.0) },
        '--dsw-alias-bg-skeleton': { light: alphaBorder('light', 0.04), dark: alphaBorder('dark', 0.08) },

        /* ---- 悬停 / 按下：内置是蓝灰墨 #263148，暖色主题下会显冷 ---- */
        /* 深色的 alpha 比浅色小 1/3：深色叠的是近白纸色，8% 的纸色在 L 0.22 上抬起的明度
           约等于 6% 的墨色在 L 0.93 上压下的两倍。旧值（0.08/0.14/0.24）实测
           ΔE 7.05 / 12.19 / 20.08，是浅色（3.92 / 6.76 / 9.51）的 1.8–2.1 倍 ——
           深色下悬停一行会「闪」，按下像换了一块面。现在收到 4.6 / 7.9 / 12.2。 */
        // 最常用的一档悬停（行、菜单项、气泡按钮都走它）
        '--dsw-alias-interactive-bg-hover': { light: withAlpha(ink, 0.06), dark: withAlpha(paper, 0.05) },
        '--dsw-alias-interactive-bg-active': { light: withAlpha(ink, 0.10), dark: withAlpha(paper, 0.09) },
        '--dsw-alias-interactive-bg-hover-accent': { light: withAlpha(ink, 0.14), dark: withAlpha(paper, 0.14) },

        /* ---- 悬浮工具条（图片/视频上的按钮），内置是纯灰 #545557 ---- */
        '--dsw-alias-button-tool-bar-fill': { light: withAlpha(grey, 0.50), dark: withAlpha(grey, 0.50) },
        '--dsw-alias-button-tool-bar-hover': { light: withAlpha(grey, 0.60), dark: withAlpha(grey, 0.60) },
        '--dsw-alias-button-tool-bar-fill-invisible': { light: withAlpha(ink, 0.36), dark: withAlpha(ink, 0.36) },

        /* ---- 菜单表面：内置是 #f8f9fa / #43454a，冷灰会让下拉菜单明显跳色 ---- */
        '--dsw-menu-surface-fill': {
          light: withAlpha(r.bluish['50'], 0.58),
          dark: withAlpha(r.bluish['750'], 0.45),
        },
        // 宿主 `--dsw-specific-menu` 自带字面量兜底（浅 #f8f9faf0 / 深 #303136f0），
        // 只改 menu-surface-fill 不够：深色菜单实际用的是它，会留着冷灰。这里一并对齐。
        '--dsw-specific-menu': {
          light: withAlpha(r.bluish['50'], 0.94),
          dark: withAlpha(r.bluish['850'], 0.94),
        },
        // 浅色写死 #4176e6（宿主蓝），深色已引用 deepseek-450；两模式都归到强调色
        '--dsw-alias-brand-primary-new-colorprimary-new-color': {
          light: r.deepseek['500'],
          dark: r.deepseek['400'],
        },
        '--dsw-alias-menu-group-header-fill': {
          // 用 60 而不是 50：50 现在是「深色模式正文」的色度，拿去当浅色菜单头会偏艳
          light: withAlpha(r.bluish['60'], 0.94),
          dark: withAlpha(r.bluish['800'], 0.94),
        },
        '--dsw-alias-bg-mask-drop': { light: withAlpha(r.bluish['00'], 0.70), dark: withAlpha(r.bluish['800'], 0.70) },
        // 注释文字：宿主浅色用 400、深色用 600。深色的 600 被「浅色三级文字要 AA」的求解压暗过，
        // 直接用在深底上只有 3.x:1；这里改用 500 并对**深色模块面(800)/卡层(850)** 求解到 AA。
        // 实测旧注释「约 6.5:1」不成立（实际 4.4–4.7），所以既改值也改注释。
        '--dsw-alias-label-caption': {
          // 注释/时间戳：既要跟随主题（色度由 midC 给），也要在画布/卡层上可读。
          // 直接拿 400 号色在浅色下只有约 2.4:1，所以这里对 00/60 求解到 AA。
          light: solveForeground(r.bluish, '400', [r.bluish['00'], r.bluish['60']], floors(hc).tertiary, 0.62),
          dark: solveForeground(
            r.bluish,
            '500',
            [r.bluish['800'], r.bluish['850']],
            Math.min(floors(hc).tertiary, contrast('#ffffff', r.bluish['800']) * 0.995),
            0.30,
          ),
        },
        // 主人气泡（`--dsw-specific-bubble`）宿主指向 deepseek-50：那是「品牌色的极浅底」，
        // 我的强调色色度高，浅端直接算出 #ffede0（R 顶满 255）→ 看着发粉发红。
        // 改成「强调色 8–10% 混画布」，气泡是有色味的浅底而不是一块彩色。
        '--dsw-specific-bubble': {
          light: mixHex(r.deepseek['500'], r.bluish['00'], 0.11),
          dark: mixHex(r.deepseek['400'], r.bluish['950'], 0.13),
        },
      }
    }

    /**
     * 滚动条四条 token：底色取 neutral 色阶的对应步，只把色度抬到指定档位。
     * 明度完全沿用宿主，所以滚动条与背景的明暗关系不变，只是带上色相。
     */
    function scrollbarTokens(ramps, scheme, mode, hc) {
      const m = SCROLL_MODES.find((x) => x.id === mode) || SCROLL_MODES[1]
      if (!m.chroma || !scheme.tinted) return {}
      const hue = m.useAccent ? scheme.accentHue : scheme.hue
      const paint = (step) => {
        const [L, C] = toOklch(ramps.neutral[step])
        return fromOklch(L, Math.max(C, m.chroma), hue)
      }
      /* 高对比档（审计 3.4）：滚动条是非文字的可操作组件，SC 1.4.11 要求 3:1。
       * 默认档的条纹只有 1.4–2.4:1（有意：滚动条不该抢视线）；
       * HC 下沿远离画布的方向提明度，直到过 3:1，色相与色度保持不变。
       * 「悬停/按下」再高 0.6 —— 四个 token 全部提到 3:1 会让 hover 与常态一模一样，
       * 滚动条按下去没有任何反馈。
       */
      const ensure = (hex, canvas, target) => {
        const need = target === undefined ? 3.0 : target
        if (!hc) return hex
        const [L, C, h] = toOklch(hex)
        const dir = contrast('#ffffff', canvas) >= contrast('#000000', canvas) ? 1 : -1
        let cur = L
        for (let i = 0; i < 160; i++) {
          const c = fromOklch(clamp(cur, 0.05, 0.99), C, h)
          if (contrast(c, canvas) >= need) return c
          cur += dir * 0.004
        }
        return fromOklch(clamp(cur, 0.05, 0.99), C, h)
      }
      const lightCanvas = ramps.bluish['00']
      const darkCanvas = ramps.bluish['950']
      return {
        '--dsw-alias-scrollbar-bg-l1': { light: ensure(paint('200'), lightCanvas), dark: ensure(paint('700'), darkCanvas) },
        '--dsw-alias-scrollbar-bg-l2': { light: ensure(paint('200'), lightCanvas), dark: ensure(paint('600'), darkCanvas) },
        '--dsw-alias-scrollbar-hover-l1': { light: ensure(paint('300'), lightCanvas, 3.6), dark: ensure(paint('600'), darkCanvas, 3.6) },
        '--dsw-alias-scrollbar-hover-l2': { light: ensure(paint('300'), lightCanvas, 3.6), dark: ensure(paint('550'), darkCanvas, 3.6) },
      }
    }

    /**
     * 区块底色：把「左侧栏」从共享色阶上解耦出来单独控制。
     * 内置值是 --dsw-static-neutral-bluish-50（浅）/ -900（深），与主画布几乎同色，
     * 所以左栏和主区看不出边界；这里按 SIDEBAR_MODES 的档位重算。
     *
     * 关键：提亮时**保留色味**（受 LIGHT_CAP 约束），侧栏是该配色的浅一号，
     * 不是纯白 —— 否则换了配色侧栏还是白色，配色就白选了。
     * 黑白配色没有色味可留，浅色模式直接给纯白（画布另压一档，见 buildTokens）。
     *
     * 1.9.4：画布已收敛到近中性（00 的 C≈0.004），只靠继承拿不到参考侧栏那份暖色
     * （参考 #faf6ef，C≈0.009）。这里按方案自身的 lightC 把侧栏色度显式补到约 0.75×lightC。
     */
    function sidebarTokens(r, mode, tinted, scheme) {
      const m = SIDEBAR_MODES.find((x) => x.id === mode) || SIDEBAR_MODES[0]
      const lightLift = m.lift
      // 深色模式用独立的 darkLift：深色底的可用明度空间比浅色小得多，
      // 沿用浅色步长（0.032/-0.020）在深色侧只有 ΔE 1.9–2.3 —— 正好卡在 JND 上，
      // 于是「左栏和中栏看不出界线」。深色侧给 0.048 / -0.042（ΔE 4 左右）。
      const darkLift = m.darkLift
      const s = m.chroma
      const paper = r.bluish['00']
      const fillRaw = !tinted && m.lift >= 0 ? '#ffffff' : lift(paper, lightLift, s)
      /**
       * 1.9.9 修补（用户实测：苔绿「同色」被染成薄荷绿、靛蓝「同色」与画布不同色）：
       *   ① 色度补偿原来固定用 `scheme.hue`，而画布 00 的色相来自 BASE 那条色阶（苔绿画布 h≈121，
       *      scheme.hue 是 162）—— 于是「补色度」那一步顺手把橄榄绿染成了薄荷绿。改为一律沿用
       *      **画布自己的色相**；
       *   ② 补偿只补「不够」的那部分，不再无条件把 C 抬到 0.010；
       *   ③ 「同色」档直接取画布本身 —— 走一遍 lift + 补偿会留下 0.4–2.5 的 ΔE，
       *      而用户点「同色」要的是「与主栏一模一样」，不是「接近」。
       */
      const lightFill = tinted
        ? (lightLift === 0
            ? paper
            : (() => {
                const [L, C, h] = toOklch(fillRaw)
                const want = Math.min(
                  0.012,
                  Math.max(C, (scheme && scheme.lightC !== undefined ? scheme.lightC : C) * 0.75),
                )
                // 近白纸面（苔绿画布 L≈0.983）抬不动：LIGHT_CAP 只给 0.002 余量，实测与画布
                // 只差 ΔE 0.13 —— 用户点「更浅」等于什么都没发生。明度换不了就换色度：
                // 削到 0.25 倍并顶到明度上限，"更浅"读作「更白的一张纸」，ΔE ≈ 0.5。
                if (LIGHT_CAP - L < 0.012) return fromOklch(LIGHT_CAP, C * 0.25, h)
                return C >= want ? fillRaw : fromOklch(L, want, h)
              })())
        : fillRaw
      const darkFill = lift(r.bluish['950'], darkLift, s)
      // 悬停/选中相对「侧栏最终底色」推导，不能再各自抬一次 ——
      // 提亮有天花板（LIGHT_CAP），各自抬会被同一上限压平，悬停与底色撞成同色。
      // 步进放到 0.024/0.030（ΔE≈2.4，跨过并排色块的 JND），但「更浅」档必须加护栏：
      // 侧栏在画布之上，往下走两档会穿过画布，选中项就像在页面里挖了个洞。
      const canvasL = toOklch(paper)[0]
      const fillL = toOklch(lightFill)[0]
      const room = (fillL - canvasL) / 2 - 0.004
      // 近白纸面上「更浅」几乎没有向下空间（苔绿 canvas L≈0.983），fitStep 会被压到 0 ——
      // 那样悬停/选中与底色同色，用户点了没反应。给一步 0.012 的地板（ΔE≈1.2），
      // 宁可微微贴到画布，也不要「看起来没选中」。
      const fitStep = room > 0 ? Math.min(0.024, room) : 0
      // 地板与「不许穿回画布」在近白纸面上是矛盾的：可用空间只有 0.005–0.012，
      // 想给出可见的悬停步进就必然小幅下穿画布。这里定下口径 —— **允许最多 0.008 的下穿**
      // （实测 0.0026–0.0057，ΔE ≤ 1.4，读作「这一行被按下去一点」），
      // 但绝不允许旧版那种「悬停与底色完全相同」（ΔE 0.00）。
      const dipCap = Math.max(0, fillL - canvasL + 0.008)
      const lightStep = tinted
        ? (fillL > canvasL ? Math.min(Math.max(fitStep, 0.012), dipCap) : 0.024)
        : 0.020
      const darkStep = tinted ? 0.030 : 0.018
      return {
        '--dsw-specific-sidebar-fill': { light: lightFill, dark: darkFill },
        '--dsw-specific-sidebar-nav-item-hover': {
          light: lift(lightFill, -lightStep, 1),
          dark: lift(darkFill, darkStep, 1),
        },
        '--dsw-specific-sidebar-nav-item-active': {
          light: lift(lightFill, -lightStep * 2, 1),
          dark: lift(darkFill, darkStep * 2, 1),
        },
      }
    }

    /**
     * 覆盖层标记：只由本插件的覆盖层写出去。
     * 宿主撤销这一层（插件卸载 / fiber 清理）时标记会一起消失 ——
     * 自愈因此能看出「层真的没了」，而不是靠「token 属性是否非空」去猜
     * （覆盖层没了以后宿主的基础 token 仍然有值，旧判据会一直报假健康）。
     */
    const LAYER_MARK = '--dshtp-layer'

    /* ---------- 色阶排序归一化（审计 3.2）----------
     * 单条色阶同时服务明暗两侧，语义是「序号越大越深」。但求解器是逐个承载面反解明度的，
     * 收尾时不排序就会出现反序：浅色 1000（正文墨色）为凑 12:1 被拉亮到 L≈0.250，
     * 反而比 950（侧栏深底 L≈0.194）更亮 —— 「越深越黑」在最后两档失效。
     * 这里只做最小必要修正，不重排设计：
     *   1) 面/中性档之间严格递减（间隔 ≥ RAMP_MIN_GAP，约 ΔE 0.6，肉眼不可辨但不再是同色）；
     *   2) 浅色墨色档（600/700/1000）必须比它前面那一档更深。
     * 深色墨色档（50/300/400）**有意**比相邻面更亮（字要比底亮），不参与排序 ——
     * 它们的下限由对比度求解器负责，排序会把它们压暗、直接违反 3.1 的新下限。
     * 归一化只会把颜色压深（明度只减不增）：浅色侧背景变暗、深色侧背景变暗，
     * 两侧的文字对比度都只会上升，不会破新下限。
     */
    const RAMP_MIN_GAP = 0.006
    const RAMP_INK_LIGHT = ['600', '700', '1000']
    const RAMP_INK_DARK = ['50', '300', '400']
    const RAMP_ORDER = ['00', '50', '60', '75', '100', '150', '200', '300', '400', '500', '600', '700', '750', '800', '850', '875', '950', '1000']

    function enforceRampOrder(pairs) {
      const key = (step) => '--dsw-static-neutral-bluish-' + step
      const present = RAMP_ORDER.filter((s) => pairs[key(s)])
      if (present.length < 8) return false
      let changed = false
      const clampTo = (step, side, Lmax, C, h) => {
        const [L] = toOklch(pairs[key(step)][side])
        if (L <= Lmax) return
        pairs[key(step)][side] = fromOklch(Lmax, C, h)
        changed = true
      }
      for (const side of ['light', 'dark']) {
        const inks = side === 'light' ? RAMP_INK_LIGHT : RAMP_INK_DARK
        // 1) 面/中性档严格递减（跳过墨色档，它们不按序号排）
        let prev = null
        for (const step of present) {
          const [L, C, h] = toOklch(pairs[key(step)][side])
          const ink = inks.includes(step)
          if (!ink && prev !== null && L > prev - RAMP_MIN_GAP) clampTo(step, side, prev - RAMP_MIN_GAP, C, h)
          const [Lf] = toOklch(pairs[key(step)][side])
          prev = Lf
        }
        // 2) 浅色墨色档（700 / 1000）：只在墨色之间保证「序号越大越深」。
        //    不能拿它跟 950 之类的深色**面**比大小 —— 参考墨色 #2b2622（L≈0.27）本来就比
        //    浅色模式里最深的 950 面（L≈0.15）浅，强行压成反序会让正文变成近黑（ΔE 7.4），
        //    违背 1.9.0「参考墨色精确对齐」的承诺。墨色是文字，不参与面的阶梯。
        if (side === 'light') {
          let prevInk = null
          for (const step of present) {
            if (!inks.includes(step)) continue
            const [L, C, h] = toOklch(pairs[key(step)][side])
            if (prevInk !== null && L > prevInk - RAMP_MIN_GAP) clampTo(step, side, prevInk - RAMP_MIN_GAP, C, h)
            prevInk = toOklch(pairs[key(step)][side])[0]
          }
        }
      }
      return changed
    }

    /* ---------- token 层结果缓存（审计 3.11）----------
     * buildTokens 实测 2.4 ms/次，而设置页一次渲染会算好几遍（渲染 + 对比度报表 + 自定义解释）。
     * 色阶早就有缓存（rampCache），token 层没有；这里按「配色 + 三色 + 七个 mode」缓存整张表。
     * 表只读（覆盖层与报表都只读它），所以可以安全复用同一个对象。
     */
    const tokenCache = new Map()
    const TOKEN_CACHE_LIMIT = 24
    function buildTokens(scheme, sidebarMode, textMode, scrollMode, controlMode, mdMode, hcMode) {
      const customKey = scheme && scheme.custom === true
        ? (() => { const c = readCustom(); return c ? c.bg + c.text + c.accent : '' })()
        : ''
      const key = [
        scheme && scheme.id, customKey, sidebarMode, textMode,
        scrollMode, controlMode, mdMode, hcMode === true ? 1 : 0,
      ].join('|')
      const hit = tokenCache.get(key)
      if (hit) return hit
      const built = buildTokensRaw(scheme, sidebarMode, textMode, scrollMode, controlMode, mdMode, hcMode)
      tokenCache.set(key, built)
      while (tokenCache.size > TOKEN_CACHE_LIMIT) tokenCache.delete(tokenCache.keys().next().value)
      return built
    }

    function buildTokensRaw(scheme, sidebarMode, textMode, scrollMode, controlMode, mdMode, hcMode) {
      // hc 同时接受布尔与 HC_MODES 的 id（'on' / 'off'）：两条调用路径历史上混用过
      const hc = hcMode === true || hcMode === 'on'
      // 审计 3.9：入口先校验模式 id（拼错就静默退回默认是最难查的一类问题）
      warnUnknownModes({ sidebarMode, textMode, scrollMode, controlMode, mdMode })
      // 自定义配色必须先解引用：ramps 内部会派生参数，但 accent / scroll / control
      // 这些直接读 params.accentHue、params.hue 的地方若拿到占位值，就会"不跟取色"
      const params = scheme && scheme.custom === true ? customScheme(readCustom()) : scheme
      const ramps = rampsFor(params, textMode || DEFAULT_TEXT, hc)
      const pairs = {}
      if (!params.tinted) {
        // 黑白：只输出「被求解改动过」的那几步 + 派生链接，不整条覆盖（保持宿主原貌）
        for (const step of ['400', '600', '700', '1000']) {
          pairs['--dsw-static-neutral-bluish-' + step] = { light: ramps.bluish[step], dark: ramps.bluish[step] }
        }
        pairs['--dsw-static-deepseek-500'] = { light: ramps.deepseek['500'], dark: ramps.deepseek['500'] }
        pairs['--dsw-alias-link'] = { light: lightLink(ramps, hc), dark: BASE.deepseek['400'] }
        // 主按钮同理：宿主浅色是红（对白字 4.34，差 0.16 才到 AA），压暗一档到 4.5
        // 注意：「更浅」档会把画布压到 #fafafa，按钮还要在最暗的那版画布上达标，
        // 所以按 #f5f5f5 兜底而不是纯白。
        const monoBtn = darkenUntil(ramps.deepseek['500'], '#f5f5f5', 4.5)
        pairs['--dsw-alias-button-primary-fill'] = { light: monoBtn, dark: ramps.bluish['1000'] }
      }
      // 其它配色：整条色阶 + 字面量别名覆盖。
      if (params.tinted) {
        for (const [family, table] of Object.entries(ramps)) {
          for (const [step, value] of Object.entries(table)) {
            pairs['--dsw-static-' + (family === 'bluish' ? 'neutral-bluish-' : family + '-') + step] = {
              light: value,
              dark: value,
            }
          }
        }
        const aliases = aliasOverrides(ramps, hc)
        for (const [name, pair] of Object.entries(aliases)) pairs[name] = pair
      }
      const sidebar = sidebarTokens(ramps, sidebarMode, params.tinted, params)
      for (const [name, pair] of Object.entries(sidebar)) pairs[name] = pair
      // 右栏底色：**给具体色值，不给 var() 引用**（1.9.10）。面板里要把 --dsw-alias-bg-base
      // 重映射成这个 token，若此处再写 var(--dsw-alias-bg-base) 就是自定义属性自引用环，
      // 值在计算时退化为 unset，面板内所有 bg-base 表面一起失效 —— 正是「设了像没设」的形态。
      // 主按钮：浅色下宿主把 button-primary-fill 指到 state-error-primary（红），
      // 于是页面上有「红主按钮 + 强调色」两个主色。改成强调色，并压暗到按钮文字 ≥4.5。
      // 黑白配色在上面已经单独设过，这里跳过（它要按「更浅」档的画布兜底）。
      if (params.tinted) {
        pairs['--dsw-alias-button-primary-fill'] = {
          light: darkenUntil(ramps.deepseek['500'], ramps.bluish['00'], 4.5),
          dark: ramps.deepseek['400'],
        }
        // info 按钮同样是「强调色填充 + 白字」，宿主直接指向 deepseek-500。
        // 极端自定义强调色下会变成浅底白字；与主按钮一样按白字 4.5 压暗。
        pairs['--dsw-alias-button-info-fill'] = {
          light: darkenUntil(ramps.deepseek['500'], ramps.bluish['00'], 4.5),
          dark: ramps.deepseek['400'],
        }
      }
      // 选中卡片的淡底：必须按模式给，原写法（强调色混**浅色**画布）在深色模式下
      // 会得到一张近白卡片，而卡片文字是 label-primary（深色下近白）→ 白底白字。
      const accentHex = ramps.deepseek['500']
      const accentDark = ramps.deepseek['400']
      pairs['--dshtp-card-picked'] = {
        light: mixHex(accentHex, ramps.bluish['00'], 0.10),
        dark: mixHex(accentDark, ramps.bluish['950'], 0.16),
      }
      // 右栏不再染色（1.9.10）：宿主那块「右栏面板」是 position:absolute 的整高覆盖层，
      // 本身没有底色 —— 它透明时才露出主栏画布；一旦给它上色，就会盖住主栏一大块，
      // 连切换按钮都被压在下面（用户实测）。网格列又完全被它盖住，所以这一档没有
      // Markdown 强调色：标题分三档（h1/h2 → h3/h4 → h5/h6），加粗比标题再弱一档。
      // 分档而不是给六级标题六种色：长文靠层级扫读，不靠色相数量。
      if (params.tinted) {
        const tintText = (hex, accentHex, extraChroma, lift) => {
          const [L, C] = toOklch(hex)
          const acc = toOklch(accentHex)
          return fromOklch(clamp(L + lift, 0.05, 0.97), C + acc[1] * extraChroma, acc[2])
        }
        if (mdMode === 'off') {
          const inherit = { light: 'inherit', dark: 'inherit' }
          for (const k of ['--dshtp-md-h1', '--dshtp-md-h2', '--dshtp-md-h3', '--dshtp-md-strong',
            '--dshtp-md-quote-fill', '--dshtp-md-quote-border', '--dshtp-md-table-head']) pairs[k] = inherit
        } else {
          // 加粗：只加色度、不动明度 —— 混色会把正文调亮（浅色下反而比正文更弱）。
          // 标题：再往中间推一点明度（浅色提亮 / 深色压暗），配合更大的字号拉开层级。
          pairs['--dshtp-md-h1'] = {
            light: tintText(ramps.bluish['1000'], ramps.deepseek['500'], 0.45, 0.065),
            dark: tintText(ramps.bluish['50'], ramps.deepseek['400'], 0.40, -0.030),
          }
          pairs['--dshtp-md-h2'] = {
            light: tintText(ramps.bluish['1000'], ramps.deepseek['500'], 0.38, 0.035),
            dark: tintText(ramps.bluish['50'], ramps.deepseek['400'], 0.36, -0.018),
          }
          pairs['--dshtp-md-h3'] = {
            light: tintText(ramps.bluish['1000'], ramps.deepseek['500'], 0.30, 0.015),
            dark: tintText(ramps.bluish['50'], ramps.deepseek['400'], 0.28, -0.008),
          }
          pairs['--dshtp-md-strong'] = {
            light: tintText(ramps.bluish['1000'], ramps.deepseek['500'], 0.32, 0.012),
            dark: tintText(ramps.bluish['50'], ramps.deepseek['400'], 0.32, -0.010),
          }
          // 引用 / 表头：只掺 4–7% 强调色，主文字在这些面上仍要走"不降级"的对比度断言
          pairs['--dshtp-md-quote-fill'] = {
            light: mixHex(ramps.deepseek['500'], ramps.bluish['00'], 0.04),
            dark: mixHex(ramps.deepseek['400'], ramps.bluish['950'], 0.06),
          }
          pairs['--dshtp-md-quote-border'] = {
            light: mixHex(ramps.deepseek['500'], ramps.bluish['150'], 0.55),
            dark: mixHex(ramps.deepseek['400'], ramps.bluish['800'], 0.55),
          }
          pairs['--dshtp-md-table-head'] = {
            light: mixHex(ramps.deepseek['500'], ramps.bluish['60'], 0.05),
            dark: mixHex(ramps.deepseek['400'], ramps.bluish['850'], 0.07),
          }
        }
      }
      // 代码块底色：宿主用 bg-layer-1，浅色下与画布同色（都指 00）→ 看不出边界。
      // 这里给它一档独立的"内嵌面板"色：卡层色 + 少量强调色相，保证与画布有可辨差。
      // mixHex(a, b, w) = a*w + b*(1-w)：a 是要掺进去的颜色，b 是底色。
      const codeFill = {
        light: mixHex(ramps.deepseek['500'], ramps.bluish['60'], 0.08),
        dark: mixHex(ramps.deepseek['400'], ramps.bluish['875'], 0.10),
      }
      pairs['--dshtp-code-fill'] = codeFill
      // 宿主的 <pre> 背景来自 --shiki-background → --dsw-alias-markdown-code-block（bluish-50/900）。
      // 不覆盖它就会出现"外层 div 染了、内层 pre 没染"的双层底；直接改这个 token 才是根治。
      pairs['--dsw-alias-markdown-code-block'] = codeFill
      pairs['--dsw-alias-markdown-code-block-banner'] = {
        light: mixHex(ramps.deepseek['500'], ramps.bluish['50'], 0.06),
        dark: mixHex(ramps.deepseek['400'], ramps.bluish['850'], 0.08),
      }
      pairs['--dshtp-code-inline'] = {
        light: mixHex(ramps.deepseek['500'], ramps.bluish['50'], 0.05),
        dark: mixHex(ramps.deepseek['400'], ramps.bluish['900'], 0.07),
      }
      /* ---- 文件 diff：宿主是固定冷绿/冷红的大面积色块，暖砂/苔绿下最显眼。
       * 只做「温度调和」：保留绿=新增、红=删除的语义色相，往配色色相拉 16–22° 并压低饱和。 */
      if (params.tinted) {
        const diffHue = params.hue
        const area = (hex) => harmonize(hex, diffHue, 0.16, 0.90)
        const mark = (hex) => harmonize(hex, diffHue, 0.22, 0.95)
        pairs['--dsw-alias-file-diff-added-bg'] = { light: area('#e6f4e7'), dark: area('#1f3124') }
        pairs['--dsw-alias-file-diff-added-gutter'] = { light: area('#edf7ed'), dark: area('#132016') }
        pairs['--dsw-alias-file-diff-added-marker'] = { light: mark('#01a241'), dark: mark('#41c977') }
        pairs['--dsw-alias-file-diff-deleted-bg'] = { light: area('#fce6e2'), dark: area('#3c1f1b') }
        pairs['--dsw-alias-file-diff-deleted-gutter'] = { light: area('#fdece9'), dark: area('#28130e') }
        pairs['--dsw-alias-file-diff-deleted-marker'] = { light: mark('#ba2723'), dark: mark('#fa423e') }
      }
      /* ---- 语法高亮（1.8.2）----
       * 宿主渲染器用 Shiki 的 `css-variables` 模式（className="shiki css-variables"，
       * 样式走 var(--shiki-*)），所以覆盖这些变量有效，不需要 !important。
       *
       * 色相策略：不引入与配色无关的固定色，而是从强调色相出发取 3 个色族
       * （强调 / +150° 的冷族 / -55° 的暖族），再用明度与色度拉开可辨度；
       * 每个 token 都必须对代码块底达到 4.6:1，否则沿远离背景的方向调整明度。
       */
      if (params.tinted && mdMode === 'on') {
        const baseHue = params.accentHue === undefined ? scheme.hue : params.accentHue
        const pickL = (bg) => (contrast('#ffffff', bg) >= contrast('#000000', bg) ? 0.80 : 0.45)
        const dirOf = (bg) => (contrast('#ffffff', bg) >= contrast('#000000', bg) ? 1 : -1)
        const ink = (bg, hue, chroma, startL, target) => {
          const dir = dirOf(bg)
          let L = startL
          for (let i = 0; i < 160; i++) {
            const c = fromOklch(clamp(L, 0.02, 0.99), chroma, hue)
            if (contrast(c, bg) >= target) return c
            L += dir * 0.004
          }
          return fromOklch(clamp(L, 0.02, 0.99), chroma, hue)
        }
        // 每个色族自带目标对比度：同族靠明度分"常/表达"，异族靠色相差 55–150°
        const families = {
          keyword: [baseHue, 0.15, 4.6],
          function: [baseHue + 70, 0.12, 5.0],
          constant: [baseHue - 60, 0.13, 4.8],
          parameter: [baseHue + 30, 0.10, 5.6],
          string: [baseHue + 150, 0.10, 4.8],
          'string-expression': [baseHue + 150, 0.085, 5.8],
          comment: [baseHue, 0.015, 4.6],
          punctuation: [baseHue, 0.02, 6.0],
        }
        for (const [name, [hue, chroma, target]] of Object.entries(families)) {
          const key = '--shiki-token-' + name
          pairs[key] = {
            light: ink(codeFill.light, hue, chroma, pickL(codeFill.light), target),
            dark: ink(codeFill.dark, hue, chroma, pickL(codeFill.dark), target),
          }
        }
        pairs['--shiki-token-link'] = { light: lightLink(ramps, false), dark: ramps.deepseek['400'] }
        pairs['--shiki-background'] = codeFill
        pairs['--shiki-foreground'] = { light: ramps.bluish['1000'], dark: ramps.bluish['50'] }
      }
      const scroll = scrollbarTokens(ramps, params, scrollMode, hc)
      for (const [name, pair] of Object.entries(scroll)) pairs[name] = pair
      // 开关/勾选/单选的共用支点：brand-primary 本来是近黑/近白，改成强调色。
      if (controlMode === 'accent') {
        pairs['--dsw-alias-brand-primary'] = { light: ramps.deepseek['500'], dark: ramps.deepseek['400'] }
      }
      // 黑白配色的浅色画布本身就是纯白，「更浅」无处可提 —— 改成把会话区压一档浅灰，
      // 侧栏保持纯白，同样得到区块层次（这是唯一需要动画布的情形）。
      if (!params.tinted && sidebarMode === 'light') {
        pairs['--dsw-static-neutral-bluish-00'] = { light: '#fafafa', dark: BASE.bluish['00'] }
      }
      /* ---- 参考实现的 ink / link 精确对齐（1.9.0）----
       * 参考的 ink 比我们求解结果更浅、更中性；这里直接取参考值，
       * 但仍过一遍对比度下限：达不到的目标文字沿远离背景方向微调（只动明度，不动色相）。
       * 三级文字在控件面上若参考本身不达 AA，会略微变深 —— 这是唯一允许偏离参考的地方。
       */
      const TEXT_TARGETS = {
        warm: { light: { 1000: '#2b2622', 700: '#6b625a', 600: '#8c8177', link: '#8a5233' }, dark: { 50: '#f5efe8', 300: '#c4b8ac', 400: '#9a8d80', link: '#e6c4a0' } },
        indigo: { light: { 1000: '#1a2330', 700: '#516074', 600: '#74839a', link: '#345286' }, dark: { 50: '#eef3fa', 300: '#b7c5d8', 400: '#8a9bb2', link: '#a6bfe3' } },
        moss: { light: { 1000: '#1f2a22', 700: '#55645a', 600: '#7a8a7e', link: '#406236' }, dark: { 50: '#eef5ef', 300: '#b8c8bc', 400: '#8ba091', link: '#aed0a2' } },
      }
      const TT = TEXT_TARGETS[scheme.id]
      // 三套预置走参考目标；自定义没有参考表，但同样要拿到跟随主题的注释/文字
      if (scheme.tinted) {
        /* 一个求解器管三类用途（审计 3.11：原来 fit / boost / vivid 是三份近似复制）：
         * 给定色相与色度，沿「远离背景」的方向微调明度，直到每一步承载面都过 floor。
         *   addC：按档位给参考墨色加减色度（审计 3.3，静/标准/浓三档由此可辨）
         *   minC：色度不足时先抬到该值（注释层 / 二三级文字的「鲜艳度」）
         *   from：从指定明度起步（菜单文字的 dimTo）
         */
        const solveOn = (hex, bgs, floor, opts) => {
          const o = opts || {}
          const lo = o.lo === undefined ? 0.02 : o.lo
          const hi = o.hi === undefined ? 0.99 : o.hi
          const [L0, C0, h0] = toOklch(hex)
          // minC 与 addC 叠加：光有 minC 会把三档的「鲜艳度」拉平（靛蓝次级实测 ΔE 0.9），
          // 光有 addC 则二三级文字在低色度配色上根本抬不起来。
          const baseC = o.minC === undefined ? Math.abs(C0) : Math.max(Math.abs(C0), o.minC)
          const C = Math.max(0, baseC + (o.addC || 0))
          const dir = o.dir || (contrast('#ffffff', bgs[0]) >= contrast('#000000', bgs[0]) ? 1 : -1)
          let L = o.from === undefined ? L0 : o.from
          const steps = o.steps || 200
          for (let i = 0; i < steps; i++) {
            const c = fromOklch(clamp(L, lo, hi), C, h0)
            if (bgs.every((b) => contrast(c, b) >= floor)) return c
            L += dir * 0.003
          }
          return fromOklch(clamp(L, lo, hi), C, h0)
        }
        const SC = scalesFor(textMode)
        const lightBgs = ['00', '60', '150'].map((k) => pairs['--dsw-static-neutral-bluish-' + k].light)
        const darkBgs = ['950', '875', '850', '800'].map((k) => pairs['--dsw-static-neutral-bluish-' + k].dark)
        const F = floors(hc)
        // 深色侧单独一套下限（审计 3.1）：同样是 4.62，深色模块面上的 APCA Lc 只有 45–48，
        // WCAG 的「过 AA」在暗底上并不等于真的看得清。
        const FD = floorsDark(hc)
        if (TT) {
        pairs['--dsw-static-neutral-bluish-1000'].light = solveOn(TT.light['1000'], lightBgs, F.main, { addC: SC.inkC })
        pairs['--dsw-static-neutral-bluish-700'].light = solveOn(TT.light['700'], lightBgs, F.secondary, { addC: SC.inkC })
        pairs['--dsw-static-neutral-bluish-600'].light = solveOn(TT.light['600'], lightBgs, F.tertiary, { addC: SC.inkC })
        pairs['--dsw-static-neutral-bluish-50'].dark = solveOn(TT.dark['50'], darkBgs, F.main, { addC: SC.inkDarkC })
        pairs['--dsw-static-neutral-bluish-300'].dark = solveOn(TT.dark['300'], darkBgs, FD.secondary, { addC: SC.inkDarkC })
        pairs['--dsw-static-neutral-bluish-400'].dark = solveOn(TT.dark['400'], darkBgs, FD.tertiary, { addC: SC.inkDarkC })
        pairs['--dsw-alias-link'] = {
          light: solveOn(TT.light.link, lightBgs, F.link, { addC: SC.inkC }),
          // 深色链接再过一道 Lc 闸（1.9.9）：参考实现的链接色在 800 面上只有 Lc 59，
          // 刚好差一点；抬 WCAG 下限会把它推成近白，所以按 Lc 收。
          dark: raiseToLc(solveOn(TT.dark.link, darkBgs, F.link, { addC: SC.inkDarkC }), darkBgs, hc ? 75 : 60),
        }
        }
        // 更弱的注释层（label-dimmed / document-preview）也跟随主题：
        // 这些 token 走的是 200/750、300/700 这类低色度档，之前几乎是中性灰。
        const dimLight = solveOn(pairs['--dsw-static-neutral-bluish-200'].light, lightBgs, 3.0, { minC: 0.040, addC: SC.inkC })
        const dimDark = solveOn(pairs['--dsw-static-neutral-bluish-750'].dark, darkBgs, 3.0, { minC: 0.040, addC: SC.inkDarkC })
        pairs['--dsw-alias-label-dimmed'] = { light: dimLight, dark: dimDark }
        // 明暗两套都提高「鲜艳度」：二级/三级文字按主题色相给足色度，再对真实承载面求解对比度；
        // 只动色度不动语义。
        pairs['--dsw-alias-label-tertiary'] = {
          light: solveOn(pairs['--dsw-static-neutral-bluish-600'].light, lightBgs, F.tertiary, { minC: 0.055, addC: SC.inkC, steps: 240 }),
          dark: solveOn(pairs['--dsw-static-neutral-bluish-400'].dark, darkBgs, FD.tertiary, { minC: 0.055, addC: SC.inkDarkC, steps: 240 }),
        }
        pairs['--dsw-alias-label-secondary'] = {
          light: solveOn(pairs['--dsw-static-neutral-bluish-700'].light, lightBgs, F.secondary, { minC: 0.050, addC: SC.inkC, steps: 240 }),
          dark: solveOn(pairs['--dsw-static-neutral-bluish-300'].dark, darkBgs, FD.secondary, { minC: 0.050, addC: SC.inkDarkC, steps: 240 }),
        }
        // 深色模式菜单/说明文字：默认解到 800 面会偏亮，这里按导航实际承载面（950/875 起）
        // 压到更低的明度目标，达不到下限时才回抬，避免"菜单一片白"。
        // 1.9.8：承压面必须把 850/800 一起算进去 —— 只按 950/875 压暗，
        // 压出来的字色在更亮的 800（模块面）上对比度会掉到下限以下
        // （暖砂普通档三级文字 3.79、HC 4.29，低于 AA 4.5），
        // 而色阶步进（600/400）本来是按 800 求解的 —— 两边口径必须一致。
        const navBgs = ['950', '875', '850', '800'].map((k) => pairs['--dsw-static-neutral-bluish-' + k].dark)
        const dimTo = (hex, Lwant, bgs, floor) => solveOn(hex, bgs, floor, { from: Lwant, lo: 0.2, dir: 1, steps: 120 })
        pairs['--dsw-alias-label-secondary'].dark = dimTo(pairs['--dsw-alias-label-secondary'].dark, 0.78, navBgs, FD.secondary)
        pairs['--dsw-alias-label-tertiary'].dark = dimTo(pairs['--dsw-alias-label-tertiary'].dark, 0.70, navBgs, FD.tertiary)
        const prevLight = solveOn(pairs['--dsw-static-neutral-bluish-300'].light, lightBgs, 3.0, { minC: 0.030, addC: SC.inkC })
        const prevDark = solveOn(pairs['--dsw-static-neutral-bluish-700'].dark, darkBgs, 3.0, { minC: 0.030, addC: SC.inkDarkC })
        pairs['--dsw-alias-label-document-preview'] = { light: prevLight, dark: prevDark }
      }
            /* ---- 暗色正文按 10:1 定标（1.9.7）----
             * 12:1 在近黑底上要求近纯白，视觉发亮。策略 A：非高对比模式正文目标 10:1，
             * 只按 950/875/850 定标；最亮的模块面 800 不再兜底（约 5.6:1，仍过 AA）。
             */
      if (!hc && pairs['--dsw-static-neutral-bluish-50']) {
        const hex = pairs['--dsw-static-neutral-bluish-50'].dark
        const bgs = ['875', '950', '850'].map((k) => pairs['--dsw-static-neutral-bluish-' + k].dark)
        const [L0, C0, h0] = toOklch(hex)
        // 承诺面是 875/950（目标 10:1）。定标把正文压到「875 上限 10.2」，
        // 但压完必须仍 ≥ 10.0 —— 宁可亮一点也不失约；压过头就保持原色。
        let chosen = null
        let L = L0
        for (let j = 0; j < 240; j++) {
          const c = fromOklch(clamp(L, 0.2, 0.99), C0, h0)
          const r = contrast(c, bgs[0])
          if (r <= 10.2) { if (r >= 10) chosen = c; break }
          L -= 0.002
        }
        if (chosen) pairs['--dsw-static-neutral-bluish-50'].dark = chosen
      }
      // 色阶排序归一化（审计 3.2）：放在最后 —— 前面的求解与参考墨色对齐都可能把某一档
      // 推出反序，收尾统一压一次，保证「序号越大越深」在整条色阶上成立。
      if (params.tinted) enforceRampOrder(pairs)
      // 覆盖层标记（自愈判据用）：宿主撤销这一层时它会一起消失。
      pairs[LAYER_MARK] = { light: '1', dark: '1' }
return pairs
    }

    

    /** 卡片缩略图用的一小组颜色（画布/侧栏/文字/强调），按当前强度档取。 */
    function cardColors(scheme, textMode, sidebarMode) {
      const r = rampsFor(scheme, textMode || DEFAULT_TEXT)
      if (!r) {
        return {
          light: { canvas: '#ffffff', side: '#f7f7f7', text: '#0f1115', accent: '#4176e6' },
          dark: { canvas: '#151517', side: '#1b1b1c', text: '#f9fafb', accent: '#7aaaff' },
        }
      }
      const side = sidebarTokens(r, sidebarMode || DEFAULT_SIDEBAR, scheme.tinted)
      return {
        light: {
          canvas: r.bluish['00'],
          side: side['--dsw-specific-sidebar-fill'].light,
          text: r.bluish['1000'],
          accent: r.deepseek['500'],
        },
        dark: {
          canvas: r.bluish['950'],
          side: side['--dsw-specific-sidebar-fill'].dark,
          text: r.bluish['50'],
          accent: r.deepseek['400'],
        },
      }
    }

    /* ================= Markdown 样式（注入宿主 head） ================= */
    // 说明：本插件不额外处理 forced-colors —— 我们改的 color/background-color/border-color
    // 都在 UA 强制色列表内，系统高对比模式下会被自动接管，无需（也不应）用 forced-color-adjust 对抗。
    //
    // 这张表 0.9.0–1.9.9 叫 RIGHTBAR_CSS（那时它还装着右栏染色规则）。右栏在 1.9.10 整体撤除
    // （宿主面板是整高透明覆盖层：染列看不见、染面板盖住主栏 —— 见 docs/DESIGN.md），
    // 表里只剩 Markdown，名字跟着改回它实际的内容。
    const MARKDOWN_CSS = [
      // Markdown 标题/加粗：容器类是 CSS Modules 的 `_markdown_<hash>_<n>`，
      // 用「类名里含 _markdown_」做钩子（局部名稳定，比整串哈希耐版本）。
      // 三级层次：h1/h2 最重、h3/h4 次之、h5/h6 最轻（不是六级六色）。
      '[class*="_markdown_"] :where(h1,h2){color:var(--dshtp-md-h1,inherit)}',
      '[class*="_markdown_"] :where(h3,h4){color:var(--dshtp-md-h2,inherit)}',
      '[class*="_markdown_"] :where(h5,h6){color:var(--dshtp-md-h3,inherit)}',
      '[class*="_markdown_"] strong{color:var(--dshtp-md-strong,inherit)}',
      // 引用 / 表格 / 分割线 / 列表：只动"结构性"颜色，不碰正文
      '[class*="_markdown_"] blockquote{background:var(--dshtp-md-quote-fill,transparent);border-left:3px solid var(--dshtp-md-quote-border,currentColor)}',
      '[class*="_markdown_"] table th{background:var(--dshtp-md-table-head,transparent)}',
      '[class*="_markdown_"] :where(table th,table td){border-color:var(--dsw-alias-border-l2)}',
      '[class*="_markdown_"] hr{border:0;border-top:.5px solid var(--dsw-alias-border-l3)}',
      '[class*="_markdown_"] li::marker{color:var(--dsw-alias-label-tertiary)}',
      // 代码块：宿主把底色写在 CSS Modules 的 .block 上（浅色与画布同为 00，看不出边界）。
      // 这里以 `.md-code-block` 提高一级特异性覆盖，不需要 !important。
      '[class*="_markdown_"] .md-code-block{background:var(--dshtp-code-fill,inherit)}',
      '[class*="_markdown_"] :not(pre) > code{background:var(--dshtp-code-inline,inherit)}',
    ].join('')

    /* ================= 设置页样式（head 里第二条 CSS） ================= */
    const SETTINGS_STYLE_ID = 'dsh-theme-palette/settings.css'
    const SETTINGS_CSS = `
.dsh-tp{display:flex;flex-direction:column;gap:14px;width:100%;color:var(--dsw-alias-label-primary);box-sizing:border-box}
.dsh-tp-head{display:flex;align-items:center;gap:8px}
.dsh-tp-head h2{margin:0;font-size:18px;font-weight:600;letter-spacing:.2px}
.dsh-tp-badge{margin-left:auto;font:11px/1.7 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;padding:0 8px}
.dsh-tp-sub{margin:-6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-tp-notice{display:flex;align-items:flex-start;gap:10px;justify-content:space-between;padding:10px 12px;border-radius:12px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1)}
.dsh-tp-notice p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-tp-explain{margin:0;display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-preview{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1)}
.dsh-tp-preview p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-tp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,196px),1fr));gap:10px}
.dsh-tp-card{position:relative;display:flex;flex-direction:column;gap:8px;text-align:left;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;padding:9px;border-radius:14px;border:.5px solid var(--dsw-alias-border-l4);background:transparent;transition:background .12s ease,border-color .12s ease}
.dsh-tp-card:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-tp-card:focus-visible{outline-offset:2px}
/* 焦点环统一用宿主的主文字色（审计 3.11）：原来只写 outline-offset、颜色交给 UA，
 * 在部分浏览器/系统主题下这一圈会低到 1.x:1。2px 实线 + 主文字色，任何配色下都够亮。 */
.dsh-tp-card:focus-visible,.dsh-tp-seg button:focus-visible,.dsh-tp-mini:focus-visible,.dsh-tp-more:focus-visible,.dsh-tp-color:focus-visible,.dsh-tp-hexinput:focus-visible,.dsh-tp-matrix-scroll:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.dsh-tp-card.is-on{background:var(--dshtp-card-picked,var(--dsw-alias-bg-module-platform));border-color:var(--t-accent-l)}
body[data-ds-dark-theme] .dsh-tp-card.is-on{border-color:var(--t-accent-d)}
.dsh-tp-thumb{display:flex;height:56px;border-radius:9px;overflow:hidden;border:.5px solid rgba(128,128,128,.28)}
.dsh-tp-thumb-side{width:34%;background:var(--t-side-l)}
body[data-ds-dark-theme] .dsh-tp-thumb-side{background:var(--t-side-d)}
.dsh-tp-thumb-main{flex:1;background:var(--t-canvas-l);display:flex;flex-direction:column;gap:4px;padding:9px 10px}
body[data-ds-dark-theme] .dsh-tp-thumb-main{background:var(--t-canvas-d)}
.dsh-tp-thumb-main b{display:block;height:4px;border-radius:2px;background:var(--t-text-l);opacity:.75}
body[data-ds-dark-theme] .dsh-tp-thumb-main b{background:var(--t-text-d)}
.dsh-tp-thumb-main b:nth-of-type(2){width:70%;opacity:.42}
.dsh-tp-thumb-main b:nth-of-type(3){width:44%;background:var(--t-accent-l);opacity:.9}
body[data-ds-dark-theme] .dsh-tp-thumb-main b:nth-of-type(3){background:var(--t-accent-d)}
.dsh-tp-card-meta{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.dsh-tp-card-name{font-size:14px;font-weight:500}
.dsh-tp-card-desc{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-check{position:absolute;top:7px;right:7px;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;background:var(--t-accent-l);color:var(--t-canvas-l);opacity:0;transition:opacity .12s ease}
body[data-ds-dark-theme] .dsh-tp-check{background:var(--t-accent-d);color:var(--t-canvas-d)}
.dsh-tp-card.is-on .dsh-tp-check{opacity:1}
.dsh-tp-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.dsh-tp-row-label{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-tp-row-label b{font-size:13.5px;font-weight:500}
.dsh-tp-row-label span{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:16px}
.dsh-tp-seg{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);flex:none;max-width:100%}
.dsh-tp-seg button{font:inherit;font-size:12.5px;line-height:20px;cursor:pointer;border:0;border-radius:8px;padding:5px 12px;background:transparent;color:var(--dsw-alias-label-secondary);white-space:nowrap;transition:background .12s,color .12s}
.dsh-tp-seg button:hover{color:var(--dsw-alias-label-primary)}
.dsh-tp-seg button.is-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.10)}
.dsh-tp-seg button:focus-visible{outline-offset:2px}
.dsh-tp-seg button[disabled]{opacity:.45;cursor:default}
.dsh-tp-more{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-tertiary);background:0 0;border:0;padding:6px 0 2px;cursor:pointer;align-self:flex-start;transition:color .12s}
.dsh-tp-more:hover{color:var(--dsw-alias-label-primary)}
.dsh-tp-adv{display:flex;flex-direction:column}
.dsh-tp-input{flex:1 1 220px;min-width:0;font:12px/20px ui-monospace,Consolas,monospace;padding:5px 9px;border-radius:8px;border:1px solid var(--dshtp-border-control,var(--dsw-alias-border-l4));background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-tp-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-tp-mini{font:inherit;font-size:12.5px;line-height:20px;padding:5px 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-tp-mini:hover{background:var(--dsw-alias-bg-layer-1)}
.dsh-tp-custom{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:14px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1)}
.dsh-tp-custom-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-tp-custom-head b{font-size:13.5px;font-weight:500}
.dsh-tp-swatches{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,86px),1fr));gap:10px}
.dsh-tp-swatch{display:flex;flex-direction:column;gap:6px;cursor:pointer}
.dsh-tp-color{width:100%;height:44px;padding:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;background:transparent;cursor:pointer}
.dsh-tp-color::-webkit-color-swatch-wrapper{padding:3px}
.dsh-tp-color::-webkit-color-swatch{border:none;border-radius:8px}
.dsh-tp-swatch-name{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-tp-hex{font:11.5px/1 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-hexinput{width:100%;box-sizing:border-box;font:11.5px/16px ui-monospace,Consolas,monospace;padding:3px 6px;border-radius:6px;border:1px solid var(--dshtp-border-control,var(--dsw-alias-border-l4));background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-tp-hexinput:focus-visible{outline-offset:1px}
.dsh-tp-hexinput[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dsh-tp-hexerror{font-size:11.5px;line-height:16px;color:var(--dsw-alias-state-error-primary)}
.dsh-tp-hexnote{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-tp-custom-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-tp-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-status{margin:0;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-status.is-bad{color:var(--dsw-alias-state-error-primary)}
.dsh-tp-matrix{display:flex;flex-direction:column;gap:8px;padding:11px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsh-tp-matrix-head{display:flex;align-items:center;gap:8px}
.dsh-tp-matrix-title{font-size:13.5px;font-weight:500}
.dsh-tp-matrix-sub{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-matrix-scroll{overflow-x:auto;max-width:100%;padding-bottom:2px}
.dsh-tp-matrix-scroll:focus-visible{outline-offset:2px}
.dsh-tp-matrix table{border-collapse:collapse;width:max-content;min-width:100%;font-size:11.5px;line-height:16px;font-variant-numeric:tabular-nums}
.dsh-tp-matrix th,.dsh-tp-matrix td{padding:4px 6px;text-align:right;border-top:.5px solid var(--dsw-alias-border-l2);white-space:nowrap}
.dsh-tp-matrix th:first-child,.dsh-tp-matrix td:first-child{text-align:left}
.dsh-tp-matrix thead th{font-weight:500;color:var(--dsw-alias-label-tertiary);border-top:0}
.dsh-tp-matrix td.is-ok{color:var(--dsw-alias-label-secondary)}
.dsh-tp-matrix td.is-limited{color:var(--dsw-alias-label-tertiary)}
.dsh-tp-matrix td.is-exempt{color:var(--dsw-alias-label-tertiary)}
.dsh-tp-matrix td.is-na{color:var(--dsw-alias-label-tertiary);opacity:.55}
.dsh-tp-matrix td.is-bad{color:var(--dsw-alias-state-error-primary);font-weight:500}
.dsh-tp-matrix td .dsh-tp-matrix-mark{font-size:10px;margin-left:2px}
.dsh-tp-field{display:flex;flex-direction:column;gap:8px;padding:11px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsh-tp-field-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dsh-tp-field-title{font-size:13.5px;font-weight:500}
.dsh-tp-input{text-overflow:ellipsis}
/* 面板区域显式声明配色方案（审计 3.11）：原生横向滚动条、取色器、数字控件按它决定明暗，
 * 否则深色界面里「对比度表」的横向滚动条仍然是一条浅色的。 */
.dsh-tp{color-scheme:light}
body[data-ds-dark-theme] .dsh-tp{color-scheme:dark}
/* 强制配色模式（Windows 高对比 / forced-colors）：
 * 颜色本身会被系统接管，不用对抗；但「选中态」靠的是 box-shadow 与 opacity，
 * 这两样不会被接管 —— 于是卡片与分段控件在强制配色下会分不出选中的是哪一个。这里补一个显式描边。 */
@media (forced-colors:active){
  .dsh-tp-card,.dsh-tp-seg,.dsh-tp-custom,.dsh-tp-color,.dsh-tp-hexinput,.dsh-tp-input,.dsh-tp-mini{border:1px solid ButtonBorder}
  .dsh-tp-card.is-on,.dsh-tp-seg button.is-on{box-shadow:none;outline:2px solid Highlight;outline-offset:1px}
  .dsh-tp-check{forced-color-adjust:none;background:Highlight;color:HighlightText}
  .dsh-tp-status.is-bad,.dsh-tp-hexerror{color:LinkText}
}
@media (prefers-reduced-motion:reduce){.dsh-tp-card,.dsh-tp-seg button,.dsh-tp-more,.dsh-tp-check,.dsh-tp-mini{transition:none}}
`

    function installMarkdownStyle() {
      try {
        if (typeof document === 'undefined' || !document.head) return () => {}
        if (document.querySelector('style[data-plugin-css="' + MARKDOWN_STYLE_ID + '"]')) return () => {}
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-theme-palette'
        tag.dataset.pluginCss = MARKDOWN_STYLE_ID
        tag.textContent = MARKDOWN_CSS
        document.head.appendChild(tag)
        return () => { tag.remove() }
      } catch (err) {
        console.warn('[dsh-theme-palette] 右栏样式注入失败：', err)
        return () => {}
      }
    }

    function installSettingsStyle() {
      try {
        if (typeof document === 'undefined' || !document.head) return () => {}
        if (document.querySelector('style[data-plugin-css="' + SETTINGS_STYLE_ID + '"]')) return () => {}
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-theme-palette'
        tag.dataset.pluginCss = SETTINGS_STYLE_ID
        tag.textContent = SETTINGS_CSS
        document.head.appendChild(tag)
        return () => { tag.remove() }
      } catch (err) {
        console.warn('[dsh-theme-palette] 设置页样式注入失败：', err)
        return () => {}
      }
    }

    /* ================= 运行时自检 ================= */
    /**
     * 宿主若改了 token 名，插件会**静默失效**（overrideTokens 照收，样式不生效）。
     * 这里在应用后回读 body 上的计算值，确认关键 token 真的写进去了。
     */
    const TOKEN_PROBE = [
      '--dsw-static-neutral-bluish-00',
      '--dsw-static-neutral-bluish-600',
      '--dsw-static-neutral-bluish-1000',
      '--dsw-static-deepseek-500',
      '--dsw-alias-link',
      '--dsw-specific-sidebar-fill',
      '--dsw-alias-label-caption',
      // 审计 3.11：菜单底色是唯一被宿主用更高特异性规则声明过的 token
      // （html[data-platform=darwin] body{--dsw-specific-menu:…} 自带 #f8f9faf0 的冷灰）。
      // 覆盖层若在它面前失效，菜单会悄悄回到宿主的冷灰 —— 探一针就能发现。
      '--dsw-specific-menu',
      '--dsw-alias-label-tertiary',
    ]

    /** 只用于比对的颜色解析：支持 #rgb/#rrggbb/#rrggbbaa 与 rgb()/rgba()。 */
    function parseColor(value) {
      const s = String(value).trim().toLowerCase()
      if (s.charAt(0) === '#') {
        if (s.length === 4) return [parseInt(s[1], 16) * 17, parseInt(s[2], 16) * 17, parseInt(s[3], 16) * 17, 1]
        if (s.length === 7) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1]
        if (s.length === 9) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), parseInt(s.slice(7, 9), 16) / 255]
      }
      const m = s.match(/^rgba?\(([^)]+)\)$/)
      if (m) {
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => (x.charAt(x.length - 1) === '%' ? parseFloat(x) * 2.55 : parseFloat(x)))
        return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]
      }
      return null
    }

    function sameColor(actual, expected) {
      const a = parseColor(actual)
      const b = parseColor(expected)
      if (!a || !b) return String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase()
      return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1 && Math.abs(a[3] - b[3]) <= 0.02
    }

    /**
     * 不只验证「非空」：宿主原始 token 本来就有值，覆盖层丢失时非空检查会报假健康。
     * 这里比对计算值与本层期望值（var()/inherit 这类间接值跳过），并把不一致的 token 报出来。
     */
    function probeApplied(tokens) {
      try {
        if (typeof getComputedStyle !== 'function') return null
        const style = getComputedStyle(document.body)
        let checked = 0
        const mismatched = []
        for (const name of TOKEN_PROBE) {
          const pair = tokens[name]
          if (!pair) continue
          checked++
          const actual = style.getPropertyValue(name).trim()
          if (actual === '') { mismatched.push(name); continue }
          const expected = [pair.light, pair.dark].filter((v) => typeof v === 'string' && v.charAt(0) === '#')
          if (expected.length > 0 && !expected.some((v) => sameColor(actual, v))) mismatched.push(name)
        }
        return checked === 0 ? null : { ok: mismatched.length === 0, checked, mismatched }
      } catch (err) {
        return null
      }
    }

    /* ================= 持久化 ================= */
    function readStored() {
      try {
        const raw = localStorage.getItem(STORE_KEY)
        if (raw && SCHEMES.some((s) => s.id === raw)) return raw
      } catch (err) { /* 隐私模式 / 存储禁用：退回默认 */ }
      return 'mono'
    }

    /** 是否已经有用户配置：新装用户不需要看“行为变更”提示。 */
    function hasStoredConfig() {
      try { return localStorage.getItem(STORE_KEY) !== null } catch (err) { return false }
    }

    function writeStored(id) {
      try { localStorage.setItem(STORE_KEY, id) } catch (err) { /* 记不住不影响本次生效 */ }
    }

    function readSidebarStored() {
      try {
        const raw = localStorage.getItem(SIDEBAR_KEY)
        if (raw && SIDEBAR_MODES.some((m) => m.id === raw)) return raw
      } catch (err) { /* 退回默认 */ }
      return DEFAULT_SIDEBAR
    }

    function writeSidebarStored(id) {
      try { localStorage.setItem(SIDEBAR_KEY, id) } catch (err) { /* 同理 */ }
    }

    function readTextStored() {
      try {
        const raw = localStorage.getItem(TEXT_KEY)
        if (raw && TEXT_MODES.some((m) => m.id === raw)) return raw
      } catch (err) { /* 退回默认 */ }
      return DEFAULT_TEXT
    }

    function writeTextStored(id) {
      try { localStorage.setItem(TEXT_KEY, id) } catch (err) { /* 同理 */ }
    }



    function readScrollStored() {
      try {
        const raw = localStorage.getItem(SCROLL_KEY)
        if (raw && SCROLL_MODES.some((m) => m.id === raw)) return raw
      } catch (err) { /* 退回默认 */ }
      return DEFAULT_SCROLL
    }

    function writeScrollStored(id) {
      try { localStorage.setItem(SCROLL_KEY, id) } catch (err) { /* 同理 */ }
    }

    function readControlStored() {
      try {
        const raw = localStorage.getItem(CONTROL_KEY)
        if (raw && CONTROL_MODES.some((m) => m.id === raw)) return raw
      } catch (err) { /* 退回默认 */ }
      return DEFAULT_CONTROL
    }

    function writeControlStored(id) {
      try { localStorage.setItem(CONTROL_KEY, id) } catch (err) { /* 同理 */ }
    }

    function readMdStored() {
      try {
        const raw = localStorage.getItem(MD_KEY)
        if (raw && MD_MODES.some((m) => m.id === raw)) return raw
      } catch (err) { /* 退回默认 */ }
      return DEFAULT_MD
    }

    function writeMdStored(id) {
      try { localStorage.setItem(MD_KEY, id) } catch (err) { /* 同理 */ }
    }

    function readHcStored() {
      try {
        const raw = localStorage.getItem(HC_KEY)
        if (raw === 'on' || raw === 'off') return raw
      } catch (err) { /* 退回默认 */ }
      return DEFAULT_HC
    }

    function writeHcStored(id) {
      try { localStorage.setItem(HC_KEY, id) } catch (err) { /* 同理 */ }
    }

    function readNoticeSeen() {
      try {
        const raw = localStorage.getItem(NOTICE_KEY)
        return typeof raw === 'string' ? raw : ''
      } catch (err) { return '' }
    }

    function writeNoticeSeen(version) {
      try { localStorage.setItem(NOTICE_KEY, version) } catch (err) { /* 记不住就每次都提示，不阻断使用 */ }
    }

    /* ---------- 配置导入/导出（反哺 A-2 / A03）----------
     * 短码格式：`dshs1.` + base64url(JSON)，字段全部用单字母。
     * v1 早期短码没有 `x`（自定义三色），解码时兼容：旧码仍可导入，只是不带自定义色。
     */
    const CONFIG_PREFIX = 'dshs1.'

    function encodeConfig(state) {
      const custom = state.custom || readCustom()
      const raw = {
        v: 1, p: state.palette, s: state.sidebar, t: state.text,
        c: state.scroll, k: state.control, m: state.md, h: state.hc, l: state.lang,
        x: { bg: custom.bg, text: custom.text, accent: custom.accent },
      }
      try {
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(raw))))
        return CONFIG_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      } catch (err) { return '' }
    }

    const hasId = (list, id) => list.some((x) => x.id === id)

    function decodeConfig(code) {
      if (typeof code !== 'string') return null
      const text = code.trim()
      if (!text.startsWith(CONFIG_PREFIX)) return null
      try {
        let b64 = text.slice(CONFIG_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
        while (b64.length % 4 !== 0) b64 += '='
        const raw = JSON.parse(decodeURIComponent(escape(atob(b64))))
        if (!raw || raw.v !== 1) return null
        const next = {
          palette: SCHEMES.some((sc) => sc.id === raw.p) ? raw.p : null,
          sidebar: hasId(SIDEBAR_MODES, raw.s) ? raw.s : null,
          text: hasId(TEXT_MODES, raw.t) ? raw.t : null,
          scroll: hasId(SCROLL_MODES, raw.c) ? raw.c : null,
          control: hasId(CONTROL_MODES, raw.k) ? raw.k : null,
          md: hasId(MD_MODES, raw.m) ? raw.m : null,
          hc: hasId(HC_MODES, raw.h) ? raw.h : null,
          lang: raw.l === 'auto' || LOCALES.indexOf(raw.l) !== -1 ? raw.l : null,
        }
        // 三色要么全合法、要么整体忽略（旧码没有这一项）
        const x = raw.x
        const custom = x && CUSTOM_FIELDS.every((k) => typeof x[k] === 'string' && HEX_RE.test(x[k]))
          ? { bg: x.bg.toLowerCase(), text: x.text.toLowerCase(), accent: x.accent.toLowerCase() }
          : null
        return Object.values(next).every((v) => v !== null) ? Object.assign(next, { custom }) : null
      } catch (err) { return null }
    }

    /* ================= 文案 ================= */
    /* ================= 多语言 ================= */
    /**
     * 语言来源优先级：用户手选 > 宿主 documentElement.lang（locale 服务写的）> navigator.language。
     * 宿主本身只有 zh/en 两套，但插件设置页可以多给几种；「自动」永远跟随宿主。
     */
    const LOCALE_KEY = 'dsh-theme-palette.lang.v1'
    const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja']
    // 语言名用它自己的文字写（中/繁/EN/JA），只有「自动」需要按界面语言翻译。
    const LANG_OPTIONS = [
      { id: 'auto' },
      { id: 'zh-CN', label: '中' },
      { id: 'zh-TW', label: '繁' },
      { id: 'en', label: 'EN' },
      { id: 'ja', label: 'JA' },
    ]

    function readLangPref() {
      try {
        const raw = localStorage.getItem(LOCALE_KEY)
        if (raw === 'auto' || LOCALES.indexOf(raw) !== -1) return raw
      } catch (err) { /* 退回自动 */ }
      return 'auto'
    }

    function writeLangPref(id) {
      try { localStorage.setItem(LOCALE_KEY, id) } catch (err) { /* 忽略 */ }
    }

    function hostLocale() {
      try {
        const lang = (document.documentElement.lang || '').trim() || navigator.language || ''
        if (/^zh-(hant|tw|hk|mo)/i.test(lang)) return 'zh-TW'
        if (/^zh/i.test(lang)) return 'zh-CN'
        if (/^ja/i.test(lang)) return 'ja'
        if (/^en/i.test(lang)) return 'en'
        return null
      } catch (err) { return null }
    }

    function pickLocale(pref) {
      if (pref !== 'auto') return pref
      return hostLocale() || 'zh-CN'
    }

    const TEXT = {
      'zh-CN': {
        nav: '主题色',
        hint: '配色与明暗模式独立；切换后立即生效并保存在 localStorage。',
        md: 'Markdown 强调',
        control: '开关 / 勾选',
        scroll: '滚动条',
        scrollHintMono: '当前是黑白配色，没有色相可跟随，滚动条保持中性灰。',
        advanced: '更多选项',
        textSub: '正文与强调的着色程度',
        sidebarSub: '相对会话区的层次',
        mdSub: '标题与加粗是否着色',
        scrollSub: '滚动条与滑轨的色相',
        controlSub: '开关与复选框是否跟强调色',
        langSub: '自动跟随宿主界面语言',
        bad: '⚠ 部分 token 未生效（宿主可能改名），请查看控制台',
        healed: '配色层被宿主丢过一次，已自动恢复 ',
        healedSuffix: ' 次',
        text: '强度',
        sidebar: '左侧栏底色',
        lang: '语言',
        hc: '高对比',
        custom: '自定义配色',
        customHint: '取三个色的色相与色度；过亮/过暗的强调色会归一化以保证可读，明度由引擎按模式计算。',
        notice: '1.9.9 按独立审计逐条修订：深色文字下限单独提高（次级 8 / 三级 6.4）、文字着色三档对预置配色真正生效、色阶不再出现「编号越大反而越亮」、高对比档的边框与滚动条也真提高了；报表新增 APCA 列。',
        dismiss: '知道了',
        explainClamp: '强调色已归一化：{from} → {to}（保证按钮与勾选可读）',
        explainLink: '链接已为可读性压暗：{ratio}:1（目标 {target}:1）',
        preview: '预览',
        sample: '试试示例',
        copyDiag: '复制诊断',
        contrast: '对比度',
        contrastSub: '实测 / 目标（按承载面；※ 政策外不计硬门 · △ 物理不可达）',
        cMain: '正文',
        cSecondary: '次级',
        cTertiary: '三级',
        cLink: '链接',
        cLimited: '物理不可达',
        cExempt: '政策外',
        cUnmeasured: '未覆盖',
        cCeiling: '物理上限',
        cTarget: '目标',
        cLegend: '统计（达标 / 未达标 / 政策外）',
        cLimitedCount: '物理不可达（按物理上限判定，仍计入达标）',
        cFloor: 'AA 底线 4.5',
        cFloorViolations: '低于 AA 底线',
        matrixLabel: '对比度矩阵',
        matrixNa: '当前配色不覆盖承载面（黑白配色只改文字与强调色），矩阵不适用',
        applyFailed: '配置已保存，但主题没有应用成功',
        cancel: '取消',
        importSummary: '将覆盖：',
        config: '配置',
        configHint: '导出这台机器的配色选择（含自定义三色），或粘贴短码导入；导入会覆盖全部 9 项。',
        reset: '恢复默认',
        copy: '复制',
        applyImport: '导入',
        copied: '已复制',
        copyFail: '复制失败，请手选后 Ctrl+C',
        importOk: '已导入',
        importLegacy: '已导入（旧短码不含自定义三色）',
        importBad: '短码无效，已忽略',
        badHex: 'HEX 需为 #RRGGBB',
        hexStale: '这个值刚被别处改过，已保留最新值',
        hcSub: '尽量把文字下限抬到 AAA（正文 ≥15、次文 ≥9、三级 ≥7）；深色 800/850 不为正文兜底（政策外），但仍守 AA 底线。',
      },
      'zh-TW': {
        nav: '主題色',
        hint: '配色與明暗模式獨立；切換後立即生效並存在 localStorage。',
        md: 'Markdown 強調',
        control: '開關 / 勾選',
        scroll: '捲軸',
        scrollHintMono: '目前是黑白配色，沒有色相可跟隨，捲軸保持中性灰。',
        advanced: '更多選項',
        textSub: '本文與強調的著色程度',
        sidebarSub: '相對會話區的層次',
        mdSub: '標題與粗體是否著色',
        scrollSub: '捲軸與軌道的色相',
        controlSub: '開關與核取方塊是否跟強調色',
        langSub: '自動跟隨宿主介面語言',
        bad: '⚠ 部分 token 未生效（宿主可能改名），請看主控台',
        healed: '配色層被宿主丟棄過一次，已自動恢復 ',
        healedSuffix: ' 次',
        text: '強度',
        sidebar: '左側欄底色',
        lang: '語言',
        hc: '高對比',
        custom: '自訂配色',
        customHint: '取三個色的色相與色度；過亮/過暗的強調色會正規化以確保可讀性，明度由引擎依模式計算。',
        notice: '1.9.9 依獨立稽核逐條修訂：深色文字下限另行提高（次要 8 / 三級 6.4）、文字著色三檔對預設配色真正生效、色階不再出現「編號越大反而越亮」、高對比檔的邊框與捲軸也真提高了；報表新增 APCA 欄。',
        dismiss: '知道了',
        explainClamp: '強調色已正規化：{from} → {to}（確保按鈕與勾選可讀）',
        explainLink: '連結已為可讀性壓暗：{ratio}:1（目標 {target}:1）',
        preview: '預覽',
        sample: '試試示例',
        copyDiag: '複製診斷',
        contrast: '對比度',
        contrastSub: '實測 / 目標（依承載面；※ 政策外不計硬門 · △ 物理不可達）',
        cMain: '正文',
        cSecondary: '次級',
        cTertiary: '三級',
        cLink: '連結',
        cLimited: '物理不可達',
        cExempt: '政策外',
        cUnmeasured: '未覆蓋',
        cCeiling: '物理上限',
        cTarget: '目標',
        cLegend: '統計（達標 / 未達標 / 政策外）',
        cLimitedCount: '物理不可達（按物理上限判定，仍計入達標）',
        cFloor: 'AA 底線 4.5',
        cFloorViolations: '低於 AA 底線',
        matrixLabel: '對比度矩陣',
        matrixNa: '目前配色不覆蓋承載面（黑白配色只改文字與強調色），矩陣不適用',
        applyFailed: '設定已儲存，但主題沒有套用成功',
        cancel: '取消',
        importSummary: '將覆蓋：',
        config: '設定',
        configHint: '匯出這台機器的配色選擇（含自訂三色），或貼上短碼匯入；匯入會覆蓋全部 9 項。',
        reset: '恢復預設',
        copy: '複製',
        applyImport: '匯入',
        copied: '已複製',
        copyFail: '複製失敗，請手選後 Ctrl+C',
        importOk: '已匯入',
        importLegacy: '已匯入（舊短碼不含自訂三色）',
        importBad: '短碼無效，已忽略',
        badHex: 'HEX 需為 #RRGGBB',
        hexStale: '這個值剛被別處改過，已保留最新值',
        hcSub: '盡量把文字下限抬到 AAA（正文 ≥15、次文 ≥9、三級 ≥7）；深色 800/850 不為正文兜底（政策外），但仍守 AA 底線。',
      },
      en: {
        nav: 'Color theme',
        hint: 'Independent of light/dark mode. Applies immediately and is saved to localStorage.',
        md: 'Markdown emphasis',
        control: 'Switches / checks',
        scroll: 'Scrollbars',
        scrollHintMono: 'Monochrome has no hue to follow; scrollbars stay neutral.',
        advanced: 'More options',
        textSub: 'How strongly text follows the palette',
        sidebarSub: 'Layer relative to the conversation',
        mdSub: 'Tint headings and bold',
        scrollSub: 'Hue of the scrollbar',
        controlSub: 'Switches and checkboxes',
        langSub: 'Follow the host interface language',
        bad: '⚠ Some tokens did not apply (host may have renamed them); check the console',
        healed: 'Palette layer was dropped by the host; restored ',
        healedSuffix: 'x',
        text: 'Strength',
        sidebar: 'Sidebar surface',
        lang: 'Language',
        hc: 'High contrast',
        custom: 'Custom palette',
        customHint: 'Takes hue and chroma from three colours; extreme accents are normalised for readability; lightness comes from the engine per mode.',
        notice: '1.9.9 fixes the issues from an independent audit: dark text gets its own higher floors (secondary 8 / tertiary 6.4), the text-tint tiers now really work on presets, ramps no longer go "higher step, lighter colour", and high-contrast borders and scrollbars are genuinely raised; the report gains an APCA column.',
        dismiss: 'Got it',
        explainClamp: 'Accent normalised: {from} → {to} (keeps buttons and checks readable)',
        explainLink: 'Link darkened for readability: {ratio}:1 (target {target}:1)',
        preview: 'Preview',
        sample: 'Try a sample',
        copyDiag: 'Copy diagnostics',
        contrast: 'Contrast',
        contrastSub: 'measured / target per surface (※ out of policy, not gated · △ physically unreachable)',
        cMain: 'Body',
        cSecondary: 'Secondary',
        cTertiary: 'Tertiary',
        cLink: 'Link',
        cLimited: 'physically unreachable',
        cExempt: 'out of policy',
        cUnmeasured: 'not overridden',
        cCeiling: 'physical ceiling',
        cTarget: 'target',
        cLegend: 'counts (pass / fail / out of policy)',
        cLimitedCount: 'physically unreachable (judged by the physical ceiling; still counted as a pass)',
        cFloor: 'AA floor 4.5',
        cFloorViolations: 'below the AA floor',
        matrixLabel: 'Contrast matrix',
        matrixNa: 'This palette does not override the surfaces (mono changes only text and accents), so the matrix does not apply',
        applyFailed: 'Settings were saved, but the theme could not be applied',
        cancel: 'Cancel',
        importSummary: 'Will overwrite:',
        config: 'Config',
        configHint: 'Export this machine’s choices (including the three custom colours), or paste a short code to import. Import overwrites all 9 settings.',
        reset: 'Reset',
        copy: 'Copy',
        applyImport: 'Import',
        copied: 'Copied',
        copyFail: 'Copy failed — select the code and press Ctrl+C',
        importOk: 'Imported',
        importLegacy: 'Imported (old code has no custom colours)',
        importBad: 'Invalid code, ignored',
        badHex: 'HEX must be #RRGGBB',
        hexStale: 'This value was changed elsewhere; the latest value was kept',
        hcSub: 'Raises text floors toward AAA (body ≥15, secondary ≥9, tertiary ≥7); dark 800/850 no longer back the body text (out of policy) but still hold the AA floor.',
      },
      ja: {
        nav: 'カラーテーマ',
        hint: 'ライト/ダークとは独立です。変更は即時反映され、localStorage に保存されます。',
        md: 'Markdown の強調',
        control: 'スイッチ / チェック',
        scroll: 'スクロールバー',
        scrollHintMono: 'モノクロには色相がないため、スクロールバーはグレーのままです。',
        advanced: 'その他のオプション',
        textSub: '本文と強調の色づき具合',
        sidebarSub: '会話エリアとの段差',
        mdSub: '見出しと太字を色づけする',
        scrollSub: 'スクロールバーの色相',
        controlSub: 'スイッチとチェックの色',
        langSub: 'ホストの表示言語に合わせます',
        bad: '⚠ 一部の token が適用されていません（ホスト側で改名された可能性）。コンソールを確認してください',
        healed: '配色レイヤーがホストに破棄されたため、自動で復元しました（',
        healedSuffix: ' 回）',
        text: '強さ',
        sidebar: '左サイドバーの背景',
        lang: '言語',
        hc: 'ハイコントラスト',
        custom: 'カスタム配色',
        customHint: '3 色の色相と彩度を使用。極端なアクセント色は可読性のため正規化され、明度はモードごとにエンジンが決めます。',
        notice: '1.9.9 は独立監査の指摘を順に修正しました：ダークの文字下限を個別に引き上げ（二次 8 / 三次 6.4）、テキストの色味 3 段階がプリセットでも実際に効くようになり、色階が「番号が大きいほど明るい」現象も解消、ハイコントラストの枠線とスクロールバーも実際に強まりました。レポートに APCA 列を追加。',
        dismiss: '了解',
        explainClamp: 'アクセント色を正規化しました：{from} → {to}（ボタンとチェックの可読性のため）',
        explainLink: 'リンクを可読性のため暗くしました：{ratio}:1（目標 {target}:1）',
        preview: 'プレビュー',
        sample: 'サンプルを試す',
        copyDiag: '診断をコピー',
        contrast: 'コントラスト',
        contrastSub: '実測 / 目標（面ごと；※ 対象外・△ 物理的に到達不可）',
        cMain: '本文',
        cSecondary: '副次',
        cTertiary: '三次',
        cLink: 'リンク',
        cLimited: '物理的に到達不可',
        cExempt: '対象外',
        cUnmeasured: '未上書き',
        cCeiling: '物理上限',
        cTarget: '目標',
        cLegend: '内訳（合格 / 不合格 / 対象外）',
        cLimitedCount: '物理不可達（物理上限で判定、合格に計上）',
        cFloor: 'AA 下限 4.5',
        cFloorViolations: 'AA 下限未満',
        matrixLabel: 'コントラスト表',
        matrixNa: 'この配色は面を上書きしません（白黒は文字とアクセントのみ）。表は適用外です',
        applyFailed: '設定は保存されましたが、テーマを適用できませんでした',
        cancel: 'キャンセル',
        importSummary: '上書きする内容：',
        config: '設定の共有',
        configHint: 'この端末の配色設定（カスタム 3 色を含む）を書き出す／短いコードを貼り付けて読み込みます（9 項目すべて上書き）。',
        reset: 'リセット',
        copy: 'コピー',
        applyImport: '読み込み',
        copied: 'コピーしました',
        copyFail: 'コピーできません。選択して Ctrl+C してください',
        importOk: '読み込みました',
        importLegacy: '読み込みました（旧コードにカスタム 3 色は含まれません）',
        importBad: '無効なコードです',
        badHex: 'HEX は #RRGGBB 形式で入力してください',
        hexStale: 'この値は別の場所で変更されました。最新の値を保持しています',
        hcSub: '本文の下限を AAA に近づけます（本文 ≥15、副次 ≥9、三次 ≥7）。暗い 800/850 は本文を受け皿にしません（対象外）ですが、AA 下限は守ります。',
      },
    }

    /** 配色名与各档位的显示名：id 不变，只换文案。 */
    const LABELS = {
      'zh-CN': {
        scheme: { mono: '黑白', warm: '暖砂', indigo: '靛蓝', moss: '苔绿', custom: '自定义' },
        desc: { mono: '无色调 · 默认', warm: '米白 + 棕调', indigo: '冷白 + 蓝调', moss: '浅灰绿 + 绿调', custom: '三色派生 · 你的配色' },
        text: { neutral: '静', tinted: '标准', deep: '浓' },
        sidebar: { light: '更浅', match: '同色', deep: '更深' },
        scroll: { neutral: '中性', tinted: '跟随', accent: '强调' },
        control: { accent: '主题色', mono: '黑白' },
        md: { on: '着色', off: '同正文' },
        lang: { auto: '自动' },
        hc: { off: '关', on: '开' },
        custom: { bg: '底色', text: '文字', accent: '强调' },
      },
      'zh-TW': {
        scheme: { mono: '黑白', warm: '暖砂', indigo: '靛藍', moss: '苔綠', custom: '自訂' },
        desc: { mono: '無色調 · 預設', warm: '米白 + 棕調', indigo: '冷白 + 藍調', moss: '淺灰綠 + 綠調', custom: '三色派生 · 你的配色' },
        text: { neutral: '靜', tinted: '標準', deep: '濃' },
        sidebar: { light: '更淺', match: '同色', deep: '更深' },
        scroll: { neutral: '中性', tinted: '跟隨', accent: '強調' },
        control: { accent: '主題色', mono: '黑白' },
        md: { on: '著色', off: '同本文' },
        lang: { auto: '自動' },
        hc: { off: '關', on: '開' },
        custom: { bg: '底色', text: '文字', accent: '強調' },
      },
      en: {
        scheme: { mono: 'Mono', warm: 'Warm sand', indigo: 'Indigo', moss: 'Moss', custom: 'Custom' },
        desc: { mono: 'Neutral · default', warm: 'Cream + brown', indigo: 'Cool white + blue', moss: 'Grey-green', custom: 'Derived from your three colours' },
        text: { neutral: 'Quiet', tinted: 'Standard', deep: 'Strong' },
        sidebar: { light: 'Lighter', match: 'Same', deep: 'Deeper' },
        scroll: { neutral: 'Neutral', tinted: 'Tint', accent: 'Accent' },
        control: { accent: 'Accent', mono: 'Mono' },
        md: { on: 'Tinted', off: 'Body colour' },
        lang: { auto: 'Auto' },
        hc: { off: 'Off', on: 'On' },
        custom: { bg: 'Surface', text: 'Text', accent: 'Accent' },
      },
      ja: {
        scheme: { mono: 'モノクロ', warm: 'ウォームサンド', indigo: 'インディゴ', moss: 'モスグリーン', custom: 'カスタム' },
        desc: { mono: '色なし · 既定', warm: 'クリーム + ブラウン', indigo: 'クールホワイト + ブルー', moss: 'グレーグリーン', custom: '3 色から派生' },
        text: { neutral: '控えめ', tinted: '標準', deep: '強め' },
        sidebar: { light: '明るく', match: '同じ', deep: '暗く' },
        scroll: { neutral: '無彩', tinted: '追従', accent: '強調' },
        control: { accent: 'アクセント', mono: 'モノクロ' },
        md: { on: '色づけ', off: '本文と同じ' },
        lang: { auto: '自動' },
        hc: { off: 'オフ', on: 'オン' },
        custom: { bg: '背景', text: '本文', accent: 'アクセント' },
      },
    }

    /* ================= 设置页（左侧导航独立一节） ================= */
    /** 文案插值：只替换 {name}，缺值留空，不做 HTML 解释。 */
    function fmt(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (m, key) => (vars[key] === undefined ? '' : String(vars[key])))
    }

    function PaletteSection(props) {
      const current = React.useSyncExternalStore(props.subscribe, props.getCurrent)
      const sidebarMode = React.useSyncExternalStore(props.subscribeSidebar, props.getSidebarMode)
      const textMode = React.useSyncExternalStore(props.subscribeText, props.getTextMode)
      const scrollMode = React.useSyncExternalStore(props.subscribeScroll, props.getScrollMode)
      const controlMode = React.useSyncExternalStore(props.subscribeControl, props.getControlMode)
      const mdMode = React.useSyncExternalStore(props.subscribeMd, props.getMdMode)
      const hcMode = React.useSyncExternalStore(props.subscribeHc, props.getHcMode)
      const health = React.useSyncExternalStore(props.subscribeHealth, props.getHealth)
      const [importText, setImportText] = React.useState('')
      const [importState, setImportState] = React.useState(null)
      const [importPreview, setImportPreview] = React.useState(null)
      const [copyState, setCopyState] = React.useState(null)
      const [advanced, setAdvanced] = React.useState(false)
      const [matrixOpen, setMatrixOpen] = React.useState(false)
      const [diagState, setDiagState] = React.useState(null)
      // 升级提示按版本只出现一次
      const noticePending = React.useSyncExternalStore(props.subscribeNotice, props.getNoticePending)
      // HEX 输入需要「草稿」态：非法值不能写进主题，但用户还在输入时也不该被立刻回滚。
      const [hexDraft, setHexDraft] = React.useState({})
      const [hexError, setHexError] = React.useState({})
      // 草稿起点（当时看到的外部值）与「草稿已过期」提示：外部改动（导入短码、取色器、
      // 恢复默认）发生在草稿之后时，失焦提交会拿旧草稿盖掉新值 —— 过期就丢弃草稿。
      const [hexBase, setHexBase] = React.useState({})
      const [hexStale, setHexStale] = React.useState({})
      // 自定义色有自己的不可变快照与订阅；只订阅 current 不会因三色变化而重渲染。
      const customColors = React.useSyncExternalStore(props.subscribeCustom, props.getCustomColors)
      const locale = React.useSyncExternalStore(props.subscribeLocale, props.getLocale)
      const langPref = React.useSyncExternalStore(props.subscribeLocale, props.getLangPref)
      const langAttr = langPref !== 'auto'
        ? langPref
        : ((typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'zh-CN')
      const txt = TEXT[locale] || TEXT['zh-CN']
      const lb = LABELS[locale] || LABELS['zh-CN']
      // 只在自定义面板显示；解释是只读的，不改变任何设置。取色异常不应拖垮设置页。
      let explain = null
      if (current === 'custom') {
        try { explain = props.getCustomExplain() } catch (err) { explain = null }
      }

      // A07：radiogroup 的键盘模型 —— 组只占一个 Tab 位，方向键循环切换，Home/End 到首尾。
      const onSegKeyDown = (event, modes, value, onPick, disabled) => {
        if (disabled) return
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].indexOf(event.key) === -1) return
        event.preventDefault()
        const currentIndex = Math.max(0, modes.findIndex((m) => m.id === value))
        let nextIndex = currentIndex
        if (event.key === 'Home') nextIndex = 0
        else if (event.key === 'End') nextIndex = modes.length - 1
        else {
          const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
          nextIndex = (currentIndex + delta + modes.length) % modes.length
        }
        if (nextIndex === currentIndex) return
        onPick(modes[nextIndex].id)
        const buttons = event.currentTarget.children
        const target = buttons && buttons[nextIndex]
        if (target && typeof target.focus === 'function') target.focus()
      }

      // A6：读屏需要知道"这是哪个设置的选项组"；单选用 radio 语义更准
      const seg = (modes, value, onPick, labels, labelId, disabled) => h(
        'div',
        {
          className: 'dsh-tp-seg',
          role: 'radiogroup',
          'aria-labelledby': labelId,
          'aria-disabled': disabled ? 'true' : undefined,
          onKeyDown: (event) => onSegKeyDown(event, modes, value, onPick, disabled),
        },
        modes.map((mode) => h(
          'button',
          {
            key: mode.id,
            type: 'button',
            role: 'radio',
            className: mode.id === value ? 'is-on' : undefined,
            'aria-checked': mode.id === value,
            'aria-disabled': disabled ? 'true' : undefined,
            // roving tabindex：只有选中项在 Tab 序列里，其余靠方向键进入
            tabIndex: mode.id === value ? 0 : -1,
            disabled: disabled === true,
            onClick: () => { if (!disabled) onPick(mode.id) },
          },
          (labels && labels[mode.id]) || mode.label,
        )),
      )

      const rowId = (key) => 'dsh-tp-row-' + key
      const row = (key, titleText, subText, control) => h(
        'div',
        { className: 'dsh-tp-row' },
        h('div', { className: 'dsh-tp-row-label', id: rowId(key) + '-desc' },
          h('b', { id: rowId(key) }, titleText), h('span', null, subText)),
        control,
      )

      // A06：HEX 以「草稿 + 提交」处理；非法值不写主题，也不假装保存成功。
      // 1.9.8：草稿还要记住「它是从哪个外部值开始的」。外部改动（导入短码、取色器、
      // 恢复默认）发生在草稿之后时，失焦提交会拿旧草稿盖掉新值 —— 发现基底变了就丢弃草稿。
      const commitHex = (field) => {
        const draft = hexDraft[field]
        const base = hexBase[field]
        const currentValue = customColors[field]
        if (draft !== undefined && base !== undefined
          && String(base).toLowerCase() !== String(currentValue).toLowerCase()) {
          setHexDraft(Object.assign({}, hexDraft, { [field]: undefined }))
          setHexError(Object.assign({}, hexError, { [field]: false }))
          setHexStale(Object.assign({}, hexStale, { [field]: true }))
          return
        }
        const raw = String(draft !== undefined ? draft : currentValue).trim()
        if (HEX_RE.test(raw)) {
          props.setCustomColor(field, raw)
          setHexDraft(Object.assign({}, hexDraft, { [field]: undefined }))
          setHexError(Object.assign({}, hexError, { [field]: false }))
          setHexStale(Object.assign({}, hexStale, { [field]: false }))
        } else {
          setHexError(Object.assign({}, hexError, { [field]: true }))
        }
      }
      const customPanel = current === 'custom' && h(
        'div',
        { className: 'dsh-tp-custom' },
        h('div', { className: 'dsh-tp-custom-head' },
          h('b', null, txt.custom),
          h('button', {
            type: 'button',
            className: 'dsh-tp-mini',
            onClick: () => props.resetCustom(),
          }, txt.reset)),
        h('div', { className: 'dsh-tp-swatches' },
          ['bg', 'text', 'accent'].map((field) => {
            const name = (lb.custom && lb.custom[field]) || field
            const colorId = rowId('color-' + field)
            const hexId = rowId('hex-' + field)
            const errId = rowId('hexerr-' + field)
            const staleId = rowId('hexstale-' + field)
            const invalid = hexError[field] === true
            const stale = hexStale[field] === true
            return h('div', {
              key: field,
              className: 'dsh-tp-swatch',
              role: 'group',
              'aria-label': name,
            },
            h('input', {
              type: 'color',
              id: colorId,
              className: 'dsh-tp-color',
              value: customColors[field],
              // input 是"拖动过程中"就触发，change 是"确认后"触发；两个都接，
              // 拖动时实时看到整页变化，松手/确认后不会再跳一次
              onInput: (e) => props.setCustomColor(field, e.target.value),
              onChange: (e) => props.setCustomColor(field, e.target.value),
              'aria-label': name,
            }),
            h('label', { htmlFor: hexId, className: 'dsh-tp-swatch-name' }, name),
            h('input', {
              id: hexId,
              className: 'dsh-tp-hexinput',
              value: hexDraft[field] !== undefined ? hexDraft[field] : customColors[field],
              spellCheck: false,
              'aria-invalid': invalid ? 'true' : undefined,
              'aria-describedby': invalid ? errId : (stale ? staleId : undefined),
              'aria-label': name + ' HEX',
              onChange: (e) => {
                // 第一次输入时记下草稿起点：之后若外部值变了，就知道这个草稿已经过期。
                if (hexDraft[field] === undefined) {
                  setHexBase(Object.assign({}, hexBase, { [field]: customColors[field] }))
                }
                setHexDraft(Object.assign({}, hexDraft, { [field]: e.target.value }))
                if (invalid) setHexError(Object.assign({}, hexError, { [field]: false }))
                if (stale) setHexStale(Object.assign({}, hexStale, { [field]: false }))
              },
              onBlur: () => commitHex(field),
              onKeyDown: (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitHex(field) }
                if (e.key === 'Escape') {
                  setHexDraft(Object.assign({}, hexDraft, { [field]: undefined }))
                  setHexError(Object.assign({}, hexError, { [field]: false }))
                  setHexStale(Object.assign({}, hexStale, { [field]: false }))
                  setHexBase(Object.assign({}, hexBase, { [field]: undefined }))
                  e.currentTarget.blur()
                }
              },
            }),
            invalid && h('span', { id: errId, className: 'dsh-tp-hexerror', role: 'alert' }, txt.badHex),
            stale && h('span', { id: staleId, className: 'dsh-tp-hexnote', role: 'status' }, txt.hexStale))
          })),
        h('p', { className: 'dsh-tp-custom-hint' }, txt.customHint),
        explain && (explain.accentClamped || explain.linkShifted) && h(
          'div',
          { className: 'dsh-tp-explain', role: 'status' },
          explain.accentClamped && h('span', null,
            fmt(txt.explainClamp, { from: explain.accentFrom, to: explain.accentTo })),
          explain.linkShifted && h('span', null,
            fmt(txt.explainLink, { ratio: explain.linkRatio.toFixed(2), target: explain.linkTarget })),
        ),
      )

      // R1：对比度矩阵。默认折叠，与「更多选项」同节奏；展开后按前景 × 承载面给实测读数。
      const roleLabel = { main: txt.cMain, secondary: txt.cSecondary, tertiary: txt.cTertiary, link: txt.cLink }
      const matrix = h(
        'div',
        { className: 'dsh-tp-matrix' },
        h('button', {
          type: 'button',
          className: 'dsh-tp-more',
          'aria-expanded': matrixOpen,
          'aria-controls': 'dsh-tp-matrix-body',
          onClick: () => setMatrixOpen(!matrixOpen),
        }, (matrixOpen ? '▾ ' : '▸ ') + txt.contrast),
        h('span', { className: 'dsh-tp-matrix-sub' }, txt.contrastSub),
        h('div', { className: 'dsh-tp-field-row' },
          h('button', {
            type: 'button',
            className: 'dsh-tp-mini',
            onClick: async () => {
              try {
                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('no clipboard')
                await navigator.clipboard.writeText(JSON.stringify(props.getDiagnostics(), null, 2))
                setDiagState('copied')
              } catch (err) { setDiagState('fail') }
            },
          }, txt.copyDiag),
          diagState && h('span', { className: 'dsh-tp-note', role: 'status', 'aria-live': 'polite' },
            diagState === 'copied' ? txt.copied : txt.copyFail)),
        matrixOpen && (() => {
          const report = props.getContrastReport()
          const summary = report.summary
          if (!report.applicable) {
            return h('p', { id: 'dsh-tp-matrix-body', className: 'dsh-tp-matrix-sub' }, txt.matrixNa)
          }
          return h(
            'div',
            {
              // 窄栏 / 移动端 / 200% 缩放时矩阵会横向溢出：给它一个有名、可聚焦的滚动区，
              // 键盘用户才能滚动到右侧的承载面。
              className: 'dsh-tp-matrix-scroll',
              role: 'region',
              'aria-label': txt.matrixLabel,
              tabIndex: 0,
            },
            h(
              'table',
              { id: 'dsh-tp-matrix-body' },
              h('thead', null, h('tr', null,
                h('th', { scope: 'col' }, ''),
                CONTRAST_SURFACES.map((sf) => h('th', { key: sf.id, scope: 'col' }, (sf.label || sf.id) + (sf.scope === false ? '※' : ''))))),
              h('tbody', null, report.rows.map((row) => h('tr', { key: row.role },
                h('th', { scope: 'row' }, roleLabel[row.role] || row.role),
                row.cells.map((cell) => {
                  if (cell.unmeasured) {
                    return h('td', {
                      key: cell.mode + cell.surface,
                      className: 'is-na',
                      'data-role': row.role,
                      'data-surface': cell.surface,
                      'data-mode': cell.mode,
                      title: txt.cUnmeasured,
                    }, '—')
                  }
                  // 政策外（※）：单列统计 —— 既不计入达标，也不算失败
                  const exempt = !cell.policyApplicable
                  const cls = exempt ? 'is-exempt' : (cell.pass ? (cell.limitedByPhysics ? 'is-limited' : 'is-ok') : 'is-bad')
                  const mark = exempt ? ' ※' : (cell.limitedByPhysics ? ' △' : '')
                  // 政策外不写「≤ 目标」：那一栏的承诺不适用于它，写了反而像"没达标"
                  const text = cell.limitedByPhysics && !exempt
                    ? cell.measured.toFixed(2) + ' ≤ ' + cell.declaredTarget
                    : cell.measured.toFixed(2)
                  // APCA 只作参考：1.9.9 起每格附带 Lc，但门仍然只有 WCAG 底线与深色 Lc 底线。
                  const lcText = cell.apca === null || cell.apca === undefined
                    ? ''
                    : ' · APCA Lc ' + Math.abs(cell.apca).toFixed(0)
                  const title = exempt
                    ? txt.cExempt + ' · ' + txt.contrast + ' ' + cell.measured.toFixed(2)
                      + ' · ' + txt.cFloor + (cell.meetsFloor ? ' ✓' : ' ✗') + lcText
                    : (cell.limitedByPhysics
                      ? txt.cLimited + ' · ' + txt.cCeiling + ' ' + cell.physicalCeiling.toFixed(2)
                        + ' · ' + txt.cTarget + ' ' + cell.declaredTarget + lcText
                      : txt.contrast + ' ' + text + ' · ' + txt.cTarget + ' ' + cell.declaredTarget + lcText)
                  return h('td', {
                    key: cell.mode + cell.surface,
                    className: cls,
                    'data-role': row.role,
                    'data-surface': cell.surface,
                    'data-mode': cell.mode,
                    title,
                  }, text + mark)
                }))))
            ),
            h('p', { className: 'dsh-tp-matrix-sub' },
              txt.cLegend + '：' + summary.passed + ' · ' + summary.failed + ' · ' + summary.exempt
              + (summary.physicallyLimited > 0 ? ' · ' + txt.cLimitedCount + ' ' + summary.physicallyLimited : '')
              + (summary.floorViolations > 0 ? ' · ' + txt.cFloorViolations + ' ' + summary.floorViolations : '')),
          )
        })(),
      )

      const card = (scheme) => {
        const picked = scheme.id === current
        const c = cardColors(scheme, textMode, sidebarMode)
        return h(
          'button',
          {
            key: scheme.id,
            type: 'button',
            className: 'dsh-tp-card' + (picked ? ' is-on' : ''),
            'aria-pressed': picked,
            onClick: () => props.setPalette(scheme.id),
            style: {
              '--t-canvas-l': c.light.canvas, '--t-canvas-d': c.dark.canvas,
              '--t-side-l': c.light.side, '--t-side-d': c.dark.side,
              '--t-text-l': c.light.text, '--t-text-d': c.dark.text,
              '--t-accent-l': c.light.accent, '--t-accent-d': c.dark.accent,
            },
          },
          h('span', { className: 'dsh-tp-thumb' },
            h('span', { className: 'dsh-tp-thumb-side' }),
            h('span', { className: 'dsh-tp-thumb-main' }, h('b', null), h('b', null), h('b', null))),
          h('span', { className: 'dsh-tp-card-meta' },
            h('span', { className: 'dsh-tp-card-name' }, lb.scheme[scheme.id] || scheme.label),
            h('span', { className: 'dsh-tp-card-desc' }, lb.desc[scheme.id] || scheme.desc)),
          h('span', { className: 'dsh-tp-check', 'aria-hidden': 'true' }, '✓'),
        )
      }

      return h(
        'section',
        { className: 'dsh-tp', lang: langAttr },
        h('div', { className: 'dsh-tp-head' },
          h('h2', null, txt.nav),
          h('span', { className: 'dsh-tp-badge' }, 'v' + PLUGIN_VERSION)),
        h('p', { className: 'dsh-tp-sub' }, txt.hint),
        noticePending && h('div', { className: 'dsh-tp-notice' },
          h('p', { role: 'status' }, txt.notice),
          h('button', { type: 'button', className: 'dsh-tp-mini', onClick: () => props.dismissNotice() }, txt.dismiss)),
        h('div', { className: 'dsh-tp-grid' }, SCHEMES.map(card)),
        customPanel,
        row('text', txt.text, txt.textSub, seg(TEXT_MODES, textMode, props.setTextMode, lb.text, rowId('text'))),
        row('hc', txt.hc, txt.hcSub, seg(HC_MODES, hcMode, props.setHcMode, lb.hc, rowId('hc'))),
        row('sidebar', txt.sidebar, txt.sidebarSub, seg(SIDEBAR_MODES, sidebarMode, props.setSidebarMode, lb.sidebar, rowId('sidebar'))),
        // 右栏底色这一档 1.9.10 撤除：宿主右栏面板是整高透明覆盖层，染色要么看不见、要么盖住主栏
        // 并把切换按钮压在下面（用户实测）。详见 docs/DESIGN.md「右侧栏为什么不再染色」。
        health && !health.ok && h('p', { className: 'dsh-tp-status is-bad' }, txt.bad),
        health && health.applied === false && h(
          'p',
          { className: 'dsh-tp-status is-bad', role: 'status' },
          txt.applyFailed + (health.applyError ? '：' + health.applyError : ''),
        ),
        health && health.ok && health.applied !== false && health.reapplies > 0 && h(
          'p',
          { className: 'dsh-tp-status' },
          txt.healed + health.reapplies + txt.healedSuffix,
        ),
        matrix,
        h('button', {
          type: 'button',
          className: 'dsh-tp-more',
          'aria-expanded': advanced,
          onClick: () => setAdvanced(!advanced),
        }, (advanced ? '▾ ' : '▸ ') + txt.advanced),
        advanced && h(
          'div',
          { className: 'dsh-tp-adv' },
          row('lang', txt.lang, txt.langSub, seg(LANG_OPTIONS, langPref, props.setLangPref, lb.lang, rowId('lang'))),
          h(
            'div',
            { className: 'dsh-tp-field' },
            h('div', { className: 'dsh-tp-field-title', id: rowId('config') }, txt.config),
            h('div', { className: 'dsh-tp-field-row' },
              h('input', {
                className: 'dsh-tp-input',
                readOnly: true,
                value: props.getConfigCode(),
                title: props.getConfigCode(),
                onFocus: (e) => { try { e.target.select() } catch (err) { /* 忽略 */ } },
                'aria-label': txt.config + ' — ' + txt.copy,
              }),
              h('button', {
                type: 'button',
                className: 'dsh-tp-mini',
                onClick: async () => {
                  const code = props.getConfigCode()
                  try {
                    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('no clipboard api')
                    await navigator.clipboard.writeText(code)
                    setCopyState('copied')
                  } catch (err) {
                    // 剪贴板可能被拒（无安全上下文/权限）；不能谎报成功
                    setCopyState('fail')
                  }
                },
              }, txt.copy),
              copyState && h('span', { className: 'dsh-tp-note', role: 'status', 'aria-live': 'polite' },
                copyState === 'copied' ? txt.copied : txt.copyFail)),
            h('div', { className: 'dsh-tp-field-row' },
              h('input', {
                className: 'dsh-tp-input',
                placeholder: 'dshs1.…',
                value: importText,
                'aria-label': txt.applyImport,
                onChange: (e) => {
                  setImportText(e.target.value)
                  setImportState(null)
                  setImportPreview(null)
                },
              }),
              h('button', {
                type: 'button',
                className: 'dsh-tp-mini',
                onClick: () => {
                  const result = props.previewConfigCode(importText)
                  if (result && result.ok) {
                    setImportPreview(result.config)
                    setImportState(null)
                  } else {
                    setImportPreview(null)
                    setImportState('bad')
                  }
                },
              }, txt.preview),
              h('button', {
                type: 'button',
                className: 'dsh-tp-mini',
                // 示例码由生产编码器现场生成：schema 变了它跟着变，永远不会过期
                onClick: () => {
                  const code = props.getSampleCode()
                  setImportText(code)
                  const result = props.previewConfigCode(code)
                  if (result && result.ok) {
                    setImportPreview(result.config)
                    setImportState(null)
                  } else {
                    setImportPreview(null)
                    setImportState('bad')
                  }
                },
              }, txt.sample),
              importState === 'bad' && h('span', { className: 'dsh-tp-note', role: 'alert', 'aria-live': 'polite' }, txt.importBad)),
            importPreview && h('div', { className: 'dsh-tp-preview', role: 'group', 'aria-label': txt.importSummary },
              h('p', null, txt.importSummary + ' ' + [
                (lb.scheme[importPreview.palette] || importPreview.palette),
                txt.sidebar + ' ' + (lb.sidebar[importPreview.sidebar] || importPreview.sidebar),
                txt.text + ' ' + (lb.text[importPreview.text] || importPreview.text),
                txt.hc + ' ' + (lb.hc[importPreview.hc] || importPreview.hc),
              ].join(' · ')),
              importPreview.custom
                ? h('p', null, txt.custom + ' ' + importPreview.custom.bg + ' / ' + importPreview.custom.text + ' / ' + importPreview.custom.accent)
                : h('p', null, txt.importLegacy),
              h('div', { className: 'dsh-tp-field-row' },
                h('button', {
                  type: 'button',
                  className: 'dsh-tp-mini',
                  onClick: () => {
                    const result = props.applyConfigCode(importText)
                    setImportPreview(null)
                    setImportState(result && result.ok ? (result.hasCustom ? 'ok' : 'legacy') : 'bad')
                  },
                }, txt.applyImport),
                h('button', {
                  type: 'button',
                  className: 'dsh-tp-mini',
                  onClick: () => { setImportPreview(null); setImportState(null) },
                }, txt.cancel))),
            importState && importState !== 'bad' && h('span', { className: 'dsh-tp-note', role: 'status', 'aria-live': 'polite' },
              importState === 'ok' ? txt.importOk : txt.importLegacy),
            h('p', { className: 'dsh-tp-custom-hint' }, txt.configHint),
          ),
          row('md', txt.md, txt.mdSub, seg(MD_MODES, mdMode, props.setMdMode, lb.md, rowId('md'))),
          row('scroll', txt.scroll, current === 'mono' ? txt.scrollHintMono : txt.scrollSub, seg(SCROLL_MODES, scrollMode, props.setScrollMode, lb.scroll, rowId('scroll'), current === 'mono')),
          row('control', txt.control, txt.controlSub, seg(CONTROL_MODES, controlMode, props.setControlMode, lb.control, rowId('control'), current === 'mono')),
        ),
      )
    }

    /* ================= 插件 ================= */
    /**
     * 开发期接口默认**关闭**：只有在页面 URL 上显式带 `?dshThemeDev=1` 时才暴露。
     * 这不是安全边界（同上下文脚本本就有同等权力），而是防止"谁先定义谁拿到全部 setter"
     * 的默认开放；一旦宿主将来把插件放进受限上下文，它就是跨权限入口。
     */
    const DEV_OPT_IN = (() => {
      try {
        // 两种开启方式：URL 带 ?dshThemeDev=1，或页面脚本在插件加载前设好
        // window.__DSH_THEME_PALETTE_DEV_REQUEST__ = true（CDP 用 Page.addScriptToEvaluateOnNewDocument 注入，
        // 这是 tools/shoot-desktop.mjs 的唯一入口 —— 之前缺这个入口，B 层回归实际上跑不起来）
        if (typeof window !== 'undefined' && window.__DSH_THEME_PALETTE_DEV_REQUEST__ === true) return true
        const search = typeof location !== 'undefined' && location ? String(location.search || '') : ''
        return /(?:^|[?&])dshThemeDev=1(?:&|$)/.test(search)
      } catch (err) { return false }
    })()

    /**
     * 报表入口：palette-dev 报表与 check-audit 断言都走这里，
     * 拿到的就是**设置页那一份**模型（同一套承诺目标、同一套物理上限、同一套政策豁免）。
     */
    function devContrastReport(schemeId, options) {
      const opt = options || {}
      const scheme = SCHEMES.find((s) => s.id === schemeId) || SCHEMES[0]
      const hc = opt.hc === true
      const tokens = buildTokens(
        scheme,
        opt.sidebar || DEFAULT_SIDEBAR,
        opt.text || DEFAULT_TEXT,
        opt.scroll || DEFAULT_SCROLL,
        opt.control || DEFAULT_CONTROL,
        opt.md || DEFAULT_MD,
        hc,
      )
      return buildContrastReport(tokens, hc, { mono: !scheme.tinted })
    }

    // 开发期接口：palette-dev.mjs 通过它拿到同一套引擎（避免「报表好看、上线不一样」）
    if (DEV_OPT_IN && typeof window !== 'undefined' && typeof window.__DSH_THEME_PALETTE_DEV__ === 'function') {
      window.__DSH_THEME_PALETTE_DEV__({ buildTokens, SCHEMES, SIDEBAR_MODES, TEXT_MODES, SCROLL_MODES, CONTROL_MODES, MD_MODES, HC_MODES, contrast, toOklch, fromOklch, flatten, rampsFor, floors, encodeConfig, decodeConfig, customScheme, readCustom, writeCustom, CONTRAST_SURFACES, CONTRAST_ROLES, buildContrastReport, devContrastReport, CONTRAST_TARGETS, CONTRAST_EXEMPT, CONTRAST_FLOOR, CONTRAST_SOLVER_MARGIN, LAYER_MARK, settingsCss: SETTINGS_CSS, markdownCss: MARKDOWN_CSS, cardColors })
    }

    return {
      inject: ['slots', 'theme'],
      apply(ctx) {
        const theme = ctx.get('theme')
        if (!theme || typeof theme.overrideTokens !== 'function') {
          console.warn('[dsh-theme-palette] ctx.theme.overrideTokens 不可用，配色不生效')
          return
        }

        let current = readStored()
        // 只有升级前已有配置的用户才需要“行为变更”提示
        const hadConfig = hasStoredConfig()
        let sidebarMode = readSidebarStored()
        let textMode = readTextStored()
        let scrollMode = readScrollStored()
        let controlMode = readControlStored()
        let mdMode = readMdStored()
        let hcMode = readHcStored()
        const getConfigCode = () => encodeConfig({ palette: current, sidebar: sidebarMode, text: textMode, scroll: scrollMode, control: controlMode, md: mdMode, hc: hcMode, lang: langPref })
        let langPref = readLangPref()
        const localeListeners = new Set()
        const currentLocale = () => pickLocale(langPref)
        const emitLocale = () => { for (const fn of localeListeners) { try { fn() } catch (err) { /* 忽略 */ } } }
        const listeners = new Set()
        const sidebarListeners = new Set()
        const textListeners = new Set()
        const scrollListeners = new Set()
        const controlListeners = new Set()
        const mdListeners = new Set()
        const hcListeners = new Set()
        const customListeners = new Set()

        const getCurrent = () => current
        const getSidebarMode = () => sidebarMode
        const getTextMode = () => textMode
        const getScrollMode = () => scrollMode
        const getControlMode = () => controlMode
        const getMdMode = () => mdMode
        const getHcMode = () => hcMode
        const subscribe = (fn) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        }
        const subscribeSidebar = (fn) => {
          sidebarListeners.add(fn)
          return () => { sidebarListeners.delete(fn) }
        }
        const subscribeText = (fn) => {
          textListeners.add(fn)
          return () => { textListeners.delete(fn) }
        }
        const subscribeScroll = (fn) => {
          scrollListeners.add(fn)
          return () => { scrollListeners.delete(fn) }
        }
        const subscribeControl = (fn) => {
          controlListeners.add(fn)
          return () => { controlListeners.delete(fn) }
        }
        const subscribeMd = (fn) => {
          mdListeners.add(fn)
          return () => { mdListeners.delete(fn) }
        }
        const emit = () => { for (const fn of listeners) { try { fn() } catch (err) { /* 单个订阅者出错不影响全局 */ } } }
        const emitSidebar = () => { for (const fn of sidebarListeners) { try { fn() } catch (err) { /* 同理 */ } } }
        const emitText = () => { for (const fn of textListeners) { try { fn() } catch (err) { /* 同理 */ } } }
        const emitScroll = () => { for (const fn of scrollListeners) { try { fn() } catch (err) { /* 同理 */ } } }
        const emitControl = () => { for (const fn of controlListeners) { try { fn() } catch (err) { /* 同理 */ } } }
        const emitMd = () => { for (const fn of mdListeners) { try { fn() } catch (err) { /* 同理 */ } } }
        const subscribeHc = (fn) => {
          hcListeners.add(fn)
          return () => { hcListeners.delete(fn) }
        }
        const emitHc = () => { for (const fn of hcListeners) { try { fn() } catch (err) { /* 同理 */ } } }
        // 自定义色的独立订阅：三个色变了但 current 没变，不能靠配色订阅触发重渲染
        const subscribeCustom = (fn) => {
          customListeners.add(fn)
          return () => { customListeners.delete(fn) }
        }
        const emitCustom = () => { for (const fn of customListeners) { try { fn() } catch (err) { /* 同理 */ } } }

        // 升级提示：每个版本只出现一次；只读写 notice 键，不碰配色设置
        let noticeSeenVersion = readNoticeSeen()
        const noticeListeners = new Set()
        const subscribeNotice = (fn) => {
          noticeListeners.add(fn)
          return () => { noticeListeners.delete(fn) }
        }
        const getNoticePending = () => hadConfig && noticeSeenVersion !== PLUGIN_VERSION
        const emitNotice = () => { for (const fn of noticeListeners) { try { fn() } catch (err) { /* 同理 */ } } }
        const dismissNotice = () => {
          noticeSeenVersion = PLUGIN_VERSION
          writeNoticeSeen(noticeSeenVersion)
          emitNotice()
        }

        let disposeLayer = () => {}
        /** 按当前配色 + 侧栏档位重建覆盖层（换配色与换侧栏档位走同一条路）。 */
        // 最近一次成功应用的 token 表与原因：自愈时据此重放，也用来解释"为什么又变回去了"。
        let lastTokens = null
        let lastAppliedAt = 0
        let lastReason = 'init'
        let reapplyCount = 0
        // 「配置已保存」与「主题已应用」是两件事：选择已经写进 localStorage，
        // 但覆盖层写失败时屏幕上仍是旧配色。分开报，别让用户以为换成功了。
        let applyError = null

        const applyAll = (reason) => {
          const scheme = SCHEMES.find((s) => s.id === current) || SCHEMES[0]
          const tokens = buildTokens(scheme, sidebarMode, textMode, scrollMode, controlMode, mdMode, hcMode === 'on')
          let next = () => {}
          if (tokens !== undefined) {
            try {
              next = theme.overrideTokens(OVERRIDE_SOURCE, tokens)
            } catch (err) {
              applyError = String((err && err.message) || err)
              console.error('[dsh-theme-palette] 应用配色失败（配置已保存，主题未应用）：', err)
              publishHealth(null)
              return
            }
          }
          // 先叠新层再撤旧层，避免切换瞬间闪回默认色。
          const prev = disposeLayer
          disposeLayer = next
          prev()
          if (reason !== undefined) lastReason = reason
          lastTokens = tokens
          lastAppliedAt = Date.now()
          applyError = null
          scheduleProbe(tokens)
        }
        /**
         * 自愈。
         *
         * 宿主的 theme.overrideTokens 把每一层的 disposer 挂在**调用方 fiber** 上
         * （`ctx.effect(() => dispose, ...)`）：插件被卸载/重载、或 fiber 的 effect 被清理时，
         * 这一层就没了 —— 表现正是"配色自己跳回默认"，而 localStorage 里的选择还在。
         * 这里定期（以及窗口重新可见/获焦时）回读 body：token 不在了就把最后一层重放。
         */
        // 连续失败要退避：宿主真把 token 改名时，每 4 秒重放一次既刷日志、又会堆 override 层。
        const HEAL_BACKOFF = [4000, 15000, 60000, 180000, 600000]
        let healFails = 0
        let lastHealAt = 0
        let healDisabled = false

        /**
         * 覆盖层还在不在（1.9.8：不再看「属性非空」）。
         *
         * 旧判据是「关键 token 的计算值是否为空」——覆盖层被宿主撤销后，宿主的基础 token
         * 仍然有值，判据永远说「健康」，配色却已经跳回默认（假健康）。
         * 现在用两件事判断：
         *   1) 标记属性 --dshtp-layer：只由本插件的覆盖层写入，层没了它就没了；
         *   2) 颜色比对：关键 token 的计算值必须等于本层期望值（明暗两色任一相符即可）。
         * 判据不成立 → 层已丢失或被改名 → 重放（退避与停用逻辑不变）。
         */
        const layerState = () => {
          try {
            const style = getComputedStyle(document.body)
            if (style.getPropertyValue(LAYER_MARK).trim() === '') return { ok: false, reason: 'marker-missing' }
          } catch (err) {
            return { ok: false, reason: 'probe-error' }
          }
          const probe = probeApplied(lastTokens)
          // 没有 getComputedStyle（或一个 token 都探测不到）时判不出丢失，不要误伤
          if (probe === null) return { ok: true, reason: 'no-probe' }
          if (!probe.ok) return { ok: false, reason: 'color-mismatch', mismatched: probe.mismatched }
          return { ok: true, reason: 'ok' }
        }

        const ensureApplied = (reason) => {
          if (lastTokens === null || healDisabled) return
          if (Date.now() - lastAppliedAt < 900) return
          const wait = HEAL_BACKOFF[Math.min(healFails, HEAL_BACKOFF.length - 1)]
          if (healFails > 0 && Date.now() - lastHealAt < wait) return
          lastHealAt = Date.now()
          const state = layerState()
          if (state.ok) {
            healFails = 0
            return
          }
          if (healFails >= HEAL_BACKOFF.length) {
            healDisabled = true
            console.error('[dsh-theme-palette] 配色层反复失效（' + reapplyCount + ' 次，已停用自动重放）：请检查宿主 token 是否改名')
            return
          }
          healFails += 1
          reapplyCount += 1
          console.info('[dsh-theme-palette] 配色层不见了（' + reason + '｜' + state.reason + '），已重放第 ' + reapplyCount + ' 次')
          applyAll('self-heal:' + reason)
        }

        let health = null
        const healthListeners = new Set()
        const getHealth = () => health
        const subscribeHealth = (fn) => {
          healthListeners.add(fn)
          return () => { healthListeners.delete(fn) }
        }
        const emitHealth = () => { for (const fn of healthListeners) { try { fn() } catch (err) { /* 同理 */ } } }
        /**
         * 健康快照 = 探测结果 + 应用状态 + 重放次数。
         * 判重必须带上 reapplies：同色重放之后「已恢复 N 次」要跟着涨，
         * 否则界面上的恢复次数会停在旧值（1.9.7 修）。
         */
        const buildHealth = (probe) => {
          const base = probe || (health
            ? { ok: health.ok, checked: health.checked, mismatched: health.mismatched }
            : { ok: true, checked: 0, mismatched: [] })
          return {
            ...base,
            reapplies: reapplyCount,
            applied: applyError === null,
            applyError,
            lastAppliedAt,
          }
        }
        const sameHealth = (a, b) => a !== null && b !== null
          && a.ok === b.ok
          && a.checked === b.checked
          && String(a.mismatched) === String(b.mismatched)
          && a.reapplies === b.reapplies
          && a.applied === b.applied
          && a.applyError === b.applyError
        const publishHealth = (probe) => {
          const next = buildHealth(probe)
          if (sameHealth(health, next)) return
          health = next
          if (probe && !probe.ok) console.warn('[dsh-theme-palette] 有 token 没写进 body，宿主可能改名了')
          emitHealth()
        }
        /** 下一帧再读（presenter 把 token 写到 body 需要一个提交周期）。 */
        const scheduleProbe = (tokens) => {
          if (tokens === undefined) return
          const run = () => { publishHealth(probeApplied(tokens)) }
          try { requestAnimationFrame(run) } catch (err) { setTimeout(run, 16) }
        }

        const setPalette = (id) => {
          if (!SCHEMES.some((s) => s.id === id)) return
          current = id
          writeStored(id)
          applyAll()
          emit()
        }
        const setSidebarMode = (id) => {
          if (!SIDEBAR_MODES.some((m) => m.id === id)) return
          sidebarMode = id
          writeSidebarStored(id)
          applyAll()
          emitSidebar()
        }
        const setTextMode = (id) => {
          if (!TEXT_MODES.some((m) => m.id === id)) return
          textMode = id
          writeTextStored(id)
          applyAll()
          emitText()
        }
        const setScrollMode = (id) => {
          if (!SCROLL_MODES.some((m) => m.id === id)) return
          scrollMode = id
          writeScrollStored(id)
          applyAll()
          emitScroll()
        }
        const setControlMode = (id) => {
          if (!CONTROL_MODES.some((m) => m.id === id)) return
          controlMode = id
          writeControlStored(id)
          applyAll()
          emitControl()
        }
        const setMdMode = (id) => {
          if (!MD_MODES.some((m) => m.id === id)) return
          mdMode = id
          writeMdStored(id)
          applyAll()
          emitMd()
        }
        /** 导入：整份校验通过才落地；返回结果供 UI 显示（旧码不含自定义三色时 hasCustom=false） */
        const applyConfigCode = (code) => {
          const cfg = decodeConfig(code)
          if (!cfg) return { ok: false, hasCustom: false }
          current = cfg.palette
          sidebarMode = cfg.sidebar
          textMode = cfg.text
          scrollMode = cfg.scroll
          controlMode = cfg.control
          mdMode = cfg.md
          hcMode = cfg.hc
          langPref = cfg.lang
          if (cfg.custom) writeCustom(cfg.custom)
          writeStored(current)
          writeSidebarStored(sidebarMode)
          writeTextStored(textMode)
          writeScrollStored(scrollMode)
          writeControlStored(controlMode)
          writeMdStored(mdMode)
          writeHcStored(hcMode)
          writeLangPref(langPref)
          applyAll('import')
          emit(); emitSidebar(); emitText(); emitScroll(); emitControl(); emitMd(); emitHc(); emitLocale()
          if (cfg.custom) emitCustom()
          return { ok: true, hasCustom: !!cfg.custom }
        }
        const getCustomColors = () => readCustom()
        /**
         * 解释性校正：告诉用户“你的取色被如何处理了”，而不是让颜色悄悄变掉。
         * 只读、可重复调用；ramp 缓存保证同一组设置不会重复计算。
         */
        const getCustomExplain = () => {
          const colors = readCustom()
          const scheme = customScheme(colors)
          const hc = hcMode === 'on'
          const t = buildTokens(scheme, sidebarMode, textMode, scrollMode, controlMode, mdMode, hc)
          const link = t['--dsw-alias-link'].light
          const base = t['--dsw-static-deepseek-500'].light
          const surfaces = ['150', '60', '00'].map((k) => t['--dsw-static-neutral-bluish-' + k].light)
          const ratio = Math.min(...surfaces.map((bg) => contrast(link, bg)))
          const acL = toOklch(colors.accent)[0]
          const accentTo = Math.min(0.64, Math.max(0.30, acL))
          return {
            accentClamped: Math.abs(acL - accentTo) > 0.005,
            accentFrom: Math.round(acL * 100) / 100,
            accentTo: Math.round(accentTo * 100) / 100,
            linkShifted: link.toLowerCase() !== base.toLowerCase(),
            linkRatio: Math.round(ratio * 100) / 100,
            linkTarget: floors(hc).link,
          }
        }
        /** 诊断导出：把当前配色与对比度矩阵打成可粘贴的 JSON（提 issue 用）。 */
        const getDiagnostics = () => ({
          plugin: 'dsh-theme-palette',
          version: PLUGIN_VERSION,
          settings: { palette: current, sidebar: sidebarMode, text: textMode, scroll: scrollMode, control: controlMode, md: mdMode, hc: hcMode, lang: langPref },
          report: getContrastReport(),
        })
        const previewConfigCode = (code) => {
          const cfg = decodeConfig(code)
          return cfg ? { ok: true, config: cfg } : { ok: false }
        }
        /**
         * 对比度矩阵（R1）：把"前景 × 承载面"的真实读数露出来。
         *
         * 口径只有一处：buildContrastReport。设置页 UI、palette-dev 报表、check-audit
         * 断言共用同一份模型 —— 同一套承诺目标、同一套物理上限、同一套政策豁免。
         */
        const getContrastReport = () => {
          const scheme = SCHEMES.find((s) => s.id === current) || SCHEMES[0]
          const hc = hcMode === 'on'
          const t = buildTokens(scheme, sidebarMode, textMode, scrollMode, controlMode, mdMode, hc)
          return buildContrastReport(t, hc, { mono: !scheme.tinted })
        }
        /**
         * 「试试示例」用的演示短码：现场用生产 encodeConfig 生成，schema 演进时自动跟随，
         * 不存在"README 里的示例码过期"这类手写漂移。三色刻意非默认组合，便于验证三色真的生效。
         */
        const getSampleCode = () => encodeConfig({
          palette: 'custom', sidebar: 'deep', text: 'tinted',
          scroll: 'tinted', control: 'accent', md: 'on', hc: 'off', lang: langPref,
          custom: { bg: '#f5efe6', text: '#1d1a17', accent: '#3f66a3' },
        })
        const resetCustom = () => {
          writeCustom(Object.assign({}, CUSTOM_DEFAULT))
          applyAll('custom:reset')
          emitCustom()
        }
        const setCustomColor = (field, hex) => {
          if (CUSTOM_FIELDS.indexOf(field) === -1) return false
          if (typeof hex !== 'string' || !HEX_RE.test(hex)) return false
          const next = Object.assign({}, readCustom(), { [field]: hex.toLowerCase() })
          writeCustom(next)
          applyAll('custom:' + field)
          emitCustom()
          return true
        }
        const setHcMode = (id) => {
          if (!HC_MODES.some((m) => m.id === id)) return
          hcMode = id
          writeHcStored(id)
          applyAll()
          emitHc()
        }
        const getLangPref = () => langPref
        const getLocale = () => currentLocale()
        const subscribeLocale = (fn) => {
          localeListeners.add(fn)
          return () => { localeListeners.delete(fn) }
        }
        const setLangPref = (id) => {
          if (id !== 'auto' && LOCALES.indexOf(id) === -1) return
          langPref = id
          writeLangPref(id)
          emitLocale()
        }
        // 宿主切换界面语言时（locale 服务会改 documentElement.lang），设置页跟着重渲染。
        let langObserver = null
        try {
          langObserver = new MutationObserver(() => emitLocale())
          langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
        } catch (err) { /* 没有 MutationObserver 就只在打开设置页时读一次 */ }

        // 开发期自动化接口：截图回归要从外部驱动「换配色 / 换明暗」，而这两件事
        // 平时只能点界面。默认不暴露，必须 URL 带 ?dshThemeDev=1 才挂（见 DEV_OPT_IN）。
        let detachDev = null
        try {
          const dev = DEV_OPT_IN && typeof window !== 'undefined' ? window.__DSH_THEME_PALETTE_DEV__ : undefined
          if (dev && typeof dev.attach === 'function') {
            const THEME_IDS = ['light', 'dark', 'system']
            const attached = dev.attach({
              setPalette,
              setSidebarMode,
              setTextMode,
              setScrollMode,
              setControlMode,
              getPreference: () => theme.getTheme().preference,
              setLangPref,
              setHcMode,
              getHcMode,
              locales: LOCALES,
              // 和其它 setter 一样过白名单：任意字符串会原样进宿主主题状态并被持久化
              setTheme: (id) => { if (THEME_IDS.indexOf(id) !== -1) theme.setTheme(id) },
              schemes: SCHEMES.map((s) => s.id),
            })
            if (typeof attached === 'function') detachDev = attached
          }
        } catch (err) {
          console.warn('[dsh-theme-palette] dev hook attach 失败：', err)
        }

        // 自愈的触发点：窗口回前台、获焦、页面恢复、主题事件、以及一个低频定时器。
        const heal = (why) => () => { try { ensureApplied(why) } catch (err) { /* 自愈失败不影响主流程 */ } }
        const healOnVisible = heal('visibility')
        const healOnFocus = heal('focus')
        const healOnShow = heal('pageshow')
        const healOnTheme = heal('theme-change')
        let healTimer = null
        try {
          document.addEventListener('visibilitychange', healOnVisible)
          window.addEventListener('focus', healOnFocus)
          window.addEventListener('pageshow', healOnShow)
        } catch (err) { /* 无 DOM 时跳过 */ }
        try { ctx.on('theme/change', healOnTheme) } catch (err) { /* 事件名变了就只靠定时器 */ }
        try {
          healTimer = setInterval(() => {
            // 页面不可见时不做样式回读：容器里长时间后台驻留时，4 秒一次 getComputedStyle 是纯浪费
            try { if (document.visibilityState === 'hidden') return } catch (err) { /* 无该 API */ }
            ensureApplied('interval')
          }, 15000)
          if (healTimer && typeof healTimer.unref === 'function') healTimer.unref()
        } catch (err) { /* 无定时器环境 */ }

        ctx.effect(() => {
          applyAll('boot')
          const removeStyle = installMarkdownStyle()
          const removeSettings = installSettingsStyle()
          return () => {
            disposeLayer()
            removeStyle()
            removeSettings()
            try {
              document.removeEventListener('visibilitychange', healOnVisible)
              window.removeEventListener('focus', healOnFocus)
              window.removeEventListener('pageshow', healOnShow)
            } catch (err) { /* 同上 */ }
            if (healTimer !== null) { clearInterval(healTimer); healTimer = null }
            if (typeof detachDev === 'function') { try { detachDev() } catch (err) { /* 忽略 */ } }
            if (langObserver !== null) { langObserver.disconnect(); langObserver = null }
          }
        }, 'dsh-theme-palette: token layer + 右栏样式')

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'theme-palette',
              // 内置节顺序：account -10 / general 0 / models 10 / plugins 15 / agent-presets 20；
              // 5 = 紧跟「通用」之后。
              order: 5,
              label: () => TEXT[pickLocale(readLangPref())].nav,
              inject: () => ({
                getCurrent,
                subscribe,
                setPalette,
                getSidebarMode,
                subscribeSidebar,
                setSidebarMode,
                getTextMode,
                subscribeText,
                setTextMode,
                getScrollMode,
                subscribeScroll,
                setScrollMode,
                getControlMode,
                subscribeControl,
                setControlMode,
                getMdMode,
                subscribeMd,
                setMdMode,
                getHcMode,
                subscribeHc,
                setHcMode,
                getConfigCode,
                applyConfigCode,
                getCustomColors,
                getCustomExplain,
                previewConfigCode,
                getSampleCode,
                getContrastReport,
                getDiagnostics,
                subscribeNotice,
                getNoticePending,
                dismissNotice,
                subscribeCustom,
                setCustomColor,
                resetCustom,
                getLangPref,
                getLocale,
                subscribeLocale,
                setLangPref,
                getHealth,
                subscribeHealth,
              }),
            },
            PaletteSection,
          ),
        )
      },
    }
  },
})
