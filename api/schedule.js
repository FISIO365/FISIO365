const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'Falta patientId' });

  try {
    const planUrl = `https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula={PacienteID}="${patientId}"&sort[0][field]=FechaAsignacion&sort[0][direction]=desc&maxRecords=1`;
    const planRes = await fetch(planUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const planData = await planRes.json();

    if (!planData.records?.length) return res.status(200).json({ ejercicios: [], fisio: null });

    const plan = planData.records[0].fields;
    let ejercicios = [];
    try { ejercicios = JSON.parse(plan['Ejercicios'] || '[]'); } catch(e) { ejercicios = []; }

    ejercicios = ejercicios.map((ej, i) => {
      const ytUrl = ej.youtubeUrl || '';
      const ytMatch = ytUrl.match(/(?:v=|youtu\.be\/)([^&\s]+)/);
      return {
        id: `ej_${i}`,
        name: ej.nombre || '',
        zona: ej.zona || '',
        series: parseInt(ej.series) || 0,
        reps: parseInt(ej.reps) || 0,
        dur: parseInt(ej.duracion) || 0,
        descanso: parseInt(ej.descanso) || 0,
        desc: ej.descripcion || '',
        ytId: ytMatch ? ytMatch[1] : '',
        imagen: ej.imagen || '',
      };
    });

    let fisio = null;
    const fisioId = plan['FisioID'];
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
