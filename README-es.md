# dsh-theme-palette

[English](README.md) · [中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

Paleta de tema para DeepSeek Harness (web y escritorio): **4 paletas × claro/oscuro**, dos ejes independientes.

![Página de ajustes](assets/screenshot-settings-light.png)

*Render estático con el ancho real del panel (564 px de contenido).*

| Oscuro | Paleta personalizada | Alto contraste |
|---|---|---|
| ![Oscuro](assets/screenshot-settings-dark.png) | ![Paleta personalizada](assets/screenshot-settings-custom.png) | ![Alto contraste](assets/screenshot-settings-hc.png) |

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


## Pitfalls we hit

Las cinco más sorprendentes de la auditoría de 1.7.0 — cada una la encontró un test, no mirando capturas.

- **Un acento blanco generaba un enlace blanco** (1.13:1). El solucionador de contraste solo avanzaba en una dirección, alejándose del fondo, así que un acento más claro que el fondo seguía yendo hacia el blanco.
- **Elegir un color cambiaba la página pero no el panel.** El componente se suscribía al id de paleta, que no cambia al cambiar un color; React comparó los snapshots, no vio diferencia y saltó el re-render.
- **Compartir una configuración no compartía los colores.** El código corto llevaba los modos pero no los tres colores personalizados, así que importar en otra máquina informaba éxito y conservaba los valores locales.
- **Las superficies modulares oscuras tienen un techo.** Aun el blanco puro llega solo a ~10.99:1 en la superficie más profunda, de modo que el objetivo 10:1 (15:1 en alto contraste) es físicamente inalcanzable ahí. Ajustamos al máximo alcanzable y lo etiquetamos.
- **Un selector que creíamos muerto estaba vivo.** La auditoría inicialmente lo reportó como roto; la prueba de contrato contra el CSS publicado demostró lo contrario. El hallazgo estaba equivocado, no el código.

## Sharing

Toda la configuración — incluidos los tres colores personalizados — viaja en un código corto. Pégalo en el cuadro de importación y pulsa Vista previa para ver qué cambiará antes de aplicar:

```text
dshs1.eyJ2IjoxLCJwIjoiY3VzdG9tIiwicyI6ImRlZXAiLCJ0IjoidGludGVkIiwiciI6InNpZGViYXIiLCJjIjoidGludGVkIiwiayI6ImFjY2VudCIsIm0iOiJvbiIsImgiOiJvZmYiLCJsIjoiemgtQ04iLCJ4Ijp7ImJnIjoiI2Y1ZWZlNiIsInRleHQiOiIjMWQxYTE3IiwiYWNjZW50IjoiIzNmNjZhMyJ9fQ
```

Este ejemplo real decodifica a:

- paleta: custom · barra lateral: deep · texto: tinted · panel derecho: sidebar
- scrollbar: tinted · controles: accent · Markdown: on · alto contraste: off · idioma: zh-CN
- tres colores: `#f5efe6` (fondo) · `#1d1a17` (texto) · `#3f66a3` (acento)

El código lo genera el codificador de producción y se auto-verifica ida y vuelta antes de entrar en este README — nunca se escribe a mano.

## Trade-offs

Otros plugins de tema aquí ofrecen cristal, fondos y animación. Decidimos no hacerlo:

- **Sin cristal ni fondos.** Esa carrera se gana con capturas; preferimos competir con pruebas.
- **Sin mercado de temas ni generación de color con IA.** Ambos introducen colores que no podemos garantizar; el solucionador de contraste es el activo.
- **Sin más paletas.** Cuatro preajustes más un generador de tres colores supera a diez elegidas a mano; el volumen no es la ventaja.
- **Sin promesas de "protección ocular".** Reportamos ratios medidos en las superficies donde el texto realmente cae y decimos "limitado por la superficie" cuando es todo lo que hay.


## License

MIT © 2026 Zuoyunlai
