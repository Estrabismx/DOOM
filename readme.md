# DOOM Web Port

Este directorio contiene una adaptación experimental del flujo principal de Linux DOOM a JavaScript para ejecutarse como sitio estático en GitHub Pages. `main.js` conserva conceptos del motor original —tics de 35 Hz, eventos de teclado, lectura de lumps WAD, jugador, líneas del mapa y proyección de paredes— y dibuja el resultado en un `<canvas>`. La página carga automáticamente `Doom1.WAD` desde la raíz del despliegue.

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

El visor busca un marcador de mapa (`E1M1`–`E4M9` o `MAP01`–`MAP99`) y los lumps `VERTEXES`, `LINEDEFS` y, opcionalmente, `THINGS`. El primer `THINGS` de tipo 1 se usa como posición y ángulo inicial del jugador. Se valida la cabecera `IWAD`/`PWAD`, el directorio y los límites de cada lump antes de leerlos.

Esta versión es un port de renderizado experimental: no pretende ser todavía un reemplazo completo de todas las armas, enemigos, sonido, menús, texturas, BSP, colisiones y partidas guardadas del ejecutable C. Los mapas grandes o WAD con estructuras no estándar pueden mostrar solo una parte de la geometría.

## Publicar

Sube `index.html`, `style.css`, `main.js`, `readme.md` y `Doom1.WAD` a la rama configurada en **Settings → Pages**. Usa **Deploy from a branch** y selecciona la raíz (`/`) o la carpeta que contenga esos archivos. Tras el despliegue, abre la URL HTTPS de Pages: el WAD se cargará sin selección manual.

Mantén los avisos de copyright y la licencia del repositorio. Los WAD oficiales de DOOM no forman parte de este proyecto y sus condiciones de uso son independientes de la GPL del código fuente.
