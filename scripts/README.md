# scripts

Scripts de Node que se lanzan con `npm run` desde la raíz. Los que tocan Firebase leen `.env.local`, o `.env.demo.local` los del proyecto de demo.

| Script | Comando | Qué hace |
| --- | --- | --- |
| [`seed/`](seed/README.md) | `npm run seed`, `seed:emulators`, `seed:demo` | Carga los datos de prueba: tres comunidades con datos para cada pantalla |
| `demo.js` | `npm run demo`, `demo:reset` | La demo comercial en el portátil, sin internet, con sus propios puertos ([docs/demo.md](../docs/demo.md)) |
| `demo.js --dev` | `npm run dev:isolated` | Un segundo entorno de desarrollo con sus propios emuladores y datos, junto a `npm run dev` ([entorno aislado](../docs/desarrollo.md#entorno-aislado)) |
| `db.js` | `npm run db` | Lee y escribe documentos de los emuladores (`get`, `set`, `update`, `delete`); `--isolated` o `--demo` para los de esos entornos |
| `check-rules.js` | `npm run check:rules` | Comprueba `firebase/firestore.rules` en un emulador de Firestore propio, y CI antes de desplegarlas |
| `deploy-demo.js` | `npm run deploy:demo` | Compila y despliega las apps, las reglas y los índices en el proyecto de demo. Nunca toca producción |
| `backup/backup.js` | `npm run backup` | Copia cifrada de todo Firestore en `~/Documents/Backups/gobernansa` y borrado de lo caducado. `-- --schedule` la programa cada día |
| `backup/restore.js` | `npm run restore` | Restaura una copia en los emuladores, nunca en producción |
| `backup/purge.js` | `npm run purge` | Cuenta lo caducado y, con `-- --delete`, lo borra |
| `symbolicate.js` | `npm run symbolicate` | Traduce la pila de un error de la página **Errores** a las líneas del código |
| `doctor.js` | `npm run doctor` | Comprueba Node, Java, las dependencias, `.env.local`, los puertos de `npm run dev` y los hooks de git. De `.env.local` solo mira qué variables tienen valor |

## A tener en cuenta

- Sin `FIRESTORE_EMULATOR_HOST`, el seed y las copias trabajan contra el proyecto real con la cuenta de servicio `seed/serviceAccountKey.local.json`, ignorada por git. Cada lectura y escritura gasta cuota del plan gratuito.
- La copia de seguridad encuentra las colecciones leyendo `firebase/firestore.rules`: una colección nueva entra en cuanto tiene sus reglas.
- La copia y la restauración se explican en [docs/fiabilidad.md](../docs/fiabilidad.md#rob-2), y la traducción de errores en [MON-10](../docs/fiabilidad.md#mon-10).
