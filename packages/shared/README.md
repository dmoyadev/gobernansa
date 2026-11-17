# shared

Lo que usan la webapp y el admin. No tiene build: las apps lo importan como código fuente (`@gobernansa/shared/<carpeta>/<fichero>.ts`) y lo compilan con el suyo.

| Carpeta | Qué hay |
| --- | --- |
| `domain/` | El modelo: tipos y reglas de negocio puras (cargos, recibos, contabilidad, SEPA, AEAT, juntas, incidencias, roles…). Sin Firebase ni Vue, salvo tipos |
| `application/` | Sesión (`useAuth`), PWA, actividad y ayudas de escritura |
| `infrastructure/` | Conexión a Firebase y a los emuladores, monitorización de errores, Remote Config, acciones del historial y Web Vitals |
| `ui/` | Componentes comunes y la configuración de lnxjs-components |
| `theme/` | Colores, tipografía y el tema de lnxjs-components |
| `utils/` | Textos y lectura de `.xlsx` |
| `assets/` | Logo y fuentes |
| `build/` | El plugin de Vite que mete en cada app solo los iconos que usa |

## A tener en cuenta

- `user.ts` replica lo que permiten las reglas (`firebase/firestore.rules`) para que las apps solo ofrezcan lo permitido. Si cambias una, cambia la otra.
- El seed importa `domain/*.ts` directamente desde Node, así que lo de `domain/` no puede depender de Vite.
- `infrastructure/firebase.ts` conecta con todos los emuladores o con ninguno, según `VITE_FIREBASE_EMULATORS`.
