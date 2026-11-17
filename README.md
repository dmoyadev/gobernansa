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
| `apps/landing` | La página comercial: HTML sin build, publicado en GitHub Pages |
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
npm install
npm run dev                  # emuladores con el seed, webapp en https://localhost:5400 y admin en https://localhost:5401
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Emuladores, seed desde cero y las dos apps |
| `npm run dev:webapp`, `npm run dev:admin` | Solo esa app |
| `npm run emulators` | Solo los emuladores |
| `npm run check` | ESLint y tipos de las dos apps, en paralelo |
| `npm run lint` | ESLint arreglando lo que pueda |
| `npm run build` | Build de producción de las dos apps |
| `npm run clean` | Borra builds, cachés de Vite y logs |
| `npm run seed`, `seed:emulators`, `seed:demo` | Carga los datos de prueba ([scripts/seed](scripts/seed/README.md)) |
| `npm run demo`, `demo:reset` | La demo comercial en el portátil, sin internet ([docs/demo.md](docs/demo.md)) |
| `npm run deploy:demo` | Despliega las apps en el proyecto de demo |
| `npm run backup`, `restore`, `purge` | Copia de seguridad, restaurarla en los emuladores y borrar lo caducado |
| `npm run symbolicate` | Traduce la pila de un error de producción al código fuente |
| `npm run check:deps` | Revisa qué dependencias tienen versión nueva |

## Despliegue

- **Cada push a `main`:** CI despliega las reglas de Firestore, la webapp y el admin en Firebase Hosting y, si cambia `apps/landing`, la landing en GitHub Pages.
- **Cada pull request:** la webapp y el admin en un canal de vista previa.
- **A mano:** los índices, las reglas de Storage y las functions ([docs/firebase.md](docs/firebase.md)).

## Documentación

| Doc | Para qué |
| --- | --- |
| [v1.md](docs/v1.md) | Qué falta para presentar gobernança a los despachos |
| [competencia.md](docs/competencia.md) | El mercado y los competidores, con los huecos por cubrir |
| [fiabilidad.md](docs/fiabilidad.md) | Monitorización, copias y robustez |
| [firebase.md](docs/firebase.md) | Configuración del proyecto de Firebase, roles y modelo de datos |
| [desarrollo.md](docs/desarrollo.md) | Arrancar, puertos, convenciones y problemas habituales |
| [speech.md](docs/speech.md), [demo.md](docs/demo.md) | La visita a un despacho y el guion de la demo |
| [alta-despacho.md](docs/alta-despacho.md) | Dar de alta un despacho nuevo |
| [rebranding.md](docs/rebranding.md) | El cambio de nombre y logo |

Un proyecto hecho con 💚 por [Daniel Moya](https://dmoya.dev).
