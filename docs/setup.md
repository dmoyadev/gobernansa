# Configuración de Firebase

Lo que necesita el proyecto real para que todo funcione. CI solo despliega las reglas de Firestore; lo demás (las reglas de Storage, los índices y las functions) se configura o se despliega a mano. Los roles y el modelo de datos están en [datos.md](datos.md), y los emuladores y la demo local en [desarrollo.md](desarrollo.md).

<a id="reglas"></a>

## 1. Reglas de seguridad

[`firestore.rules`](../firebase/firestore.rules) cubre todo lo que las apps leen y escriben. Se probó en el emulador local con cada flujo (como vecino y como gestor), e impide a un vecino cambiar el estado de una incidencia, inflar los votos, borrar incidencias de otros, publicar como otra persona o como la administración y leer los datos de otros usuarios.

Cada push a `main` las despliega antes que las apps, así que se cambian aquí y no en la consola: un cambio en la consola lo pisa el siguiente push. Si un despliegue rompe algo, revierte el commit o vuelve atrás en **Firebase console → Firestore → Rules** (guarda el historial), y luego arregla el fichero. Un fichero que no compila hace fallar el workflow y deja como estaban las reglas publicadas y las apps.

El emulador local también las aplica. Cada regla que comprueba la comunidad o el rol del usuario lee su perfil una vez por petición, y eso cuenta como una lectura más.

**El dinero no se escribe dos veces** ([ROB-6](fiabilidad.md#rob-6)). Las reglas rechazan lo que duplicarían un doble clic, una segunda pestaña o un lote reenviado tras perder la conexión, sin lecturas de más y también cuando una escritura hecha sin conexión llega tarde al servidor:
- un cargo, gasto, movimiento bancario, inmueble o comunidad escrito otra vez sobre uno que ya existe (cambia su `createdAt`): una emisión de cuotas, una derrama, un recibo de intereses, un extracto o un censo importados dos veces;
- el `remittanceId` o el `bankMovementId` de un cargo, o el `paymentOrderId` de una factura, cambiados por otros: un cargo va en una sola remesa a la vez y solo mientras está pendiente, y un cargo o una factura se concilian con un solo movimiento y solo mientras están pendientes (un cargo, además, si no está en una remesa); una factura pasa a otra orden de pago solo cuando la primera se ejecutó y la transferencia volvió sin pagar;
- un movimiento bancario conciliado o apartado dos veces: solo pasa de pendiente a hecho y vuelta;
- una remesa u orden de pago borrada una vez enviada o ejecutada, o cobrada o ejecutada otra vez en otro día;
- un ejercicio cerrado otra vez sobre su cierre.

Cuando se rechaza una, la acción muestra un error y no se escribe nada de su lote. Lo que necesita conocer antes el estado del servidor (marcar a mano un cargo o una factura como pagados, las devoluciones, los recibos de intereses, cerrar el ejercicio) va en una transacción, así que necesita conexión.

**Las fotos también son enlaces.** Los `assets` de una incidencia tienen que ser hasta 6 URLs de descarga de ficheros de la carpeta de Storage de quien la crea (`issues/{communityId}/{authorKey}/`); antes entraba cualquier texto, enlaces `javascript:` incluidos, que el admin y la página del proveedor muestran como enlaces. Las fotos de un proveedor tienen que ser hasta 10 URLs de descarga de ficheros de su propio parte (`workOrders/{token}/`). Las dos aceptan la URL absoluta (`https://firebasestorage.googleapis.com/v0/b/…`) o, con los emuladores, relativa (`/v0/b/…`). Ver [Storage](#storage).

**Historial** ([functions](#functions)). `audit` solo lo lee el superadmin y nadie lo escribe desde las apps: lo escriben las functions. `actions` lo crea quien tiene la sesión abierta, con su propio uid y correo, la hora del servidor y solo sus campos conocidos, cada uno con un tamaño máximo; vale cualquier tipo salvo `restore`, que solo escribe la función de restaurar. Solo lo lee el superadmin, y nunca se cambia ni se borra.

**Storage** tiene sus propias reglas, [`storage.rules`](../firebase/storage.rules), que desde las apps solo dejan crear ficheros, nunca cambiarlos, borrarlos ni listarlos. Los demás abren un fichero por su URL de descarga, cuyo token se salta las reglas.
- **Fotos y vídeos de una incidencia**: en la carpeta de la clave secreta de quien la crea, solo su dueño, mientras sea vecino de esa comunidad y no esté bloqueado (como la regla de creación de `issues` en Firestore). Imágenes de hasta 20 MB (jpeg, png, webp, gif, heic, heif, avif) y vídeos de hasta 100 MB (mp4, mov, webm).
- **Fotos de un proveedor**: solo imágenes, de hasta 20 MB, mientras su parte exista, no esté anulado y esté enviado, aceptado o programado. El token es su única credencial, como en Firestore.
- **Lecturas**: las reglas leen Firestore, y eso cuenta: dos documentos por cada subida a una incidencia (la clave y el perfil) y uno por la de un parte, más otro cuando la app pide después la URL de descarga.

CI no despliega `storage.rules`: tras cada cambio, `npx firebase deploy --only storage --project dmoyadev-gobernansa`. La subida de una foto de un vecino está probada en la demo local; las fotos de un proveedor y los casos que las reglas tienen que rechazar (la clave de otro, otra comunidad, un vecino bloqueado, otro tipo, demasiado grande, un parte anulado o terminado) están por probar en el emulador.

<a id="indices"></a>

## 2. Índices

La primera vez que se ejecuta cada una de estas consultas, Firestore escribe un error en la consola del navegador con un enlace que crea el índice:

| Función | Índice |
| --- | --- |
| Votos que quedan este mes, en el inicio y en la incidencia | Compuesto sobre el **grupo de colecciones** `votes`: `voterId` ascendente, `votedAt` ascendente (Firestore → Indexes → Composite, ámbito «Collection group») |
| Filtro «Mis incidencias» de la lista de incidencias | Compuesto sobre `issues`: `authorKey` ascendente, `createdAt` descendente (el antiguo sobre `createdBy` puede borrarse) |

Los comentarios solo se ordenan por fecha, así que no necesitan índice.

| Función del admin | Índice |
| --- | --- |
| Liquidación anual de un ejercicio cerrado: los cargos que vencían en él y se pagaron después | Compuesto sobre `charges`: `paidAt` ascendente, `dueDate` ascendente |

La página **Errores** del admin (solo el equipo) ordena los errores por cuándo se vieron por última vez, y cada filtro necesita su índice. Firestore los combina cuando hay varios filtros:

| Función | Índice |
| --- | --- |
| Errores por estado (la página abre en los pendientes) | Compuesto sobre `errors`: `status` ascendente, `lastSeen` descendente |
| Errores por app | Compuesto sobre `errors`: `app` ascendente, `lastSeen` descendente |
| Errores por tipo | Compuesto sobre `errors`: `code` ascendente, `lastSeen` descendente |
| Errores nuevos en una versión | Compuesto sobre `errors`: `firstRelease` ascendente, `lastSeen` descendente |
| Errores, los urgentes primero | Los sirven los de estado y tipo; si Firestore pide uno propio, compuesto sobre `errors`: `status` ascendente, `code` ascendente, `lastSeen` descendente |
| Errores, el recuento de urgentes y de los que han vuelto en la cabecera ([MON-9](fiabilidad.md#mon-9)) | Ninguno: un recuento solo con igualdades (`status` con `code`, o `status` con `seenSinceResolved`), que sirven los índices de un campo |
| Errores → Limpiar caducadas | De un campo sobre el **grupo de colecciones** `samples`: `expiresAt` ascendente (Firestore → Indexes → Single field → Add exemption, colección `samples`, ámbito «Collection group») |
| Errores, la última copia de seguridad ([ROB-2](fiabilidad.md#rob-2)) | Ninguno: un solo documento, `ops/backup` |
| Errores → Rendimiento ([MON-6](fiabilidad.md#mon-6)) | Ninguno: los documentos de cada día por su id (`vitals/{app}_{día}`), hasta 30 por consulta |
| `npm run backup` ([ROB-2](fiabilidad.md#rob-2)) | Ninguno: cada grupo de colecciones sin filtros, por orden de nombre, que Firestore sirve solo |

`ops` solo se escribe con el Admin SDK (el script de copias) y solo lo lee el equipo; `vitals` recibe el rendimiento de las sesiones muestreadas, una escritura cada una y sin lecturas, y las reglas limitan lo que añade cada escritura ([MON-6](fiabilidad.md#mon-6)).

Las muestras caducan 30 días después de tomarse (`expiresAt`), y las borra el borrado de lo caducado ([plazos](#plazos)); **Limpiar caducadas** también, junto con los errores resueltos o ignorados que llevan 180 días sin volver.

El **Historial** del superadmin ([functions](#functions)) lista primero lo más nuevo, y cada filtro necesita su índice. Firestore los combina cuando hay varios filtros:

| Función | Índice |
| --- | --- |
| Historial → Cambios, por comunidad, colección, operación o persona | Compuesto sobre `audit`: `communityId` (o `collection`, `op`, `actorId`) ascendente, `at` descendente |
| Historial → Versiones de este documento | Compuesto sobre `audit`: `path` ascendente, `at` descendente |
| Historial → Acciones, por persona, tipo o app | Compuesto sobre `actions`: `uid` (o `type`, `app`) ascendente, `at` descendente |
| Las copias de documentos enteros | Ninguno: `before` y `after` de `audit` y `meta` de `actions` están exentos (`fieldOverrides`), para que no sumen una entrada de índice por campo a cada escritura |
| Borrado de lo caducado ([plazos](#plazos)) | Compuesto sobre `audit` y sobre `actions`: `keep` ascendente, `at` ascendente. De un campo sobre el **grupo de colecciones** `activity`: `at` ascendente (una entrada de `fieldOverrides`, que mantiene también el ascendente y el descendente de la propia colección) |

Todos los índices de esta sección están en `firebase/firestore.indexes.json`. CI solo despliega las reglas, así que producción los recibe a mano, también en el plan gratuito: `npx firebase deploy --only firestore:indexes --project dmoyadev-gobernansa`. Hasta entonces fallan los filtros del Historial.

<a id="storage"></a>

## 3. Storage: fotos y vídeos de incidencias y partes

Las fotos y vídeos que los vecinos adjuntan a una incidencia, y los que añade un proveedor al terminar un parte de trabajo, van al bucket de Storage del proyecto ([A4.6](v1.md#a4)) desde la webapp (`uploadMedia()` en `apps/webapp/src/app/infrastructure/storage.ts`). Storage necesita Blaze ([B1](v1.md#b1)): hasta entonces producción se compila sin bucket y oculta los selectores, así que las incidencias se crean y los trabajos se terminan sin fotos.

- **Carpetas**: `issues/{communityId}/{authorKey}/`, la clave secreta de quien la crea y no su uid, para que una URL que ven todos los vecinos no diga quién la creó ([quién crea una incidencia](datos.md#autor)); y `workOrders/{token}/`. Cada fichero se llama con un token aleatorio, su nombre y la extensión de su tipo, para que nadie encuentre los ficheros de otro por su nombre.
- **Límites** (las [reglas](#reglas)): hasta 6 por incidencia y 10 por parte; imágenes de hasta 20 MB, y vídeos de incidencia mp4, mov o webm de hasta 100 MB. El navegador reduce las fotos a JPEG de 1920 px antes de subirlas; las que no puede leer (HEIC, en casi todos los navegadores salvo Safari) y los vídeos van tal cual, sin convertir, así que una foto HEIC solo se ve en Safari.
- **URLs**: Firestore guarda la URL de descarga de cada fichero, cuyo token lo abre sin cuenta, como hace el proveedor. En producción son absolutas (`https://firebasestorage.googleapis.com/v0/b/…`). Con los emuladores son relativas (`/v0/b/…`) y el servidor de la propia página las pasa al emulador de Storage, así que también se abren desde un móvil en la demo local. Las incidencias y partes de antes pueden tener aún URLs del servicio de fotos anterior: se ven mientras exista esa cuenta, pero las reglas solo aceptan URLs de Storage en las nuevas.
- **Borrado**: `purgeOldMedia`, programada con las [functions](#functions), cada domingo a las 05:00 (Madrid). Borra las de una incidencia eliminada hace más de 90 días, quitándolas de sus `assets` para que una incidencia restaurada no muestre enlaces rotos, y de la copia que guardan sus partes (`issue.assets`), para que la página del proveedor no muestre ninguna en vez de rotas; y las subidas hace más de 90 días que no tiene ninguna incidencia ni parte (un guardado que falló). Las de una incidencia o un parte que siguen ahí se quedan. Lista todos los ficheros de las dos carpetas y lee las incidencias de cada autor con ficheros antiguos, una consulta por carpeta, y, cuando se borra alguno, los partes de su comunidad, una consulta por comunidad.
- **Fuera de las copias**: `npm run backup` copia Firestore, no el bucket ([ROB-2](fiabilidad.md#rob-2), [B5](v1.md#b5)).
- **Límites conocidos**: las listas cargan la foto entera como miniatura; las reglas no pueden contar, así que quien tenga una clave o el token de un parte puede subir cualquier número de ficheros (las listas de Firestore sí tienen tope); una subida que rechazan las reglas muestra el error genérico de conexión.
- **Coste**: la parte gratuita de Storage solo cubre buckets en regiones de EE. UU., así que un bucket en la UE se paga desde el primer GB. Las lecturas de Firestore que hacen las reglas están en [reglas](#reglas).

Para activarlo, con el proyecto ya en Blaze:

1. **Firebase console → Storage → Get started**: **production mode** (el modo de prueba deja el bucket abierto a cualquiera durante 30 días) y una ubicación en la UE ([GAR-3](competencia.md#gar-3)), p. ej. `europe-southwest1` (Madrid). La ubicación no se puede cambiar después.
2. En seguida, despliega las reglas a mano, porque CI no lo hace: `npx firebase deploy --only storage --project dmoyadev-gobernansa`.
3. El primer despliegue pide dejar que las reglas de Storage lean Firestore (da el rol **Firebase Rules Firestore Service Agent**): acéptalo, o se rechazará toda subida, porque las reglas leen el perfil del usuario, su clave y el parte.
4. Pon el bucket nuevo (`storageBucket` en **Project settings → Your apps**) en el secreto de GitHub `VITE_FIREBASE_STORAGE_BUCKET` ([secretos](#secretos)), sustituyendo cualquier valor anterior, y descomenta su línea en los dos workflows, `.github/workflows/firebase-hosting-merge.yml` y `firebase-hosting-pull-request.yml`. El siguiente despliegue ya muestra los selectores.
5. Vuelve a desplegar las [functions](#functions), aunque no hayan cambiado: toman el nombre del bucket al desplegarse, y `purgeOldMedia` no hace nada sin él.

<a id="secretos"></a>

## 4. Secretos de GitHub para el despliegue

Los workflows pasan estos, que se añaden en **GitHub → Settings → Secrets and variables → Actions**:

| Secreto | Valor |
| --- | --- |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` en **Project settings → Your apps**. Su línea está comentada en los dos workflows hasta que exista el bucket, así que las apps ocultan los selectores de fotos ([Storage](#storage)) |
| `VITE_FIREBASE_VAPID_KEY` | Firebase console → Project settings → Cloud Messaging → Web Push certificates |
| `VITE_MAIL_MODE` | `demo` (o sin poner) hasta instalar la extensión de correo, luego `extension`; ver [correo saliente](datos.md#correo) |
| `VITE_APP_CHECK_KEY` | El id de la clave de reCAPTCHA de [App Check](#app-check) (sin poner: sin App Check) |

El despliegue de las reglas usa la misma cuenta de servicio que el de hosting (`FIREBASE_SERVICE_ACCOUNT_DMOYADEV_GOBERNANSA`). En **Google Cloud console → IAM**, dale a esa cuenta (`github-action-…@dmoyadev-gobernansa.iam.gserviceaccount.com`) los roles **Firebase Rules Admin** y **Service Usage Consumer**, o el paso de las reglas falla por permisos.

<a id="hosting"></a>

## 5. Hosting del admin y la landing

El admin (`apps/admin`) tiene su propio sitio de Hosting, `gobernansa-admin`, junto al sitio por defecto de la webapp, `dmoyadev-gobernansa`. Los dos se despliegan en cada push a `main` (y en un canal de vista previa en cada pull request), primero la webapp: mientras no exista el sitio del admin su paso falla y el workflow sale en rojo, pero la webapp ya está desplegada. Los sitios extra y los dominios propios entran en el plan gratuito.

1. Crea el sitio, en **Firebase console → Hosting → Add another site** con el id `gobernansa-admin`, o con:
   ```bash
   npx firebase hosting:sites:create gobernansa-admin --project dmoyadev-gobernansa
   ```
2. Comprueba el id del sitio de la webapp con `npx firebase hosting:sites:list --project dmoyadev-gobernansa`. `.firebaserc` asigna el destino `webapp` a `dmoyadev-gobernansa`; si el sitio por defecto tiene otro id, cámbialo allí.
3. **Hosting → gobernansa-admin → Add custom domain**: `admin.gobernansa.dmoya.dev`, y añade en el DNS de `dmoya.dev` los registros que muestre el asistente. El certificado puede tardar unas horas.
4. **Authentication → Settings → Authorized domains → Add domain**: `admin.gobernansa.dmoya.dev` y `gobernansa-admin.web.app`. Sin ellos, el admin no puede enviar los correos con enlace (confirmar un correo, crear una contraseña nueva). Las URLs de vista previa de los pull requests no están autorizadas (la lista no admite comodines), así que allí no se puede entrar.

Para desplegar a mano: `npm run build && npx firebase deploy --only hosting:admin` (o `hosting:webapp`).

**Landing.** `apps/landing` es una página HTML sin build que sirve GitHub Pages: cada push a `main` que la toca la despliega (`.github/workflows/landing-pages.yml`), una vez puesto **Settings → Pages → Source** en GitHub Actions. Sus rutas son relativas, así que funciona tanto bajo `/gobernansa/` como en su propio dominio ([A2](v1.md#a2)). Su formulario de demo no toca Firebase: manda cada solicitud a un bot de Telegram, cuya dirección, con el token y el id del chat, va en una constante, `BOT`, al revés y en base64. Eso solo aparta a los buscadores de tokens; quien lea el código puede sacarlo: si alguien abusa del bot, revoca el token en @BotFather y pon el nuevo.

<a id="pwa"></a>

## 6. App instalable

Las dos apps se instalan desde el navegador como aplicaciones (Chrome y Edge lo ofrecen; Safari las añade desde su menú de compartir, y la webapp lo explica en iPhone y iPad) y abren sin conexión. No hay nada que configurar: está todo en el `public/` de cada app y en `firebase.json`, en el plan gratuito.

- **Manifiesto e iconos**: `public/manifest.webmanifest`, enlazado desde `index.html` con las etiquetas de iOS. Los iconos (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) son el isotipo, blanco sobre el azul marino de la marca en la webapp y coral sobre blanco en el admin. El de la webapp tiene accesos directos a Nueva incidencia, Reservas y Mis recibos.
- **Service worker**: `public/sw.js`, escrito a mano y registrado por `packages/shared/application/pwa.ts`. Guarda `index.html` y los ficheros que carga, sirve desde la caché los `/assets/*` con hash de Vite y las páginas desde la red, con la guardada si no hay conexión. Otros orígenes (Firestore, las APIs de Google, las fotos de Storage) y las escrituras van directos a la red. En `localhost` no guarda nada, para que el servidor de Vite y la recarga en caliente funcionen como siempre: pruébalo sin conexión en el canal de vista previa de un pull request o en producción (DevTools → Network → Offline).
- **Actualizaciones**: tras cada despliegue, el worker guarda el `index.html` nuevo y descarta los ficheros con hash viejos. Una app abierta comprueba `index.html` cada vez que vuelve a primer plano (unos cientos de bytes, sin lecturas) y muestra **Nueva versión disponible · Actualizar**; un `sw.js` nuevo también espera a ese botón para tomar el control. Cambiar el nombre de sus cachés (`shell-v1`, `assets-v1`) descarta las viejas cuando lo hace.
- **Notificaciones push**: llegan por el mismo `sw.js`, cuyo registro recibe `getToken`. `firebase-messaging-sw.js` se queda como una línea que lo importa, para los dispositivos que las activaron antes y aún tienen ese worker y su token; puede irse cuando las hayan vuelto a activar.
- **Cabeceras de Hosting**: `firebase.json` sirve las páginas (`/`, `index.html` y toda ruta sin extensión, las rutas de la app), los workers y el manifiesto con `Cache-Control: no-cache` en vez de la hora por defecto de Hosting, para que el navegador los compruebe cada vez y un despliegue llegue en el acto (un fichero sin cambios es un 304 corto). Los `/assets/**` con hash de Vite se guardan un año, porque su nombre cambia con su contenido. Las dos reglas nunca coinciden en la misma ruta, así que da igual cuál aplicaría antes Hosting; los iconos y las imágenes se quedan con la hora por defecto.
- **Datos sin conexión**: Firestore guarda lo que lee en IndexedDB (`persistentLocalCache` con el gestor de varias pestañas, en `packages/shared/infrastructure/firebase.ts`), así que la app instalada muestra los últimos datos sin conexión y envía los cambios hechos sin ella cuando vuelve. No suma lecturas: se pregunta antes al servidor, las escuchas que se abren otra vez en menos de 30 minutos solo pagan lo que cambió, y varias pestañas comparten una conexión. Con los emuladores se queda en memoria, para que sus datos, que se reinician, no se mezclen con los de producción. Cerrar sesión lo borra del dispositivo (`terminate` y `clearIndexedDbPersistence` en `logout()`, `packages/shared/application/useAuth.ts`), lo que también para el Firestore de las demás pestañas abiertas; esas recargan a `/login` al ver que se acabó la sesión. Los cambios aún sin enviar se pierden con él, y si otra pestaña lo retiene más de 3 segundos, se cierra la sesión sin borrarlo.
- **Sin cubrir**: las imágenes de `public/` no se guardan. Las tipografías se sirven desde Hosting con el resto de `/assets`, así que sin conexión salen de la caché. No hay ficha en las tiendas de aplicaciones.

<a id="interruptores"></a>

## 7. Interruptores remotos

Las dos apps leen estos interruptores de **Firebase console → Remote Config** al abrirse y otra vez en cuanto se publica un cambio, sin desplegar y sin lecturas de Firestore ([ROB-5](fiabilidad.md#rob-5)). Remote Config es gratis. Un parámetro que no existe, o un navegador que no lo alcanza, se queda con el valor por defecto, así que no hay que crear nada hasta que haga falta. Para usar uno, crea el parámetro con este nombre y tipo exactos y luego **Publish changes**:

| Parámetro | Tipo | Por defecto | Qué hace |
| --- | --- | --- | --- |
| `payments` | Boolean | `true` | `false` oculta los botones **Pagar** de cargos y reservas en la webapp |
| `remittances` | Boolean | `true` | `false` cambia por un aviso los formularios del admin que generan remesas y órdenes de pago |
| `aeatFiles` | Boolean | `true` | `false` desactiva la descarga del 347, el 190 y el 184 en el admin |
| `censusImport` | Boolean | `true` | `false` desactiva la importación de un censo o una cartera en el admin |
| `errorReporting` | Boolean | `true` | `false` deja de enviar errores a la página **Errores** |
| `actionsLog` | Boolean | `true` | `false` deja de registrar lo que hace cada usuario para las **Acciones** del **Historial** ([functions](#functions)), una escritura por pantalla abierta |
| `errorSampleRate` | Number | `1` | Parte de las sesiones, de 0 a 1, cuyos errores llevan una muestra (pila, rastro y contexto); bájalo cuando los errores gasten demasiadas escrituras |
| `minVersion` | String | vacío | La versión más antigua que se permite, p. ej. `2026.11.04-1200`. Las anteriores (`VITE_RELEASE`, que se ve en el perfil de la webapp y en el menú del admin) quedan tapadas por un aviso que solo deja actualizar. Las versiones se ordenan como texto, así que basta con fecha y hora |
| `maintenance` | String | vacío | Un mensaje que se muestra en las dos apps mientras no esté vacío |

Remote Config necesita la **Firebase Installations API** y la **Firebase Remote Config API**, que un proyecto de Firebase nuevo tiene activas. Si algún día se restringe la clave de la API ([ROB-8](fiabilidad.md#rob-8)), mantén las dos en su lista, o todas las apps se quedan con los valores por defecto. Con los emuladores, las apps no preguntan a Remote Config y usan los valores por defecto, así que la demo local no hace ninguna petición a internet.

<a id="proyecto-demo"></a>

## 8. Proyecto de demo

Lo que se enseña a los despachos corre en su propio proyecto de Firebase, `gobernansa-demo`, en el plan gratuito: sus propios datos, cuota y cuentas, para que una demo nunca toque producción ni gaste la cuota de sus clientes. `.firebaserc` lo llama `demo`; si ese id está cogido, créalo con otro y cambia allí las dos menciones. Los índices están en `firebase/firestore.indexes.json` ([índices](#indices)), y `npm run deploy:demo` los despliega con las reglas; los de producción van a mano. En el plan gratuito no tiene Storage ni functions: sus incidencias no tienen fotos y su **Historial** solo llena **Acciones**. Para una demo con fotos y sin internet está la [demo local](desarrollo.md#demo-local).

Una vez:

1. **Firebase console → Add project** `gobernansa-demo`, sin Analytics. **Firestore → Create database** en `europe-southwest1` (Madrid), production mode.
2. **Authentication → Sign-in method → Email/Password**, con **Email link** y **Anonymous** desactivados: los vecinos entran con el código de su carta de acceso, que es una cuenta Email/Password en `codigo.gobernansa.dmoya.dev` que no recibe nada ([B2.4](v1.md#b2)). Gratis, como el resto de Auth en este plan. Los correos de cambio de contraseña y de confirmación cuentan para el límite diario de correos de Auth.
3. **Project settings → Your apps → Web**, y **Cloud Messaging → Web Push certificates → Generate**. Copia `.env.example` a `.env.demo.local` en la raíz y rellénalo con esa configuración y:
   - `VITE_FIREBASE_EMULATORS='false'`, `VITE_ENV_NAME='demo'` (la pestaña dice «gobernança DEMO») y `VITE_MAIL_MODE='demo'`;
   - `VITE_WEBAPP_URL='https://gobernansa-demo.web.app'`;
   - `VITE_FIREBASE_STORAGE_BUCKET=''`, vacío y no omitido, o se cuela el de `.env.local` y aparecen los selectores para subidas que fallarían;
   - `DEMO_PASSWORD`, de al menos 6 caracteres: la contraseña de todas las cuentas de la demo. Solo la lee el seed; las apps nunca la reciben.

   El build también lee `.env.local`, y `.env.demo.local` manda: lo que falte sale de allí, así que `npm run deploy:demo` se para si el proyecto no es el de demo, si los emuladores están activados o si falta `VITE_WEBAPP_URL`.
4. **Hosting → Add another site** `gobernansa-demo-admin`, y **Authentication → Settings → Authorized domains → Add** `gobernansa-demo-admin.web.app` (los dominios del sitio por defecto ya están).
5. **Project settings → Service accounts → Generate new private key**, guardada como `scripts/seed/serviceAccountKey.demo.local.json`. El seed la rechaza si su proyecto no es el `demo` de `.firebaserc`.
6. `npx firebase login --reauth` si la CLI lo pide, y luego `npm run deploy:demo` y `npm run seed:demo`.

Después:

- **Antes de cada demo:** `npm run seed:demo` la vacía y carga otra vez la demo entera, con fechas relativas a ese día. Borra las cuentas que no son de la demo y mantiene las suyas, así que quien tenga la sesión abierta la conserva; las que faltan se crean con `DEMO_PASSWORD`, así que un `DEMO_PASSWORD` nuevo solo llega a las cuentas creadas después. Gasta en escrituras más o menos el tamaño de la demo, de la cuota del propio proyecto de demo. El seed solo sube fotos al emulador de Storage, así que aquí las incidencias y los partes cargan sin ellas, con un aviso amarillo.
- **Tras una versión que merezca enseñarse:** `npm run deploy:demo`, a mano, nunca en cada push. Compila las dos apps en modo `demo` con un `VITE_RELEASE` como el de CI y despliega las reglas, los índices y los dos sitios.
- **Los errores** de la demo van a su propia página **Errores**: entra con la cuenta del equipo de la demo.
- Los dominios propios (`demo.` y `demo-admin.`) llegan con el dominio del producto ([A2](v1.md#a2)).

<a id="app-check"></a>

## 9. App Check: protección de la cuota

Las apps piden un token de App Check cuando tienen `VITE_APP_CHECK_KEY`, y nunca con los emuladores. Hasta que la consola lo exija no se bloquea nada: solo mide. Una vez por proyecto (producción y demo):

1. **Google Cloud console → Security → reCAPTCHA → Create key**, de tipo **Website**, con los dominios de las dos apps (`*.web.app` para las vistas previas de los pull requests, y los propios de [A2](v1.md#a2)). Sin casilla de verificación.
2. **Firebase console → App Check → Apps → la app web → reCAPTCHA Enterprise**, con el id de esa clave. Duración del token: la más larga que permita la consola (7 días), para que un vecino gaste pocas de las 10.000 evaluaciones gratuitas al mes.
3. El id de la clave como `VITE_APP_CHECK_KEY` en `.env.local` y `.env.demo.local`, y como secreto de GitHub ([secretos](#secretos)).
4. Despliega y vigila **App Check → APIs → Cloud Firestore** una o dos semanas: la parte de peticiones verificadas debería acercarse al 100 %. Solo entonces, **Enforce**. Las que no se verifican son instalaciones antiguas que aún no se han actualizado, o el script de otro.
5. En desarrollo, el SDK escribe un token de depuración en la consola la primera vez; añádelo en **App Check → Apps → ⋮ → Manage debug tokens**, o la app local quedará bloqueada cuando se exija. Con los emuladores no hace falta.

Restringe también la clave de la API (**Google Cloud console → APIs & Services → Credentials**) a los dominios de las apps, manteniendo las APIs de Installations y Remote Config ([interruptores](#interruptores)).

<a id="functions"></a>

## 10. Cloud Functions y el Historial

El **Historial** del admin (`/history`, solo el superadmin, `g h`) muestra cada cambio en los datos, con las versiones de cada documento y la opción de restaurar, y lo que hace cada usuario en las dos apps ([B12](v1.md#b12), casi todo [GAR-1](competencia.md#gar-1)). Los cambios los registran Cloud Functions, que necesitan Blaze ([B1](v1.md#b1)); las acciones las escriben las propias apps y funcionan en el plan gratuito. Mientras no se desplieguen las functions, **Cambios** está vacío y restaurar falla, pero **Acciones** ya se llena.

- **Node**: corren en Node 24, el `engines` de `apps/functions/package.json`; los emuladores las ejecutan con el Node local, más nuevo, con un aviso. ESLint rechaza en `apps/functions/` los módulos y APIs de Node más nuevos (`node/no-unsupported-features/*`), pero aún no las novedades de JavaScript (`Promise.try`, `RegExp.escape`…): esas se revisan a mano. Node 24 tiene soporte hasta el 30/04/2028.
- **Código**: `apps/functions/`, un workspace propio (Node 24, módulos ES, `firebase-functions` 7 y `firebase-admin` 13), configurado en `firebase.json`. `auditTop`, `auditNested` y `auditDeep` son triggers de Firestore para documentos de 1, 2 y 3 niveles; `auditAccountCreated` y `auditAccountDeleted`, triggers de Auth de primera generación (la segunda no tiene), registran las cuentas; `restoreVersion` es una función invocable que solo puede usar el superadmin; `purgeExpired`, programada, borra lo caducado ([plazos](#plazos)), y `purgeOldMedia`, las fotos que ya nadie ve ([Storage](#storage)).
- **Región**: `REGION`, en `apps/functions/index.js` y en `apps/admin/src/modules/history/application/restoreVersion.ts`, es `europe-southwest1`. Los triggers de Firestore tienen que correr en la región de la base de datos; la de producción está ahí (comprobado el 16/11/2026), y el [proyecto de demo](#proyecto-demo) también se crea ahí. Un proyecto en otra región necesita cambiar los dos ficheros.
- **Despliegue** (CI solo despliega las reglas de Firestore): en Blaze, primero los [índices](#indices) y luego `npx firebase deploy --only functions --project dmoyadev-gobernansa`, y otra vez tras cada cambio en `apps/functions/`. El primero activa las APIs que necesita; si dice que se reintente en unos minutos, se reintenta. `purgeExpired` y `purgeOldMedia` corren en `europe-west1` sea cual sea `REGION`, porque Cloud Scheduler puede no estar en Madrid.

```text
audit/{eventId}       path, collection, docId, communityId? (el de la ruta, o el que lleva el documento), op create | update | delete,
                      changed (nombres de campo), before, after (enteros, o solo lo que cambió, recortado, con truncated: true),
                      authType, authId, actorId, actorName, actorEmail, actorInferred?, restoredFrom?, keep short | year | fiscal, at
                      las cuentas como path auth/{uid}, collection auth, con { email, providers, anonymous, disabled, createdAt, lastSignInAt }
actions/{id}          uid, email?, name, app webapp | admin, type signin | signout | page | print | download | view-as | view-as-exit
                      | email | password | restore, path, detail?, meta?, communityId?, viewAs?, device, keep short | year | admin, at
ops/restore-{sha1}    { uid, name, email, auditId, side, at }, de restoreVersion, con el sha1 de la ruta del documento restaurado
```

- **Cambios**: cada creación, cambio y borrado, salvo en `audit`, `actions`, `errors`, `vitals`, `ops` y la `activity` de cada comunidad (que ya es un registro); bajo `users/{uid}`, las claves secretas (`keys`), los dispositivos con notificaciones (`devices`, cuyo id es el token) y los ficheros de los documentos (`documentFiles`: su lista, `documents`, dice quién, cuándo, nombre y tamaño); y las escrituras que no cambian nada. Quién lo hizo sale de la sesión; las escrituras sin sesión, como el aviso de un proveedor, aparecen sin sesión. En los emuladores ningún evento lleva la sesión, así que se deduce de un campo de persona que pone la propia escritura (`updatedBy`, `authorId`…) y se marca `actorInferred`, y un borrado sale como desconocido. Falta comprobar que los eventos de producción traen el uid del usuario. Un documento demasiado grande para guardarlo dos veces (más de unos 900 KB) guarda solo lo que cambió, recortado, y no se puede restaurar. El superadmin ve quién creó una incidencia anónima, porque ya podía leer su `private/author`: el anonimato es ante los vecinos.
- **Reintentos**: un trigger de Firestore que falla se vuelve a ejecutar, así que un error pasajero no pierde una entrada, y cada evento escribe su entrada una sola vez (`audit/{eventId}`). Un fallo que no desaparece se reintenta hasta 24 horas (functions de segunda generación).
- **Restaurar**: **Restaurar la versión anterior** o **Restaurar esta versión** vuelve a escribir ese estado, o borra el documento si entonces no existía. Se rechaza cuando el documento ya está así, en las cuentas, en las entradas recortadas y en todo lo que cuelga de `offices/`: las facturas, el registro Verifactu y los contadores y el final de la cadena del despacho se corrigen con una rectificativa, nunca volviendo atrás. Restaurar es un cambio como cualquier otro, así que se deshace igual: deja una marca `ops/restore-*` que su propia entrada recoge (en menos de 60 segundos) para nombrar al superadmin y el cambio del que viene, y registra una acción `restore`.
- **Acciones**: las escribe `packages/shared/infrastructure/actions.ts`, un documento cada una: cada pantalla abierta, imprimir, entrar (con contraseña o con un código de acceso) y salir, pedir añadir un correo, cambiar la contraseña, empezar y terminar «Ver como vecino» y cada descarga. `name` es lo que manda la app, sin comprobar en las reglas (el uid y el correo sí se comprueban). No se envían cuando se ha agotado la cuota, ni en desarrollo contra el proyecto real. El interruptor `actionsLog` ([interruptores](#interruptores), [ROB-5](fiabilidad.md#rob-5)) las apaga.
- **Coste**: cada escritura en cualquier documento despierta un trigger, también en las colecciones que se saltan (paran en el acto): una invocación, una escritura en `audit` y, una vez por instancia, una lectura del perfil de esa persona. Una escritura masiva (importar un censo, `npm run restore`) hace una de cada por documento. Las entradas guardan documentos enteros, así que `audit` también crece en tamaño con cada cambio. Cada acción es una escritura, casi siempre una por pantalla abierta, de las 20.000 diarias del plan gratuito.

<a id="plazos"></a>

### Plazos de conservación

Cada entrada de `audit` y `actions` lleva su clase en `keep`, puesta al escribirla (`apps/functions/retention.js`, `packages/shared/infrastructure/actions.ts`; las reglas la exigen y reservan `admin` al superadmin), y se borra entera cuando se cumple su plazo. Las páginas legales de las dos apps dicen lo mismo:

| Qué | `keep` | Se guarda |
| --- | --- | --- |
| Pantallas abiertas | `short` | 90 días |
| Pantallas de una persona o un inmueble (una ruta con `uid` o `propertyId`) | `year` | 12 meses |
| Entrar y salir, descargas, impresiones, «Ver como vecino», cambios de contraseña y de correo; las cuentas (`auth/*`) | `year` | 12 meses |
| Todo lo que hace el superadmin, restauraciones incluidas | `admin` | 3 años |
| Versiones de cargos, pagos, remesas, deudas, contabilidad, presupuestos y gastos, reservas, juntas, votos, actas, inmuebles, comunidades, facturas y Verifactu | `fiscal` | Hasta el 31 de diciembre del año siguiente al cambio |
| Cualquier otra versión (perfiles, invitaciones, correo, incidencias, comentarios, partes, proveedores…) | `short` | 90 días |
| Cualquier cosa, sea cual sea su clase | | 3 años como mucho |
| La `activity` de cada comunidad, fuera del Historial | | 5 años desde el final de cada año |
| Las muestras de los errores | | 30 días (`expiresAt`) |
| Fotos y vídeos de una incidencia borrada, o que nunca se adjuntaron ([Storage](#storage)) | | 90 días |

- **Quién borra**: en Blaze, `purgeExpired`, cada noche a las 04:00 (Madrid), hasta 10.000 documentos por noche (uno de los tres trabajos gratuitos de Cloud Scheduler; `purgeOldMedia` es el segundo). En el plan gratuito, la copia de seguridad ([ROB-2](fiabilidad.md#rob-2)) después de cada copia, y `npm run purge`, que cuenta lo caducado y, con `--delete`, lo borra. La copia diaria aún no está programada: hasta entonces, `npm run purge -- --delete` una vez al mes, y otra vez mientras avise de que llegó a los 10.000 y queda más.
- **Coste**: una lectura y un borrado por documento, hasta 10.000 por pasada, la mitad de los borrados diarios del plan gratuito; contar, una lectura por cada 1.000.
- **Restaurar**: una entrada borrada se lleva su versión, así que ya no se puede restaurar. Las copias la guardan hasta que salen de las 14 últimas, salvo las `actions`, que nunca entran. Tampoco se restaura un documento de perfil cuyo fichero se borró: el fichero nunca se copió.
- **Guardado aparte**: antes de que caduque algo ligado a una brecha de seguridad, una reclamación o una solicitud de acceso, exporta solo las entradas de `audit` y `actions` de ese caso (por el `uid` de la persona, el `communityId` de la comunidad o el `path` del documento), cífralas con la clave de las copias (`encrypt` en `scripts/backup/archive.js`), pon fecha al fichero y guárdalo fuera de la carpeta de las copias hasta que se resuelva. Una copia entera (`npm run backup`) solo cuando una brecha lo necesite todo, exportando antes las `actions` aparte: la copia las deja fuera y luego borra lo caducado. A mano con el Admin SDK; un script cuando llegue el primer caso.
- **Fin del contrato de un despacho**: después de entregarle la exportación de cada comunidad (**Exportar** en la comunidad), borra su historial: las entradas de `audit` con el `communityId` de sus comunidades, las que tienen el `path` bajo `offices/{officeId}`, las de las cuentas y perfiles de su gente (`auth/{uid}`, `users/{uid}` y lo que cuelga, sus `invitations`), y las `actions` de su gente (`uid`). A mano con el Admin SDK; un script cuando se vaya el primero.
