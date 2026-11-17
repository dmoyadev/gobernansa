# Desarrollo

Cómo arrancar el proyecto en local, qué escucha en cada puerto, las convenciones y qué hacer cuando algo falla. La configuración del proyecto real de Firebase está en [setup.md](setup.md), y los roles y el modelo de datos en [datos.md](datos.md).

## Requisitos

- **Node 24.** `nvm use` lo lee de `.nvmrc`, igual que CI. Con uno más nuevo funciona, pero npm avisa porque las functions piden 24.
- **Java 21**, para los emuladores de Firestore y Storage: `brew install openjdk@21` y, en `~/.zshrc`, `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`.
- **Internet la primera vez.** Los emuladores se descargan en `~/.cache/firebase/emulators`, y el plugin de mkcert crea una autoridad de certificados local para servir `https://localhost` (pide la contraseña del Mac).
- La CLI de Firebase viene con el repo (`npx firebase`). `npx firebase login` solo hace falta para desplegar o tocar el proyecto real.

## Primer arranque

1. `cp .env.example .env.local` y, en `.env.local`:
   - `VITE_FIREBASE_EMULATORS='true'`.
   - `VITE_FIREBASE_PROJECT_ID='dmoyadev-gobernansa'`, el proyecto de `.firebaserc`. Con los emuladores, el resto de la configuración de Firebase puede quedarse como está.
   - `DEMO_PASSWORD`, la contraseña de todas las cuentas del seed. Al menos 6 caracteres.
2. `npm install`.
3. `npm run dev`. Arranca los emuladores, carga el seed desde cero y sirve las dos apps. Los datos se borran cada vez que se para.

Para entrar, las cuentas están en [`scripts/seed/data/cast.js`](../scripts/seed/data/cast.js) y todas usan `DEMO_PASSWORD`. Para el admin, el despacho «Fincas Jaén»; para la webapp, cualquier vecino de la comunidad `comm1`. El emulador de Auth no envía correos: el enlace de acceso sale en la terminal de los emuladores, y `http://127.0.0.1:5501/emulator/v1/projects/dmoyadev-gobernansa/oobCodes` lista los últimos. Ábrelo en el mismo navegador donde lo pediste, que es donde queda guardado el correo.

<a id="puertos"></a>

## Puertos

Las apps van en el 540x, las vistas del build en el 541x y los emuladores en el 550x. La demo usa los suyos para poder correr junto a `npm run dev`.

| Puerto | Qué |
| --- | --- |
| 5400 · 5401 | Webapp y admin, `https://` (`npm run dev`, `dev:webapp`, `dev:admin`) |
| 5402 · 5403 | Demo local: webapp y admin, `http://` (`npm run demo`) |
| 5404 | Landing, `http://` (`npm run dev:landing`) |
| 5410 · 5411 · 5414 | Vista del build de la webapp, del admin y de la landing (`npm run preview -w apps/webapp`) |
| 5500 | Interfaz de los emuladores: datos, cuentas y logs |
| 5501 · 5502 · 5504 · 5505 | Emuladores de Auth, Firestore, Storage y Functions |
| 5503 · 5506 … 5509 | Uso interno de los emuladores: el websocket de Firestore, el hub, los logs, Eventarc y Cloud Tasks |
| 5511 … 5517 | Emuladores de la demo local: los mismos, diez por encima |

<a id="emuladores"></a>

## Emuladores

`npm run dev` arranca los emuladores de `firebase.json`, carga el seed (`--reset`) y sirve las dos apps con `VITE_FIREBASE_EMULATORS='true'` en `.env.local`. Las apps se conectan a todos los emuladores o a ninguno, porque el proyecto real rechaza sus tokens. Los de Firestore y Storage necesitan Java 21, y su primer arranque descarga sus jars (`~/.cache/firebase/emulators`, con el entorno de reglas de Storage), la única vez que necesitan internet.

- **Reglas**: se aplican los dos ficheros, el de Firestore y el de Storage.
- **Fotos**: el seed sube al emulador de Storage imágenes SVG con un rótulo, en las [carpetas de Storage](setup.md#storage), y guarda sus URLs relativas; Vite pasa `/v0/b` al emulador. El seed no tiene vídeos. Sin el emulador de Storage (`FIREBASE_STORAGE_EMULATOR_HOST` sin poner), las incidencias y los partes cargan sin fotos, con un aviso amarillo.
- **Functions**: el Historial registra cada cambio hecho en las apps y restaura, deduciendo quién hizo cada cambio ([functions](setup.md#functions)).
- **Remote Config**: no se lee; se aplican los valores por defecto de los [interruptores](setup.md#interruptores).

<a id="demo-local"></a>

## Demo local

`npm run demo` (`scripts/demo.js`) monta la demo de ventas solo en el portátil, sin internet, y un móvil en la misma red abre la webapp: el guion está en [demo.md](demo.md). Qué necesita y qué hace:

- **Antes**: Java 21 en el `PATH` y `DEMO_PASSWORD` en `.env.local`, la contraseña de todas las cuentas. La primera vez en un equipo necesita internet una vez, para descargar los jars de los emuladores; el script avisa cuando falta alguno.
- **Puertos**, aparte de los de `npm run dev`, para que puedan correr a la vez (ver [Puertos](#puertos)). El proyecto es `demo-gobernansa`, que solo existe en los emuladores.
- **Qué hace**: arranca los emuladores de Auth, Firestore y Storage, carga el seed con sus fotos, compila las dos apps contra ellos con la dirección de red del portátil y las sirve por http en todas las interfaces, pasando las rutas de los emuladores por la dirección de cada página. Muestra las dos direcciones, un QR de la webapp y las cuentas. El admin se abre en `http://localhost:5403` en el portátil, no en la dirección de red: copiar enlaces y `crypto` necesitan localhost.
- **Sin functions**: el Historial no registra cambios ni puede restaurar ahí, y lo dice; **Acciones** sí se llena.
- **`npm run demo:reset`** carga otra vez los datos mientras corre, sin cerrar la sesión de nadie. Ctrl+C o cerrar la terminal lo para todo. Un reinicio completo cierra la sesión de los móviles, y un cambio de red lo necesita, porque la dirección va en el build.
- **Proxy**: quita `HTTP(S)_PROXY` a los emuladores; con uno puesto, las reglas de Storage no podían leer Firestore y se rechazaba toda subida.
- **Red**: mientras corre, cualquiera en esa red llega a los emuladores. Los datos son inventados, pero mejor el punto de acceso del móvil que la wifi de invitados de un cliente.

## Antes de cada commit

- `npm run check`: ESLint y los tipos de las dos apps, unos 10 segundos.
- `npm run build` si tocas la configuración de Vite, el service worker o algo que solo se ve compilado.
- CI repite ESLint y el build, y además `npm audit` de las dependencias de producción. Si falla, no despliega.

## Convenciones

- **Mensajes de commit:** una línea, `<emoji> [ámbito] Descripción`, en inglés.
- **Idioma:** el código y sus comentarios en inglés; los textos de las apps y los docs, en español.
- **Dónde va cada cosa:** el dominio común en `packages/shared/domain`; en cada app, `src/modules/<módulo>/` con `application/` (lo que lee y escribe en Firebase), `ui/` (páginas y componentes) y `domain/` (lo que solo usa esa app); lo de toda la app, en `src/app/`. La UI no debería llamar a Firestore directamente: aún hay componentes que lo hacen, y se pasan a `application/` cuando se tocan.
- **Identificadores:** las tareas de los docs ([B5](v1.md#b5), [ROB-2](fiabilidad.md#rob-2)…) llevan un ancla `<a id="…">` y siempre se enlazan.
- **Las reglas son producción:** cada push a `main` despliega `firebase/firestore.rules`. Los índices, las reglas de Storage y las functions van a mano ([setup.md](setup.md)).

## Si pasa esto

| Síntoma | Qué hacer |
| --- | --- |
| Los emuladores no arrancan y la terminal menciona Java | Java 21 no está en el `PATH` (ver Requisitos) |
| El emulador de Firestore falla con valores nulos | Arráncalo con `npm run emulators` o `npm run dev`, no con `firebase emulators:start`: el script pone Java en inglés, y en español falla |
| Los emuladores dicen `Port … is not open`, o una app sale en otro puerto | Hay otro `npm run dev` o unos emuladores abiertos. `lsof -i :5502` (o el puerto que sea) para encontrarlo y cerrarlo |
| El seed dice «No responden los emuladores» | Arranca antes `npm run emulators`, o usa `npm run dev`, que hace las dos cosas |
| Faltan datos o están a medias en los emuladores | `npm run seed:emulators -- --reset` lo carga todo otra vez |
| Las fotos de incidencias y partes no salen en local | El emulador de Storage no estaba cuando corrió el seed: `npm run seed:emulators -- --reset` |
| Un cambio no aparece en el navegador | Vite a veces sirve el módulo viejo por la «ç» del nombre de la carpeta. Reinicia el servidor de Vite; se arregla del todo renombrando la carpeta local a `gobernansa` |
| El navegador no se fía del certificado de `https://localhost` | La autoridad de mkcert no llegó a instalarse, por ejemplo porque se canceló la contraseña. Borra `~/.vite-plugin-mkcert` y arranca otra vez |
| El enlace de acceso no entra en los emuladores | Ábrelo en el mismo navegador donde lo pediste, y que sea el último que salió |
| En producción, una consulta falla pidiendo un índice | Añádelo a `firebase/firestore.indexes.json` y despliégalo a mano ([índices](setup.md#indices)). Los emuladores no los necesitan |
| Tras desplegar se sigue viendo la versión anterior | Es el service worker: recarga dos veces |
| Un error de producción tiene la pila ilegible | `pbpaste \| npm run symbolicate -- <versión>`, con la versión que muestra **Errores** ([MON-10](fiabilidad.md#mon-10)) |
| ESLint se queja del orden de los imports | `npm run lint` lo arregla |
