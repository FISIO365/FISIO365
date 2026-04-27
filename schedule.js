// api/programa.js
// Guarda el programa de ejercicios de un paciente en PLAN_EJERCICIOS

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appbK09V4X3pPIai3';
const PLAN_TABLE = 'tble6NDA3yIcAv5uN';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { pwd, pacienteId, pacienteNombre, fechas, ejercicios } = req.body;

  if (pwd !== FISIO_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
  }

  if (!pacienteId || !fechas?.length || !ejercicios?.length) {
    return res.status(400).json({ ok: false, error: 'Faltan datos' });
  }

  // Construir todos los registros: 1 por ejercicio por día
  const records = [];
  for (const fecha of fechas) {
    for (const ej of ejercicios) {
      const fields = {
        Name: `${pacienteNombre} - ${ej.nombre} - ${fecha}`,
        PacienteID: pacienteId,
        Fecha: fecha,
        EjercicioNombre: ej.nombre,
        Zona: ej.zona || '',
        Series: parseInt(ej.series) || 0,
        Reps: parseInt(ej.reps) || 0,
        Duracion: parseInt(ej.duracion) || 0,
        Descanso: parseInt(ej.descanso) || 0,
        Descripcion: ej.descripcion || '',
      };
      if (ej.youtubeUrl) fields.YouTubeURL = ej.youtubeUrl;
      records.push({ fields });
    }
  }

  // Airtable permite máx 10 registros por petición, hacemos lotes
  const BATCH = 10;
  let creados = 0;
  try {
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records: batch })
      });

      if (!atRes.ok) {
        const err = await atRes.text();
        console.error('Airtable error:', err);
        return res.status(500).json({ ok: false, error: 'Error guardando en Airtable', detail: err });
      }

      const data = await atRes.json();
      creados += data.records?.length || 0;
    }

    return res.status(200).json({ ok: true, creados });

  } catch (err) {
    console.error('Programa error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
}
