# dsh-theme-palette

[English](README.md) · [中文](README-zh.md) · [日本語](README-ja.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

Paleta de tema para DeepSeek Harness (web y escritorio): **4 paletas preajustadas + personalizada × claro/oscuro**, dos ejes independientes.

![Página de ajustes](assets/screenshot-settings-light.png)

*Render estático con el ancho real del panel (564 px de contenido).*

| Oscuro | Paleta personalizada | Alto contraste |
|---|---|---|
| ![Oscuro](assets/screenshot-settings-dark.png) | ![Paleta personalizada](assets/screenshot-settings-custom.png) | ![Alto contraste](assets/screenshot-settings-hc.png) |

## Compatibility

| Superficie | Estado |
|---|---|
| Cliente DSH de escritorio / web | 0.2.x |
| Node.js | 22.19.0+ (en la línea 22.x) o 24.0.0+ |
| Cambios en el código del host | ninguno |

El campo `engines` del paquete es `^22.19.0 || >=24.0.0`: la fila anterior es ese mismo requisito por extenso.

El plugin solo apila tokens de color mediante `ctx.theme.overrideTokens`; no registra un tema, no parchea el host y no toca la preferencia de apariencia.

## What it does

- **4 preajustadas + personalizada** — Mono, Arena cálida, Índigo, Musgo (cada una adaptada de forma independiente a claro y oscuro), más una paleta personalizada derivada de tres colores;
- la escala se **recalcula** completa: reconstrucción OKLCH → croma por rol → **ajuste al gamut sRGB** → contraste resuelto sobre superficies reales;
- se cubren todos los tokens de color del host (122 tokens en paletas con tinte, 17 en mono; 1080 combinaciones de ajuste escaneadas): texto, secundario, terciario, notas, enlaces, barras laterales, tarjetas, burbuja del usuario, botón primario, barras de desplazamiento, interruptores, títulos/negritas de Markdown, bloques de código;
- ajustable: intensidad del texto (3), profundidad de la barra lateral (3), énfasis de Markdown, barras de desplazamiento, color de interruptores;
- **paleta personalizada** (elige superficie / texto / acento — el motor mantiene sus garantías de contraste), **exportación/importación de configuración** con un código `dshs1.`, **modo de alto contraste** y **4 idiomas de interfaz**;
- **autorreparable**: si el host descarta la capa de override, la paleta se vuelve a aplicar; tras fallos repetidos la autorreparación se pausa y la página de ajustes ofrece un botón para reactivarla;
- **promesas de contraste**: el cuerpo tiene la promesa de 12:1 en claro y 10:1 en oscuro (15:1 en alto contraste), el secundario ≥ 6.2 en claro y 8.0 en oscuro (HC 9 / 9.6), el terciario ≥ 4.85 en claro y 6.4 en oscuro (HC 7 / 7.6), los enlaces ≥ 4.95 en claro y 4.62 en oscuro (HC 7; los mínimos claros llevan un margen para déficits de visión cromática; los enlaces oscuros además pasan una puerta APCA Lc ≥ 60, 75 en HC), medidos sobre las superficies donde el texto realmente cae (el lado oscuro necesita más: un cociente WCAG sobreestima la legibilidad sobre fondo oscuro);
- las superficies prometidas son 00/60 en claro y 950/875 en oscuro; las oscuras 800 (superficie de módulo) y 850 (sub-superficie) **no** respaldan el texto del cuerpo: el informe las cuenta aparte como «fuera de política» (ni cuentan como aprobado ni como fallo);
- interfaz en 简体中文 / 繁體中文 / English / 日本語 (sigue el idioma del host y se puede fijar).

## Install

```bash
# desde npm
cd ~/.dsh/profiles/desktop
pnpm add dsh-theme-palette
```

Para fijar una versión, usa `pnpm add dsh-theme-palette@<version>` — [CHANGELOG.md](CHANGELOG.md) marca las secciones que nunca se publicaron en npm; no fijes una de esas.
Desde el tarball de un release de GitHub: elige el asset en la [página de releases](https://github.com/zuoyunlai/dsh-theme-palette/releases) e instálalo con `pnpm add <ruta-del-tgz>`.

Después **reinicia la interfaz**: un proceso en marcha conserva el módulo antiguo. Se abre en avatar → Ajustes → **Color theme**.

## Configuration

| Elemento | Opciones |
|---|---|
| Paleta | Mono · Arena cálida · Índigo · Musgo (las miniaturas siguen claro/oscuro) |
| Intensidad | Suave / Estándar / Fuerte — cuánto sigue el texto a la paleta |
| Superficies | Barra lateral (Más clara / Igual / Más oscura). El panel derecho nunca se tiñe: es una capa transparente de altura completa, teñirlo taparía la conversación (ajuste retirado en 1.9.10) |
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
- los mínimos de texto se exigen en tiempo de construcción: cuerpo ≥ 12:1 en claro y ≥ 10:1 en oscuro (alto contraste: 15:1), secundario ≥ 6.2 claro / 8.0 oscuro (HC 9 / 9.6), terciario ≥ 4.85 claro / 6.4 oscuro (HC 7 / 7.6), enlace ≥ 4.95 claro / 4.62 oscuro (HC 7), enlace con APCA Lc ≥ 60 oscuro (HC 75); el texto de la barra lateral y de la burbuja sigue la escala y mide ≥ 7 (sin puerta de contraste propia);
- las superficies prometidas son 00/60 en claro y 950/875 en oscuro; las oscuras 800 (superficie de módulo) y 850 (sub-superficie) **no** respaldan el texto del cuerpo: el informe las cuenta aparte como «fuera de política» (ni cuentan como aprobado ni como fallo), y toda superficie sigue teniendo que superar el suelo AA de 4.5;
- el informe separa tres cosas: el objetivo declarado, el techo físico (lo que el blanco o el negro alcanzan en esa superficie) y la exención de política; 0.93 es solo margen del solucionador, para decidir si un objetivo queda por encima del techo;
- `node palette-dev.mjs` comprueba 1080 combinaciones (5 paletas × 216 ajustes, ambos niveles de contraste incluidos).

Las notas de diseño, el criterio por componente y las tablas de contraste están en [docs/DESIGN.md](docs/DESIGN.md). Historial: [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm run report                        # informe de tokens de todas las paletas (-- --hc para alto contraste)
npm run sheet                         # tablero de paletas → tools/sheet.html
npm run shot-sheet                    # captura del tablero (Chrome/Edge headless)
npm run compare -- --dir tools/out/<run>   # comparar con la línea base local
npm run preview -- --lang en          # renderizar la página de ajustes
npm run contract                      # contrato de tokens/DOM del host (strict: SKIP falla)
npm run release -- --dry              # preflight de publicación
npm run release -- --tag              # publicar en npm + tag
npm run release -- --ci               # publicación en CI: solo tag; Actions publica con Trusted Publishing
npm run clean                         # borrar tarballs locales / tools/out / dist
```

La regresión visual tiene dos capas: el tablero de paletas (sin autenticación) y la ventana real del escritorio vía CDP (`tools/shoot-desktop.mjs`, requiere `--remote-debugging-port`). Ver [tools/README.md](tools/README.md).


## Pitfalls we hit

Las cinco más sorprendentes de la auditoría de 1.7.0 — cada una la encontró un test, no mirando capturas.

- **Un acento blanco generaba un enlace blanco** (1.13:1). El solucionador de contraste solo avanzaba en una dirección, alejándose del fondo, así que un acento más claro que el fondo seguía yendo hacia el blanco.
- **Elegir un color cambiaba la página pero no el panel.** El componente se suscribía al id de paleta, que no cambia al cambiar un color; React comparó los snapshots, no vio diferencia y saltó el re-render.
- **Compartir una configuración no compartía los colores.** El código corto llevaba los modos pero no los tres colores personalizados, así que importar en otra máquina informaba éxito y conservaba los valores locales.
- **«No prometido» no es «imposible».** El informe antiguo etiquetaba las superficies modulares oscuras como «limitado por la superficie», porque comparaba el objetivo del cuerpo contra la más profunda (800). Pero 800 llega a unos 10.22:1 y 850 a unos 15.27:1 con un primer plano blanco, por encima del objetivo 10:1: nunca fue inalcanzable; sencillamente esas superficies no estaban prometidas. Ahora el informe separa el objetivo declarado, el techo físico y la exención de política, y cuenta 800/850 como «fuera de política» en lugar de «físicamente inalcanzable».
- **Un selector que creíamos muerto estaba vivo.** La auditoría inicialmente lo reportó como roto; la prueba de contrato contra el CSS publicado demostró lo contrario. El hallazgo estaba equivocado, no el código.

## Sharing

Toda la configuración — incluidos los tres colores personalizados — viaja en un código corto. Pégalo en el cuadro de importación y pulsa Vista previa para ver qué cambiará antes de aplicar:

```text
dshs1.eyJ2IjoxLCJwIjoiY3VzdG9tIiwicyI6ImRlZXAiLCJ0IjoidGludGVkIiwiYyI6InRpbnRlZCIsImsiOiJhY2NlbnQiLCJtIjoib24iLCJoIjoib2ZmIiwibCI6InpoLUNOIiwieCI6eyJiZyI6IiNmNWVmZTYiLCJ0ZXh0IjoiIzFkMWExNyIsImFjY2VudCI6IiMzZjY2YTMifX0
```

Este ejemplo real decodifica a:

- paleta: custom · barra lateral: deep · texto: tinted
- scrollbar: tinted · controles: accent · Markdown: on · alto contraste: off · idioma: zh-CN
- tres colores: `#f5efe6` (fondo) · `#1d1a17` (texto) · `#3f66a3` (acento)

El código lo genera el codificador de producción y se auto-verifica ida y vuelta antes de entrar en este README — nunca se escribe a mano.

## Trade-offs

Otros plugins de tema aquí ofrecen cristal, fondos y animación. Decidimos no hacerlo:

- **Sin cristal ni fondos.** Esa carrera se gana con capturas; preferimos competir con pruebas.
- **Sin mercado de temas ni generación de color con IA.** Ambos introducen colores que no podemos garantizar; el solucionador de contraste es el activo.
- **Sin más paletas.** Cuatro preajustes más un generador de tres colores supera a diez elegidas a mano; el volumen no es la ventaja.
- **Sin promesas de "protección ocular".** Reportamos ratios medidos en las superficies donde el texto realmente cae y decimos «fuera de política» cuando esa superficie no es una de las prometidas: es una medición, no una excusa.


## License

MIT © 2026 Zuoyunlai
