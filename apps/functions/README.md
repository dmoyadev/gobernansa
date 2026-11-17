# functions

Las Cloud Functions del historial del superadmin y de los plazos de conservación. Node puro con módulos ES, sin build: Firebase sube esta carpeta tal cual. Necesitan el plan de pago (Blaze), así que hoy solo corren en los emuladores.

| Función | Qué hace |
| --- | --- |
| `auditTop`, `auditNested`, `auditDeep` | Guardan en `audit` cada cambio de cualquier documento, con el antes, el después y quién lo hizo |
| `auditAccountCreated`, `auditAccountDeleted` | Lo mismo con las cuentas de Auth |
| `restoreVersion` | Devuelve un documento a una versión del historial. Solo el superadmin |
| `purgeExpired` | Cada día, borra lo caducado según `retention.js` |
| `purgeOldMedia` | Cada domingo, borra las fotos que ya nadie ve |

## A tener en cuenta

- Corren en Node 24 (`engines`). ESLint rechaza aquí las APIs de Node más nuevas, pero no las novedades del lenguaje: revísalas a mano.
- `REGION` tiene que coincidir con la de `restoreVersion.ts` del admin y con la de la base de datos.
- La forma de una entrada del historial está también en `apps/admin/src/modules/history/domain/history.ts`: si cambia una, cambia la otra.
- `retention.js` lo usan también `npm run backup` y `npm run purge`, que borran lo caducado en el plan gratuito.
- Despliegue, región y plazos: [docs/firebase.md](../../docs/firebase.md), sección 10.
