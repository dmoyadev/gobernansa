# Guion de la demo

Borrador del 15/11/2026 del bloque [F](v1.md#f) de v1.md. Va después del punto 4 del [speech](speech.md). Son 12–15 minutos con una sola historia, no un recorrido de menús. Los datos son los del seed: el despacho «Fincas Jaén» y su comunidad «Residencial Los Olivos». Corre entera en el portátil, sin internet. Las cuentas y sus correos están en `scripts/seed/data/cast.js`, y la contraseña de todas es `DEMO_PASSWORD`, en `.env.local`.

Lo que va entre comillas «así» es lo que pone en pantalla. Lo que va en cursiva y con raya es lo que dices.

---

## Preparación (la víspera y 10 minutos antes)

`npm run demo` arranca los emuladores con los datos del seed, construye la webapp y el admin contra ellos y los sirve en la red local. Imprime las direcciones, un QR de la webapp y las cuentas de la demo. Ctrl+C, o cerrar la terminal, lo para todo.

**Una vez en cada portátil:**
1. Java 21 en el `PATH` (`brew install openjdk@21`) y `DEMO_PASSWORD` en `.env.local`.
2. Arrancar `npm run demo` una vez con internet, para que descargue los emuladores. Después ya no la necesita. Si falta alguno, lo avisa al arrancar.

**La víspera:**
- Pasar la historia entera una vez, de principio a fin. El ensayo gasta datos: lo que hagas (remesa, cuotas de 2027, firma) se queda hecho. **Después de ensayar, `npm run demo:reset`**: deja los datos como nuevos y no cierra las sesiones.

**10 minutos antes, ya en el despacho:**
- **Red:** el portátil conectado al punto de acceso de tu móvil, mejor que a la wifi de invitados del cliente: mientras la demo está en marcha, cualquiera en esa red llega a los emuladores (los datos son de mentira). Arranca `npm run demo` ya en esa red, o `npm run demo:reset` si ya estaba en marcha en ella. Los dos cargan el seed con las fechas de hoy, así que la junta, los vencimientos y la morosidad quedan «de esta semana».
- **Si cambias de red, reinicia la demo:** la dirección del portátil queda fijada al arrancar, en el QR y en los enlaces del parte que copia el admin. Reiniciar cierra las sesiones de los móviles; `npm run demo:reset` no.
- **Portátil:** el admin en `http://localhost:5481`, no en la IP: por `http`, el navegador solo deja copiar el enlace del parte o añadir partidas al presupuesto en `localhost`. Entra como «Fincas Jaén» (el titular), en **Comunidades**.
- **Tu móvil, navegador 1:** la webapp desde el QR de la terminal (`http://<IP del portátil>:5480`), como **María Núñez** (Piso 2B y Garaje 13 de Los Olivos). Es la morosa del seed y aún no ha votado ni acusado recibo de la junta, así que sirve para las tres escenas.
- **Tu móvil, navegador 2:** la webapp como **Carmen Ruiz**, la presidenta, para firmar el acta. Por ejemplo, María en Chrome y Carmen en Safari.
- Se entra con el correo y la contraseña. El enlace de acceso del emulador solo se abre en el portátil.
- **Pantalla del móvil** duplicada en el portátil, o el móvil a la vista de todos.
- **Una foto** de una mancha de humedad en la galería del móvil. Las fotos se suben al emulador, sin internet. Las de las incidencias del seed son imágenes de muestra con un rótulo.
- **Plan B:** el vídeo de la demo entera, en el portátil y sin conexión. Si algo se atasca más de 30 segundos, pasas al vídeo sin disculparte.

---

## 1. Un vecino avisa (3 minutos)

*— Empezamos por lo que más os cuesta: el vecino que avisa de una avería. Soy María, del 2B.*

**Móvil, María:**
1. Pestaña **Nuevo** → «Dar aviso de una incidencia».
2. «¿Qué ha pasado?» → **Mantenimiento**. «¿Dónde ha pasado?» → **Zonas comunes**.
3. En «Cuéntanos más», escribe: *sale mucha agua del techo del garaje*.
   - Aparece «¿Es de …?» y el consejo urgente: «Si puedes, cierra la llave de paso del agua».
   - *— La app le sugiere la categoría y le dice qué hacer mientras llega alguien. No decide por él: si se equivoca, pulsa «Cambiar».*
4. «Fotos o vídeos» → **Añadir** → la foto de la galería. Pon un título → **Enviar aviso**.

**Portátil, admin:**
5. Menú **Incidencias**: la «Bandeja de incidencias» de todas las comunidades. La nueva está arriba.
6. Ábrela. En «Sugerencias y redacción automática» salen la urgencia y el gremio: Fontanería.
   - *— Ya os dice a quién mandarla. Los fontaneros salen primero.*
7. Tarjeta **Proveedor** → «Fontanería Hermanos Ortiz» → **Asignar**. La incidencia pasa sola a «Actuando».
8. Tarjeta **Parte de trabajo** → **Crear enlace**.
   - *— Esto se lo mandáis al fontanero por WhatsApp. No necesita cuenta ni instalar nada.*
   - Pulsa **Copiar enlace**, no **WhatsApp**: los teléfonos del seed son inventados y no hay internet. Pásalo al móvil con el portapapeles compartido entre portátil y móvil y ábrelo en el navegador 1, como si fueras el fontanero. Si no llega, ábrelo en el portátil, con la foto guardada también en él.

**Móvil, el fontanero:**
9. «Parte de trabajo» → **Aceptar y programar visita** → «Día» mañana, «Hora» 10:00 → **Confirmar visita**.
10. Sin salir: **Trabajo terminado** → la foto → **Enviar**.

**Portátil:**
11. En la incidencia aparecen la visita, el trabajo terminado y la foto → **Marcar como resuelta**.

**Móvil, María:** vuelve a la webapp. La incidencia sale como «Solucionada».

*— Ninguna llamada. El vecino ha visto cada paso, y vosotros lo tenéis todo en una pantalla.*

## 2. El dinero de la comunidad (4 minutos)

*— Ahora lo que de verdad os da trabajo: los recibos.*

**Portátil, Residencial Los Olivos → Finanzas:**
1. **Presupuesto** → año **2027**. Añade dos o tres partidas (limpieza, ascensor, seguro) → **Poner el mínimo** en el fondo de reserva → **Guardar presupuesto**.
   - El de 2026 ya está emitido. Por eso se enseña con el año que viene, que es además lo que tocaría preparar ahora.
2. **Cuotas y fondo de reserva** → 2027, «Periodicidad» trimestral → **Emitir N recibos**.
   - *— Del presupuesto a los recibos de cada propietario, por su coeficiente. Un clic.*
3. **Remesas** → **Nueva remesa** → «Vencidos hasta» hoy, «Fecha de cargo» dentro de unos días → **Generar y descargar**.
   - Entra la cuarta cuota de 2026 y la derrama pendiente.
   - Enseña el panel «Comprobación del fichero». *— Es el fichero SEPA que subís a la banca de empresa, comprobado antes de que lo veáis rechazado.* ⚠️ Hasta [B6](v1.md#b6), no digas que un banco lo ha aceptado.
4. En la lista: **Marcar enviada**.
5. Despliega la remesa → **Devolución** en la línea del Piso 2B → «Motivo» MD06 → **Registrar devolución**.
   - *— Cuando el banco os devuelve un recibo, lo importáis con el fichero del banco o lo apuntáis aquí, y vuelve a pendiente solo.*
   - La importación por fichero (pain.002 o camt.054) existe, pero no hay un fichero de ejemplo para la demo.
6. **Morosidad**: «Antigüedad de la deuda» por tramos y los intereses de demora ya calculados.
7. En «Deudores», María Núñez → **Carta de reclamación** → nivel «Segundo aviso».
   - *— La carta sale con la deuda, los intereses y la referencia a la ley. La imprimís o la mandáis por email.*
   - No pulses el burofax: está en modo de prueba.

**Móvil, María:** **Comunidad** → **Mis recibos**. Sale el recibo devuelto como pendiente.

*— Y el vecino lo ve en su móvil sin llamaros. Podría pagarlo con tarjeta o Bizum, que se activa con la pasarela al empezar.* No lo pagues en la demo.

## 3. La junta (4 minutos)

*— Lo que nadie más tiene: la junta de punta a punta.*

**Portátil, Los Olivos → Juntas:**
1. Abre «Junta extraordinaria: impermeabilización del garaje»: convocada para dentro de diez días, con la votación abierta.
   - *— La convocatoria con su orden del día, notificada a cada propietario en la app y por correo. No hace falta crear una nueva delante de ellos: se ve cómo está hecha.*
   - Si preguntan, **Nueva junta** enseña el formulario: «Convocatoria», «Orden del día», **Añadir punto** y «Se vota».

**Móvil, María:**
2. **Comunidad** → Juntas → la junta → **Acuso recibo**.
3. En el «Orden del día», vota un punto: **A favor**.
   - Si quieres enseñar la delegación: «¿Vas a asistir?» → «Delego mi voto» → elige a Carmen → **Guardar delegación**.
   - *— Vota una vez por propiedad, y el voto pesa por su coeficiente.*

**Portátil:**
4. Vuelve a la junta: el voto de María ya cuenta en el resultado ponderado.
5. **Marcar como celebrada** → «Firma del acta»: Presidente **Carmen Ruiz**, Secretario **Rosa Delgado** → **Preparar acta para firmar**.

**Móvil, navegador 2, Carmen:**
6. **Firmar acta** → firma con el dedo.
   - *— La presidenta firma desde su móvil, en la misma junta o en su casa.*

**Portátil:**
7. Rosa firma en el portátil: **Firmar en persona** → «Firma del acta». El acta queda sellada: «Acta firmada», con la huella y el QR.
8. **Notificar a los propietarios**.
   - *— Cada propietario la recibe y acusa recibo. Los ausentes tienen sus treinta días para discrepar, y el voto se computa como dice la ley.*

## 4. El despacho entero (2 minutos)

*— Y todo esto, para todas vuestras comunidades a la vez.*

1. Menú **Panel**: el «Panel de cartera», con las incidencias abiertas, la resolución media, los vecinos registrados, las obligaciones y los recibos vencidos de cada comunidad.
2. **Comunidades** → en el buscador escribe el teléfono de María, `600100004`: en «Vecinos» salen «María Núñez · Piso 2B» y «María Núñez · Garaje 13», de Residencial Los Olivos. Abre una: te lleva al censo con esa propiedad marcada.
   - *— Os llama alguien y no sabéis de qué comunidad es: lo buscáis por su nombre, su piso, su NIF o su teléfono, escrito como lo tengáis apuntado.*
   - Vale igual `+34 600 100 004`, o el NIF como `11111111-h`.
3. Los Olivos → **Obligaciones** → «Requieren atención»: la inspección técnica del edificio vencida hace doce días.
   - *— Las inspecciones, los seguros y las revisiones, con aviso antes de que venzan.*

## 5. Cierre: empezar es fácil (1 minuto)

*— Y para empezar no tenéis que teclear nada.*

1. **Comunidades** → **Importar comunidades** → en «O pega las celdas», pega lo que tengas copiado de un Excel. Prepáralo antes en el portátil, con estas columnas separadas por tabuladores (los CIF y NIF de ejemplo pasan la validación):

   ```
   Comunidad	CIF de la comunidad	Dirección	Propiedad	Tipo	Coeficiente	Propietario	Email	NIF	Teléfono
   Edificio Las Palmeras	H23000003	Calle Ejemplo 1, Jaén	1º A	Vivienda	50,00	Juan Pérez Sanz	juan.perez@example.com	12345678Z	600 123 457
   Edificio Las Palmeras	H23000003	Calle Ejemplo 1, Jaén	1º B	Vivienda	50,00	Ana Ruiz Gil	ana.ruiz@example.com	00000000T	600 123 458
   ```

2. Enseña la revisión: columnas reconocidas y «Los coeficientes suman 100 %».
3. **No importes** delante de ellos: dejaría una comunidad de prueba en la demo. Basta con la revisión.
   - *— Lo sacáis de vuestro programa en Excel, lo pegáis, y en una tarde tenéis vuestras comunidades. Y si os vais, os las lleváis igual.*

Vuelve al punto 5 del [speech](speech.md): lo que no hacemos todavía.

---

## No enseñar

- Errores, Rendimiento, Correo (el buzón de salida en modo de prueba), Honorarios y Verifactu, la conciliación del banco (datos simulados), el burofax y el pago con tarjeta.
- El Historial: solo lo ve el superadmin, y la demo local no arranca las funciones, así que no guarda los cambios ni restaura versiones.
- En el móvil, la webapp va por `http`: no hay copiar, compartir, instalar la app ni notificaciones push.
- Andrés Molina, del Piso 3A, está bloqueado en el seed: no entres con él.
- Cada desvío es una pregunta que no vas a responder bien. Si te lo piden, «lo vemos al final» y lo apuntas.

## Pendiente para cerrar el guion

- Cambiar los datos del seed a tu ciudad si no es Jaén ([C2](v1.md#c2)).
- Pasar con `npm run demo` lo que aún no se ha probado en la demo local: llevar el enlace del parte al móvil sin internet (cerrarlo con foto ya está probado en el portátil), la firma de Carmen y la importación.
- Grabar el vídeo del plan B ([G](v1.md#g)) y ensayar cinco veces cronometrado, como pide [F](v1.md#f).
