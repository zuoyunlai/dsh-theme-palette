# dsh-theme-palette

[English](README.md) · [中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

Paleta de tema para o DeepSeek Harness (web e desktop): **4 paletas × claro/escuro**, dois eixos independentes.

![Página de configuração](assets/screenshot-settings-light.png)

*Render estático na largura real do painel (564 px de conteúdo).*

| Escuro | Paleta personalizada | Alto contraste |
|---|---|---|
| ![Escuro](assets/screenshot-settings-dark.png) | ![Paleta personalizada](assets/screenshot-settings-custom.png) | ![Alto contraste](assets/screenshot-settings-hc.png) |

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


## Pitfalls we hit

As cinco mais surpreendentes da auditoria da 1.7.0 — cada uma foi encontrada por um teste, não olhando capturas.

- **Um acento branco gerava um link branco** (1.13:1). O solucionador de contraste andava só numa direção, afastando-se do fundo, então um acento mais claro que o fundo continuava indo para o branco.
- **Escolher uma cor mudava a página mas não o painel.** O componente inscrevia-se no id da paleta, que não muda quando a cor muda; o React comparou os snapshots, viu que não havia diferença e pulou o re-render.
- **Compartilhar uma configuração não compartilhava as cores.** O código curto carregava os modos mas não as três cores personalizadas, então importar em outra máquina informava sucesso e mantinha os valores locais.
- **Superfícies modulares escuras têm um teto.** Mesmo o branco puro chega a apenas ~10.99:1 na superfície mais profunda, então a meta de 10:1 (15:1 em alto contraste) é fisicamente inalcançável ali. Ajustamos ao máximo alcançável e rotulamos.
- **Um seletor que achávamos morto estava vivo.** A auditoria inicialmente o reportou como quebrado; o teste de contrato contra o CSS publicado provou o contrário. O achado estava errado, não o código.

## Sharing

Toda a configuração — incluindo as três cores personalizadas — viaja num código curto. Cole na caixa de importação e clique em Pré-visualizar para ver exatamente o que mudará antes de aplicar:

```text
dshs1.eyJ2IjoxLCJwIjoiY3VzdG9tIiwicyI6ImRlZXAiLCJ0IjoidGludGVkIiwiciI6InNpZGViYXIiLCJjIjoidGludGVkIiwiayI6ImFjY2VudCIsIm0iOiJvbiIsImgiOiJvZmYiLCJsIjoiemgtQ04iLCJ4Ijp7ImJnIjoiI2Y1ZWZlNiIsInRleHQiOiIjMWQxYTE3IiwiYWNjZW50IjoiIzNmNjZhMyJ9fQ
```

Este exemplo real decodifica para:

- paleta: custom · barra lateral: deep · texto: tinted · painel direito: sidebar
- scrollbar: tinted · controles: accent · Markdown: on · alto contraste: off · idioma: zh-CN
- três cores: `#f5efe6` (fundo) · `#1d1a17` (texto) · `#3f66a3` (acento)

O código é gerado pelo codificador de produção e auto-verificado ida e volta antes de entrar neste README — nunca é escrito à mão.

## Trade-offs

Outros plugins de tema aqui entregam vidro, papéis de parede e animação. Decidimos não fazer isso:

- **Sem vidro nem papel de parede.** Essa corrida se ganha com capturas; preferimos competir com provas.
- **Sem mercado de temas nem geração de cor por IA.** Ambos introduzem cores que não podemos garantir; o solucionador de contraste é o ativo.
- **Sem mais paletas.** Quatro predefinições mais um gerador de três cores supera dez escolhidas à mão; volume não é a vantagem.
- **Sem promessas de "proteção ocular".** Reportamos razões medidas nas superfícies onde o texto realmente cai e dizemos "limitado pela superfície" quando é tudo o que existe.


## License

MIT © 2026 Zuoyunlai
