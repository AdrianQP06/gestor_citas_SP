# Solicitar atención al cliente

Sección independiente del portal público de reservas (`/reservar/atencion`) para quien **no encuentra una fecha** o **necesita atención urgente**. Se enlaza desde el primer paso de la reserva.

> **Es una bandeja, no un envío.** La aplicación solo **registra** la solicitud. No envía ningún mensaje ni sabe si alguien llegó a contactar a la persona: el equipo la contacta **a mano** (teléfono o WhatsApp, con enlaces en la tarjeta) y marca el resultado. El texto que ve la persona lo dice expresamente y no promete plazos.

## Qué se pidió y qué se implementó
- **Motivos:** «No encuentro fecha», «Necesito atención urgente» y «Otro motivo».
- **Persistencia y gestión interna:** tabla `support_requests` (migración `003_support_requests.sql`) y pantalla **Atención al cliente** del panel (personal y administradores).
- **Contacto:** enlaces `tel:` y `wa.me` en cada solicitud (patrón ya usado en la cita). Si en Configuración hay un «teléfono de contacto», el portal lo muestra como alternativa para urgencias; **no se inventa ningún número**.
- **Aviso por WhatsApp al número de atención: NO implementado.** Requiere decisiones y recursos que no existen en el proyecto (ver «Decisiones pendientes»). Hoy el proveedor de WhatsApp solo envía recordatorios con una plantilla aprobada y por defecto está en modo `test`; no se ha simulado ningún envío.

## Datos y privacidad
Nombre, teléfono, motivo, mensaje opcional (≤ 300 caracteres) y la fecha del consentimiento («Acepto que el equipo use mi nombre y teléfono únicamente para contactarme sobre esta solicitud»). No se pide correo. El registro de actividad solo guarda el motivo, sin datos personales. No hay purga automática (limitación: borrar solicitudes antiguas es una tarea manual de base de datos).

## Estados
```
pending ──atender──▶ attended      pending ──cerrar (nota obligatoria)──▶ closed
```
- `pending` Pendiente · `attended` Atendida (alguien del equipo confirma que contactó/atendió) · `closed` Cerrada sin atender (duplicada, sin respuesta…).
- Los dos finales son definitivos y guardan quién, cuándo y una nota. No existe un estado «fallida»: sin canal automático no hay envíos que puedan fallar.
- El `UPDATE` se condiciona a `status = 'pending'` dentro de una transacción (dos personas no pueden resolver la misma solicitud), y un `CHECK` de la base exige responsable y fecha en las resueltas.

## Protección del formulario público
Validación en el servidor (Zod): nombre, teléfono (7–15 dígitos), motivo, mensaje y **consentimiento obligatorio**; campo trampa `website`; límite de **5 intentos por IP y hora** (cuentan también los inválidos); **no se duplica** una solicitud pendiente del mismo número en 24 h (misma respuesta, sin revelar nada); respeta el interruptor «portal activo» de la configuración.

## API
| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/v1/public/support-requests` | público |
| GET | `/api/v1/support-requests[?status=]` y `/summary` | sesión |
| POST | `/api/v1/support-requests/:id/attend` · `/:id/close` | sesión |

## Decisiones pendientes para añadir el aviso por WhatsApp
1. **Número de atención al cliente** que recibiría el aviso (no es necesariamente el teléfono de contacto público de la configuración).
2. **Plantilla de WhatsApp Business aprobada por Meta** (p. ej. «Solicitud de {{nombre}}: {{motivo}}») y las credenciales de producción (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`); hoy no están configuradas.
3. Con eso se añadiría un estado de aviso (enviado/fallido) y reintentos en el worker existente. Hasta entonces la bandeja del panel es el único canal.

## Pruebas
`server/test/support.test.ts` (8 pruebas): alta y fechas reales, auditoría sin datos personales, validaciones, deduplicación y límite por IP, interruptor del portal, autenticación, atender/cerrar, estados finales, restricción de la base y ausencia de efectos sobre citas/clientes/recordatorios.
