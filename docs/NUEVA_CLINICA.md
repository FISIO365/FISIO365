# Dar de alta una clínica nueva (marca blanca)

Cada clínica tiene **su propio despliegue** en Vercel (el mismo código, conectado al mismo repositorio: se actualiza sola con cada cambio)
y **su propio espacio** en la base de datos de Supabase (proyecto «Clínica», organización FISIO365). Sin coste extra por clínica.
Ejemplo completo funcionando: **Clínica Demo** (proyecto Vercel `clinica-demo`, https://demo-clinica-panel.vercel.app, entra Laura / 1234).

## 1. Base de datos (Supabase › SQL) — 2 minutos
Un espacio (schema) y una llave (rol) por clínica. La llave solo ve su espacio: ni FISIO365 ve a la clínica ni la clínica a FISIO365.
```sql
create role app_<clinica> with login password '<contraseña larga aleatoria>';
grant app_<clinica> to postgres;
create schema <clinica> authorization app_<clinica>;
revoke all on schema <clinica> from public;
alter role app_<clinica> set search_path = <clinica>;
alter role app_<clinica> set statement_timeout = '30s';
```
Las tablas se crean solas la primera vez que se abre la app.

## 2. Archivos
En la función `archivos` de Supabase, añadir a `CLAVES` la huella (SHA-256) de una clave nueva → carpeta `clinicas/<clinica>/`.
Cada clínica solo puede leer y escribir en su carpeta.

## 3. Proyecto en Vercel (mismo repositorio FISIO365/FISIO365)
| Variable | Valor |
|---|---|
| `CLINICA` | id corto, p. ej. `fisiomar` (**imprescindible**: así nunca hereda datos de FISIO365) |
| `CLINICA_NOMBRE` | nombre provisional hasta que lo pongan en Ajustes |
| `DB_URL` | `postgresql://app_<clinica>.nxfhsachzmxylejrcxwb:<contraseña>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres` |
| `ARCHIVOS_URL` | `https://nxfhsachzmxylejrcxwb.supabase.co/functions/v1/archivos` |
| `ARCHIVOS_CLAVE` / `ARCHIVOS_PREFIJO` | la clave del paso 2 / `clinicas/<clinica>/` |
| `APP_URL` | su dirección, p. ej. `https://app.fisiomar.es` |
| `FISIO_PASSWORD`, `AIRTABLE_TOKEN`, `CRON_SECRET` | valores aleatorios largos (`AIRTABLE_TOKEN` ya no es de Airtable: firma los enlaces) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | claves nuevas de notificaciones |
| `BREVO_API_KEY` | su Brevo (emails; remitente verificado = el email de la clínica) |
| `STRIPE_SECRET_KEY`, `HOLDED_API_KEY`, `ANTHROPIC_API_KEY` | opcionales: cobros, facturas, IA |
| `SIN_ENVIOS` | **solo para demos**: no manda emails, avisos, cobros ni nada a Holded |

Las claves **nunca** se pegan en el chat ni en el código: van directamente en Vercel.
Protección de despliegues: «solo previews» (la de producción tiene que ser pública para los pacientes).

## 4. La clínica entra por primera vez
Al abrir `/fisio` sin ningún usuario sale **«Crea tu clínica»**: nombre de la clínica, su nombre y PIN (queda como dirección, con todos los accesos).
Luego, en **Administración › Ajustes**: datos de la clínica (razón social, NIF, dirección, IBAN, reseñas), logo, color, icono, textos legales,
servicios y precios de la app, mensajes a pacientes. Y da de alta a su equipo.

## Qué ya va solo
- Nombre, logo, color, icono, teléfono, dirección y datos legales salen de Ajustes en el panel, la app, las páginas, los PDF y los emails.
- Todo lo que sale hacia pacientes (WhatsApp, email, copiar, compartir) va con los datos de la clínica.
- Lo que no hayan rellenado sale **vacío**, nunca con los datos de FISIO365 (ni su IBAN ni su teléfono).
- Cursos técnicos de FISIO365 ocultos; los de la bomba, solo si la tienen activada.
- App del paciente: se instala desde el navegador con su nombre e icono. La app de Google Play es solo de FISIO365.

## Demo
`/api/schedule?action=demo-datos&op=borrar|sembrar&k=<MIGRAR_KEY>` (solo con `CLINICA=demo`) vacía o vuelve a llenar la demo con datos inventados.
