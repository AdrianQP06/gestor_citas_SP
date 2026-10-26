# Marcas de tiempo: investigación y estado

## Qué se observó (base de desarrollo `gestor_citas`)
Varias filas insertadas en momentos distintos comparten exactamente la misma marca `created_at`:

| Tabla | Filas afectadas | Valor compartido | Comentario |
|---|---|---|---|
| `audit_log` | ids 290 en adelante (40 filas en la auditoría y las posteriores) | `2026-10-23T17:05:04.325Z` | incluyen inicios de sesión e informes de varias horas después |
| `appointments` | las 64 citas actuales | `2026-10-23T15:53:54.199Z` | incluso citas creadas desde el portal a las 17:05 |
| `customers` | ids 56–72 (17) | `2026-10-23T16:21:22.970Z` | anterior en ~33 s a la inserción real del seed |
| `notifications` | las 64 actuales | `2026-10-23T15:50:19.362Z` | pueden proceder de una sola sentencia `INSERT … SELECT`; no se puede afirmar |

`sessions` y `users`, con la misma expresión `DEFAULT`, sí muestran marcas distintas y crecientes.

## Qué se comprobó (hechos)
- Los `DEFAULT` siguen siendo la expresión `CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), …` en todas las tablas (`information_schema`).
- MariaDB 10.4.32 (XAMPP), `time_zone = SYSTEM`; la aplicación usa `conn.query` (sin sentencias preparadas) y no ejecuta `SET timestamp`.
- **Reproducción en tablas de `gestor_citas_test` (esquema de pruebas; el usuario de la aplicación no puede crear esquemas nuevos):** el `DEFAULT` funcionó correctamente en todos estos patrones: inserciones sueltas con pausas, 300 consecutivas, dentro de una transacción, con `GET_LOCK` (patrón `tx()`), tras `DELETE FROM`, copias estructurales (`CREATE TABLE … LIKE`) de `audit_log`, `customers`, `notifications`, `users` y `sessions`, las propias tablas reales de la base de pruebas, y conexiones nuevas tras cerrar las anteriores (patrón de «reinicio del servidor»). Una única sentencia con varias filas sí da una sola marca (comportamiento normal).
- En la base de pruebas, las 300 citas con una sola marca proceden de un `INSERT` de una sola sentencia hecho por una prueba: no es el fallo.

## Causa raíz: NO demostrada
No se logró reproducir el congelamiento fuera de la base de desarrollo. Hipótesis sin confirmar: un valor de `DEFAULT` con función no determinista que MariaDB 10.4 conserva en la definición de tabla en caché del servidor de desarrollo (explicaría «un valor por tabla, compartido entre conexiones y reinicios», pero no que `sessions` y `users` no se congelen). Averiguarlo exigiría reproducirlo en un MariaDB equivalente o con `FLUSH TABLES` (privilegio del que no se dispone).

## Mitigación aplicada (independiente de la causa)
La **aplicación escribe las marcas** (`isoNow()`, hora real de la inserción) en todas las inserciones de `audit_log`, `customers`, `appointments`, `notifications`, `sessions`, `users` y `notification_recipients` (incluidos `seed` y `create-admin`). Los `DEFAULT` se mantienen solo como respaldo. `operations`, `operation_events` y `support_requests` ya nacieron sin `DEFAULT`. La prueba `server/test/hardening.test.ts` comprueba que dos registros creados con unos milisegundos de diferencia no comparten marca y que cada una es la hora real.
No se ha cambiado el esquema ni ninguna fecha histórica.

## Fechas históricas que NO son fiables (base de desarrollo)
Las filas de la tabla anterior. No se han alterado para «arreglarlas»: conviene tratarlas como no fiables. No hay despliegue en producción con datos afectados; si se despliega, hazlo con el código actual sobre un esquema nuevo.
Los cálculos de Reportes no dependen de esas columnas (usan `starts_at` y las marcas de `operations`).
