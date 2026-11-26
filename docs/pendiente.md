# Pendiente

Todo lo abierto de [v1.md](v1.md), [competencia.md](competencia.md) y [fiabilidad.md](fiabilidad.md), agrupado por lo que lo desbloquea. Cada ID enlaza a su ficha, que tiene el detalle; aquí solo va qué falta. Al cerrar uno, quítalo también de aquí.

*Revisado el 26/11/2026, con toda la documentación al día. Los flujos se probaron en producción el 23/11/2026.*

<a id="ya"></a>

## Ya, sin coste

A mano, en la consola, en GitHub, en tu equipo o con un móvil:

| ID | Qué falta |
| --- | --- |
| [ROB-2](fiabilidad.md#rob-2) · [B5](v1.md#b5) | Activar la copia diaria en tu equipo (`npm run backup -- --schedule`). Hasta entonces, `npm run purge -- --delete` una vez al mes. Y comprobar que el equipo tiene FileVault activado y que la clave de las copias está en el gestor de contraseñas |
| [GAR-1](competencia.md#gar-1) · [B12](v1.md#b12) · [C3](v1.md#c3) | Desplegar a mano los índices ([índices](setup.md#indices)): sin ellos fallan en producción los filtros del Historial y las sumas de recibos y gastos (cifras de la comunidad, resumen de Finanzas y Liquidación) |
| — | Cambiar el token del bot de Telegram del formulario de la landing: va en su JS público, cualquiera puede usarlo. Con [INF-1](competencia.md#inf-1), mandarlo desde una function |
| [GAR-1](competencia.md#gar-1) · [B12](v1.md#b12) | Restaurar una versión desde el Historial con el emulador de functions, que arranca `npm run dev` |
| [DAT-2](competencia.md#dat-2) · [B3](v1.md#b3) | Lo que falta probar cambiando de cuenta: despacho (sus comunidades en Honorarios, su Equipo, aceptar una invitación), presidente (firmar el acta, ver honorarios sin editarlos), vecino con código y vecino bloqueado |
| — | Navegación colgada al salir de **Exportar e importar** con la vista previa abierta (`insertBefore` en consola), visto dos veces en producción con la pestaña en segundo plano; no se ha reproducido en local |
| [ROB-5](fiabilidad.md#rob-5) | Probar un interruptor desde la consola de Remote Config |
| [ROB-4](fiabilidad.md#rob-4) | Ensayar una vez la vuelta atrás de la app y de las reglas |
| [MON-5](fiabilidad.md#mon-5) | Ver pasar la comprobación de las dos webs en un despliegue |
| [ROB-7](fiabilidad.md#rob-7) | Activar en GitHub las alertas y las actualizaciones de seguridad de Dependabot |
| [ROB-8](fiabilidad.md#rob-8) · [B7](v1.md#b7) | Crear la clave de reCAPTCHA, registrarla en App Check, medir y pasar a obligatorio; restringir la clave de la API ([App Check](setup.md#app-check)) |
| [A1](v1.md#a1) | Crear el proyecto de demo en la consola ([pasos](setup.md#proyecto-demo)). La visita ya no lo necesita: `npm run demo` va en el portátil |
| [C3](v1.md#c3) | Con [A1](v1.md#a1), medir en el proyecto de demo, con `--volume`, las lecturas por pantalla y las escrituras de las cuotas |
| [A3](v1.md#a3) | Publicar la landing: GitHub Actions como origen de Pages. El aviso legal del pie espera a [EMP-1](competencia.md#emp-1). Si da tiempo, rehacer sus capturas en alta resolución |
| [MON-10](fiabilidad.md#mon-10) | Traducir la pila de una muestra de producción tras el siguiente despliegue |
| [MON-6](fiabilidad.md#mon-6) | Revisar la pestaña **Rendimiento** cuando lleguen medidas de producción |
| [C4](v1.md#c4) | La webapp en un iPhone y en un Android de gama baja reales, con VoiceOver y TalkBack |

<a id="decisiones"></a>

## Decisiones y trámites tuyos

| ID | Qué falta |
| --- | --- |
| [A2](v1.md#a2) | Elegir el nombre escrito y registrar el dominio y su correo; después, los dominios autorizados y el remitente de Auth ([rebranding.md](rebranding.md)) |
| [EMP-1](competencia.md#emp-1) · [A4](v1.md#a4) | Alta de autónomo o SL; con sus datos, el aviso legal de la landing y de las dos apps (`packages/shared/domain/legal.ts`) |
| [EMP-2](competencia.md#emp-2) · [A4](v1.md#a4) | Contrato de encargado del tratamiento con sus subencargados, registro de actividades, condiciones del servicio para el despacho y la política de privacidad de la webapp con el encargado |
| [EMP-5](competencia.md#emp-5) · [EMP-6](competencia.md#emp-6) · [A4](v1.md#a4) | El análisis de riesgos con la plantilla de EIPD para el despacho, y el procedimiento ante una brecha con su registro de incidentes; los dos, citados en el contrato de [EMP-2](competencia.md#emp-2) |
| [GAR-5](competencia.md#gar-5) | El procedimiento para atender a quien pide sus datos o que se borren, con el plazo que prometa el contrato |
| [GAR-4](competencia.md#gar-4) | Comprobar si el doble factor (Identity Platform) cabe en el plan gratuito y cuánto cuesta; con eso, activarlo para el despacho y el superadmin |
| [A4](v1.md#a4), paso 8 | Las preguntas al abogado sobre los plazos del Historial, dónde están los datos, la morosidad en el informe anual y el delegado de protección de datos; con las respuestas, ajustar los [plazos](setup.md#plazos) ([B12](v1.md#b12)) |
| [A5](v1.md#a5) | Ensayar la frase del modo de prueba; la tabla y las etiquetas ya están |
| [ROB-3](fiabilidad.md#rob-3) · [B11](v1.md#b11) | Decidir si los ficheros aceptados en [B6](v1.md#b6) se comprueban en CI |
| [EMP-3](competencia.md#emp-3) · [D1](v1.md#d1) · [D3](v1.md#d3) | Precio publicado, un canal de soporte con tiempo de respuesta y los vídeos de ayuda |
| [D2](v1.md#d2) | La propuesta de piloto en una página, impresa |
| [D4](v1.md#d4) | La lista de despachos de tu ciudad, y elegir 10 |
| [E](v1.md#e) · [F](v1.md#f) · [G](v1.md#g) | Repasar el speech, probar en la demo local lo que aún no se ha probado (lista al final de [demo.md](demo.md)), grabar el vídeo del plan B, ensayar la demo y pedir las visitas |

<a id="blaze"></a>

## Con el plan de pago

[INF-1](competencia.md#inf-1) · [B1](v1.md#b1): pasar producción a Blaze con el primer piloto firmado, con alertas de presupuesto, y medir cuánto cuesta un despacho al mes. Desbloquea:

| ID | Qué falta |
| --- | --- |
| [GAR-3](competencia.md#gar-3) · [A4](v1.md#a4) | Crear el bucket en la UE, desplegar sus reglas y activar la subida ([Storage](setup.md#storage)); probar en el emulador las fotos del gremio y lo que las reglas rechazan. Después, los documentos a Storage |
| [GAR-1](competencia.md#gar-1) · [B12](v1.md#b12) | Desplegar las functions ([functions](setup.md#functions)), comprobar que los eventos de producción traen el uid y medir su coste. Con ellas, **Cuentas** podrá cambiar también el email de acceso |
| [FUN-2](competencia.md#fun-2) · [B2](v1.md#b2) | Instalar la extensión de correo con un SMTP del dominio y SPF, DKIM y DMARC ([correo saliente](datos.md#correo)), y desplegar con `VITE_MAIL_MODE=extension` |
| [ROB-2](fiabilidad.md#rob-2) | Exportaciones programadas de Firestore y recuperación a un momento dado |
| [FUN-6](competencia.md#fun-6) | Recordatorios automáticos de vencimientos, recibos y juntas |
| [MON-9](fiabilidad.md#mon-9) | Avisos de errores urgentes al móvil del equipo |

<a id="piloto"></a>

## Con un piloto o datos reales

| ID | Qué falta |
| --- | --- |
| [EMP-4](competencia.md#emp-4) | El piloto: 1 o 2 despachos con 5–10 comunidades durante un ejercicio completo |
| [VAL-1](competencia.md#val-1) · [B6](v1.md#b6) | Presentar con datos reales el 347, el 190 y el 184 en la Sede, un pain.008 y un pain.001 en un banco, una Norma 43 y un XDiario en ContaPlus |
| [B9](v1.md#b9) | Importar las exportaciones reales de Gesfincas, TAAF y NetFincas, con una guía por programa |
| [INF-2](competencia.md#inf-2) | Medir las pantallas que más leen y servir los totales desde documentos resumen |

<a id="despues"></a>

## Producto, más adelante

| ID | Qué falta |
| --- | --- |
| [FUN-1](competencia.md#fun-1) | Cobros reales con tarjeta y Bizum |
| [FUN-4](competencia.md#fun-4) | Notificación fehaciente y firma reales del acta |
| [FUN-5](competencia.md#fun-5) | Conexión bancaria real (PSD2) y envío de Verifactu a la AEAT |
| [FUN-7](competencia.md#fun-7) | Burofax real |
| [FUN-3](competencia.md#fun-3) | La app en las tiendas |
| [GAR-2](competencia.md#gar-2) | Añadir a la exportación los comentarios de las incidencias y las fotos |
| [VAL-3](competencia.md#val-3) · [C6](v1.md#c6) | Catalán, gallego y euskera; obligatorio si el primer despacho está en una comunidad con lengua cooficial |
| [VAL-2](competencia.md#val-2) · [C6](v1.md#c6) | Modelos forales y TicketBAI |
| [C5](v1.md#c5) | La página de novedades, con [A](v1.md#a) y [B](v1.md#b) cerrados; la versión 1.0.0 ya está (24/11/2026) |
| [ROB-1](fiabilidad.md#rob-1) | Entorno de pruebas separado; aplazado, se usan los emuladores |
