# Desarrollo

Cómo arrancar el proyecto en local, sus puertos, las convenciones y qué hacer cuando algo falla. El proyecto real de Firebase está en [setup.md](setup.md); los roles y los datos, en [datos.md](datos.md).

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
2. `npm install`. Activa también los hooks de git (`.githooks`).
3. `npm run doctor`. Comprueba Node, Java, las dependencias, `.env.local`, los puertos y los hooks, y dice cómo arreglar lo que falte.
4. `npm run dev`. Arranca los emuladores, carga el seed desde cero y sirve las dos apps. Los datos se borran cada vez que se para.

Para entrar, las cuentas están en [`scripts/seed/data/cast.js`](../scripts/seed/data/cast.js) y todas usan `DEMO_PASSWORD`. Para el admin, el despacho «Fincas Jaén»; para la webapp, cualquier vecino de la comunidad `comm1`. El emulador de Auth no envía correos: el enlace de acceso sale en la terminal de los emuladores, y `http://127.0.0.1:5501/emulator/v1/projects/dmoyadev-gobernansa/oobCodes` lista los últimos.

<a id="puertos"></a>

## Puertos

Las apps van en el 540x, las vistas del build en el 541x y los emuladores en el 550x. La demo, el entorno aislado y la comprobación de las reglas usan los suyos para poder correr junto a `npm run dev`.

| Puerto | Qué |
| --- | --- |
| 5400 · 5401 | Webapp y admin, `https://` (`npm run dev`, `dev:webapp`, `dev:admin`) |
| 5402 · 5403 | Demo local: webapp y admin, `http://` (`npm run demo`) |
| 5404 | Landing, `http://` (`npm run dev:landing`) |
| 5405 · 5406 | [Entorno aislado](#entorno-aislado): webapp y admin, `https://` (`npm run dev:isolated`) |
| 5410 · 5411 · 5414 | Vista del build de la webapp, del admin y de la landing (`npm run preview -w apps/webapp`) |
| 5500 | Interfaz de los emuladores: datos, cuentas y logs |
| 5501 · 5502 · 5504 · 5505 | Emuladores de Auth, Firestore, Storage y Functions |
| 5503 · 5506 … 5509 | Uso interno de los emuladores: el websocket de Firestore, el hub, los logs, Eventarc y Cloud Tasks |
| 5511 … 5517 | Emuladores de la demo local, diez por encima: Auth, Firestore, Storage y los internos (sin Functions ni interfaz) |
| 5521 … 5527 | Emuladores del entorno aislado, veinte por encima, los mismos que los de la demo |
| 5532 · 5533 · 5536 · 5537 | Emulador de Firestore de `npm run check:rules`, treinta por encima, solo mientras corre |

<a id="emuladores"></a>

## Emuladores

`npm run dev` arranca los emuladores de `firebase.json`, carga el seed (`--reset`) y sirve las dos apps con `VITE_FIREBASE_EMULATORS='true'` en `.env.local`. Las apps se conectan a todos los emuladores o a ninguno, porque el proyecto real rechaza sus tokens. Los de Firestore y Storage necesitan Java 21, y su primer arranque descarga sus jars (`~/.cache/firebase/emulators`, con el entorno de reglas de Storage), la única vez que necesitan internet.

- **Reglas**: se aplican los dos ficheros, el de Firestore y el de Storage.
- **Fotos**: el seed sube al emulador de Storage imágenes SVG con un rótulo, en las [carpetas de Storage](setup.md#storage), y guarda sus URLs relativas; Vite pasa `/v0/b` al emulador. El seed no tiene vídeos. Sin el emulador de Storage (`FIREBASE_STORAGE_EMULATOR_HOST` sin poner), las incidencias y los partes cargan sin fotos, con un aviso amarillo.
- **Functions**: el Historial registra cada cambio hecho en las apps y restaura, deduciendo quién hizo cada cambio ([functions](setup.md#functions)).
- **Remote Config**: no se lee; se aplican los valores por defecto de los [interruptores](setup.md#interruptores).
- **Ver o cambiar datos** sin abrir la interfaz: `npm run db -- get communities/comm1` (un documento), `get communities/comm1/meetings` (una colección), `update <ruta> '{"campo":1}'`, `set` y `delete`. Solo habla con un emulador, nunca con el proyecto real; con `--isolated` o `--demo`, con los de esos entornos.

<a id="demo-local"></a>

## Demo local

`npm run demo` (`scripts/demo.js`) monta la demo de ventas solo en el portátil, sin internet, y un móvil en la misma red abre la webapp: el guion está en [demo.md](demo.md). Qué necesita y qué hace:

- **Antes**: Java 21 en el `PATH` y `DEMO_PASSWORD` en `.env.local`, la contraseña de todas las cuentas. La primera vez en un equipo necesita internet una vez, para descargar los jars de los emuladores; el script avisa cuando falta alguno.
- **Puertos**, aparte de los de `npm run dev`, para que puedan correr a la vez (ver [Puertos](#puertos)). El proyecto es `demo-gobernansa`, que solo existe en los emuladores.
- **Qué hace**: arranca los emuladores de Auth, Firestore y Storage, carga el seed con sus fotos, compila las dos apps contra ellos con la dirección de red del portátil y las sirve por http en todas las interfaces, con las rutas de los emuladores bajo la de cada página. Muestra las dos direcciones, un QR de la webapp y las cuentas. El admin se abre en `http://localhost:5403` en el portátil, no en la dirección de red: copiar enlaces y `crypto` necesitan localhost.
- **Sin functions**: el Historial no registra cambios ni puede restaurar ahí, y lo dice; **Acciones** sí se llena.
- **`npm run demo:reset`** carga otra vez los datos mientras corre, sin cerrar la sesión de nadie. Ctrl+C o cerrar la terminal lo para todo. Un reinicio completo cierra la sesión de los móviles, y un cambio de red lo necesita, porque la dirección va en el build.
- **Proxy**: quita `HTTP(S)_PROXY` a los emuladores; con él, las reglas de Storage no leían Firestore y rechazaban toda subida.
- **Red**: mientras corre, cualquiera en esa red llega a los emuladores. Los datos son inventados, pero mejor el punto de acceso del móvil que la wifi de invitados de un cliente.

<a id="entorno-aislado"></a>

## Entorno aislado

`npm run dev:isolated` levanta un segundo entorno de desarrollo completo, con sus propios emuladores y su seed, junto a `npm run dev` y sin tocar sus datos: para probar algo destructivo o comparar dos ramas. Sirve la webapp en `https://localhost:5405` y el admin en `https://localhost:5406`, con recarga en caliente, y usa el proyecto `demo-gobernansa` y los emuladores veinte puertos por encima ([Puertos](#puertos)). Como la demo, no lleva functions. `npm run dev:isolated -- --reset` carga otra vez los datos mientras corre, y `npm run db -- --isolated …` los lee y escribe.

## Antes de cada commit

- Al hacer commit, un hook pasa ESLint a los ficheros del commit y comprueba el formato del mensaje. `git commit --no-verify` se lo salta.
- `npm run check`: ESLint y los tipos de las dos apps, unos 10 segundos.
- `npm run check:rules` si tocas `firebase/firestore.rules`: arranca un emulador de Firestore propio y comprueba unas 120 cosas que cada papel debe y no debe poder hacer (incidencias, finanzas, códigos de alta, errores y rendimiento). Si una regla cambia a propósito, la comprobación se actualiza en `scripts/check-rules.js`.
- `npm run build` si tocas la configuración de Vite, el service worker o algo que solo se ve compilado.
- CI repite ESLint, la comprobación de las reglas y el build, y además `npm audit` de las dependencias de producción. Si algo falla, no despliega.

## Convenciones

- **Mensajes de commit:** una línea, `<emoji> [ámbito] Descripción`, en inglés.
- **Idioma:** el código y sus comentarios en inglés; los textos de las apps y los docs, en español.
- **Dónde va cada cosa:** el dominio común en `packages/shared/domain`; en cada app, `src/modules/<módulo>/` con `application/` (lo que lee y escribe en Firebase), `ui/` (páginas y componentes) y `domain/` (lo de esa app sola), y lo de toda la app en `src/app/`. Firestore en `ui/` es un error de ESLint; importar de la otra app, un aviso: lo común va en `packages/shared`.
- **Páginas y formularios:** una página no pasa de unas 800 líneas; una tarjeta grande va a su propio componente al lado, con los estilos de la página en un parcial compartido (`<style lang="scss" scoped src="./bank.scss" />`). En el panel, todo formulario de crear o editar es `FormCard` abierto con `useNewForm` (`src/app/ux/`), y la cabecera, las tarjetas, los campos y los botones del pie salen de `page.scss`.
- **Referencias de Firestore:** las referencias y los cursores de las consultas van en `shallowRef`, no en `ref`; con `ref`, la caché sin conexión fallaba en producción.
- **Identificadores:** las tareas de los docs ([B5](v1.md#b5), [ROB-2](fiabilidad.md#rob-2)…) llevan un ancla `<a id="…">` y siempre se enlazan.
- **Las reglas son producción:** cada push a `main` despliega `firebase/firestore.rules` y los índices de `firebase/firestore.indexes.json`. Las reglas de Storage y las functions van a mano ([setup.md](setup.md)).

## Si pasa esto

| Síntoma | Qué hacer |
| --- | --- |
| Los emuladores no arrancan y la terminal menciona Java | Java 21 no está en el `PATH` (ver Requisitos) |
| El emulador de Firestore falla con valores nulos | Arráncalo con `npm run emulators` o `npm run dev`, no con `firebase emulators:start`: el script pone Java en inglés, y en español falla |
| Los emuladores dicen `Port … is not open`, o una app sale en otro puerto | Hay otro `npm run dev` o unos emuladores abiertos. `lsof -i :5502` (o el puerto que sea) para encontrarlo y cerrarlo |
| El seed dice «No responden los emuladores» | Arranca antes `npm run emulators`, o usa `npm run dev`, que hace las dos cosas |
| Faltan datos o fotos de incidencias y partes en los emuladores | `npm run seed:emulators -- --reset` lo carga todo otra vez, con el emulador de Storage arrancado |
| Un cambio no aparece en el navegador | Vite a veces sirve el módulo viejo por la «ç» del nombre de la carpeta. Reinicia el servidor de Vite; se arregla del todo renombrando la carpeta local a `gobernansa` |
| El navegador no se fía del certificado de `https://localhost` | La autoridad de mkcert no llegó a instalarse, por ejemplo porque se canceló la contraseña. Borra `~/.vite-plugin-mkcert` y arranca otra vez |
| El enlace de acceso no entra en los emuladores | Ábrelo en el mismo navegador donde lo pediste (ahí queda el correo), y que sea el último que salió |
| En producción, una consulta falla pidiendo un índice | Añádelo a `firebase/firestore.indexes.json`: el push a `main` lo despliega ([índices](setup.md#indices)). Los emuladores no los necesitan |
| `npm run check:rules` falla | O las reglas tienen un error, o cambiaron a propósito y la comprobación se quedó atrás: cada fallo dice qué papel debería o no debería poder hacer qué, en `scripts/check-rules.js` |
| Tras desplegar se sigue viendo la versión anterior | Es el service worker: recarga dos veces |
| Un error de producción tiene la pila ilegible | `pbpaste \| npm run symbolicate -- <versión>`, con la versión que muestra **Errores** ([MON-10](fiabilidad.md#mon-10)) |
| ESLint se queja del orden de los imports | `npm run lint` lo arregla |
| El commit se para | El hook encontró errores de ESLint en los ficheros del commit, o el mensaje no es `<emoji> [ámbito] Descripción` en una línea |
| No sé qué falta en un equipo nuevo | `npm run doctor` |
