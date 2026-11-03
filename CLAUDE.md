# Rumbo · la app del equipo (antes «Plan de batalla»)

- Web estática (sin build) en Vercel, proyecto `plan-de-batalla`, rama `plan-de-batalla` del repo FISIO365/FISIO365. Dirección: rumbo-equipos.vercel.app (también plan-de-batalla.vercel.app). Rumbo no es de la clínica: textos y ejemplos genéricos (oficina, empresa), nunca de fisioterapia.
- Datos: Supabase (proyecto de Fisio School), tablas `pb_*` con RLS. Función edge `plan-equipo` para crear equipo, altas y contraseñas.
- Archivos: `app.js` (entrada, plan, equipo, permisos), `estadisticas.js`, `condiciones.js` (condiciones, bandeja, PDF), `archivos.js`, `partes.js` (BP/7R y Control), `guia.js` (guía), `app.css`. Al cambiar algo, subir `?v=` en `index.html`.
- Permisos: una sola persona administra el equipo. Lo que ve cada uno se decide en «Quién ve qué»; ver no es poder cambiar.
- Estilo: coral #c2552e, cremas, Poppins, iconos de línea fina, nada de ventanas nativas del navegador (usar `modal()`, `pregunta()`).
- Tono: castellano cercano, nada comercial.

## Norma: la guía va siempre al día
Cada cambio que note el equipo (pantalla, botón, flujo, texto, sección nueva) se hace **junto con** su explicación en `guia.js` (array `GUIA`), en el mismo commit:
- Actualiza el apartado que toque, o añade uno nuevo (con `tab` si tiene sección propia, para el botón «Ir a…»).
- Si el cambio es importante para cómo trabaja el equipo, sube `GUIA_VER`: a todos les vuelve a salir la guía una vez.
No hace falta para arreglos internos que nadie nota.
