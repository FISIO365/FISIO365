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

  try {
    const fields = ['FECHA','HORA','ESTADO','PREF.','TIPO DE CITA','fldJM6ZCclnLBsKxp'];
    const fp = fields.map(f=>`fields[]=${encodeURIComponent(f)}`).join('&');
    const sortQ = 'sort[0][field]=FECHA&sort[0][direction]=asc';

    // Filter directly in Airtable by PacienteId formula field — fast!
    const formula = patientId
      ? encodeURIComponent(`AND({fldJM6ZCclnLBsKxp}="${patientId}",OR({ESTADO}="PENDIENTE ",{ESTADO}="REALIZADA"))`)
      : '';
    const filterQ = formula ? `&filterByFormula=${formula}` : '';

    const r = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${CITAS_TABLE}?${fp}&${sortQ}${filterQ}&pageSize=100`,
      { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const data = await r.json();
    if (data.error) return new Response(JSON.stringify({ ok: false, error: data.error.message }), { headers: corsHeaders });

    const citas = (data.records || []).map(rec => ({
      id: rec.id,
      fecha: rec.fields['FECHA'] || '',
      hora: rec.fields['HORA'] || '',
      estado: rec.fields['ESTADO'] || '',
      fisio: (() => {
        const v = rec.fields['PREF.'];
        if(!v) return '';
        if(Array.isArray(v)) return v.filter(x=>!String(x).startsWith('rec')).join(', ');
        return String(v).startsWith('rec') ? '' : String(v);
      })(),
      tipo: (() => {
        const v = rec.fields['TIPO DE CITA'];
        if(!v) return '';
        if(Array.isArray(v)) return v.filter(x=>!String(x).startsWith('rec')).join(', ');
        return String(v).startsWith('rec') ? '' : String(v);
      })()
    }));

    return new Response(JSON.stringify({ ok: true, citas }), { headers: corsHeaders });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
  }
}
