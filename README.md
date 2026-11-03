# Plan de batalla (app aparte)

App web del Plan de batalla del panel FISIO365, con equipos y permisos de quién revisa a quién, y estadísticas con tendencia.

- Web estática (sin build): `index.html`, `app.css`, `app.js`, `estadisticas.js`. Se publica en Vercel (proyecto `plan-de-batalla`) desde esta rama.
- Datos: Supabase, proyecto `fisio-school` (tablas `pb_*`, con seguridad por filas). Altas de equipo y personas: función `plan-equipo`.
- Al cambiar `app.css`, `app.js` o `estadisticas.js`, sube el `?v=` en `index.html`.
