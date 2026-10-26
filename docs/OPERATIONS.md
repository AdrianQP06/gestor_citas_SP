# Operaciones (depósitos y reembolsos)

Registro sencillo, vinculado a una cita, de **depósitos** por solicitudes de tarjeta **Daily** o **Master Business** y de **reembolsos** al cliente.

> **Importante: es un registro, no un cobro.** La aplicación **no mueve dinero ni se integra con pasarelas de pago**. Registrar un importe no significa que el dinero haya sido recibido o devuelto; «Confirmada» solo indica que un administrador ha verificado el registro. Esto se repite en el formulario, el detalle, el recibo PDF y el informe.

## Datos de cada operación

| Campo | Regla |
|---|---|
| Código | Único, `SN-OP-XXXXXXXX`, generado por el servidor (aparece en el recibo). |
| Cita | Obligatoria (la cita no se modifica). |
| Tipo | `deposit` (depósito) o `refund` (reembolso). |
| Producto | `daily` o `master_business`. **Obligatorio en depósitos, prohibido en reembolsos.** |
| Importe | Entero en unidades menores (`BIGINT`, céntimos); el cliente envía texto `"50.00"`. Positivo, máx. 2 decimales, máx. 9.999.999,99. Nunca se usa coma flotante. |
| Moneda | Explícita, sin valor por defecto: `USD` o `EUR`. Los totales nunca mezclan monedas. |
| **Método** | **Siempre «Efectivo»** (`cash`), fijado automáticamente por el servidor. No hay selector en el formulario; si la petición trae otro valor se rechaza (400); además una restricción `CHECK`/`ENUM` en la base de datos lo impide. No se admiten transferencias, tarjetas ni otros métodos. Aparece como «Método: Efectivo» en el historial, el detalle, el recibo y el informe. |
| Referencia | Opcional, ≤ 60 caracteres (letras, números, espacio y `_ . - / #`). |
| Estado | `pending` (Pendiente de verificación), `confirmed` (Confirmada), `voided` (Anulada). |
| Trazabilidad | Quién y cuándo la registró, confirmó o anuló, y motivo de la anulación. |

## Estados y permisos (se aplican en el backend)

```
pending ──confirmar (solo admin)──▶ confirmed
pending ──anular──▶ voided        confirmed ──anular (solo admin)──▶ voided
```

- Toda operación nace **pendiente**; no se puede crear ya confirmada.
- **Confirmar**: solo administradores (el personal recibe 403).
- **Anular**: motivo obligatorio (3–300 caracteres). Una pendiente la anula quien la registró o un administrador; una confirmada, solo un administrador. «Anulada» es definitiva.
- **No hay edición ni borrado**: para corregir, se anula y se registra de nuevo. Los cambios de estado usan `UPDATE … WHERE status = <estado esperado>` dentro de una transacción, de modo que dos acciones simultáneas no pueden confirmar/anular dos veces.
- Cada alta/cambio genera un evento en `operation_events` (estado anterior y nuevo, usuario, fecha) y una entrada en `audit_log` (`operation.create|confirm|void|receipt`).

## API (`/api/v1/operations`, requiere sesión)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/?appointmentId=` | Historial de la cita (incluye anuladas). |
| POST | `/` | Registrar (201). Cuerpo: `appointmentId, type, product?, amount, currency, reference?`. |
| GET | `/:id` | Detalle + eventos. |
| POST | `/:id/confirm` | Confirmar (admin). |
| POST | `/:id/void` | Anular `{ reason }`. |
| GET | `/:id/receipt[?download=1]` | Recibo PDF individual. |

## Recibo PDF

**Acceso rápido desde la cita:** en el panel de la cita, sección «Operaciones», el bloque «Recibo para entregar al cliente (entrega manual)». Con una operación hay botones **Ver recibo** y **Descargar**; con varias, el desplegable **Recibo PDF** lista cada operación con su código, tipo, importe y estado para elegir la correcta. La petición incluye `?appointmentId=`: el servidor responde 404 si la operación no pertenece a esa cita. **La entrega al cliente es manual** (no hay correo, WhatsApp ni portal para el cliente).

**Permisos:** el recibo se sirve a cualquier usuario con sesión (personal y administradores), igual que la agenda y el detalle de operaciones: la aplicación es de un único negocio y no hay propiedad por usuario. Sin sesión, 401.

Reutiliza el sistema de PDF de reportes (`reports/pdf/pdf.assets.ts`: logotipo oficial, tipografía Manrope y paleta de Supernova). Muestra el código único, el estado con un banner inequívoco (ámbar *pendiente de verificación*, verde *confirmada*, rojo *anulada* con marca de agua y el importe tachado), importe y moneda, «Método: Efectivo», datos de la cita, historial y un aviso de que es un registro informativo.

## Informe «Operaciones» (solo administradores)

Menú Reportes → *Operaciones (depósitos y reembolsos)*. Filtros: período (por fecha de registro) y estado de la operación. Muestra, **por moneda**, depósitos y reembolsos confirmados y pendientes, el total vigente (pendientes + confirmadas) y las anuladas aparte; tabla de totales por tipo/estado/moneda y detalle. Reglas anti-error: cada operación es una fila (sin joins que dupliquen importes), las anuladas **no cuentan** en ningún total vigente, y pantalla y PDF salen del mismo objeto. Cada visualización se audita (`report.view`).

## Base de datos

Migración `server/migrations/002_operations.sql` (idempotente; con `AUTO_MIGRATE` se aplica sola, o `npm run migrate -w server`): tablas `operations` y `operation_events`, con `CHECK` de importe > 0, producto coherente con el tipo, y anulada ⇒ usuario y motivo. Las fechas se escriben desde la aplicación (sin `DEFAULT` de la BD).

## Pruebas

`server/test/operations.test.ts` (14 pruebas): precisión del dinero, validaciones (incluido rechazo de métodos distintos de Efectivo), restricciones de la BD, permisos, transiciones, historial y auditoría, cita y recordatorios intactos, recibo PDF (estados y «Método: Efectivo»), y el informe (totales = SQL independiente por moneda/tipo/estado, anuladas fuera de lo vigente, filtros, período vacío y límites de zona horaria). Los ejemplos de las pruebas (p. ej. depósito Daily de 50,00 USD) existen solo en la BD de pruebas.

## Limitaciones conocidas

- No hay tope de reembolsos respecto a los depósitos de la cita ni conciliación contable.
- Un administrador puede confirmar operaciones que él mismo registró (no hay doble control).
- Solo USD y EUR; no hay conversión.
- Sin edición: las correcciones se hacen anulando y registrando de nuevo.
- El informe de operaciones es solo para administradores.
- La tipografía del PDF (subconjunto latino) no incluye algunos símbolos; el texto de los recibos los evita.
