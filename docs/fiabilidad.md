# Fiabilidad: monitorización y robustez de gobernança

*Revisado en el código, los workflows y el historial de git el 26/11/2026. Los límites de Firebase y GitHub se comprobaron en sus webs el 02/11/2026 (sección 6); cambian a menudo, así que hay que revisarlos antes de depender de ellos.*

Objetivos: enterarse de un fallo antes que el cliente, que lleguen a producción los menos posibles y, si llega alguno, volver atrás en minutos sin perder datos. Es la base del piloto con despachos reales ([EMP-4](competencia.md#emp-4)).

**Ningún servicio externo nuevo.** Todo se construye sobre lo que el proyecto ya usa: Firebase (Firestore, Hosting, Auth, mensajería push, Remote Config y, con Blaze, Storage y Functions) y GitHub (código y CI). Así los datos no salen del proyecto (no hay subencargados nuevos que declarar, [EMP-2](competencia.md#emp-2)), todo se adapta a nuestros casos (comunidad, remesa, fichero AEAT) y no dependemos de los límites ni de los precios de otro. A cambio, hay que mantenerlo, gasta cuota de Firestore y, mientras no haya servidor ([INF-1](competencia.md#inf-1)), ningún aviso sale solo del navegador.

## 0. Cómo usar este documento

- **MON** son los huecos para *detectar* fallos y **ROB** los que sirven para *evitarlos y recuperarse*. Los demás grupos (FUN, INF, DAT, GAR, VAL, EMP) están en la sección 9.2 de [competencia.md](competencia.md).
- Los identificadores son estables: no se reutilizan ni se renumeran.
- Prioridades: **P0** antes del piloto, **P1** durante el piloto, **P2** después.
- Estado: ✅ hecho y en uso; 🔶 hecho en el código, pero falta un paso fuera de él (la consola de Firebase o GitHub, Blaze, tu equipo o una prueba real), que siempre se dice; sin emoji, abierto.
- Al cerrar uno: su estado aquí, con la fecha y cómo se hizo; su identificador, a la lista de cerrados de [competencia.md](competencia.md); y su fila, fuera de [pendiente.md](pendiente.md), que reúne todo lo que falta agrupado por lo que lo desbloquea.

---

## 1. Resumen

| ID | Prioridad | Qué | Coste | Falta |
|---|---|---|---|---|
| [ROB-2](#rob-2) | P0 | 🔶 Copias de seguridad con restauración ensayada | 0 € el puente gratuito; con Blaze, el almacenamiento de las copias | Activar la copia diaria en tu equipo; con [INF-1](competencia.md#inf-1), las copias programadas |
| [ROB-1](#rob-1) | P0 | Entorno de pruebas separado de producción | 0 € (segundo proyecto gratuito) | Aplazado: se usan los emuladores |
| [MON-5](#mon-5) | P1 | 🔶 Comprobar las dos webs después de cada despliegue | 0 € | Verla pasar en un despliegue |
| [ROB-4](#rob-4) | P1 | 🔶 Despliegues compatibles con la versión anterior y vuelta atrás | 0 € | Ensayar la vuelta atrás en la consola |
| [ROB-5](#rob-5) | P1 | 🔶 Interruptores remotos y versión mínima | 0 € (Remote Config) | Probar un interruptor desde la consola |
| [ROB-3](#rob-3) | P1 | Pruebas automáticas de lo que mueve dinero o va a la AEAT | 0 € | Decidirlo ([B11](v1.md#b11)); depende de [VAL-1](competencia.md#val-1) |
| [MON-6](#mon-6) | P2 | 🔶 Rendimiento real por pantalla | 0 €; cuota acotada | Revisar las medidas de producción |
| [MON-9](#mon-9) | P2 | Avisos de errores al móvil del equipo | 0 € | Una function, con [INF-1](competencia.md#inf-1); en el admin ya avisa |
| [MON-10](#mon-10) | P2 | 🔶 Traducir los errores al código original sin publicarlo | 0 € | Traducir una muestra de producción |
| [ROB-7](#rob-7) | P2 | 🔶 Dependencias al día | 0 € | Activar Dependabot en GitHub |
| [ROB-8](#rob-8) | P2 | 🔶 Proteger la cuota de abusos | 0 € la clave; App Check, 10.000 comprobaciones gratis al mes | La clave de reCAPTCHA y App Check en la consola; restringir la clave de la API |
| [MON-1](#mon-1) · [MON-2](#mon-2) · [MON-3](#mon-3) · [MON-8](#mon-8) | P0 | ✅ Errores propios: captura, gravedad, aviso de cuota y panel del equipo | 0 €; escrituras acotadas | — |
| [MON-4](#mon-4) | P1 | ✅ Registro de las operaciones de dinero y de los ficheros oficiales | 0 € | — |
| [MON-7](#mon-7) | P1 | ✅ Rutina de revisión y guía de respuesta | 0 € | — |
| [ROB-6](#rob-6) | P1 | ✅ Operaciones de dinero que no se pueden duplicar | 0 € | — |
| [ROB-9](competencia.md#rob-9) | — | ✅ Navegar sin volver a leer lo mismo | 0 € | — |

---

## 2. Situación actual

### Lo que ya está bien

- **Antes de llegar a `main`:** al hacer commit, un hook pasa ESLint a los ficheros del commit ([desarrollo.md](desarrollo.md)), y ESLint rechaza Firestore en las carpetas `ui/`.
- **CI:** cada push a `main` y cada PR pasan `npm audit` ([ROB-7](#rob-7)), ESLint, la comprobación de tipos (`vue-tsc`) y el build antes de desplegar. En `main`, las reglas se despliegan antes que la app y, si no compilan, no se despliega nada.
- **Reglas de Firestore:** más de 1.200 líneas que validan la forma de cada escritura. Son la última defensa ante un error del cliente.
- **Dinero:** los importes se guardan en céntimos, y las escrituras de varios documentos van en lote (`writeBatch`) o en transacción, así que un cobro no queda a medias.
- **Caché persistente de Firestore:** la app abre sin conexión, y lo escrito sin ella se envía al volver, también después de recargar ([app instalable](setup.md#pwa)).
- **Registro de actividad por comunidad** (`communities/{c}/activity`): quién, cuándo y un resumen de cada cambio hecho desde el admin, también reabrir un ejercicio. Va en el mismo lote que el cambio, firmado y fechado por el servidor, y no se puede editar ni borrar.
- **Versión:** CI pone a cada build una versión con la fecha y el commit (`VITE_RELEASE`), que va con cada error y se ve en el perfil de la webapp y en el menú del admin.
- **Actualizaciones:** las dos PWA avisan cuando hay versión nueva, y la versión mínima de [ROB-5](#rob-5) obliga a actualizar.

### Límites conocidos

- **Cuota del uso normal:**
  - **Emitir las cuotas de un año de golpe** son unas 1.200 escrituras por comunidad de 100 viviendas: de 15 comunidades en adelante el mismo día se pasa de las 20.000. Repartirlas en varios días o emitir por trimestres.
  - **Los documentos dentro de Firestore** comparten el 1 GiB con todo lo demás: unos 1.000 archivos de 1 MB lo llenan. El tope de 10 por persona lo comprueban las apps, no las reglas. Con Blaze ([INF-1](competencia.md#inf-1)), a Cloud Storage.
  - **«Ver más»** en la cronología de la webapp y en las incidencias y notificaciones del admin vuelve a leer las páginas anteriores. Crece con cada pulsación, pero solo la de quien pulsa.
  - **Contención:** si muchos usuarios disparan el mismo error a la vez, todas las escrituras van al mismo grupo. Si Firestore empieza a rechazarlas, repartir el contador por días (`errors/{huella}/days/{fecha}`).
  - **El registro de acciones del Historial** ([GAR-1](competencia.md#gar-1)) escribe una vez por pantalla abierta, también en el plan gratuito. Si se acerca a las 20.000 escrituras, apagarlo con `actionsLog` ([ROB-5](#rob-5)). Lo que añade con Blaze el historial de cambios, en [setup.md](setup.md#functions).
- **Privacidad:** las páginas legales cuentan los errores técnicos (30 días) y los plazos del Historial ([tabla](setup.md#plazos)). Con el plan gratuito, lo caducado solo se borra tras cada copia ([ROB-2](#rob-2)) o a mano ([plazos](setup.md#plazos)).

---

## 3. Detectar (MON)

### <a id="mon-1"></a><a id="mon-2"></a><a id="mon-3"></a><a id="mon-8"></a>✅ MON-1, MON-2, MON-3 y MON-8 · Errores propios (P0)

**Estado:** ✅ Hecho el 02/11/2026. Los errores de las dos apps se guardan agrupados en el propio Firestore, y el equipo los revisa en la página «Errores» del admin.

Los guarda `packages/shared/infrastructure/monitoring.ts` en `errors/{huella}`, con sus muestras en `samples` (caducan a los 30 días): la versión, la pantalla, el contexto y los últimos 30 pasos del usuario.
- **Gravedad** ([MON-2](#mon-2)), calculada con lo que ya tiene cada grupo, sin lecturas: **crítico** si ha vuelto después de resolverlo, si es `permission-denied`, `failed-precondition` o la cuota, o si afecta a 10 sesiones o más; **grave** de 3 sesiones en adelante; **moderado** si se repite; y **leve** si ha pasado una sola vez o es una pantalla que no carga a una o dos personas (suele ser una pestaña abierta antes de desplegar). Los de conexión y los avisos de la propia app no se envían.
- **Mensajes:** para agruparlos se quitan números, identificadores y los textos entre comillas que puede haber escrito el usuario, pero se conservan las propiedades (`reading 'toDate'`), así que dos fallos con propiedades distintas ya no se juntan. Desde el 26/11/2026; los grupos de antes siguen mostrando `<texto>`, y su mensaje completo está en las muestras.
- **Límites:** un envío por huella cada 10 minutos, 20 por sesión y 40 al día por dispositivo; 1 o 2 escrituras por envío y ninguna lectura.
- **Cuota** ([MON-3](#mon-3)): cuando se agota, las dos apps muestran un aviso fijo y dejan de enviar errores. En desarrollo, la consola muestra lo que lee cada pantalla.
- **Panel** ([MON-8](#mon-8)): la página «Errores» del admin, solo para el equipo, ordenada por gravedad, con filtros, «Ha vuelto», errores nuevos por versión, resolver, ignorar, fusionar y limpiar. «Copiar para corregir» copia el error, su última muestra entera (pila, contexto y pasos del usuario), las demás en una línea y cómo traducir la pila, sin el usuario ni la comunidad. Sus índices, en [setup.md](setup.md#indices).

### <a id="mon-4"></a>✅ MON-4 · Registro de las operaciones de dinero (P1)

**Estado:** ✅ Hecho el 04/11/2026. La actividad de cada comunidad lleva las cifras de cada operación de dinero y cada fichero oficial descargado.

- **Remesas:** las cuotas emitidas (recibos y total); la remesa generada, enviada y cobrada (recibos, total y cuántos quedan pagados o vuelven a pendiente); cada devolución; y, al importar el informe del banco, cuántas se casaron, por cuánto, y cuántas quedaron sin casar y por qué.
- **Censo:** las filas nuevas, actualizadas, sin cambios y rechazadas.
- **Ficheros:** cada descarga de un fichero SEPA, AEAT o del diario, con el resultado de su comprobación, también cuando se descarga con errores.

### <a id="mon-5"></a>🔶 MON-5 · Disponibilidad (P1)

**Estado:** 🔶 Hecho en el workflow el 04/11/2026; falta verlo en un despliegue.

El último paso de `firebase-hosting-merge.yml` («Check both sites») pide las dos webs y el primer JS de cada una, y comprueba que llega como JavaScript: por la reescritura de Hosting, un fichero que falta responde 200 con el `index.html`. Si algo falla, el workflow falla y GitHub avisa por email. Si se sospecha una caída de Firebase, status.firebase.google.com.

Sin hacer, por si hiciera falta: la misma comprobación programada cada pocas horas en GitHub Actions. Si el repositorio es privado, gasta minutos del cupo gratuito.

**Hecho cuando** un despliegue con el `index.html` roto hace fallar el workflow.

### <a id="mon-6"></a>🔶 MON-6 · Rendimiento real (P2)

**Estado:** 🔶 Hecho en el código el 05/11/2026; falta revisar la pestaña «Rendimiento» cuando lleguen medidas de producción.

`packages/shared/infrastructure/vitals.ts` mide con `PerformanceObserver`, sin librerías, la carga (LCP), los saltos de diseño (CLS) y la interacción más lenta (una aproximación a INP):
- **Muestreo:** el 10 % de las sesiones con sesión iniciada, con el mismo interruptor `errorReporting` ([ROB-5](#rob-5)) y nada mientras la cuota esté agotada.
- **Pantalla de cada medida:** la carga, la pantalla con la que se abrió la app; los saltos, la del peor tramo (ventanas de hasta 5 s, como CLS); la respuesta, la de la interacción más lenta.
- **Tramos:** carga hasta 1 s, 2,5 s, 4 s y más; saltos hasta 0,1, 0,25 y más; respuesta hasta 200 ms, 500 ms y más. Buenos, hasta 2,5 s, 0,1 y 200 ms.
- **Envío:** una escritura al ocultarse la página, a `vitals/{app}_{día}` (el día en España), con `increment` y `merge` y sin lecturas: unas 0,1 escrituras por sesión. Una página abierta en segundo plano no mide la carga.
- **Panel:** la pestaña «Rendimiento» de «Errores», con los últimos 7 o 30 días: por app, cada pantalla con el porcentaje de cargas, saltos y respuestas buenos y de cuántas, primero las de carga más lenta. Una pantalla va bien si lo es el 75 %. Cuesta una lectura por app y día.
- **Límites:** Safari no tiene LCP ni la medida de las interacciones: de sus sesiones solo llegan los saltos. La respuesta es la interacción más lenta de la sesión, no el INP exacto, que descarta una de cada 50. Las reglas limitan cada envío a sumar 1 en como mucho tres tramos por pantalla y tres pantallas, pero no a uno por medida: alguien con sesión podría falsear las cifras, igual que los errores ([ROB-8](#rob-8)).

Comprobado en los emuladores con la demo: un envío real del admin pasa las reglas (18 casos probados) y la pestaña suma bien los días de cada periodo.

**Hecho cuando** se ven las 10 pantallas más lentas de cada app.

### <a id="mon-7"></a>✅ MON-7 · Rutina y guía de respuesta (P1)

**Estado:** ✅ Hecho el 04/11/2026: la rutina de revisión y la guía de respuesta de la sección 5, con los pasos para volver atrás la app y las reglas ([ROB-4](#rob-4)).

### <a id="mon-9"></a>MON-9 · Avisos (P2)

**Estado:** Abierto. Dentro del admin, hecho el 04/11/2026; falta enterarse sin tener el admin abierto.

**En el admin:** el equipo ve en la cabecera, junto a «Errores», cuántos grupos piden atención: los urgentes pendientes y los que han vuelto después de resolverlos. Es una consulta de recuento al abrir el admin, cada hora y al abrir «Errores», que cuesta una lectura por cada 1.000 grupos y no necesita índices. Cada envío marca el grupo como visto (`seenSinceResolved`), y resolverlo lo desmarca. Comprobado en los emuladores con la demo.

**Fuera del admin**, contando solo los urgentes y los que vuelven, como la cabecera:
- **Push al móvil del equipo**, con la mensajería que ya usa la webapp: una function que salta cuando aparece un grupo nuevo o vuelve uno resuelto. Llega al momento, pero necesita [INF-1](competencia.md#inf-1). Es la recomendada.
- **Email al equipo** desde el correo saliente, con [FUN-2](competencia.md#fun-2).
- **Sin Blaze:** una tarea programada de GitHub Actions que revisa los grupos nuevos con una cuenta de servicio y abre una incidencia en el repositorio, de la que GitHub avisa por email. Gasta minutos de Actions y algunas lecturas: solo si [INF-1](competencia.md#inf-1) va a tardar.

**Hecho cuando** un error urgente nuevo llega al móvil del equipo sin tener el admin abierto.

### <a id="mon-10"></a>🔶 MON-10 · Traducir los errores al código original (P2)

**Estado:** 🔶 Hecho en el código el 05/11/2026; falta traducir la pila de una muestra de producción.

En producción la pila apunta al código minificado. Los mapas de código se guardan aparte en CI y nunca se publican:
- **Build:** las dos apps generan los mapas (`build.sourcemap: 'hidden'`), sin enlazarlos desde el código.
- **CI:** los dos workflows de Firebase los guardan como artefacto `sourcemaps-<versión>` (90 días los de producción y 14 los de las previews; unos 4 MB comprimidos por ejecución) y los borran de `dist` antes de desplegar. Por si acaso, `firebase.json` tampoco publica ningún `.map`.
- **En local:** se copia la pila de la muestra en «Errores» y `pbpaste | npm run symbolicate -- <versión de la muestra>`. Descarga los mapas con `gh` (hay que instalarlo y hacer `gh auth login`) y cambia cada línea por el fichero, la línea y la función del código. Con la versión `local` usa el último `npm run build` de tu equipo: así se traduce una versión cuyos mapas ya caducaron, tras `git checkout <commit>` y `npm run build`.

Comprobado con un build local: una línea del código minificado se traduce a la línea exacta de `monitoring.ts`.

**Hecho cuando** la pila de una muestra de producción se traduce en local a las líneas reales del código.

---

## 4. Evitar y recuperarse (ROB)

### <a id="rob-2"></a>🔶 ROB-2 · Copias de seguridad con restauración ensayada (P0)

**Estado:** 🔶 Puente gratuito hecho en el código el 05/11/2026, y primera copia real restaurada en los emuladores el 14/11/2026; falta activar la copia diaria en tu equipo (`npm run backup -- --schedule`) y, con Blaze ([INF-1](competencia.md#inf-1)), pasar a las copias programadas de Firestore.

Ese equipo guarda los datos personales de todos los despachos y la clave de la cuenta de servicio (`scripts/seed/serviceAccountKey.local.json`), que abre toda la base de datos: FileVault activado, la clave de las copias en el gestor de contraseñas, y el equipo y la carpeta de las copias en el registro de actividades de [EMP-2](competencia.md#emp-2).

**Puente gratuito** (`scripts/backup`), en tu equipo y no en GitHub Actions, para que los datos personales no salgan a GitHub, fuera de la UE:
- **Copia:** `npm run backup` lee todos los documentos con el Admin SDK y esa cuenta de servicio, los comprime y los cifra (AES-256-GCM) en `~/Documents/Backups/gobernansa`, y deja las 14 últimas. Busca cada colección por su nombre en `firebase/firestore.rules`, así que una colección nueva entra sola en cuanto tiene sus reglas. Con `FIRESTORE_EMULATOR_HOST`, copia el emulador en vez de producción.
- **Clave:** se crea la primera vez en `~/.config/gobernansa/backup.key`, fuera de la carpeta de las copias. Sin ella no se puede restaurar ninguna.
- **Programarla:** `npm run backup -- --schedule` escribe `~/Library/LaunchAgents/com.gobernansa.backup.plist` y dice cómo activarlo (`launchctl bootstrap gui/<uid> <plist>`). Se lanza cada día a las 14:00 o, si el equipo dormía, al despertar; si está apagado, no se hace. Su registro, en `~/Documents/Backups/gobernansa/backup.log`. Al cambiar de versión de Node o mover el repositorio, hay que volver a ejecutarlo.
- **Vigilancia:** al terminar escribe `ops/backup` con la fecha y el número de documentos. «Errores» los muestra, con un aviso en rojo si la última copia tiene más de 26 horas o no hay ninguna. Cuesta una lectura al abrir la página.
- **Restaurar:** `FIRESTORE_EMULATOR_HOST=127.0.0.1:5502 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:5501 npm run restore` vacía el emulador y escribe la última copia (o la que se le pase). Con el emulador de Auth, crea la cuenta de cada perfil con su mismo identificador y correo, para entrar como esa persona pidiendo una contraseña nueva (el emulador escribe el enlace en su registro). Se niega a escribir en producción.
- **Cuota:** una lectura por documento, más una por colección vacía; solo sirve mientras haya pocos datos. El script avisa al pasar de 25.000, la mitad de las diarias: entonces hay que pasar a Blaze. Deja fuera las acciones del Historial, que crecen con cada pantalla abierta y cuya pérdida no quita nada de las comunidades. Con Blaze sí lleva el historial de cambios, que crece con cada escritura hasta que su plazo empieza a borrar lo antiguo.
- **Borrar lo caducado:** tras cada copia, borra lo que ha cumplido su plazo del Historial, del registro de actividad y de las muestras de errores ([tabla](setup.md#plazos)), hasta 10.000 documentos: una lectura y un borrado por cada uno. Lo borrado sigue en las copias hasta que salen de las 14 últimas, salvo las acciones, que nunca entran. Sin la copia diaria, `npm run purge` cuenta lo caducado y `npm run purge -- --delete` lo borra.
- **No incluye** las cuentas de Auth (se rehacen desde `users` al restaurar), las acciones del Historial ni los ficheros de Cloud Storage, solo sus enlaces.

Ensayado entero en los emuladores con la demo (copia de 993 documentos de 40 colecciones, vaciado, restauración, una segunda copia idéntica y el admin abierto sobre lo restaurado) y con la primera copia real, del 14/11/2026: 60 documentos de 8 colecciones de producción, restaurados con sus 6 cuentas de Auth y abiertos en el admin como superadmin.

**Con Blaze:** copias programadas de Firestore, una diaria con unos 14 días de retención y una semanal que dure más, y la recuperación a un momento concreto si su precio encaja. Se restaura en una base de datos nueva y desde ahí se copia lo necesario, sin pisar producción.

**Fotos y vídeos.** Ninguna de las dos copias guarda los ficheros de Cloud Storage, solo sus enlaces. Las apps no pueden cambiarlos ni borrarlos (`storage.rules`), y solo los borra `purgeOldMedia` ([tabla](setup.md#plazos)), así que se pierden si se borra el bucket o el proyecto. Para [B5](v1.md#b5), o se copian aparte o se deja por escrito que se asume perderlas. Las de incidencias anteriores siguen en el servicio de fotos anterior mientras exista esa cuenta.

**El Historial ayuda, pero no es una copia** ([GAR-1](competencia.md#gar-1)). Con Blaze guarda cada versión de cada documento, y el superadmin puede volver uno a una versión anterior: una escritura mala se deshace documento a documento. Pero vive en la misma base de datos, solo tiene lo escrito desde que se despliegan las functions y durante su plazo (90 días casi todo, [tabla](setup.md#plazos)), y no restaura cuentas, fotos, facturas ni los documentos demasiado grandes, que guarda recortados. Cada restauración escribe el documento entero como estaba y pisa lo que cambió después.

**Hecho cuando** hay una copia diaria automática y se ha restaurado una entera al menos una vez.

### <a id="rob-6"></a>✅ ROB-6 · Dinero sin duplicados (P1)

**Estado:** ✅ Hecho el 04/11/2026. Un doble clic, dos pestañas o un reintento tras perder la conexión ya no duplican cuotas, derramas, intereses, remesas, órdenes de pago, devoluciones, conciliaciones, gastos ni cierres. Casi todo lo paran las reglas, sin lecturas de más y también cuando una escritura hecha sin conexión llega tarde: qué rechazan, en [setup.md](setup.md#reglas).

Además:
- **Identificadores fijos** para los intereses, los gastos de devolución, los gastos apartados del banco, las comunidades importadas con CIF y las rectificativas.
- **Transacción** al marcar pagado a mano, devolver, emitir intereses y cerrar el ejercicio.
- **Lecturas del servidor, no de la caché,** antes de emitir las cuotas, anular las pendientes, reanudar una derrama, importar deuda o comparar el censo.
- **Botones bloqueados** mientras dura la acción.

Comprobado con 50 casos de las reglas en el emulador y con doble clic en el admin.

**Límites:**
- **Marcar pagado o pendiente a mano no funciona sin conexión:** necesita leer el estado en el servidor, como las entregas a cuenta.
- **Dos pestañas que importan el mismo censo a la vez** pueden duplicar las propiedades nuevas. Con un identificador fijo, una propiedad renombrada bloquearía la importación entera.
- **Una derrama emitida en dos pestañas** solo avisa: dos derramas iguales pueden ser legítimas.
- **Borrar un recibo suelto** no comprueba si está pagado.

### <a id="rob-5"></a>🔶 ROB-5 · Interruptores remotos y versión mínima (P1)

**Estado:** 🔶 Hecho en el código el 04/11/2026; falta probar un interruptor desde la consola de Remote Config. Solo se ha comprobado cambiando los valores en el navegador.

Sirven para apagar en un minuto una función que falla en producción (por ejemplo, remesas que generan un fichero mal) mientras se corrige, sin esperar a un despliegue, y para obligar a actualizar tras un cambio incompatible ([ROB-4](#rob-4)). `packages/shared/infrastructure/remoteConfig.ts` los lee al abrir la app y en cuanto se publica un cambio; si no puede, todo queda como está por defecto (encendido). Remote Config es del mismo Firebase, gratis, y no gasta cuota de Firestore (su límite son 100.000 consultas al día por proyecto). Los parámetros y qué hace cada uno, en [setup.md](setup.md#interruptores).

**Hecho cuando** apagar `remittances` en la consola oculta la generación de remesas en el admin sin desplegar.

### <a id="rob-4"></a>🔶 ROB-4 · Despliegues compatibles y vuelta atrás (P1)

**Estado:** 🔶 Documentado el 04/11/2026 en la sección 5; falta el ensayo real en la consola, que hace el titular del proyecto: volver atrás una vez cada web y las reglas, y dejarlas como estaban.

Conviven varias versiones: una PWA instalada o una pestaña abierta siguen con la anterior hasta que el usuario acepta la actualización, y eso puede tardar días. Las reglas se despliegan antes que la app, lo que protege al código nuevo pero no al antiguo. Por eso un cambio en las reglas o en la forma de los datos va en tres pasos, con la versión mínima de [ROB-5](#rob-5) en medio: así no hace falta medir quién usa qué versión.

**Hecho cuando** se ha ensayado una vez volver atrás la app y las reglas.

### <a id="rob-3"></a>ROB-3 · Pruebas automáticas de lo que mueve dinero (P1)

**Estado:** Abierto. El proyecto no tiene pruebas, por decisión propia; se decide en [B11](v1.md#b11).

Que CI pare un despliegue que rompe un cálculo o un fichero oficial: un error ahí le cuesta dinero a una comunidad o le trae una sanción. Por orden:
1. **Ficheros oficiales:** 347, 111/115, 190, 184, pain.008, pain.001 y XDiario, comparados con ficheros que la AEAT y el banco ya hayan aceptado ([VAL-1](competencia.md#val-1)).
2. **Lectura de ficheros del banco:** Norma 43, pain.002 y camt.054, con ejemplos reales anonimizados.
3. **Cálculos:** el reparto por coeficientes (que la suma de los recibos dé el total al céntimo), los intereses de demora, las entregas a cuenta y la regularización y el cierre (que el balance cuadre).
4. **Reglas de Firestore en el emulador:** quién puede leer y escribir recibos, pagos, asientos y errores, y que nada se escriba en un ejercicio cerrado.

Sin dependencias nuevas: la lógica está en `packages/shared/domain`, en TypeScript puro, con los imports acabados en `.ts` y sin enums, que Node 24 ejecuta sin compilar, así que basta `node --test`. Las reglas, con el emulador que ya se usa. Todo, en el paso de CI que pasa ESLint y el build.

**Hecho cuando** CI falla al romper a propósito el reparto por coeficientes o el 347.

### <a id="rob-7"></a>🔶 ROB-7 · Dependencias al día (P2)

**Estado:** 🔶 Hecho en el código el 10/11/2026; falta activar en GitHub, en **Settings → Code security**, las «Dependabot alerts» y las «Dependabot security updates».

- **Dependabot:** `.github/dependabot.yml` solo abre PRs de seguridad (`open-pull-requests-limit: 0` apaga las de versiones).
- **CI:** los dos workflows de Firebase pasan `npm audit --omit=dev --audit-level=high` antes de ESLint y del build.
- **Cada trimestre:** el resto, con `npm run check:deps`.
- **`@grpc/grpc-js`:** `@firebase/firestore` lo fijaba en la 1.9, con una vulnerabilidad alta sin arreglo en esa rama. Un `overrides` en el `package.json` raíz lo sube a la 1.14, la del resto del árbol. En el navegador no cambia nada: Firestore solo usa gRPC en Node. Quitarlo cuando Firebase suba esa dependencia.

**Hecho cuando** Dependabot está activo y CI falla ante una vulnerabilidad alta.

### <a id="rob-8"></a>🔶 ROB-8 · Proteger la cuota de abusos (P2)

**Estado:** 🔶 Hecho en el código el 14/11/2026; falta crear la clave de reCAPTCHA, registrarla en App Check, medir y pasar a obligatorio, y restringir la clave de la API ([pasos](setup.md#app-check)).

La configuración de Firebase es pública por diseño, y cada petición evalúa `me()` en las reglas. Esa lectura se cobra aunque la regla rechace la petición, así que un script podría agotar la cuota de todos, también enviando errores falsos a `errors`: los topes de envío están en el navegador.

Las dos apps piden el token de App Check con reCAPTCHA Enterprise si tienen `VITE_APP_CHECK_KEY`, y nunca con los emuladores. App Check es de Google, pero un producto aparte, con sus propias condiciones: da 10.000 comprobaciones gratis al mes y, con el token a 7 días, cada dispositivo gasta unas pocas. Comprobar el precio antes de pasar a obligatorio.

**Hecho cuando** la clave está restringida y App Check mide sin bloquear a nadie.

### <a id="rob-1"></a>ROB-1 · Entorno de pruebas separado (P0, aplazado)

**Estado:** Aplazado por decisión propia el 04/11/2026. Mientras tanto, los fallos se reproducen ([MON-7](#mon-7)) y las restauraciones se ensayan ([ROB-2](#rob-2)) en los emuladores locales, y las demos tienen su propio [proyecto](setup.md#proyecto-demo) ([A1](v1.md#a1)).

Hoy las previews de cada PR apuntan a producción, con el mismo proyecto y las mismas reglas:
- lo que se hace en ellas (entrar con código o contraseña, el parte de trabajo por enlace) escribe en datos reales;
- el QR de una carta impresa desde una preview lleva a producción;
- un cambio que necesita reglas nuevas falla en la preview aunque esté bien.

La solución es un segundo proyecto de Firebase (por ejemplo, `gobernansa-staging`), gratis y con su propia cuota y sus sitios de Hosting:
- **Previews:** el workflow de PR compila con los valores de ese proyecto (un *environment* de GitHub con sus propios secretos) y despliega en él sus reglas antes de la preview, así que cada PR se prueba con las reglas que trae. Producción solo se toca al hacer merge a `main`.
- **Datos de prueba:** con el seed, solo contra ese proyecto, porque borra lo que haya.
- **Acceso:** autorizar el dominio de sus previews en su Authentication, para que lleguen bien los correos de contraseña nueva.

**Hecho cuando** una PR se puede probar entrando con un código o una contraseña de prueba, sin tocar producción.

---

## 5. Rutina y guía de respuesta

### Rutina

- **Después de cada despliegue:** que el workflow acabe en verde, incluida la comprobación de las dos webs ([MON-5](#mon-5)). Durante la primera hora, los errores nuevos de esa versión en «Errores» (filtro «Nuevos en …»).
- **Al abrir el admin:** si el contador de «Errores» de la cabecera no está a cero, revisar esos grupos: son los urgentes y los que han vuelto ([MON-9](#mon-9)).
- **Cada semana, unos 15 minutos:** los grupos nuevos y los que han vuelto; el uso de Firestore (consola → Firestore → Uso), sobre todo si se acerca a las 50.000 lecturas o 20.000 escrituras diarias; que no sale el aviso de la copia en «Errores» ([ROB-2](#rob-2)); y qué pantallas bajan del 75 % en «Rendimiento» ([MON-6](#mon-6)).
- **Cada trimestre:** restaurar la última copia con `npm run restore` ([ROB-2](#rob-2)), porque una copia que nunca se ha restaurado no garantiza nada; ensayar una vuelta atrás de la app (abajo); y revisar las dependencias ([ROB-7](#rob-7)).

### Guía de respuesta

| Síntoma | Qué mirar | Qué hacer |
|---|---|---|
| El workflow de despliegue falla en el último paso | Qué web o qué fichero no respondió, en el registro del paso | Volver atrás esa web (abajo) y corregir con calma |
| Errores nuevos justo después de un despliegue | «Errores», filtrado por la versión | Volver atrás la app (abajo) y corregir con calma |
| Muchos `permission-denied` después de cambiar las reglas | Qué versiones aparecen en el grupo | Si vienen de clientes antiguos, volver atrás las reglas (abajo) y hacer el cambio en tres pasos |
| Cuota agotada | Consola de Firebase → Uso: qué la disparó | Avisar a los despachos de que vuelve hacia las 9:00. Si fue una pantalla, corregirla ([INF-2](competencia.md#inf-2)); si fue el registro de acciones, apagar `actionsLog` ([ROB-5](#rob-5)); si se repite, pasar a Blaze ([INF-1](competencia.md#inf-1)) |
| Picos de lecturas o de errores sin explicación | Uso por horas en la consola y grupos sin sesión | Puede ser un abuso: restringir la clave y activar App Check ([ROB-8](#rob-8)) |
| Un despacho dice que algo salió mal | La actividad de la comunidad (cada operación de dinero con sus cifras y cada fichero descargado con su comprobación), los grupos de esa comunidad y fecha en «Errores» y, en el «Historial», las acciones de quien lo hizo y, con Blaze, los cambios | Reproducirlo en los emuladores locales (o en el entorno de pruebas, si se hace [ROB-1](#rob-1)) |
| Falla en producción una función de dinero | «Errores» | Apagarla con su interruptor ([ROB-5](#rob-5)) mientras se corrige |
| Hay que obligar a todos a actualizar | La versión que lleva el arreglo | Subir `minVersion` ([ROB-5](#rob-5)) a esa versión |
| Hay demasiados errores y gastan cuota | El contador `count` de los grupos | Bajar `errorSampleRate` o apagar `errorReporting` ([ROB-5](#rob-5)) |
| No se ha hecho la copia diaria | El aviso de «Errores» y `~/Documents/Backups/gobernansa/backup.log` ([ROB-2](#rob-2)) | Lanzarla a mano el mismo día con `npm run backup` |
| Una pila de error no se entiende | La versión de la muestra | `pbpaste \| npm run symbolicate -- <versión>` ([MON-10](#mon-10)) |
| Una pantalla va lenta | La pestaña «Rendimiento» de «Errores» ([MON-6](#mon-6)) | Medirla en local con las herramientas del navegador y corregirla |
| Hay que recuperar datos borrados o estropeados | Con Blaze, las versiones de esos documentos en el «Historial». Si no están, o son muchos, la última copia anterior al fallo ([ROB-2](#rob-2)) | Pocos documentos: en el cambio que lo estropeó, «Restaurar la versión anterior», o «Recuperar el documento» si lo borró; pisa lo que cambió después en él, y los recortados no se restauran. Si no: restaurar la copia en los emuladores, comprobar qué falta y copiarlo a mano a producción con el Admin SDK, sin pisar el resto |
| Firebase caído | status.firebase.google.com | Avisar a los despachos; no hay nada que desplegar |
| Sospecha de acceso indebido o de datos expuestos | El «Historial»: las acciones y los cambios de la cuenta o la comunidad afectada | Seguir el procedimiento ante una brecha ([EMP-6](competencia.md#emp-6)) y avisar al despacho |

### Volver atrás la app

Cada web se vuelve atrás por separado, en minutos y sin tocar los datos:
1. **Si la versión rota subió `minVersion`**, bajarlo antes en Remote Config. Si no, la versión restaurada queda por debajo del mínimo y se bloquea a sí misma.
2. **Consola de Firebase → Hosting**, elegir el sitio: `dmoyadev-gobernansa` es la webapp y `gobernansa-admin` el admin.
3. **Historial de versiones:** en la versión anterior a la rota, el menú ⋮ → **Restaurar**. Se publica al momento, y quien tenga abierta la rota ve el aviso de versión nueva.
4. **Revertir el commit en `main`** (`git revert`), o el siguiente push vuelve a publicar la versión rota. CI despliega la reversión.
5. **Comprobar** en «Errores» que dejan de llegar los de esa versión.

### Volver atrás las reglas

1. **Consola de Firebase → Firestore → Reglas.** A la izquierda está el historial: elegir la versión anterior, compararla con la actual y publicarla.
2. **Corregir `firebase/firestore.rules`** y hacer push: el siguiente despliegue publica el fichero y pisa lo hecho en la consola.
3. Si la app nueva ya depende de las reglas nuevas, volver atrás también la app.

### Un cambio que rompe la versión anterior, en tres pasos

Para un cambio en las reglas o en la forma de los datos que la versión anterior no entiende:
1. **Primer despliegue:** las reglas aceptan la forma antigua y la nueva, y la app nueva escribe la nueva.
2. **Subir la versión mínima:** en Remote Config, `minVersion` a la versión de ese despliegue (la del menú del admin y el perfil de la webapp, p. ej. `2026.11.04-1200`), y **Publicar cambios**. Quien tenga una anterior solo puede actualizar ([interruptores](setup.md#interruptores)).
3. **Segundo despliegue:** las reglas dejan de aceptar la forma antigua.

## 6. Fuentes

Comprobadas el 02/11/2026:
- [Precios de Firebase](https://firebase.google.com/pricing): cuotas del plan gratuito y límite de Remote Config; Cloud Functions solo con Blaze.
- [Cuotas de Firestore](https://firebase.google.com/docs/firestore/quotas): se reinician hacia la medianoche de la hora del Pacífico.
- [Copias de seguridad de Firestore](https://firebase.google.com/docs/firestore/backups): las copias programadas requieren Blaze.
- [TTL de Firestore](https://firebase.google.com/docs/firestore/ttl): borra en las 24 horas siguientes a la caducidad y sus borrados cuentan como borrados. No dice si está en el plan gratuito.
- [Buenas prácticas de Firestore](https://firebase.google.com/docs/firestore/best-practices): no hay un límite fijo de escrituras por documento; la contención aparece a mucha frecuencia.
- [Facturación de Firestore](https://firebase.google.com/docs/firestore/pricing) y [condiciones de las reglas](https://docs.cloud.google.com/firestore/docs/security/rules-conditions): las lecturas de `get()` y `exists()` se cobran aunque la regla rechace la petición.
- [App Check con reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider): cupo gratuito y renovación del token.
