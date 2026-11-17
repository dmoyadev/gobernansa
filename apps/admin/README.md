# admin

La plataforma de los despachos y de los presidentes: comunidades, censo, finanzas y contabilidad, juntas, incidencias, proveedores, correo y facturación del despacho. El equipo de gobernança (superadmin) ve además los errores y el historial. Cada cuenta ve solo las comunidades que gestiona ([roles](../../docs/datos.md#roles)).

```bash
npm run dev:admin   # https://localhost:5401, contra lo que diga .env.local
```

## Organización

- `src/app/`: lo de toda la app. El router, `AdminLayout.vue` y la búsqueda; `ux/` tiene botones, descargas, toasts, ordenar arrastrando y la navegación entre formularios; `workspace/` define las pestañas y secciones de cada comunidad.
- `src/modules/<módulo>/`: `application/` lee y escribe en Firebase, `ui/` son las páginas y componentes y `domain/` lo que solo usa el admin. El dominio común está en `packages/shared/domain`.
- `pageTexts.ts` recoge al compilar los textos de cada página de una comunidad, para que su buscador encuentre lo que hay dentro.
- Se importa de `src` como `@/…` y de shared como `@gobernansa/shared/…`.

## A tener en cuenta

- Lee los `.env` de la raíz del repo, no de esta carpeta.
- «Ver como vecino», las invitaciones y los enlaces de los partes abren `VITE_WEBAPP_URL`: en desarrollo tiene que ser la webapp local, o abrirán producción.
- Los correos no se envían hasta instalar la extensión de correo: con `VITE_MAIL_MODE='demo'` solo se guardan en **Correo saliente**.
