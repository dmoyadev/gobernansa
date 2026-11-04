# Fiabilidad: monitorización y robustez de gobernança

*Revisado en el código el 04/11/2026. Los límites de Firebase y GitHub se comprobaron en sus webs el 02/11/2026; cambian a menudo, así que hay que revisarlos antes de depender de ellos.*

Objetivos:
- enterarse de un fallo antes que el cliente;
- que lleguen a producción los menos fallos posibles;
- si llega alguno, volver atrás en minutos sin perder datos.

Es la base para el piloto con despachos reales (EMP-4 en [competencia.md](competencia.md)).

**Principio: ningún servicio externo nuevo.** Todo se construye en casa, a medida de gobernança, sobre lo que el proyecto ya usa: Firebase (Firestore, Hosting, Auth, mensajería push, Remote Config) y GitHub (código y CI). Así se gana:
- **Los datos no salen del proyecto**, así que no hay subencargados nuevos que declarar a los despachos (EMP-2).
- **Se adapta a nuestros casos:** comunidad, despacho, remesa, fichero AEAT.
- **No depende de los límites ni de los cambios de precio de otro.**

A cambio:
- hay que construirlo y mantenerlo;
- gasta cuota de Firestore;
- mientras no haya servidor (INF-1), ningún aviso puede salir solo del navegador.


## 0. Cómo usar este documento

- **MON** son los huecos para *detectar* fallos y **ROB** los que sirven para *evitarlos y recuperarse*. Los demás grupos (FUN, INF, DAT, GAR, VAL, EMP) están en la sección 9.2 de [competencia.md](competencia.md).
- Los identificadores son estables: no se reutilizan ni se renumeran.
- Prioridades: **P0** antes del piloto, **P1** durante el piloto, **P2** después.
- Este documento solo recoge lo pendiente. Al cerrar uno, quitar su fila y su ficha de aquí, contar en la sección 2 lo que ha quedado hecho, y pasarlo a la lista de cerrados de la sección 9.2 de competencia.md con la fecha.

---

## 1. Resumen

| ID | Prioridad | Qué | Coste | Depende de | Estado |
|---|---|---|---|---|---|
| ROB-5 | P1 | Interruptores remotos y versión mínima | 0 € (Remote Config) | — | Hecho en el código; falta probarlo en la consola |
| MON-9 | P1 | Avisos de errores nuevos: dentro del admin ya; en el móvil con INF-1 | 0 € | — | Pendiente |
| MON-4 | P1 | Registro de las operaciones que mueven dinero o generan ficheros oficiales | 0 € | — | Pendiente |
| MON-5 | P1 | Disponibilidad: comprobar las dos webs después de cada despliegue | 0 € | — | Pendiente |
| ROB-4 | P1 | Despliegues compatibles con la versión anterior y vuelta atrás | 0 € | ROB-5 | Pendiente |
| MON-7 | P1 | Rutina de revisión y guía de respuesta | 0 € | — | Pendiente |
| ROB-2 | P0 | Copias de seguridad con restauración ensayada | Almacenamiento de las copias con Blaze; hay un puente gratuito | INF-1 | Pendiente |
| ROB-3 | P1 | Pruebas automáticas de lo que mueve dinero o va a la AEAT | 0 € | VAL-1 | Pendiente |
| MON-10 | P2 | Traducir los errores al código original sin publicarlo | 0 € | — | Pendiente |
| MON-6 | P2 | Rendimiento real por pantalla, con las APIs del navegador | 0 €; cuota acotada | — | Pendiente |
| ROB-7 | P2 | Dependencias al día | 0 € | — | Pendiente |
| ROB-8 | P2 | Proteger la cuota de abusos | 0 € la clave; App Check, 10.000 comprobaciones gratis al mes | — | Pendiente |
| ROB-1 | P0 | Entorno de pruebas separado de producción | 0 € (segundo proyecto gratuito) | — | Aplazado |

**Orden recomendado:**
1. **Ahora:** probar ROB-5 en la consola de Firebase.
2. **Fase 2:** MON-9 (dentro del admin), MON-4, MON-5, ROB-4 y MON-7.
3. ROB-2 en cuanto haya Blaze (INF-1); hasta entonces, su puente gratuito.
4. **Fase 3:** MON-10, MON-6 y los avisos al móvil de MON-9.

**ROB-1 está aplazado** por decisión propia (04/11/2026). Mientras tanto, lo que se iba a hacer en el entorno de pruebas se hace en los emuladores locales: reproducir fallos (MON-7) y ensayar restauraciones (ROB-2).

---

## 2. Situación actual

### Lo que ya está bien

- **CI:** cada push a `main` pasa ESLint, la comprobación de tipos (`vue-tsc`) y el build antes de desplegar. Las reglas se despliegan antes que la app y, si no compilan, no se despliega nada.
- **Reglas de Firestore:** unas 800 líneas que validan la forma de cada escritura. Son la última defensa ante un error del cliente.
- **Dinero:** los importes se guardan en céntimos, y las escrituras de varios documentos van en lote (`writeBatch`) o en transacción, así que un cobro no queda a medias.
- **Caché persistente de Firestore:** la app abre sin conexión. Las escrituras hechas sin conexión se guardan en el navegador y se envían al volver, también después de recargar.
- **Registro de actividad por comunidad** (`communities/{c}/activity`). Guarda quién, cuándo y un resumen de cada cambio hecho desde el admin. Se escribe en el mismo lote que el cambio, firmado y fechado por el servidor, y no se puede editar ni borrar. Reabrir un ejercicio también queda registrado. Es la base de MON-4.
- **Errores propios** (MON-1, MON-2, MON-3 y MON-8, cerrados el 02/11/2026). Los errores de las dos apps se guardan en el propio Firestore (`errors/{huella}` y sus muestras en `samples`, que caducan a los 30 días), agrupados por una huella, con la versión, la pantalla, el contexto y los últimos 30 pasos del usuario. Lo hace `packages/shared/infrastructure/monitoring.ts`:
  - **Urgentes:** `permission-denied`, `failed-precondition` y los errores que vuelven después de resolverlos. Los de conexión y los avisos de la propia app no se envían.
  - **Límites:** un envío por huella cada 10 minutos, 20 por sesión y 40 al día por dispositivo; 1 o 2 escrituras por envío y ninguna lectura.
  - **Panel:** la página «Errores» del admin, solo para el equipo, con filtros, «Ha vuelto», errores nuevos por versión, resolver, ignorar, fusionar y limpiar. Sus índices, en [firebase.md](firebase.md).
- **Versión:** CI pone a cada build una versión con la fecha y el commit (`VITE_RELEASE`), que va con cada error y se ve en el perfil de la webapp y en el menú del admin.
- **Cuota:** cuando se agota, las dos apps muestran un aviso fijo y dejan de enviar errores. En desarrollo, la consola muestra lo que lee cada pantalla. Revisadas las dos apps (ROB-9, 02/11/2026): volver a una página no la relee entera, las lecturas pesadas se comparten 5 minutos entre páginas, las votaciones se leen ya contadas y no quedan consultas sin tope que crezcan con los años.
- **Dinero sin duplicados** (ROB-6, cerrado el 04/11/2026). Un doble clic, dos pestañas o un reintento después de perder la conexión ya no duplican cuotas, derramas, intereses, remesas, órdenes de pago, devoluciones, conciliaciones, gastos ni cierres. Casi todo lo paran las reglas, sin lecturas de más y también cuando una escritura hecha sin conexión llega más tarde (detalle en [firebase.md](firebase.md)):
  - lo que se vuelve a crear encima de lo que ya existe se rechaza;
  - un recibo está en una sola remesa y se concilia con un solo movimiento, y solo mientras se debe; lo mismo una factura con su orden de pago;
  - un movimiento del banco se concilia o se aparta una sola vez;
  - no se borra una remesa enviada ni una orden ejecutada, y un ejercicio no se cierra dos veces.

  Además:
  - **Identificadores fijos** para los intereses, los gastos de devolución, los gastos apartados del banco, las comunidades importadas con CIF y las rectificativas.
  - **Transacción** al marcar pagado a mano, devolver, emitir intereses y cerrar el ejercicio.
  - **Lecturas del servidor, no de la caché,** antes de emitir las cuotas, anular las pendientes, reanudar una derrama, importar deuda o comparar el censo.
  - **Botones bloqueados** mientras dura la acción.

  Comprobado con 50 casos de las reglas en el emulador y con doble clic en el admin.
- **Actualizaciones:** las dos PWA avisan cuando hay versión nueva.
- **Vuelta atrás:** Hosting guarda las versiones publicadas y la consola guarda el historial de reglas (ROB-4).

### Lo que falta

- **Las previews de cada PR apuntan a producción**, con el mismo proyecto y las mismas reglas (ROB-1, aplazado):
  - el enlace mágico no funciona en ellas, porque su dominio no está autorizado;
  - lo que sí funciona en ellas (entrar con contraseña, el parte de trabajo por enlace) escribe en datos reales;
  - un cambio que necesita reglas nuevas falla en la preview aunque esté bien.
- **No hay copias de seguridad** ni forma de volver a un estado anterior de los datos.
- **No hay pruebas automáticas**, tampoco en lo que mueve dinero o va a la AEAT.
- **La cuota se puede gastar desde fuera.** La configuración de Firebase es pública por diseño, y cada petición evalúa `me()` en las reglas. Esa lectura se cobra aunque la regla rechace la petición, así que un script podría agotar la cuota de todos. Incluye enviar errores falsos a `errors`: los topes de envío están en el navegador.
- **Límites de cuota del uso normal:**
  - **Emitir las cuotas de un año de golpe** son unas 1.200 escrituras por comunidad de 100 viviendas: de 15 comunidades en adelante en el mismo día se pasa de las 20.000. Repartirlas en varios días o emitir por trimestres.
  - **Los documentos dentro de Firestore** comparten el 1 GiB con todo lo demás: unos 1.000 archivos de 1 MB lo llenan. El tope de 10 por persona lo comprueban las apps, no las reglas. Con Blaze (INF-1), a Cloud Storage.
  - **«Ver más»** en la cronología de la webapp y en las incidencias y notificaciones del admin vuelve a leer las páginas anteriores. Crece con cada pulsación, pero solo la de quien pulsa.
  - **Contención:** si muchos usuarios disparan el mismo error a la vez, todas las escrituras van al mismo grupo. Si Firestore empieza a rechazarlas, repartir el contador por días (`errors/{huella}/days/{fecha}`).
- **Límites de ROB-6:**
  - **Marcar pagado o pendiente a mano ya no funciona sin conexión.** Necesita leer el estado en el servidor, como ya pasaba con las entregas a cuenta.
  - **Dos pestañas que importan el mismo censo a la vez** pueden duplicar las propiedades nuevas. Con un identificador fijo, una propiedad renombrada bloquearía la importación entera.
  - **Una derrama emitida en dos pestañas** solo avisa: dos derramas iguales pueden ser legítimas.
  - **Borrar un recibo suelto** no comprueba si está pagado.
- **Privacidad:** falta añadir a la página legal que se guardan errores técnicos con el identificador del usuario durante 30 días, para corregir fallos.

---

## 3. Detectar (MON)

### MON-4 · Registro de operaciones clave (P1)

**Qué.** Poder reconstruir lo que pasó cuando un despacho diga «la remesa salió mal».

**Cómo.** Sin almacén nuevo:
- **Lo de negocio ya se registra.** El registro de actividad de cada comunidad ya guarda las operaciones del admin, inalterable y en el mismo lote que el cambio. Falta:
  - añadir las cifras a los resúmenes de las operaciones de dinero que no las llevan: recibos y total de una remesa, devoluciones casadas y sin casar, filas aceptadas y rechazadas al importar el censo;
  - registrar la descarga de cada fichero AEAT o SEPA, con el resultado de su comprobación.
- **Lo técnico va en el rastro** de cada error.

La parte de GAR-1 (exigir el registro en las reglas y guardar los valores de antes y después) es independiente y se puede hacer después.

**Hecho cuando** el recorrido de una remesa del piloto, desde la emisión de las cuotas hasta las devoluciones, se puede seguir en la actividad de la comunidad.

### MON-5 · Disponibilidad (P1)

**Qué.** Saber cuándo la app no carga en absoluto. Lo más probable no es que Hosting se caiga, sino que un despliegue publique algo roto o que se agote la cuota.

**Cómo.**
- **Tras cada despliegue,** un paso final del workflow pide las dos webs y el primer fichero JS que carga cada una. Si alguna no responde bien, el workflow falla y GitHub avisa por email.
- **Opcional:** la misma comprobación programada cada pocas horas en GitHub Actions. Si el repositorio es privado, gasta minutos del cupo gratuito de Actions.
- **Si se sospecha una caída de Firebase,** consultar status.firebase.google.com.

**Hecho cuando** un despliegue con el `index.html` roto hace fallar el workflow.

### MON-6 · Rendimiento real (P2)

**Qué.** Cuánto tardan de verdad las pantallas en el móvil de los vecinos y en el ordenador del despacho:
- la carga (LCP);
- los saltos de diseño (CLS);
- la respuesta a la interacción más lenta (aproximación a INP).

**Cómo.**
- **Medición:** con `PerformanceObserver`, nativo del navegador, sin librerías.
- **Muestreo:** el 10 % de las sesiones.
- **Envío:** una escritura por sesión al ocultarse la página. Suma con `increment`, en un documento por día y app, cuántas cargas de cada pantalla caen en cada tramo (hasta 1 s, hasta 2,5 s, hasta 4 s y más).
- **Panel:** una pestaña de la página «Errores» muestra el porcentaje de cargas buenas por pantalla.

Alternativa sin código: Firebase Performance Monitoring, del mismo proveedor que ya usamos, pero menos a medida.

**Hecho cuando** se ven las 10 pantallas más lentas de cada app.

### MON-7 · Rutina y guía de respuesta (P1)

**Rutina.**
- **Después de cada despliegue:** mirar en la página «Errores» los errores nuevos de la versión desplegada durante la primera hora.
- **Cada semana, unos 15 minutos:** los grupos nuevos y los que han vuelto, el uso de Firestore (consola → Firestore → Uso) y comprobar que se ha hecho la copia de seguridad (ROB-2).
- **Cada trimestre:** ensayar una restauración (ROB-2) y revisar las dependencias (ROB-7).

**Guía de respuesta.**

| Síntoma | Qué mirar | Qué hacer |
|---|---|---|
| Errores nuevos justo después de un despliegue | «Errores», filtrado por la versión | Volver a la versión anterior en Hosting (ROB-4) y corregir con calma |
| Muchos `permission-denied` después de cambiar las reglas | Qué versiones aparecen en el grupo | Si vienen de clientes antiguos, restaurar las reglas anteriores desde el historial y hacerlas compatibles (ROB-4) |
| Cuota agotada | Consola de Firebase → Uso: qué la disparó | Avisar a los despachos de que vuelve hacia las 9:00. Si fue una pantalla, corregirla (INF-2); si se repite, pasar a Blaze (INF-1) |
| Picos de lecturas o de errores sin explicación | Uso por horas en la consola y grupos sin sesión | Puede ser un abuso: restringir la clave y activar App Check (ROB-8) |
| Un despacho dice que algo salió mal | La actividad de la comunidad (MON-4) y los grupos de esa comunidad y fecha en «Errores» | Reproducirlo en los emuladores locales (o en el entorno de pruebas, si se hace ROB-1) |
| Falla en producción una función de dinero | «Errores» | Apagarla con su interruptor (ROB-5) mientras se corrige |
| Hay demasiados errores y gastan cuota | El contador `count` de los grupos | Bajar `errorSampleRate` o apagar `errorReporting` (ROB-5) |
| No se ha hecho la copia nocturna | El aviso del panel (ROB-2) | Lanzarla a mano el mismo día |
| Firebase caído | status.firebase.google.com | Avisar a los despachos; no hay nada que desplegar |

### MON-9 · Avisos (P1)

**Qué.** Enterarse de un grupo de errores nuevo o que ha vuelto sin tener que buscarlo.

**Cómo.**

| Opción | Servicios | Cuándo | A favor y en contra |
|---|---|---|---|
| **A. Contador de errores nuevos en la cabecera del admin**, solo para el equipo. Una consulta de recuento al abrir y cada hora | Ninguno | Ya | Cuesta muy poco. Solo se ve con el admin abierto |
| **B. Push al móvil del equipo**, con la mensajería que ya usa la webapp | Firebase (ya está) | Con INF-1: una función que salta cuando aparece un grupo nuevo o vuelve uno resuelto | Llega al momento. Necesita servidor |
| **C. Email al equipo** desde el correo saliente | El proveedor SMTP de FUN-2 | Con FUN-2 | Reutiliza la bandeja que ya existe |
| **D. Tarea programada de GitHub Actions** que revisa los grupos nuevos y abre una incidencia en el repositorio, de la que GitHub avisa por email | GitHub (ya está) | Ya, sin Blaze | Lee producción con una cuenta de servicio y gasta minutos de Actions y algunas lecturas |

Recomendación: A ahora y B con INF-1. D solo si INF-1 va a tardar y hace falta enterarse sin abrir el admin. Solo cuentan los urgentes y los que vuelven.

**Hecho cuando** un error nuevo hace aparecer el contador en la cabecera del equipo.

### MON-10 · Traducir los errores al código original (P2)

**Qué.** Leer la pila de un error con los nombres y las líneas del código fuente, sin publicar ese código. En producción, la pila apunta al código minificado.

**Cómo.**

| Opción | Servicios | A favor y en contra |
|---|---|---|
| **A. Guardar los mapas aparte en CI.** Se generan los mapas de código (`build.sourcemap: 'hidden'`), se guardan como artefacto de la ejecución de CI con el nombre de la versión y se borran de `dist` antes de desplegar. En local, un script (`npm run symbolicate`) descarga los de esa versión y traduce la pila copiada del panel con `source-map-js`, que ya está instalado porque viene con Vite | GitHub (ya está) | Los mapas nunca se publican. Los artefactos caducan a los 90 días por defecto |
| **B. Reconstruir en local** la versión del error (`git checkout <commit>` y `npm run build` con los mapas) y traducir con el mismo script | Ninguno | Nada sale del equipo. Es más lento |
| **C. No traducir:** basta con el nombre del fichero, que sale de la página, y con el rastro | Ninguno | Suficiente para la mayoría de los fallos |

Recomendación: C al principio y A cuando un fallo no se entienda con el rastro.

**Hecho cuando** la pila de una muestra de producción se traduce en local a las líneas reales del código.

---

## 4. Evitar y recuperarse (ROB)

### ROB-5 · Interruptores remotos y versión mínima (P1)

**Qué.** Apagar una función que está fallando o forzar a todos a actualizar, sin desplegar. Sirve para dos casos:
- **Un fallo en producción en algo delicado** (por ejemplo, las remesas generan un fichero mal): se apaga esa función para todos los despachos en un minuto, mientras se corrige, en lugar de esperar a un despliegue y a que cada uno actualice.
- **Un cambio que no es compatible con la versión anterior** (ROB-4): se sube la versión mínima y quien siga con la antigua tiene que actualizar antes de seguir.

**Cómo.** Con Remote Config, que es del mismo Firebase y no añade proveedor. Es gratis, funciona en web y no gasta cuota de Firestore (su límite son 100.000 consultas al día por proyecto).
- **Funciones:** `payments`, `remittances`, `aeatFiles` y `censusImport`.
- **Monitorización:** `errorReporting` (encendido o apagado) y `errorSampleRate` (de 0 a 1).
- **Versión mínima:** un `minVersion` que activa el aviso de actualización que ya tiene la PWA.
- **Mantenimiento:** un mensaje opcional para las dos apps.
- **Comportamiento:** la app los consulta al abrirse y cada pocas horas. Si no puede consultarlos, todo queda como está por defecto (encendido).

Alternativa sin Remote Config: un documento `config/app` en Firestore. Más sencillo, pero cuesta una lectura por sesión.

**Hecho en el código** (04/11/2026): `packages/shared/infrastructure/remoteConfig.ts` lee los interruptores al abrir y en cuanto se publica un cambio; los parámetros y qué hace cada uno, en [firebase.md](firebase.md). Comprobado en el admin de demo cambiando los valores en el navegador, no con la consola: allí no hay clave real.

**Hecho cuando** apagar `remittances` en la consola oculta la generación de remesas en el admin sin desplegar.

### ROB-4 · Despliegues compatibles y vuelta atrás (P1)

**Qué.** Que un despliegue no rompa a quien tiene abierta la versión anterior, y que deshacerlo cueste minutos.

**Cómo.**
- **Conviven varias versiones.** Una PWA instalada o una pestaña abierta siguen con la versión anterior hasta que el usuario acepta la actualización, y eso puede tardar horas o días. Hoy las reglas se despliegan antes que la app, lo que protege al código nuevo pero no al antiguo. Por eso un cambio en las reglas o en la forma de los datos va en tres pasos:
  1. primero las reglas aceptan la forma antigua y la nueva;
  2. se sube la versión mínima (ROB-5) para que todos actualicen;
  3. después se deja de aceptar la forma antigua.

  Sin medir quién usa qué versión: la versión mínima garantiza que ya no queda nadie con la antigua.
- **Volver atrás la app.** Hosting guarda las versiones publicadas: en la consola, Hosting → historial de versiones → restaurar la anterior. También se puede revertir el commit y dejar que despliegue CI.
- **Volver atrás las reglas.** Desde el historial de reglas de la consola, como ya explica [firebase.md](firebase.md). Después hay que corregir el fichero, porque el siguiente push lo vuelve a desplegar.

**Hecho cuando** se ha ensayado una vez volver atrás la app y las reglas, y el procedimiento está en la guía de MON-7.

### ROB-2 · Copias de seguridad con restauración ensayada (P0)

**Qué.** Poder volver a los datos de ayer si un error, un despliegue o una persona borra o estropea algo. Hoy no hay ninguna copia.

**Cómo, con Blaze (INF-1).**
- **Copias programadas de Firestore** (requieren Blaze): una diaria con unos 14 días de retención y una semanal que dure más. También la recuperación a un momento concreto, si su precio encaja.
- **Restauración:** se hace en una base de datos nueva y desde ahí se copia lo necesario, sin pisar producción.
- **Fotos y vídeos de Cloudinary:** no entran en estas copias. O se incluyen aparte, o se deja por escrito que se asume perderlos.

**Puente gratuito hasta entonces.** Un script con el Admin SDK (`npm run backup`) que exporta las colecciones, las cifra y las guarda. Hay dos opciones:
- **a) En tu propio equipo,** programado con `launchd`. Los datos no salen de tu equipo, pero solo se hace si el equipo está encendido.
- **b) En GitHub Actions,** como artefacto cifrado y de retención corta. Se hace siempre, pero los datos personales quedan en GitHub, fuera de la UE, aunque cifrados.

Recomendación: a).

Las dos opciones leen todos los documentos, así que gastan cuota y solo sirven mientras haya pocos datos.

**Vigilancia sin servicios externos.** Al terminar, el script escribe `ops/backup` con la fecha y el número de documentos. La página «Errores» muestra un aviso si la última copia tiene más de 26 horas.

**Ensayo.** Cada trimestre, restaurar la última copia en los emuladores locales (o en el entorno de pruebas, si se hace ROB-1) y comprobar que la app funciona con ella. Una copia que nunca se ha restaurado no garantiza nada.

**Hecho cuando** hay una copia diaria automática y se ha restaurado una entera al menos una vez.

### ROB-3 · Pruebas automáticas de lo que mueve dinero (P1)

**Qué.** Que CI pare un despliegue que rompe un cálculo o un fichero oficial. Un error ahí le cuesta dinero a una comunidad o le trae una sanción.

**Qué probar, por orden:**
1. **Ficheros oficiales:** 347, 111/115, 190, 184, pain.008, pain.001 y XDiario, comparados con ficheros que la AEAT y el banco ya hayan aceptado (VAL-1).
2. **Lectura de ficheros del banco:** Norma 43, pain.002 y camt.054, con ejemplos reales anonimizados.
3. **Cálculos:** el reparto por coeficientes (que la suma de los recibos dé el total al céntimo), los intereses de demora, las entregas a cuenta y la regularización y el cierre (que el balance cuadre).
4. **Reglas de Firestore en el emulador:** quién puede leer y escribir recibos, pagos, asientos y errores, y que nada se escriba en un ejercicio cerrado.

**Cómo, sin dependencias nuevas.** La lógica está en `packages/shared/domain`, en TypeScript puro, con los imports acabados en `.ts` y sin enums. Node 24 ejecuta ese TypeScript sin compilarlo, así que `node --test` basta, sin instalar nada. Las reglas se prueban con el emulador que ya se usa. Todo esto iría en el paso de CI que hoy pasa ESLint y el build.

Hoy el proyecto no tiene pruebas, por decisión propia: este punto es para cuando se decida añadirlas.

**Hecho cuando** CI falla al romper a propósito el reparto por coeficientes o el 347.

### ROB-7 · Dependencias al día (P2)

**Qué.** No llevar a producción una vulnerabilidad conocida ni quedarse años atrás en Firebase o Vue.

**Cómo.**
- **Dependabot:** activar en GitHub sus alertas y actualizaciones de seguridad (son gratis).
- **CI:** un `npm audit --omit=dev --audit-level=high` que pare el despliegue.
- **Cada trimestre:** revisar el resto con el `check-deps` que ya existe.

**Hecho cuando** Dependabot está activo y CI falla ante una vulnerabilidad alta.

### ROB-8 · Proteger la cuota de abusos (P2)

**Qué.** Que nadie pueda gastar la cuota de todos usando la configuración pública de Firebase. Esto incluye enviar errores falsos a `errors`.

**Cómo.**
- **Restringir la clave de la API** en Google Cloud a los dominios de las dos apps. Es gratis e inmediato.
- **App Check con reCAPTCHA Enterprise:** primero en modo de solo medir y luego obligatorio en Firestore. Es de Google, pero un producto aparte, con sus propias condiciones. Da 10.000 comprobaciones gratis al mes, pero por defecto cada usuario renueva su token dos veces por hora: cabe en el piloto y después cuesta dinero. Comprobar el precio antes de activarlo.

**Hecho cuando** la clave está restringida y App Check mide sin bloquear a nadie.

### ROB-1 · Entorno de pruebas separado (P0, aplazado)

**Qué.** Un segundo proyecto de Firebase (por ejemplo, `gobernansa-staging`), también en el plan gratuito y con su propia cuota y sus propios sitios de Hosting, para las previews de cada PR y para probar antes de producción.

**Cómo.**
- **Previews.** El workflow de PR compila con los valores de ese proyecto (un *environment* de GitHub con sus propios secretos) y despliega en él sus reglas antes de la preview. Así cada PR se prueba con las reglas que trae.
- **Producción** solo se toca al hacer merge a `main`, como ahora.
- **Datos de prueba** con el script de seed que ya existe, solo contra ese proyecto: borra lo que haya.
- **Acceso.** Autorizar el dominio de sus previews en la autenticación de ese proyecto, para poder entrar con enlace mágico.
- **Usos.** Ahí se ensayarían las restauraciones (ROB-2), se reproducirían los fallos (MON-7) y se probaría el propio sistema de errores sin gastar la cuota de producción. Mientras esté aplazado, eso se hace en los emuladores locales.

**Coste:** 0 €. Se puede tener más de un proyecto en el plan gratuito.

**Hecho cuando** una PR se puede probar entrando con enlace mágico, sin tocar producción.

---

## 5. Fuentes

Comprobadas el 02/11/2026:
- [Precios de Firebase](https://firebase.google.com/pricing): cuotas del plan gratuito y límite de Remote Config; Cloud Functions solo con Blaze.
- [Cuotas de Firestore](https://firebase.google.com/docs/firestore/quotas): se reinician hacia la medianoche de la hora del Pacífico.
- [Copias de seguridad de Firestore](https://firebase.google.com/docs/firestore/backups): las copias programadas requieren Blaze.
- [TTL de Firestore](https://firebase.google.com/docs/firestore/ttl): borra en las 24 horas siguientes a la caducidad y sus borrados cuentan como borrados. No dice si está en el plan gratuito.
- [Buenas prácticas de Firestore](https://firebase.google.com/docs/firestore/best-practices): no hay un límite fijo de escrituras por documento; la contención aparece a mucha frecuencia.
- [Facturación de Firestore](https://firebase.google.com/docs/firestore/pricing) y [condiciones de las reglas](https://docs.cloud.google.com/firestore/docs/security/rules-conditions): las lecturas de `get()` y `exists()` se cobran aunque la regla rechace la petición.
- [App Check con reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider): cupo gratuito y renovación del token.
