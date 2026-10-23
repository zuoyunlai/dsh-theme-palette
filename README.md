# dsh-theme-palette

[English](README.md) · [中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

Theme palette for DeepSeek Harness (web & desktop): **4 palettes × light/dark**, two independent axes.

![Settings page: five palettes, strength and panel surfaces](assets/screenshot-settings-light.png)

*Static render of the settings page at the real panel width (564 px content).*

| Dark | Custom palette | High contrast |
|---|---|---|
| ![Dark](assets/screenshot-settings-dark.png) | ![Custom palette](assets/screenshot-settings-custom.png) | ![High contrast](assets/screenshot-settings-hc.png) |

## Compatibility

| Surface | Status |
|---|---|
| DSH desktop / web client | 0.2.x |
| Node.js | ≥ 20 |
| Changes to host source | none |

The plugin only stacks colour tokens through `ctx.theme.overrideTokens`; it does not register a theme, patch the host, or touch the appearance preference.

## What it does

- **4 palettes** — Mono, Warm sand, Indigo, Moss — each adapting to light *and* dark independently;
- the whole ramp is **recomputed**, not swapped: OKLCH rebuild → role-based chroma → **sRGB gamut clamp** → contrast solved on real surfaces;
- 27,000+ token references covered: body, secondary, tertiary, captions, links, sidebars, cards, user bubble, primary button, scrollbars, switches, Markdown headings/bold, code blocks;
- adjustable: text tint (3), sidebar depth (3), right panel (2), Markdown emphasis, scrollbars, switch colour;
- **custom palette** (pick surface / text / accent — the engine keeps its contrast guarantees), **config export/import** via a `dshs1.` code, **high-contrast** mode, and 4 UI languages;
- **self-healing**: if the host drops the override layer, the palette is re-applied;
- UI in 简体中文 / 繁體中文 / English / 日本語 (follows the host language, can be pinned).

## Install

```bash
# from npm
cd ~/.dsh/profiles/desktop
pnpm add dsh-theme-palette

# or a specific version
pnpm add dsh-theme-palette@1.4.3
```

From the GitHub Release tarball:

```bash
pnpm add "https://github.com/zuoyunlai/dsh-theme-palette/releases/download/v1.4.3/dsh-theme-palette-1.4.3.tgz"
```

Then **restart the GUI** — a running process keeps the old module. Open it from avatar → Settings → **Color theme**.

## Configuration

| Item | Options |
|---|---|
| Palette | Mono · Warm sand · Indigo · Moss (thumbnails follow light/dark) |
| Strength | Quiet / Standard / Strong — how much body text follows the palette |
| Panel surfaces | Sidebar (Lighter / Same / Deeper), right panel (Match sidebar / Follow canvas) |
| More options | Language, Markdown emphasis, scrollbars, switches/checks |

Every choice applies immediately and is stored in `localStorage`. Light/dark stays under the host’s Appearance control.

## Palette engine

```
OKLCH(L, C, hue) ──► gamut clamp (binary search on C) ──► sRGB hex
        ▲
        └── role chroma × intensity, then contrast solve on {canvas, card, sidebar, overlay}
```

- semantic aliases keep `var(--dsw-static-neutral-bluish-NN)` chains, so anything following a token follows the palette;
- light surfaces use steps 00–300, dark surfaces 800–950;
- text floors are enforced at build time: body ≥ 12, secondary ≥ 6.1, tertiary/link ≥ 4.6, sidebar text ≥ 7, bubble text ≥ 7;
- 432 configuration combos are checked by `node palette-dev.mjs`.

Design notes, per-component rationale and the contrast tables live in [docs/DESIGN.md](docs/DESIGN.md). Release history: [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
node palette-dev.mjs                  # token report for all palettes
node tools/sheet.mjs                  # palette board → tools/sheet.html
node tools/shoot-sheet.mjs            # screenshot the board (headless Chrome)
node tools/compare.mjs --dir tools/out/<run>        # diff against baseline
node tools/preview-settings.mjs --lang en           # render the settings page
node tools/release.mjs --dry          # release preflight
node tools/release.mjs --tag          # publish to npm + tag
```

Screenshot regression has two layers: the palette board (no auth needed) and the real desktop window via CDP (`tools/shoot-desktop.mjs`, needs `--remote-debugging-port`). See [tools/README.md](tools/README.md).


## Pitfalls we hit

The five that surprised us most during the 1.7.0 audit — each one was found by a test, not by looking at screenshots.

- **A white accent produced a white link** (1.13:1). The contrast solver only ever walked away from the background in one direction, so an accent brighter than the background kept moving toward white.
- **Picking a colour changed the page but not the panel.** The component subscribed to the palette id, which never changes when a colour does — React compared the snapshots, saw no difference, and skipped the re-render.
- **Sharing a configuration did not share the colours.** The short code carried the modes but not the three custom colours, so importing on another machine reported success and silently kept the local values.
- **Dark module surfaces have a hard ceiling.** Even pure white reaches only about 10.99:1 on the deepest panel surface, so the 12:1 (high-contrast 15:1) target is physically unreachable there. We clamp to what the surface allows and label it "surface-limited" instead of quietly missing.
- **A selector we thought was dead was alive.** The audit initially reported the `_markdown_` hooks as broken; the contract test against the shipped CSS proved otherwise. The finding was wrong, not the code.

## Sharing

Every setting — including the three custom colours — travels in one short code. Paste it into the import box and press Preview to see exactly what it will change before applying:

```text
dshs1.eyJ2IjoxLCJwIjoiY3VzdG9tIiwicyI6ImRlZXAiLCJ0IjoidGludGVkIiwiciI6InNpZGViYXIiLCJjIjoidGludGVkIiwiayI6ImFjY2VudCIsIm0iOiJvbiIsImgiOiJvZmYiLCJsIjoiemgtQ04iLCJ4Ijp7ImJnIjoiI2Y1ZWZlNiIsInRleHQiOiIjMWQxYTE3IiwiYWNjZW50IjoiIzNmNjZhMyJ9fQ
```

This real example decodes to:

- palette: custom · sidebar: deep · text: tinted · rightbar: sidebar
- scrollbar: tinted · controls: accent · Markdown emphasis: on · high contrast: off · language: zh-CN
- three colours: `#f5efe6` (canvas) · `#1d1a17` (text) · `#3f66a3` (accent)

The code is generated by the production encoder and self-checked round-trip before it goes into this README — it is never hand-written.

## Trade-offs

Other theme plugins in this ecosystem ship glass, wallpapers and animation. We deliberately do not:

- **No glass or wallpaper.** That race is won on screenshots; we would rather compete on proof.
- **No theme market, no AI colour generation.** Both introduce colours we cannot guarantee — the contrast solver is the asset, and feeding it unpredictable input spends it.
- **No more palettes.** Four presets plus a three-colour generator beats ten hand-picked ones; volume is not the moat.
- **No eye-care claims.** We report measured ratios on the surfaces text actually lands on, and say "surface-limited" when that is all there is. No medical claims.


## License

MIT © 2026 Zuoyunlai
