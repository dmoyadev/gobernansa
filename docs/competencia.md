# Informe de competencia: gobernança en el mercado español de software para comunidades de propietarios

*Fecha de corte de los datos de competidores: 30/10/2026. Se basa en 32 perfiles de competidores verificados y en búsquedas propias sobre el tamaño del mercado y la regulación. Donde un dato no se conoce se dice «desconocido» y se explica el motivo.*


## 0. Cómo usar este documento

Referencia de producto para decidir y priorizar features de gobernança. Antes de proponer o construir una feature, comprobar aquí:

1. **Si ya la tenemos** (tabla de abajo) o si está en la competencia: la [matriz de funcionalidades](#4-matriz-de-funcionalidades) dice quién la tiene y cómo de bien.
2. **Si encaja con el posicionamiento** (sección 9.1): ERP completo para despachos pequeños y medianos (contabilidad, SEPA, AEAT y banca incluidos) con la mejor capa vecinal del mercado, más un plan gratuito para comunidades autogestionadas. Lo que cuesta dinero (pasarela de pago, agregador bancario, presentación en la AEAT, burofax) existe en modo de prueba hasta activar un proveedor.
3. **Su prioridad** en la [tabla de huecos](#92-huecos-por-prioridad) y qué competidor sirve de referencia.

### Estado de gobernança (revisado en el código el 01/11/2026)

| Área | Admin (`apps/admin`) | Webapp de vecinos (`apps/webapp`) |
|---|---|---|
| Acceso | Enlace mágico, contraseña solo como alternativa; roles e invitaciones con email de invitación (en el correo saliente, modo de prueba); cada administrador ve solo sus comunidades; instalable como app (PWA) | Enlace mágico; perfil; instalable como app (PWA) con push web, apertura sin conexión y aviso de nueva versión |
| Comunidades | Cartera con dashboard y bandeja de entrada, búsqueda de comunidades y vecinos, dashboard personalizable por comunidad, ficha fiscal 3D, propiedades. Importación del censo (propiedades, propietarios, coeficientes, teléfonos y mandatos SEPA) y de comunidades desde .xlsx, CSV o pegando celdas, con revisión fila a fila | Página de la comunidad (seguro, horarios de contacto, ficha fiscal) |
| Incidencias | Crear, gestionar estado, antigüedad; proveedor asignado con parte de trabajo por enlace (el gremio acepta, programa la visita y cierra con notas y fotos sin cuenta); urgencia y gremio sugeridos, resumen del hilo | Asistente de alta con categoría y urgencia sugeridas (con consejo en emergencias), comentarios, fotos, votos con cupo mensual, filtros. Página del parte de trabajo para el gremio |
| Juntas | Convocatoria, orden del día, votación, delegaciones. Acta firmada por presidente y secretario (firma electrónica simple), sellada con huella SHA-256 y QR e imprimible. Notificación de la convocatoria y del acta a cada propietario con acuse en la app y correo certificado en modo de prueba, discrepancias de ausentes (también recibidas por correo postal) y cómputo del art. 17.8 LPH | Ver convocatoria, unirse por enlace, votar y delegar; firmar el acta como presidente, leerla, acusar recibo y manifestar discrepancia en 30 días |
| Finanzas | Página Finanzas por comunidad, agrupada en cobros, gastos, banco y contabilidad. Cobros: cuotas del año desde el presupuesto con fondo de reserva, recibos y derramas, entregas a cuenta, estados de cuenta, mandatos y remesas SEPA (pain.008) con devoluciones a mano o importadas (pain.002 y camt.054), morosidad por antigüedad con intereses de demora y su recibo, cartas, burofax (prueba) y monitorio. Gastos: facturas de proveedores con IVA e IRPF, pendientes de pago y transferencias SEPA (pain.001). Banco: conciliación con Norma 43 o CSV, abonos de la pasarela de prueba y conexión PSD2 en modo demo. Contabilidad por partida doble (diario, mayor, balances, resultados y cierre), liquidación anual para la junta, modelos 347, 111/115, 190 y 184 con fichero oficial, exportación CSV y ContaPlus, importación de saldos. Cada fichero (SEPA, AEAT, diario) se comprueba antes de descargarlo y se pueden comprobar los de otros programas. Despacho: facturas de honorarios con Verifactu en modo de prueba | Mis recibos con lo pagado a cuenta, justificante imprimible y pago de lo pendiente de recibos y reservas con tarjeta o Bizum en modo de prueba |
| Reservas | Zonas comunes con icono y semana de cada zona, precio y fianza, cobros y devolución de fianzas | Reservar zonas comunes, pagando en modo de prueba si tienen precio |
| Comunicación | Comunicados a varias comunidades con borrador redactado a partir de unos puntos, avisos publicados, moderación, actividad. Correo saliente: invitaciones, convocatorias, actas, partes de trabajo y reclamaciones quedan en una bandeja con vista previa (modo de prueba), lista para enviarse con la extensión Trigger Email | Timeline de eventos, notificaciones push web |
| Proveedores | Directorio compartido con valoraciones; parte de trabajo por enlace, WhatsApp o email | Página del parte de trabajo, sin cuenta |
| Documentos | Enviar documentos a cada vecino por categoría y propiedad | Ver sus documentos en el perfil |
| Obligaciones | Calendario de obligaciones de la comunidad, exportable al calendario | — |

Las sugerencias y la redacción automática (urgencia y gremio de una incidencia, resumen del hilo, borradores de comunicados, mejora de la redacción del acta) usan los modelos que trae el navegador cuando están disponibles (Chrome) y, si no, reglas y plantillas propias. No envían datos a ningún sitio ni tienen coste.

**Lo que no tenemos y sí tiene la competencia:** cobros, banca y envíos reales: la pasarela de tarjeta y Bizum, el agregador PSD2, la presentación en la AEAT con certificado, el envío de Verifactu, el correo certificado, el burofax y el envío de emails solo existen en modo de prueba hasta contratar un proveedor. Tampoco tenemos app en tiendas (sí PWA instalable), firma cualificada del acta ni recordatorios automáticos por email (necesitan un servidor). Y, más allá de las funciones, faltan las bases para operar con clientes reales: infraestructura, modelo de datos, garantías, monitorización y empresa (sección 9.2).

### Mantenimiento

- **Al terminar una feature:** actualizar la tabla de estado de arriba, la fila de gobernança en la matriz de funcionalidades (sección 4), sus coordenadas en las matrices (sección 8) si cambian, y quitar o bajar su fila en la tabla de huecos (sección 9.2), pasando su identificador a la lista de cerrados con la fecha. Si se cierra un MON o un ROB, también en [fiabilidad.md](fiabilidad.md).
- **Al cambiar de posicionamiento o precio:** actualizar las secciones 9.1 y 9.5.
- **Datos de competidores:** caducan rápido (precios, notas en tiendas, versiones). Revisarlos cada 6 meses o antes de una decisión de precio, y cambiar la fecha de corte de arriba. Lo pendiente de verificar está en la sección 10.

---

## 1. Resumen ejecutivo

- **El mercado está partido en dos mitades que casi nadie cubre bien a la vez.** Una son los ERP contables y fiscales del administrador: Gesfincas, ADMINET, TAAF, NetFincas, Finca3, FincasPro y FincasPlus Elite. Funcionan bien pero son productos heredados y su capa para el vecino es mala: TucomunidApp tiene 2,1★ en iOS, TuAdministrador 2,1★ en Android y MioCondominio 1,3★. La otra mitad son las apps del vecino y de zonas comunes (Colindar, TusVecinos, ResidenciAPP, Plusvecinos), que no tienen panel multi-comunidad serio. El hueco está en el cruce de las dos.
- **El incumbente domina por canal y tiene mala experiencia de producto.** IESA/Aareon declara más del 80 % de los profesionales, más de 10.400 administradores y más de 400.000 comunidades, pero su app de vecinos tiene un 2,1★ con 360 valoraciones en iOS. La mala experiencia del vecino se repite en casi todos los ERP españoles. Es el argumento de producto más defendible para gobernança.
- **Los competidores más directos son nuevos o pequeños, y ya cobran.** Onzane (más de 700 comunidades declaradas, freemium, precios públicos, reservas avanzadas), VecinApp (2–6 €/comunidad/mes, mínimo 20 comunidades) y ResidenciAPP (una sola persona, Firebase y Expo, 275–425 €/año por comunidad) se parecen mucho a gobernança y le llevan ventaja en funciones que se pueden monetizar.
- **Los precios son bajos y transparentes en la franja baja del mercado.** El ERP cloud completo cuesta entre 24 y 36 €/mes (NetFincas), 26 €/mes (Finca3) o desde 0,10 €/unidad/mes (Fynkus). La app del vecino cuesta entre 2 y 4 €/vivienda/año (TusVecinos) o entre 1 y 2 €/vivienda/año (Onzane). Una capa vecinal no puede cobrar caro. Los precios altos solo los sostienen quienes venden servicio humano o fintech: Ciudadela, Supervecina, Matera.
- **Hay dos cambios regulatorios a la vista.** Las juntas telemáticas siguen pendientes de una reforma de la LPH que está en tramitación en el Congreso (mayo de 2026). Verifactu será obligatorio desde el 01/01/2027 para sociedades y desde el 01/07/2027 para autónomos. Esto afecta a la facturación de honorarios de los despachos, no a la comunidad en sí. Las juntas y las votaciones con validez LPH son una función diferencial pendiente para casi todos.
- **Los canales colegiales se están cerrando.** CGCAFE/CAFportal distribuye CAFcomunidad (Penta C365) colegio a colegio. IDS (FincasPlus Elite) desarrolla la app oficial del CGCAFE. comunicasa (casavi) ya colabora con el Colegio de Las Palmas. Entrar por los colegios va a ser más difícil.
- **Recomendación.** Posicionar gobernança como el ERP moderno para despachos pequeños y medianos con la mejor capa vecinal, con un plan gratuito o muy barato para comunidades autogestionadas. gobernança ya tiene juntas con voto, delegación, acta firmada y notificada con acuse, documentos, PWA instalable con push web, recibos con entregas a cuenta, morosidad con intereses, proveedores con valoraciones y parte de trabajo, importación del censo y sugerencias automáticas sin coste. Contabilidad, SEPA, conciliación, modelos AEAT con comprobación de ficheros y pagos (en modo de prueba) ya existen, así que compite también como ERP. Lo prioritario ahora es activar lo que está en modo de prueba cuando haya ingresos (cobros reales y envío de correo), validar los ficheros oficiales en la Sede y con un banco, y llevar la PWA a las tiendas.

---

## 2. Mapa del mercado

### 2.1 Segmentos

| Segmento | Quién paga | Competidores | Rasgos |
|---|---|---|---|
| **A. ERP del administrador de fincas (back office)** | Despacho | Gesfincas, ADMINET, TAAF, NetFincas, Cegid Finca3, FincasPro, FincasPlus, FincasPlus Elite, Fynkus, ADCOMUNIDAD, VecinApp, Comunix | Contabilidad, recibos SEPA, Norma 43, modelos AEAT (347, 184…), juntas. Muchos son de escritorio Windows, con origen entre 1985 y 2010. Costes de cambio altos. |
| **B. Portal del vecino y operación (B2B2C)** | Despacho, a veces el colegio | TucomunidApp, Comunidad 365 / CAFcomunidad, TuAdministrador, comunicasa, Onzane (modo administrador), Unitify | Incidencias, comunicaciones, documentos, reservas y voto. Se distribuye a través del administrador. |
| **C. Apps de comunidades autogestionadas y de zonas comunes** | Junta, presidente o comunidad | Colindar, TusVecinos, ResidenciAPP, Plusvecinos, Onzane (Free/Basic/Pro), Comunix (plan comunidad) | Precio por vivienda o por comunidad, reservas como núcleo, freemium. Tracción limitada. |
| **D. Administradores digitales (servicio más software)** | Comunidad | Ciudadela, Supervecina, Matera (Francia) | Sustituyen al administrador. Ciudadela además vende su software a despachos, lo que le crea un conflicto de canal. |
| **E. Benchmarks internacionales** | Varios | ComunidadFeliz/Visma, Vantaca, TownSq, Buildium, PayHOA, Superlógica, Neivor, Danea/TeamSystem, Matera, casavi | Señalan hacia dónde va el sector: pagos embebidos, IA agéntica, consolidación por adquisiciones. |

### 2.2 Tamaño y dinámica del mercado español

- **Comunidades de propietarios:** el CGCAFE habla de «más de 1.000.000 de comunidades de propietarios, de las cuales un 80 % son gestionadas por los Administradores de Fincas colegiados» ([Revista CGCAFE nº 193](https://cgcafe.org/wp-content/uploads/2024/12/Revista-193.pdf)). Según CAFMadrid (2020), más de 200.000 están en la Comunidad de Madrid. Es una cifra del propio sector, no un censo oficial. El INE no publica un recuento directo.
- **Comunidades sin administrador colegiado:** aplicando el 80 % del CGCAFE quedan unas 200.000. Ahí entran las autogestionadas y las que tienen administradores no colegiados. Es una estimación por diferencia, no un dato.
- **Administradores colegiados:** no hay una cifra nacional oficial actualizada. Elderecho.com cita 15.600 colegiados sin fecha y otras fuentes hablan de unos 25.000 administradores, colegiados o no ([elderecho.com](https://elderecho.com/los-administradores-de-fincas-piden-al-gobierno-la-colegiacion-obligatoria-para-frenar-la-competencia-desleal)). Por colegios: Madrid unos 3.600 ([Comunidad de Madrid](https://www.comunidad.madrid/node/54072)), Barcelona-Lleida unos 2.400 ([educaweb](https://www.educaweb.com/centro/col-legi-administradors-finques-barcelona-lleida-48507/)) y Valencia-Castellón cerca de 1.000. Como contraste, IESA declara más de 10.400 administradores y más de 5.800 despachos. Rango razonable: entre 15.000 y 25.000 administradores en entre 6.000 y 12.000 despachos (estimación).
- **Concentración:** IESA/Aareon dice tener más del 80 % de los profesionales; la cifra es suya y la repiten Swan y Bankinter (2020). Le siguen, a mucha distancia, IDS (más de 1.000 despachos), ADMINET (más de 5.000 «administradores» declarados, poco coherente con 1,51 M€ de facturación), TAAF (fuerte en Cataluña), NetFincas y Cegid. Hay una cola larga de micro-SaaS.
- **Consolidación:** Aareon (TPG) compró IESA (2023), DEH Online (2025) y Unibo (2025). Cegid compró Informàtica3 (2023). ICOR compró Pragma (2023). Visma compró ComunidadFeliz en Chile (2025). TeamSystem compra activos en Italia (2025). Es probable que siga habiendo compras en España.
- **Regulación relevante:**
  - **LPH (Ley 49/1960):** la LO 1/2025, en vigor desde el 03/04/2025, modificó varios artículos, sobre todo los de viviendas turísticas. Las **juntas telemáticas no están reguladas con carácter general**. La proposición de ley del PP para permitir juntas telemáticas y mixtas superó un primer trámite en el Congreso en mayo de 2026 y no consta que se haya aprobado ([CGCAFE](https://cgcafe.org/wp-content/uploads/2025/02/NP-APROBACION-JUNTAS-TELEMATICAS-PLENO-SENADO-13.02.pdf), [El Español](https://www.elespanol.com/sociedad/20260603/oficial-congreso-da-primer-paso-regular-juntas-telematicas-comunidades-vecinos/1003744261262_0.amp.html), [El Debate](https://www.eldebate.com/tecnologia/20260528/juntas-vecinos-digitalizan-expertos-alertan-no-todos-podran-seguirlas_422226.html)). Si se aprueba, acelerará la demanda de convocatorias, voto y actas digitales.
  - **Verifactu (RD 1007/2023):** el RDL 15/2025 lo aplazó al 01/01/2027 para sujetos del Impuesto sobre Sociedades y al 01/07/2027 para autónomos y el resto de obligados ([Legal Today](https://www.legaltoday.com/actualidad-juridica/noticias-de-derecho/nueva-prorroga-verifactu-no-sera-obligatorio-hasta-2027-para-sociedades-y-otros-contribuyentes-2025-12-04/), [Infoautónomos](https://www.infoautonomos.com/blog/verifactu-cuando-es-obligatorio-a-quien-afecta/)). Afecta a la **facturación de honorarios del despacho**. La obligación de las comunidades sin actividad económica es dudosa y no está verificada. NetFincas, ADCOMUNIDAD y TAAF ya lo usan como argumento comercial. No he contrastado las fechas con el BOE.
  - **Fiscalidad de la comunidad:** los modelos 347, 184 (cuando hay rentas, por ejemplo el alquiler de la azotea), 111 y 190 los cubren los ERP. Es una barrera de entrada para quien quiera hacer contabilidad.
  - **RGPD:** los datos de vecinos se tratan con el administrador como encargado. Varios competidores destacan que alojan en la UE (casavi, Comunix, VecinApp). FincasPlus ni siquiera publica aviso legal.

---

## 3. Tabla resumen de competidores

Leyenda de plataformas: W = web, D = escritorio Windows, iOS/And = apps en tiendas. «Últ. app» es la última actualización visible en tienda.

| Competidor | Segmento | País | Fundación | Modelo de precio | Precio de referencia | Plataformas | Stack (verificado o indicio) | Últ. app | Frecuencia |
|---|---|---|---|---|---|---|---|---|---|
| Gesfincas (IESA/Aareon) | A+B | ES (grupo DE) | 1985 (producto 1989) | Licencia + módulos + fintech | No publicado («sin coste» como gancho); TucoBan 9,5–30 €/mes | D, W, iOS/And | .NET escritorio; Angular (tucomunidad); Ionic | 28/10/2026 (Gesfincas IA) | Alta en apps nuevas, baja en las antiguas |
| TucomunidApp (IESA) | B | ES | App iOS ~2019-2020 | Incluida en contrato | Desconocido | W, iOS/And | Desconocido (indicio de Ionic) | 17/08/2026 | Frenada en 2026 |
| ADMINET (Pragma/ICOR) | A | ES | ~1989 (sin confirmar) | Suscripción con presupuesto | No publicado («0 € contratación») | W/cloud alojado, iOS/And | SQL Server alojado; web WordPress | 05/10/2026 | Mensual |
| TAAF | A | ES (Cataluña) | 2000 | Licencia o SaaS | No publicado; CRM desde 1.200 € | D/W/cloud, iOS/And (personal) | ASP.NET Core (portal) | 13/02/2026 (And) | Baja |
| Fynkus | A | ES | 2016 (ERP 2019) | Por unidad, freemium | FREE; PRO 0,10 €/unidad/mes (mín. 2,5 €/comunidad) | W, iOS/And | PHP/Symfony + jQuery → Vue | 28/07/2026 | Alta (40 entradas de changelog en 2026) |
| ADCOMUNIDAD | A | ES | ~1999 (S.L. desconocida) | Suscripción | Desde 17 €/mes | W, iOS/And/Win | Next.js/Abacus.AI (web) | 29/10/2026 | Alta |
| Ciudadela | A+D | ES | 2020 | A medida + servicios | No publicado; contabilidad 0,50 €/propiedad/mes | W, iOS/And | React/Vite (Lovable), Next.js, GCP | 16/10/2026 | Alta |
| VecinApp | A+B | ES | 2024 (declarada) | Por comunidad | 2 / 4,5 / desde 6 €/comunidad/mes, mín. 20 | W, iOS/And | React/Vite, Supabase, Vercel, OpenAI | 08/08/2026 | Baja |
| Onzane (Fincapp) | B+C | ES | ~2016 (S.L. 2023) | Freemium por vivienda o comunidad | Comunidad 0/1/2 €/vivienda/año; administrador 50–315 €/mes | W, iOS/And | Laravel/Livewire | 28/10/2026 | Muy alta |
| Colindar | C | ES | 2015 (S.L. 2021) | Por comunidad + complementos | 163–385 €/año | W, iOS/And | Astro, Next.js, Ionic | 11/03/2026 (And) | Web alta; apps estancadas |
| NetFincas | A | ES | 1997 (S.L. 2007) | Cloud o licencia única | 24–36 €/mes; 120–255 € pago único | D, W | Desconocido | Sin app | Desconocida |
| Cegid Finca3 | A | ES (grupo FR) | Antes de 2002 | Suscripción despacho | 26 €/mes (4 usuarios) + alta | D | Windows escritorio | Sin app | Desconocida tras la compra |
| FincasPro | A | ES | 2010 (S.L. 2019) | Por tramos de comunidades | 30–240 €/mes (+ Oficina Virtual 5–90 €) | W, iOS/And | PHP heredado ISO-8859-1; WebView | 13/06/2025 | Estancada |
| FincasPlus | A | ES | 2016 | Por tramos | 9,90–49,90 €/mes | W, Android sin ficha | PHP/Apache, IONOS | Sin ficha pública | Mantenimiento |
| FincasPlus Elite / TuAdministrador (IDS) | A+B | ES | 1993 | Licencia + cuota por puesto | 48,73 + 19,09 + 9,55 €/puesto/mes | D, W, iOS/And | Windows; Angular 12 | 02/06/2026 | Cada 2–4 meses |
| Comunix | A+C | ES | 2026 | Plano por despacho o por vivienda | 29 €/mes; 9 €/vivienda/año (en beta gratis) | W | React/Vite, Railway, OpenAI | Sin app | Semanal |
| ResidenciAPP | C | ES | 2025 | Licencia anual por comunidad | 275 / 350 / 425 €/año | W, iOS/And | Expo/RN + Firebase + Stripe | 21/10/2026 | Alta |
| Plusvecinos | C | ES | 2011 (TodosVecinos) | Freemium por comunidad | 0 / 25 / 45 €/mes | W, iOS/And | PHP/Symfony 2, jQuery 1.11 | 19/02/2026 (iOS) | Mantenimiento |
| TusVecinos | C | ES (sociedad EE) | 2021 | Por vivienda | 2 / 3 / 4 €/vivienda/año | iOS/And, W (administrador) | Firebase (indicio), estático | 14/07/2026 | Alta hasta julio |
| Comunidad 365 / CAFcomunidad | B | ES | 2020 | Suscripción por comunidad | No publicado | W, iOS/And | CRA + Firebase RTDB + Stripe | 15/10/2026 (CAFcomunidad) | Alta (CAFcomunidad) |
| Supervecina | D | ES | 2017-2018 | Servicio por comunidad | Desde 45 / 60 / 90 €/mes | W | Angular 19, Astro, LLM Anthropic | Sin app | Alta |
| comunicasa (casavi) | B | DE → ES | 2015 | Paquetes por administrador | DE: 219–599 €/mes; ES: no publicado | W, iOS/And | React/NestJS/AWS; Astro | Oct 2026 | Mensual |
| ComunidadFeliz (Visma) | E | CL | 2015 | A medida + comisiones | No publicado | W, iOS/And | Rails, React Native | 30/10/2026 | Muy alta |
| Matera | E/D | FR | 2017 | Honorarios por lote | ~135–200 €/lote/año (terceros) | W, iOS/And | Rails, React/TS | 30/10/2026 | Muy alta |
| Vantaca | E | EE. UU. | 2015-2017 | A medida | No publicado | W, iOS/And | .NET/Azure (ofertas de empleo) | 27/10/2026 | Alta |
| TownSq | E | EE. UU./BR | 2013 | Por comunidad y tramo | 90–435 $/mes + complementos | W, iOS/And | Angular 15, AWS, Firebase, Stripe | 29/10/2026 | Muy alta |
| Buildium | E | EE. UU. | 2004 | Plan + comisiones | Desde 65 / 202 / 420 $/mes | W, iOS/And | C#/.NET/Angular (ofertas de empleo) | ~27/10/2026 | Muy alta |
| PayHOA | E | EE. UU. | 2018 | Plano por unidades | 49 $/mes (hasta 25 unidades) | W | Angular 17, S3/CloudFront | Sin app | Alta |
| Superlógica | E | BR | 2001 | A medida + fintech | No publicado | W, iOS/And | Gatsby; Varnish | 29/10/2026 | Muy alta |
| Neivor | E | MX | 2019 | A medida | No publicado | W, iOS/And | JSF/PrimeFaces heredado | 30/09/2026 | Muy alta |
| Unitify | B/C (multipaís) | HK | 2024 | Freemium por vivienda | 0 / 1 / 3 €/vivienda/mes | W, Android | Next.js | 30/10/2026 | Alta |
| Danea Domustudio (TeamSystem) | E | IT | ~1996 | Licencia anual por administrador | 288 / 576 €/año | W/D, iOS | PHP (web), React PWA | 08/09/2026 | Media |
| **gobernança** | B+C (+A ligero) | ES | 2026 (marzo) | Sin monetizar | — | W (dos apps Vue, instalables como PWA) | Vue 3 + Firebase (plan gratuito) | — | Alta (desarrollo activo) |

---

## 4. Matriz de funcionalidades

Leyenda: ✅ sí · ◐ parcial · ❌ no · ? desconocido · — no aplica (normativa no española). La fila de gobernança se ha corregido revisando el código del repositorio a 01/11/2026.

| Competidor | Multi-com. | Portal vecino | App nativa | Incid. | Reservas | Tablón/notif. | Juntas/voto | Docs | Contab. | Recibos SEPA | Fiscal AEAT | Pagos online | Banca/API | Proveedores | IA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **gobernança** | ✅ | ✅ | ◐ (PWA instalable con push web y apertura sin conexión; sin app en tiendas) | ✅ (con votos de prioridad, urgencia sugerida y parte de trabajo para el gremio) | ✅ | ✅ | ✅ (convocatoria, voto, delegación, acta firmada y sellada, notificación con acuse y cómputo del art. 17.8) | ✅ | ✅ (partida doble, cierre, liquidación anual, exporta a ContaPlus) | ✅ (cuotas desde el presupuesto, entregas a cuenta, intereses de demora, remesas pain.008 con devoluciones importadas, transferencias pain.001) | ◐ (347, 111/115, 190 y 184 con fichero oficial comprobado, sin presentación telemática; Verifactu de honorarios en modo de prueba) | ◐ (recibos y reservas con fianza, solo en modo de prueba) | ◐ (Norma 43/CSV y conciliación reales, abonos de la pasarela; conexión PSD2 en modo demo) | ✅ (directorio compartido con valoraciones, parte de trabajo sin cuenta, facturas con IVA e IRPF) | ◐ (sugerencias y redacción automática en el navegador, sin coste) |
| Gesfincas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ◐ | ✅ | ✅ | ✅ |
| TucomunidApp | ✅ | ✅ | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ (vía ERP) | ✅ | ? | ◐ | ✅ | ✅ | ? |
| ADMINET | ✅ | ✅ | ✅ | ✅ | ? | ◐ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ◐ | ◐ | ✅ |
| TAAF | ✅ | ✅ | ◐ (solo personal) | ✅ | ? | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ◐ | ❌ |
| Fynkus | ✅ | ✅ | ✅ | ✅ | ❌ | ◐ | ◐ | ✅ | ✅ | ◐ | ? | ? | ✅ | ◐ | ✅ |
| ADCOMUNIDAD | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✅ | ◐ | ✅ |
| Ciudadela | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ | ✅ |
| VecinApp | ✅ | ✅ | ◐ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ✅ | ◐ | ✅ |
| Onzane | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ◐ | ✅ | ❌ |
| Colindar | ◐ | ✅ | ◐ (híbrida) | ? | ✅ | ◐ | ? | ◐ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| NetFincas | ✅ | ✅ | ❌ | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ◐ | ◐ | ✅ |
| Cegid Finca3 | ✅ | ❌ | ❌ | ◐ | ❌ | ◐ | ◐ | ◐ | ✅ | ◐ | ? | ❌ | ? | ❌ | ❌ |
| FincasPro | ✅ | ✅ | ◐ (WebView) | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ◐ | ? | ◐ | ◐ | ❌ |
| FincasPlus | ✅ | ◐ | ◐ | ✅ | ❌ | ? | ◐ | ✅ | ◐ | ✅ | ? | ❌ | ❌ | ❌ | ❌ |
| FincasPlus Elite / TuAdmin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✅ |
| Comunix | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ◐ | ✅ | ✅ | ◐ | ❌ | ◐ | ❌ | ✅ |
| ResidenciAPP | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ❌ | ❌ | ❌ | ✅ | ◐ | ◐ | ◐ |
| Plusvecinos | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ❌ | ❌ | ❌ | ◐ | ❌ | ✅ | ❌ |
| TusVecinos | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ◐ | ❌ | ✅ |
| Comunidad 365 / CAFcom. | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ◐ | ❌ | ◐ | ◐ | ◐ | ❌ |
| Supervecina | ◐ | ✅ | ❌ | ✅ | ❌ | ◐ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ? | ◐ | ✅ |
| comunicasa | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ◐ | ✅ | ❌ | ❌ | ❌ | ? | ◐ | ✅ | ✅ |
| ComunidadFeliz | ✅ | ✅ | ✅ | ? | ✅ | ✅ | ◐ | ✅ | ✅ | ◐ | — | ✅ | ✅ | ◐ | ◐ |
| Matera | ◐ | ✅ | ✅ | ✅ | ? | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ◐ | ◐ | ◐ |
| Vantaca | ✅ | ✅ | ✅ | ✅ | ? | ◐ | ◐ | ✅ | ✅ | ◐ | — | ✅ | ✅ | ◐ | ✅ |
| TownSq | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ◐ | ❌ | — | ✅ | ◐ | ❌ | ✅ |
| Buildium | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ❌ | ✅ | ✅ | ❌ | — | ✅ | ✅ | ✅ | ✅ |
| PayHOA | ✅ | ✅ | ❌ | ◐ | ✅ | ✅ | ◐ | ✅ | ✅ | — | — | ✅ | ✅ | ◐ | ✅ |
| Superlógica | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | — | ✅ | ✅ | ◐ | ✅ |
| Neivor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ◐ | ◐ | — | ✅ | ✅ | ◐ | ✅ |
| Unitify | ✅ | ✅ | ◐ (solo Android) | ✅ | ✅ | ✅ | ◐ | ◐ | ◐ | ◐ | ❌ | ✅ | ◐ | ◐ | ✅ |
| Danea Domustudio | ✅ | ◐ | ◐ | ✅ | ? | ✅ | ✅ | ✅ | ✅ | ✅ | — | ◐ | ◐ | ◐ | ◐ |

**Lectura rápida de la matriz:**
- Las funciones que gobernança ya tiene (incidencias, reservas, tablón, multi-comunidad) son las más comunes del mercado. **No la diferencian por sí solas.**
- Las reservas faltan o no están documentadas en casi todos los ERP españoles: ADMINET, TAAF, Fynkus, Ciudadela, Finca3, FincasPlus. Ese es el hueco del administrador.
- Lo que más se repite en la competencia y le falta a gobernança: app en tienda (la PWA la cubre a medias) y los cobros, la banca y los envíos reales (pagos online, PSD2, correo y burofax están en modo de prueba). Contabilidad, remesas SEPA, modelos AEAT, juntas con acta firmada, documentos, push web, morosidad, proveedores con parte de trabajo y sugerencias automáticas **ya existen** en el código.

---

## 5. Fichas por competidor

### 5.1 España: ERP del administrador y suites

**Gesfincas (IESA / Aareon Spain)**
- *Qué es:* el ERP de referencia del sector (desde 1989), con ecosistema propio: TucomunidApp, iJuntas, Tucomunidad Empresas, TucoBan/Unibo y Gesfincas IA.
- *Cómo funciona y se vende:* licencia de escritorio Windows (Gesfincas.Net) o Gesfincas cloud (desde 2023, sin detalle). Venta directa con demos y webinars. La licencia «sin coste» sirve de gancho y la monetización viene, previsiblemente, de módulos y servicios financieros (es una inferencia).
- *Precio:* no publicado. Solo TucoBan tiene precio: 9,50–30 €/mes por comunidad.
- *Stack:* .NET de escritorio (inferido del nombre); login de Tucomunidad en Angular; apps Ionic.
- *Antigüedad y actividad:* empresa de 1985 y unos 190 empleados (2023). Las apps nuevas se actualizan en octubre de 2026; tuComunidad.com está estancada desde 2022.
- *Fortalezas:* cuota declarada de más del 80 %, más de 400.000 comunidades, respaldo de TPG.
- *Debilidades:* app del vecino con 2,1★, núcleo heredado, ninguna oferta para comunidades autogestionadas, precios opacos, la IA casi no se usa (más de 100 descargas).
- *Amenaza:* media-alta en el lado del administrador; baja en comunidades autogestionadas.

**TucomunidApp / tuComunidad.com (IESA)**
- *Qué es:* la capa vecinal de Gesfincas. Solo se entra por invitación del administrador.
- *Funciones:* incidencias, voto y delegación, reservas, recibos, llave digital y directorio de más de 3.500 empresas.
- *Precio:* incluido en el contrato con IESA (importe desconocido).
- *Actividad:* 2,1★ en iOS (360 valoraciones). Tres versiones en 2026 y ninguna desde el 17/08/2026.
- *Fortalezas:* distribución cautiva, más de 1,5–1,6 M de vecinos declarados (la web da dos cifras distintas).
- *Debilidades:* producto fragmentado en varias apps y webs, mala experiencia, dependencia total del administrador.
- *Amenaza:* alta en despachos con Gesfincas, porque es el estándar por defecto; baja fuera de ellos. Es el producto contra el que se compara gobernança en experiencia de usuario.

**ADMINET (Pragma Informática / ICOR)**
- *Qué es:* ERP completo (horizontal, vertical, inmobiliaria, AEAT, IA) con la app del vecino ADMINET 24H incluida y marca blanca.
- *Cómo se vende:* demo y «0 € de contratación». Precio no publicado.
- *Stack:* SQL Server alojado por Pragma. No se sabe si el cliente es web o escritorio remoto.
- *Empresa:* 1,51 M€ de facturación y 21 empleados (2023), con pérdidas. Versiones aproximadamente mensuales (26.09.x).
- *Tracción:* las apps del vecino tienen descargas modestas (unos pocos miles). Los «más de 5.000 administradores» declarados no cuadran con la facturación.
- *Fortalezas:* ERP completo e IA en producción.
- *Debilidades:* adopción baja de la app del vecino, sin reservas visibles, precio opaco.
- *Amenaza:* media.

**TAAF**
- *Qué es:* suite modular (horizontal, vertical, IMMO, CONTA) con Oficina Virtual en marca blanca. Fundada en 2000, fuerte en Cataluña, 28 empleados vinculados en LinkedIn.
- *Precio:* sin licencia pública. Kit Digital: CRM desde 1.200 €, BI a 50 €/mes, comunicaciones certificadas a 0,28 €.
- *Stack:* portal en ASP.NET Core. La app es para el personal del despacho (más de 1.000 descargas) y en iOS no se actualiza desde 08/2025.
- *Fortalezas:* Verifactu e IRAV al día, consultoría, partners (incluidos Unibo y DEH).
- *Debilidades:* experiencia del vecino secundaria, sin IA, blog sin publicaciones en 2026.
- *Amenaza:* media-baja.

**Fynkus**
- *Qué es:* ERP cloud de bajo coste (Valencia, 14 personas) con app gratuita para propietarios.
- *Precio:* FREE para pocas comunidades; PRO a 0,10 €/unidad/mes con mínimo de 2,5 €/comunidad y 10 €/despacho. Es la referencia de precio más agresiva del segmento A.
- *Stack:* Symfony/PHP con jQuery, migrando a Vue en modo islas.
- *Actividad:* changelog público con 40 entradas en 2026.
- *Tracción:* app con más de 50.000 descargas, pero 2,9★ en Android y 2,37★ en iOS.
- *Debilidades:* sin reservas ni voto online; experiencia del vecino centrada en consultar.
- *Amenaza:* alta en el lado del administrador. Es un ERP complementario posible: gobernança podría integrarse o importar sus datos.

**ADCOMUNIDAD**
- *Qué es:* microempresa de Ourense con un ERP cloud completo (contabilidad, SEPA, Veri*Factu/TicketBAI, IA de voz y de facturas mediante partners).
- *Precio:* desde 17 €/mes, con 30 días de prueba.
- *Tracción:* casi nula. 500+ descargas de la app de propietarios y 10+ de la de administradores, 0 valoraciones.
- *Actividad:* web rehecha en Next.js/Abacus.AI; apps actualizadas en octubre de 2026.
- *Amenaza:* media-baja. Fija una referencia de precio baja.

**Ciudadela**
- *Qué es:* SaaS con IA y back office para despachos que además capta comunidades directamente (/presupuesto). Madrid, 2020.
- *Financiación:* 2,7 M€ (Wayra, Athos). Más de 70 empleados en 2024.
- *Producto:* contabilidad completa (N19, N34, 347), IA transversal (Lyra, llamadas con IA), red de más de 3.000 proveedores.
- *Precio:* no publicado. Contabilidad externalizada desde 0,50 €/propiedad/mes.
- *Stack:* web en Lovable (React/Vite, Supabase); producto en Next.js sobre GCP.
- *Reputación:* Trustpilot 1,5/5 (53 reseñas); app con 1,4★ en Android.
- *Debilidades:* conflicto de canal, sin reservas ni tablón.
- *Amenaza:* alta en la plataforma de administración; media en la del vecino. gobernança puede usar su **neutralidad** (no compite con los despachos) como argumento.

**VecinApp**
- *Qué es:* micro-SaaS de Barcelona (fundación declarada en 2024), el más parecido a gobernança en edad y enfoque, pero con contabilidad, SEPA, pagos con tarjeta y Bizum, Copilot IA y firma.
- *Precio:* Core 2 €, Automation 4,5 € y Complete desde 6 € por comunidad y mes. Mínimo de 20 comunidades, con ponderación por tamaño.
- *Stack:* React/Vite, Supabase, Vercel, OpenAI.
- *Tracción:* mínima (50+ descargas en Android, 1 valoración en iOS). SEO agresivo con 170 URLs y páginas «vs» y «migrar desde».
- *Amenaza:* alta. Deja fuera a los despachos de menos de 20 comunidades y a las comunidades autogestionadas.

**NetFincas (Ebora Software)**
- *Qué es:* ERP veterano (marca de 1997, Toledo). Escritorio Windows o 365 Cloud con el portal MiComunidad360 (reservas y votaciones).
- *Precio:* cloud a 24 €/mes (1 comunidad) o 36 €/mes (ilimitadas); escritorio 120–255 € en pago único. Promoción de 1 €/mes durante el primer año.
- *Tracción:* sin apps nativas. Tiene base instalada real (ofertas de empleo lo piden), pero casi sin reseñas (2,8/5 con 1 reseña).
- *Fortalezas:* AEAT, Veri*Factu y TicketBAI, agente IA para facturas.
- *Amenaza:* medio-baja. Marca el precio suelo del ERP completo con portal incluido.

**Cegid Finca3**
- *Qué es:* programa de escritorio Windows en red local, sin portal ni app para el vecino.
- *Precio:* 26 €/mes con 4 usuarios, más un alta de importe no publicado.
- *Contexto:* Informàtica3 la compró Cegid en 2023. Hoja de ruta desconocida.
- *Amenaza:* baja. Gobernança puede servirle de complemento: Finca3 exporta a XLS y TXT, lo que permite importar sus datos.

**FincasPro (Sogenube)**
- *Qué es:* ERP 100 % web desde 2010, con precios públicos por tramos (30–240 €/mes) más la Oficina Virtual (5–90 €/mes), reservas con aforo y votación online.
- *Stack:* PHP heredado.
- *Actividad:* app WebView parada desde 06/2025. Empresa unipersonal con 3.000 € de capital.
- *Amenaza:* baja-media.

**FincasPlus**
- *Qué es:* SaaS PHP de 2016 en modo mantenimiento. Precio de 9,90 a 49,90 €/mes.
- *Debilidades:* sin identidad legal publicada (posible incumplimiento de la LSSI).
- *Amenaza:* baja. Solo sirve como referencia de precio.

**FincasPlus Elite + TuAdministrador (IDS)**
- *Qué es:* ERP de escritorio para colegiados (Valencia, 1993, 16 empleados) con portal y app TuAdministrador (pagos, reservas, incidencias, roles de proveedor y empleado) e IA «Agente Propietario».
- *Precio:* 48,73 €/mes el primer puesto, con permanencia de 1 año y curso obligatorio.
- *Canal:* convenio con el CGCAFE; desarrolla la app oficial del CGCAFE. Más de 1.000 despachos declarados.
- *Debilidades:* app con 2,1★ en Android y 2,9★ en iOS; portal en Angular 12.
- *Amenaza:* media, sobre todo por el canal colegial.

**Comunix**
- *Qué es:* proyecto de una persona en Asturias (2026), centrado solo en contabilidad, morosidad y SEPA con IA (OpenAI).
- *Precio:* 29 €/mes por despacho (comunidades ilimitadas) o 9 €/vivienda/año para comunidades autogestionadas. En beta gratuita.
- *Stack:* React/Vite en Railway (UE).
- *Amenaza:* media. Es **complementario**: podría ser socio de integración, porque cubre la contabilidad que gobernança no tiene. Si añade un portal de vecinos, pasa a ser competidor directo.

### 5.2 España: portal del vecino, autogestión y zonas comunes

**Onzane (antes Fincapp)**
- *Qué es:* el concepto más parecido a gobernança, con mucha más amplitud: tablón, foro, incidencias, reservas con pagos y fianzas, juntas con portafirmas, contabilidad (desde 2026), IoT y accesos, app de empleados, API y marca blanca.
- *Precio:* comunidades Free, o 1–2 €/vivienda/año con tope de 150–600 €; administradores 50–315 €/mes (7–10 €/comunidad).
- *Stack:* Laravel/Livewire.
- *Empresa:* microempresa de Sevilla. Más de 700 comunidades y 80.000 residentes declarados. 3,6★ en iOS y 3,9★ en Android.
- *Actividad:* changelog y hoja de ruta públicos.
- *Debilidades:* sin IA; producto complejo con varias marcas.
- *Amenaza:* **alta.**

**Colindar (Zenifica)**
- *Qué es:* especialista en reservas (cupos, aforo, torneos, bonos), domótica de puertas y luces, cobros y agente IA por WhatsApp. Más de 500 comunidades declaradas.
- *Precio:* 163–385 €/año por comunidad más complementos (132 €/año cada uno). La IA costará 39–79 €/mes desde 2027.
- *Stack:* apps Ionic en iOS sin actualizar desde 2021-2022; la web evoluciona (Astro, Next.js).
- *Amenaza:* media. Es el listón en reservas; no tiene plataforma de administración.

**ResidenciAPP**
- *Qué es:* proyecto de una persona con **el mismo stack que gobernança** (Firebase, enlace mágico por email) más Expo/RN y Stripe Connect.
- *Producto:* reservas con pago y monedero, votaciones delegadas con PDF, inquilinos, conserje.
- *Precio:* 275 / 350 / 425 €/año por comunidad.
- *Tracción:* más de 20 comunidades declaradas, 100+ descargas en Android.
- *Amenaza:* media. Valida que se puede monetizar ese mismo producto y fija una referencia de unos 300 €/año por comunidad.

**Plusvecinos / PropApp**
- *Qué es:* marca histórica de la autogestión (TodosVecinos, 2011). Freemium a 0 / 25 / 45 €/mes por comunidad.
- *Producto:* votación certificada (Namirial), reservas con cobro.
- *Stack y actividad:* Symfony 2 y jQuery 1.11; 2,0★ en iOS; en mantenimiento.
- *Amenaza:* media en el lado del vecino. Fija la referencia de precio para el presidente que gestiona solo.

**TusVecinos (QCGA OÜ)**
- *Qué es:* app completa de vecino (reservas, pagos, votaciones, paquetería, IA) a 2–4 €/vivienda/año, con 3 meses gratis.
- *Tracción real:* 5.813 € de ingresos en 2025 (registro estonio), que contradicen las «más de 350 comunidades» declaradas.
- *Amenaza:* medio-baja. Muestra que el precio por vivienda es muy bajo y que la tracción en comunidades autogestionadas es difícil.

**Comunidad 365 / CAFcomunidad (Penta C365)**
- *Qué es:* portal del vecino con videojuntas (Jitsi), voto y delegación, reservas con abonos, IoT y fichaje.
- *Canal:* el **canal CGCAFE/CAFportal**. El responsable de CAFportal es el cofundador de la empresa, y se despliega colegio a colegio (Extremadura, Castilla y León, Navarra, Sevilla).
- *Stack:* CRA (ya deprecado) con Firebase RTDB y Stripe.
- *Tracción y valoración:* 3,4★ en iOS y 3,7★ en Android; CAFcomunidad tiene 500+ descargas.
- *Amenaza:* medio-alta por canal, no por producto.

**Supervecina**
- *Qué es:* administrador online (Sevilla o Granada, 2-10 personas) con portal web, voto, encuestas e IA (LLM de Anthropic) en incidencias y actas.
- *Precio:* desde 45 / 60 / 90 €/mes por comunidad, más un importe por vivienda.
- *Debilidades:* sin app, sin reservas.
- *Amenaza:* medio-baja. Compite por la comunidad, no por el despacho.

**comunicasa (casavi GmbH)**
- *Qué es:* el líder alemán (más de 2.200 administraciones y 3,8 M de unidades declaradas, Serie B de 20 M€) entrando en España con IA de voz y WhatsApp.
- *Situación en España:* la suite de gestión aparece como «Próximamente». Tiene Country Lead y colabora con el Colegio de Las Palmas.
- *Precio:* en Alemania desde 219 €/mes; en España no publicado.
- *Amenaza:* medio-alta a medio plazo. Es el mismo modelo que persigue gobernança, con diez años de ventaja.

**Unitify**
- *Qué es:* empresa de Hong Kong (2024) del fundador de Doma.ai.
- *Precio:* freemium a 0 / 1 / 3 €/vivienda/mes. Ojo: Base equivale a 12 €/vivienda/año, más caro que TusVecinos.
- *Producto:* CRM, reservas, IA.
- *Debilidades:* sin iOS, web en inglés, sin AEAT ni LPH; 500+ descargas.
- *Amenaza:* media. El plan Free es la referencia peligrosa.

### 5.3 Benchmarks internacionales

| Competidor | Qué enseña | Datos clave | Amenaza para gobernança |
|---|---|---|---|
| **ComunidadFeliz (Visma, CL)** | Monetización múltiple: comisiones de pago, seguros, financiación, accesos | Más de 7.000 comunidades, ~70 M$ (prensa), Rails + React Native, iOS 4,22★ con 2.745 valoraciones | Baja hoy, media a 2-3 años si Visma compra un actor en España |
| **Matera (FR)** | Administrador digital con software y expertos; validado por la Cour de cassation (17/09/2026) | 22 M€ de facturación en 2025, resultado de -1,75 M€, más de 10.000 copropiedades declaradas, iOS 4,81★ | Baja a corto, media a largo |
| **Vantaca (EE. UU.)** | ERP de gestora con IA agéntica (HOAi Fleet) | Valoración de 1.250 M$, más de 50.000 asociaciones; apps de residente con 1,34–2,6★ | Baja; sirve de referencia de producto |
| **TownSq (EE. UU./BR)** | Portal del vecino con complementos e IA, en español, con precios públicos (90–435 $/mes) | iOS 4,66★ con 11.505 valoraciones; Angular 15 | Baja; es el benchmark directo del portal |
| **Buildium (EE. UU.)** | Autoservicio desde 65 $/mes más comisiones; Resident Center con 4,8★ | Más de 20 años, RealPage | Baja |
| **PayHOA (EE. UU.)** | **Modelo a imitar para comunidades autogestionadas:** precio plano por tamaño (49 $/mes), prueba sin tarjeta, SEO legal por estado, IA como complemento, sin app nativa | Más de 6.000 comunidades, Serie A de 27,5 M$, Angular 17 | Baja directa; alto valor como referencia |
| **Superlógica (BR)** | ERP con fintech regulada; superapp Gruvi (4,8★) | Más de 130.000 condominios, más de 1.000 empleados | Baja |
| **Neivor (MX)** | El dinero está en el flujo de cobros: CLABE por unidad, conciliación, pagos agénticos | 4,35★ en iOS; núcleo JSF heredado | Baja; inspira un posible «IBAN virtual por vivienda» |
| **Danea Domustudio (IT)** | ERP con CRM e IA cobrado por unidad (Multidomus, 2–4 €/unidad/año); consolidación de TeamSystem | 288 / 576 €/año; MioCondominio con 1,3★ y retirado de las altas | Baja hoy, media a largo |

---

## 6. Pricing y go-to-market del sector

**Patrones de precio**

1. **ERP del despacho, tarifa plana o por tramos (barato):** FincasPlus 9,90–49,90 €/mes; NetFincas 24–36 €/mes; Finca3 26 €/mes; ADCOMUNIDAD desde 17 €/mes; Comunix 29 €/mes; FincasPro 30–240 €/mes. Rango típico para un despacho pequeño: **25–60 €/mes**.
2. **Por comunidad o unidad (SaaS moderno):** Fynkus desde 2,5 €/comunidad/mes (0,10 €/unidad); VecinApp 2–6 €/comunidad/mes (mínimo 40–120 €); Onzane 7–10 €/comunidad/mes; TownSq 90–435 $/comunidad/mes.
3. **Por vivienda, pagado por la comunidad:** Onzane 1–2 €/vivienda/año con tope; TusVecinos 2–4 €; Comunix 9 €; Unitify 0–36 €; Colindar ~0,27–0,43 €/vivienda/mes.
4. **Licencia anual por comunidad:** ResidenciAPP 275–425 €; Colindar 163–385 € más complementos; Plusvecinos 0 / 300 / 540 €/año.
5. **Precio opaco, con demo y presupuesto:** Gesfincas, ADMINET, TAAF, Ciudadela, C365, comunicasa en España. Son los que tienen canal o servicio humano detrás.
6. **Servicio más software (administrador digital):** Supervecina, entre 4 y 9 €/vivienda/mes; Matera ~135–200 €/lote/año.
7. **Ingresos complementarios:** comisiones de pago (Buildium, PayHOA, ComunidadFeliz), cuentas o banca (TucoBan, Unibo, Superlógica), seguros (Pragma+, Matera), créditos de IA (Colindar, Unitify, PayHOA Gable), firma o certificados (VecinApp, TAAF).

**Comparativa para una comunidad de 30 viviendas pagada por la propia comunidad (€/año sin IVA, cálculo propio):** Onzane Basic 30 / Pro 60 · TusVecinos 60–120 · Colindar 163–260 · Comunix 270 · ResidenciAPP 275 · Plusvecinos 300–540 · Unitify Base 360 · Supervecina ≥ 1.080.

**Patrones de go-to-market**
- **Incumbentes:** venta directa, demos, formación obligatoria, eventos (SIMA, DomusWeek) y canal colegial (IDS, C365/CAFportal, comunicasa).
- **Nuevos:** SEO masivo con páginas «vs» y «migrar desde» (VecinApp, Ciudadela, Supervecina, PayHOA), freemium y autoservicio (Onzane, Fynkus, Unitify, Plusvecinos), y migración gratuita desde Gesfincas como gancho (FincasPro, VecinApp).
- **El Kit Digital** aparece como argumento comercial en VecinApp, TAAF, IDS y Fynkus.
- **El vecino casi nunca paga:** la app es gratuita y paga el despacho o la comunidad.

---

## 7. Stack tecnológico y madurez

| Nivel | Competidores | Implicación |
|---|---|---|
| **Escritorio Windows o red local heredado** | Gesfincas.Net, Cegid Finca3, NetFincas (escritorio), FincasPlus Elite, TAAF (parcial), ADMINET (probable) | Muy fuertes en contabilidad y fiscalidad, muy débiles en experiencia móvil y web. Costes de cambio altos. |
| **Web heredada (PHP clásico, jQuery, JSF, Angular antiguo)** | FincasPro, FincasPlus, Plusvecinos (Symfony 2), Fynkus (a medio migrar a Vue), C365 (CRA), TuAdministrador (Angular 12), Neivor (JSF) | Deuda técnica visible. Iteran despacio. |
| **Cloud moderno** | VecinApp (React/Supabase), Ciudadela (Next.js/GCP), Onzane (Laravel/Livewire), Comunix (React/Railway), ADCOMUNIDAD (Next.js), Supervecina (Angular 19), Unitify (Next.js) | Este es el terreno de competencia de gobernança. |
| **Mobile-first o apps nativas cuidadas** | ResidenciAPP (Expo), TusVecinos, Onzane, TownSq, ComunidadFeliz (RN), Buildium, Superlógica | El vecino espera app con push. Las notas en tienda son una prueba social visible. |

**Observaciones:**
- **gobernança (Vue 3 + Firebase)** está en el grupo moderno y ya es una **PWA instalable** (push web, apertura sin conexión, aviso de nueva versión), pero **no tiene app en tienda**. PayHOA demuestra que se puede escalar sin app nativa (más de 6.000 comunidades), aunque en España casi todos los competidores del vecino están en las tiendas. El siguiente paso es envolver la PWA (TWA en Google Play, Capacitor en la App Store), con el coste de las cuentas de desarrollador.
- **IA:** ya está en producción en más de la mitad de los competidores (OCR de facturas, agentes de voz y WhatsApp, Copilot). gobernança cubre lo básico sin coste ni envío de datos (clasificar incidencias, resumir hilos, redactar avisos y pulir actas) con los modelos del navegador y, donde no los hay, con reglas y plantillas propias. Un agente conversacional u OCR de facturas necesitaría un modelo en servidor, con coste.
- **Restricción del plan gratuito de Firebase:** limita lecturas y escrituras y, según cambios recientes de Google, posiblemente también Cloud Storage para buckets nuevos. Esto último **no lo he verificado en este informe**; hay que comprobarlo antes de añadir documentos o fotos a escala. Condiciona funciones como el almacén de documentos o las incidencias con fotos.

---

## 8. Matrices de posicionamiento

### Matriz 1. Orientación (X) frente a modernidad tecnológica (Y)

- **Eje X:** 0 = solo administrador profesional (back office); 10 = vecino o comunidad autogestionada. Criterio: quién contrata y quién es el usuario principal.
- **Eje Y:** 0 = escritorio heredado sin móvil; 10 = cloud moderno con apps bien valoradas y cadencia alta. Criterio: stack observado, presencia en tiendas y frecuencia de versiones.

| Actor | X | Y | | Actor | X | Y |
|---|---|---|---|---|---|---|
| **gobernança** | **5** | **7** | | Comunix | 4 | 7 |
| Gesfincas | 1 | 3 | | ResidenciAPP | 8 | 7 |
| TucomunidApp | 4 | 5 | | Plusvecinos | 9 | 3 |
| ADMINET | 1 | 3 | | TusVecinos | 8 | 6 |
| TAAF | 1 | 3 | | Comunidad 365 | 5 | 4 |
| Fynkus | 2 | 5 | | Supervecina | 7 | 6 |
| ADCOMUNIDAD | 2 | 6 | | comunicasa | 2 | 8 |
| Ciudadela | 3 | 7 | | Unitify | 5 | 6 |
| VecinApp | 2 | 7 | | ComunidadFeliz | 4 | 8 |
| Onzane | 5 | 7 | | Matera | 8 | 8 |
| Colindar | 8 | 5 | | Vantaca | 1 | 7 |
| NetFincas | 1 | 2 | | TownSq | 5 | 8 |
| Cegid Finca3 | 0 | 1 | | Buildium | 2 | 7 |
| FincasPro | 2 | 3 | | PayHOA | 9 | 6 |
| FincasPlus | 2 | 2 | | Superlógica | 3 | 8 |
| FincasPlus Elite/TuAdmin | 2 | 3 | | Neivor | 4 | 7 |
| Danea | 1 | 3 | | | | |

**Cuadrantes:**
- *Administrador + heredado* (X<5, Y<5): Gesfincas, ADMINET, TAAF, NetFincas, Finca3, FincasPro, FincasPlus, IDS. Son los incumbentes. Su punto débil es el vecino.
- *Administrador + moderno* (X<5, Y≥5): VecinApp, Ciudadela, Fynkus, ADCOMUNIDAD, comunicasa, Comunix. Es la zona más disputada entre los nuevos.
- *Vecino + heredado* (X≥5, Y<5): Plusvecinos y C365. Productos en declive o que viven del canal.
- *Vecino + moderno* (X≥5, Y≥5): ResidenciAPP, TusVecinos, Colindar, PayHOA, Matera. Son productos de nicho sin panel de administración serio.
- **Hueco:** el centro-alto (X 4-6, Y 7-9), un producto **dual, moderno y bien valorado por el vecino que además sirve al despacho**, solo lo ocupan de verdad TownSq (fuera de España) y en parte Onzane, con apps de 3,6–3,9★ y un producto complejo. Ahí debería estar gobernança.

### Matriz 2. Amplitud funcional (X) frente a accesibilidad de precio y simplicidad (Y)

- **Eje X:** 0 = una sola función; 10 = suite completa (contabilidad, fiscalidad, pagos, vecino, IA). Criterio: número de ✅ en la matriz de funcionalidades, ponderado.
- **Eje Y:** 0 = precio opaco, caro o con onboarding pesado; 10 = precio público bajo, autoservicio o freemium. Criterio: transparencia, importe y fricción de alta.

| Actor | X | Y | | Actor | X | Y |
|---|---|---|---|---|---|---|
| **gobernança (hoy)** | **9** | **8\*** | | Comunix | 3 | 8 |
| Gesfincas | 10 | 2 | | ResidenciAPP | 5 | 7 |
| TucomunidApp | 7 | 3 | | Plusvecinos | 5 | 8 |
| ADMINET | 8 | 2 | | TusVecinos | 6 | 9 |
| TAAF | 8 | 2 | | Comunidad 365 | 6 | 2 |
| Fynkus | 7 | 9 | | Supervecina | 7 | 6 |
| ADCOMUNIDAD | 8 | 6 | | comunicasa | 6 | 2 |
| Ciudadela | 9 | 2 | | Unitify | 7 | 9 |
| VecinApp | 8 | 8 | | ComunidadFeliz | 9 | 2 |
| Onzane | 9 | 8 | | Matera | 8 | 3 |
| Colindar | 4 | 7 | | Vantaca | 9 | 1 |
| NetFincas | 7 | 9 | | TownSq | 7 | 6 |
| Cegid Finca3 | 4 | 6 | | Buildium | 8 | 6 |
| FincasPro | 7 | 7 | | PayHOA | 7 | 8 |
| FincasPlus | 4 | 8 | | Superlógica | 10 | 1 |
| FincasPlus Elite/TuAdmin | 8 | 5 | | Neivor | 7 | 2 |
| Danea | 8 | 6 | | | | |

\*gobernança no tiene precio todavía. El 8 refleja la intención de un precio público y bajo, no un dato.

**Cuadrantes:**
- *Amplio y caro u opaco* (arriba a la derecha del eje X, abajo en Y): incumbentes, Ciudadela, C365 y los benchmarks con fintech.
- *Amplio y accesible:* Onzane, VecinApp, Fynkus, NetFincas, Unitify. **Es el cuadrante más peligroso: amplitud a precio bajo.** Gobernança no puede ganar aquí por número de funciones.
- *Estrecho y accesible:* Comunix, FincasPlus, Colindar, ResidenciAPP y Plusvecinos. gobernança ha pasado de ahí (6, 8) a *amplio y accesible* (9, 8) con contabilidad, SEPA y AEAT, el cierre legal de la junta, la importación del censo, la PWA y las sugerencias automáticas; le faltan los cobros reales y la app en tienda para llegar a 10. La competencia es por precio, y TusVecinos (2 €/vivienda/año) y Onzane Free empujan el precio a cero.
- **Hueco:** en el eje X no hay un hueco de amplitud. El hueco está en una **tercera dimensión que la matriz no recoge: calidad de experiencia y fiabilidad**. Casi todos los productos amplios y baratos tienen apps de 2–3,9★. La propuesta defendible es la amplitud de un ERP con la mejor experiencia del mercado y un precio público simple.

---

## 9. Posicionamiento recomendado para gobernança

### 9.1 Posicionamiento

> **«El ERP completo para despachos pequeños y medianos, con contabilidad, SEPA, AEAT y banca, y la mejor app del vecino del mercado, más un plan gratuito para comunidades sin administrador.»**

- **Competir de tú a tú con los ERP** (Gesfincas, ADMINET, TAAF, NetFincas, Fynkus): contabilidad por partida doble con cierre, remesas y transferencias SEPA, conciliación Norma 43, modelos 347/111/190/184 y liquidación para la junta ya existen. Un despacho puede llevar una comunidad entera sin otro programa.
- **Coste de plataforma cero:** todo corre en el navegador. Lo que cuesta dinero (pasarela de tarjeta y Bizum, agregador PSD2, presentación en la AEAT con certificado y envío de Verifactu, correo certificado y burofax, envío de emails) está en modo de prueba de punta a punta y se activa con un proveedor de pago cuando haya ingresos que lo cubran.
- **Riesgo regulatorio asumido y acotado:** los ficheros AEAT siguen los diseños de registro oficiales, pero hay que validarlos en la Sede antes de venderlos como listos; Verifactu solo afecta a los honorarios del despacho.
- **Ser neutral frente a los despachos**, al contrario que Ciudadela o Supervecina. gobernança no les quita clientes.
- **Migrar o convivir:** importar el censo (comunidades, propiedades, propietarios, coeficientes y mandatos SEPA) y la deuda de cada propiedad desde el Excel o CSV de otro programa, y exportar el diario a ContaPlus y a Excel, para entrar aunque el despacho no cambie de ERP el primer día.
- **Por el lado del vecino,** competir contra el 2,1★ de TucomunidApp y TuAdministrador con un acceso sin fricción (el enlace mágico es una ventaja frente al «no puedo registrarme», que es una queja recurrente) y una experiencia cuidada.

### 9.2 Huecos, por prioridad

Cada hueco tiene un identificador estable (`FUN-1`, `DAT-2`, `MON-1`…) para referirse a él en conversaciones, issues y commits. Los identificadores no se reutilizan ni se renumeran: al cerrar un hueco, su fila sale de la tabla y su identificador pasa a la lista de cerrados con la fecha.

| Grupo | Qué recoge | Dónde |
|---|---|---|
| **FUN** | Funciones que tiene la competencia y aquí faltan o están en modo de prueba | Abajo |
| **INF** | Infraestructura y coste de operar | Abajo |
| **DAT** | Modelo de datos para clientes reales | Abajo |
| **GAR** | Garantías sobre los datos | Abajo |
| **VAL** | Validación oficial y cobertura del mercado | Abajo |
| **EMP** | Empresa y requisitos legales para poder vender | Abajo |
| **MON** | Monitorización: ver los fallos antes que el cliente | [fiabilidad.md](fiabilidad.md) |
| **ROB** | Robustez: evitar los fallos y recuperarse de ellos | [fiabilidad.md](fiabilidad.md) |

**Cerrados:**
- **02/11/2026:** MON-1, MON-2, MON-3 y MON-8. Los errores de las dos apps llegan al propio Firestore agrupados, con la versión, la pantalla y lo que hizo el usuario antes; los urgentes salen primero en la página «Errores» del admin, solo para el equipo; y las dos apps avisan cuando se agota la cuota.
- **01/11/2026, sin identificador:** cierre legal de la junta (firma, sellado, notificación con acuse y art. 17.8), importación del censo y de comunidades, PWA instalable, correo saliente en modo de prueba, parte de trabajo para el gremio, sugerencias y redacción automática, comprobación de ficheros, devoluciones SEPA importadas, abonos de la pasarela en la conciliación, entregas a cuenta e intereses de demora.

#### Funcionales (FUN)

Lo que queda depende sobre todo de contratar proveedores o de un servidor.

| ID | Prioridad | Función | Por qué | Referencia |
|---|---|---|---|---|
| FUN-1 | P0 | **Activar los cobros reales**: pasarela de tarjeta y Bizum (Stripe Connect o Redsys) a una cuenta de la comunidad | Recibos, entregas a cuenta y reservas con fianza ya se pagan de punta a punta en modo de prueba, y los abonos de la pasarela ya se concilian; falta el proveedor y un servidor que confirme cada pago (INF-1) | ResidenciAPP, Onzane, Colindar |
| FUN-2 | P0 | **Activar el envío real del correo** (extensión Trigger Email con un proveedor SMTP) | Invitaciones, convocatorias, actas, partes de trabajo y reclamaciones ya quedan en el correo saliente con el formato de la extensión; enviarlos necesita el plan de pago de Firebase (INF-1) | Todos |
| FUN-3 | P1 | **App en tiendas**: envolver la PWA (TWA en Google Play, Capacitor en la App Store) | La PWA ya se instala; las notas en tienda son la prueba social del sector. Las cuentas de desarrollador tienen coste | Onzane, TownSq |
| FUN-4 | P1 | **Notificación fehaciente y firma reales del acta** (correo certificado o burofax de un prestador cualificado, firma avanzada) | La firma electrónica simple, el sellado con huella y el acuse en la app ya existen; el canal certificado está en modo de prueba | C365, Plusvecinos (Namirial), VecinApp |
| FUN-5 | P2 | **Conexión bancaria real** (agregador PSD2) y envío de Verifactu a la AEAT con el certificado del despacho | La conciliación y el registro encadenado ya existen; necesitan un proveedor de pago y un servidor, fuera del plan gratuito (INF-1) | Fynkus, Gesfincas, VecinApp |
| FUN-6 | P2 | **Recordatorios automáticos** (vencimientos de obligaciones y recibos, juntas) por email y push | Necesitan tareas programadas en un servidor (INF-1); hoy se avisan en el panel y en el calendario exportado | Gesfincas, Onzane |
| FUN-7 | P3 | **Burofax real** | Hoy es simulado, con justificante de prueba | ADMINET, TAAF |

#### Para ser una alternativa seria (INF, DAT, GAR, VAL, EMP)

En funciones gobernança ya está a la altura del mercado (sección 8). Lo que falta es lo que hace que un despacho le confíe dinero real y obligaciones legales. Revisado en el código el 02/11/2026.

| ID | Prioridad | Hueco | Situación hoy | Qué hace falta |
|---|---|---|---|---|
| INF-1 | P0 | **Plan de pago de Firebase (Blaze) con un servidor mínimo** | Las cuotas del plan gratuito son por proyecto y las comparten todos los clientes: 50.000 lecturas, 20.000 escrituras y 20.000 borrados al día, y 1 GiB guardado. Al agotarse, la app falla para todos hasta que se reinicia la cuota, hacia las 9:00 en la España peninsular. Sin servidor, un pago lo da por bueno el navegador del vecino, y no hay correo, recordatorios ni copias programadas | Pasar a Blaze con el primer cliente real: conserva la misma cuota gratuita y solo cobra lo que la supere. Alerta de presupuesto desde el primer día. Desbloquea FUN-1, FUN-2, FUN-5, FUN-6 y ROB-2 |
| INF-2 | P1 | **Lecturas por pantalla** | Cada recibo, asiento o movimiento es un documento. Estimación propia: abrir las finanzas de todas las comunidades de un despacho mediano puede leer decenas de miles de documentos. En desarrollo, la consola ya muestra lo que lee cada pantalla (MON-3) | Medir las pantallas que más leen y servir los totales desde documentos resumen en vez de leer cada recibo. Con Blaze, cada lectura es coste |
| DAT-1 | P1 | **Un usuario en varias comunidades** | Cada perfil tiene una sola comunidad (`communityId`) y las reglas dependen de ella | Un propietario con el piso en una comunidad y la plaza de garaje en otra, o un inversor con varias, elige la comunidad activa. Permisos y reglas dejan de depender de una sola comunidad |
| DAT-2 | P1 | **Despacho con empleados y permisos** | El despacho es una persona: cada administrador tiene su propia lista de comunidades y su ficha (`offices/{uid}`) | Un despacho con varios usuarios que comparten cartera, facturación y ficha, y permisos por función (titular, contable, gestor, solo lectura) |
| GAR-1 | P2 | **Registro de cambios completo** | Cada comunidad tiene un registro de actividad (quién, cuándo y un resumen) que no se puede editar ni borrar y que se escribe en el mismo lote que el cambio, también al reabrir un ejercicio. Pero las reglas no lo exigen (un cambio hecho fuera de la app no deja rastro), no guarda los valores de antes y después, y no recoge lo que hacen los vecinos, como sus pagos | Que las reglas exijan la entrada de actividad en las escrituras de finanzas y contabilidad, guardar los valores anteriores en lo que mueve dinero y registrar también los pagos de los vecinos |
| GAR-2 | P2 | **Exportación completa de una comunidad** | Se exportan el diario (ContaPlus, CSV) y los ficheros oficiales | Todos los datos de una comunidad en formatos abiertos: portabilidad del RGPD y respuesta a «¿y si me voy?» |
| GAR-3 | P1 | **Fotos y documentos privados y en la UE** | Las fotos se suben a Cloudinary con un preset sin firmar (cualquiera con la configuración puede subir) y quedan en URL públicas, probablemente fuera de la UE. Los documentos se guardan dentro de documentos de Firestore (máximo 1 MiB) | Almacenamiento con acceso controlado y alojado en la UE: Cloud Storage con Blaze, o Cloudinary con entrega autenticada y región UE |
| VAL-1 | P1 | **Validar los ficheros fiscales y bancarios** en la Sede de la AEAT y en un banco real (347, 190, 184, pain.008, pain.001, XDiario de ContaPlus) | Se generan según los diseños oficiales y se comprueban antes de descargarlos, pero ninguno se ha presentado aún | Presentarlos con datos reales del piloto (EMP-4). Los ficheros aceptados pasan a ser casos de prueba (ROB-3) |
| VAL-2 | P3 | **Territorios forales** | No hay modelos forales (Bizkaia, Gipuzkoa, Álava, Navarra) ni TicketBAI | Sus modelos equivalentes, y TicketBAI para los honorarios del despacho |
| VAL-3 | P2 | **Idiomas cooficiales** | Todo está en castellano, sin sistema de traducción | Catalán primero (solo Barcelona-Lleida tiene unos 2.400 colegiados), luego gallego y euskera. Como mínimo, la webapp del vecino y las comunicaciones |
| EMP-1 | P0 | **Sociedad y aviso legal** | La página legal de la webapp no identifica al titular del servicio | Sociedad (o alta de autónomo) con NIF, domicilio y contacto en el aviso legal, como exige la LSSI |
| EMP-2 | P0 | **Documentación RGPD para el despacho** | No existe | Contrato de encargado del tratamiento (art. 28 RGPD) para firmar con cada despacho, lista de subencargados (hoy Google y Cloudinary; la monitorización propia no añade ninguno) y registro de actividades de tratamiento |
| EMP-3 | P1 | **Precio, soporte y migración** | No hay precio ni canal de soporte | Precio publicado (sección 9.5), un canal de soporte con tiempo de respuesta comprometido y migración asistida con la importación del censo |
| EMP-4 | P0 | **Piloto real** | Ningún usuario en producción | 1 o 2 despachos con 5–10 comunidades durante un ejercicio completo: cuotas, remesa, devoluciones, junta, acta, cierre y 347 presentado |

#### Fiabilidad (MON, ROB)

Detallados, con cómo hacerlos en este código, en [fiabilidad.md](fiabilidad.md). Sin servicios externos nuevos: los errores se guardan en el propio Firestore y se consultan en un panel del admin. Los P0, antes del piloto (EMP-4):

| ID | Prioridad | Hueco |
|---|---|---|
| ROB-1 | P0 | Entorno de pruebas separado: hoy las previews de cada PR usan la base de datos de producción |
| ROB-2 | P0 | Copias de seguridad con restauración ensayada |

### 9.3 Diferenciadores defendibles

1. **Experiencia del vecino y fiabilidad:** acceso por enlace mágico y una interfaz estable. Medible en las notas de las tiendas o en el NPS en cuanto haya app o PWA.
2. **Doble cara con un mismo modelo de datos:** panel de despacho (búsqueda transversal de comunidades y vecinos, dashboard por comunidad, ficha fiscal) y webapp del vecino. Las apps de comunidades autogestionadas no tienen lo primero y los ERP no tienen lo segundo bien hecho.
3. **ERP y vecino en un solo producto:** los cobros, la contabilidad y los modelos fiscales comparten datos con la app del vecino (sus recibos, pagos y reservas), y se puede convivir con el ERP actual exportando a ContaPlus mientras se migra.
4. **La junta de punta a punta:** convocatoria notificada, voto ponderado y delegación, acta firmada y sellada, acuse de cada propietario y cómputo de los ausentes del art. 17.8 LPH, sin coste.
5. **Precio público y simple** en un mercado donde los líderes no publican precios.
6. **Ámbito español** (LPH, español, operación local), frente a Unitify, comunicasa y los benchmarks.

### 9.4 Riesgos

- **Onzane y VecinApp** suman amplitud y precio bajo; si mejoran su experiencia, se cierra el hueco.
- **Canal colegial cerrado:** CAFcomunidad (CGCAFE), IDS y comunicasa (Las Palmas).
- **Que un incumbente modernice su app del vecino** (Aareon tiene capital y stack Angular/Ionic) o que haya consolidación (Aareon, Visma, TeamSystem, Cegid).
- **Monetizar comunidades autogestionadas es difícil:** TusVecinos factura unos 5,8 k€/año con un producto completo.
- **Recursos:** proyecto de una persona con el plan gratuito de Firebase (INF-1), y un problema de credibilidad ante los despachos (como le pasa a ResidenciAPP, que también es una persona física). Conviene constituir una sociedad o, al menos, publicar un aviso legal completo antes de vender (EMP-1).
- **Juntas telemáticas sin ley aprobada:** hay que construir el voto con un aviso claro sobre su validez legal. El acta lleva firma electrónica simple: sirve como prueba, pero no equivale a una firma cualificada ni a una notificación fehaciente de un prestador de confianza mientras ese canal siga en modo de prueba.
- **Ficheros oficiales sin validar (VAL-1):** un error en un 347, una remesa o un asiento cuesta la confianza del despacho. Hay que validarlos con la AEAT y con bancos reales antes de venderlos, y vigilar los cambios anuales de diseño de registro.
- **Fiabilidad operativa:** los errores ya llegan al panel del equipo, pero no hay dónde probar un cambio antes de producción, porque las previews de cada PR apuntan a la base de datos real (ROB-1), no hay copias de seguridad (ROB-2), y agotar la cuota gratuita, que comparten todos los clientes, deja a todos sin servicio hasta la mañana siguiente (INF-1), aunque ahora las dos apps lo avisan. Un despacho que pierde un día de trabajo o un dato no vuelve.

### 9.5 Estrategia de precio y go-to-market sugerida (propuesta, a validar)

- **Plan Comunidad (autogestionada):** gratis hasta unas 20–30 viviendas, con incidencias, tablón, reservas sin pago y documentos limitados. Plan de pago entre 2 y 3 €/vivienda/año con juntas, voto y pagos de reservas. Queda entre Onzane y TusVecinos y por debajo de ResidenciAPP y Plusvecinos.
- **Plan Despacho:** sin mínimo de 20 comunidades (es el hueco que deja VecinApp), entre 2 y 4 €/comunidad/mes, o una tarifa plana de 29–49 €/mes hasta N comunidades. Prueba de 30 días sin tarjeta. Primeros despachos con precio de fundador (como hace Comunix).
- **Ingresos complementarios más adelante:** comisión en pagos de reservas y créditos de IA, con tope de gasto (como Unitify).
- **Go-to-market:**
  - SEO con contenido legal LPH (cómo convocar una junta, mayorías, derramas, juntas telemáticas), en la línea de PayHOA y Supervecina.
  - Páginas de «alternativa a TucomunidApp» y de «complemento a Gesfincas/Fynkus/NetFincas».
  - Migración asistida gratuita.
  - Entrada por presidentes de comunidades autogestionadas como canal de abajo arriba hacia su administrador.
  - Más adelante, explorar un colegio territorial no cubierto por CAFportal.

---

## 10. Metodología, limitaciones y fuentes

**Metodología.**
- Se sintetizan 32 perfiles de competidores verificados a 30/10/2026: fichas de App Store y Google Play, webs oficiales, cabeceras HTTP y bundles, registros mercantiles (infonif, infoempresa, Äriregister, Receita Federal, recherche-entreprises), prensa y directorios.
- Se han hecho búsquedas propias para el tamaño del mercado español y la regulación (LPH y Verifactu).
- Las coordenadas de las matrices y la clasificación ✅/◐/❌ son **valoraciones propias** a partir de los perfiles, no mediciones.

**Limitaciones.**
- Casi todas las cifras de tracción las declara la propia empresa y algunas no cuadran con los datos financieros (TusVecinos, ADMINET, Unitify).
- La mayoría de precios de los incumbentes no se publican.
- Muchas notas de Google Play se extrajeron del HTML con ambigüedad.
- No hay censo oficial de comunidades de propietarios ni cifra nacional actualizada de administradores colegiados; las que se dan son estimaciones del sector de 2020–2024.
- Las fechas de Verifactu proceden de prensa especializada y no se han contrastado con el BOE.
- La situación de la reforma de la LPH sobre juntas telemáticas puede haber cambiado después de mayo-junio de 2026.
- Las funcionalidades de gobernança se han contrastado con el código del repositorio (módulos de admin y webapp), no con un uso real en producción.
- Los límites del plan gratuito de Firebase sobre Storage no se han verificado.

**Fuentes de mercado y regulación (búsquedas propias):**
- [CGCAFE, Revista nº 193](https://cgcafe.org/wp-content/uploads/2024/12/Revista-193.pdf): más de 1.000.000 de comunidades, 80 % gestionadas por colegiados.
- [CAFMadrid, nota de prensa 2020](https://cafmadrid.es/wp-content/uploads/2020/04/NP-Medidas-Gobiernos-central-autonomico-y-local.pdf) y [nota sobre reuniones de propietarios](https://cafmadrid.es/wp-content/uploads/2020/09/Nota-de-prensa-CAFMadrid-reuniones-de-propietarios.pdf).
- [elderecho.com, colegiación obligatoria](https://elderecho.com/los-administradores-de-fincas-piden-al-gobierno-la-colegiacion-obligatoria-para-frenar-la-competencia-desleal): unos 15.600 colegiados.
- [Comunidad de Madrid, sello Madrid Excelente al CAF Madrid](https://www.comunidad.madrid/node/54072); [educaweb, CAF Barcelona-Lleida](https://www.educaweb.com/centro/col-legi-administradors-finques-barcelona-lleida-48507/).
- [CGCAFE, juntas telemáticas aprobadas en el Senado](https://cgcafe.org/wp-content/uploads/2025/02/NP-APROBACION-JUNTAS-TELEMATICAS-PLENO-SENADO-13.02.pdf); [El Español, 03/06/2026](https://www.elespanol.com/sociedad/20260603/oficial-congreso-da-primer-paso-regular-juntas-telematicas-comunidades-vecinos/1003744261262_0.amp.html); [El Debate, 28/05/2026](https://www.eldebate.com/tecnologia/20260528/juntas-vecinos-digitalizan-expertos-alertan-no-todos-podran-seguirlas_422226.html); [CAFMadrid, un año de la LO 1/2025](https://cafmadrid.es/wp-content/uploads/2026/05/Un-ano-de-la-LO-1_2025-una-referencia-util-para-la-practica-colegial-en-propiedad-horizontal.pdf); [idealista](https://www.idealista.com/news/node/832200).
- Verifactu: [Legal Today](https://www.legaltoday.com/actualidad-juridica/noticias-de-derecho/nueva-prorroga-verifactu-no-sera-obligatorio-hasta-2027-para-sociedades-y-otros-contribuyentes-2025-12-04/), [Infoautónomos](https://www.infoautonomos.com/blog/verifactu-cuando-es-obligatorio-a-quien-afecta/), [Captain Legal](https://www.captain.legal/es/blog/verifactu-calendario-sociedades-autonomos/), [Conversoria](https://www.conversoriaecnae.es/guia/verifactu/plazos-2027).

**Fuentes primarias de competidores (selección; la lista completa está en cada perfil):**
- *Gesfincas / TucomunidApp:* [iesa.es/gesfincas](https://iesa.es/digitalizar-tu-despacho/plataforma-tecnologica/gesfincas), [tucoban.com/tarifas](https://www.tucoban.com/home/tarifas), [App Store TucomunidApp](https://apps.apple.com/es/app/id1485583697).
- *ERP españoles:* [pragma.es](https://pragma.es/), [taaf.es](https://taaf.es/), [Fynkus precios](https://www.fynkus.es/presupuesto-administrador-fincas/), [adcomunidad.es](https://adcomunidad.es), [ciudadela.eu](https://ciudadela.eu), [vecinapp.es](https://vecinapp.es), [NetFincas precios](https://www.netfincas.com/precios-horizontal.html), [Cegid Finca3](https://www.cegid.com/ib/es/productos/programa-administracion-fincas/), [FincasPro tarifas](https://fincaspro.es/tarifas-fincaspro/), [FincasPlus tarifas](https://fincasplus.es/tarifas.php), [FincasPlus Elite](https://www.idsplus.net/productos/fincasplus-elite/), [Comunix precios](https://www.comunix.es/precios).
- *Vecino y comunidades autogestionadas:* [Onzane administraciones](https://onzane.com/precios/administraciones), [Colindar precios](https://colindar.com/precios), [residenciapp.com](https://residenciapp.com), [Plusvecinos precios](https://www.plusvecinos.com/precios/), [TusVecinos tarifas](https://tusvecinos.es/tarifas/), [Äriregister QCGA OÜ](https://ariregister.rik.ee/est/company/16506233/QCGA-OÜ), [cafportal.es](https://cafportal.es/), [supervecina.com](https://supervecina.com/plan-supervecina/), [comunicasa.es](https://www.comunicasa.es), [unitify.com/spain](https://unitify.com/spain).
- *Benchmarks:* [Oaklins, ComunidadFeliz](https://www.oaklins.com/ch/en/deals/111533/), [recherche-entreprises, Matera](https://recherche-entreprises.api.gouv.fr/search?q=825188576), [Vantaca FAQ](https://www.vantaca.com/vantaca-faq), [TownSq precios](https://townsq.io/pricing), [Buildium precios](https://www.buildium.com/pricing/), [PayHOA precios](https://www.payhoa.com/pricing/), [BrasilAPI Superlógica](https://brasilapi.com.br/api/cnpj/v1/04833541000151), [Mastercard/Neivor](https://www.mastercard.com/news/latin-america/es/sala-de-prensa/comunicados-de-prensa/pr-es/2026/junio/getnet-mastercard-y-neivor-realizan-en-mexico-la-primera-operacion-de-comercio-agentico), [Danea Domustudio](https://www.danea.it/software/domustudio/).
