// api/programa.js - Guardar plan de ejercicios
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appbK09V4X3pPIai3';
const PLAN_TABLE = 'PLAN';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { pwd, pacienteId, pacienteNombre, fisioId, ejercicios } = req.body;
  if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });
  if (!pacienteId || !ejercicios?.length) return res.status(400).json({ ok: false, error: 'Faltan datos' });

  try {
    // 1. Borrar programa anterior
    const oldRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula={PacienteID}="${pacienteId}"&fields[]=PacienteID`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const oldData = await oldRes.json();
    if (oldData.records?.length > 0) {
      const ids = oldData.records.map(r => r.id);
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?${batch.map(id=>`records[]=${id}`).join('&')}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
        });
      }
    }

    // 2. Crear nuevo programa
    const records = ejercicios.map(ej => ({
      fields: {
        Name: `${pacienteNombre} - ${ej.nombre}`,
        PacienteID: pacienteId,
        FisioID: fisioId || '',
        EjercicioNombre: ej.nombre,
        Zona: ej.zona || '',
        Series: parseInt(ej.series) || 0,
        Reps: parseInt(ej.reps) || 0,
        Duracion: parseInt(ej.duracion) || 0,
        Descanso: parseInt(ej.descanso) || 0,
        Descripcion: ej.descripcion || '',
        ...(ej.youtubeUrl ? { YouTubeURL: ej.youtubeUrl } : {})
      }
    }));

    let creados = 0;
    for (let i = 0; i < records.length; i += 10) {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: records.slice(i, i + 10) })
      });
      const d = await r.json();
      creados += d.records?.length || 0;
    }

    return res.status(200).json({ ok: true, creados });
  } catch(e) {
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
}
