# 🏥 FISIO365 — Guía de publicación

## ¿Qué hay en este proyecto?

```
fisio365/
├── public/
│   └── index.html        ← App del paciente (login PIN + calendario + ejercicios)
├── api/
│   ├── login.js          ← Verifica nombre + PIN contra Airtable
│   ├── schedule.js       ← Devuelve ejercicios por día del paciente
│   └── done.js           ← Guarda ejercicios marcados como hechos
└── vercel.json           ← Configuración de despliegue
```

---

## PASO 1 — Preparar Airtable

Necesitas añadir/crear estas cosas en tu base **PACIENTES & CITAS**:

### 1a. Añadir campo PIN a tu tabla PACIENTES
- Abre Airtable → base "PACIENTES & CITAS" → tabla "PACIENTES"
- Añade un campo nuevo llamado **PIN** de tipo "Single line text"
- Para cada paciente, escribe un PIN de 4 dígitos (ej: 1234, 5678...)
- El fisio le da ese PIN al paciente en consulta o por WhatsApp

### 1b. Crear tabla EJERCICIOS (nueva)
Crea una tabla llamada **EJERCICIOS** con estos campos:
| Campo | Tipo |
|-------|------|
| Nombre | Single line text |
| Zona | Single line text |
| Series | Number |
| Reps | Number |
| Duracion | Number (segundos) |
| Descanso | Number (segundos) |
| Descripcion | Long text |
| YouTubeURL | URL |

### 1c. Crear tabla PLAN_EJERCICIOS (nueva)
Crea una tabla llamada **PLAN_EJERCICIOS** con estos campos:
| Campo | Tipo |
|-------|------|
| PacienteID | Single line text (aquí va el Record ID del paciente) |
| Fecha | Date (formato YYYY-MM-DD) |
| EjercicioNombre | Single line text |
| Zona | Single line text |
| Series | Number |
| Reps | Number |
| Duracion | Number |
| Descanso | Number |
| Descripcion | Long text |
| YouTubeURL | URL |

> **Consejo:** Puedes enlazar con Link to Record a EJERCICIOS para no repetir datos.

### 1d. Crear tabla EJERCICIOS_HECHOS (nueva)
Crea una tabla llamada **EJERCICIOS_HECHOS** con estos campos:
| Campo | Tipo |
|-------|------|
| PacienteID | Single line text |
| Fecha | Single line text |
| EjercicioID | Single line text |
| Hecho | Checkbox |
| FechaHecho | Single line text |

---

## PASO 2 — Obtener tu token de Airtable

1. Ve a https://airtable.com/create/tokens
2. Haz clic en **"Create new token"**
3. Nombre: `fisio365`
4. Scopes: marca `data.records:read` y `data.records:write`
5. Bases: selecciona "PACIENTES & CITAS"
6. Copia el token (empieza por `pat...`) — **guárdalo, solo se muestra una vez**

---

## PASO 3 — Subir a Vercel

### Opción A: Desde GitHub (recomendado)
1. Crea cuenta en https://github.com (si no tienes)
2. Crea un repositorio nuevo llamado `fisio365`
3. Sube estos archivos al repositorio
4. Ve a https://vercel.com → "Add New Project" → conecta GitHub
5. Selecciona el repositorio `fisio365`
6. En **Environment Variables** añade:
   ```
   AIRTABLE_TOKEN = pat_tu_token_aqui
   ```
7. Haz clic en **Deploy** ✅

### Opción B: Con Vercel CLI
```bash
npm i -g vercel
vercel login
vercel --prod
# Cuando pregunte por env vars, añade AIRTABLE_TOKEN
```

---

## PASO 4 — Probar

1. Ve a tu URL de Vercel (ej: `fisio365.vercel.app`)
2. Escribe el nombre de un paciente
3. Introduce su PIN
4. ¡Debería entrar a su panel!

---

## PASO 5 — Personalizar el link de reseña Google

En `public/index.html`, busca esta línea:
```javascript
window.open('https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID','_blank');
```
Reemplaza `YOUR_PLACE_ID` con el ID de tu negocio en Google.

Para encontrarlo: busca tu clínica en Google Maps → comparte → copia el enlace y extrae el ID.

---

## Flujo completo

```
Fisio crea paciente en Airtable → asigna PIN de 4 dígitos
         ↓
Fisio añade ejercicios en PLAN_EJERCICIOS por fecha
         ↓
Fisio manda la URL + PIN al paciente por WhatsApp
         ↓
Paciente entra desde el móvil → escribe nombre + PIN
         ↓
Ve su calendario con sus ejercicios del día
         ↓
Marca ejercicios como hechos → se guarda en Airtable
```

---

## ❓ ¿Dudas?

Si algo no funciona, comprueba:
- Que el token de Airtable tiene permisos correctos
- Que los nombres de las tablas coinciden exactamente
- Los logs en Vercel Dashboard → Functions

