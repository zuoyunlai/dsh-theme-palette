# dsh-theme-palette

[English](README.md) · [中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

Paleta de tema para o DeepSeek Harness (web e desktop): **4 paletas × claro/escuro**, dois eixos independentes.

## Compatibility

| Superfície | Estado |
|---|---|
| Cliente DSH desktop / web | 0.2.x |
| Node.js | ≥ 20 |
| Alterações no código do host | nenhuma |

O plugin apenas empilha tokens de cor via `ctx.theme.overrideTokens`; não registra um tema, não altera o host e não toca na preferência de aparência.

## What it does

- **4 paletas** — Mono, Areia quente, Índigo, Musgo — cada uma adaptada de forma independente ao claro e ao escuro;
- a escala é **recalculada** por completo: reconstrução OKLCH → croma por papel → **limite de gamut sRGB** → contraste resolvido sobre superfícies reais;
- mais de 27.000 referências de token: texto, secundário, terciário, legendas, links, barras laterais, cartões, balão do usuário, botão primário, barras de rolagem, interruptores, títulos/negrito de Markdown, blocos de código;
- ajustável: intensidade do texto (3), profundidade da barra lateral (3), painel direito (2), ênfase de Markdown, barras de rolagem, cor dos interruptores;
- **autorrecuperação**: se o host descartar a camada de override, a paleta é reaplicada;
- interface em 简体中文 / 繁體中文 / English / 日本語 (segue o idioma do host e pode ser fixada).

## Install

```bash
# via npm
cd ~/.dsh/profiles/desktop
pnpm add dsh-theme-palette

# ou uma versão específica
pnpm add dsh-theme-palette@1.4.3
```

A partir do tarball do release do GitHub:

```bash
pnpm add "https://github.com/zuoyunlai/dsh-theme-palette/releases/download/v1.4.3/dsh-theme-palette-1.4.3.tgz"
```

Depois **reinicie a interface**: um processo em execução mantém o módulo antigo. Abra em avatar → Configurações → **Color theme**.

## Configuration

| Item | Opções |
|---|---|
| Paleta | Mono · Areia quente · Índigo · Musgo (as miniaturas seguem claro/escuro) |
| Intensidade | Suave / Padrão / Forte — quanto o texto segue a paleta |
| Superfícies | Barra lateral (Mais clara / Igual / Mais escura), painel direito (Igual à barra / Seguir a tela) |
| Mais opções | Idioma, ênfase de Markdown, barras de rolagem, interruptores |

Cada escolha aplica na hora e fica em `localStorage`. Claro/escuro continua no controle «Aparência» do host.

## Palette engine

```
OKLCH(L, C, matiz) ──► limite de gamut (busca binária em C) ──► hex sRGB
        ▲
        └── croma por papel × intensidade, depois contraste sobre {tela, cartão, barra, sobreposição}
```

- os aliases semânticos mantêm cadeias `var(--dsw-static-neutral-bluish-NN)`, então tudo que segue um token segue a paleta;
- superfícies claras usam os passos 00–300, as escuras 800–950;
- os pisos de texto são exigidos na construção: corpo ≥ 12, secundário ≥ 6.1, terciário/link ≥ 4.6, texto na barra lateral ≥ 7, texto no balão ≥ 7;
- `node palette-dev.mjs` verifica 432 combinações.

Notas de design, critério por componente e tabelas de contraste em [docs/DESIGN.md](docs/DESIGN.md). Histórico: [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
node palette-dev.mjs                  # relatório de tokens de todas as paletas
node tools/sheet.mjs                  # painel de paletas → tools/sheet.html
node tools/shoot-sheet.mjs            # captura do painel (Chrome headless)
node tools/compare.mjs --dir tools/out/<run>        # comparar com a linha de base
node tools/preview-settings.mjs --lang en           # renderizar a página de ajustes
node tools/release.mjs --dry          # pré-checagem de release
node tools/release.mjs --tag          # publicar no npm + tag
```

A regressão visual tem duas camadas: o painel de paletas (sem autenticação) e a janela real do desktop via CDP (`tools/shoot-desktop.mjs`, requer `--remote-debugging-port`). Veja [tools/README.md](tools/README.md).

## License

MIT © 2026 Zuoyunlai
