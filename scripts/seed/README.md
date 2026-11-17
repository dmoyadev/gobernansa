# seed

Carga una demo completa de gobernança: tres comunidades, su censo y su gente, y datos para cada pantalla de las dos apps.

## Configuración

Solo para el proyecto real; los emuladores no la usan:

1. Firebase console → **Project settings → Service accounts**.
2. **Generate new private key**.
3. Guárdala como `serviceAccountKey.local.json` en esta carpeta (git la ignora).

## Uso

```bash
npm run seed
```

Pregunta, paso a paso:

1. **Dónde**: los emuladores locales (arráncalos antes con `npm run emulators`), el proyecto de demo (`serviceAccountKey.demo.local.json`, ver [proyecto de demo](../../docs/setup.md#proyecto-demo)) o el proyecto real, que hay que confirmar escribiendo su id. `npm run seed:emulators` se salta esta pregunta.
2. **Qué hacer**: dejar la demo entera como nueva (vacía cada colección de la demo y lo carga todo) o elegir.
3. **Qué borrar**, por grupo, con cuántos documentos tiene ahora cada uno, y **cómo**: exactamente los documentos que crea el seed (lo creado a mano se queda, aunque cuelgue de ellos) o las colecciones enteras (también lo creado a mano, y los documentos de otros grupos que haya en ellas, que ofrece volver a cargar).
4. **Qué cargar**, por grupo, añadiendo los grupos que necesitan los elegidos cuando no están, y **cómo**: sobrescribiendo los documentos de la demo o creando solo los que faltan.
5. **Auth** (solo en el emulador y en el proyecto de demo): crear otra vez las cuentas de la demo, para que cada una entre con `DEMO_PASSWORD` de `.env.demo.local` (sin ella, pidiendo una contraseña nueva por correo). Los vecinos sin cuenta reciben su carta de acceso desde **Vecinos y gestores** en el admin.

Antes de tocar nada muestra un resumen, con la cuota que gasta en el proyecto real, y pide seguir.

### Grupos

Cada uno es un fichero de `data/`, y `data/cast.js` tiene las personas, comunidades, censo y proveedores que comparten:

| Grupo | Carga |
| --- | --- |
| `core` | Comunidades, inmuebles, usuarios, invitaciones, documentos personales y el registro de actividad |
| `maintenance` | Incidencias con comentarios, votos y notas internas, proveedores y valoraciones, partes de trabajo, obligaciones |
| `meetings` | Juntas con asistencia, votaciones, actas y avisos, comunicados y el correo saliente |
| `charges` | Presupuestos, cuotas y cargos, pagos en línea, reclamaciones de deuda y remesas SEPA |
| `accounting` | Facturas de proveedores, órdenes de pago, movimientos bancarios, asientos y el ejercicio cerrado |
| `bookings` | Reservas de las zonas comunes |
| `billing` | Las facturas de honorarios del despacho y su registro Verifactu |
| `errors` | Los errores de las apps para la página **Errores** del equipo |

Las fechas son relativas al día en que se ejecuta, así que la demo siempre tiene juntas próximas, incidencias recientes y cargos vencidos.

### Sin preguntas

Cualquier opción se las salta, p. ej. en un script:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:5502 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:5501 node scripts/seed/seed.js --reset --only=core,meetings
```

- `--only=<grupos>` carga solo esos grupos (todos por defecto).
- `--reset` vacía antes sus colecciones.
- `--yes` lo carga todo sin más opciones.
- `--volume` añade a Fincas Jaén 38 comunidades generadas con unas 2.000 viviendas, para probar el admin al tamaño de un despacho real (unas 3.200 escrituras más; `npm run seed:demo -- --volume`).
- `--demo` escribe en el proyecto de demo, cuentas incluidas (`npm run seed:demo` es `--demo --reset`).
- Sin `FIRESTORE_EMULATOR_HOST` ni `--demo` escribe en el proyecto real, y entonces necesita `--project=<id del proyecto>` para confirmarlo.

## A tener en cuenta

- En el proyecto real, cada recuento, borrado y escritura gasta la cuota diaria del plan gratuito (20.000 escrituras y borrados, 50.000 lecturas). La demo entera es una parte pequeña, pero no la cargues varias veces al día.
- Nunca toca las cuentas de Auth del proyecto real: los usuarios de la demo con cuenta real conservan sus uids, y los demás solo existen en el emulador.
- Las cuotas empiezan 220 días antes del día en que se ejecuta, para que las deudas mantengan su antigüedad. Cargada entre enero y principios de agosto, eso cae en el año anterior, y las páginas fiscales (cuotas, ejercicio cerrado, impuestos) lo mezclan con el año natural.
- No valida los datos más allá de las rutas: puede insertar datos incoherentes si un grupo tiene errores.
