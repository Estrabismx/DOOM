# DOOM Web Port

Este directorio contiene una traducción web del flujo principal de Linux DOOM a JavaScript para ejecutarse como sitio estático en GitHub Pages. `main.js` conserva la organización del motor original —tics de 35 Hz, lectura de la geometría por mapa, estructuras `vertex_t`/`line_t`/`sector_t`, spawn del jugador, movimiento con radio y bloqueo de líneas de `p_map.c`, y proyección de paredes de `r_main.c`— adaptando únicamente la salida X11 a Canvas. La página carga automáticamente `Doom1.WAD` desde la raíz del despliegue.

`Doom1.WAD` debe proceder de una copia que tengas legalmente. El repositorio conserva el código fuente bajo la licencia indicada en `LICENSE.TXT`; no redistribuyas WAD comerciales con el sitio sin autorización.

## Probar localmente

No abras `index.html` con `file://`: los navegadores pueden bloquear `fetch` y algunas APIs de archivos. Desde la raíz del repositorio inicia un servidor estático, por ejemplo:

```bash
python3 -m http.server 8000
```

Después visita `http://localhost:8000/`. La página intentará leer automáticamente `http://localhost:8000/Doom1.WAD`.

## Publicar Doom1.WAD en GitHub Pages

1. Coloca `Doom1.WAD` en la raíz publicada, junto a `index.html`, `style.css` y `main.js`.
2. Respeta exactamente el nombre `Doom1.WAD`, incluyendo mayúsculas: `main.js` solicita esa ruta relativa.
3. Si Pages publica el repositorio en `https://usuario.github.io/DOOM/`, el archivo debe quedar disponible en `https://usuario.github.io/DOOM/Doom1.WAD`.
4. En **Settings → Pages**, selecciona la rama y la carpeta que contienen los cuatro archivos y el WAD.
5. Recarga la página publicada. El estado mostrará la cantidad de lumps y el mapa detectado cuando la carga termine.

No muevas el WAD a una carpeta diferente sin actualizar la constante `url` dentro de `loadBundledWad()` en `main.js`.

Si el servidor remoto se configura para alojar el WAD fuera de GitHub Pages, debe responder con HTTPS y permitir la petición desde tu dominio mediante CORS, por ejemplo:

```http
Access-Control-Allow-Origin: https://usuario.github.io
```

Un enlace que funciona en una pestaña no garantiza que `fetch()` pueda leerlo. El port incluido solicita el archivo local `Doom1.WAD`; si cambias esa URL por una externa, CORS será obligatorio.

## Datos WAD compatibles

El visor busca un marcador de mapa (`E1M1`–`E4M9` o `MAP01`–`MAP99`) y lee los lumps que siguen a ese marcador, sin mezclar los `VERTEXES`, `LINEDEFS`, `SIDEDEFS`, `SECTORS` o `THINGS` de otros mapas. El primer `THINGS` de tipo 1 se usa como posición y ángulo inicial del jugador. Se valida la cabecera `IWAD`/`PWAD`, el directorio y los límites de cada lump antes de leerlos.

Esta versión traduce el núcleo de movimiento y renderizado de líneas, pero todavía no es un reemplazo completo de armas, enemigos, sonido, menús, texturas, traversal BSP, partidas guardadas, efectos especiales ni red del ejecutable C. La geometría se dibuja desde las líneas del mapa; los mapas grandes pueden requerir una futura implementación de clipping y traversal BSP para igualar el rendimiento y el orden exactos del renderer original.

## Publicar

Sube `index.html`, `style.css`, `main.js`, `readme.md` y `Doom1.WAD` a la rama configurada en **Settings → Pages**. Usa **Deploy from a branch** y selecciona la raíz (`/`) o la carpeta que contenga esos archivos. Tras el despliegue, abre la URL HTTPS de Pages: el WAD se cargará sin selección manual.

Mantén los avisos de copyright y la licencia del repositorio. Los WAD oficiales de DOOM no forman parte de este proyecto y sus condiciones de uso son independientes de la GPL del código fuente.
