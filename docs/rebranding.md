# Rebranding: nombre y logo nuevos

Cambian el nombre y el logo. Colores (`#094067` azul marino, `#DF635B` coral), tipografías y estilo se quedan igual.

En este documento, `<Nombre>` es la marca tal como se escribe, `<slug>` su versión en minúsculas sin tildes ni caracteres especiales (para dominios, identificadores y carpetas) y `<dominio>` el dominio nuevo.

Hoy el nombre aparece de tres formas, y conviene que el nuevo solo tenga dos (`<Nombre>` y `<slug>`):

| Forma | Dónde |
|---|---|
| `gobernança` | Todo lo que se ve: pantallas, títulos, correos, manifest, landing, docs |
| `gobernansa` | Código y servicios: paquetes npm, proyecto de Firebase, dominios, GitHub, copias de seguridad |
| `gobernanza` | Solo en `docs/v1.md`, como la forma en que lo buscaría un administrador |

---

## 0. Lo que necesito de ti

### Decisiones

| # | Decisión | Hoy | Dónde se usa |
|---|---|---|---|
| D1 | **Nombre escrito exacto**, con mayúsculas o no | `gobernança` (en minúsculas) | Todo lo visible |
| D2 | **Slug** en ASCII | `gobernansa` | Dominio, npm, IDs nuevos de Firebase, GitHub, carpetas |
| D3 | **Nombre corto de la webapp** en la pantalla de inicio, 12 caracteres como mucho (iOS corta el resto) | `gobernança` | `manifest.webmanifest`, `apple-mobile-web-app-title` |
| D4 | **Nombre del admin**, largo y corto (12 caracteres) | `gobernança admin` / `gob. admin` | Manifest, pestaña, botón de instalar, correos de invitación |
| D5 | **Dominio y subdominios** | `gobernansa.dmoya.dev`, `admin.gobernansa.dmoya.dev` | Propuesta: `<dominio>` → landing, `app.` → webapp, `admin.` → admin, `demo.` y `demo-admin.` → demo |
| D6 | **Correos**: contacto (aviso legal), remitente (`no-reply@`) y soporte | `no-reply@gobernansa.dmoya.dev` (previsto) | `legal.ts`, plantillas de Auth, Trigger Email ([B2](v1.md#b2)) |
| D7 | **Siglas de 2 caracteres** del sistema para Verifactu | `GB` | `verifactu.ts` |
| D8 | **Cuánto tiempo redirigir** el dominio viejo | — | Recomendado: un año como mínimo |

### Assets

Todos en SVG vectorial: texto convertido a trazos (sin `<text>`), sin imágenes incrustadas ni máscaras, fondo transparente y recortado al contenido, sin márgenes.

| # | Asset | Especificaciones | Dónde va |
|---|---|---|---|
| A1 | **Logo horizontal a color** | Texto en `#094067`, isotipo en `#DF635B` (o los colores de marca que lleve). El actual mide 1108×234 (4,7:1); si cambia la proporción, ajusto los tamaños | `packages/shared/assets/logo.svg` y `apps/landing/img/logo.svg`: cabecera y login de las dos apps, parte de trabajo del proveedor y landing (3 veces) |
| A2 | **Logo horizontal de noche** | El mismo, con el texto en `#FFFFFF` y el isotipo igual | `apps/landing/img/logo-night.svg` (la landing al pasar sobre el edificio) |
| A3 | **Isotipo solo** | `viewBox` cuadrado, **un solo color**, solo `<path>` con relleno (los trazos convertidos a contorno), legible a 24 px. Lo pinto con el color de cada sitio (`currentColor`) | `packages/shared/ui/IsotypeSVG.vue`: pestaña Inicio, barra superior en móvil, aviso de instalar, marca de agua del perfil y de la tarjeta de la comunidad. Y la base de todos los iconos |
| A4 | *(Opcional)* Isotipo simplificado para 16 px | Solo si el isotipo tiene detalles finos que se pierden en pequeño | `favicon.ico` |
| A5 | *(Opcional)* Imagen para compartir | 1200×630 JPG | Si no me la das, la genero yo con el mismo diseño de ahora: degradado azul marino, isotipo y nombre en blanco y «Gestión de comunidades de vecinos» |

**Lo que genero yo** a partir de A1–A3, para cada app:

| Fichero | Tamaño | Webapp | Admin |
|---|---|---|---|
| `icon-192.png`, `icon-512.png` | 192, 512 | Isotipo blanco sobre degradado azul marino | Isotipo coral sobre gris claro |
| `icon-maskable-512.png` | 512, isotipo dentro del 80 % central | Igual | Igual |
| `apple-touch-icon.png` | 180, opaco | Igual | Igual |
| `favicon.ico` | 16, 32 y 48 | Igual en las dos | Igual en las dos |
| `og-image.jpg` | 1200×630 | Si no hay A5 | Si no hay A5 |

**Capturas que hay que repetir** después del cambio de código, porque salen con el logo viejo (tutorial T14):

| Fichero | Tamaño | Qué muestra |
|---|---|---|
| `apps/landing/img/cartera.png` | 800×500 | Admin, Panel de cartera, con el despacho de 40 comunidades |
| `apps/landing/img/vecino.jpg` | 390×800 | Webapp, inicio del Piso 1A |

El `README.md` enlaza `apps/webapp/public/screenshot.png` y `screenshot.gif`, que no están en el repo: o se rehacen, o el README pasa a usar estas dos capturas.

---

## 1. Lo que no se puede cambiar

| Qué | Por qué | Qué hacemos |
|---|---|---|
| ID del proyecto de Firebase `dmoyadev-gobernansa` | Firebase no deja cambiarlo nunca | Se queda. Solo se ve en `*.web.app`, `*.firebaseapp.com`, el remitente de los correos de acceso y las URLs de las fotos, porque el bucket de Storage lleva el ID (sus carpetas, `issues/` y `workOrders/`, no llevan la marca). Con dominios propios (T5) y el remitente personalizado (T4) el cliente no lo ve, salvo si abre una foto aparte. Migrar a un proyecto nuevo obliga a exportar Firestore y las cuentas, rehacer la configuración y los secretos y pierde las suscripciones a notificaciones: no compensa |
| Sitio de Hosting por defecto `dmoyadev-gobernansa` (webapp) | Es el del proyecto, no se renombra ni se borra | Se queda, detrás de `app.<dominio>` |
| Sitio `gobernansa-admin` | Los sitios no se renombran | Se queda, detrás de `admin.<dominio>`. La landing no está en Firebase sino en GitHub Pages, y su dominio se pone en el repositorio (T5) |
| Secreto de GitHub `FIREBASE_SERVICE_ACCOUNT_DMOYADEV_GOBERNANSA` | Su nombre es el del proyecto, que se queda | Se queda |
| Dominio `codigo.gobernansa.dmoya.dev` de las cuentas con código llave (`CODE_EMAIL_DOMAIN`) | Cada vecino que entra con su carta tiene una cuenta con ese correo: cambiarlo deja fuera a todos | **Se queda**, aunque el dominio viejo deje de existir: no recibe correo, solo es el nombre de la cuenta |
| Cabecera `GOBK1` de las copias de seguridad | Cambiarla deja ilegibles las copias que ya hay | Se queda |
| Fotos y vídeos subidos antes de pasar a Storage | Siguen en el servicio de fotos anterior, en una carpeta con el nombre viejo, y sus enlaces la llevan | Se quedan. No muevas ni renombres esa carpeta |
| Correos ya encolados en **Correo saliente** | Son el registro de lo que se envió | Se quedan con el nombre viejo |
| Entradas ya guardadas del **Historial** (cambios y acciones) | Son el registro de lo que pasó, con el nombre que tenía cada cuenta entonces | Se quedan con el nombre viejo |

---

## 2. Orden

1. Validar el nombre (T1).
2. Comprar el dominio (T2) y crear los correos (T3).
3. Diseñar A1–A3 (y A4–A5 si quieres) y pasármelos con las decisiones D1–D8.
4. Cambio de código en una rama (sección 3). Hasta el merge no se despliega nada.
5. Nombres y correos de acceso en Firebase (T4).
6. Dominios propios en Hosting (T5) y dominios autorizados (T6).
7. Merge: CI despliega reglas, webapp y admin en Firebase y la landing en GitHub Pages (T7).
8. Redirigir el dominio viejo (T8).
9. Proyecto de demo con el nombre nuevo (T9).
10. GitHub (T10), carpeta local y copias (T11), resto (T12–T13).
11. Capturas (T14) y comprobación final (sección 5).

Los pasos 5 y 6 pueden ir antes del merge: un dominio propio conectado sirve la versión que haya desplegada, y los dominios autorizados no estorban.

---

## 3. Lo que cambio yo en el repo

Unas 190 menciones del nombre en unos 60 ficheros, más unas 700 importaciones del paquete compartido.

### 3.1 Textos visibles

| Dónde | Qué |
|---|---|
| `apps/webapp/index.html` | `og:site_name`, `og:title`, `og:image:alt`, `apple-mobile-web-app-title`, `<title>` |
| `apps/webapp/public/manifest.webmanifest` | `name`, `short_name` |
| `apps/webapp/public/sw.js` | Título por defecto de las notificaciones push |
| `apps/webapp/src/app/router.ts` | Título de la pestaña (y «… DEMO» en otros entornos) |
| `apps/webapp/src/app/LegalPage.vue` | Cuatro menciones del aviso legal y la privacidad |
| `apps/webapp/src/modules/auth/ui/ProfilePage.vue` | «gobernança v1.x · release» al pie del perfil |
| `apps/webapp/src/modules/auth/ui/LoginPage.vue`, `shared/ui/TheToolbar.vue`, `modules/workorders/ui/WorkOrderPage.vue` | `alt` del logo |
| `apps/admin/index.html` | `description`, `og:site_name`, `og:title`, `og:description`, `og:image:alt`, `apple-mobile-web-app-title` («gob. admin»), `<title>` |
| `apps/admin/public/manifest.webmanifest` | `name`, `short_name`, `description` |
| `apps/admin/src/app/router.ts` | Título de la pestaña |
| `apps/admin/src/app/AdminLayout.vue` | `alt` del logo, «Instalar gobernança admin como app», aviso de cuenta sin permisos |
| `apps/admin/src/app/LegalPage.vue` | Cinco menciones |
| `apps/admin/src/modules/auth/ui/LoginPage.vue` | `alt` y «Gestiona las comunidades de gobernança» |
| `apps/admin/src/modules/communities/ui/CommunitiesPage.vue` | Los dos mensajes de lista vacía |
| `apps/admin/src/modules/people/ui/PeoplePage.vue` | Dos textos de la invitación |
| `apps/admin/src/modules/properties/ui/CensusImportPage.vue` | Dos textos de la importación |
| `apps/admin/src/modules/properties/ui/PropertiesPage.vue` | Filtro y placeholder «Sin cuenta en gobernança» |
| `apps/admin/src/modules/mail/application/mail.ts` | Textos de las invitaciones (asunto, título, cuerpo y botón) |
| `apps/admin/src/modules/obligations/ui/ObligationsPage.vue` | `PRODID` del calendario `.ics` |
| `packages/shared/domain/mail.ts` | Cabecera del correo, «Enviado con gobernança» y versión en texto plano |
| `packages/shared/domain/user.ts` | Rol «Equipo gobernança» |
| `packages/shared/domain/verifactu.ts` | `NombreSistemaInformatico` (D1), `IdSistemaInformatico` (D7). `NombreRazon` pasa a ser la razón social del productor cuando exista ([EMP-1](competencia.md#emp-1)) |
| `apps/functions/index.js` | «Solo el equipo de gobernança puede restaurar versiones», el error de restaurar en el Historial |
| `apps/landing/index.html` | `<title>`, `og:title`, `aria-label` y `alt` del logo, la notificación «gobernança · ahora», la ventana «gobernança admin», la «g» de los dos iconos de app de las notificaciones y el icono en miniatura que imita el aro coral del isotipo |

### 3.2 Logos e imágenes

| Dónde | Qué |
|---|---|
| `packages/shared/assets/logo.svg`, `apps/landing/img/logo.svg` | A1 |
| `apps/landing/img/logo-night.svg` | A2 |
| `packages/shared/ui/IsotypeSVG.vue` | A3 |
| `apps/webapp/public/` y `apps/admin/public/` | Los cinco iconos y `og-image.jpg` de cada una |
| `apps/landing/index.html` | El favicon pasa del logo entero (ilegible a 16 px) al isotipo. `og:image` pasa a URL absoluta con el dominio nuevo (las tarjetas no aceptan rutas relativas) y se añade `og:url` |
| `apps/landing/img/cartera.png`, `vecino.jpg` | Las capturas de T14 |
| Tamaños en `AdminLayout.vue`, `TheToolbar.vue`, `LoginPage.vue` (las dos), `WorkOrderPage.vue` | Solo si el logo nuevo cambia de proporción |

### 3.3 Direcciones

| Dónde | Qué |
|---|---|
| `apps/admin/src/modules/mail/application/mail.ts` | `WEBAPP_URL` por defecto: el enlace de las invitaciones, partes de trabajo y «Ver como vecino» en producción |
| `apps/webapp/index.html`, `apps/admin/index.html` | `og:url` y `og:image`, del `web.app` al dominio propio |
| `.env.example`, `README.md` | Las URLs de ejemplo y del proyecto |
| `scripts/seed/data/meetings.js`, `errors.js` | Las URLs del seed |

El chequeo de CI (`firebase-hosting-merge.yml`) sigue con las direcciones `web.app`: no cambian nunca.

### 3.4 Identificadores internos

Nadie los ve; los cambio para que el código diga un solo nombre.

| Dónde | Qué | Efecto |
|---|---|---|
| `package.json` (raíz, las tres de `apps/` y `packages/` y la de `apps/functions/`, `@gobernansa/functions`) y todas las importaciones `@gobernansa/shared/…` | Pasa a `@<slug>/…` | Regenero `package-lock.json` con `npm install` |
| `.firebaserc` | Alias y sitios del proyecto de demo | Solo la demo, que aún no existe (T9). Producción se queda |
| `CommunityDashboard.vue`, `CommunityPage.vue`, `CommunitySetup.vue` | Claves `gobernansa.admin.*` del navegador | Quien había reordenado su panel lo ve una vez como viene de serie |
| `ObligationsPage.vue` | `UID` de los eventos `.ics` (`@gobernansa`) | Quien ya importó un `.ics` vería el evento repetido; sin clientes todavía, no importa |
| `scripts/backup/*.js` y sus valores por defecto en `.env.example` | Carpeta de copias, carpeta de la clave, etiqueta de launchd, prefijo de los ficheros, mensajes | **Obliga a hacer T11 el mismo día** |
| `scripts/seed/seed.js`, `scripts/backup/*.js`, `scripts/symbolicate.js`, `scripts/demo.js` | IDs por defecto del emulador y el de la demo local (`demo-gobernansa`) y carpeta temporal | Ninguno |
| `scripts/seed/data/*.js`, `README.md` del seed | «Equipo gobernança», textos de correo, semilla de los enlaces de la demo | Ninguno: el seed lo regenera todo |
| `firestore.rules` y comentarios del código | Unos diez comentarios | Ninguno: las reglas no cambian |

### 3.5 Documentación

`README.md`, `docs/competencia.md`, `docs/setup.md`, `docs/datos.md`, `docs/v1.md` ([A2](v1.md#a2) queda como hecha) y `docs/fiabilidad.md`. Los IDs que no cambian (sección 1) se quedan como están.

---

## 4. Tutoriales de lo que haces tú

### T1. Validar el nombre

1. **Que se escriba como suena.** Dilo en voz alta a dos o tres personas y que lo escriban. Si sale de más de una forma (como pasó con gobernança, gobernansa y gobernanza), compra también los dominios de esas formas (T2).
2. **Marcas en España**: [Localizador de marcas de la OEPM](https://consultas2.oepm.es/LocalizadorWeb/). Busca la denominación y las parecidas en las clases 9 (software), 42 (software como servicio) y 36 (administración de fincas).
3. **Marcas en la UE**: [TMview](https://www.tmdn.org/tmview/) con las mismas clases.
4. **Dominio**: `.es` y `.com` libres en tu registrador.
5. **Si vas a constituir una SL**: la razón social puede ser otra, pero si quieres que coincida, pide la certificación negativa de denominación en el [Registro Mercantil Central](https://www.rmc.es/).
6. *(Opcional)* Registrar la marca en la OEPM, en sede electrónica, en las clases 9 y 42. Mira las tasas vigentes antes.
7. *(Opcional)* Que el nombre esté libre en las redes que vayas a usar (LinkedIn como mínimo).

### T2. Comprar el dominio

1. En tu registrador (el mismo de `dmoya.dev` simplifica), compra `<dominio>` y las variantes de T1.1.
2. No añadas registros todavía: los da Firebase en T4 y T5.
3. Si compras variantes, apúntalas: en T8 se redirigen a la principal.

### T3. Correos del dominio

1. En el panel del registrador, crea los buzones o alias: `hola@`, `soporte@` y el tuyo. `no-reply@` no necesita buzón.
2. Añade los registros MX, SPF, DKIM y DMARC que te indique el proveedor de correo; sin ellos los correos acaban en spam.
3. Pásame el de contacto: va al aviso legal (`legal.ts`) cuando se rellene con los datos de [EMP-1](competencia.md#emp-1).

### T4. Firebase: nombre y correos de acceso

En [console.firebase.google.com](https://console.firebase.google.com), proyecto `dmoyadev-gobernansa`:

1. **⚙️ → Configuración del proyecto → General**:
   - **Nombre del proyecto** → `<Nombre>`. Solo lo ves tú.
   - **Nombre público** (*Public-facing name*) → `<Nombre>`. Es el que sale en el correo del enlace de acceso.
   - **Correo de asistencia** → `soporte@<dominio>`.
   - En **Tus apps**, el apodo de la app web → `<Nombre> web`. Solo lo ves tú.
2. **Authentication → Plantillas** (*Templates*):
   1. Lápiz junto a **Idioma de la plantilla** → **Español**.
   2. Lápiz de cualquier plantilla:
      - **Nombre del remitente** → `<Nombre>`.
      - **De** → **Personalizar dominio** → `<dominio>`. Firebase te da unos registros DNS: añádelos en tu registrador y pulsa **Verificar** (hasta 48 h). El remitente queda en `noreply@<dominio>`.
      - **Responder a** → `soporte@<dominio>`.
      - **Guardar**. El remitente y el dominio valen para todas las plantillas.
   3. Cuando `app.<dominio>` esté conectado (T5): lápiz de cualquier plantilla → **Personalizar URL de acción** → `https://app.<dominio>/__/auth/action`. Hosting sirve esa ruta en todos tus dominios, y así el enlace del correo deja de pasar por `firebaseapp.com`.
3. El texto del correo del enlace de acceso no se puede editar; toma el nombre público del paso 1.

### T5. Dominios propios en Hosting

| Sitio | Dónde | Dominio |
|---|---|---|
| `dmoyadev-gobernansa` (webapp) | Firebase Hosting | `app.<dominio>` |
| `gobernansa-admin` | Firebase Hosting | `admin.<dominio>` |
| Landing | GitHub Pages | `<dominio>` y `www.<dominio>` (redirigido a `<dominio>`) |

**Webapp y admin**, en **Hosting** de Firebase:

1. En la tarjeta del sitio, **Ver** → **Añadir dominio personalizado**.
2. Escribe el dominio.
3. Firebase te da los registros (un TXT para verificar y uno o dos A, o un CNAME para subdominios). Añádelos tal cual en el DNS de tu registrador.
4. **Verificar**. El estado pasa por *Pendiente* hasta **Conectado** cuando emite el certificado: de minutos a 24 h.

**Landing**, en GitHub:

1. En el DNS de tu registrador, para `<dominio>` cuatro registros A a `185.199.108.153`, `185.199.109.153`, `185.199.110.153` y `185.199.111.153`, y para `www.<dominio>` un CNAME a `dmoyadev.github.io`.
2. Repositorio → **Settings → Pages → Custom domain** → `<dominio>` → **Save**. GitHub comprueba el DNS y redirige `www.<dominio>` solo.
3. Cuando aparezca el certificado, marca **Enforce HTTPS** (de minutos a 24 h).

### T6. Dominios autorizados

**Authentication → Configuración → Dominios autorizados → Añadir dominio**: `app.<dominio>` y `admin.<dominio>`. Sin ellos no salen los enlaces de acceso desde esos dominios.

Deja `gobernansa.dmoya.dev` y `admin.gobernansa.dmoya.dev` hasta terminar T8; después ya no sirven la app y se pueden quitar. Los `web.app` se quedan.

### T7. Desplegar

1. Haz merge de la rama del cambio. CI despliega las reglas, la webapp y el admin en Firebase, y la landing en GitHub Pages si el cambio la toca (si no, **Actions → Deploy the landing to GitHub Pages → Run workflow**).
2. Abre `app.<dominio>`, `admin.<dominio>` y `<dominio>` y recarga dos veces: el service worker sirve la versión vieja la primera vez.

### T8. Redirigir el dominio viejo

1. **Hosting → sitio de la webapp →** dominio `gobernansa.dmoya.dev` → **⋮**. Si ofrece **Editar**, cámbialo a **Redirigir** → `app.<dominio>`. Si no, **Eliminar** y vuelve a añadirlo marcando **Redirigir a un sitio web existente** → `app.<dominio>`. Los registros DNS en `dmoya.dev` son los mismos, así que se verifica enseguida.
2. Lo mismo en el sitio del admin: `admin.gobernansa.dmoya.dev` → `admin.<dominio>`.
3. Las variantes de T2 se conectan igual, como redirección al dominio principal.
4. **No borres los registros DNS** de esos subdominios en `dmoya.dev` mientras dure la redirección (D8): las invitaciones, partes de trabajo y correos ya enviados llevan las direcciones viejas.
5. Comprueba que conserva la ruta: `gobernansa.dmoya.dev/issues/new` tiene que acabar en `app.<dominio>/issues/new`.

Qué notan los usuarios que ya tengas (cada dominio es otro sitio para el navegador):
- **Sesión**: tienen que volver a entrar, con el enlace al correo.
- **App instalada**: sigue apuntando al dominio viejo y se abre con la barra del navegador. Hay que borrarla e instalarla desde el nuevo.
- **Notificaciones push**: se reactivan desde el perfil en el dominio nuevo.
- **Admin**: el orden de los paneles vuelve al de serie.

### T9. Proyecto de demo

Aún no existe (no hay `.env.demo.local` ni su clave). Créalo ya con el nombre nuevo siguiendo el [proyecto de demo](setup.md#proyecto-demo), con estos nombres:

| Donde la guía dice | Pon |
|---|---|
| Proyecto `gobernansa-demo` | `<slug>-demo`. El ID es único en todo Firebase: si está cogido, dime el que te dé |
| Sitio `gobernansa-demo-admin` | `<slug>-demo-admin` |
| `VITE_WEBAPP_URL` | `https://demo.<dominio>` |
| Dominios propios | `demo.<dominio>` y `demo-admin.<dominio>` (T5), y los dos en Dominios autorizados (T6) |

Haz también el paso 1 de T4 (nombre público) y el paso 2.1 (idioma) en este proyecto.

### T10. GitHub

1. Repositorio → **Settings → General → Repository name** → `<slug>` → **Rename**. GitHub redirige las URLs viejas.
2. En tu copia local:
   ```bash
   git remote set-url origin git@github.com:dmoyadev/<slug>.git
   ```
3. En la portada del repo, **⚙️ About**: descripción, **Website** `https://<dominio>` y temas.
4. **Settings → General → Social preview → Edit → Upload an image**: el `og-image.jpg` nuevo.
5. Secretos: nada que cambiar.

### T11. Carpeta local y copias de seguridad

Justo después del merge, y antes de la siguiente copia, porque el código pasará a buscar la clave en la carpeta nueva y, si no la encuentra, **crea otra** y las copias anteriores solo se abren con la vieja.

1. Mueve la clave y las copias:
   ```bash
   mv ~/.config/gobernansa ~/.config/<slug>
   ```
   ```bash
   mv ~/Documents/Backups/gobernansa ~/Documents/Backups/<slug>
   ```
2. Renombra las copias viejas para que entren en la rotación:
   ```bash
   cd ~/Documents/Backups/<slug> && for f in gobernansa-*.bak; do mv "$f" "<slug>-${f#gobernansa-}"; done
   ```
3. En el gestor de contraseñas, renombra la entrada de la clave de las copias.
4. Comprueba que la clave está donde la buscará (sin lanzar una copia, que lee la base entera):
   ```bash
   ls -l ~/.config/<slug>/backup.key
   ```
5. *(Opcional)* Renombrar la carpeta del proyecto. Cierra el editor y los servidores de desarrollo antes:
   ```bash
   mv ~/dev/personal/gobernança ~/dev/personal/<slug>
   ```
6. Si programas la copia diaria (hoy no lo está), hazlo después del paso 5, porque guarda la ruta del proyecto: `npm run backup -- --schedule` y el `launchctl bootstrap` que imprime.

### T12. Datos de producción

1. En el admin, **Administradores**: si tu perfil u otro del equipo se llama «Equipo gobernança», cámbialo.
2. Nada más: las comunidades, vecinos y documentos no guardan el nombre del producto.

### T13. Fuera del repo

- `design/Diseño.sketch`: el logo nuevo, para tenerlo como fuente.
- Bot de Telegram del formulario de la landing: aún sin configurar (`BOT` vacío), así que créalo directamente con el nombre nuevo en @BotFather.
- Gestor de contraseñas: entradas de Firebase, de la clave de copias y de `DEMO_PASSWORD`.
- Firma de correo, LinkedIn, tarjetas, la presentación y el vídeo de la demo ([F](v1.md#f)).
- Google Search Console, cuando la landing esté en `<dominio>`: añade la propiedad del dominio.
- Analytics no está activo en el código: nada que cambiar.

### T14. Capturas de la landing

1. Arranca todo con el despacho grande:
   ```bash
   npm run dev
   ```
   ```bash
   npm run seed:emulators -- --reset --volume
   ```
2. **Cartera**: en Chrome abre el admin (`https://localhost:5401`) con la cuenta del despacho → **Panel**. DevTools (`⌥⌘I`) → icono de dispositivo (`⇧⌘M`) → **Dimensions: Responsive**, 800 × 500, *DPR* 1 → menú **⋮** de esa barra → **Capture screenshot**. Guárdala como `apps/landing/img/cartera.png`.
3. **Vecino**: la webapp (`https://localhost:5400`) como el Piso 1A, en el inicio. Misma barra a 390 × 800, *DPR* 1 → **Capture screenshot**. Pásala a JPG:
   ```bash
   sips -s format jpeg -s formatOptions 80 ~/Downloads/localhost_5400.png --out apps/landing/img/vecino.jpg
   ```

---

## 5. Comprobación final

- [ ] `git grep -i gobern` solo devuelve lo de la sección 1.
- [ ] Webapp y admin: título de la pestaña, favicon, logo en el login y en la cabecera, aviso de instalar y pie del perfil.
- [ ] Instalada en Android y en iPhone: nombre e icono en la pantalla de inicio.
- [ ] Una notificación push muestra el nombre nuevo.
- [ ] Correo del enlace de acceso: remitente, asunto, idioma y que el enlace empiece por `https://app.<dominio>`.
- [ ] Una invitación desde el admin: en **Correo saliente**, cabecera, texto y pie con el nombre nuevo y el enlace a `app.<dominio>`.
- [ ] Enlace pegado en WhatsApp: tarjeta con la imagen y el nombre nuevos. WhatsApp guarda la vieja un tiempo: pruébalo con `?v=2` o fuerza la relectura en el [Sharing Debugger](https://developers.facebook.com/tools/debug/).
- [ ] `gobernansa.dmoya.dev/issues/new` redirige a `app.<dominio>/issues/new`; lo mismo con el admin.
- [ ] Parte de trabajo abierto como proveedor: logo nuevo.
- [ ] `.ics` de una obligación: `PRODID` nuevo.
- [ ] Landing: logo de día y de noche, favicon, iconos de las notificaciones y capturas.
- [ ] La próxima `npm run backup` usa la clave de siempre: no avisa de «Clave nueva».
