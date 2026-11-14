# Alta de un despacho nuevo

Para v1 el alta la haces tú, con el despacho delante o por videollamada (B4.3 de [v1.md](v1.md)). Lleva una hora si el censo está en Excel. Al terminar, el despacho ya trabaja solo: crea, importa y archiva sus comunidades e invita a su equipo y a los vecinos.

## Antes de la cita

Pide al despacho:
- el **email del titular**, con el que entrará siempre;
- sus **datos fiscales**: razón social, NIF, dirección y la serie de sus facturas de honorarios;
- el **censo de una comunidad** en Excel o CSV (piso, propietario, NIF, email, teléfono y coeficiente), mejor la que quiera probar primero;
- los **emails de sus empleados**, y qué hace cada uno: oficial, contable o solo consulta.

## 1. Dar acceso al titular (tú, como superadmin)

1. En el admin, **Administradores** → **Invitar a alguien**.
2. El nombre y el email del titular, con el rol **Administración**. No marques comunidades: las suyas las crea él.
3. Deja marcado el envío por email. Mientras el correo esté en modo de prueba (B2), avísale tú de que entre en el admin con ese email: le llega el enlace para entrar.

Su cuenta es el despacho: su id es el del despacho, y los empleados que invite cuelgan de él.

## 2. Los datos del despacho (el titular)

**Honorarios** → **Datos fiscales del despacho**. Con esto factura sus honorarios a las comunidades (y Verifactu encadena desde la primera factura). Si no factura desde gobernança, puede dejarlo para más adelante.

## 3. Sus comunidades (el titular)

- **Varias de golpe:** **Importar comunidades** desde la lista de comunidades, con el censo de todas en un fichero. Reconoce cada comunidad por su CIF o su nombre; las que no existen se crean.
- **Una a una:** **Nuevo** en la lista de comunidades.

Cada comunidad nueva abre con **Puesta en marcha**, que se tacha sola:
1. **Datos fiscales**: el CIF y el IBAN de la comunidad.
2. **Censo**: las propiedades y sus coeficientes, pegados desde Excel.
3. **Presupuesto** del año.
4. **Vecinos**: invitarlos a la app del vecino.

Haz la primera con él y deja que haga la segunda solo mientras miras.

Los vecinos sin email se invitan igual, marcando **No tiene email**: se imprime una hoja con un código para entrar desde su móvil, que el despacho entrega en mano o en la junta. Sirve una vez; si lo pierde o cambia de móvil, se le imprime otro desde **Invitaciones pendientes** o con una invitación nueva.

## 4. Su equipo (el titular)

**Equipo del despacho** → **Invitar a alguien**, con la función de cada uno:
- **Oficial**: el día a día de las comunidades, sin cerrar ejercicios ni facturar honorarios.
- **Contable**: todo en las comunidades, también cerrar el ejercicio y los honorarios.
- **Solo lectura**: ve todas las comunidades del despacho, sin cambiar nada.

Todos ven las comunidades del despacho, también las que se creen después de invitarlos.

## 5. Comprobar antes de irte

- El titular ve sus comunidades en la cartera y en el dashboard.
- Un empleado entra con su email y ve las mismas comunidades.
- Un vecino invitado entra en la app del vecino y ve su comunidad.
- **Exportar en un ZIP** desde la configuración de una comunidad: que vea que se lo lleva todo cuando quiera (B8).

## Si algo falla

- **No le llega el enlace:** que mire el spam; si no, vuelve a invitar desde **Invitaciones pendientes**.
- **Una comunidad sale repetida al importar:** el CIF del fichero no coincide con el de la ficha. Corrige uno de los dos y vuelve a importar.
- **Un vecino sin email no puede entrar:** el código ya se usó o tiene una errata. Cancela su invitación, invítalo de nuevo y quita su cuenta vieja si la tenía.
- **«Está archivada»:** el fichero trae una comunidad archivada. Se recupera desde su configuración.
