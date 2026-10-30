# FISIO365 · panel y app del paciente

- Panel del equipo: `public/fisio.html`. App del paciente: `public/index.html`. Backend: `api/` (Vercel, `vercel.json` con builds + routes: un archivo estático nuevo necesita las dos entradas).
- Datos: Airtable (base por clínica, ids traducidos en `api/_base.js`). Marca de cada clínica: `api/_marca.js` + `public/marca.js`. Montar otra clínica: `docs/NUEVA_CLINICA.md`.
- Tono: castellano cercano, nada comercial ni forzado. Estética: coral #c2552e, cremas, Poppins, iconos de línea fina, nada de controles nativos sin estilo.

## Norma: el curso «Cómo funciona la app» va siempre al día
Cada cambio que note el equipo (pantalla, botón, flujo, texto que ve el paciente) se hace **junto con**, en el mismo commit:
1. **El curso** — `MODS_APP_PACIENTE` en `public/fisio.html` (School › «Cómo funciona la app», id `appEquipo`). Actualiza la lección que toque o añade una. Si el cambio tiene un sitio claro en pantalla, pon `ver:{sec, el, txt}` en la tarjeta para el botón «Enséñamelo» (`sec` = sección de `showSection`, `el` = selector que exista con la sección abierta). Si un módulo nuevo cambia el total, sube `pasos` en `WIKI_RUTAS`.
2. **Novedades** — añade una línea arriba del todo en `NOVEDADES` (`{f:'AAAA-MM-DD', t:'…'}`; `dir:1` si solo interesa a dirección). Una frase, en el idioma del equipo: qué hay nuevo y dónde está.
No hace falta para arreglos internos que nadie nota.
