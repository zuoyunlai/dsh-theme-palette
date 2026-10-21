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

    const PLUGIN_VERSION = '1.4.2'
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
        hue: 84, darkHue: 60, lightC: 0.030, midC: 0.010, textC: 0.004,
        darkC: 0.014, darkLift: 0.026, paperC: 0.014, // 深底 #1e1b14 L 0.223 / 30% 色域
        accentHue: 60, accentC: 0.101, accentL: 0.58, // 标准色 #A9683E
        accentScale: 1.0,
      },
      {
        id: 'indigo', label: '靛蓝', desc: '冷白 + 蓝调', tinted: true,
        hue: 266, lightC: 0.020, midC: 0.010, textC: 0.004,
        darkC: 0.028, darkLift: 0.032, paperC: 0.009, // 深底 #161c2a L 0.227 / 19% 色域
        accentHue: 259, accentC: 0.107, accentL: 0.5108, // 标准色 #3F66A3
        accentScale: 1.0,
      },
      {
        id: 'moss', label: '苔绿', desc: '浅灰绿 + 绿调', tinted: true,
        hue: 162, lightC: 0.016, midC: 0.010, textC: 0.004,
        darkC: 0.015, darkLift: 0.042, paperC: 0.0125, // 深底 #1a211b L 0.239 / 24% 色域
        accentHue: 139, accentC: 0.096, accentL: 0.5335, // 标准色 #4F7A42
        accentScale: 1.0,
      },
    ]

    /* 对比度下限：主文本 16 / 次文本 6 / 三级文本 4.6（AA）/ 链接 4.6 */
    /* 对比度下限：按**真实承载面**定（卡层/模块层比画布更难达标），不是按画布定。
       正文 15.5 / 次级 6.2 / 三级 4.62（AA）/ 链接 4.62（AA） */
    const MIN_MAIN = 12
    const MIN_SECONDARY = 6.2
    const MIN_TERTIARY = 4.62
    const MIN_LINK = 4.62
    const MIN_LINK_DARK = 4.62

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
     * 具体颜色由 token 层给的 --dsh-rightbar-fill 决定（默认直接引用左栏 token）。
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
        const lifted = role === 'dark' ? L + scheme.darkLift : L + liftText
        // 深色层单独给色相：暖砂的 88° 是「黄」，在 L≈0.22 的暗部读成橄榄绿；
        // 换成 60°（橙棕）才是咖啡色。浅色侧仍是 88°（米白）。
        const hue = role === 'dark' && scheme.darkHue !== undefined ? scheme.darkHue : scheme.hue
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
     * 对比度求解：前景达不到 target 就沿亮度往「离背景更远」的方向微调，
     * 最多挪 0.09（保持原有明暗层次，不把正文推成纯黑）。
     */
    function solveForeground(hexes, step, bgHex, target) {
      const [L0, C, hue] = toOklch(hexes[step])
      const darker = luminance(hexes[step]) < luminance(bgHex)
      let L = L0
      for (let i = 0; i < 40; i++) {
        const candidate = fromOklch(L, C, hue)
        if (contrast(candidate, bgHex) >= target) return candidate
        L += darker ? -0.004 : 0.004
        // 上限 0.13：三级文字要从 4.41 抬到 4.62 需要 ΔL≈0.096，旧的 0.09 会静默截断
        if (Math.abs(L - L0) > 0.13) break
      }
      return fromOklch(L, C, hue)
    }

    function tuneRamps(ramps, scheme) {
      // 靶点必须用**真实承载面**，不能用画布：三级文字与链接大量落在卡层(60)、
      // 悬浮层(150)、深色模块层(800)上，只对 00/950 求解会得到「画布达标、卡层不达标」。
      const lightCanvas = ramps.bluish['00']
      const lightCard = ramps.bluish['60']
      const darkCanvas = ramps.bluish['950']
      const darkModule = ramps.bluish['800']
      const jobs = [
        ['1000', lightCanvas, MIN_MAIN],
        ['700', lightCard, MIN_SECONDARY],
        ['600', lightCard, MIN_TERTIARY],
        ['400', darkModule, MIN_TERTIARY],
      ]
      for (const [step, bg, target] of jobs) {
        if (contrast(ramps.bluish[step], bg) >= target) continue
        ramps.bluish[step] = solveForeground(ramps.bluish, step, bg, target)
      }
      // 链接按「最亮的深色承载面（800）」兜底。
      // 注意这里**只有 400**：浅色链接不走这条色阶的中段（500 是设计稿的标准色，
      // 不能被求解器按承载面改写），浅色链接在 aliasOverrides 里从 500 派生。
      if (contrast(ramps.deepseek['400'], darkModule) < MIN_LINK_DARK) {
        ramps.deepseek['400'] = solveForeground(ramps.deepseek, '400', darkModule, MIN_LINK_DARK)
      }
      return ramps
    }

    /**
     * 浅色链接：从品牌基准色（`deepseek-500`）派生一条够 AA 的色。
     *
     * 为什么不能直接用 500：设计稿给的标准值（暖砂 `#A9683E`）在浅色悬浮面 `150` 上只有
     * 3.46:1、画布上 4.06 —— 那是「品牌色」不是「链接色」。链接要 4.62 起，所以同色相同色度、
     * 明度往远处收，收到达标为止（最多 0.13，与其它求解一致）。
     * 这样宿主里 500 的其它用途（info 按钮填充、焦点环、deep-diving 文字、卡片预览色）
     * 全部保持标准值，只有「当文字用」的链接换一条。
     */
    function lightLink(r) {
      if (r === BASE) return BASE.deepseek['500'] // 黑白配色没被覆盖，走宿主原值
      const bg = r.bluish['150']
      if (contrast(r.deepseek['500'], bg) >= MIN_LINK) return r.deepseek['500']
      return solveForeground(r.deepseek, '500', bg, MIN_LINK)
    }

    /* ================= token 组装 ================= */
    /** 重建结果缓存：一个配色只算一次（渲染时每张卡片都会取预览色）。 */
    const rampCache = new Map()
    function scalesFor(textMode) {
      const m = TEXT_MODES.find((x) => x.id === textMode) || TEXT_MODES[1]
      return { textScale: m.textScale, paperScale: m.paperScale, textLift: m.textLift || 0 }
    }
    function rampsFor(scheme, textMode) {
      // 黑白配色：色相/色度都是 0，但**仍然过一次引擎** —— 否则它会保留宿主的三级 3.71、
      // 链接 4.23（都没到 AA），而它正是默认配色。引擎在这里只做两件事：原样重建（C=0）+ 求解对比度。
      if (!scheme.tinted) {
        const monoKey = 'mono:aa'
        let mono = rampCache.get(monoKey)
        if (mono === undefined) {
          const clone = (o) => Object.fromEntries(Object.entries(o))
          mono = tuneRamps(
            { bluish: clone(BASE.bluish), neutral: clone(BASE.neutral), deepseek: clone(BASE.deepseek), blue: clone(BASE.blue) },
            scheme,
          )
          rampCache.set(monoKey, mono)
        }
        return mono
      }
      const key = scheme.id + ':' + textMode
      let cached = rampCache.get(key)
      if (cached === undefined) {
        cached = tuneRamps(buildRamps(scheme, scalesFor(textMode)), scheme)
        rampCache.set(key, cached)
      }
      return cached
    }

    /**
     * 字面量别名的染色表：这些 token 在官方样式表里是写死的 rgba，
     * 不跟着色阶走，必须单独覆盖，否则暖底上会出现冷灰发丝线。
     * 值按「浅色 / 深色」给一对（overrideTokens 的硬性要求）。
     */
    function aliasOverrides(r) {
      const ink = r.bluish['1000'] // 浅色模式的墨色
      const paper = r.bluish['50'] // 深色模式的纸白
      const grey = r.bluish['700'] // 悬浮在媒体上的工具条用中性灰
      return {
        /* ---- 链接：唯一一条「不是标准色、而是从标准色派生」的强调色 ----
           宿主 `--dsw-alias-link` 指 deepseek-500（浅）/ 400（深），而 500 是品牌基准色。
           标准值当正文链接时过不了 AA（暖砂 #A9683E 在 150 面上 3.46），所以浅色链接
           用同色相的派生色；深色链接直接用 400（已由求解器兜到 4.62 起）。 */
        '--dsw-alias-link': { light: lightLink(r), dark: r.deepseek['400'] },

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
        '--dsw-alias-menu-group-header-fill': {
          // 用 60 而不是 50：50 现在是「深色模式正文」的色度，拿去当浅色菜单头会偏艳
          light: withAlpha(r.bluish['60'], 0.94),
          dark: withAlpha(r.bluish['800'], 0.94),
        },
        '--dsw-alias-bg-mask-drop': { light: withAlpha(r.bluish['00'], 0.70), dark: withAlpha(r.bluish['800'], 0.70) },
        // 注释文字：宿主浅色用 400、深色用 600。深色的 600 被「浅色三级文字要 AA」的求解压暗过，
        // 在深底上只剩 3.0:1，所以深色这一侧改用 500（约 6.5:1），浅色保持宿主值。
        '--dsw-alias-label-caption': { light: r.bluish['400'], dark: r.bluish['500'] },
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

    function buildTokens(scheme, sidebarMode, textMode, rightbarMode, scrollMode, controlMode, mdMode) {
      const ramps = rampsFor(scheme, textMode || DEFAULT_TEXT)
      const pairs = {}
      if (!scheme.tinted) {
        // 黑白：只输出「被求解改动过」的那几步 + 派生链接，不整条覆盖（保持宿主原貌）
        for (const step of ['400', '600', '700', '1000']) {
          pairs['--dsw-static-neutral-bluish-' + step] = { light: ramps.bluish[step], dark: ramps.bluish[step] }
        }
        pairs['--dsw-static-deepseek-500'] = { light: ramps.deepseek['500'], dark: ramps.deepseek['500'] }
        pairs['--dsw-alias-link'] = { light: lightLink(ramps), dark: BASE.deepseek['400'] }
        // 主按钮同理：宿主浅色是红（对白字 4.34，差 0.16 才到 AA），压暗一档到 4.5
        // 注意：「更浅」档会把画布压到 #fafafa，按钮还要在最暗的那版画布上达标，
        // 所以按 #f5f5f5 兜底而不是纯白。
        const monoBtn = darkenUntil(ramps.deepseek['500'], '#f5f5f5', 4.5)
        pairs['--dsw-alias-button-primary-fill'] = { light: monoBtn, dark: ramps.bluish['1000'] }
      }
      // 其它配色：整条色阶 + 字面量别名覆盖。
      if (scheme.tinted) {
        for (const [family, table] of Object.entries(ramps)) {
          for (const [step, value] of Object.entries(table)) {
            pairs['--dsw-static-' + (family === 'bluish' ? 'neutral-bluish-' : family + '-') + step] = {
              light: value,
              dark: value,
            }
          }
        }
        const aliases = aliasOverrides(ramps)
        for (const [name, pair] of Object.entries(aliases)) pairs[name] = pair
      }
      const sidebar = sidebarTokens(ramps, sidebarMode, scheme.tinted)
      for (const [name, pair] of Object.entries(sidebar)) pairs[name] = pair
      // 右栏底色只给一个间接层：同左栏时直接引用左栏 token，跟随画布时引用画布 token。
      // 主按钮：浅色下宿主把 button-primary-fill 指到 state-error-primary（红），
      // 于是页面上有「红主按钮 + 强调色」两个主色。改成强调色，并压暗到按钮文字 ≥4.5。
      // 黑白配色在上面已经单独设过，这里跳过（它要按「更浅」档的画布兜底）。
      if (scheme.tinted) {
        pairs['--dsw-alias-button-primary-fill'] = {
          light: darkenUntil(ramps.deepseek['500'], ramps.bluish['00'], 4.5),
          dark: ramps.deepseek['400'],
        }
      }
      // 选中卡片的淡底：必须按模式给，原写法（强调色混**浅色**画布）在深色模式下
      // 会得到一张近白卡片，而卡片文字是 label-primary（深色下近白）→ 白底白字。
      const accentHex = ramps.deepseek['500']
      const accentDark = ramps.deepseek['400']
      pairs['--dsh-card-picked'] = {
        light: mixHex(accentHex, ramps.bluish['00'], 0.10),
        dark: mixHex(accentDark, ramps.bluish['950'], 0.16),
      }
      const rightbarFill = rightbarMode === 'canvas'
        ? 'var(--dsw-alias-bg-base)'
        : 'var(--dsw-specific-sidebar-fill)'
      pairs['--dsh-rightbar-fill'] = { light: rightbarFill, dark: rightbarFill }
      // Markdown 强调色：标题 = 正文色混 40% 强调色；加粗 = 混 20%（比标题弱一档）
      if (scheme.tinted) {
        if (mdMode === 'off') {
          const inherit = { light: 'inherit', dark: 'inherit' }
          pairs['--dsh-md-heading'] = inherit
          pairs['--dsh-md-strong'] = inherit
        } else {
          // 加粗：只加色度、不动明度 —— 混色会把正文调亮（浅色下反而比正文更弱）。
          // 标题：再往中间推一点明度（浅色提亮 / 深色压暗），配合更大的字号拉开层级。
          const tintText = (hex, accentHex, extraChroma, lift) => {
            const [L, C] = toOklch(hex)
            const acc = toOklch(accentHex)
            return fromOklch(clamp(L + lift, 0.05, 0.97), C + acc[1] * extraChroma, acc[2])
          }
          pairs['--dsh-md-heading'] = {
            light: tintText(ramps.bluish['1000'], ramps.deepseek['500'], 0.45, 0.065),
            dark: tintText(ramps.bluish['50'], ramps.deepseek['400'], 0.40, -0.030),
          }
          pairs['--dsh-md-strong'] = {
            light: tintText(ramps.bluish['1000'], ramps.deepseek['500'], 0.32, 0.012),
            dark: tintText(ramps.bluish['50'], ramps.deepseek['400'], 0.32, -0.010),
          }
        }
      }
      // 代码块底色：宿主用 bg-layer-1，浅色下与画布同色（都指 00）→ 看不出边界。
      // 这里给它一档独立的"内嵌面板"色：卡层色 + 少量强调色相，保证与画布有可辨差。
      // mixHex(a, b, w) = a*w + b*(1-w)：a 是要掺进去的颜色，b 是底色。
      pairs['--dsh-code-fill'] = {
        light: mixHex(ramps.deepseek['500'], ramps.bluish['60'], 0.08),
        dark: mixHex(ramps.deepseek['400'], ramps.bluish['875'], 0.10),
      }
      pairs['--dsh-code-inline'] = {
        light: mixHex(ramps.deepseek['500'], ramps.bluish['50'], 0.05),
        dark: mixHex(ramps.deepseek['400'], ramps.bluish['900'], 0.07),
      }
      const scroll = scrollbarTokens(ramps, scheme, scrollMode)
      for (const [name, pair] of Object.entries(scroll)) pairs[name] = pair
      // 开关/勾选/单选的共用支点：brand-primary 本来是近黑/近白，改成强调色。
      if (controlMode === 'accent') {
        pairs['--dsw-alias-brand-primary'] = { light: ramps.deepseek['500'], dark: ramps.deepseek['400'] }
      }
      // 黑白配色的浅色画布本身就是纯白，「更浅」无处可提 —— 改成把会话区压一档浅灰，
      // 侧栏保持纯白，同样得到区块层次（这是唯一需要动画布的情形）。
      if (!scheme.tinted && sidebarMode === 'light') {
        pairs['--dsw-static-neutral-bluish-00'] = { light: '#fafafa', dark: BASE.bluish['00'] }
      }
      return pairs
    }

    /* ================= 卡片预览色 ================= */
    function swatches(scheme, textMode) {
      if (!scheme.tinted) return ['#ffffff', '#e5e5e5', '#0f1115']
      const r = rampsFor(scheme, textMode || DEFAULT_TEXT)
      return [r.bluish['00'], r.bluish['100'], r.deepseek['500']]
    }


    /** 卡片缩略图用的一小组颜色（画布/侧栏/文字/强调），按当前强度档取。 */
    function cardColors(scheme, textMode) {
      const r = rampsFor(scheme, textMode || DEFAULT_TEXT)
      if (!r) {
        return {
          light: { canvas: '#ffffff', side: '#f7f7f7', text: '#0f1115', accent: '#4176e6' },
          dark: { canvas: '#151517', side: '#1b1b1c', text: '#f9fafb', accent: '#7aaaff' },
        }
      }
      const side = sidebarTokens(r, DEFAULT_SIDEBAR, scheme.tinted)
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
    const RIGHTBAR_CSS = [
      '[data-rightbar-col]{background:var(--dsh-rightbar-fill,var(--dsw-alias-bg-base))}',
      '[data-rightbar-fullscreen] [data-rightbar-col]{background:var(--dsw-alias-bg-base)}',
      // Markdown 标题/加粗：容器类是 CSS Modules 的 `_markdown_<hash>_<n>`，
      // 用「类名里含 _markdown_」做钩子（局部名稳定，比整串哈希耐版本）。
      '[class*="_markdown_"] :where(h1,h2,h3,h4,h5,h6){color:var(--dsh-md-heading,inherit)}',
      '[class*="_markdown_"] strong{color:var(--dsh-md-strong,inherit)}',
      // 代码块：宿主把底色写在 CSS Modules 的 .block 上（浅色与画布同为 00，看不出边界）。
      // 这里以 `.md-code-block` 提高一级特异性覆盖，不需要 !important。
      '[class*="_markdown_"] .md-code-block{background:var(--dsh-code-fill,inherit)}',
      '[class*="_markdown_"] :not(pre) > code{background:var(--dsh-code-inline,inherit)}',
    ].join('')

    /* ================= 设置页样式（head 里第二条 CSS） ================= */
    const SETTINGS_STYLE_ID = 'dsh-theme-palette/settings.css'
    const SETTINGS_CSS = `
.dsh-tp{display:flex;flex-direction:column;gap:14px;width:100%;color:var(--dsw-alias-label-primary);box-sizing:border-box}
.dsh-tp-head{display:flex;align-items:center;gap:8px}
.dsh-tp-head h2{margin:0;font-size:18px;font-weight:600;letter-spacing:.2px}
.dsh-tp-badge{margin-left:auto;font:11px/1.7 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;padding:0 8px}
.dsh-tp-sub{margin:-6px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-tp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media (max-width:620px){.dsh-tp-grid{grid-template-columns:1fr}}
.dsh-tp-card{position:relative;display:flex;flex-direction:column;gap:8px;text-align:left;font:inherit;cursor:pointer;padding:9px;border-radius:14px;border:.5px solid var(--dsw-alias-border-l4);background:transparent;transition:background .12s ease,border-color .12s ease}
.dsh-tp-card:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-tp-card.is-on{background:var(--dsh-card-picked,var(--dsw-alias-bg-module-platform));border-color:var(--t-accent-l)}
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
.dsh-tp-card-name{font-size:13.5px;font-weight:500}
.dsh-tp-card-desc{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-check{position:absolute;top:7px;right:7px;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;background:var(--t-accent-l);color:var(--t-canvas-l);opacity:0;transition:opacity .12s ease}
body[data-ds-dark-theme] .dsh-tp-check{background:var(--t-accent-d);color:var(--t-canvas-d)}
.dsh-tp-card.is-on .dsh-tp-check{opacity:1}
.dsh-tp-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsh-tp-row-label{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-tp-row-label b{font-size:13.5px;font-weight:500}
.dsh-tp-row-label span{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:16px}
.dsh-tp-seg{display:inline-flex;gap:2px;padding:2px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);flex:none}
.dsh-tp-seg button{font:inherit;font-size:12.5px;line-height:20px;cursor:pointer;border:0;border-radius:8px;padding:5px 12px;background:transparent;color:var(--dsw-alias-label-secondary);white-space:nowrap;transition:background .12s,color .12s}
.dsh-tp-seg button:hover{color:var(--dsw-alias-label-primary)}
.dsh-tp-seg button.is-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.10)}
@media (max-width:520px){.dsh-tp-row{flex-direction:column;align-items:stretch;gap:8px}.dsh-tp-seg{justify-content:space-between}.dsh-tp-seg button{flex:1;text-align:center}}
.dsh-tp-more{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-tertiary);background:0 0;border:0;padding:6px 0 2px;cursor:pointer;align-self:flex-start;transition:color .12s}
.dsh-tp-more:hover{color:var(--dsw-alias-label-primary)}
.dsh-tp-adv{display:flex;flex-direction:column}
.dsh-tp-status{margin:0;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-tp-status.is-bad{color:var(--dsw-alias-state-error-primary)}
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
      '--dsw-static-neutral-bluish-1000',
      '--dsw-alias-link',
      '--dsw-specific-sidebar-fill',
      '--dsw-alias-label-caption',
    ]

    function probeApplied(tokens) {
      try {
        if (typeof getComputedStyle !== 'function') return null
        const style = getComputedStyle(document.body)
        let checked = 0
        let ok = true
        for (const name of TOKEN_PROBE) {
          if (!(name in tokens)) continue
          checked++
          if (style.getPropertyValue(name).trim() === '') ok = false
        }
        return checked === 0 ? null : { ok, checked }
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
        mdHint: '标题与加粗用「正文色混强调色」，比正文更有色；关掉则与正文同色。',
        control: '开关 / 勾选',
        controlHint: '宿主的开关、复选框、单选都压在近黑/近白上；开启后改用强调色。',
        scroll: '滚动条',
        scrollHint: '默认中性灰；「跟随」上配色色相，「强调」用强调色。明暗关系不变。',
        scrollHintMono: '当前是黑白配色，没有色相可跟随，滚动条保持中性灰。',
        rightbar: '右侧栏底色',
        rightbarHint: '右栏本来没有自己的背景，露的是会话区画布色。',
        advanced: '更多选项',
        textSub: '正文与强调的着色程度',
        sidebarSub: '相对会话区的层次',
        rightbarSub: '面板底色',
        mdSub: '标题与加粗是否着色',
        scrollSub: '滚动条与滑轨的色相',
        controlSub: '开关与复选框是否跟强调色',
        langSub: '自动跟随宿主界面语言',
        surface: '面板表面',
        surfaceHint: '决定侧栏与右栏相对会话区是「浮起」还是「凹陷」。',
        ok: '✓ 配色已生效',
        bad: '⚠ 部分 token 未生效（宿主可能改名），请查看控制台',
        healed: '配色层被宿主丢过一次，已自动恢复 ',
        healedSuffix: ' 次',
        text: '强度',
        textHint: '让正文/次级文字带配色色味；三档都满足 AA。',
        sidebar: '左侧栏底色',
        sidebarHint: '让侧栏比会话区更浅（或更深），做出区块层次。',
        lang: '语言',
      },
      'zh-TW': {
        nav: '主題色',
        hint: '配色與明暗模式獨立；切換後立即生效並存在 localStorage。',
        md: 'Markdown 強調',
        mdHint: '標題與粗體用「本文色混強調色」，比本文更有色；關掉則與本文同色。',
        control: '開關 / 勾選',
        controlHint: '宿主開關、核取方塊、單選都用近黑/近白；開啟後改用強調色。',
        scroll: '捲軸',
        scrollHint: '預設中性灰；「跟隨」上配色色相，「強調」用強調色。明暗關係不變。',
        scrollHintMono: '目前是黑白配色，沒有色相可跟隨，捲軸保持中性灰。',
        rightbar: '右側欄底色',
        rightbarHint: '右欄本來沒有自己的背景，露的是會話區畫布色。',
        advanced: '更多選項',
        textSub: '本文與強調的著色程度',
        sidebarSub: '相對會話區的層次',
        rightbarSub: '面板底色',
        mdSub: '標題與粗體是否著色',
        scrollSub: '捲軸與軌道的色相',
        controlSub: '開關與核取方塊是否跟強調色',
        langSub: '自動跟隨宿主介面語言',
        surface: '面板表面',
        surfaceHint: '決定側欄與右欄相對會話區是「浮起」還是「凹陷」。',
        ok: '✓ 配色已生效',
        bad: '⚠ 部分 token 未生效（宿主可能改名），請看主控台',
        healed: '配色層被宿主丟棄過一次，已自動恢復 ',
        healedSuffix: ' 次',
        text: '強度',
        textHint: '讓本文/次級文字帶配色色味；三檔都符合 AA。',
        sidebar: '左側欄底色',
        sidebarHint: '讓側欄比會話區更淺（或更深），做出區塊層次。',
        lang: '語言',
      },
      en: {
        nav: 'Color theme',
        hint: 'Independent of light/dark mode. Applies immediately and is saved to localStorage.',
        md: 'Markdown emphasis',
        mdHint: 'Headings and bold mix the accent into body colour; off keeps them identical to body text.',
        control: 'Switches / checks',
        controlHint: 'Switches, checkboxes and radios use near-black/white in the host. Turn this on to use the accent colour.',
        scroll: 'Scrollbars',
        scrollHint: 'Neutral grey by default. Tint follows the palette hue; Accent uses the accent colour. Lightness is unchanged.',
        scrollHintMono: 'Monochrome has no hue to follow; scrollbars stay neutral.',
        rightbar: 'Right panel surface',
        rightbarHint: 'The right panel has no fill of its own; it shows the canvas.',
        advanced: 'More options',
        textSub: 'How strongly text follows the palette',
        sidebarSub: 'Layer relative to the conversation',
        rightbarSub: 'Panel surface',
        mdSub: 'Tint headings and bold',
        scrollSub: 'Hue of the scrollbar',
        controlSub: 'Switches and checkboxes',
        langSub: 'Follow the host interface language',
        surface: 'Panel surfaces',
        surfaceHint: 'Whether the sidebars sit above or below the conversation area.',
        ok: '✓ Palette applied',
        bad: '⚠ Some tokens did not apply (host may have renamed them); check the console',
        healed: 'Palette layer was dropped by the host; restored ',
        healedSuffix: 'x',
        text: 'Strength',
        textHint: 'Tints body and secondary text toward the palette; all three levels meet AA.',
        sidebar: 'Sidebar surface',
        sidebarHint: 'Makes the sidebar lighter (or deeper) than the conversation area.',
        lang: 'Language',
      },
      ja: {
        nav: 'カラーテーマ',
        hint: 'ライト/ダークとは独立です。変更は即時反映され、localStorage に保存されます。',
        md: 'Markdown の強調',
        mdHint: '見出しと太字にアクセント色を混ぜます。オフにすると本文と同じ色になります。',
        control: 'スイッチ / チェック',
        controlHint: 'ホストのスイッチ・チェックボックスはほぼ白黒です。オンにするとアクセント色になります。',
        scroll: 'スクロールバー',
        scrollHint: '既定はニュートラルグレー。「追従」でテーマの色相、「アクセント」でアクセント色になります。',
        scrollHintMono: 'モノクロには色相がないため、スクロールバーはグレーのままです。',
        rightbar: '右パネルの背景',
        rightbarHint: '右パネルは独自の背景を持たず、キャンバス色が見えています。',
        advanced: 'その他のオプション',
        textSub: '本文と強調の色づき具合',
        sidebarSub: '会話エリアとの段差',
        rightbarSub: 'パネルの背景',
        mdSub: '見出しと太字を色づけする',
        scrollSub: 'スクロールバーの色相',
        controlSub: 'スイッチとチェックの色',
        langSub: 'ホストの表示言語に合わせます',
        surface: 'パネル表面',
        surfaceHint: 'サイドバーが会話エリアより浮くか沈むかを決めます。',
        ok: '✓ 配色を適用しました',
        bad: '⚠ 一部の token が適用されていません（ホスト側で改名された可能性）。コンソールを確認してください',
        healed: '配色レイヤーがホストに破棄されたため、自動で復元しました（',
        healedSuffix: ' 回）',
        text: '強さ',
        textHint: '本文と副次テキストをテーマ色に寄せます。3 段階とも AA を満たします。',
        sidebar: '左サイドバーの背景',
        sidebarHint: 'サイドバーを会話エリアより明るく（または暗く）して段差を作ります。',
        lang: '言語',
      },
    }

    /** 配色名与各档位的显示名：id 不变，只换文案。 */
    const LABELS = {
      'zh-CN': {
        scheme: { mono: '黑白', warm: '暖砂', indigo: '靛蓝', moss: '苔绿' },
        desc: { mono: '无色调 · 默认', warm: '米白 + 棕调', indigo: '冷白 + 蓝调', moss: '浅灰绿 + 绿调' },
        text: { neutral: '静', tinted: '标准', deep: '浓' },
        sidebar: { light: '更浅', match: '同色', deep: '更深' },
        rightbar: { sidebar: '同左栏', canvas: '跟随画布' },
        scroll: { neutral: '中性', tinted: '跟随', accent: '强调' },
        control: { accent: '主题色', mono: '黑白' },
        md: { on: '着色', off: '同正文' },
        lang: { auto: '自动' },
      },
      'zh-TW': {
        scheme: { mono: '黑白', warm: '暖砂', indigo: '靛藍', moss: '苔綠' },
        desc: { mono: '無色調 · 預設', warm: '米白 + 棕調', indigo: '冷白 + 藍調', moss: '淺灰綠 + 綠調' },
        text: { neutral: '靜', tinted: '標準', deep: '濃' },
        sidebar: { light: '更淺', match: '同色', deep: '更深' },
        rightbar: { sidebar: '同左欄', canvas: '跟隨畫布' },
        scroll: { neutral: '中性', tinted: '跟隨', accent: '強調' },
        control: { accent: '主題色', mono: '黑白' },
        md: { on: '著色', off: '同本文' },
        lang: { auto: '自動' },
      },
      en: {
        scheme: { mono: 'Mono', warm: 'Warm sand', indigo: 'Indigo', moss: 'Moss' },
        desc: { mono: 'Neutral · default', warm: 'Cream + brown', indigo: 'Cool white + blue', moss: 'Grey-green' },
        text: { neutral: 'Quiet', tinted: 'Standard', deep: 'Strong' },
        sidebar: { light: 'Lighter', match: 'Same', deep: 'Deeper' },
        rightbar: { sidebar: 'Match sidebar', canvas: 'Follow canvas' },
        scroll: { neutral: 'Neutral', tinted: 'Tint', accent: 'Accent' },
        control: { accent: 'Accent', mono: 'Mono' },
        md: { on: 'Tinted', off: 'Body colour' },
        lang: { auto: 'Auto' },
      },
      ja: {
        scheme: { mono: 'モノクロ', warm: 'ウォームサンド', indigo: 'インディゴ', moss: 'モスグリーン' },
        desc: { mono: '色なし · 既定', warm: 'クリーム + ブラウン', indigo: 'クールホワイト + ブルー', moss: 'グレーグリーン' },
        text: { neutral: '控えめ', tinted: '標準', deep: '強め' },
        sidebar: { light: '明るく', match: '同じ', deep: '暗く' },
        rightbar: { sidebar: 'サイドバーに合わせる', canvas: 'キャンバスに従う' },
        scroll: { neutral: 'ニュートラル', tinted: '追従', accent: 'アクセント' },
        control: { accent: 'アクセント', mono: 'モノクロ' },
        md: { on: '色づけ', off: '本文と同じ' },
        lang: { auto: '自動' },
      },
    }

    /* ================= 设置页（左侧导航独立一节） ================= */
    function PaletteSection(props) {
      const current = React.useSyncExternalStore(props.subscribe, props.getCurrent)
      const sidebarMode = React.useSyncExternalStore(props.subscribeSidebar, props.getSidebarMode)
      const textMode = React.useSyncExternalStore(props.subscribeText, props.getTextMode)
      const rightbarMode = React.useSyncExternalStore(props.subscribeRightbar, props.getRightbarMode)
      const scrollMode = React.useSyncExternalStore(props.subscribeScroll, props.getScrollMode)
      const controlMode = React.useSyncExternalStore(props.subscribeControl, props.getControlMode)
      const mdMode = React.useSyncExternalStore(props.subscribeMd, props.getMdMode)
      const health = React.useSyncExternalStore(props.subscribeHealth, props.getHealth)
      const [advanced, setAdvanced] = React.useState(false)
      const locale = React.useSyncExternalStore(props.subscribeLocale, props.getLocale)
      const langPref = React.useSyncExternalStore(props.subscribeLocale, props.getLangPref)
      const txt = TEXT[locale] || TEXT['zh-CN']
      const lb = LABELS[locale] || LABELS['zh-CN']

      const seg = (modes, value, onPick, labels) => h(
        'div',
        { className: 'dsh-tp-seg', role: 'group' },
        modes.map((mode) => h(
          'button',
          {
            key: mode.id,
            type: 'button',
            className: mode.id === value ? 'is-on' : undefined,
            'aria-pressed': mode.id === value,
            onClick: () => onPick(mode.id),
          },
          (labels && labels[mode.id]) || mode.label,
        )),
      )

      const row = (titleText, subText, control) => h(
        'div',
        { className: 'dsh-tp-row' },
        h('div', { className: 'dsh-tp-row-label' }, h('b', null, titleText), h('span', null, subText)),
        control,
      )

      const card = (scheme) => {
        const picked = scheme.id === current
        const c = cardColors(scheme, textMode)
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
        { className: 'dsh-tp' },
        h('div', { className: 'dsh-tp-head' },
          h('h2', null, txt.nav),
          h('span', { className: 'dsh-tp-badge' }, 'v' + PLUGIN_VERSION)),
        h('p', { className: 'dsh-tp-sub' }, txt.hint),
        h('div', { className: 'dsh-tp-grid' }, SCHEMES.map(card)),
        row(txt.text, txt.textSub, seg(TEXT_MODES, textMode, props.setTextMode, lb.text)),
        row(txt.sidebar, txt.sidebarSub, seg(SIDEBAR_MODES, sidebarMode, props.setSidebarMode, lb.sidebar)),
        row(txt.rightbar, txt.rightbarSub, seg(RIGHTBAR_MODES, rightbarMode, props.setRightbarMode, lb.rightbar)),
        health && !health.ok && h('p', { className: 'dsh-tp-status is-bad' }, txt.bad),
        health && health.ok && health.reapplies > 0 && h(
          'p',
          { className: 'dsh-tp-status' },
          txt.healed + health.reapplies + txt.healedSuffix,
        ),
        h('button', {
          type: 'button',
          className: 'dsh-tp-more',
          'aria-expanded': advanced,
          onClick: () => setAdvanced(!advanced),
        }, (advanced ? '▾ ' : '▸ ') + txt.advanced),
        advanced && h(
          'div',
          { className: 'dsh-tp-adv' },
          row(txt.lang, txt.langSub, seg(LANG_OPTIONS, langPref, props.setLangPref, lb.lang)),
          row(txt.md, txt.mdSub, seg(MD_MODES, mdMode, props.setMdMode, lb.md)),
          row(txt.scroll, current === 'mono' ? txt.scrollHintMono : txt.scrollSub, seg(SCROLL_MODES, scrollMode, props.setScrollMode, lb.scroll)),
          row(txt.control, txt.controlSub, seg(CONTROL_MODES, controlMode, props.setControlMode, lb.control)),
        ),
      )
    }

    /* ================= 插件 ================= */
    // 开发期接口：palette-dev.mjs 通过它拿到同一套引擎（避免「报表好看、上线不一样」）
    if (typeof window !== 'undefined' && typeof window.__DSH_THEME_PALETTE_DEV__ === 'function') {
      window.__DSH_THEME_PALETTE_DEV__({ buildTokens, SCHEMES, SIDEBAR_MODES, TEXT_MODES, RIGHTBAR_MODES, SCROLL_MODES, CONTROL_MODES, MD_MODES, contrast, toOklch, rampsFor, settingsCss: SETTINGS_CSS, cardColors })
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
        let sidebarMode = readSidebarStored()
        let textMode = readTextStored()
        let rightbarMode = readRightbarStored()
        let scrollMode = readScrollStored()
        let controlMode = readControlStored()
        let mdMode = readMdStored()
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

        const getCurrent = () => current
        const getSidebarMode = () => sidebarMode
        const getTextMode = () => textMode
        const getRightbarMode = () => rightbarMode
        const getScrollMode = () => scrollMode
        const getControlMode = () => controlMode
        const getMdMode = () => mdMode
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

        let disposeLayer = () => {}
        /** 按当前配色 + 侧栏档位重建覆盖层（换配色与换侧栏档位走同一条路）。 */
        // 最近一次成功应用的 token 表与原因：自愈时据此重放，也用来解释"为什么又变回去了"。
        let lastTokens = null
        let lastAppliedAt = 0
        let lastReason = 'init'
        let reapplyCount = 0

        const applyAll = (reason) => {
          const scheme = SCHEMES.find((s) => s.id === current) || SCHEMES[0]
          const tokens = buildTokens(scheme, sidebarMode, textMode, rightbarMode, scrollMode, controlMode, mdMode)
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
            if (health !== null && health.ok === next.ok && health.checked === next.checked) return
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
        // 平时只能点界面。暴露一组 setter，让 CDP 的 Runtime.evaluate 能直接调用。
        try {
          const dev = typeof window !== 'undefined' ? window.__DSH_THEME_PALETTE_DEV__ : undefined
          if (dev && typeof dev.attach === 'function') {
            dev.attach({
              setPalette,
              setSidebarMode,
              setTextMode,
              setRightbarMode,
              setScrollMode,
              setControlMode,
              getPreference: () => theme.getTheme().preference,
              setLangPref,
              locales: LOCALES,
              setTheme: (id) => theme.setTheme(id),
              schemes: SCHEMES.map((s) => s.id),
            })
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
          healTimer = setInterval(() => ensureApplied('interval'), 4000)
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
