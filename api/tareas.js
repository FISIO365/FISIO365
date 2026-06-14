export const config = { runtime: 'edge' };

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors });

  const url = new URL(req.url);
  const pwd = url.searchParams.get('pwd') || '';

  // GET - listar tareas de un paciente (sin pwd para app paciente)
  if (req.method === 'GET') {
    const pacienteId = url.searchParams.get('pacienteId') || '';
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
      return new Response(JSON.stringify({ ok: true, tareas }), { headers: cors });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: cors });
    }
  }

  // POST - guardar tarea hecha
  if (req.method === 'POST') {
    const body = await req.json();
    const { pacienteId, pacienteNombre, fecha, nota } = body;
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TAREAS_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: {
          [F_PAC_ID]:  pacienteId || '',
          [F_PAC_NOM]: (pacienteNombre || '').toUpperCase(),
          [F_FECHA]:   fecha || new Date().toLocaleDateString('es-ES'),
          [F_NOTA]:    nota || ''
        }}]})
      });
      const data = await r.json();
      if (data.error) return new Response(JSON.stringify({ ok: false, error: data.error.message }), { headers: cors });
      return new Response(JSON.stringify({ ok: true, id: data.records?.[0]?.id }), { headers: cors });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: cors });
    }
  }

  return new Response(JSON.stringify({ ok: false }), { status: 405, headers: cors });
}
