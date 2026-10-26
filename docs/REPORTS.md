# Módulo de Reportes

Informes de actividad del gestor de citas, con **vista en pantalla y PDF generados desde exactamente los mismos datos**: el backend calcula un único objeto `ReportData` (indicadores, gráficos, tablas y definiciones) y de él salen tanto la pantalla (`GET /api/v1/reports/:type`) como el PDF (`GET /api/v1/reports/:type/pdf`). No existe una segunda implementación de los cálculos en el frontend, así que las cifras no pueden diferir.

## Informes

| Informe (`type`) | Contenido | Acceso |
|---|---|---|
| `operational` | Rendimiento operativo: indicadores, comparación con el período anterior, evolución, estados, demanda por día y franja, motivos | Personal y administradores |
| `daily` / `weekly` / `monthly` | Agenda del período (horario, cliente, teléfono, motivo, estado), resumen por día y totales por estado | Personal y administradores |
| `cancellations` | Cancelaciones (quién cancela y motivo) y reprogramaciones (de → a, cambios, quién) | Personal y administradores |
| `reasons` | Motivos de visita con peso, completadas y canceladas | Personal y administradores |
| `upcoming` | Próximas citas pendientes y confirmadas | Personal y administradores |
| `clients` | Clientes del período: contacto, citas por estado, última cita, nuevo/recurrente | **Solo administradores** (contiene datos personales) |

Períodos por defecto: diario = hoy; semanal = semana en curso (lunes–domingo); mensual = mes en curso; próximas = hoy + 30 días; clientes = 90 días; resto = últimos 30 días. Todos son editables.

## Filtros (compartidos por indicadores, gráficos, tablas y PDF)

- **Período**: fechas locales del negocio, inclusivas (`from`, `to`). Máximo **366 días**; `to ≥ from`; fechas reales. Se interpretan en la zona horaria configurada (una cita a las 00:30 locales pertenece a ese día aunque en UTC sea el anterior).
- **Estado**: `status=pending,confirmed,…`. Seleccionar los cuatro equivale a no filtrar.
- **Motivo**: texto que debe contener el motivo (sin distinguir mayúsculas).
- Si faltan fechas, el servidor aplica el período por defecto del informe y lo devuelve en `period`.

## Definiciones

**Estados.** *Pendiente*: reserva sin confirmar. *Confirmada*: aceptada por el negocio. *Completada*: el equipo la marcó como atendida. *Cancelada*: anulada por el cliente o el equipo. No existe el estado «no se presentó»: una cita pasada que sigue pendiente o confirmada **no tiene resultado registrado**.

**Citas programadas** = citas con fecha de inicio dentro del período que cumplen los filtros, en cualquier estado.

| Indicador | Fórmula | Cuándo muestra «Datos insuficientes» |
|---|---|---|
| Completadas / Canceladas / Pendientes / Confirmadas | Recuento por estado actual | — |
| **Citas completadas (vencidas, sin canceladas)** | `completadas ÷ (completadas + vencidas sin cerrar)` solo con citas **ya transcurridas**; las canceladas no entran en la fórmula. **No es asistencia**: el modelo no registra inasistencias, por lo que la asistencia real no es calculable | Sin citas vencidas no canceladas; si las vencidas sin cerrar (pendientes/confirmadas pasadas) superan a las completadas; si el filtro de estado excluye completadas, pendientes o confirmadas |
| **Tasa de cancelación** | `canceladas ÷ programadas` (todos los estados; el filtro de motivo sí aplica) | Sin citas en el período; con cualquier filtro de estado (el denominador dejaría de ser «todas») |
| Próximas citas | Pendientes o confirmadas con inicio posterior al momento de generar el informe | — |
| **Reprogramadas** | Citas del período con **al menos un** cambio de horario en el registro de actividad. Una cita movida varias veces cuenta **una sola vez** y no duplica la atención | — |
| **Clientes nuevos / recurrentes** | Entre los clientes con al menos una cita no cancelada en el período: *recurrente* = tiene citas no canceladas anteriores al período; *nuevo* = su primera cita no cancelada cae en el período | Si el sistema no tiene citas anteriores al período (todos parecerían nuevos) |
| Demanda por día / franja | Citas programadas según día de la semana y hora de inicio locales | — |
| Motivos más frecuentes | Recuento agrupando ignorando mayúsculas y espacios repetidos (son texto libre) | — |

Reglas que evitan cifras engañosas: las citas pendientes **no** se clasifican como completadas; la asistencia **no** se calcula ni se infiere (una cancelación nunca se interpreta como inasistencia); las citas futuras y las pasadas sin cerrar quedan fuera del denominador (y se avisa de cuántas hay).

**Comparación con el período anterior equivalente** (solo en el informe operativo): mismo número de días, terminando el día anterior al inicio, con los mismos filtros. `delta = actual − anterior`; `variación % = delta ÷ anterior × 100`; si el anterior es 0 se indica «sin base de comparación». En porcentajes se muestra la diferencia en puntos (pp).

**Fuente de las reprogramaciones.** La tabla de citas solo guarda el horario actual, así que los cambios de horario se leen de `audit_log` (`appointment.reschedule`, que guarda de→a y quién). Cubre todo lo hecho desde que existe la aplicación.

## PDF

- Generado en el backend con **PDFKit** (JavaScript puro, sin dependencias nativas), tipografía Manrope, logotipo oficial (`web/public/brand/logoSupernova.png`) y la paleta de Supernova.
- Contenido: logotipo y título en cada página, período, filtros aplicados, fecha y hora de generación (en la zona del negocio), indicadores con comparación, gráficos vectoriales (líneas, barras, anillo, barras horizontales), tablas con **cabecera repetida** y rótulo «(continuación)» al cambiar de página, fila de totales, definiciones y **numeración «Página i de N»**.
- `?download=1` devuelve `attachment`; sin él, `inline` (vista previa en un iframe del propio panel; por eso la CSP usa `frame-ancestors 'self'` y `object-src 'self'`).
- Nombre de archivo: `supernova-<informe>-<desde>_<hasta>.pdf`.

## Rendimiento y segundo plano

Las consultas son de **solo lectura y no toman el bloqueo de escritura** de las reservas (`GET_LOCK`), por lo que un informe no puede retrasar reservas ni los recordatorios de WhatsApp. Un informe carga como máximo 20.000 citas (si hay más, error claro «acota el período»), las tablas muestran hasta 2.000 filas (el resto se indica como omitido; los totales e indicadores usan siempre todas las citas), el renderizado cede el control al bucle de eventos cada 100 filas y solo se generan **2 PDF a la vez** (el resto recibe 429). Con estos límites un informe de ~2.000 filas tarda poco más de medio segundo, por lo que no se ha añadido una cola de trabajos; si el volumen creciera, el siguiente paso sería generar los PDF en un `worker_thread` o en el proceso `worker`.

## Seguridad y datos personales

- Sesión obligatoria; el informe de clientes (nombre, teléfono, correo) solo para administradores, comprobado en el backend (403) y reflejado en la interfaz.
- Minimización: fuera del informe de clientes no aparecen correos; el teléfono solo aparece en agendas, como en el panel.
- Cada PDF queda en `audit_log` (`report.pdf`: quién, informe, período, filtros, modo, tamaño y tiempo) **sin datos de clientes**; las vistas del informe de clientes también (`report.view`).
- Límites de peticiones por usuario (120 vistas / 5 min, 30 PDF / 10 min) y respuestas con `Cache-Control: no-store`.

## Pruebas

`server/test/reports.test.ts` (22 pruebas, contra MySQL): fórmulas puras (citas completadas, cancelación, variaciones, motivos, nuevos/recurrentes, series y zona horaria); totales de pantalla = recuentos SQL; filtros de estado y motivo aplicados a indicadores, gráficos y tablas; reprogramaciones sin duplicar; límites de fechas y errores 400/404; períodos vacíos en los ocho informes (incluido el PDF); permisos por rol, cabeceras del PDF y auditoría; ausencia de correos fuera del informe de clientes; **PDF multipágina** (480 filas: ≥ 8 páginas, numeración de cada página, cabecera repetida, fila de totales, cifras idénticas a las de pantalla, logotipo incrustado); tope de filas; y que generar informes no impide reservar.

## Informe de operaciones

El informe «Operaciones» (solo administradores) totaliza depósitos y reembolsos por moneda y estado; ver [OPERATIONS.md](OPERATIONS.md).
