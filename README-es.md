# dsh-theme-palette

[English](README.md) · [中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

Paleta de tema para DeepSeek Harness (web y escritorio): **4 paletas × claro/oscuro**, dos ejes independientes.

![Página de ajustes](assets/screenshot-settings-light.png)

*Render estático con el ancho real del panel (564 px de contenido).*

## Compatibility

| Superficie | Estado |
|---|---|
| Cliente DSH de escritorio / web | 0.2.x |
| Node.js | ≥ 20 |
| Cambios en el código del host | ninguno |

El plugin solo apila tokens de color mediante `ctx.theme.overrideTokens`; no registra un tema, no parchea el host y no toca la preferencia de apariencia.

## What it does

- **4 paletas** — Mono, Arena cálida, Índigo, Musgo — cada una adaptada de forma independiente a claro y oscuro;
- la escala se **recalcula** completa: reconstrucción OKLCH → croma por rol → **ajuste al gamut sRGB** → contraste resuelto sobre superficies reales;
- más de 27.000 referencias de token: texto, secundario, terciario, notas, enlaces, barras laterales, tarjetas, burbuja del usuario, botón primario, barras de desplazamiento, interruptores, títulos/negritas de Markdown, bloques de código;
- ajustable: intensidad del texto (3), profundidad de la barra lateral (3), panel derecho (2), énfasis de Markdown, barras de desplazamiento, color de interruptores;
- **autorreparable**: si el host descarta la capa de override, la paleta se vuelve a aplicar;
- interfaz en 简体中文 / 繁體中文 / English / 日本語 (sigue el idioma del host y se puede fijar).

## Install

```bash
# desde npm
cd ~/.dsh/profiles/desktop
pnpm add dsh-theme-palette

# o una versión concreta
pnpm add dsh-theme-palette@1.4.3
```

Desde el tarball del release de GitHub:

```bash
pnpm add "https://github.com/zuoyunlai/dsh-theme-palette/releases/download/v1.4.3/dsh-theme-palette-1.4.3.tgz"
```

Después **reinicia la interfaz**: un proceso en marcha conserva el módulo antiguo. Se abre en avatar → Ajustes → **Color theme**.

## Configuration

| Elemento | Opciones |
|---|---|
| Paleta | Mono · Arena cálida · Índigo · Musgo (las miniaturas siguen claro/oscuro) |
| Intensidad | Suave / Estándar / Fuerte — cuánto sigue el texto a la paleta |
| Superficies | Barra lateral (Más clara / Igual / Más oscura), panel derecho (Igual que la barra / Seguir el lienzo) |
| Más opciones | Idioma, énfasis de Markdown, barras de desplazamiento, interruptores |

Cada elección se aplica al instante y se guarda en `localStorage`. Claro/oscuro sigue en el control «Apariencia» del host.

## Palette engine

```
OKLCH(L, C, tono) ──► ajuste al gamut (búsqueda binaria en C) ──► hex sRGB
        ▲
        └── croma por rol × intensidad, luego contraste sobre {lienzo, tarjeta, barra, superposición}
```

- los alias semánticos mantienen cadenas `var(--dsw-static-neutral-bluish-NN)`, así que todo lo que sigue a un token sigue a la paleta;
- superficies claras usan los pasos 00–300, las oscuras 800–950;
- los mínimos de texto se exigen en tiempo de construcción: cuerpo ≥ 12, secundario ≥ 6.1, terciario/enlace ≥ 4.6, texto en barra lateral ≥ 7, texto en burbuja ≥ 7;
- `node palette-dev.mjs` comprueba 432 combinaciones.

Las notas de diseño, el criterio por componente y las tablas de contraste están en [docs/DESIGN.md](docs/DESIGN.md). Historial: [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
node palette-dev.mjs                  # informe de tokens de todas las paletas
node tools/sheet.mjs                  # tablero de paletas → tools/sheet.html
node tools/shoot-sheet.mjs            # captura del tablero (Chrome headless)
node tools/compare.mjs --dir tools/out/<run>        # comparar con la línea base
node tools/preview-settings.mjs --lang en           # renderizar la página de ajustes
node tools/release.mjs --dry          # preflight de publicación
node tools/release.mjs --tag          # publicar en npm + tag
```

La regresión visual tiene dos capas: el tablero de paletas (sin autenticación) y la ventana real del escritorio vía CDP (`tools/shoot-desktop.mjs`, requiere `--remote-debugging-port`). Ver [tools/README.md](tools/README.md).

## License

MIT © 2026 Zuoyunlai
