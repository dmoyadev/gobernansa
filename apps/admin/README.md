# admin

La plataforma de los despachos y de los presidentes: comunidades, censo, finanzas y contabilidad, juntas, incidencias, proveedores, correo y honorarios. El equipo (superadmin) ve además los errores, el historial, las cuentas y los administradores, y el titular de un despacho, su equipo. Cada cuenta ve solo sus comunidades ([roles](../../docs/datos.md#roles)).

```bash
npm run dev:admin   # https://localhost:5401, contra lo que diga .env.local
```

## Organización

- `src/app/`: lo de toda la app. El router, `AdminLayout.vue` y la búsqueda; `ux/` tiene `FormCard` con `useNewForm`, `page.scss`, botones, descargas, toasts y ordenar arrastrando; `workspace/` define las pestañas y secciones de cada comunidad.
- `src/modules/<módulo>/`: `application/`, `ui/` y `domain/`, como dicen las [convenciones](../../docs/desarrollo.md#convenciones).
- `pageTexts.ts` recoge al compilar los textos de cada página de una comunidad, para que su buscador los encuentre.
- Se importa de `src` como `@/…` y de shared como `@gobernansa/shared/…`.

## A tener en cuenta

- Lee los `.env` de la raíz del repo, no de esta carpeta.
- «Ver como vecino», las invitaciones y los enlaces de los partes abren `VITE_WEBAPP_URL`: en desarrollo tiene que ser la webapp local, o abrirán producción.
- Los correos no se envían hasta instalar la extensión ([FUN-2](../../docs/competencia.md#fun-2)): con `VITE_MAIL_MODE='demo'` solo se guardan en **Correo saliente**.
