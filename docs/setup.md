# Configuración de Firebase

Lo que necesita el proyecto real para que todo funcione. CI despliega las dos webs y las reglas de Firestore; lo demás (las reglas de Storage, los índices y las functions) se configura o se despliega a mano. Los roles y el modelo de datos están en [datos.md](datos.md), y los emuladores y la demo local, en [desarrollo.md](desarrollo.md).

<a id="reglas"></a>

## 1. Reglas de seguridad

[`firestore.rules`](../firebase/firestore.rules) cubre todo lo que las apps leen y escriben. Se probó en el emulador con cada flujo, como vecino y como gestor: un vecino no puede cambiar el estado de una incidencia, inflar los votos, borrar incidencias de otros, publicar como otra persona o como la administración, ni leer los datos de otros usuarios.

Cada push a `main` las despliega antes que las apps, así que se cambian en el fichero y no en la consola: el siguiente push pisa lo hecho en la consola. Un fichero que no compila hace fallar el workflow y deja como estaban las reglas y las apps. Cómo volver atrás, en la sección 5 de [fiabilidad.md](fiabilidad.md). El emulador también las aplica. Cada regla que comprueba la comunidad o el rol lee el perfil del usuario una vez por petición, y eso es una lectura más.

**El dinero no se escribe dos veces** ([ROB-6](fiabilidad.md#rob-6)). Las reglas rechazan lo que duplicarían un doble clic, una segunda pestaña o un lote reenviado tras perder la conexión, sin lecturas de más y también cuando una escritura hecha sin conexión llega tarde:
- un cargo, gasto, movimiento bancario, inmueble o comunidad escrito otra vez sobre uno que ya existe (cambia su `createdAt`): una emisión de cuotas, una derrama, un recibo de intereses, un extracto o un censo importados dos veces;
- el `remittanceId` o el `bankMovementId` de un cargo, o el `paymentOrderId` de una factura, cambiados por otros. Un cargo va en una sola remesa a la vez y solo mientras está pendiente. Un cargo o una factura se concilian con un solo movimiento y solo mientras están pendientes (un cargo, además, si no está en una remesa). Una factura pasa a otra orden de pago solo cuando la primera se ejecutó y la transferencia volvió sin pagar;
- un movimiento bancario conciliado o apartado dos veces: solo pasa de pendiente a hecho y vuelta;
- una remesa u orden de pago borrada una vez enviada o ejecutada, o cobrada o ejecutada otra vez en otro día;
- un ejercicio cerrado otra vez sobre su cierre.

Si se rechaza una, la acción muestra un error y no se escribe nada de su lote. Lo que necesita conocer antes el estado del servidor (marcar a mano un cargo o una factura como pagados, las devoluciones, los recibos de intereses, cerrar el ejercicio) va en una transacción, así que necesita conexión.

**Las fotos son enlaces de Storage.** Los `assets` de una incidencia son hasta 6 URLs de descarga de ficheros de la carpeta de quien la crea (`issues/{communityId}/{authorKey}/`), y las fotos de un proveedor, hasta 10 de su propio parte (`workOrders/{token}/`). Antes entraba cualquier texto, enlaces `javascript:` incluidos, que el admin y la página del proveedor muestran como enlaces. Valen la URL absoluta (`https://firebasestorage.googleapis.com/v0/b/…`) o, con los emuladores, la relativa (`/v0/b/…`).

**Historial** ([functions](#functions)). `audit` solo lo lee el superadmin y solo lo escriben las functions. `actions` lo crea quien tiene la sesión abierta, con su propio uid y correo, la hora del servidor y solo sus campos conocidos, cada uno con un tamaño máximo; vale cualquier tipo salvo `restore`, que solo escribe la función de restaurar. Solo lo lee el superadmin, y nunca se cambia ni se borra.

**Storage** tiene sus propias reglas, [`storage.rules`](../firebase/storage.rules). Desde las apps solo dejan crear ficheros, nunca cambiarlos, borrarlos ni listarlos. Los demás abren un fichero por su URL de descarga, cuyo token se salta las reglas.
- **Incidencias:** en la carpeta de la clave secreta de quien la crea, solo su dueño, mientras sea vecino de esa comunidad y no esté bloqueado (como la creación de `issues` en Firestore). Imágenes de hasta 20 MB (jpeg, png, webp, gif, heic, heif, avif) y vídeos de hasta 100 MB (mp4, mov, webm).
- **Proveedores:** solo imágenes de hasta 20 MB, mientras su parte exista, no esté anulado y esté enviado, aceptado o programado. El token es su única credencial, como en Firestore.
- **Lecturas:** las reglas leen Firestore: dos documentos por cada subida a una incidencia (la clave y el perfil) y uno por la de un parte, más otro cuando la app pide la URL de descarga.

CI no despliega `storage.rules`: tras cada cambio, `npx firebase deploy --only storage --project dmoyadev-gobernansa`. La subida de un vecino está probada en la demo local. Falta probar en el emulador las fotos de un proveedor y lo que las reglas tienen que rechazar: la clave de otro, otra comunidad, un vecino bloqueado, otro tipo, demasiado grande, un parte anulado o terminado.

<a id="indices"></a>

## 2. Índices

Todos están en `firebase/firestore.indexes.json`. CI no los despliega, así que producción los recibe a mano, también en el plan gratuito, cada vez que el fichero cambia:

```bash
npx firebase deploy --only firestore:indexes --project dmoyadev-gobernansa
```

Una consulta sin su índice falla, y Firestore escribe en la consola del navegador un enlace que lo crea. Los de la tabla (↓ descendente; el resto, ascendente):

| Pantalla | Índice |
| --- | --- |
| Votos que quedan este mes (webapp) | `votes`, grupo de colecciones: `voterId`, `votedAt` |
| «Mis incidencias» (webapp) | `issues`: `authorKey`, `createdAt`↓. El de `createdBy` ya no lo usa ninguna consulta |
| Lista de incidencias: la de la webapp (por fecha, actualización o votos; filtros de estado y categoría), la del admin y la cartera (por estado) | `issues`: `deletedAt` con `createdAt`↓, `updatedAt`↓ o `votesCount`↓; `deletedAt`, `status`, `createdAt`↓; `category`, `deletedAt`, `createdAt`↓ |
| Eventos: la cronología de la webapp, el buscador y las notificaciones del admin | `events`: `communityId`, `date`↓ |
| Resumen de la comunidad: lo cobrado y gastado en el año y por meses | `charges`: `paidAt`, `amount` y `paidAt`, `amount`, `collected`; `expenses`: `year`, `amount` y `date`, `amount` |
| Fondo de reserva de las cuotas | `charges`: `batchId`, `reserve` y `batchId`, `paidAt`, `reserve` |
| Liquidación anual: los cargos que vencían en el ejercicio y se pagaron después | `charges`: `paidAt`, `dueDate` y `dueDate`, `paidAt` |
| Errores, por estado, app, tipo o versión, y los urgentes primero | `errors`: `status`, `app`, `code` o `firstRelease`, cada uno con `lastSeen`↓; `status`, `code`, `lastSeen`↓ |
| Errores → Limpiar caducadas | `samples`, grupo de colecciones, de un campo: `expiresAt` |
| Historial → Cambios, por comunidad, colección, persona u operación, y las versiones de un documento | `audit`: `communityId`, `collection`, `actorId`, `op` o `path`, cada uno con `at`↓ |
| Historial → Acciones, por persona, tipo o app | `actions`: `uid`, `type` o `app`, con `at`↓ |
| Borrado de lo caducado ([plazos](#plazos)) | `audit` y `actions`: `keep`, `at`; `activity`, grupo de colecciones, de un campo: `at` (su `fieldOverrides` mantiene también los de la propia colección) |

Firestore combina los de un filtro cuando hay varios. Los índices de un campo sobre un grupo de colecciones se crean en **Firestore → Indexes → Single field → Add exemption**, con el ámbito «Collection group».

No necesitan índice: los comentarios (solo por fecha), el recuento de la cabecera de Errores ([MON-9](fiabilidad.md#mon-9), solo igualdades), la última copia (`ops/backup`), el rendimiento (`vitals/{app}_{día}` por su id, hasta 30 por consulta) y `npm run backup` (cada grupo de colecciones sin filtros). `before` y `after` de `audit` y `meta` de `actions` están exentos (`fieldOverrides`), para que no sumen una entrada de índice por campo a cada escritura.

`ops` solo lo escribe el Admin SDK (el script de copias) y solo lo lee el equipo. `vitals` recibe una escritura por sesión muestreada, sin lecturas, y las reglas limitan lo que suma cada una ([MON-6](fiabilidad.md#mon-6)). Las muestras de errores caducan a los 30 días (`expiresAt`) y las borra el borrado de lo caducado; **Limpiar caducadas** también, junto con los errores resueltos o ignorados que llevan 180 días sin volver.

<a id="storage"></a>

## 3. Storage: fotos y vídeos de incidencias y partes

Las fotos y vídeos de una incidencia, y los que añade un proveedor al terminar un parte, van al bucket del proyecto ([A4.6](v1.md#a4)) desde la webapp (`uploadMedia()` en `apps/webapp/src/app/infrastructure/storage.ts`). Storage necesita Blaze ([B1](v1.md#b1)): hasta entonces, producción se compila sin bucket y oculta los selectores, así que las incidencias se crean y los trabajos se terminan sin fotos.

- **Carpetas:** `issues/{communityId}/{authorKey}/`, con la clave secreta de quien la crea y no su uid, para que una URL que ven todos los vecinos no diga quién la creó ([quién crea una incidencia](datos.md#autor)); y `workOrders/{token}/`. Cada fichero se llama con un token aleatorio, su nombre y la extensión de su tipo, para que nadie encuentre los de otro.
- **Tamaño:** los límites son los de las [reglas](#reglas). El navegador reduce las fotos a JPEG de 1920 px antes de subirlas. Las que no puede leer (HEIC, en casi todos los navegadores salvo Safari) y los vídeos van tal cual, así que una foto HEIC solo se ve en Safari.
- **URLs:** Firestore guarda la URL de descarga, cuyo token abre el fichero sin cuenta, como hace el proveedor. Con los emuladores son relativas y el servidor de la página las pasa al emulador, así que también se abren desde un móvil en la demo local. Las incidencias y partes de antes pueden tener URLs del servicio de fotos anterior: se ven mientras exista esa cuenta.
- **Borrado:** `purgeOldMedia` ([functions](#functions)), cada domingo a las 05:00 (Madrid), borra las de una incidencia eliminada hace más de 90 días y las subidas hace más de 90 días que no usa ninguna incidencia ni parte (un guardado que falló). Las quita también de los `assets` de la incidencia y de la copia de sus partes (`issue.assets`), para que nada muestre enlaces rotos. Lista los ficheros de las dos carpetas, lee las incidencias de cada autor con ficheros antiguos (una consulta por carpeta) y, si borra alguno, los partes de su comunidad (una por comunidad).
- **Fuera de las copias:** `npm run backup` copia Firestore, no el bucket ([ROB-2](fiabilidad.md#rob-2), [B5](v1.md#b5)).
- **Límites conocidos:** las listas cargan la foto entera como miniatura. Las reglas no pueden contar, así que quien tenga una clave o el token de un parte puede subir cualquier número de ficheros (las listas de Firestore sí tienen tope). Una subida que rechazan las reglas muestra el error genérico de conexión.
- **Coste:** la parte gratuita de Storage solo cubre buckets en EE. UU., así que uno en la UE se paga desde el primer GB.

Para activarlo, con el proyecto ya en Blaze:

1. **Firebase console → Storage → Get started:** **production mode** (el de prueba deja el bucket abierto a cualquiera 30 días) y una ubicación en la UE ([GAR-3](competencia.md#gar-3)), p. ej. `europe-southwest1` (Madrid). No se puede cambiar después.
2. En seguida, las reglas: `npx firebase deploy --only storage --project dmoyadev-gobernansa`.
3. Ese primer despliegue pide que las reglas de Storage puedan leer Firestore (el rol **Firebase Rules Firestore Service Agent**): acéptalo, o se rechazará toda subida.
4. El bucket (`storageBucket` en **Project settings → Your apps**) en el secreto `VITE_FIREBASE_STORAGE_BUCKET` ([secretos](#secretos)), sustituyendo cualquier valor anterior, y descomenta su línea en `.github/workflows/firebase-hosting-merge.yml` y `firebase-hosting-pull-request.yml`. El siguiente despliegue ya muestra los selectores.
5. Vuelve a desplegar las [functions](#functions), aunque no hayan cambiado: toman el nombre del bucket al desplegarse, y `purgeOldMedia` no hace nada sin él.

<a id="secretos"></a>

## 4. Secretos de GitHub para el despliegue

Se añaden en **GitHub → Settings → Secrets and variables → Actions**. Además de la configuración web de Firebase (`VITE_FIREBASE_*`) y `VITE_ENV_NAME`, los workflows pasan:

| Secreto | Valor |
| --- | --- |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` en **Project settings → Your apps**. Su línea está comentada en los dos workflows hasta que exista el bucket ([Storage](#storage)) |
| `VITE_FIREBASE_VAPID_KEY` | **Project settings → Cloud Messaging → Web Push certificates** |
| `VITE_MAIL_MODE` | `demo` (o sin poner) hasta instalar la extensión de correo; luego, `extension` ([correo saliente](datos.md#correo)) |
| `VITE_APP_CHECK_KEY` | El id de la clave de reCAPTCHA de [App Check](#app-check); sin poner, sin App Check |

Las reglas se despliegan con la misma cuenta de servicio que Hosting (`FIREBASE_SERVICE_ACCOUNT_DMOYADEV_GOBERNANSA`). En **Google Cloud console → IAM**, esa cuenta (`github-action-…@dmoyadev-gobernansa.iam.gserviceaccount.com`) necesita los roles **Firebase Rules Admin** y **Service Usage Consumer**, o el paso de las reglas falla por permisos.

<a id="hosting"></a>

## 5. Hosting del admin y la landing

El admin (`apps/admin`) tiene su propio sitio, `gobernansa-admin`, junto al de la webapp, `dmoyadev-gobernansa`. Los dos se despliegan en cada push a `main`, y en un canal de vista previa en cada pull request, primero la webapp: si no existe el sitio del admin, su paso falla, pero la webapp ya está desplegada. Los sitios extra y los dominios propios entran en el plan gratuito.

1. Crea el sitio en **Hosting → Add another site** con el id `gobernansa-admin`, o con:
   ```bash
   npx firebase hosting:sites:create gobernansa-admin --project dmoyadev-gobernansa
   ```
2. Comprueba el id del sitio de la webapp con `npx firebase hosting:sites:list --project dmoyadev-gobernansa`. `.firebaserc` asigna el destino `webapp` a `dmoyadev-gobernansa`; si es otro, cámbialo allí.
3. **Hosting → gobernansa-admin → Add custom domain:** `admin.gobernansa.dmoya.dev`, con los registros DNS que muestre el asistente en `dmoya.dev`. El certificado puede tardar unas horas.
4. **Authentication → Settings → Authorized domains → Add domain:** `admin.gobernansa.dmoya.dev` y `gobernansa-admin.web.app`. Sin ellos, el admin no envía los correos con enlace (confirmar un correo, crear una contraseña nueva). Las vistas previas de los pull requests no están autorizadas (la lista no admite comodines), así que en ellas no se puede entrar ([ROB-1](fiabilidad.md#rob-1)).

A mano: `npm run build && npx firebase deploy --only hosting:admin` (o `hosting:webapp`).

**Landing.** `apps/landing` es una página sin framework que construye Vite y sirve GitHub Pages. `.github/workflows/landing-pages.yml` la construye y publica su `dist` en cada push a `main` que la toca o toca el tema compartido, una vez puesto **Settings → Pages → Source** en GitHub Actions. Sus rutas son relativas, así que funciona bajo `/gobernansa/` y en su propio dominio ([A2](v1.md#a2)). Su formulario de demo no toca Firebase: manda cada solicitud a un bot de Telegram, cuya dirección, con el token y el id del chat, va al revés y en base64 en la constante `BOT` de `src/sections/contact.js`. Eso solo aparta a los buscadores de tokens: si alguien abusa del bot, revoca el token en @BotFather y pon el nuevo.

<a id="pwa"></a>

## 6. App instalable

Las dos apps se instalan desde el navegador (Chrome y Edge lo ofrecen; Safari, desde su menú de compartir, y la webapp lo explica en iPhone y iPad) y abren sin conexión. No hay nada que configurar: está en el `public/` de cada app y en `firebase.json`, en el plan gratuito.

- **Manifiesto e iconos:** `public/manifest.webmanifest`, enlazado desde `index.html` con las etiquetas de iOS. Los iconos (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) son el isotipo: blanco sobre el azul marino de la marca en la webapp y coral sobre blanco en el admin. La webapp tiene accesos directos a Nueva incidencia, Reservas y Mis recibos.
- **Service worker:** `public/sw.js`, escrito a mano y registrado por `packages/shared/application/pwa.ts`. Guarda `index.html` y lo que carga, sirve desde la caché los `/assets/*` con hash de Vite y las páginas desde la red, con la guardada si no hay conexión. Otros orígenes (Firestore, las APIs de Google, Storage) y las escrituras van directos a la red. En `localhost` no guarda nada, para no estorbar a Vite: pruébalo sin conexión en una vista previa o en producción (DevTools → Network → Offline).
- **Actualizaciones:** tras cada despliegue, el worker guarda el `index.html` nuevo y descarta los ficheros con hash viejos. Una app abierta comprueba `index.html` cada vez que vuelve a primer plano (unos cientos de bytes, sin lecturas) y muestra **Nueva versión disponible · Actualizar**; un `sw.js` nuevo también espera a ese botón. Cambiar el nombre de sus cachés (`shell-v1`, `assets-v1`) descarta las viejas.
- **Notificaciones push:** llegan por el mismo `sw.js`, cuyo registro recibe `getToken`. `firebase-messaging-sw.js` es una línea que lo importa, para los dispositivos que las activaron antes con ese worker; puede irse cuando las hayan vuelto a activar.
- **Cabeceras de Hosting:** `firebase.json` sirve las páginas (`/`, `index.html` y toda ruta sin extensión), los workers y el manifiesto con `Cache-Control: no-cache`, para que un despliegue llegue en el acto (un fichero sin cambios es un 304 corto). Los `/assets/**` con hash se guardan un año. Las dos reglas nunca coinciden en una ruta; los iconos y las imágenes se quedan con la hora por defecto de Hosting.
- **Datos sin conexión:** Firestore guarda lo que lee en IndexedDB (`persistentLocalCache` con el gestor de varias pestañas, en `packages/shared/infrastructure/firebase.ts`): la app instalada muestra los últimos datos y envía lo hecho sin conexión al volver. No suma lecturas: pregunta antes al servidor, una escucha reabierta en menos de 30 minutos solo paga lo que cambió, y las pestañas comparten una conexión. Con los emuladores se queda en memoria, para no mezclar sus datos con los de producción. Por eso, desde el 20/11/2026, las referencias y los cursores de Firestore van en `shallowRef`: un `ref` le pasa al SDK un proxy de Vue que la caché no puede guardar, y solo fallaba en producción. Cerrar sesión lo borra (`terminate` y `clearIndexedDbPersistence` en `logout()`, `packages/shared/application/useAuth.ts`) y para el Firestore de las demás pestañas, que recargan a `/login`. Lo aún no enviado se pierde, y si otra pestaña lo retiene más de 3 segundos, se cierra la sesión sin borrarlo.
- **Sin cubrir:** las imágenes de `public/` no se guardan; las tipografías sí, con el resto de `/assets`. No hay ficha en las tiendas de aplicaciones.

<a id="interruptores"></a>

## 7. Interruptores remotos

Las dos apps leen estos interruptores de **Firebase console → Remote Config** al abrirse y en cuanto se publica un cambio, sin desplegar y sin lecturas de Firestore ([ROB-5](fiabilidad.md#rob-5)). Un parámetro que no existe, o un navegador que no llega a Remote Config, se queda con el valor por defecto, así que no hay que crear nada hasta que haga falta. Para usar uno, crea el parámetro con este nombre y tipo exactos y **Publish changes**:

| Parámetro | Tipo | Por defecto | Qué hace |
| --- | --- | --- | --- |
| `payments` | Boolean | `true` | `false` oculta los botones **Pagar** de cargos y reservas en la webapp |
| `remittances` | Boolean | `true` | `false` cambia por un aviso los formularios del admin que generan remesas y órdenes de pago |
| `aeatFiles` | Boolean | `true` | `false` desactiva la descarga del 347, el 190 y el 184 en el admin |
| `censusImport` | Boolean | `true` | `false` desactiva la importación de un censo o una cartera en el admin |
| `errorReporting` | Boolean | `true` | `false` deja de enviar errores y rendimiento a **Errores** |
| `actionsLog` | Boolean | `true` | `false` deja de registrar las **Acciones** del **Historial** ([functions](#functions)), una escritura por pantalla abierta |
| `errorSampleRate` | Number | `1` | Parte de las sesiones, de 0 a 1, cuyos errores llevan una muestra (pila, pasos y contexto); bájalo si los errores gastan demasiadas escrituras |
| `minVersion` | String | vacío | La versión más antigua permitida, p. ej. `2026.11.04-1200`. Las anteriores (`VITE_RELEASE`, en el perfil de la webapp y el menú del admin) quedan tapadas por un aviso que solo deja actualizar. Se ordenan como texto, así que basta con fecha y hora |
| `maintenance` | String | vacío | Un mensaje que muestran las dos apps mientras no esté vacío |

Remote Config necesita la **Firebase Installations API** y la **Firebase Remote Config API**, activas en un proyecto nuevo. Si se restringe la clave de la API ([ROB-8](fiabilidad.md#rob-8)), mantén las dos en su lista, o las apps se quedan con los valores por defecto. Con los emuladores no se pregunta a Remote Config, así que la demo local no sale a internet.

<a id="proyecto-demo"></a>

## 8. Proyecto de demo

Lo que se enseña a los despachos corre en su propio proyecto, `gobernansa-demo`, en el plan gratuito, con sus propios datos, cuota y cuentas: una demo nunca toca producción ni gasta su cuota. `.firebaserc` lo llama `demo`; si ese id está cogido, créalo con otro y cambia allí las dos menciones. `npm run deploy:demo` despliega sus [índices](#indices) con las reglas. Sin Storage ni functions, sus incidencias no tienen fotos y su **Historial** solo llena **Acciones**. Para una demo con fotos y sin internet está la [demo local](desarrollo.md#demo-local).

Una vez:

1. **Firebase console → Add project** `gobernansa-demo`, sin Analytics. **Firestore → Create database** en `europe-southwest1` (Madrid), production mode.
2. **Authentication → Sign-in method → Email/Password**, con **Email link** y **Anonymous** desactivados: los vecinos entran con el código de su carta de acceso, una cuenta Email/Password en `codigo.gobernansa.dmoya.dev` que no recibe nada ([B2.4](v1.md#b2)). Gratis, como el resto de Auth en este plan; los correos de contraseña y de confirmación cuentan para el límite diario de Auth.
3. **Project settings → Your apps → Web**, y **Cloud Messaging → Web Push certificates → Generate**. Copia `.env.example` a `.env.demo.local` en la raíz, con esa configuración y:
   - `VITE_FIREBASE_EMULATORS='false'`, `VITE_ENV_NAME='demo'` (la pestaña dice «gobernança DEMO») y `VITE_MAIL_MODE='demo'`;
   - `VITE_WEBAPP_URL='https://gobernansa-demo.web.app'`;
   - `VITE_FIREBASE_STORAGE_BUCKET=''`, vacío y no omitido, o se cuela el de `.env.local` y salen selectores para subidas que fallarían;
   - `DEMO_PASSWORD`, de al menos 6 caracteres: la contraseña de todas las cuentas de la demo. Solo la lee el seed.

   El build también lee `.env.local`, y `.env.demo.local` manda. `npm run deploy:demo` se para si el proyecto no es el de demo, si los emuladores están activados o si falta `VITE_WEBAPP_URL`.
4. **Hosting → Add another site** `gobernansa-demo-admin`, y **Authentication → Settings → Authorized domains → Add** `gobernansa-demo-admin.web.app` (los del sitio por defecto ya están).
5. **Project settings → Service accounts → Generate new private key**, guardada como `scripts/seed/serviceAccountKey.demo.local.json`. El seed la rechaza si su proyecto no es el `demo` de `.firebaserc`.
6. `npx firebase login --reauth` si la CLI lo pide, y `npm run deploy:demo` y `npm run seed:demo`.

Después:

- **Antes de cada demo:** `npm run seed:demo` la vacía y la carga entera otra vez, con fechas relativas a ese día. Borra las cuentas que no son de la demo y mantiene las suyas, así que quien tenga la sesión abierta la conserva; las que faltan se crean con `DEMO_PASSWORD`, que por eso solo llega a las cuentas nuevas. Gasta en escrituras más o menos el tamaño de la demo, de la cuota del proyecto de demo. El seed solo sube fotos al emulador, así que aquí las incidencias y los partes cargan sin ellas, con un aviso amarillo.
- **Tras una versión que merezca enseñarse:** `npm run deploy:demo`, a mano, nunca en cada push. Compila las dos apps en modo `demo` con un `VITE_RELEASE` como el de CI y despliega las reglas, los índices y los dos sitios.
- **Los errores** de la demo van a su propia página **Errores**: entra con la cuenta del equipo de la demo.
- Los dominios propios (`demo.` y `demo-admin.`) llegan con el dominio del producto ([A2](v1.md#a2)).

<a id="app-check"></a>

## 9. App Check: protección de la cuota

Las apps piden un token de App Check cuando tienen `VITE_APP_CHECK_KEY`, y nunca con los emuladores. Hasta que la consola lo exija, solo mide ([ROB-8](fiabilidad.md#rob-8)). Una vez por proyecto (producción y demo):

1. **Google Cloud console → Security → reCAPTCHA → Create key**, de tipo **Website**, sin casilla de verificación, con los dominios de las dos apps (`*.web.app` para las vistas previas, y los propios de [A2](v1.md#a2)).
2. **Firebase console → App Check → Apps → la app web → reCAPTCHA Enterprise**, con el id de esa clave. Duración del token: la más larga que permita la consola (7 días), para gastar pocas de las 10.000 evaluaciones gratuitas al mes.
3. El id de la clave como `VITE_APP_CHECK_KEY` en `.env.local`, en `.env.demo.local` y como secreto de GitHub ([secretos](#secretos)).
4. Despliega y vigila **App Check → APIs → Cloud Firestore** una o dos semanas: las peticiones verificadas deberían acercarse al 100 %. Solo entonces, **Enforce**. Las que no se verifican son instalaciones que aún no se han actualizado, o el script de otro.
5. En desarrollo, el SDK escribe un token de depuración en la consola la primera vez: añádelo en **App Check → Apps → ⋮ → Manage debug tokens**, o la app local quedará bloqueada cuando se exija. Con los emuladores no hace falta.

Restringe también la clave de la API (**Google Cloud console → APIs & Services → Credentials**) a los dominios de las apps, manteniendo las APIs de Installations y Remote Config ([interruptores](#interruptores)).

<a id="functions"></a>

## 10. Cloud Functions y el Historial

El **Historial** del admin (`/history`, solo el superadmin, `g h`) muestra cada cambio en los datos, con las versiones de cada documento y la opción de restaurar, y lo que hace cada usuario en las dos apps ([B12](v1.md#b12), casi todo [GAR-1](competencia.md#gar-1)). Los cambios los registran Cloud Functions, que necesitan Blaze ([B1](v1.md#b1)); las acciones las escriben las propias apps, también en el plan gratuito. Sin las functions, **Cambios** está vacío y restaurar falla, pero **Acciones** ya se llena.

- **Node:** Node 24, el `engines` de `apps/functions/package.json`, con soporte hasta el 30/04/2028. Los emuladores las ejecutan con el Node local, con un aviso si es más nuevo. ESLint rechaza en `apps/functions/` los módulos y APIs de Node más nuevos (`node/no-unsupported-features/*`), pero no las novedades de JavaScript (`Promise.try`, `RegExp.escape`…), que se revisan a mano.
- **Código:** `apps/functions/`, un workspace propio (módulos ES, `firebase-functions` 7 y `firebase-admin` 13), configurado en `firebase.json`. `auditTop`, `auditNested` y `auditDeep` son triggers de Firestore para documentos de 1, 2 y 3 niveles. `auditAccountCreated` y `auditAccountDeleted` registran las cuentas con triggers de Auth de primera generación (la segunda no los tiene). `restoreVersion` es una función invocable que solo puede usar el superadmin. `purgeExpired` borra lo caducado ([plazos](#plazos)) y `purgeOldMedia`, las fotos que ya nadie ve ([Storage](#storage)).
- **Región:** `REGION`, en `apps/functions/index.js` y en `apps/admin/src/modules/history/application/restoreVersion.ts`, es `europe-southwest1`. Los triggers de Firestore tienen que correr en la región de la base de datos: la de producción está ahí (comprobado el 16/11/2026), y el [proyecto de demo](#proyecto-demo) también se crea ahí. Otra región obliga a cambiar los dos ficheros. `purgeExpired` y `purgeOldMedia` corren en `europe-west1` sea cual sea `REGION`, porque Cloud Scheduler puede no estar en Madrid.
- **Despliegue:** en Blaze, primero los [índices](#indices) y luego `npx firebase deploy --only functions --project dmoyadev-gobernansa`, otra vez tras cada cambio en `apps/functions/`. El primero activa las APIs que necesita; si pide reintentar en unos minutos, se reintenta.

```text
audit/{eventId}       path, collection, docId, communityId? (el de la ruta, o el que lleva el documento), op create | update | delete,
                      changed (nombres de campo), before, after (enteros, o solo lo que cambió, recortado, con truncated: true),
                      authType, authId, actorId, actorName, actorEmail, actorInferred?, restoredFrom?, keep short | year | fiscal, at
                      las cuentas como path auth/{uid}, collection auth, con { email, providers, anonymous, disabled, createdAt, lastSignInAt }
actions/{id}          uid, email?, name, app webapp | admin, type signin | signout | page | print | download | view-as | view-as-exit
                      | email | password | restore, path, detail?, meta?, communityId?, viewAs?, device, keep short | year | admin, at
ops/restore-{sha1}    { uid, name, email, auditId, side, at }, de restoreVersion, con el sha1 de la ruta del documento restaurado
```

- **Cambios:** cada creación, cambio y borrado, salvo en `audit`, `actions`, `errors`, `vitals`, `ops` y la `activity` de cada comunidad (que ya es un registro); bajo `users/{uid}`, las claves secretas (`keys`), los dispositivos con notificaciones (`devices`, cuyo id es el token) y los ficheros de los documentos (`documentFiles`: su lista, `documents`, dice quién, cuándo, nombre y tamaño); y las escrituras que no cambian nada.
- **Quién:** sale de la sesión; las escrituras sin sesión, como el aviso de un proveedor, aparecen sin sesión. En los emuladores ningún evento lleva la sesión: se deduce de un campo de persona que pone la escritura (`updatedBy`, `authorId`…) y se marca `actorInferred`, y un borrado sale como desconocido. Falta comprobar que los eventos de producción traen el uid. El superadmin ve quién creó una incidencia anónima, porque ya podía leer su `private/author`: el anonimato es ante los vecinos.
- **Documentos grandes:** uno de más de unos 900 KB, demasiado grande para guardarlo dos veces, guarda solo lo que cambió, recortado, y no se puede restaurar.
- **Reintentos:** un trigger que falla se vuelve a ejecutar, hasta 24 horas (segunda generación), así que un error pasajero no pierde una entrada; cada evento escribe la suya una sola vez (`audit/{eventId}`).
- **Restaurar:** **Restaurar la versión anterior** o **Restaurar esta versión** vuelve a escribir ese estado, o borra el documento si entonces no existía. Se rechaza cuando el documento ya está así, en las cuentas, en las entradas recortadas y en todo lo que cuelga de `offices/`: las facturas, el registro Verifactu y los contadores y la cadena del despacho se corrigen con una rectificativa, nunca volviendo atrás. Restaurar es un cambio más y se deshace igual: deja una marca `ops/restore-*` que su propia entrada recoge (en menos de 60 segundos) para nombrar al superadmin y el cambio del que viene, y registra una acción `restore`.
- **Acciones:** las escribe `packages/shared/infrastructure/actions.ts`, un documento cada una: cada pantalla abierta, imprimir, entrar (con contraseña o con código) y salir, pedir añadir un correo, cambiar la contraseña, empezar y terminar «Ver como vecino» y cada descarga. Las reglas comprueban el uid y el correo, pero no `name`. No se envían con la cuota agotada ni en desarrollo contra el proyecto real. Las apaga `actionsLog` ([interruptores](#interruptores)).
- **Coste:** cada escritura en cualquier documento despierta un trigger, también en las colecciones que se saltan (paran en el acto): una invocación, una escritura en `audit` y, una vez por instancia, una lectura del perfil de esa persona. Una escritura masiva (importar un censo, `npm run restore`) hace una de cada por documento. `audit` guarda documentos enteros, así que también crece en tamaño. Cada acción es una escritura, casi siempre una por pantalla abierta, de las 20.000 diarias del plan gratuito.

<a id="plazos"></a>

### Plazos de conservación

Cada entrada de `audit` y `actions` lleva su clase en `keep`, puesta al escribirla (`apps/functions/retention.js`, `packages/shared/infrastructure/actions.ts`; las reglas la exigen y reservan `admin` al superadmin), y se borra entera al cumplir su plazo. Las páginas legales de las dos apps dicen lo mismo:

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

- **Quién borra:** en Blaze, `purgeExpired`, cada noche a las 04:00 (Madrid), hasta 10.000 documentos por noche (uno de los tres trabajos gratuitos de Cloud Scheduler; `purgeOldMedia` es el segundo). En el plan gratuito, la copia de seguridad después de cada copia ([ROB-2](fiabilidad.md#rob-2)), o `npm run purge`, que cuenta lo caducado y, con `--delete`, lo borra. Mientras la copia diaria no esté programada, `npm run purge -- --delete` una vez al mes, y otra vez mientras avise de que llegó a los 10.000 y queda más.
- **Coste:** una lectura y un borrado por documento, hasta 10.000 por pasada, la mitad de los borrados diarios del plan gratuito; contar, una lectura por cada 1.000.
- **Restaurar:** una entrada borrada se lleva su versión, así que ya no se puede restaurar. Las copias la guardan hasta que salen de las 14 últimas, salvo las `actions`, que nunca entran. Tampoco se restaura un documento de perfil cuyo fichero se borró: el fichero nunca se copió.
- **Guardado aparte:** antes de que caduque algo ligado a una brecha, una reclamación o una solicitud de acceso, exporta solo las entradas de `audit` y `actions` de ese caso (por el `uid` de la persona, el `communityId` de la comunidad o el `path` del documento), cífralas con la clave de las copias (`encrypt` en `scripts/backup/archive.js`), pon fecha al fichero y guárdalo fuera de la carpeta de las copias hasta que se resuelva. Una copia entera (`npm run backup`) solo cuando una brecha lo necesite todo, exportando antes las `actions` aparte: la copia las deja fuera y luego borra lo caducado. A mano con el Admin SDK; un script cuando llegue el primer caso.
- **Fin del contrato de un despacho:** después de entregarle la exportación de cada comunidad (**Exportar** en la comunidad), borra su historial: las entradas de `audit` con el `communityId` de sus comunidades, las que tienen el `path` bajo `offices/{officeId}`, las de las cuentas y perfiles de su gente (`auth/{uid}`, `users/{uid}` y lo que cuelga, sus `invitations`) y las `actions` de su gente (`uid`). A mano con el Admin SDK; un script cuando se vaya el primero.
