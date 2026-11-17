# Roles y datos

Quién puede hacer qué y qué guarda cada parte de la plataforma en Firestore. La configuración del proyecto real está en [setup.md](setup.md), y [`firestore.rules`](../firebase/firestore.rules) es lo que manda: este documento lo explica.

<a id="roles"></a>

## Roles

Cada perfil de `users/{uid}` tiene un `role`. Las reglas lo aplican, y `packages/shared/domain/user.ts` las replica para que las apps solo ofrezcan lo permitido:

| Rol | Quién | Comunidades | Puede |
| --- | --- | --- | --- |
| `superadmin` | El equipo de gobernança | Todas | Todo: crear comunidades, invitar a administradores y asignarles comunidades |
| `admin` | Un administrador de fincas | Los ids de `communityIds` | Editar esas comunidades, invitar y quitar a sus gestores y vecinos |
| `manager` | Quien lleva la comunidad, p. ej. su presidente | Su `communityId` | Editarla e invitar o quitar a sus vecinos. En la webapp, cambiar el estado de las incidencias y gestionar los eventos |
| `user` | Un vecino | Su `communityId` | Usar la webapp |

En el admin cada uno solo abre lo que gestiona: el equipo, todo; los administradores, sus comunidades, y los gestores, la suya. **Nueva comunidad** y **Administradores** son del equipo. Los vecinos tienen una pantalla con los gestores y administradores de su comunidad para pedir acceso, así que las reglas les dejan leer esos perfiles (y solo esos). Nadie cambia su propio rol: los administradores dan los roles de gestor y vecino en sus comunidades, y los gestores solo el de vecino en la suya. `communityId` es donde vive cada uno (`''` para los administradores que no viven en ninguna); en la webapp, gestionar su propia comunidad también exige vivir en ella.

<a id="invitaciones"></a>

### Invitaciones

Las cuentas se añaden desde el admin (**Vecinos y gestores** de una comunidad, o **Administradores** para el equipo) invitando a un correo, que se guarda como `invitations/{correo en minúsculas}` con el nombre, el rol y la comunidad. Con **Enviar invitación por email** (marcado por defecto), se pone a la vez en cola un correo con el enlace a su app (la webapp para los vecinos, el admin para los demás); ver [correo saliente](#correo). La persona entra en la app con ese correo, y en su primer acceso se crea su perfil a partir de la invitación, que luego se borra. Solo pueden recogerla los correos verificados, como los de los enlaces de acceso; las cuentas con contraseña creadas en la consola no lo están.

Un correo que ya tiene perfil no recibe invitaciones: su rol se cambia desde la lista. Quitar a alguien borra su perfil, no su cuenta de acceso, así que una invitación nueva le devuelve el acceso.

<a id="cuatro-roles"></a>

### Paso a los cuatro roles

Antes, `admin` significaba todas las comunidades. Tras el push que despliega estas reglas, en **Firebase console → Firestore → users**:

1. Tu perfil (y el de cualquier otra persona del equipo): cambia `role` de `admin` a `superadmin`. Hasta entonces el admin no le muestra ninguna comunidad.
2. Cualquier otro `admin`: añade `communityIds` (un array de textos) con los ids de las comunidades que gestiona. Deja su `communityId` si vive en una, o ponlo a `''`.
3. Los gestores y vecinos no necesitan nada.

Las consultas nuevas solo usan filtros de igualdad, que Firestore sirve sin índices compuestos.

<a id="comunidad"></a>

## Datos de la comunidad

Los edita desde el admin quien gestiona cada comunidad (ver [roles](#roles)); solo el equipo las crea. La webapp solo los lee. Una comunidad todavía se borra desde la consola, junto con sus incidencias, usuarios e inmuebles. Se guardan en `communities/{communityId}`:

```text
cif, iban, bank
contacts[]     { type: admin | president | janitor | insurance | elevator | cleaning | gardening | other,
                 name, phone?, whatsapp?, email?,
                 schedule?: [{ days: [1..7], from: 'HH:MM', to: 'HH:MM' }] }
documents[]    { type: statutes | regulations | insurance | minutes, title, url, date }
monthlyVotes   votos que recibe cada inmueble cada mes, 5 si falta
issueCategories[]  { id, name, icon, color: amber | green | cyan | blue | purple | rose | gray, examples?, defaultTitle? },
                   en el orden en que las ven los vecinos. Las seis por defecto (DEFAULT_ISSUE_CATEGORIES) si falta
```

`schedule` vale para cualquier contacto (p. ej. los turnos del conserje): los días son los de la semana ISO (1 es lunes, 7 domingo) y las horas van en formato de 24 horas con ceros delante. Una entrada por turno, p. ej. `{ days: [1, 2, 3, 4, 5], from: '08:00', to: '15:00' }` y `{ days: [6], from: '09:00', to: '13:00' }`. El contacto muestra entonces su horario y si está disponible ahora.

<a id="categorias"></a>

### Categorías de incidencias

Cada comunidad tiene las suyas, que se editan desde **Incidencias → Categorías** en el admin, como las zonas comunes: crear, renombrar, cambiar el icono, el color y los ejemplos, reordenar arrastrando y borrar (siempre queda al menos una). Hasta que se guardan por primera vez, la comunidad tiene las seis por defecto (Mantenimiento, Limpieza, Molestias, Jardinería, Servicios, Otros). Las incidencias guardan el id de su categoría, así que renombrar una la renombra en todas; una borrada se muestra con su nombre por defecto si era de las de serie, o como **Sin categoría**. Las sugerencias al crear una incidencia solo conocen las de serie, así que solo ofrecen una de esas que la comunidad aún tenga. Un parte de trabajo guarda el nombre y el icono de la categoría, porque el proveedor no puede leer la comunidad.

<a id="votos"></a>

### Votos mensuales

Votan los inmuebles, no las personas: cada incidencia tiene como mucho un voto por inmueble, que emite su propietario (`ownerUid`), así que una vivienda con varias cuentas cuenta una vez y una cuenta sin inmueble no vota. Cada inmueble recibe `monthlyVotes` votos al mes (5 por defecto) para repartir entre las incidencias que más le importan. Quien tiene varios inmuebles vota con el elegido en su perfil, y cada uno tiene sus votos. Un voto gasta uno del mes en que se emite; retirarlo ese mismo mes lo devuelve, y los de meses pasados se quedan en sus incidencias sin gastar los de este. Se leen los votos del mes de los inmuebles del usuario (unos pocos documentos, nunca más de `monthlyVotes` por inmueble) y la app los separa por inmueble. Mientras no exista su [índice](setup.md#indices), los votos restantes no se pueden contar: salen como «—» y votar no tiene límite.

El límite lo comprueba la app. Las reglas no pueden contar documentos, así que quien llame directamente a la API podría pasarse; exigirlo en el servidor necesitaría una Cloud Function (plan de pago).

<a id="datos-app"></a>

## Lo que escribe la webapp

```text
communities/{communityId}/issues/{issueId}
  votesScore, votesCount, commentsCount   contadores, escritos junto con cada voto o comentario
  authorKey                               la clave secreta de quien la crea, para encontrar las suyas (ver abajo). Sin createdBy
  votes/{issueId}_{propertyId}            { propertyId, voterId (su propietario), score: 1 | -1, votedAt }
  private/author                          { uid }, quién la creó, escrito con ella y nunca cambiado
  comments/{commentId}                    { type: message | status, message, status?, authorId, authorName, authorRole? }
users/{uid}                               perfil, creado a partir de su invitación en el primer acceso
invitations/{email}                       { email, name, role, communityId, communityIds?, invitedBy, invitedAt }
users/{uid}/documents/{id}                documentos de un inmueble (la lista)
users/{uid}/documentFiles/{id}            su contenido, hasta 1 MB cada uno
users/{uid}/devices/{token}               dispositivos con las notificaciones push activadas
users/{uid}/keys/issues                   { key }, la clave secreta de las incidencias que crea, generada una vez y que solo lee su dueño
```

<a id="autor"></a>

### Quién crea una incidencia

Solo lo sabe la administración. La incidencia no tiene `createdBy` y los cambios de su autor no van firmados (`updatedBy`, ni `deletedBy` cuando la borra): quién la creó va en `private/author`, que solo lee quien gestiona la comunidad, escrito en el mismo lote y nunca cambiado. Para encontrar sus propias incidencias («Mis incidencias» y el recuento del inicio) y borrarlas, la incidencia lleva `authorKey`, 192 bits aleatorios generados la primera vez que el usuario la necesita y guardados en `users/{uid}/keys/issues`, que solo puede leer él. Los vecinos ven la clave pero no saben de quién es. Sí pueden saber que dos incidencias son del mismo autor, aunque no de quién; una incidencia sobre un inmueble (`location.type: property`) sigue diciendo cuál, como antes. Sus fotos van a una carpeta de Storage con el nombre de la clave, no del uid, para que sus URLs tampoco lo digan ([Storage](setup.md#storage)).

<a id="gestion"></a>

## Gestión de la comunidad

Todo lo que sigue corre en el navegador y lo aplica [`firestore.rules`](../firebase/firestore.rules), sin Cloud Functions ni tareas programadas, así que funciona en el plan gratuito. Solo las fotos de los proveedores necesitan Storage, en Blaze ([Storage](setup.md#storage)). Los tipos están en `packages/shared/domain`.

```text
properties/{id}                                 censo: name, type, coefficient (%), ownerUid ('' sin cuenta), ownerName, ownerEmail, ownerNif, ownerPhone (≤ 40), tenantName, tenantEmail
providers/{id}                                  directorio compartido por communityIds, con ratingSum / ratingCount
  ratings/{uid}                                 { score 1–5, comment, communityId, authorId, authorName }
events/{id}                                     también los comunicados: las copias de uno enviado a varias comunidades comparten broadcastId
communities/{c}/issues/{i}                      + provider, expectedAt, resolvedAt, insuranceClaim
  private/admin                                 nota interna, siniestro del seguro y el token del parte de trabajo del proveedor (workOrder); nunca lo leen los vecinos
  private/author                                quién la creó; nunca lo leen los vecinos
  comments/{id}                                 + hiddenAt, hiddenBy (ocultado por la administración)
workOrders/{token}                              partes de trabajo, ver abajo
mail/{id}                                       correo saliente, ver abajo
communities/{c}/meetings/{m}                    juntas: agenda, place / link, status draft | convened | held | cancelled, votingOpen
  attendance/{uid}                              attending | absent | delegated (+ delegateName)
  ballots/{itemId}_{propertyId}                 un voto por inmueble, ponderado por su coeficiente
  minutes/record                                el acta firmada, sellada con su hash (ver acta firmada, abajo)
  notices/{kind}_{uid}                          la convocatoria o el acta enviadas a cada propietario (ver acta firmada, abajo)
communities/{c}/charges/{id}                    recibos y derramas (céntimos), cada propietario lee los suyos. + collections, collected, collectionYears, interest (ver abajo)
communities/{c}/budgets/{year}, expenses/{id}   partidas del presupuesto y gastos (céntimos), abiertos a los vecinos
communities/{c}/obligations/{id}                IEE, ascensor, extintores, legionela, seguro… con dueAt y everyMonths
communities/{c}/bookings/{areaId}_{date}_{from} un turno solo se reserva una vez: su id convierte una segunda reserva en un cambio que las reglas rechazan
communities/{c}/activity/{id}                   quién cambió qué, escrito con cada cambio desde el admin, nunca editado
users/{uid}.blocked                             un vecino bloqueado puede leer, pero no crear incidencias, comentar, votar, reservar ni responder a las juntas
```

Lo que el plan gratuito deja fuera, y cómo se cubre:

- **Avisos de vencimiento** (obligaciones): no hay servidor que envíe correos, así que salen en el admin (la página de obligaciones y el panel de la cartera), y cada obligación se puede añadir al calendario del propio administrador como un `.ics` con su recordatorio.
- **Certificados y actas en PDF**: se imprimen desde el navegador («Guardar como PDF»); el admin oculta su marco al imprimir.
- **Límites que las reglas no pueden contar** (reservas por semana, votos mensuales de cada inmueble): los comprueba la app.
- **Documentos enviados a un vecino**: se guardan en Firestore como los suyos (hasta 1 MB cada uno).

Los recuentos del panel de la cartera usan consultas de agregación, que cuestan una lectura por cada 1.000 documentos contados.

«Ver como vecino» abre la webapp con `?viewAs=<communityId>`: quien gestiona esa comunidad la ve en solo lectura, como la vería un vecino. El admin necesita `VITE_WEBAPP_URL` (la dirección de la webapp, `https://gobernansa.dmoya.dev` si falta), y hay que entrar en la webapp con la misma cuenta.

<a id="censo"></a>

### Importación del censo

Desde **Vecinos → Propiedades → Importar censo** de una comunidad, su censo llega de un `.xlsx`, un CSV o TSV (`;`, `,` o tabulador, UTF-8 o Windows-1252) o de celdas pegadas desde Excel o Google Sheets. El `.xlsx` se descomprime y se lee en el navegador (`packages/shared/utils/xlsx.ts`, con `DecompressionStream` y `DOMParser`), con los porcentajes y las fechas como los muestra Excel; los `.xls` binarios antiguos no se leen, y la página pide guardarlos como `.xlsx` o CSV. La fila de cabecera y cada columna se deducen de los títulos y se pueden cambiar. Luego cada fila se compara con el censo por el nombre del inmueble, sin distinguir mayúsculas, acentos, espacios ni puntuación: nueva, cambio (solo lo que rellena el fichero; una celda vacía nunca borra nada), sin cambios o error (sin nombre o repetido; coeficiente, NIF, IBAN, correo o fecha del mandato no válidos), y la página avisa cuando los coeficientes no suman 100 %. La revisión lista primero los errores de cada comunidad y muestra hasta 200 filas hasta **Mostrar … filas más**; se comprueban e importan todas igualmente. **Descargar plantilla** da un CSV con los títulos esperados.

Desde la lista de comunidades, **Importar comunidades** acepta el mismo fichero con una columna **Comunidad** (y, si se quiere, su CIF, dirección e IBAN). Cada comunidad del fichero se empareja con una existente por CIF y luego por nombre. El equipo de gobernança crea las que no existen (sin `constructionYear` ni administradores, que se asignan después desde **Administradores**); los administradores solo importan en las suyas.

```text
properties/{id}     los campos que escribe la página de propiedades; las nuevas con ownerUid ''
  mandate           a partir de IBAN + referencia del mandato + fecha de firma: { reference, debtorName (el propietario), iban, signedAt,
                    status: 'active', firstRemittanceId: 'migrated' }
communities/{id}    las creadas: { name, address, cif?, iban?, createdAt, createdBy, updatedAt, updatedBy }
```

- **No se borra nada**: los inmuebles que faltan en el fichero se listan y se quedan como están. Los propietarios con cuenta conservan el nombre y el correo de la cuenta.
- **Mandatos migrados**: `firstRemittanceId: 'migrated'` (como si una remesa hubiera llevado su primer adeudo) hace recurrente (RCUR) su primer adeudo desde aquí, como pide SEPA para los mandatos traídos de otro programa. Un IBAN sin la referencia y la fecha de su mandato no se guarda, porque los inmuebles no tienen dónde, y la fila lo dice. Los teléfonos van a `ownerPhone`, tal cual (una fila con uno de más de 40 caracteres es un error).
- **Escrituras**: lotes de hasta 497 inmuebles más su entrada de actividad (y la comunidad creada con la suya), dentro de las 500 escrituras de un lote. Si uno falla, lo escrito se queda y el fichero se compara otra vez, así que importarlo de nuevo solo escribe lo que falta.
- **Invitaciones**, opcionales: cada propietario con correo y sin cuenta se invita como vecino con el `invite()` de la página de personas, una invitación y una entrada de actividad cada uno, saltándose los correos que ya tienen perfil o invitación en la comunidad. Como en la página de personas, **Enviar invitación por email** (marcado por defecto) pone también en cola el correo de cada invitación (ver [correo saliente](#correo)).
- **Reglas**: lo cubren las de `properties` (un coeficiente numérico y `ownerPhone` un texto de hasta 40 caracteres), `communities` (que solo crea `superadmin`), `invitations`, `mail` y `activity`.
- **Lecturas**: una consulta de los inmuebles de cada comunidad (`communityId ==`) al leer el fichero, y otra al volver a la página o después de importar; al invitar, una de sus usuarios y una de sus invitaciones, más la comunidad una vez por invitación enviada por correo (`invite()` la lee para su nombre). Solo igualdades, sin índice nuevo. No se paga ni se envía nada a ningún sitio, así que no hay modo de prueba.

<a id="entregas"></a>

### Entregas a cuenta e intereses de demora

Desde **Recibos**, el despacho anota cobros parciales de un cargo pendiente que no está domiciliado (importe, fecha, efectivo / transferencia / tarjeta / otro, nota) y los deshace uno a uno. Lo pendiente es el importe menos lo cobrado, y todo lo que muestra o suma deuda lo usa: la lista de cargos, los extractos (cada entrega en su línea), la antigüedad de la deuda, las cartas de reclamación, el monitorio, el certificado de pagos, el resumen de Finanzas, el panel de la comunidad y la cartera, los candidatos del banco, las exportaciones de saldos y deudores (la de cargos añade una columna **Cobrado a cuenta**), los adeudos de una remesa nueva y **Mis recibos** de los vecinos, cuyo pago de prueba paga lo pendiente. El diario contabiliza cada entrega en su fecha (a 570 Caja si es en efectivo, si no a 572 Bancos) y el resto el día en que se pagó el cargo. Los cargos sin estos campos funcionan como antes.

Los intereses de demora son un ajuste de cada comunidad, desactivado por defecto, que se edita en **Morosidad**: el tipo anual y los días de gracia. Son intereses simples sobre lo pendiente de cada cargo vencido, día a día, desde su vencimiento más la gracia hasta hoy (u otro día elegido), sobre un año de 365 días y redondeados al céntimo por cargo. La página recuerda que necesitan la aprobación de la junta o de los estatutos y que el interés legal del dinero lo fija cada año la Ley de Presupuestos; el 3,25 % solo se ofrece como valor de partida. **Generar recibo de intereses** emite un cargo con los intereses de un deudor (batchId `interest`, contabilizado en 769 Otros ingresos financieros), con vencimiento a 15 días, que se cobra como cualquier otro y no genera intereses.

```text
communities/{c}.lateInterest   { rate (centésimas de punto: 325 es 3,25 %), graceDays }, falta si está desactivado
charges/{id}.collections[]     { id, amount, date, method: cash | transfer | card | other, note? }, en el orden en que se anotaron
charges/{id}.collected         su suma, para que las reglas sepan lo pendiente y el resumen de Finanzas lo sume en el servidor
charges/{id}.collectionYears   los años en que caen, para que los libros de cada año encuentren un cargo pagado a plazos entre años
charges/{id}.interest          un recibo de intereses: { chargeIds, to: 'YYYY-MM-DD' }, sus cargos se liquidaron hasta ese día
```

- **Reglas**: solo los escribe el despacho, con hasta 100 entregas por cargo, la última añadida comprobada campo a campo, `collected` entre 0 y el importe, e `interest` con hasta 500 cargos. El pago de prueba de un vecino tiene que ser exactamente `amount - collected`. `lateInterest` admite un tipo de hasta el 20 % y hasta 365 días de gracia.
- **Pagado**: un cargo se marca pagado el día de la última entrega cuando estas llegan a su importe. Uno marcado como pagado a mano o en línea conserva lo que cubrió: se marca pendiente antes de deshacer una entrega. Anular las cuotas pendientes de un año deja las que tienen entregas.
- **Domiciliados**: una remesa adeuda lo pendiente de cada cargo, y mientras el cargo está en ella no se puede añadir ni deshacer ninguna entrega. Una devolución guarda lo adeudado (`returns[].amount`; las antiguas, sin él, adeudaron el importe entero), que el diario contabiliza como cobrado y devuelto.
- **Sin cobrar dos veces**: los intereses se calculan a partir de los cargos, nunca se guardan, y un recibo de intereses dice hasta cuándo se liquidaron sus cargos, así que el siguiente empieza ahí. Los intereses aún no liquidados cuando se paga un cargo dejan de contar.
- **Lecturas**: anotar o deshacer una entrega lee el cargo una vez (una transacción). La página de morosidad lee la comunidad y, con los intereses activados, los recibos de intereses una vez (`batchId ==`); los libros añaden una consulta `collectionYears array-contains`, y el resumen suma `amount` y `collected` en la misma agregación. Solo filtros de un campo, sin índice nuevo.
- **Sin cubrir**: el widget de dinero del panel de la comunidad aún cuenta como cobrado en un mes el importe entero de los cargos pagados en él, entregas incluidas.

<a id="partes"></a>

### Partes de trabajo

Con un proveedor asignado a una incidencia, la administración crea un enlace para él (**Parte de trabajo** en la incidencia) y se lo envía por WhatsApp (un enlace `wa.me`, sin API), por correo (en cola en el [correo saliente](#correo) al crearlo, si el directorio tiene el del proveedor, o con `mailto`) o copiado. El proveedor abre `/gremio/<token>` en la webapp sin cuenta: ve el trabajo, sus fotos, la dirección con un enlace al mapa y el contacto de la administración, y lo acepta o lo rechaza (con un motivo), programa la visita y lo marca como hecho con una nota y fotos (subidas a Storage; ocultas sin bucket, ver [Storage](setup.md#storage)). La página de la incidencia muestra sus respuestas en directo; una vez hecho, ofrece marcar la incidencia como resuelta, y una visita programada se puede publicar a los vecinos como comentario (se ofrece una vez por fecha de visita: una que ya está entre los comentarios de la incidencia no se ofrece otra vez).

```text
workOrders/{token}   communityId, issueId, community { name, address }, issue { title, description, category, location, assets },
                     expectedAt, contact { name, phone?, whatsapp?, email? }, provider { id, name },
                     status sent | accepted | rejected | scheduled | done, scheduledAt?, photos?,
                     history[] { at, status, note?, scheduledAt? }, createdAt, createdBy, updatedAt, revokedAt
```

- **El token es la única credencial**: 192 bits aleatorios en base64url de `crypto.getRandomValues`. Cualquiera puede leer uno por su id, pero nadie puede listarlos, así que no se pueden encontrar. Se guarda en el `private/admin` de la incidencia (`workOrder`), así que el admin lo lee por id, sin consulta ni índice.
- **Una copia, no una vista de la incidencia**: solo lo que necesita el proveedor, tomado al crear el enlace. El nombre y la dirección de la comunidad, la incidencia sin quién la creó y el contacto **Administración** de la comunidad (o quien creó el enlace). Cambiar la incidencia después no lo cambia, salvo la fecha prevista: cuando la de la incidencia no coincide con la del parte y el proveedor aún puede actuar, la página de la incidencia ofrece **Actualizar la fecha en el parte**. Cualquier otra cosa necesita un enlace nuevo.
- **Reglas**: quien gestiona la comunidad los crea, los anula (`revokedAt`) y los borra, y puede cambiar solo `expectedAt`. Sin sesión, un cambio solo puede añadir un paso al historial (hasta 20, con una nota de hasta 2.000 caracteres) con un cambio de estado permitido (aceptar solo va primero, la visita se puede reprogramar, rechazar o terminar lo cierra), la fecha de la visita al programarla y hasta 10 fotos, URLs de descarga de ficheros bajo `workOrders/{token}/` en Storage (relativas con los emuladores), una URL por foto, con `updatedAt` puesto por el servidor y solo mientras no esté anulado.
- **Anulado**: desde la incidencia (**Anular** o **Nuevo enlace**) y cuando se cambia o se quita su proveedor. El enlace dice entonces que se anuló.
- **Coste**: una escucha sobre ese documento mientras está abierta la página del proveedor o la de la incidencia. La lista de incidencias no muestra su estado, porque leería un documento más por incidencia.

<a id="acta"></a>

### Acta firmada y notificaciones

Una vez celebrada una junta, el acta que compone el admin (asistencia, orden del día y resultados) se guarda con **Preparar acta para firmar**, eligiendo al presidente y al secretario entre las personas de la comunidad (o el administrador). Su texto y sus firmantes se pueden editar hasta que firmen los dos; guardar quita las firmas que hubiera. El secretario firma en el admin; el presidente firma allí en persona o desde la webapp, donde la junta muestra **Firmar acta** a quien figure. Cuando han firmado los dos, quien firma el último la sella en el mismo paso, desde el admin o la webapp (o el admin la próxima vez que muestre el acta, si falló): SHA-256 (`crypto.subtle`) del texto y de las dos firmas con quién y cuándo, guardado con `closedAt`. Si los dos la sellan a la vez, las reglas rechazan al segundo, que la encuentra sellada y la deja. El acta imprimible muestra las firmas, el hash (corto y entero), un QR con el hash y la referencia de la junta, y la lista de notificaciones.

Desde el acta sellada, **Notificar a los propietarios** envía un aviso a cada propietario del censo (sus inmuebles agrupados por cuenta, correo o nombre), y **Notificar convocatoria** hace lo mismo con una junta convocada. Cada propietario con cuenta lo ve en la webapp, donde abrirlo lo marca como leído y **Acuso recibo** registra el acuse. Los propietarios que ni asistieron ni estuvieron representados (sin respuesta de asistencia como presente o delegada ni voto de sus inmuebles) tienen **Manifestar mi discrepancia** para cada acuerdo votado, durante 30 días naturales desde su aviso; el admin muestra el resultado de cada acuerdo contándolos a favor o, si discrepan, en contra (art. 17.8 LPH), provisional hasta que pasan los 30 días. Una discrepancia recibida por correo postal, burofax o en persona, de un propietario con cuenta o sin ella, se anota bajo la tabla de notificaciones con **Anotar discrepancia** (el propietario ausente, el acuerdo y el día en que llegó); cuenta igual, y la tabla y la webapp la muestran aparte de las hechas en la app.

```text
meetings/{m}.minutesSigners      los uids del presidente y el secretario, para que la webapp sepa quién puede leer el acta antes de enviarla
meetings/{m}.minutesSigned       los que ya han firmado, para que la lista de juntas deje de mostrarles Firma del acta
meetings/{m}.notifiedAt          { call?, minutes? }: cuándo se envió cada una por última vez. Los propietarios leen el acta desde entonces
meetings/{m}/minutes/record      communityId, meetingId, text, president { uid, name }, secretary { uid, name },
                                 signatures { president?, secretary? }: { uid, name, path, signedAt, byUid, byEmail },
                                 hash ('' hasta sellarla), closedAt, updatedAt, updatedBy
meetings/{m}/notices/{kind}_{uid}  kind call | minutes, uid ('' sin cuenta, y entonces el id es {kind}_p{primer propertyId}),
                                 name, email, propertyIds, propertyNames, coefficient, absent, items (ids de los puntos votados),
                                 app, certified { mode: 'test', reference }, sentAt, sentBy, readAt, receivedAt, dissent { itemId: at },
                                 recordedDissent? { itemId: { receivedOn, recordedAt, recordedBy } } (recibidas fuera de la app)
```

- **Firma electrónica simple**: el trazo dibujado (un trazado SVG de números enteros en una caja de 400×150, hasta 20.000 caracteres) más la cuenta con la sesión abierta (`byUid`, `byEmail`) y la hora del servidor. `byUid` no coincide con `uid` cuando se firmó en persona en la pantalla de la administración.
- **Reglas**: quien gestiona la comunidad escribe el texto y los firmantes del acta, solo sin firmas en el resultado y no una vez firmada por los dos. Cada firma solo se puede añadir en su hueco vacío, por la persona que figura o por quien gestiona la comunidad, con la fecha del servidor, y los vecinos bloqueados no pueden. El sellado, una vez firmada por los dos y por quien gestiona la comunidad o uno de los dos firmantes, pone un `hash` de 64 caracteres hexadecimales y `closedAt` (la hora del servidor); desde entonces nada puede cambiarla. Un firmante solo añade su propio uid a `minutesSigned` de la junta, nada más de ella. Los vecinos leen el acta si son uno de sus firmantes o una vez enviada a los propietarios (una lectura más de la junta). Los avisos los crea quien gestiona la comunidad, que después solo añade o retira una entrada de `recordedDissent`: un acuerdo votado cada vez del aviso del acta de un propietario ausente, recibida un día que no es futuro, firmada y fechada por el servidor. Cada propietario lee solo los suyos (por su id; solo la administración los lista), pone `readAt` y `receivedAt` una vez, y añade una discrepancia por acuerdo votado mientras esté ausente y dentro de los 30 días desde `sentAt`, con la fecha del servidor. Los propietarios bloqueados también: bloquear frena el spam, no sus derechos como propietarios.
- **Modo de prueba**: la notificación certificada (correo certificado / burofax) no envía nada; cada aviso recibe una referencia inventada `PRUEBA-BF…`, y el admin la marca como prueba. Los propietarios sin cuenta solo tienen ese canal (y el correo, si el censo tiene el suyo), así que el admin los lista para imprimir el acta y enviarla por correo postal. Cada propietario con correo en el censo la recibe también por correo, con el texto del acta (ver [correo saliente](#correo)). Un proveedor certificado real se añadiría en `sendNotices()` de `apps/admin/src/modules/meetings/application/useMeetings.ts`, el único sitio donde se crean los avisos.
- **Lecturas**: el admin escucha el acta mientras la junta está celebrada, y sus avisos una vez enviado alguno; la webapp, solo el acta cuando el usuario puede leerla y sus propios avisos por id. La lista de juntas muestra **Firma del acta** (a un firmante que no está en `minutesSigned`) o **Acta enviada** a partir de la propia junta, sin lecturas de más. Solo igualdades, sin índice nuevo.
- **Juntas telemáticas**: las juntas solo en línea están pendientes de regulación general en la LPH, así que el admin y la webapp lo dicen cuando una junta tiene enlace y no lugar, y el admin sugiere dar también un lugar.

<a id="ficheros"></a>

### Comprobación de ficheros, devoluciones importadas y abonos de la pasarela

Antes de cada descarga de una remesa (pain.008), una orden de transferencias (pain.001), un 347, 190 o 184, o el diario (CSV o el XDiario de ContaPlus), el admin comprueba el fichero exacto que va a guardar (`packages/shared/domain/fileChecks.ts`) y muestra **Comprobación del fichero**: todo correcto, avisos, o errores con el bloque, la operación o el registro al que apuntan. Los errores detienen la descarga (y no se crea la remesa u orden nueva) hasta **Descargar igualmente** o **Generar igualmente**. **Exportar e importar → Comprobar un fichero** comprueba cualquiera de ellos hecho por otro programa. Cada descarga se anota en la actividad de la comunidad con el resultado de su comprobación ([MON-4](fiabilidad.md#mon-4)), en una escritura propia que no se espera. Todo corre en el navegador (DOMParser, TextDecoder); no se sube nada.

- **SEPA**: XML bien formado; la versión (pain.008.001.02 o .08, pain.001.001.03 o .09); NbOfTxs y CtrlSum del fichero y de cada bloque; identificadores de hasta 35 caracteres del juego SEPA, PmtInfId único y EndToEndId sin repetir; dígitos de control del IBAN y formato del BIC; dígitos de control del identificador del acreedor (ISO 7064 mod 97-10 sobre el NIF y el país, como `creditorId()`); importes mayores que cero y con dos decimales como mucho; fechas de cobro y de ejecución no pasadas (un cobro hoy es un aviso); tipos de secuencia FRST, RCUR, OOFF o FNAL; el mandato firmado antes de la fecha de cobro; nombres presentes y dentro de los caracteres SEPA.
- **AEAT**: ISO-8859-1 (un fichero UTF-8 es un error), registros de 500 caracteres, uno de tipo 1 y luego los de tipo 2, modelo y ejercicio en su sitio, NIF válidos, dígitos donde los diseños que sigue `aeat.ts` tienen números, y los recuentos y totales del tipo 1 iguales a lo que suman los de tipo 2 (en el 190, dinerarias más en especie e incapacidad laboral). En el 184, lo atribuido a los miembros por clave se compara con los registros de la entidad, como aviso.
- **Diario**: cada asiento cuadra; las subcuentas de ContaPlus que no tienen 8 dígitos son un aviso.
- Comprueba el diseño de registro y los datos, no lo que dirán la Sede o el banco: la primera presentación real sigue pasando por la Sede (que valida el fichero antes de firmar), y la primera remesa u orden se sube al banco sin firmarla.

**Importar devoluciones** (Remesas) lee el pain.002 del banco (operaciones con TxSts RJCT y StsRsnInf/Rsn/Cd) o el camt.054 / camt.053 (apuntes con RtrInf/Rsn/Cd y el EndToEndId original), empareja cada una con un adeudo de una remesa por su EndToEndId (y su importe, si el informe lo trae) y las muestra con el motivo en español, junto con las que no puede registrar: no encontrada, otro importe, ya devuelta, una remesa aún no enviada o un código de motivo que no conoce. Se registran una a una por la misma devolución que a mano (`returnDebit`): los mismos campos, una comisión opcional por devolución, una entrada de actividad cada una, y se puede deshacer. Se añadieron a los motivos RC01 y RR01–RR04. Cada devolución guarda ahora también lo adeudado (`charges/{id}.returns[].amount`), lo que habían dejado pendiente las entregas a cuenta.

**Abonos de la pasarela, en modo de prueba**: la pasarela de prueba abona los pagos en línea de cada día (`communities/{c}/payments`, los no revertidos) en la cuenta de la comunidad en un solo abono dos días después, sin comisiones. El banco de prueba (y su Norma 43 de ejemplo) trae esos abonos en sus fechas, y la página del banco ofrece cada uno como un solo candidato que cubre los pagos de su día; conciliarlo los marca:

```text
communities/{c}/payments/{id}.bankMovementId   el movimiento del abono que lo ingresó; se quita al deshacerlo
```

- **Reglas**: solo quien gestiona la comunidad, cambiando solo ese campo, a un movimiento de la comunidad que exista (una lectura más por petición).
- **Lecturas**: la página del banco lee una vez los pagos de los últimos 90 días (`createdAt >=`, de un campo, sin índice); deshacer un abono lee cada uno de sus pagos una vez.
- **Contabilidad**: un cargo o una reserva pagados en línea se contabilizan ese día en 5729 Pasarela de pago, y los pagos de cada día pasan a 572 Bancos en la fecha de su abono (`payoutDate()` en `bank.ts`, la fecha del movimiento del abono de la pasarela de prueba), así que la cuenta del banco sigue al extracto y lo que está en camino se queda en 5729 (aparte en la Tesorería de la memoria anual). Los libros leen también los cargos y reservas pagados en los dos últimos días del año anterior, cuyo abono cae en el año nuevo. Un ejercicio cerrado antes de este cambio con pagos en línea en sus dos últimos días muestra que su cierre ya no cuadra, para reabrirlo y cerrarlo otra vez.
- **Una pasarela real** (Redsys, Stripe) tiene su propio calendario de abonos y sus comisiones, y dice qué pagos lleva cada abono: esa lista sustituiría a `gatewayPayouts()` en `bank.ts`, y su comisión se anotaría como gasto.

<a id="sugerencias"></a>

### Sugerencias y redacción automática

Cuatro ayudas que corren en el navegador y no envían nada a ningún sitio (`packages/shared/application/writing.ts`, que solo se carga cuando una página lo necesita). Cada una usa la API del propio navegador en el dispositivo cuando la tiene, y si no una versión básica con reglas y plantillas, y una etiqueta dice cuál corrió: **En tu dispositivo** o **Básico**.

- **Sugerencia de incidencia**: a partir del título y la descripción, la categoría, el gremio del proveedor y la urgencia (baja, normal, alta, urgente) con su motivo, más qué hacer en el acto ante gas, fuego, personas atrapadas en el ascensor, riesgo eléctrico, caída de materiales o una fuga de agua. En **Nueva incidencia** de la webapp, ofrece la categoría como una etiqueta que el vecino puede aceptar (nunca la cambia sola) y muestra ese consejo; en la página de la incidencia del admin, muestra la urgencia y lista primero los proveedores de ese gremio: la versión básica en cuanto se abre la incidencia, y la del dispositivo, donde la hay, una vez por incidencia y texto mientras el admin sigue abierto. Básica: una tabla de palabras clave en español, sin acentos. En el dispositivo: `LanguageModel` de Chrome con un esquema JSON, comprobado contra las categorías, los gremios y las urgencias (el nivel alto o urgente de las reglas se mantiene como mínimo).
- **Resumir**, en la página de la incidencia del admin: de tres a cinco puntos a partir de los comentarios ya cargados (sin lecturas, sin los ocultos). Básica: el aviso, los cambios de estado, la pregunta de un vecino sin respuesta detrás y los últimos mensajes. En el dispositivo: `Summarizer` (puntos clave).
- **Redactar a partir de unos puntos**, en **Comunicados**: el título y la descripción a partir de unas líneas y un tono (informativo, urgente, recordatorio), para revisar antes de enviar. Básica: una plantilla cortés con los puntos. En el dispositivo: `Writer`, que se descarta si añade, cambia u omite una cifra.
- **Mejorar redacción**, en el acta mientras se puede editar: solo aparece cuando el navegador tiene `Rewriter`. Línea a línea; una línea cuya nueva versión cambia una cifra o pierde un nombre se queda como estaba, y la página dice cuántas; **Deshacer** devuelve el texto. No se guarda nada hasta **Guardar acta**.

```text
no se guarda nada: ni colección, ni campo, ni regla
```

- **Las APIs del navegador**: Summarizer, Writer, Rewriter y la Prompt API (`LanguageModel`) que trae Chrome, pedidas en español. Cada una se detecta antes de usarla, y cualquier fallo vuelve a la versión básica. El primer clic que necesita una descarga sus ficheros al dispositivo (unos GB, una vez) y muestra el progreso; las sugerencias al escribir o al abrir una incidencia solo usan lo ya descargado.
- **Configuración**: ninguna para la versión básica. Donde Chrome aún no ofrece una API a todas las webs, necesita el token de la prueba de origen de esa API (gratuito, de la página de pruebas de origen de Chrome) como `<meta http-equiv="origin-trial">` en el `index.html` de cada app, o su opción en `chrome://flags`; sin él, las páginas usan **Básico**.
- **Coste**: nada de pago ni llamadas de red, así que no hay modo de prueba.

<a id="correo"></a>

### Correo saliente

El plan gratuito no tiene servidor desde el que enviar correo, así que el admin pone cada uno en cola en Firestore con la forma de la extensión oficial de Firebase **Trigger Email from Firestore** (`firebase/firestore-send-email`): instalarla después los envía, sin cambiar el código. Hasta entonces (`VITE_MAIL_MODE` en `demo`, el valor por defecto) no se envía nada: las acciones dicen **Modo de prueba: no se envía, queda en el correo saliente**, y la página **Correo** del admin los lista.

Cada correo se pone en cola en el mismo lote que la acción de la que sale, con `queueMail()` de `apps/admin/src/modules/mail/application/mail.ts`, donde están también sus plantillas:

- **Invitaciones** (Vecinos y gestores, Administradores): **Enviar invitación por email**, con el enlace a la webapp (`VITE_WEBAPP_URL`) para los vecinos o al admin (su propia dirección) para los demás. Las pendientes tienen **Reenviar invitación por email**, que pone en cola el mismo correo otra vez.
- **Juntas**: **Notificar convocatoria** y **Notificar a los propietarios** envían también un correo a cada propietario con correo en el censo: la fecha, el lugar y el orden del día, o el texto del acta sellada y, a los ausentes, sus 30 días para discrepar. Quienes tienen cuenta reciben un botón a la junta en la webapp.
- **Partes de trabajo**: crear el enlace se lo envía al proveedor cuando el directorio tiene su correo. Las respuestas van al contacto Administración de la comunidad.
- **Reclamaciones**: **Enviar por email** pone la carta en cola y registra la reclamación (con el envío activado no se puede deshacer desde el aviso, el correo ya salió; en modo de prueba sí); **Abrir en mi correo** mantiene el `mailto`.

En modo de prueba los avisos también lo dicen (por ejemplo **Parte creado; el email queda en el correo saliente (modo de prueba)**), y el correo saliente muestra el estado de entrega de la extensión en español (Pendiente, Enviando, Reintentando, Entregado, Error).

```text
mail/{id}   to[], cc[]?, bcc[]?, replyTo?, message { subject, text, html }   los campos de la extensión
            communityId ('' para los del equipo), kind invitation | meeting-call | meeting-minutes | work-order | claim,
            mode demo | extension, link (la página del admin de la que sale), createdAt, createdBy
            delivery { state PENDING | PROCESSING | RETRY | SUCCESS | ERROR, attempts, error, endTime, info }, de la extensión
```

- **El correo**: `renderMail()` en `packages/shared/domain/mail.ts` genera el HTML (estilos en línea y tablas de maquetación, que los clientes de correo muestran, `lang="es"`, el nombre de gobernança, un título, párrafos y listas, un botón con su enlace escrito también, la comunidad en el pie) y su versión en texto plano. Las direcciones del censo y del directorio que no lo parecen se saltan, porque una haría fallar el lote entero. Las respuestas van a quien lo envió, salvo que la acción dé otra dirección.
- **Reglas**: solo lo crea quien gestiona su `communityId` (los del equipo, `''`, el equipo), solo con esos campos, de 1 a 50 direcciones en total, un `x@y` sin espacios por entrada, `replyTo` de hasta 254 caracteres, un asunto de hasta 300, texto de hasta 200.000 y HTML de hasta 400.000 caracteres, `createdBy` quien llama y `createdAt` la hora del servidor. Lo lee quien gestiona la comunidad. Nadie los cambia ni los borra desde las apps: solo la extensión escribe `delivery`, con permisos de administrador que se saltan las reglas.
- **Lecturas**: la página lee 25 cada vez, una vez (sin escucha), con **Cargar más**: todos para el equipo; para los demás, `communityId in` sus comunidades (eligiéndolas de una en una a partir de 30, el límite de `in` en Firestore), o `communityId ==` la elegida. Los ids empiezan por la hora invertida (`mailId()`), así que por id va primero lo más nuevo y estos filtros no necesitan índice compuesto. Cada uno muestra su estado (Prueba, o Pendiente, Enviado y Error según `delivery.state`), los detalles de entrega y una vista previa en un iframe aislado (sin scripts; sus enlaces abren en otra pestaña). Notificar una junta lee la comunidad una vez y, para el acta, su texto una vez; los avisos van luego en lotes de hasta 240 propietarios y unos 8 MB, porque cada correo puede llevar un acta larga.
- **Modo de prueba**: `mode` guarda cómo se puso en cola, así que los del modo de prueba muestran **Prueba** para siempre. La extensión solo actúa sobre los documentos escritos mientras está instalada, así que esos nunca los envía; instálala y cambia `VITE_MAIL_MODE` a la vez, porque desde entonces envía cada correo nuevo, sea cual sea su modo.

Para enviarlos de verdad (la extensión corre en Cloud Functions, que necesitan el plan Blaze, y un proveedor SMTP):

1. Elige un proveedor SMTP (Brevo, Mailgun, Amazon SES, SendGrid…) y verifica allí el dominio de envío, añadiendo sus registros SPF, DKIM y DMARC en el DNS del dominio, o los correos acabarán en spam.
2. **Firebase console → Upgrade** del proyecto a Blaze, con una alerta de presupuesto.
3. **Firebase console → Extensions → Trigger Email from Firestore → Install** (o `npx firebase ext:install firebase/firestore-send-email --project dmoyadev-gobernansa`):
   - Email documents collection: `mail`
   - SMTP connection URI: la del proveedor, p. ej. `smtps://<usuario>@smtp-relay.brevo.com:465`, y su contraseña (guardada en Secret Manager)
   - Default FROM address: p. ej. `gobernança <no-reply@gobernansa.dmoya.dev>`, en el dominio verificado. Default REPLY-TO: vacío, cada correo trae el suyo
   - Users and templates collections: vacíos
4. Pon `VITE_MAIL_MODE='extension'` en `.env.local` y, para el despliegue, como secreto de GitHub `VITE_MAIL_MODE`, que los dos workflows de `.github/workflows` pasan al build ([secretos](setup.md#secretos)), y despliega. Las acciones dejan de decir que es una prueba, y la página muestra la entrega de cada uno.

Antes de activarlo, ten en cuenta que las reglas no pueden limitar lo que dice un correo ni cuántos se ponen en cola: cualquier gestor de una comunidad puede poner en cola su propio HTML a hasta 50 direcciones por correo, que saldría desde el dominio del proyecto. Las reglas no pueden limitar la frecuencia, así que, si preocupa, una Cloud Function que genere las plantillas a partir del `kind` y los ids (en vez de fiarse del HTML guardado) lo cierra una vez en el plan de pago.
