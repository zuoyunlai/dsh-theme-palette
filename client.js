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

    const PLUGIN_VERSION = '1.8.4'
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
      { id: 'custom', label: '自定义', desc: '三色派生', tinted: true, custom: true, hue: 60, darkHue: 60, lightC: 0.02, midC: 0.01, textC: 0.004, darkC: 0.014, darkLift: 0.03, paperC: 0.012, accentHue: 60, accentC: 0.1, accentL: 0.58, accentScale: 1 },
    ]

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
      return {
        id: 'custom', label: '自定义', desc: '三色派生', tinted: true, custom: true,
        hue: bg[2], darkHue: bg[2],
        lightC: clampN(bg[1] * 0.9, 0.008, 0.045), midC: 0.010,
        // 文字色相必须真的来自「文字」这一项：只用色度会让「同色度、不同色相」完全同效，
        // 与 UI 上「三色的色相与色度」的承诺不符。
        textC: clampN(tx[1], 0.002, 0.030), textHue: tx[2],
        darkC: clampN(bg[1] * 0.75, 0.006, 0.035), darkLift: 0.030,
        paperC: clampN(tx[1], 0.004, 0.030), paperHue: tx[2],
        // accentL 必须钳位：500 档同时是 --dsw-alias-link、button-info-fill 与勾选支点的来源。
        // 纯白/荧光黄会让填充与白字同色；只在极端输入时归一化，预设色不受影响。
        accentHue: ac[2], accentC: clampN(ac[1], 0.04, 0.18), accentL: clampN(ac[0], 0.30, 0.64), accentScale: 1.0,
      }
    }

    const MIN_MAIN = 12
    const MIN_SECONDARY = 6.2
    const MIN_TERTIARY = 4.62
    const MIN_LINK = 4.62
    const MIN_LINK_DARK = 4.62

    /**
     * 高对比模式（反哺 A-4）：把四档文字下限整体抬到 WCAG AAA 级别。
     * 不改配色，只让求解器把文字压得更狠；默认关闭。
     */
    const FLOORS_HC = { main: 15, secondary: 9, tertiary: 7, link: 7, linkDark: 7 }
    function floors(hc) {
      return hc === true
        ? FLOORS_HC
        : { main: MIN_MAIN, secondary: MIN_SECONDARY, tertiary: MIN_TERTIARY, link: MIN_LINK, linkDark: MIN_LINK_DARK }
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
     */
    const TEXT_MODES = [
      { id: 'neutral', label: '静', textScale: 1, paperScale: 1, textLift: 0 },
      { id: 'tinted', label: '标准', textScale: 3.0, paperScale: 2.4, textLift: 0.055 },
      { id: 'deep', label: '浓', textScale: 4.6, paperScale: 3.6, textLift: 0.085 },
    ]
    const DEFAULT_TEXT = 'tinted'
    const TEXT_KEY = 'dsh-theme-palette.text.v1'

    /**
     * 右侧栏底色。宿主的右栏（ui-layout 的 RightbarColumn）**没有自己的背景**，
     * 露出的是 frame 的 --dsw-alias-bg-base（也就是会话区画布色），所以看着和中间一样。
     * 元素上有一个稳定钩子 `data-rightbar-col`，用一条 CSS 规则就能单独上色，
     * 具体颜色由 token 层给的 --dshtp-rightbar-fill 决定（默认直接引用左栏 token）。
     */
    const RIGHTBAR_MODES = [
      { id: 'sidebar', label: '同左栏' },
      { id: 'canvas', label: '跟随画布' },
    ]
    const DEFAULT_RIGHTBAR = 'sidebar'
    const RIGHTBAR_KEY = 'dsh-theme-palette.rightbar.v1'
    const RIGHTBAR_STYLE_ID = 'dsh-theme-palette/rightbar.css'

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
    const LIGHT_CAP = 0.985

    function lift(hex, delta, chromaScale) {
      const [L, C, hue] = toOklch(hex)
      const nextL = clamp(L + delta, 0, LIGHT_CAP)
      const headroom = clamp((1 - nextL) / 0.02, 0, 1)
      return fromOklch(nextL, C * chromaScale * headroom, hue)
    }

    /* ================= 色阶重建 ================= */
    /**
     * 近白端必须压暗一点：纯白在任何色度下都还是白，颜色出不来。
     * 近黑端同理，轻微上提。中间亮度原样保留 —— 对比度基线因此不变。
     */
    function compressL(L) {
      // 等量下移而不是压缩斜率：压缩会把「画布↔卡层」的 ΔL 从 0.031 压到 0.0147，
      // 而 L<0.93 的那一段又没压，明度节奏会在边界处断层。
      if (L >= 0.92) return L - 0.044
      if (L < 0.14) return L * 1.06
      return L
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
      return { bluish, neutral, deepseek: accent(BASE.deepseek), blue: accent(BASE.blue) }
    }

    /**
     * 对比度求解：前景达不到 target 就沿亮度微调，**两个方向都找**（取离原色最近的可行解）。
     *
     * 只朝「远离背景」一个方向走会漏掉可行解：当强调色比浅色背景还亮（纯白/荧光黄），
     * 继续往白走只会更不可读，正确解在暗的一侧。bgs 可以是多个承载面，要求同时达标。
     */
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
      // 链接按「最亮的深色承载面（800）」兜底。
      // 注意这里**只有 400**：浅色链接不走这条色阶的中段（500 是设计稿的标准色，
      // 不能被求解器按承载面改写），浅色链接在 aliasOverrides 里从 500 派生。
      if (contrast(ramps.deepseek['400'], darkModule) < F.linkDark) {
        const effective = clampTarget(darkModule, F.linkDark, true)
        ramps.deepseek['400'] = solveForeground(ramps.deepseek, '400', darkModule, effective, hc ? 0.30 : 0.13)
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
    const rampCache = new Map()
    // 自定义取色会持续产生新键；给一个小上限，避免长会话里只增不减
    function rememberRamp(key, value) {
      rampCache.set(key, value)
      while (rampCache.size > 48) rampCache.delete(rampCache.keys().next().value)
      return value
    }
    function scalesFor(textMode) {
      const m = TEXT_MODES.find((x) => x.id === textMode) || TEXT_MODES[1]
      return { textScale: m.textScale, paperScale: m.paperScale, textLift: m.textLift || 0 }
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
      return {
        /* ---- 链接：唯一一条「不是标准色、而是从标准色派生」的强调色 ----
           宿主 `--dsw-alias-link` 指 deepseek-500（浅）/ 400（深），而 500 是品牌基准色。
           标准值当正文链接时过不了 AA（暖砂 #A9683E 在 150 面上 3.46），所以浅色链接
           用同色相的派生色；深色链接直接用 400（已由求解器兜到 4.62 起）。 */
        '--dsw-alias-link': { light: lightLink(r, hc), dark: r.deepseek['400'] },

        '--dsw-alias-border-l1': { light: withAlpha(ink, 0.04), dark: withAlpha(paper, 0.06) },
        '--dsw-alias-border-l2': { light: withAlpha(ink, 0.10), dark: withAlpha(paper, 0.12) },
        '--dsw-alias-border-l2-darkmode-thin': { light: withAlpha(ink, 0.10), dark: withAlpha(paper, 0.06) },
        '--dsw-alias-border-l3': { light: withAlpha(ink, 0.12), dark: withAlpha(paper, 0.16) },
        '--dsw-alias-border-l4': { light: withAlpha(ink, 0.16), dark: withAlpha(paper, 0.20) },
        '--dsw-alias-bg-skeleton': { light: withAlpha(ink, 0.04), dark: withAlpha(paper, 0.08) },

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
          light: r.bluish['400'],
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
    function scrollbarTokens(ramps, scheme, mode) {
      const m = SCROLL_MODES.find((x) => x.id === mode) || SCROLL_MODES[1]
      if (!m.chroma || !scheme.tinted) return {}
      const hue = m.useAccent ? scheme.accentHue : scheme.hue
      const paint = (step) => {
        const [L, C] = toOklch(ramps.neutral[step])
        return fromOklch(L, Math.max(C, m.chroma), hue)
      }
      return {
        '--dsw-alias-scrollbar-bg-l1': { light: paint('200'), dark: paint('700') },
        '--dsw-alias-scrollbar-bg-l2': { light: paint('200'), dark: paint('600') },
        '--dsw-alias-scrollbar-hover-l1': { light: paint('300'), dark: paint('600') },
        '--dsw-alias-scrollbar-hover-l2': { light: paint('300'), dark: paint('550') },
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
     */
    function sidebarTokens(r, mode, tinted) {
      const m = SIDEBAR_MODES.find((x) => x.id === mode) || SIDEBAR_MODES[0]
      const lightLift = m.lift
      // 深色模式用独立的 darkLift：深色底的可用明度空间比浅色小得多，
      // 沿用浅色步长（0.032/-0.020）在深色侧只有 ΔE 1.9–2.3 —— 正好卡在 JND 上，
      // 于是「左栏和中栏看不出界线」。深色侧给 0.048 / -0.042（ΔE 4 左右）。
      const darkLift = m.darkLift
      const s = m.chroma
      const paper = r.bluish['00']
      const lightFill = !tinted && m.lift >= 0 ? '#ffffff' : lift(paper, lightLift, s)
      const darkFill = lift(r.bluish['950'], darkLift, s)
      // 悬停/选中相对「侧栏最终底色」推导，不能再各自抬一次 ——
      // 提亮有天花板（LIGHT_CAP），各自抬会被同一上限压平，悬停与底色撞成同色。
      // 步进放到 0.024/0.030（ΔE≈2.4，跨过并排色块的 JND），但「更浅」档必须加护栏：
      // 侧栏在画布之上，往下走两档会穿过画布，选中项就像在页面里挖了个洞。
      const canvasL = toOklch(paper)[0]
      const fillL = toOklch(lightFill)[0]
      const room = (fillL - canvasL) / 2 - 0.004
      const fitStep = room > 0 ? Math.min(0.024, room) : 0
      const lightStep = tinted ? (fillL > canvasL ? fitStep : 0.024) : 0.020
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

    function buildTokens(scheme, sidebarMode, textMode, rightbarMode, scrollMode, controlMode, mdMode, hcMode) {
      const hc = hcMode === true
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
      const sidebar = sidebarTokens(ramps, sidebarMode, params.tinted)
      for (const [name, pair] of Object.entries(sidebar)) pairs[name] = pair
      // 右栏底色只给一个间接层：同左栏时直接引用左栏 token，跟随画布时引用画布 token。
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
      const rightbarFill = rightbarMode === 'canvas'
        ? 'var(--dsw-alias-bg-base)'
        : 'var(--dsw-specific-sidebar-fill)'
      pairs['--dshtp-rightbar-fill'] = { light: rightbarFill, dark: rightbarFill }
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
      const scroll = scrollbarTokens(ramps, params, scrollMode)
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

    /* ================= 右栏染色（head 里一条 CSS） ================= */
    /**
     * 用与官方包相同的 `data-plugin` / `data-plugin-css` 标记注入一条样式表，
     * 命中 ui-layout 的 `data-rightbar-col`（稳定语义钩子，不是哈希类名）。
     * 全屏右栏时退回画布色 —— 那时右栏就是整块内容区，染成侧栏色会像只剩一条侧栏。
     */
    // 说明：本插件不额外处理 forced-colors —— 我们改的 color/background-color/border-color
    // 都在 UA 强制色列表内，系统高对比模式下会被自动接管，无需（也不应）用 forced-color-adjust 对抗。
    const RIGHTBAR_CSS = [
      '[data-rightbar-col]{background:var(--dshtp-rightbar-fill,var(--dsw-alias-bg-base))}',
      '[data-rightbar-fullscreen] [data-rightbar-col]{background:var(--dsw-alias-bg-base)}',
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
.dsh-tp-input{flex:1 1 220px;min-width:0;font:12px/20px ui-monospace,Consolas,monospace;padding:5px 9px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
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
.dsh-tp-hexinput{width:100%;box-sizing:border-box;font:11.5px/16px ui-monospace,Consolas,monospace;padding:3px 6px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-tp-hexinput:focus-visible{outline-offset:1px}
.dsh-tp-hexinput[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dsh-tp-hexerror{font-size:11.5px;line-height:16px;color:var(--dsw-alias-state-error-primary)}
.dsh-tp-custom-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-tp-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-status{margin:0;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-status.is-bad{color:var(--dsw-alias-state-error-primary)}
.dsh-tp-matrix{display:flex;flex-direction:column;gap:8px;padding:11px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsh-tp-matrix-head{display:flex;align-items:center;gap:8px}
.dsh-tp-matrix-title{font-size:13.5px;font-weight:500}
.dsh-tp-matrix-sub{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-matrix table{border-collapse:collapse;width:100%;font-size:11.5px;line-height:16px;font-variant-numeric:tabular-nums}
.dsh-tp-matrix th,.dsh-tp-matrix td{padding:4px 6px;text-align:right;border-top:.5px solid var(--dsw-alias-border-l2);white-space:nowrap}
.dsh-tp-matrix th:first-child,.dsh-tp-matrix td:first-child{text-align:left}
.dsh-tp-matrix thead th{font-weight:500;color:var(--dsw-alias-label-tertiary);border-top:0}
.dsh-tp-matrix td.is-ok{color:var(--dsw-alias-label-secondary)}
.dsh-tp-matrix td.is-limited{color:var(--dsw-alias-label-tertiary)}
.dsh-tp-matrix td.is-bad{color:var(--dsw-alias-state-error-primary);font-weight:500}
.dsh-tp-matrix td .dsh-tp-matrix-mark{font-size:10px;margin-left:2px}
.dsh-tp-field{display:flex;flex-direction:column;gap:8px;padding:11px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsh-tp-field-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dsh-tp-field-title{font-size:13.5px;font-weight:500}
.dsh-tp-input{text-overflow:ellipsis}
@media (prefers-reduced-motion:reduce){.dsh-tp-card,.dsh-tp-seg button,.dsh-tp-more,.dsh-tp-check,.dsh-tp-mini{transition:none}}
`

    function installRightbarStyle() {
      try {
        if (typeof document === 'undefined' || !document.head) return () => {}
        if (document.querySelector('style[data-plugin-css="' + RIGHTBAR_STYLE_ID + '"]')) return () => {}
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-theme-palette'
        tag.dataset.pluginCss = RIGHTBAR_STYLE_ID
        tag.textContent = RIGHTBAR_CSS
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

    function readRightbarStored() {
      try {
        const raw = localStorage.getItem(RIGHTBAR_KEY)
        if (raw && RIGHTBAR_MODES.some((m) => m.id === raw)) return raw
      } catch (err) { /* 退回默认 */ }
      return DEFAULT_RIGHTBAR
    }

    function writeRightbarStored(id) {
      try { localStorage.setItem(RIGHTBAR_KEY, id) } catch (err) { /* 同理 */ }
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
        v: 1, p: state.palette, s: state.sidebar, t: state.text, r: state.rightbar,
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
          rightbar: hasId(RIGHTBAR_MODES, raw.r) ? raw.r : null,
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
        rightbar: '右侧栏底色',
        advanced: '更多选项',
        textSub: '正文与强调的着色程度',
        sidebarSub: '相对会话区的层次',
        rightbarSub: '面板底色',
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
        notice: '1.7.0 调整了派生规则：极端强调色会归一化、文字色相参与派生、深色模块面按可达上限报告对比度。',
        dismiss: '知道了',
        explainClamp: '强调色已归一化：{from} → {to}（保证按钮与勾选可读）',
        explainLink: '链接已为可读性压暗：{ratio}:1（目标 {target}:1）',
        preview: '预览',
        sample: '试试示例',
        copyDiag: '复制诊断',
        contrast: '对比度',
        contrastSub: '实测 / 目标（按承载面；※ 不计硬门·△ 表面受限）',
        cMain: '正文',
        cSecondary: '次级',
        cTertiary: '三级',
        cLink: '链接',
        cLimited: '表面受限',
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
        hcSub: '尽量把文字下限抬到 AAA（正文 ≥15、次文 ≥9、三级 ≥7）；深色模块面的上限受表面亮度限制。',
      },
      'zh-TW': {
        nav: '主題色',
        hint: '配色與明暗模式獨立；切換後立即生效並存在 localStorage。',
        md: 'Markdown 強調',
        control: '開關 / 勾選',
        scroll: '捲軸',
        scrollHintMono: '目前是黑白配色，沒有色相可跟隨，捲軸保持中性灰。',
        rightbar: '右側欄底色',
        advanced: '更多選項',
        textSub: '本文與強調的著色程度',
        sidebarSub: '相對會話區的層次',
        rightbarSub: '面板底色',
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
        notice: '1.7.0 調整了衍生規則：極端強調色會正規化、文字色相參與衍生、深色模組面按可達上限回報對比度。',
        dismiss: '知道了',
        explainClamp: '強調色已正規化：{from} → {to}（確保按鈕與勾選可讀）',
        explainLink: '連結已為可讀性壓暗：{ratio}:1（目標 {target}:1）',
        preview: '預覽',
        sample: '試試示例',
        copyDiag: '複製診斷',
        contrast: '對比度',
        contrastSub: '實測 / 目標（依承載面；※ 不計硬門·△ 表面受限）',
        cMain: '正文',
        cSecondary: '次級',
        cTertiary: '三級',
        cLink: '連結',
        cLimited: '表面受限',
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
        hcSub: '盡量把文字下限抬到 AAA（正文 ≥15、次文 ≥9、三級 ≥7）；深色模組面的上限受表面亮度限制。',
      },
      en: {
        nav: 'Color theme',
        hint: 'Independent of light/dark mode. Applies immediately and is saved to localStorage.',
        md: 'Markdown emphasis',
        control: 'Switches / checks',
        scroll: 'Scrollbars',
        scrollHintMono: 'Monochrome has no hue to follow; scrollbars stay neutral.',
        rightbar: 'Right panel surface',
        advanced: 'More options',
        textSub: 'How strongly text follows the palette',
        sidebarSub: 'Layer relative to the conversation',
        rightbarSub: 'Panel surface',
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
        notice: '1.7.0 changes how colours are derived: extreme accents are normalised, text hue now affects derivation, and dark module surfaces report contrast against their achievable ceiling.',
        dismiss: 'Got it',
        explainClamp: 'Accent normalised: {from} → {to} (keeps buttons and checks readable)',
        explainLink: 'Link darkened for readability: {ratio}:1 (target {target}:1)',
        preview: 'Preview',
        sample: 'Try a sample',
        copyDiag: 'Copy diagnostics',
        contrast: 'Contrast',
        contrastSub: 'measured / target per surface (※ not gated · △ surface-limited)',
        cMain: 'Body',
        cSecondary: 'Secondary',
        cTertiary: 'Tertiary',
        cLink: 'Link',
        cLimited: 'surface-limited',
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
        hcSub: 'Raises text floors toward AAA (body ≥15, secondary ≥9, tertiary ≥7); dark module surfaces are limited by surface luminance.',
      },
      ja: {
        nav: 'カラーテーマ',
        hint: 'ライト/ダークとは独立です。変更は即時反映され、localStorage に保存されます。',
        md: 'Markdown の強調',
        control: 'スイッチ / チェック',
        scroll: 'スクロールバー',
        scrollHintMono: 'モノクロには色相がないため、スクロールバーはグレーのままです。',
        rightbar: '右パネルの背景',
        advanced: 'その他のオプション',
        textSub: '本文と強調の色づき具合',
        sidebarSub: '会話エリアとの段差',
        rightbarSub: 'パネルの背景',
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
        notice: '1.7.0 で派生ルールを変更しました：極端なアクセント色は正規化され、文字の色相が派生に使われ、暗いモジュール面は到達可能な上限でコントラストを報告します。',
        dismiss: '了解',
        explainClamp: 'アクセント色を正規化しました：{from} → {to}（ボタンとチェックの可読性のため）',
        explainLink: 'リンクを可読性のため暗くしました：{ratio}:1（目標 {target}:1）',
        preview: 'プレビュー',
        sample: 'サンプルを試す',
        copyDiag: '診断をコピー',
        contrast: 'コントラスト',
        contrastSub: '実測 / 目標（面ごと；※ 判定外・△ 面の上限）',
        cMain: '本文',
        cSecondary: '副次',
        cTertiary: '三次',
        cLink: 'リンク',
        cLimited: '面の上限',
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
        hcSub: '本文の下限を AAA に近づけます（本文 ≥15、副次 ≥9、三次 ≥7）。暗いモジュール面は表面の明るさで上限が決まります。',
      },
    }

    /** 配色名与各档位的显示名：id 不变，只换文案。 */
    const LABELS = {
      'zh-CN': {
        scheme: { mono: '黑白', warm: '暖砂', indigo: '靛蓝', moss: '苔绿', custom: '自定义' },
        desc: { mono: '无色调 · 默认', warm: '米白 + 棕调', indigo: '冷白 + 蓝调', moss: '浅灰绿 + 绿调', custom: '三色派生 · 你的配色' },
        text: { neutral: '静', tinted: '标准', deep: '浓' },
        sidebar: { light: '更浅', match: '同色', deep: '更深' },
        rightbar: { sidebar: '同左栏', canvas: '跟随画布' },
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
        rightbar: { sidebar: '同左欄', canvas: '跟隨畫布' },
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
        rightbar: { sidebar: 'Match sidebar', canvas: 'Follow canvas' },
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
        rightbar: { sidebar: 'サイドバー', canvas: 'キャンバス' },
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
      const rightbarMode = React.useSyncExternalStore(props.subscribeRightbar, props.getRightbarMode)
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
      const commitHex = (field) => {
        const draft = hexDraft[field]
        const raw = String(draft !== undefined ? draft : customColors[field]).trim()
        if (HEX_RE.test(raw)) {
          props.setCustomColor(field, raw)
          setHexDraft(Object.assign({}, hexDraft, { [field]: undefined }))
          setHexError(Object.assign({}, hexError, { [field]: false }))
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
            const invalid = hexError[field] === true
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
              'aria-describedby': invalid ? errId : undefined,
              'aria-label': name + ' HEX',
              onChange: (e) => {
                setHexDraft(Object.assign({}, hexDraft, { [field]: e.target.value }))
                if (invalid) setHexError(Object.assign({}, hexError, { [field]: false }))
              },
              onBlur: () => commitHex(field),
              onKeyDown: (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitHex(field) }
                if (e.key === 'Escape') {
                  setHexDraft(Object.assign({}, hexDraft, { [field]: undefined }))
                  setHexError(Object.assign({}, hexError, { [field]: false }))
                  e.currentTarget.blur()
                }
              },
            }),
            invalid && h('span', { id: errId, className: 'dsh-tp-hexerror', role: 'alert' }, txt.badHex))
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
          return h(
            'table',
            { id: 'dsh-tp-matrix-body' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col' }, ''),
              CONTRAST_SURFACES.map((sf) => h('th', { key: sf.id, scope: 'col' }, (sf.label || sf.id) + (sf.scope === false ? '※' : ''))))),
            h('tbody', null, report.rows.map((row) => h('tr', { key: row.role },
              h('th', { scope: 'row' }, roleLabel[row.role] || row.role),
              row.cells.map((cell) => {
                const cls = cell.scope === false ? 'is-limited' : (cell.ok ? 'is-ok' : 'is-bad')
                const mark = cell.scope === false ? ' ※' : (cell.limited ? ' △' : '')
                const text = cell.limited ? cell.ratio.toFixed(2) + ' ≤ ' + cell.claim : cell.ratio.toFixed(2)
                return h('td', {
                  key: cell.mode + cell.surface,
                  className: cls,
                  'data-role': row.role,
                  'data-surface': cell.surface,
                  'data-mode': cell.mode,
                  title: cell.limited ? txt.cLimited + ' ≤ ' + cell.claim : txt.contrast + ' ' + text,
                }, text + mark)
              })))))
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
        row('rightbar', txt.rightbar, txt.rightbarSub, seg(RIGHTBAR_MODES, rightbarMode, props.setRightbarMode, lb.rightbar, rowId('rightbar'))),
        health && !health.ok && h('p', { className: 'dsh-tp-status is-bad' }, txt.bad),
        health && health.ok && health.reapplies > 0 && h(
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

    // 开发期接口：palette-dev.mjs 通过它拿到同一套引擎（避免「报表好看、上线不一样」）
    if (DEV_OPT_IN && typeof window !== 'undefined' && typeof window.__DSH_THEME_PALETTE_DEV__ === 'function') {
      window.__DSH_THEME_PALETTE_DEV__({ buildTokens, SCHEMES, SIDEBAR_MODES, TEXT_MODES, RIGHTBAR_MODES, SCROLL_MODES, CONTROL_MODES, MD_MODES, HC_MODES, contrast, toOklch, fromOklch, flatten, rampsFor, floors, encodeConfig, decodeConfig, customScheme, readCustom, writeCustom, CONTRAST_SURFACES, CONTRAST_ROLES, settingsCss: SETTINGS_CSS, cardColors })
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
        let rightbarMode = readRightbarStored()
        let scrollMode = readScrollStored()
        let controlMode = readControlStored()
        let mdMode = readMdStored()
        let hcMode = readHcStored()
        const getConfigCode = () => encodeConfig({ palette: current, sidebar: sidebarMode, text: textMode, rightbar: rightbarMode, scroll: scrollMode, control: controlMode, md: mdMode, hc: hcMode, lang: langPref })
        let langPref = readLangPref()
        const localeListeners = new Set()
        const currentLocale = () => pickLocale(langPref)
        const emitLocale = () => { for (const fn of localeListeners) { try { fn() } catch (err) { /* 忽略 */ } } }
        const listeners = new Set()
        const sidebarListeners = new Set()
        const textListeners = new Set()
        const rightbarListeners = new Set()
        const scrollListeners = new Set()
        const controlListeners = new Set()
        const mdListeners = new Set()
        const hcListeners = new Set()
        const customListeners = new Set()

        const getCurrent = () => current
        const getSidebarMode = () => sidebarMode
        const getTextMode = () => textMode
        const getRightbarMode = () => rightbarMode
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
        const subscribeRightbar = (fn) => {
          rightbarListeners.add(fn)
          return () => { rightbarListeners.delete(fn) }
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
        const emitRightbar = () => { for (const fn of rightbarListeners) { try { fn() } catch (err) { /* 同理 */ } } }
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

        const applyAll = (reason) => {
          const scheme = SCHEMES.find((s) => s.id === current) || SCHEMES[0]
          const tokens = buildTokens(scheme, sidebarMode, textMode, rightbarMode, scrollMode, controlMode, mdMode, hcMode === 'on')
          let next = () => {}
          if (tokens !== undefined) {
            try {
              next = theme.overrideTokens(OVERRIDE_SOURCE, tokens)
            } catch (err) {
              console.warn('[dsh-theme-palette] 应用配色失败：', err)
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

        const ensureApplied = (reason) => {
          if (lastTokens === null || healDisabled) return
          if (Date.now() - lastAppliedAt < 900) return
          const wait = HEAL_BACKOFF[Math.min(healFails, HEAL_BACKOFF.length - 1)]
          if (healFails > 0 && Date.now() - lastHealAt < wait) return
          lastHealAt = Date.now()
          let missing = false
          try {
            const style = getComputedStyle(document.body)
            for (const name of TOKEN_PROBE) {
              if (!(name in lastTokens)) continue
              if (style.getPropertyValue(name).trim() === '') { missing = true; break }
            }
          } catch (err) {
            missing = true
          }
          if (!missing) {
            healFails = 0
            return
          }
          if (healFails >= HEAL_BACKOFF.length) {
            healDisabled = true
            console.error('[dsh-theme-palette] 配色层反复失效（' + reapplyCount + ' 次），已停止自动重放；请检查宿主 token 是否改名')
            return
          }
          healFails += 1
          reapplyCount += 1
          console.info('[dsh-theme-palette] 配色层不见了（' + reason + '），已重放第 ' + reapplyCount + ' 次')
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
        /** 下一帧再读（presenter 把 token 写到 body 需要一个提交周期）。 */
        const scheduleProbe = (tokens) => {
          if (tokens === undefined) return
          const run = () => {
            const next = probeApplied(tokens)
            if (next === null) return
            if (health !== null && health.ok === next.ok && health.checked === next.checked
              && String(health.mismatched) === String(next.mismatched)) return
            health = { ...next, reapplies: reapplyCount }
            if (!next.ok) console.warn('[dsh-theme-palette] 有 token 没写进 body，宿主可能改名了')
            emitHealth()
          }
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
        const setRightbarMode = (id) => {
          if (!RIGHTBAR_MODES.some((m) => m.id === id)) return
          rightbarMode = id
          writeRightbarStored(id)
          applyAll()
          emitRightbar()
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
          rightbarMode = cfg.rightbar
          scrollMode = cfg.scroll
          controlMode = cfg.control
          mdMode = cfg.md
          hcMode = cfg.hc
          langPref = cfg.lang
          if (cfg.custom) writeCustom(cfg.custom)
          writeStored(current)
          writeSidebarStored(sidebarMode)
          writeTextStored(textMode)
          writeRightbarStored(rightbarMode)
          writeScrollStored(scrollMode)
          writeControlStored(controlMode)
          writeMdStored(mdMode)
          writeHcStored(hcMode)
          writeLangPref(langPref)
          applyAll('import')
          emit(); emitSidebar(); emitText(); emitRightbar(); emitScroll(); emitControl(); emitMd(); emitHc(); emitLocale()
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
          const t = buildTokens(scheme, sidebarMode, textMode, rightbarMode, scrollMode, controlMode, mdMode, hc)
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
          settings: { palette: current, sidebar: sidebarMode, text: textMode, rightbar: rightbarMode, scroll: scrollMode, control: controlMode, md: mdMode, hc: hcMode, lang: langPref },
          report: getContrastReport(),
        })
        const previewConfigCode = (code) => {
          const cfg = decodeConfig(code)
          return cfg ? { ok: true, config: cfg } : { ok: false }
        }
        /**
         * 对比度矩阵（R1）：把"前景 × 承载面"的真实读数露出来。
         *
         * 覆盖当前选中的配色（含全部预设，不只自定义）；每个格子给出
         * 实测 ratio、声明目标 claim、以及是否"表面受限"（claim 高于该面物理上限）。
         * 口径与 palette-dev 完全一致：同一个 CONTRAST_SURFACES、同一套 floors。
         */
        const getContrastReport = () => {
          const scheme = SCHEMES.find((s) => s.id === current) || SCHEMES[0]
          const hc = hcMode === 'on'
          const F = floors(hc)
          const t = buildTokens(scheme, sidebarMode, textMode, rightbarMode, scrollMode, controlMode, mdMode, hc)
          const round2 = (v) => Math.round(v * 100) / 100
          const rows = CONTRAST_ROLES.map((role) => ({
            role: role.id,
            cells: CONTRAST_SURFACES.map((sf) => {
              const fgHex = role.id === 'link'
                ? t['--dsw-alias-link'][sf.mode]
                : t['--dsw-static-neutral-bluish-' + role.step[sf.mode]][sf.mode]
              const bg = sf.token
                ? flatten(t[sf.token][sf.mode], t['--dsw-static-neutral-bluish-' + (sf.mode === 'light' ? '00' : '950')][sf.mode])
                : t['--dsw-static-neutral-bluish-' + sf.id][sf.mode]
              const ratio = contrast(fgHex, bg)
              const claim = sf.mode === 'light' ? F[role.id] : (role.id === 'link' ? F.linkDark : F[role.id])
              const ceiling = contrast(sf.mode === 'light' ? '#000000' : '#ffffff', bg)
              const limited = ceiling < claim / 0.93
              const feasible = limited ? ceiling * 0.93 : claim
              return {
                surface: sf.id, mode: sf.mode, scope: sf.scope,
                ratio: round2(ratio), claim, limited,
                ok: sf.scope !== false && ratio >= feasible - 0.02,
              }
            }),
          }))
          return { hc, mono: !scheme.tinted, rows }
        }
        /**
         * 「试试示例」用的演示短码：现场用生产 encodeConfig 生成，schema 演进时自动跟随，
         * 不存在"README 里的示例码过期"这类手写漂移。三色刻意非默认组合，便于验证三色真的生效。
         */
        const getSampleCode = () => encodeConfig({
          palette: 'custom', sidebar: 'deep', text: 'tinted', rightbar: 'sidebar',
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
              setRightbarMode,
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
          const removeStyle = installRightbarStyle()
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
                getRightbarMode,
                subscribeRightbar,
                setRightbarMode,
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
