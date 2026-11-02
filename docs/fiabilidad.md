# Fiabilidad: monitorización y robustez de gobernança

*Revisado en el código el 02/11/2026. Los límites de Firebase y GitHub se comprobaron en sus webs ese día; cambian a menudo, así que hay que revisarlos antes de depender de ellos.*

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
- gasta cuota de Firestore (sección 3.4);
- mientras no haya servidor (INF-1), ningún aviso puede salir solo del navegador.


## 0. Cómo usar este documento

- **MON** son los huecos para *detectar* fallos y **ROB** los que sirven para *evitarlos y recuperarse*. Los demás grupos (FUN, INF, DAT, GAR, VAL, EMP) están en la sección 9.2 de [competencia.md](competencia.md).
- Los identificadores son estables: no se reutilizan ni se renumeran.
- Prioridades: **P0** antes del piloto, **P1** durante el piloto, **P2** después.
- Al cerrar uno, poner la fecha en su columna «Estado» del resumen y quitarlo de la tabla de fiabilidad de la sección 9.2 de competencia.md.
- La sección 3 es el diseño del sistema propio de errores. Las fichas MON de la sección 4 remiten a ella.

---

## 1. Resumen

| ID | Prioridad | Qué | Coste | Depende de | Estado |
|---|---|---|---|---|---|
| MON-1 | P0 | Captura de errores en el navegador y envío a Firestore | 0 €; cuota de escrituras acotada | — | 02/11/2026 |
| MON-2 | P0 | Clasificar los errores y decidir cuáles son urgentes | 0 € | MON-1 | 02/11/2026 |
| MON-3 | P0 | Aviso cuando se agota la cuota de Firestore y medición de lecturas por pantalla | 0 € | MON-1 | 02/11/2026 |
| MON-4 | P1 | Registro de las operaciones que mueven dinero o generan ficheros oficiales | 0 € | — | Pendiente |
| MON-5 | P1 | Disponibilidad: comprobar las dos webs después de cada despliegue | 0 € | — | Pendiente |
| MON-6 | P2 | Rendimiento real por pantalla, con las APIs del navegador | 0 €; cuota acotada | MON-1 | Pendiente |
| MON-7 | P1 | Rutina de revisión y guía de respuesta | 0 € | MON-8 | Pendiente |
| MON-8 | P0 | Panel de errores en el admin, solo para el equipo | 0 €; lecturas al abrirlo | MON-1 | 02/11/2026 |
| MON-9 | P1 | Avisos de errores nuevos: dentro del admin ya; en el móvil con INF-1 | 0 € | MON-8 | Pendiente |
| MON-10 | P2 | Traducir los errores al código original sin publicarlo | 0 € | MON-1 | Pendiente |
| ROB-1 | P0 | Entorno de pruebas separado de producción | 0 € (segundo proyecto gratuito) | — | Pendiente |
| ROB-2 | P0 | Copias de seguridad con restauración ensayada | Almacenamiento de las copias con Blaze; hay un puente gratuito | INF-1, ROB-1 | Pendiente |
| ROB-3 | P1 | Pruebas automáticas de lo que mueve dinero o va a la AEAT | 0 € | VAL-1 | Pendiente |
| ROB-4 | P1 | Despliegues compatibles con la versión anterior y vuelta atrás | 0 € | ROB-5 | Pendiente |
| ROB-5 | P1 | Interruptores remotos y versión mínima | 0 € (Remote Config) | — | Pendiente |
| ROB-6 | P1 | Operaciones de dinero que no se pueden duplicar | 0 € | — | Pendiente |
| ROB-7 | P2 | Dependencias al día | 0 € | — | Pendiente |
| ROB-8 | P2 | Proteger la cuota de abusos | 0 € la clave; App Check, 10.000 comprobaciones gratis al mes | — | Pendiente |

**Orden recomendado:**
1. **Fase 1, lo mínimo útil:** MON-1, MON-2, MON-3 y MON-8. Con eso ya se ven los errores reales de los usuarios, agrupados y con su contexto.
2. ROB-1, ROB-6 y ROB-5.
3. **Fase 2:** MON-9 (dentro del admin), MON-4, MON-5 y ROB-4.
4. ROB-2 en cuanto haya Blaze (INF-1); hasta entonces, su puente gratuito.
5. **Fase 3:** MON-10, MON-6 y los avisos al móvil de MON-9.

---

## 2. Situación actual

### Lo que ya está bien

- **CI:** cada push a `main` pasa ESLint, la comprobación de tipos (`vue-tsc`) y el build antes de desplegar. Las reglas se despliegan antes que la app y, si no compilan, no se despliega nada.
- **Reglas de Firestore:** unas 800 líneas que validan la forma de cada escritura. Son la última defensa ante un error del cliente.
- **Dinero:** los importes se guardan en céntimos, y las escrituras de varios documentos van en lote (`writeBatch`) o en transacción, así que un cobro no queda a medias.
- **Caché persistente de Firestore:** la app abre sin conexión. Las escrituras hechas sin conexión se guardan en el navegador y se envían al volver, también después de recargar.
- **Registro de actividad por comunidad** (`communities/{c}/activity`). Guarda quién, cuándo y un resumen de cada cambio hecho desde el admin. Se escribe en el mismo lote que el cambio, firmado y fechado por el servidor, y no se puede editar ni borrar. Reabrir un ejercicio también queda registrado. Es la base de MON-4.
- **Errores en el admin:** `optimistic()` y `toast()` ([toast.ts](../apps/admin/src/app/ux/toast.ts)) centralizan qué pasa cuando falla una acción: el cambio se deshace solo y se muestra el error. Lo usan 67 acciones.
- **Actualizaciones:** las dos PWA avisan cuando hay versión nueva.
- **Vuelta atrás:** Hosting guarda las versiones publicadas y la consola guarda el historial de reglas (ROB-4).

### Lo que falta

- **Ningún error sale del navegador.** El admin enseña el error en un aviso, y la webapp en la propia página o en `console.error` (unos 20 sitios). Si un vecino no puede pagar un recibo, nadie se entera salvo que llame.
- **No hay captura global de errores.** No hay `app.config.errorHandler`, ni nada recoge las promesas rechazadas sin `catch`. Tampoco se detecta cuando una pantalla no carga tras un despliegue: las rutas se cargan por partes (18 en la webapp y 51 en el admin), y una pestaña abierta con la versión anterior pide partes que ya no existen.
- **Nadie vigila la cuota.** No se detecta `resource-exhausted`: el día que se agota la cuota, cada pantalla falla con un error genérico hasta hacia las 9:00 del día siguiente (la medianoche de la hora del Pacífico).
- **Las previews de cada PR apuntan a producción**, con el mismo proyecto y las mismas reglas:
  - el enlace mágico no funciona en ellas, porque su dominio no está autorizado;
  - lo que sí funciona en ellas (entrar con contraseña, el parte de trabajo por enlace) escribe en datos reales;
  - un cambio que necesita reglas nuevas falla en la preview aunque esté bien.
- **No hay copias de seguridad** ni forma de volver a un estado anterior de los datos.
- **No se sabe qué versión usa cada usuario.** No hay identificador de versión, ni visible ni enviado a ningún sitio.
- **No hay pruebas automáticas**, tampoco en lo que mueve dinero o va a la AEAT.
- **La cuota se puede gastar desde fuera.** La configuración de Firebase es pública por diseño, y cada petición evalúa `me()` en las reglas. Esa lectura se cobra aunque la regla rechace la petición, así que un script podría agotar la cuota de todos.

---

## 3. Sistema propio de errores: diseño

### 3.1 Piezas

```
Navegador (admin y webapp)
  captura → limpia los datos personales → clasifica → calcula la huella → limita → lote a Firestore

Firestore (el mismo proyecto)
  errors/{huella}                  el grupo: contadores, estado, versiones y pantallas
  errors/{huella}/samples/{id}     las muestras: pila, rastro y contexto (30 días)

Admin, solo el equipo
  panel de errores (MON-8) → estados, reaparecidos, por versión, avisos (MON-9)

CI
  versión en cada build · mapas de código guardados aparte (MON-10) · comprobación tras desplegar (MON-5)
```

### 3.2 Captura en el navegador (MON-1)

**Un módulo compartido,** `packages/shared/infrastructure/monitoring.ts`, con dos funciones:
- `installMonitoring(app, router, appName)`: la llaman los dos `main.ts` justo después de `createApp`;
- `reportError(error, contexto)`: la usa el resto del código.

En local contra el proyecto real solo escribe en la consola. Con los emuladores envía al emulador, para poder probar el panel.

**Dónde se engancha:**
- `app.config.errorHandler`, para los errores de los componentes de Vue;
- `window` `error` y `unhandledrejection`, para los errores de JavaScript y las promesas sin `catch`;
- `router.onError`, para los fallos al navegar;
- `vite:preloadError`, para la pantalla que no carga tras un despliegue. Recarga, guardando en `sessionStorage` cuándo lo ha hecho para no entrar en bucle; si vuelve a fallar, se informa. Solo al ir a una pantalla (no cuando el admin la carga por adelantado), solo si es una parte que no se ha descargado (no una que falla al ejecutarse) y como mucho una vez cada 10 minutos;
- el `catch` de `optimistic()` y de `undo()` en el admin, que cubre de una vez las 67 acciones que ya pasan por ahí. La acción va como contexto (su texto `failed`, por ejemplo «No se ha podido generar la remesa»);
- en la webapp, los `console.error`, que pasan a ser `reportError(error, contexto)`.

**Rastro de lo que hizo el usuario antes del error.** Es nuestra versión ligera de una grabación de sesión. Se guardan en memoria los últimos 30 hechos:
- cada cambio de pantalla (nombre de la ruta);
- cada clic en un botón o enlace, solo con su texto visible o su `aria-label`, nunca el valor de un campo;
- cada acción del admin (el nombre que le da `optimistic()`);
- cuándo se pierde y se recupera la conexión;
- cuándo se actualiza la PWA.

Viaja con la muestra.

**Contexto de cada muestra:**
- la app, la versión, el nombre de la ruta y la comunidad, el rol y el `uid`;
- el navegador y el sistema, resumidos del user agent;
- si es la PWA instalada (`display-mode: standalone`) y si había conexión.

**Limpieza antes de enviar:**
- se borra del mensaje y de la pila lo que parezca un email, un IBAN, un NIF o un teléfono;
- se cortan los tamaños (mensaje de 500 caracteres, pila de 4 KB).

**El propio sistema nunca debe fallar en cadena:** todo va en `try/catch`, no se informa de los errores del propio módulo, y el envío no se espera (no bloquea la pantalla).

**Versión.** CI pasa al build una versión que se puede ordenar: `VITE_RELEASE`, con la fecha y el commit (por ejemplo, `2026.11.02-1530-ab12cd3`). Va con cada muestra y se muestra en el perfil de la webapp y en el menú del admin, para que el cliente pueda decir qué versión tiene.

### 3.3 Agrupación: la huella

Un mismo fallo que sale 300 veces es un solo grupo. La huella son 16 caracteres del SHA-1 (con `crypto.subtle`, nativo del navegador) de:
- la app;
- el tipo: `js`, `firebase:<código>` o `carga`;
- el mensaje normalizado: los números, identificadores, emails y textos entre comillas se cambian por marcadores;
- el nombre del primer fichero propio de la pila, sin el hash que le pone Vite (`IssuesPage-a1b2c3.js` → `IssuesPage.js`);
- la acción del admin o de la página, si la hay. Los errores de Firebase salen de su propio código, así que sin ella todos los `permission-denied` de una app serían un solo grupo.

**Límite.** Los nombres minificados de las funciones cambian en cada versión, por eso la huella usa el fichero, que Vite nombra a partir del componente o la página. Si aun así dos grupos son el mismo fallo, el panel permite fusionarlos (`mergedInto`).

### 3.4 Envío y presupuesto de cuota

**Un lote por error,** con el grupo y, si toca, una muestra:
- **El grupo:** un `update` que suma con `increment` a `count`, pone `lastSeen` con la hora del servidor y añade la versión y la ruta a sus listas, con tope. La primera vez que alguien ve el fallo, las reglas lo rechazan porque el grupo aún no existe, y entonces se crea. Si el grupo tiene las listas llenas, se envían solo los contadores.
- **La muestra:** solo la primera vez que ese fallo aparece en la sesión, y solo si sale en el muestreo (`errorSampleRate`, por defecto 1). Cuando hay muestra, el grupo también suma 1 a `sessions`.

Son 1 o 2 escrituras por error, y ninguna lectura: las reglas de creación no llaman a `me()`. Los envíos salen de uno en uno: el `update` que las reglas rechazan la primera vez reinicia la conexión de escritura de Firestore, y lo que iba con él se vuelve a enviar.

**Límites en el navegador:**
- como mucho un envío por huella cada 10 minutos. Lo que pase entretanto se acumula y se suma de golpe en el siguiente envío (`increment(n)`), o al ocultarse la página;
- como mucho 20 envíos por sesión.

**Sin conexión.** No hace falta una cola propia: la caché persistente de Firestore que ya usa la app guarda las escrituras pendientes y las envía al volver.

**Con la cuota agotada** (MON-3) no se envía nada, para no llenar esa cola.

**Presupuesto, con una estimación propia del peor caso.** Con 500 usuarios activos al día, unas 3 sesiones cada uno y un fallo que salte en cada carga, salen unas 3.000 escrituras al día: un 15 % de las 20.000 gratuitas. Los topes por sesión acotan el resto. El interruptor `errorReporting` de ROB-5 permite bajar el muestreo o apagar el envío sin desplegar.

**Contención.** Si muchos usuarios disparan el mismo fallo a la vez, todas las escrituras van al mismo documento del grupo. Firestore no tiene un límite fijo por documento, pero a mucha frecuencia empieza a rechazar escrituras por contención. Si pasa, se reparte el contador por días (`errors/{huella}/days/{fecha}`).

### 3.5 Datos y reglas

**`errors/{huella}`, el grupo:**
- `app`, `kind` (`js`, `firebase` o `carga`), `code` (el de Firebase, o `js` y `carga` para los demás, para filtrar todos con un solo campo), `message` (normalizado) y `file` (el primer fichero propio de la pila);
- `firstSeen`, `lastSeen`, `count` y `sessions`;
- `releases` y `routes`, como mucho 20 cada una;
- `status` (`new`, `resolved` o `ignored`), `resolvedAt`, `resolvedBy`, `resolvedIn` y `note`;
- `mergedInto`.

**No lleva `uid`:** los usuarios afectados se cuentan con las muestras, que caducan.

**`errors/{huella}/samples/{id}`, la muestra:**
- `at`, `release`, `app`, `route`, `communityId`, `uid` y `role`;
- `browser`, `os`, `standalone` y `online`;
- `stack`, como mucho 4 KB;
- `trail`, como mucho 30 entradas;
- `context`: la acción y el código de Firebase;
- `expiresAt`.

**Reglas:**
- **Leer, cambiar el estado, fusionar y borrar:** solo el equipo (`isSuperadmin()`).
- **Crear y sumar:** cualquier usuario con sesión, con la forma validada:
  - solo los campos permitidos, con sus tamaños;
  - `count` solo puede subir, y como mucho 100 de una vez;
  - no se toca `status`;
  - en la muestra, el `uid` es el de la sesión, y las fechas, del servidor.
- **Sin sesión** (la pantalla de entrada y el parte de trabajo del gremio): crear con límites más estrictos y sin `uid`, o no informar. Decidido: no se informa. Lo que falla antes de restaurar la sesión espera en memoria y se envía en cuanto la hay.
- **Las reglas no pueden contar cuántas escrituras hace un usuario al día:** los topes están en el navegador. Quien manipule su navegador podría saltárselos, como puede escribir en cualquier otra colección que las reglas le permitan. App Check (ROB-8) lo cierra.

### 3.6 Retención y privacidad

- **Muestras, 30 días.** Hay tres opciones:
  - **a)** una política TTL de Firestore sobre `expiresAt`. Borra sola, en las 24 horas siguientes a la caducidad, y esos borrados cuentan para la cuota. Hay que comprobar que se puede activar en el plan gratuito;
  - **b)** un botón «Limpiar caducadas» en el panel;
  - **c)** que el panel las limpie solo, una vez al día, al abrirse.

  Recomendación: a), y b) si TTL no está disponible en el plan gratuito. Hecho: b), que además borra los grupos antiguos del punto siguiente; la política TTL se puede añadir en la consola cuando se compruebe ([firebase.md](firebase.md)).
- **Grupos:** los resueltos se conservan para detectar que vuelven. Los resueltos o ignorados que lleven 180 días sin repetirse se borran desde el panel.
- **Privacidad:** no hay terceros nuevos. Hay que añadir a la página legal que se guardan errores técnicos con el identificador del usuario durante 30 días, para corregir fallos.

### 3.7 Panel de errores en el admin (MON-8)

- **Acceso:** una página «Errores» solo para el equipo, como «Administradores» (`meta.superadmin`).
- **Lista de grupos:**
  - estado, app, mensaje, veces, sesiones afectadas, primera y última vez, y versiones;
  - filtros por estado, app, código y versión;
  - lee 25 grupos cada vez, con «Cargar más», como el correo saliente.
- **Reaparecidos:** un grupo resuelto con `lastSeen` posterior a `resolvedAt` se marca «Ha vuelto» y se sube arriba.
- **Por versión:** los errores que aparecen por primera vez en la última versión desplegada. Es la revisión de después de cada despliegue (MON-7).
- **Detalle de un grupo:**
  - sus muestras, con la pila, el rastro y el contexto;
  - enlaces a la comunidad y a la ficha de la persona en el admin;
  - un botón para copiar la pila y traducirla (MON-10).
- **Acciones:** resolver (con nota y versión), ignorar, reabrir, fusionar y limpiar.

### 3.8 Avisos (MON-9)

| Opción | Servicios | Cuándo | A favor y en contra |
|---|---|---|---|
| **A. Contador de errores nuevos en la cabecera del admin**, solo para el equipo. Una consulta de recuento al abrir y cada hora | Ninguno | Ya | Cuesta muy poco. Solo se ve con el admin abierto |
| **B. Push al móvil del equipo**, con la mensajería que ya usa la webapp | Firebase (ya está) | Con INF-1: una función que salta cuando aparece un grupo nuevo o vuelve uno resuelto | Llega al momento. Necesita servidor |
| **C. Email al equipo** desde el correo saliente | El proveedor SMTP de FUN-2 | Con FUN-2 | Reutiliza la bandeja que ya existe |
| **D. Tarea programada de GitHub Actions** que revisa los grupos nuevos y abre una incidencia en el repositorio, de la que GitHub avisa por email | GitHub (ya está) | Ya, sin Blaze | Lee producción con una cuenta de servicio y gasta minutos de Actions y algunas lecturas |

Recomendación: A ahora y B con INF-1. D solo si INF-1 va a tardar y hace falta enterarse sin abrir el admin.

### 3.9 Traducir los errores al código original (MON-10)

En producción, la pila apunta al código minificado. Hay tres opciones:

| Opción | Servicios | A favor y en contra |
|---|---|---|
| **A. Guardar los mapas aparte en CI.** Se generan los mapas de código (`build.sourcemap: 'hidden'`), se guardan como artefacto de la ejecución de CI con el nombre de la versión y se borran de `dist` antes de desplegar. En local, un script (`npm run symbolicate`) descarga los de esa versión y traduce la pila copiada del panel con `source-map-js`, que ya está instalado porque viene con Vite | GitHub (ya está) | Los mapas nunca se publican. Los artefactos caducan a los 90 días por defecto |
| **B. Reconstruir en local** la versión del error (`git checkout <commit>` y `npm run build` con los mapas) y traducir con el mismo script | Ninguno | Nada sale del equipo. Es más lento |
| **C. No traducir:** basta con el nombre del fichero, que sale de la página, y con el rastro | Ninguno | Suficiente para la mayoría de los fallos |

Recomendación: C al principio y A cuando un fallo no se entienda con el rastro.

---

## 4. Detectar (MON)

### MON-1 · Captura de errores en el navegador (P0)

**Qué.** Que cada error de las dos apps llegue a Firestore, agrupado, con la versión, la pantalla y lo que hizo el usuario justo antes.

**Cómo.** Secciones 3.2 a 3.6.

**Hecho cuando:**
- un error provocado a propósito en cada app aparece una sola vez como grupo, con su muestra, rastro y versión;
- repetirlo 50 veces en la misma sesión no pasa de unas pocas escrituras.

### MON-2 · Qué error es urgente y cuál no (P0)

**Qué.** Que solo se marquen como urgentes los errores que piden hacer algo. Si todo es urgente, nada lo es.

**Cómo.** `reportError` lee el código de los errores de Firebase (`error.code`) y decide:

| Código o tipo | Qué suele significar | Trato |
|---|---|---|
| `resource-exhausted` | Cuota agotada (MON-3) | Urgente. Aviso fijo en la app y no se envía nada |
| `permission-denied` | Las reglas y el código no coinciden: un despliegue roto o un cliente con una versión antigua (ROB-4) | Urgente |
| `failed-precondition` | Falta un índice compuesto | Urgente |
| `invalid-argument` y errores de JavaScript | Un fallo del código | Grupo nuevo; urgente si vuelve después de resolverlo |
| `unavailable`, `deadline-exceeded`, sin conexión | La conexión del usuario | No se envía; solo cuenta para el rastro |
| Errores de extensiones del navegador | Nada que ver con la app | Se descartan (pilas de `chrome-extension://` y similares) |
| Avisos de la propia app que una página lanza para mostrarlos (`new Error('el NIF del propietario no es válido.')`) | Un dato mal escrito, no un fallo | No se envía; solo cuenta para el rastro |

**Urgente** quiere decir que el grupo sale primero en el panel y cuenta para los avisos (MON-9).

**Hecho cuando** un error de conexión simulado no crea grupo y un `permission-denied` sale como urgente.

### MON-3 · Cuota de Firestore (P0)

**Qué.** Saber el día en que se agota la cuota y que el usuario vea por qué no funciona la app, en lugar de errores sueltos. Y saber antes qué pantallas la gastan.

**Cómo.**
- **Aviso al agotarse.** Cuando un error trae el código `resource-exhausted`, las dos apps muestran un aviso fijo: «El servicio ha alcanzado su límite diario y vuelve hacia las 9:00». Firestore no hace fallar las lecturas ni las escrituras con la cuota agotada, las reintenta: solo lo escribe en su registro, y de ahí se detecta (`onLog`). El error queda pendiente de enviar hasta que se reinicie la cuota, al día siguiente en hora del Pacífico.
- **Lecturas por pantalla (INF-2).** En desarrollo, un contador suma los documentos de cada lectura que no viene de la caché (`snapshot.metadata.fromCache`) y los escribe en la consola por ruta. No escribe nada en Firestore. Opcionalmente, durante el piloto, una muestra de las sesiones suma esas lecturas en un documento por día y app (una escritura por sesión).
- **Revisión semanal** del uso diario en la consola de Firebase (Firestore → Uso) mientras dure el piloto.
- **Con Blaze (INF-1):** alertas de presupuesto de Google Cloud (son gratis) a un importe bajo.

**Hecho cuando:**
- al simular `resource-exhausted` aparece el aviso en las dos apps;
- se sabe cuánto leen las 5 pantallas que más leen.

### MON-4 · Registro de operaciones clave (P1)

**Qué.** Poder reconstruir lo que pasó cuando un despacho diga «la remesa salió mal».

**Cómo.** Sin almacén nuevo:
- **Lo de negocio ya se registra.** El registro de actividad de cada comunidad ya guarda las operaciones del admin, inalterable y en el mismo lote que el cambio. Falta:
  - añadir las cifras a los resúmenes de las operaciones de dinero que no las llevan: recibos y total de una remesa, devoluciones casadas y sin casar, filas aceptadas y rechazadas al importar el censo;
  - registrar la descarga de cada fichero AEAT o SEPA, con el resultado de su comprobación.
- **Lo técnico va en el rastro** de cada error (3.2).

La parte de GAR-1 (exigir el registro en las reglas y guardar los valores de antes y después) es independiente y se puede hacer después.

**Hecho cuando** el recorrido de una remesa del piloto, desde la emisión de las cuotas hasta las devoluciones, se puede seguir en la actividad de la comunidad.

### MON-5 · Disponibilidad (P1)

**Qué.** Saber cuándo la app no carga en absoluto. Lo más probable no es que Hosting se caiga, sino que un despliegue publique algo roto o que se agote la cuota (MON-3).

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
- **Panel:** una pestaña del panel de MON-8 muestra el porcentaje de cargas buenas por pantalla.

Alternativa sin código: Firebase Performance Monitoring, del mismo proveedor que ya usamos, pero menos a medida.

**Hecho cuando** se ven las 10 pantallas más lentas de cada app.

### MON-7 · Rutina y guía de respuesta (P1)

**Rutina.**
- **Después de cada despliegue:** mirar en el panel (MON-8) los errores nuevos de la versión desplegada durante la primera hora.
- **Cada semana, unos 15 minutos:** los grupos nuevos y los que han vuelto, el uso de Firestore y comprobar que se ha hecho la copia de seguridad (ROB-2).
- **Cada trimestre:** ensayar una restauración (ROB-2) y revisar las dependencias (ROB-7).

**Guía de respuesta.**

| Síntoma | Qué mirar | Qué hacer |
|---|---|---|
| Errores nuevos justo después de un despliegue | Panel de errores, filtrado por la versión | Volver a la versión anterior en Hosting (ROB-4) y corregir con calma |
| Muchos `permission-denied` después de cambiar las reglas | Qué versiones aparecen en el grupo | Si vienen de clientes antiguos, restaurar las reglas anteriores desde el historial y hacerlas compatibles (ROB-4) |
| Cuota agotada | Consola de Firebase → Uso: qué la disparó | Avisar a los despachos de que vuelve hacia las 9:00. Si fue una pantalla, corregirla (INF-2); si se repite, pasar a Blaze (INF-1) |
| Picos de lecturas o de errores sin explicación | Uso por horas en la consola y grupos sin sesión | Puede ser un abuso: restringir la clave y activar App Check (ROB-8) |
| Un despacho dice que algo salió mal | La actividad de la comunidad (MON-4) y los grupos de esa comunidad y fecha (MON-8) | Reproducirlo en el entorno de pruebas (ROB-1) |
| Falla en producción una función de dinero | Panel de errores | Apagarla con su interruptor (ROB-5) mientras se corrige |
| Hay demasiados errores y gastan cuota | El contador `count` de los grupos | Bajar `errorSampleRate` o apagar `errorReporting` (ROB-5) |
| No se ha hecho la copia nocturna | El aviso del panel (ROB-2) | Lanzarla a mano el mismo día |
| Firebase caído | status.firebase.google.com | Avisar a los despachos; no hay nada que desplegar |

### MON-8 · Panel de errores en el admin (P0)

**Qué.** Ver los errores sin salir de la app, a medida de gobernança: por comunidad, por versión y con el rastro de lo que hizo el usuario.

**Cómo.** Sección 3.7.

**Hecho cuando** desde el panel se puede encontrar un error provocado a propósito, ver su rastro, abrir la comunidad afectada, resolverlo y ver que vuelve marcado «Ha vuelto» si se repite.

### MON-9 · Avisos (P1)

**Qué.** Enterarse de un grupo nuevo o que ha vuelto sin tener que buscarlo.

**Cómo.** Sección 3.8: el contador en la cabecera del admin ya, y el push al móvil con INF-1.

**Hecho cuando** un error nuevo hace aparecer el contador en la cabecera del equipo.

### MON-10 · Traducir los errores al código original (P2)

**Qué.** Leer la pila de un error con los nombres y las líneas del código fuente, sin publicar ese código.

**Cómo.** Sección 3.9.

**Hecho cuando** la pila de una muestra de producción se traduce en local a las líneas reales del código.

---

## 5. Evitar y recuperarse (ROB)

### ROB-1 · Entorno de pruebas separado (P0)

**Qué.** Un segundo proyecto de Firebase (por ejemplo, `gobernansa-staging`), también en el plan gratuito y con su propia cuota y sus propios sitios de Hosting, para las previews de cada PR y para probar antes de producción.

**Cómo.**
- **Previews.** El workflow de PR compila con los valores de ese proyecto (un *environment* de GitHub con sus propios secretos) y despliega en él sus reglas antes de la preview. Así cada PR se prueba con las reglas que trae.
- **Producción** solo se toca al hacer merge a `main`, como ahora.
- **Datos de prueba** con el script de seed que ya existe, solo contra ese proyecto: borra lo que haya.
- **Acceso.** Autorizar el dominio de sus previews en la autenticación de ese proyecto, para poder entrar con enlace mágico.
- **Usos.** Ahí se ensayan las restauraciones (ROB-2), se reproducen los fallos (MON-7) y se prueba el propio sistema de errores sin gastar la cuota de producción.

**Coste:** 0 €. Se puede tener más de un proyecto en el plan gratuito.

**Hecho cuando** una PR se puede probar entrando con enlace mágico, sin tocar producción.

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

**Vigilancia sin servicios externos.** Al terminar, el script escribe `ops/backup` con la fecha y el número de documentos. El panel del equipo (MON-8) muestra un aviso si la última copia tiene más de 26 horas.

**Ensayo.** Cada trimestre, restaurar la última copia en el entorno de pruebas (ROB-1) y comprobar que la app funciona con ella. Una copia que nunca se ha restaurado no garantiza nada.

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

### ROB-5 · Interruptores remotos y versión mínima (P1)

**Qué.** Apagar una función que está fallando o forzar a todos a actualizar, sin desplegar.

**Cómo.** Con Remote Config, que es del mismo Firebase y no añade proveedor. Es gratis, funciona en web y no gasta cuota de Firestore (su límite son 100.000 consultas al día por proyecto).
- **Funciones:** `payments`, `remittances`, `aeatFiles` y `censusImport`.
- **Monitorización:** `errorReporting` (encendido o apagado) y `errorSampleRate` (de 0 a 1), para MON-1.
- **Versión mínima:** un `minVersion` que activa el aviso de actualización que ya tiene la PWA.
- **Mantenimiento:** un mensaje opcional para las dos apps.
- **Comportamiento:** la app los consulta al abrirse y cada pocas horas. Si no puede consultarlos, todo queda como está por defecto (encendido).

Alternativa sin Remote Config: un documento `config/app` en Firestore. Más sencillo, pero cuesta una lectura por sesión.

**Hecho cuando** apagar `remittances` en la consola oculta la generación de remesas en el admin sin desplegar.

### ROB-6 · Operaciones de dinero que no se pueden duplicar (P1)

**Qué.** Que un doble clic, dos pestañas abiertas o un reintento después de perder la conexión no dupliquen nada: emitir dos veces las cuotas, generar dos remesas, registrar dos veces las devoluciones o dejar un cierre de ejercicio a medias.

**Cómo.** Revisar una a una las operaciones que crean deudas, pagos o documentos oficiales: emitir cuotas y derramas, generar remesas y órdenes de pago, importar devoluciones, conciliar, cerrar el ejercicio, importar el censo y cobrar intereses. En cada una:
- usar un identificador determinista, o comprobar dentro de una transacción que no se ha hecho ya;
- bloquear el botón mientras dura.

Algunas ya lo cumplen en parte (las cuotas del año comparten `batchId fees-{year}`), pero falta comprobarlo en todas.

**Hecho cuando** cada operación de la lista se ha probado con doble clic y con dos pestañas sin que se duplique nada.

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
- **Restringir la clave de la API** en Google Cloud a los dominios de las dos apps y a los del entorno de pruebas. Es gratis e inmediato.
- **App Check con reCAPTCHA Enterprise:** primero en modo de solo medir y luego obligatorio en Firestore. Es de Google, pero un producto aparte, con sus propias condiciones. Da 10.000 comprobaciones gratis al mes, pero por defecto cada usuario renueva su token dos veces por hora: cabe en el piloto y después cuesta dinero. Comprobar el precio antes de activarlo.

**Hecho cuando** la clave está restringida y App Check mide sin bloquear a nadie.

---

## 6. Fuentes

Comprobadas el 02/11/2026:
- [Precios de Firebase](https://firebase.google.com/pricing): cuotas del plan gratuito y límite de Remote Config; Cloud Functions solo con Blaze.
- [Cuotas de Firestore](https://firebase.google.com/docs/firestore/quotas): se reinician hacia la medianoche de la hora del Pacífico.
- [Copias de seguridad de Firestore](https://firebase.google.com/docs/firestore/backups): las copias programadas requieren Blaze.
- [TTL de Firestore](https://firebase.google.com/docs/firestore/ttl): borra en las 24 horas siguientes a la caducidad y sus borrados cuentan como borrados. No dice si está en el plan gratuito.
- [Buenas prácticas de Firestore](https://firebase.google.com/docs/firestore/best-practices): no hay un límite fijo de escrituras por documento; la contención aparece a mucha frecuencia.
- [Facturación de Firestore](https://firebase.google.com/docs/firestore/pricing) y [condiciones de las reglas](https://docs.cloud.google.com/firestore/docs/security/rules-conditions): las lecturas de `get()` y `exists()` se cobran aunque la regla rechace la petición.
- [App Check con reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider): cupo gratuito y renovación del token.
