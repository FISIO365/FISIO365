// api/schedule.js - Devuelve el plan activo del paciente
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';
const HECHOS_TABLE = 'tblSABQ4KLpDUsERy';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'Falta patientId' });

  try {
    const today = new Date().toISOString().split('T')[0];

    // Obtener plan activo del paciente (el más reciente)
    const planUrl = `https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula={PacienteID}="${patientId}"&sort[0][field]=FechaAsignacion&sort[0][direction]=desc&maxRecords=1`;
    const planRes = await fetch(planUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const planData = await planRes.json();

    if (!planData.records || planData.records.length === 0)
      return res.status(200).json({ plan: null, ejercicios: [], hechos: [] });

    const plan = planData.records[0];
    const ejerciciosRaw = plan.fields['Ejercicios'] || '[]';
    let ejercicios = [];
    try { ejercicios = JSON.parse(ejerciciosRaw); } catch(e) { ejercicios = []; }

    // Obtener qué ejercicios ha hecho hoy
    const hechosUrl = `https://api.airtable.com/v0/${BASE_ID}/${HECHOS_TABLE}?filterByFormula=AND({PacienteID}="${patientId}",{Fecha}="${today}")`;
    const hechosRes = await fetch(hechosUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const hechosData = await hechosRes.json();
    const hechos = (hechosData.records || []).filter(r => r.fields['Hecho']).map(r => r.fields['EjercicioNombre']);

    // Info del fisio
    const fisioId = plan.fields['FisioID'];
    let fisio = { nombre: plan.fields['FisioNombre'] || '', colegiado: '', foto: '' };
    if (fisioId) {
      const fisioRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/tbl2mLUrnaKCFTs6g/${fisioId}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      if (fisioRes.ok) {
        const fisioData = await fisioRes.json();
        const ff = fisioData.fields || {};
        fisio = {
          nombre: ff['Name'] || '',
          colegiado: ff['NºColegiado'] || '',
          foto: ff['Foto']?.[0]?.url || ''
        };
      }
    }

    return res.status(200).json({ plan: { fisio }, ejercicios, hechos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
