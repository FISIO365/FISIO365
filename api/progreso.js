export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PROGRESO_TABLE = 'tblbOukia79RVtTVt';

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // ── GET: leer todo el progreso de un fisio ──────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const fisioId = url.searchParams.get('fisioId') || '';
    if (!fisioId) return new Response(JSON.stringify({ ok: false, error: 'Falta fisioId' }), { status: 400, headers: corsHeaders });

    try {
      const formula = encodeURIComponent(`{FisioId}="${fisioId}"`);
      let allRecords = [], offset = null;
      do {
        const offsetQ = offset ? `&offset=${offset}` : '';
        const r = await fetch(
          `https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}?filterByFormula=${formula}&pageSize=100${offsetQ}`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
        );
        const data = await r.json();
        if (data.error) return new Response(JSON.stringify({ ok: false, error: data.error.message }), { headers: corsHeaders });
        allRecords = allRecords.concat(data.records || []);
        offset = data.offset;
      } while (offset);

      const progreso = {};
      allRecords.forEach(rec => {
        const seccion = rec.fields['Seccion'] || '';
        if (!seccion) return;
        progreso[seccion] = {
          estado: rec.fields['Estado'] || '',
          fecha: rec.fields['Fecha'] || ''
        };
      });

      return new Response(JSON.stringify({ ok: true, progreso }), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── POST: marcar una sección como completada ────────────────────────────
  if (req.method === 'POST') {
    let body = {};
    try { const text = await req.text(); body = text ? JSON.parse(text) : {}; } catch (e) { body = {}; }

    const { fisioId, seccion, estado } = body;
    if (!fisioId || !seccion) {
      return new Response(JSON.stringify({ ok: false, error: 'Faltan datos (fisioId o seccion)' }), { status: 400, headers: corsHeaders });
    }

    try {
      // Comprobar si ya existe un registro para este fisio + sección
      const formula = encodeURIComponent(`AND({FisioId}="${fisioId}",{Seccion}="${seccion}")`);
      const rGet = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}?filterByFormula=${formula}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const dataGet = await rGet.json();
      const existente = (dataGet.records || [])[0];

      const fechaHoy = new Date().toISOString().split('T')[0];
      const fieldsToSave = {
        FisioId: fisioId,
        Seccion: seccion,
        Estado: estado || 'completado'
      };

      if (existente) {
        // Actualizar el registro existente
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}/${existente.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: fieldsToSave })
        });
      } else {
        // Crear registro nuevo
        const rCreate = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields: fieldsToSave }] })
        });
        const dCreate = await rCreate.json();
        if (dCreate.error) {
          return new Response(JSON.stringify({ ok: false, error: dCreate.error.message }), { headers: corsHeaders });
        }
      }

      return new Response(JSON.stringify({ ok: true, fecha: fechaHoy }), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Método no permitido' }), { status: 405, headers: corsHeaders });
}
