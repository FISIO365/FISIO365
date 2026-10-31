# Postgres en lugar de Airtable

La app sigue hablando «en Airtable» (las mismas llamadas a `api.airtable.com` que siempre), pero si existe la
variable **`DB_URL`** esas llamadas no salen a Airtable: las responde **`api/_pg.js`** desde Postgres, con el mismo
formato y las mismas reglas. Sin `DB_URL` no cambia nada.

## Cómo funciona
- **`api/_pg.js`** cambia `fetch` (como ya hacía `api/_base.js`) y atiende: listar con `filterByFormula`, `sort`,
  `fields[]`, `pageSize`, `maxRecords`, `offset`, `returnFieldsByFieldId`; leer un registro; crear, editar y borrar
  (de uno en uno y en lotes de 10, con `typecast`); subir adjuntos (`content.airtable.com/…/uploadAttachment`) y el
  esquema (`/v0/meta/…`). Los errores tienen la misma forma que los de Airtable.
- **`api/_formula.js`**: las fórmulas de Airtable (las de `filterByFormula` y los campos de fórmula) en JavaScript.
- **`api/_schema.json`**: las tablas y campos (sacado de Airtable). Los registros guardan los campos **por nombre** y
  conservan sus ids `rec…`, así que todo lo que guardaba ids en texto sigue valiendo.
- Campos calculados: fórmulas, lookups, fecha de creación, «última modificación» de un campo concreto
  (HISTORIAL ACTUALIZADO), autonuméricos y los dos lados de cada enlace se calculan o mantienen igual que en Airtable.
- **Caché**: cada instancia del servidor guarda las tablas en memoria y en cada petición solo pide a Postgres lo que
  ha cambiado (30 s de margen; lo borrado se apunta en `borrados`). La primera petición de una instancia carga la tabla
  entera (CITAS: ~10.700 filas).
- **Funciones «edge»** (chat, citas, pacientes, fisios, progreso, recordatorios, reservar, diario): no pueden
  conectarse a Postgres; con `DB_URL` mandan cada llamada a `/api/schedule?action=pg-proxy` (lo hace `api/_base.js`).
- **Adjuntos**: tabla `archivos` (bytea). Se sirven en `/api/schedule?action=archivo&id=…&k=…` (la `k` es secreta,
  como los enlaces de Airtable).

Tablas en Postgres (se crean solas): `registros(tabla, id, fields jsonb, creado, modificado)`, `borrados`,
`archivos`, `contadores`.

## Variables de entorno (Vercel)
| Variable | Qué es |
|---|---|
| `DB_URL` | conexión a Postgres (Supabase: la del *pooler*, modo transacción, puerto 6543) |
| `PG_PROXY_KEY` | opcional: clave entre las funciones edge y `pg-proxy` (si no, se deriva de `DB_URL`) |
| `AIRTABLE_TOKEN` | **no borrar el valor**: además de Airtable, firma los enlaces que reciben los pacientes (confirmar cita, app, pagos, encuestas…). Si cambia, los enlaces ya enviados dejan de valer. |
| `APP_URL` | dirección de la app (para los enlaces de los adjuntos y el `pg-proxy`) |

## Copiar los datos
```
AIRTABLE_TOKEN=… DB_URL=… node scripts/migrar.js                 # todo (se puede repetir: copia lo nuevo y borra lo borrado)
AIRTABLE_TOKEN=… DB_URL=… node scripts/migrar.js --sin-adjuntos  # para probar
AIRTABLE_TOKEN=… DB_URL=… node scripts/migrar.js --tabla tbl…    # una tabla
```
Solo lee de Airtable. Copia también la tabla «INCOME / MONTH» de la base de estadísticas (`appR5HDJuhjQG504R`).

## El día del cambio
1. Dejar el panel en pausa (nadie escribiendo) · `node scripts/migrar.js` (segunda pasada, rápida).
2. Poner `DB_URL` en Vercel y volver a desplegar. Comprobar agenda, ficha, dar cita, chat y la app del paciente.
3. Airtable se queda en solo lectura una temporada como copia de seguridad.
Para volver atrás: quitar `DB_URL` y desplegar (lo escrito en Postgres después del cambio no estaría en Airtable).

## Pruebas (sin datos reales)
```
NODE_PATH=<carpeta con @electric-sql/pglite, pg, web-push…> node scripts/pg/prueba.js /tmp/t/formulas.json
… FISIO_PASSWORD=x VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… node scripts/pg/humo.js     # código real de schedule.js
… node scripts/pg/edge.js                                                                # chat.js (edge) → pg-proxy
… node scripts/pg/prueba-migrar.js                                                       # migrar.js con una Airtable falsa
```

## Pendiente / riesgos
- **Región**: las funciones de Vercel están en EE. UU. (iad1); con Supabase en Frankfurt cada consulta tarda ~90 ms
  más. Conviene mover las funciones a `fra1` (`"regions": ["fra1"]` en vercel.json, plan Pro).
- Primera carga de una instancia en frío: varias décimas de segundo a ~1 s (se cargan tablas enteras).
- Los campos de IA de Airtable («Resumen (NOTAS)», «Titular (NOTAS)») se copian pero ya no se generan (el código no los usa).
- Las demás tablas de la base de estadísticas (`appR5HDJuhjQG504R`) no se copian: el código solo usa «INCOME / MONTH».
- Las tablas ANAMNESIS (`tblF4as0orW1b6KIw`) y DOLOR (`tblxJmnb7LHML2ZZh`) que nombra el código no existen en la base
  (hoy fallan igual en Airtable): responden «tabla no encontrada», como ahora.
- Probado con PGlite y datos inventados; falta probarlo con una copia de los datos reales en Supabase.
