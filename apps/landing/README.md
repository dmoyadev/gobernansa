# landing

La página comercial, en [dmoyadev.github.io/gobernansa](https://dmoyadev.github.io/gobernansa/). HTML, CSS y JS sin framework: Vite solo junta los ficheros, pone los colores del tema y añade un hash a lo que se descarga.

```bash
npm run dev:landing                  # http://localhost:5404, se recarga al guardar
npm run build -w apps/landing        # apps/landing/dist
npm run preview -w apps/landing      # el build en http://localhost:5414
```

## Cómo está hecha

| Dónde | Qué |
| --- | --- |
| `index.html` | Todo el contenido y el marcado, sección a sección |
| `src/styles/` | Un CSS por sección, en el orden en que aparecen (`main.css` los importa). Lo del ordenador va al final de cada uno, desde 860 px |
| `src/sections/` | El JS de cada sección: la noche del hero, las fichas de funciones, los móviles que se usan solos, el formulario… |
| `src/page.js` | Lo que comparten: si el sistema pide menos movimiento y el botón flotante «Pide una demo» del móvil |
| `img/`, `fonts/` | Imágenes y las dos fuentes, servidas desde la propia página |
| `public/og-image.png` | La vista previa al compartir el enlace (1200×630): el hero a 1440×756 sin botones ni pista, reducido. Va tal cual, sin hash, porque `og:image` la pide por su dirección completa |

## A tener en cuenta

- Sin JS se lee entera: el JS añade el movimiento y envía el formulario de la demo. Lo nuevo también debe leerse sin él.
- Los azules y los grises son los de las apps (`packages/shared/theme/colors.scss`); el coral y los grises del texto son solo de la página, en `base.css`.
- Las rutas son relativas (`base: './'`) porque GitHub Pages la sirve desde `/gobernansa/`.
- Se publica sola: cada push a `main` que toque esta carpeta, el tema o `package-lock.json` sube `dist` a Pages, una vez elegido GitHub Actions como origen ([A3](../../docs/v1.md#a3)).
