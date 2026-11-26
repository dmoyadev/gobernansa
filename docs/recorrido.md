# Recorrido de pruebas

Para probar en local la landing, la webapp de los vecinos y el admin de los despachos. Cada punto tiene un ID para el feedback («[W12](#w12): el voto no resta»). Las cuentas son las de [`scripts/seed/data/cast.js`](../scripts/seed/data/cast.js) y los datos los del seed, que se recargan con cada `npm run dev`.

Cada punto: qué hacer, paso a paso, y **Esperado**, lo que debería pasar. Si no coincide, es feedback.

---

<a id="p"></a>

## P · Preparación

<a id="p1"></a>

### P1 · Arrancar todo

1. `.env.local` con `VITE_FIREBASE_EMULATORS='true'` y `DEMO_PASSWORD` ([desarrollo.md](desarrollo.md#primer-arranque)). `npm run doctor` si es un equipo nuevo.
2. `npm run dev` (emuladores, seed desde cero, webapp y admin) y, en otra terminal, `npm run dev:landing`.
3. Abre la interfaz de los emuladores en `http://127.0.0.1:5500`.

**Esperado**: webapp en `https://localhost:5400`, admin en `https://localhost:5401`, landing en `http://localhost:5404`, sin errores en la terminal.

<a id="p2"></a>

### P2 · Las cuentas

Todas con la contraseña `DEMO_PASSWORD`. Conviene un navegador (o perfil) por persona a la vez: por ejemplo Chrome para el admin, Safari o una ventana privada para la webapp.

| Quién | Correo | App | Para qué |
| --- | --- | --- | --- |
| Equipo gobernança | `lynx9011+admin@gmail.com` | Admin | Superadmin: todo, Errores, Historial, Cuentas, Administradores |
| Fincas Jaén | `lynx9011+fincas@gmail.com` | Admin | Titular del despacho (comm1 y comm2) |
| Raúl Peña | `lynx9011+oficial@gmail.com` | Admin | Oficial del despacho: no cierra ejercicios ni factura honorarios |
| Inés Lara | `lynx9011+contable@gmail.com` | Admin | Contable del despacho |
| Carmen Ruiz | `lynx9011+manager1@gmail.com` | Las dos | Presidenta de Los Olivos (gestora) |
| Tomás Vidal | `lynx9011+manager2@gmail.com` | Las dos | Presidente de Mirador del Castillo |
| María Núñez | `lynx9011+user4@gmail.com` | Webapp | Piso 2B y Garaje 13, morosa |
| Lucía Martín | `lynx9011+user1@gmail.com` | Webapp | Piso 1A y Garaje 12, más Garaje 3 en la otra comunidad |
| Javier Ortega | `lynx9011+user2@gmail.com` | Webapp | Piso 1B (con inquilina) y Trastero 3 |
| Rosa Delgado | `lynx9011+user6@gmail.com` | Webapp | Piso 3B, secretaria en el acta |
| Andrés Molina | `lynx9011+user5@gmail.com` | Webapp | Bloqueado: lee pero no escribe |
| Elena Castro, Pablo Gil | `lynx9011+user7@` / `+user8@gmail.com` | Webapp | Vecinos de Mirador del Castillo |
| Francisco López | `lynx9011+user9@gmail.com` | Webapp | Invitado que aún no ha entrado nunca |

<a id="p3"></a>

### P3 · Enlace de acceso (sin contraseña)

El emulador no envía correos: el enlace sale en la terminal de los emuladores y en `http://127.0.0.1:5501/emulator/v1/projects/dmoyadev-gobernansa/oobCodes`. Ábrelo en el navegador donde lo pediste.

<a id="p4"></a>

### P4 · Volver a empezar

`npm run seed:emulators -- --reset` con todo en marcha deja los datos como nuevos. Úsalo entre bloques si algo se queda a medias.

---

<a id="l"></a>

## L · Landing (`http://localhost:5404`)

<a id="l1"></a>

### L1 · Primera impresión

1. Abre la landing en escritorio y lee el hero de arriba abajo.

**Esperado**: titular, subtítulo y llamadas a la acción legibles sin hacer scroll; carga sin saltos de maquetación.

<a id="l2"></a>

### L2 · El día a día

1. Baja hasta «Lucía avisa, Marta lo resuelve y nadie llama a nadie» y sigue la línea de tiempo con el scroll.

**Esperado**: la historia se entiende paso a paso; las animaciones acompañan el scroll y no se atascan.

<a id="l3"></a>

### L3 · Funciones y dispositivos

1. Sección «Un programa entero, no un portal más» (`#funciones`).
2. Sección «La app que tus vecinos sí abren» con los móviles, y «Y en el despacho, todo a unos clics» (`#despacho`).

**Esperado**: lo que se promete coincide con lo que luego ves en [W](#w) y [A](#a). Apunta cualquier promesa que no se cumpla.

<a id="l4"></a>

### L4 · Piloto y preguntas

1. Sección «Pruébalo con tus comunidades, sin pagar» (`#piloto`).
2. «Las preguntas de siempre» (`#preguntas`): abre y cierra varias.

**Esperado**: las respuestas se despliegan con el teclado y el ratón; los textos son correctos y actuales.

<a id="l5"></a>

### L5 · Formulario de demo

⚠️ Este formulario envía un mensaje **real** al chat de Telegram configurado, también desde local.

1. En `#demo`, pulsa enviar con el formulario vacío.
2. Escribe un correo mal formado y envía.
3. Rellénalo bien (marca el mensaje como prueba) y envía.

**Esperado**: 1 y 2 muestran «Falta tu nombre o el email no parece válido.» y ponen el foco en el campo; 3 dice «Enviando…» y luego «¡Recibido!…», el formulario se vacía y el mensaje llega.

<a id="l6"></a>

### L6 · Navegación y pie

1. Pulsa cada enlace del menú y del pie (anclas, legal, redes).
2. Haz scroll lento: comprueba la barra fija (`#sticky`).

**Esperado**: cada ancla lleva a su sección sin quedar tapada; ningún enlace roto.

<a id="l7"></a>

### L7 · Móvil, tema y accesibilidad

1. DevTools → vista de móvil (375 px). Recorre la página entera.
2. Cambia el sistema a modo oscuro y recarga.
3. Recorre la página solo con Tab.

**Esperado**: sin scroll horizontal, textos legibles, colores coherentes en los dos temas, foco visible en cada control.

---

<a id="w"></a>

## W · Webapp (`https://localhost:5400`)

Prueba la webapp en vista de móvil (DevTools, 375 px) salvo que se diga otra cosa.

<a id="w1"></a>

### W1 · Entrar con contraseña

1. Abre la webapp sin sesión: te lleva a `/login`.
2. Entra con una contraseña errónea para María.
3. Entra con la buena.

**Esperado**: error claro en 2; en 3, el inicio («Inicio») con tu nombre y tus datos.

<a id="w2"></a>

### W2 · Entrar con enlace y primer acceso de un invitado

1. Cierra sesión. En `/login` pide un enlace de acceso para `lynx9011+user9@gmail.com` (Francisco).
2. Abre el enlace ([P3](#p3)).

**Esperado**: entra por primera vez y su perfil se crea desde la invitación, con el Piso 4A de Los Olivos. En el admin, en [A8](#a8), deja de salir como invitación pendiente.

<a id="w3"></a>

### W3 · Inicio

Como María:
1. Revisa «¿Algo no va bien?», «Tu actividad», «Contactos rápidos» y «Actividad reciente».
2. Pulsa un contacto rápido (llamar, WhatsApp, email).

**Esperado**: los contadores coinciden con lo que hay en Incidencias; los contactos abren la app que toca (`tel:`, `wa.me`, `mailto:`).

<a id="w4"></a>

### W4 · Avisos (campana)

1. Pulsa la campana de la cabecera.

**Esperado**: la línea de tiempo de comunicados, eventos y avisos de juntas de la comunidad, lo más reciente arriba.

<a id="w5"></a>

### W5 · Lista de incidencias

1. Pestaña **Incidencias**. Prueba los filtros, la búsqueda y «Mis incidencias».

**Esperado**: las de Los Olivos del seed (fuga del garaje, ascensor, chispas en el cuarto de contadores…), con estado, categoría y votos; los filtros se combinan bien.

<a id="w6"></a>

### W6 · Crear una incidencia con sugerencia

1. **Nuevo** → «Dar aviso de una incidencia».
2. «¿Qué ha pasado?» → Mantenimiento; «¿Dónde?» → Zonas comunes → Garaje.
3. En la descripción: *sale mucha agua del techo del garaje*.
4. Acepta o cambia la categoría sugerida.
5. Añade una foto y un título → **Enviar aviso**.

**Esperado**: aparece la sugerencia de categoría (con etiqueta **Básico** o **En tu dispositivo**) y el consejo de cerrar la llave de paso; la incidencia sale en la lista con su foto.

<a id="w7"></a>

### W7 · Incidencia sobre una vivienda

1. Crea otra con «¿Dónde?» → tu propiedad (Piso 2B).

**Esperado**: se guarda con el inmueble, y el resto de vecinos solo ve el inmueble, no quién la creó.

<a id="w8"></a>

### W8 · Votar

1. Abre una incidencia de otro vecino y vota a favor; después en contra; después retira el voto.
2. Mira los votos que te quedan este mes.

**Esperado**: el marcador cambia al momento; los votos restantes bajan y vuelven al retirar; con los 5 gastados, no deja votar más.

<a id="w9"></a>

### W9 · Comentar y borrar

1. Comenta en una incidencia.
2. Borra una incidencia tuya creada en [W6](#w6) o [W7](#w7).

**Esperado**: el comentario aparece con tu nombre; solo puedes borrar las tuyas.

<a id="w10"></a>

### W10 · Comunidad

1. Pestaña **Comunidad**: «Tus cuentas», «Contactos» (con horario y «disponible ahora»), «Documentación oficial» con «Actas de las juntas», «Participa».
2. Abre un documento (estatutos, normas, póliza).

**Esperado**: CIF, IBAN y banco correctos; los documentos se abren; el botón del 112 llama.

<a id="w11"></a>

### W11 · Mis recibos y pago de prueba

Como María:
1. **Comunidad** → **Mis recibos**.
2. Abre un recibo pendiente → pagar (pasarela de prueba, tarjeta o Bizum).
3. Abre el justificante.

**Esperado**: salen sus deudas (es la morosa); el pago es de prueba, marca el recibo como pagado y genera un justificante imprimible. En el admin, el recibo aparece cobrado ([A26](#a26)).

<a id="w12"></a>

### W12 · Reservas

Como Lucía:
1. **Comunidad** → **Reservas** → Pista de pádel: reserva un turno.
2. Intenta reservar el mismo turno desde otra cuenta (Javier).
3. Reserva la Sala común (15 € y 50 € de fianza) y paga.
4. Reserva la Barbacoa (solo fianza).
5. Haz más de 3 reservas de pádel en una semana.

**Esperado**: 2 lo rechaza; 3 pasa por el pago de prueba con justificante; 5 avisa del límite semanal; las normas de cada zona se ven antes de reservar.

<a id="w13"></a>

### W13 · Juntas: acuse, asistencia y voto

Como María:
1. **Comunidad** → «Participa» → «Junta extraordinaria: impermeabilización del garaje».
2. **Acuso recibo**.
3. «¿Vas a asistir?» → «Delego mi voto» → escribe *Carmen Ruiz* → **Guardar delegación**.
4. En el orden del día, vota un punto **A favor**, cambia a **En contra**.

**Esperado**: un voto por propiedad (Piso 2B y Garaje 13 cuentan aparte, ponderados por coeficiente); el admin lo refleja en [A20](#a20).

<a id="w14"></a>

### W14 · Firmar el acta

Requiere [A21](#a21) hecho.
1. Como Carmen: Juntas → la junta celebrada → **Firmar acta** → firma con el dedo o el ratón.

**Esperado**: la firma se guarda y deja de pedirle «Firma del acta» en la lista.

<a id="w15"></a>

### W15 · Acta recibida y discrepancia

Requiere [A22](#a22) hecho.
1. Como un propietario que no asistió ni delegó (por ejemplo Javier): abre el aviso del acta → **Acuso recibo**.
2. **Manifestar mi discrepancia** en un acuerdo.

**Esperado**: el aviso pasa a leído y recibido; la discrepancia se registra y el admin la cuenta en contra.

<a id="w16"></a>

### W16 · Perfil

1. **Perfil**: «Tu email», «Documentos» (sube un PDF pequeño y bórralo), «Ajustes» → Notificaciones y **Cambiar contraseña**, «Información legal».
2. **Cerrar sesión**.

**Esperado**: el documento se sube y se abre (hasta 1 MB); cerrar sesión pide confirmación («¿Cerrar sesión?») y vuelve a `/login`.

<a id="w17"></a>

### W17 · Varias casas y varias comunidades

Como Lucía:
1. Cambia entre Piso 1A, Garaje 12 y Garaje 3 (Mirador del Castillo).
2. En **Perfil** → «Añadir otra casa».

**Esperado**: al cambiar a Garaje 3 ve las incidencias, juntas y recibos de Mirador del Castillo; los votos de cada inmueble van aparte.

<a id="w18"></a>

### W18 · Vecino bloqueado

Como Andrés:
1. Intenta crear una incidencia, comentar, votar, reservar y responder a una junta.

**Esperado**: puede leerlo todo pero cada escritura se bloquea con un mensaje claro, no con un error genérico.

<a id="w19"></a>

### W19 · Presidenta en la webapp

Como Carmen:
1. Cambia el estado de una incidencia y gestiona un evento.

**Esperado**: puede hacerlo (es gestora y vive en la comunidad); María no ve esos controles.

<a id="w20"></a>

### W20 · PWA, tema y zoom

1. Instala la webapp desde Chrome (icono de instalar).
2. Modo oscuro del sistema; aumenta el tamaño de texto.
3. DevTools → Network → Offline y navega por lo ya abierto.

**Esperado**: se instala con su icono; los dos temas se leen bien; sin conexión sigue mostrando lo cargado y avisa de que no hay red.

<a id="w21"></a>

### W21 · Rutas sueltas

1. Abre `/no-existe` y `/legal` sin sesión.
2. Abre `/issues` sin sesión.

**Esperado**: página de no encontrado; legal accesible; `/issues` lleva al login y, tras entrar, vuelve a `/issues`.

---

<a id="a"></a>

## A · Admin (`https://localhost:5401`)

Como Fincas Jaén salvo que se diga otra cosa. Prueba en escritorio y, al final, en tablet ([A45](#a45)).

<a id="a1"></a>

### A1 · Entrar y el menú

1. Entra como Fincas Jaén.
2. Recorre el menú: Comunidades, Panel, Incidencias, Comunicados, Proveedores, Correo, Honorarios, Equipo.
3. Prueba los atajos `g c`, `g d`, `g i`, `g m`, `g p`, `g e`, `g f`, `g t`.

**Esperado**: no ve Errores, Historial, Administradores ni Cuentas (son del equipo); los atajos navegan.

<a id="a2"></a>

### A2 · Comunidades y buscador

1. **Comunidades**: Los Olivos y Mirador del Castillo (no Plaza de Andalucía, que no es suya).
2. Busca `600100004`, luego `+34 600 100 004`, luego `11111111-h`.
3. Abre «María Núñez · Piso 2B».

**Esperado**: las tres búsquedas encuentran a María en sus dos propiedades; abrir lleva al censo con esa propiedad resaltada.

<a id="a3"></a>

### A3 · Resumen de una comunidad

1. Abre Residencial Los Olivos.

**Esperado**: resumen con incidencias abiertas, finanzas, juntas y obligaciones; cada tarjeta lleva a su página.

<a id="a4"></a>

### A4 · Datos generales y contactos

1. Comunidad → Datos generales: cambia la dirección y guarda.
2. Contactos: añade un conserje con horario L–V 08:00–15:00 y S 09:00–13:00.

**Esperado**: se guarda; en la webapp ([W10](#w10)) aparece el conserje con su horario y si está disponible ahora.

<a id="a5"></a>

### A5 · Documentación oficial

1. Sube un documento (tipo «Normas») y bórralo después.

**Esperado**: aparece y desaparece en la webapp ([W10](#w10)).

<a id="a6"></a>

### A6 · Configuración de la comunidad

1. Cambia los votos por propiedad de 5 a 3.
2. Exporta la comunidad.
3. Mira (sin confirmar) la opción de archivar.

**Esperado**: la webapp muestra 3 votos al mes ([W8](#w8)); la exportación descarga un fichero con todos los datos.

<a id="a7"></a>

### A7 · Ver como vecino

1. En el menú de la comunidad, **Ver como un vecino**.

**Esperado**: abre la webapp con `?viewAs=comm1` en solo lectura (hay que tener sesión en la webapp con la misma cuenta).

<a id="a8"></a>

### A8 · Vecinos y gestores

1. Vecinos → **Vecinos y gestores**: revisa la lista, roles e invitaciones pendientes (Francisco, si no hiciste [W2](#w2)).
2. Invita a un correo nuevo como vecino con **Enviar invitación por email**.
3. **Reenviar invitación por email** en una pendiente.
4. Cambia el rol de Rosa a gestora y devuélvelo a vecina.
5. Bloquea y desbloquea a Javier.
6. Abre los documentos de un vecino y envíale uno.

**Esperado**: el correo queda en **Correo** en modo de prueba ([A34](#a34)); el bloqueo se nota al momento en la webapp; el documento le aparece en su perfil ([W16](#w16)).

<a id="a9"></a>

### A9 · Propiedades (censo)

1. Vecinos → **Propiedades**: comprueba que los coeficientes suman 100 %.
2. Edita el teléfono y el inquilino de una propiedad.
3. Crea una propiedad nueva y bórrala.

**Esperado**: el aviso de suma aparece si deja de ser 100 %; los cambios quedan en el registro de actividad ([A40](#a40)).

<a id="a10"></a>

### A10 · Importar censo

1. Vecinos → **Importar censo** → **Descargar plantilla**.
2. Rellénala con una fila nueva, un cambio de teléfono a una existente y una fila con NIF erróneo; súbela (también prueba a pegar celdas).
3. Revisa la vista previa y luego importa.

**Esperado**: detecta nueva, cambio, sin cambios y error, con el motivo; una celda vacía no borra nada; al importar solo escribe lo válido.

<a id="a11"></a>

### A11 · Importar comunidades

1. **Comunidades** → **Importar comunidades** → pega las celdas del ejemplo del punto 5 de [demo.md](demo.md).

**Esperado**: reconoce las columnas y dice «Los coeficientes suman 100 %». Fincas Jaén sí puede importarlas ([B4](v1.md#b4)): si importas, salen en su lista.

<a id="a12"></a>

### A12 · Bandeja de incidencias

1. Menú **Incidencias**: la bandeja de las dos comunidades. Filtra y ordena.

**Esperado**: salen las creadas en [W6](#w6) arriba; los filtros por comunidad, estado y categoría funcionan.

<a id="a13"></a>

### A13 · Incidencia: sugerencias, proveedor y estado

1. Abre la de [W6](#w6).
2. Mira «Sugerencias y redacción automática»: urgencia y gremio.
3. Tarjeta **Proveedor** → Fontanería Hermanos Ortiz → **Asignar**.
4. Cambia el estado, pon fecha prevista, añade una nota interna y un siniestro del seguro.
5. **Resumir** los comentarios.

**Esperado**: los fontaneros salen primero; al asignar pasa a «Actuando»; la nota interna y el siniestro no los ve ningún vecino; el resumen tiene de tres a cinco puntos.

<a id="a14"></a>

### A14 · Parte de trabajo (el proveedor)

1. En la incidencia, **Parte de trabajo** → **Crear enlace** → **Copiar enlace**.
2. Ábrelo en una ventana privada (sin sesión): **Aceptar y programar visita** → mañana 10:00 → **Confirmar visita**.
3. **Trabajo terminado** → foto y nota → **Enviar**.
4. Vuelve al admin: publica la visita a los vecinos y **Marcar como resuelta**.
5. Crea otro enlace y pulsa **Anular**; abre el enlace viejo.

**Esperado**: el admin ve cada paso en directo; la visita publicada sale como comentario en la webapp; el enlace anulado dice que se anuló; el correo al proveedor queda en **Correo**.

<a id="a15"></a>

### A15 · Moderar comentarios

1. En una incidencia con comentarios, oculta uno.

**Esperado**: desaparece en la webapp y queda marcado como oculto en el admin.

<a id="a16"></a>

### A16 · Categorías de incidencias

1. Comunidad → Incidencias → **Categorías**: crea una, cambia icono y color, reordénalas arrastrando, renombra una y borra la nueva.

**Esperado**: la webapp las muestra en ese orden y con ese nombre; no deja borrar la última.

<a id="a17"></a>

### A17 · Avisos de la comunidad

1. Comunidad → **Avisos**: crea un evento o aviso.

**Esperado**: aparece en la campana de la webapp ([W4](#w4)).

<a id="a18"></a>

### A18 · Comunicados

1. Menú **Comunicados** → nuevo → «Redactar a partir de unos puntos» con tres líneas y tono urgente.
2. Revisa, envíalo a las dos comunidades.

**Esperado**: el borrador conserva las cifras; llega a la webapp de las dos comunidades (María y Elena).

<a id="a19"></a>

### A19 · Juntas: crear y convocar

1. Comunidad → **Juntas** → **Nueva junta**: convocatoria, lugar, orden del día con **Añadir punto** y «Se vota».
2. Convoca y **Notificar convocatoria**.

**Esperado**: los propietarios con cuenta la ven en la webapp; los correos quedan en **Correo**; los sin cuenta (Local comercial) salen para imprimir. Una junta solo con enlace y sin lugar muestra el aviso legal.

<a id="a20"></a>

### A20 · Juntas: asistencia y resultados

1. Abre «Junta extraordinaria: impermeabilización del garaje» tras [W13](#w13).

**Esperado**: el voto de María cuenta en el resultado ponderado por coeficiente, y la delegación a Carmen aparece.

<a id="a21"></a>

### A21 · Acta: celebrar, redactar y firmar

1. **Marcar como celebrada**.
2. «Firma del acta»: presidenta Carmen, secretaria Rosa → **Preparar acta para firmar**.
3. Edita el texto (prueba «Mejorar redacción» si sale) y guarda.
4. Carmen firma desde la webapp ([W14](#w14)).
5. Rosa: **Firmar en persona** en el admin.

**Esperado**: al firmar la segunda, el acta queda sellada («Acta firmada») con la huella y el QR; ya no se puede editar; imprimir da un PDF limpio.

<a id="a22"></a>

### A22 · Acta: notificar y discrepancias

1. **Notificar a los propietarios**.
2. Tras [W15](#w15), revisa la tabla de notificaciones.
3. **Anotar discrepancia** de un ausente recibida por correo postal.

**Esperado**: lecturas, acuses y discrepancias por propietario; el resultado de cada acuerdo cambia con las discrepancias y se marca como provisional hasta los 30 días; el burofax lleva una referencia `PRUEBA-BF…`.

<a id="a23"></a>

### A23 · Finanzas: resumen

1. Comunidad → **Finanzas**.

**Esperado**: pendiente de cobro, facturas vencidas, banco, fondo de reserva y plazos cuadran con las páginas de detalle.

<a id="a24"></a>

### A24 · Presupuesto

1. **Presupuesto** → año siguiente: añade tres partidas → **Poner el mínimo** en el fondo de reserva → **Guardar presupuesto**.

**Esperado**: el total y el fondo de reserva (mínimo legal) se calculan solos; el del año en curso está emitido y no se puede tocar igual.

<a id="a25"></a>

### A25 · Cuotas y fondo de reserva

1. **Cuotas y fondo de reserva** → año siguiente, trimestral → **Emitir N recibos**.
2. Anula las cuotas pendientes de ese año.

**Esperado**: un recibo por propietario y trimestre según su coeficiente; al anular solo quedan las que tenían entregas.

<a id="a26"></a>

### A26 · Recibos y entregas a cuenta

1. **Recibos**: filtra por propiedad y estado.
2. En un recibo de María no domiciliado, anota una entrega parcial en efectivo; deshazla.
3. Marca uno como pagado a mano.
4. **Certificado de pagos** de una propiedad.

**Esperado**: lo pendiente baja con la entrega y se ve en **Mis recibos** ([W11](#w11)); el certificado se imprime con la deuda real.

<a id="a27"></a>

### A27 · Estados de cuenta

1. **Estados de cuenta** → Piso 2B.

**Esperado**: cada cargo, entrega y pago en su línea, con el saldo correcto.

<a id="a28"></a>

### A28 · Morosidad, intereses y reclamación

1. **Morosidad**: «Antigüedad de la deuda» por tramos.
2. Activa intereses de demora al 3,25 % con 30 días de gracia.
3. **Generar recibo de intereses** para María.
4. «Deudores» → María → **Carta de reclamación** → «Segundo aviso» → **Enviar por email**.
5. **Procedimiento monitorio** de María.

**Esperado**: los intereses salen calculados; el recibo de intereses vence a 15 días y no genera intereses; la carta incluye deuda, intereses y la referencia legal y queda en **Correo**; el monitorio sale listo para imprimir. No pulses el burofax.

<a id="a29"></a>

### A29 · Mandatos SEPA

1. **Mandatos SEPA**: el de María está cancelado. Crea uno para el Piso 3A (Andrés) y cancélalo.

**Esperado**: el estado se ve en la lista y María queda fuera de las remesas.

<a id="a30"></a>

### A30 · Remesas y devoluciones

1. **Remesas** → **Nueva remesa** → «Vencidos hasta» hoy, cargo en unos días → **Generar y descargar**.
2. Revisa «Comprobación del fichero».
3. **Marcar enviada**.
4. Despliega la remesa → **Devolución** en una línea → MD06 → **Registrar devolución**; deshazla.
5. **Importar devoluciones** con un pain.002 o camt.054 (si tienes uno).

**Esperado**: el pain.008 pasa la comprobación (o explica cada error); «Marcar cobrada» espera al día del cargo; lo devuelto vuelve a pendiente.

<a id="a31"></a>

### A31 · Facturas y pagos a proveedores

1. **Facturas pendientes**: registra una factura de Limpiezas Jaén.
2. **Pagos a proveedores** → orden de transferencia → descarga (pain.001).

**Esperado**: la factura pasa a pagada y la orden pasa la comprobación del fichero.

<a id="a32"></a>

### A32 · Conciliación bancaria

1. **Conciliación bancaria**: concilia un movimiento con su candidato, incluido un abono de la pasarela de [W11](#w11)/[W12](#w12); deshazlo.

**Esperado**: los candidatos son razonables; un abono de la pasarela cubre los pagos de su día. (Datos simulados.)

<a id="a33"></a>

### A33 · Contabilidad, liquidación, modelos y exportar

1. **Contabilidad**: el diario y los saldos; descarga el CSV y el XDiario.
2. **Liquidación del ejercicio**: revisa y cierra el ejercicio; reábrelo.
3. **Modelos fiscales**: genera el 347, el 190 y el 184.
4. **Exportar e importar** → exportaciones de saldos y deudores, y **Comprobar un fichero** con uno de los descargados.

**Esperado**: los asientos cuadran; cada fichero pasa su comprobación; cada descarga queda en el registro de actividad.

<a id="a34"></a>

### A34 · Correo saliente

1. Menú **Correo**: abre los correos de [A8](#a8), [A14](#a14), [A19](#a19), [A22](#a22) y [A28](#a28).
2. **Cargar más**.

**Esperado**: cada uno con estado «Prueba» y una vista previa fiel; los enlaces abren en otra pestaña.

<a id="a35"></a>

### A35 · Obligaciones

1. Comunidad → **Obligaciones**: «Requieren atención» muestra la inspección técnica vencida.
2. Crea una revisión de extintores con periodicidad de 12 meses.
3. Añádela al calendario (`.ics`).

**Esperado**: el `.ics` abre en tu calendario con su recordatorio; el panel de cartera la cuenta.

<a id="a36"></a>

### A36 · Zonas comunes y reservas

1. Comunidad → **Zonas comunes**: edita el horario y el límite semanal del pádel; crea una zona nueva reservable.
2. Abre las reservas de la Sala común: devuelve la fianza de la reserva de [W12](#w12).

**Esperado**: la webapp aplica el nuevo horario y límite; la fianza queda marcada como devuelta.

<a id="a37"></a>

### A37 · Proveedores

1. Menú **Proveedores**: crea uno, edítalo, asígnalo a una comunidad.
2. Valora uno con estrellas y comentario.

**Esperado**: aparece en la tarjeta **Proveedor** de las incidencias de esa comunidad; la media se actualiza.

<a id="a38"></a>

### A38 · Panel de cartera

1. Menú **Panel**.

**Esperado**: incidencias abiertas, resolución media, vecinos registrados, obligaciones y recibos vencidos de cada comunidad, coherentes con lo hecho hasta ahora.

<a id="a39"></a>

### A39 · Honorarios y Verifactu

1. **Honorarios** → **Datos fiscales del despacho**: revisa.
2. **Nueva factura** a Los Olivos → emítela → ábrela e imprímela.
3. **Factura rectificativa** de esa factura.
4. **Registro Verifactu**.

**Esperado**: numeración correlativa, la rectificativa enlazada a la original y ambas en el registro con su huella encadenada.

<a id="a40"></a>

### A40 · Registro de actividad

1. Comunidad → **Registro de actividad**.

**Esperado**: cada cambio de las pruebas anteriores, con quién y cuándo.

<a id="a41"></a>

### A41 · Equipo del despacho

1. Menú **Equipo**: revisa a Raúl (oficial) e Inés (contable); invita a alguien nuevo y quítalo.
2. Entra como Raúl e intenta cerrar un ejercicio ([A33](#a33)) y abrir **Honorarios**.
3. Entra como Inés y repite.

**Esperado**: Raúl ve las comunidades pero no cierra ejercicios ni factura honorarios; Inés sí lo contable.

<a id="a42"></a>

### A42 · Presidentes en el admin

1. Entra como Carmen: solo ve Los Olivos.
2. Entra como Tomás: solo ve Mirador del Castillo.
3. Como Carmen, invita a un vecino; intenta darle el rol de gestor.

**Esperado**: cada uno solo su comunidad; un gestor solo da el rol de vecino.

<a id="a43"></a>

### A43 · Superadmin

Como Equipo gobernança:
1. **Nueva comunidad**: crea una.
2. **Importar comunidades** ([A11](#a11)) e importa de verdad.
3. **Administradores**: invita a un administrador y asígnale Plaza de Andalucía.
4. **Cuentas**: cambia el nombre, el rol y el bloqueo de una cuenta; envía un enlace de contraseña nueva.
5. **Errores**: provoca un error y comprueba que aparece.
6. **Historial**: busca un cambio de hoy y restáuralo.

**Esperado**: lo creado aparece para quien toca; el Historial registra y restaura (necesita el emulador de Functions, que `npm run dev` arranca).

<a id="a44"></a>

### A44 · Accesos indebidos

1. Como Fincas Jaén, abre `/communities/comm3`, `/admins`, `/errors` y `/history` a mano.
2. Como María, entra en el admin.

**Esperado**: no abre nada que no le toque y lo dice con un mensaje, no con una página en blanco.

<a id="a45"></a>

### A45 · Tablet, tema y teclado

1. DevTools a 768 px: recorre comunidad, incidencia y finanzas.
2. Modo oscuro.
3. Un formulario solo con teclado (Tab, Enter, Escape).

**Esperado**: sin scroll horizontal, tablas legibles, foco visible, Escape cierra los formularios.

---

<a id="x"></a>

## X · Recorridos de punta a punta

Para comprobar que todo encaja, con dos navegadores a la vez.

<a id="x1"></a>

### X1 · Una avería, de principio a fin

[W6](#w6) → [A12](#a12) → [A13](#a13) → [A14](#a14) → la webapp de María muestra la incidencia como solucionada con cada paso en los comentarios.

<a id="x2"></a>

### X2 · El dinero de la comunidad

[A24](#a24) → [A25](#a25) → [A30](#a30) (con devolución de María) → [A28](#a28) → María ve el recibo devuelto en [W11](#w11) y lo paga → [A32](#a32) → [A23](#a23) cuadra.

<a id="x3"></a>

### X3 · La junta completa

[A19](#a19) → [W13](#w13) → [A20](#a20) → [A21](#a21) con [W14](#w14) → [A22](#a22) con [W15](#w15).

<a id="x4"></a>

### X4 · Alta de un despacho

[A43](#a43) (nueva comunidad y administrador) → el administrador entra con su enlace ([P3](#p3)) → [A11](#a11) o [A10](#a10) → [A8](#a8) invita a un vecino → el vecino entra como en [W2](#w2).

<a id="x5"></a>

### X5 · La demo de ventas

`npm run demo` y el guion entero de [demo.md](demo.md), con un móvil real en la misma red.
