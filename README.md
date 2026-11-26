<p align="center">
	<a href="https://gobernansa.dmoya.dev" target="_blank">
		<img src="/packages/shared/assets/logo.svg" width="400" alt="Logo de gobernança">
	</a>
</p>

gobernança es una plataforma para gestionar comunidades de propietarios. Los despachos de administradores de fincas llevan sus comunidades desde el admin, y los vecinos tienen una webapp para incidencias, juntas, recibos y reservas.

## Repositorio

Monorepo con workspaces de npm. Cada carpeta tiene su README.

| Carpeta | Qué es |
| --- | --- |
| [`apps/webapp`](apps/webapp) | La webapp de los vecinos, en [gobernansa.dmoya.dev](https://gobernansa.dmoya.dev) |
| [`apps/admin`](apps/admin) | El admin de los despachos, en [admin.gobernansa.dmoya.dev](https://admin.gobernansa.dmoya.dev) |
| [`apps/landing`](apps/landing) | La página comercial, sin framework, publicada en GitHub Pages |
| [`apps/functions`](apps/functions) | Cloud Functions del historial y los plazos de conservación. Necesitan el plan de pago y aún no están desplegadas |
| [`packages/shared`](packages/shared) | Dominio, Firebase, sesión, tema y componentes que usan las dos apps |
| `firebase/` | Reglas de Firestore y de Storage e índices de Firestore |
| [`scripts`](scripts) | Seed, demo local, copias de seguridad y traducción de errores |
| [`docs`](docs) | Producto, ventas, planes y configuración de Firebase |
| `design/` | El diseño en Sketch, logo incluido |

## Empezar

Hace falta Node 24 (`nvm use`) y Java 21 para los emuladores. Los pasos completos, los puertos y qué hacer cuando algo falla están en [docs/desarrollo.md](docs/desarrollo.md).

```bash
cp .env.example .env.local   # y rellénalo: VITE_FIREBASE_EMULATORS='true' y DEMO_PASSWORD
npm install                  # activa también los hooks de git
npm run doctor               # comprueba Node, Java, .env.local y los puertos
npm run dev                  # emuladores con el seed, webapp en https://localhost:5400 y admin en https://localhost:5401
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Emuladores, seed desde cero y las dos apps |
| `npm run dev:webapp`, `dev:admin`, `dev:landing`, `emulators` | Solo esa app, la landing o los emuladores |
| `npm run dev:isolated` | Un segundo entorno con sus propios emuladores y datos, junto a `npm run dev` ([docs/desarrollo.md](docs/desarrollo.md#entorno-aislado)) |
| `npm run db -- get <ruta>` | Lee o escribe datos de los emuladores, nunca del proyecto real |
| `npm run doctor` | Comprueba que el equipo tiene lo que necesita `npm run dev` |
| `npm run check` | ESLint y tipos de las dos apps, en paralelo |
| `npm run check:rules` | Comprueba las reglas de Firestore en un emulador propio |
| `npm run lint` | ESLint arreglando lo que pueda |
| `npm run build` | Build de producción de las dos apps y la landing |
| `npm run clean` | Borra builds, cachés de Vite y logs |
| `npm run seed`, `seed:emulators`, `seed:demo` | Carga los datos de prueba ([scripts/seed](scripts/seed/README.md)) |
| `npm run demo`, `demo:reset` | La demo comercial en el portátil, sin internet ([docs/demo.md](docs/demo.md)) |
| `npm run deploy:demo` | Despliega las apps en el proyecto de demo |
| `npm run backup`, `restore`, `purge` | Copia de seguridad, restaurarla en los emuladores y borrar lo caducado |
| `npm run symbolicate` | Traduce la pila de un error de producción al código fuente |
| `npm run check:deps` | Revisa qué dependencias tienen versión nueva |

## Despliegue

- **Cada push a `main`:** CI comprueba y despliega las reglas de Firestore y sus índices, la webapp y el admin en Firebase Hosting y, si cambia `apps/landing` o el tema, la publica en GitHub Pages (una vez hecho [A3](docs/v1.md#a3)).
- **Cada pull request:** la webapp y el admin en un canal de vista previa.
- **A mano:** las reglas de Storage y las functions ([docs/setup.md](docs/setup.md)).

## Documentación

El índice está en [docs/README.md](docs/README.md), y todo lo abierto en [docs/pendiente.md](docs/pendiente.md).
