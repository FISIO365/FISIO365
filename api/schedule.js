const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';
const INFORMES_TABLE = 'tblwvWQxXNJPdR0Iv';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { patientId, action } = req.query;
  if (!patientId) return res.status(400).json({ error: 'Falta patientId' });

  // ── LISTAR INFORMES DEL PACIENTE ─────────────────────────────────────────
  if (action === 'informes') {
    try {
      const fields = 'fields[]=PacienteId&fields[]=PacienteNombre&fields[]=FisioNombre&fields[]=Fecha&fields[]=Informe&fields[]=Protocolo';
      let allRecords = [];
      let offset = null;
      do {
        const off = offset ? '&offset='+offset : '';
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}?${fields}&sort[0][field]=Fecha&sort[0][direction]=desc&pageSize=100${off}`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const data = await r.json();
        console.log('Airtable response sample:', JSON.stringify(data.records?.[0]?.fields));
        allRecords = allRecords.concat(data.records || []);
        offset = data.offset || null;
      } while (offset);
      const informes = allRecords
        .filter(rec => (rec.fields['PacienteId'] || rec.fields['fldDR9XqkJ9oA3WK0'] || '') === patientId)
        .map(rec => ({
          id: rec.id,
          fecha: rec.fields['Fecha'] || '—',
          tipo: rec.fields['Protocolo'] || '—',
          fisioNombre: rec.fields['FisioNombre'] || '—',
          contenido: rec.fields['Informe'] || ''
        }));
      return res.status(200).json({ ok: true, informes });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET PROGRAMA ─────────────────────────────────────────────────────────
  try {
    const planUrl = `https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula={PacienteID}="${patientId}"&sort[0][field]=FechaAsignacion&sort[0][direction]=desc&maxRecords=1`;
    const planRes = await fetch(planUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const planData = await planRes.json();
    if (!planData.records?.length) return res.status(200).json({ ejercicios: [], fisio: null, mensajeFisio: '', ultimaSession: '' });
    const plan = planData.records[0].fields;
    let ejercicios = [];
    try { ejercicios = JSON.parse(plan['Ejercicios'] || '[]'); } catch(e) { ejercicios = []; }
    ejercicios = ejercicios.map((ej, i) => {
      const ytUrl = ej.youtubeUrl || '';
      const ytMatch = ytUrl.match(/(?:v=|youtu\.be\/|shorts\/)([^&\s?]+)/);
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
    return res.status(200).json({
      ejercicios,
      fisio,
      mensajeFisio: plan['MensajeFisio'] || '',
      ultimaSession: plan['UltimaSession'] || ''
    });
  } catch(e) {
    return res.status(200).json({ ejercicios: [], fisio: null, mensajeFisio: '', ultimaSession: '' });
  }
}