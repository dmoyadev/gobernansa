# webapp

La app de los vecinos: incidencias, juntas, recibos y pagos, reservas, la comunidad y su actividad. También abre el parte de trabajo que recibe un proveedor por enlace, sin cuenta. Es una PWA instalable que funciona sin conexión con lo último que leyó.

```bash
npm run dev:webapp   # https://localhost:5400, contra lo que diga .env.local
```

## Organización

- `src/app/`: lo de toda la app. El router, `App.vue`, las páginas sueltas (inicio, acciones, legal, 404), el layout y la cabecera (`ui/`), Storage y los ayudantes de Firestore (`infrastructure/`).
- `src/modules/<módulo>/`: `application/` lee y escribe en Firebase, `ui/` son las páginas y componentes y `domain/` lo que solo usa esta app. El dominio común está en `packages/shared/domain`.
- `public/sw.js` es el service worker, escrito a mano. `public/firebase-messaging-sw.js` recibe las notificaciones push.
- Se importa de `src` como `@/…` y de shared como `@gobernansa/shared/…`.

## A tener en cuenta

- Lee los `.env` de la raíz del repo, no de esta carpeta.
- En `localhost` el service worker no guarda nada en caché. El modo sin conexión se prueba en una vista previa de un PR o en producción.
- Las fotos de incidencias y partes solo se ven si hay bucket de Storage: en los emuladores siempre, en producción a partir del plan de pago.
