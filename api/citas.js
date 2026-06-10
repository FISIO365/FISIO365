export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const CITAS_TABLE = 'tblTPlcuiSjQngkaD';

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const patientId = url.searchParams.get('patientId') || '';

  if (!patientId) {
    return new Response(JSON.stringify({ ok: false, error: 'patientId requerido' }), { headers: corsHeaders });
  }

  try {
    const fields = ['FECHA','HORA','ESTADO','PREF.','TIPO DE CITA','NOTAS','RELACIÓN - CITA'];
    const fp = fields.map(f=>`fields[]=${encodeURIComponent(f)}`).join('&');
    const sortQ = 'sort[0][field]=FECHA&sort[0][direction]=asc&sort[1][field]=HORA&sort[1][direction]=asc';

    // Get all citas and filter client-side by linked record ID
    let allRecords = [];
    let offset = null;
    do {
      const offsetQ = offset ? `&offset=${offset}` : '';
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${CITAS_TABLE}?${fp}&${sortQ}&pageSize=100${offsetQ}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      if (data.error) return new Response(JSON.stringify({ ok: false, error: data.error.message }), { headers: corsHeaders });
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset;
    } while(offset);

    // Filter by patient ID in linked record field
    const citas = allRecords
      .filter(rec => {
        const relacionados = rec.fields['RELACIÓN - CITA'] || [];
        return Array.isArray(relacionados) && relacionados.includes(patientId);
      })
      .map(rec => ({
        id: rec.id,
        fecha: rec.fields['FECHA'] || '',
        hora: rec.fields['HORA'] || '',
        estado: rec.fields['ESTADO'] || '',
        fisio: Array.isArray(rec.fields['PREF.']) ? rec.fields['PREF.'].join(', ') : (rec.fields['PREF.'] || ''),
        tipo: Array.isArray(rec.fields['TIPO DE CITA']) ? rec.fields['TIPO DE CITA'].join(', ') : (rec.fields['TIPO DE CITA'] || ''),
        notas: rec.fields['NOTAS'] || ''
      }));

    return new Response(JSON.stringify({ ok: true, citas, total: allRecords.length }), { headers: corsHeaders });
  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
  }
}
