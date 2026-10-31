# Poner la app en otra clínica (piloto)

Cada clínica tiene **su propio despliegue** en Vercel (el mismo código, otro proyecto) y **su propia base de Airtable**.
El código es el mismo para todas: lo que cambia son las variables de entorno y los ajustes que la clínica rellena en el panel.

## 1. Base de datos
1. En Airtable, **duplicar la base de FISIO365 sin los datos** (solo estructura) en la cuenta de la clínica.
2. Crear un token de Airtable de la clínica con permisos `data.records:read`, `data.records:write` y `schema.bases:read` sobre esa base.
3. Dar de alta los fisios en la tabla «⚙ APP · FISIO» (nombre, PIN, accesos).

Los ids de tablas y campos cambian al duplicar una base: el código los traduce solo buscándolos por nombre (`api/_base.js`).
Por eso **no hay que renombrar tablas ni campos** en la copia.

## 2. Proyecto en Vercel (variables de entorno)
| Variable | Qué es |
|---|---|
| `AIRTABLE_BASE_ID` | id de la base de la clínica (`app…`) |
| `AIRTABLE_TOKEN` | token de Airtable de la clínica |
| `APP_URL` | dirección de su app, p. ej. `https://app.suclinica.es` |
| `BREVO_API_KEY` | su cuenta de Brevo (emails). El remitente es el email de «Datos de la clínica» y tiene que estar verificado en su Brevo |
| `STRIPE_SECRET_KEY` | su Stripe (cobros por adelantado) |
| `HOLDED_API_KEY` | su Holded (tickets y facturas), opcional |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | claves de notificaciones (generar unas nuevas) |
| `ANTHROPIC_API_KEY` | IA de los mensajes |
| `RESUMEN_EMAIL` | a quién llega el resumen diario |

Las claves **nunca** se pegan en el chat ni en el código: se ponen directamente en Vercel.

## 3. En el panel (Administración › Ajustes)
- **Datos de la clínica**: nombre, razón social, NIF, dirección, teléfono, WhatsApp, email, enlace de reseñas (Google Place ID), IBAN.
- **Logo y color** de la marca.
- **Icono de la app**: el que sale en el móvil al instalar la app y el panel (cuadrado, 512×512). Si no se sube, se hace uno solo con el nombre y el color de la clínica. El nombre de la app instalada es el «Nombre de la clínica».
- **Opciones**: sorteo de reseñas, bomba diamagnética.
- **App del paciente**: servicios, precios, packs y promociones.
- **Mensajes a pacientes**: los WhatsApp que prepara el panel (recordatorios, encuestas, reseñas, pagos, huecos, facturas), con etiquetas como `{nombre}` o `{enlace}`.
- **Textos legales** del consentimiento (tratamiento, declaraciones, protección de datos, derechos, suelo pélvico, alta oncológica).
- **Listas**, tipos de cita, estados, política de cancelación, check-list, tarjeta regalo.

## Lo que ya va solo
- Los cursos técnicos de School (protocolos y aparatos de FISIO365) no salen en otra clínica; los de la bomba, solo si tiene la bomba activada. «Cómo funciona la app» y «La app del paciente» sirven para todas.
- La app de Google Play es de FISIO365: otra clínica usa la app instalada desde el navegador (con su nombre e icono).
