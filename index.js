/**
 * dsh-theme-palette —— Host 半边。
 *
 * 配色全部发生在浏览器端（见 client.js）：挤进官方 ThemeRuntime 的 token 覆盖层，
 * 由 ui-layout 的 ThemePresenter 负责落到 document.body。Host 侧没有要做的事，
 * 也不能在这里读 DOM。
 *
 * 保留这个入口是因为 bundle 的 cordis.patch.yml 需要一行可加载的插件；
 * dsh.client 段会让客户端加载 ./client.js。
 */

/** 与 cordis.patch.yml 的 insert id 保持一致。 */
export const name = 'dsh-theme-palette'

/** Host 侧无行为。 */
export function apply() {}
