export const config = { runtime: 'nodejs' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const TAREAS_TABLE = 'tblIXYE5ToRNY7MN4';

// Field IDs
const F_PAC_ID   = 'fld9vav48MeCYpZXA';
const F_PAC_NOM  = 'fldMVdTRZUzYsUhZg';
const F_FECHA    = 'fldZsAjUSEegQk8Xq';
const F_NOTA     = 'fldOTlWCJgMl074Uo';

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pwd = req.query?.pwd || '';

  // GET - listar tareas de un paciente (sin pwd para app paciente)
  if (req.method === 'GET') {
    const pacienteId = req.query?.pacienteId || '';
    try {
      const formula = pacienteId ? encodeURIComponent(`{${F_PAC_ID}}="${pacienteId}"`) : '';
      const filterQ = formula ? `&filterByFormula=${formula}` : '';
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${TAREAS_TABLE}?fields[]=${F_PAC_ID}&fields[]=${F_PAC_NOM}&fields[]=${F_FECHA}&fields[]=${F_NOTA}&sort[0][field]=${F_FECHA}&sort[0][direction]=desc&pageSize=90${filterQ}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      const tareas = (data.records || []).map(rec => ({
        id: rec.id,
        pacienteId: rec.fields[F_PAC_ID] || '',
        pacienteNombre: rec.fields[F_PAC_NOM] || '',
        fecha: rec.fields[F_FECHA] || '',
        nota: rec.fields[F_NOTA] || ''
      }));
      return res.status(200).json({ ok: true, tareas });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // POST - guardar tarea hecha
  if (req.method === 'POST') {
    const body = req.body || {};
    const { pacienteId, pacienteNombre, fecha, nota } = body;
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TAREAS_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: {
          [F_PAC_ID]:  pacienteId || '',
          [F_PAC_NOM]: (pacienteNombre || '').toUpperCase(),
          [F_FECHA]:   fecha || new Date().toISOString().split('T')[0],
          [F_NOTA]:    nota || ''
        }}]})
      });
      const data = await r.json();
      if (data.error) return res.status(400).json({ ok: false, error: data.error.message });
      return res.status(200).json({ ok: true, id: data.records?.[0]?.id });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false });
}
