// api/schedule.js - Devuelve el plan activo del paciente
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const PLAN_TABLE = 'PLAN';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'Falta patientId' });

  try {
    const planUrl = `https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula={PacienteID}="${patientId}"`;
    const planRes = await fetch(planUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const planData = await planRes.json();

    const ejercicios = [];
    let fisioId = null;

    for (const rec of (planData.records || [])) {
      const f = rec.fields;
      if (!fisioId && f['FisioID']) fisioId = f['FisioID'];
      const ytUrl = f['YouTubeURL'] || '';
      const ytMatch = ytUrl.match(/(?:v=|youtu\.be\/)([^&\s]+)/);
      ejercicios.push({
        id: rec.id,
        name: f['EjercicioNombre'] || '',
        zona: f['Zona'] || '',
        series: parseInt(f['Series']) || 3,
        reps: parseInt(f['Reps']) || 0,
        dur: parseInt(f['Duracion']) || 0,
        descanso: parseInt(f['Descanso']) || 0,
        desc: f['Descripcion'] || '',
        ytId: ytMatch ? ytMatch[1] : '',
      });
    }

    let fisio = null;
    if (fisioId) {
      const fisioRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}/${fisioId}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      if (fisioRes.ok) {
        const fd = await fisioRes.json();
        fisio = {
          nombre: fd.fields['Name'] || '',
          colegiado: fd.fields['NºColegiado'] || '',
          foto: fd.fields['Foto']?.[0]?.url || ''
        };
      }
    }

    return res.status(200).json({ ejercicios, fisio });
  } catch(e) {
    return res.status(200).json({ ejercicios: [], fisio: null });
  }
}
