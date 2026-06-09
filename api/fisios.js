export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url2 = new URL(req.url);
  const action = url2.searchParams.get('action') || '';

  // GET lista-publica — solo fisios con role=fisio, sin contraseña
  if (req.method === 'GET' && action === 'lista-publica') {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      const data = await r.json();
      const fisios = (data.records || [])
        .filter(rec => (rec.fields['Role'] || '').toLowerCase() === 'fisio')
        .map(rec => ({
          id: rec.id,
          nombre: rec.fields['Name'] || '',
          foto: rec.fields['Foto']?.[0]?.url || ''
        }));
      return new Response(JSON.stringify({ ok: true, fisios }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // GET — lista completa de fisios para selector panel
  if (req.method === 'GET') {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      const data = await r.json();
      const fisios = (data.records || [])
        .filter(rec => rec.fields['Name'] && rec.fields['Password'])
        .map(rec => ({
          id: rec.id,
          nombre: rec.fields['Name'] || '',
          role: rec.fields['Role'] || 'fisio',
          colegiado: rec.fields['NºColegiado'] || '',
          foto: rec.fields['Foto']?.[0]?.url || ''
        }));
      return new Response(JSON.stringify({ ok: true, fisios }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // POST — login fisio
  if (req.method === 'POST') {
    let body = {};
    try { const text = await req.text(); body = text ? JSON.parse(text) : {}; } catch(e) { body = {}; }

    const { nombre, password } = body;
    if (!nombre || !password) return new Response(JSON.stringify({ ok: false, error: 'Introduce tu nombre y contraseña' }), { status: 400, headers: corsHeaders });

    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      const data = await r.json();
      const rec = (data.records || []).find(r =>
        (r.fields['Name'] || '').trim().toLowerCase() === nombre.trim().toLowerCase()
      );
      if (!rec) return new Response(JSON.stringify({ ok: false, error: 'Usuario no encontrado' }), { headers: corsHeaders });
      const pwdAirtable = (rec.fields['Password'] || '').trim();
      if (pwdAirtable !== password.trim()) return new Response(JSON.stringify({ ok: false, error: 'Contraseña incorrecta' }), { headers: corsHeaders });
      const accesos = {};
      Object.keys(rec.fields).forEach(key => {
        if (key.startsWith('acc_')) accesos[key.replace('acc_', '')] = !!rec.fields[key];
      });
      const fisio = {
        id: rec.id,
        nombre: rec.fields['Name'] || '',
        role: rec.fields['Role'] || 'fisio',
        colegiado: rec.fields['NºColegiado'] || '',
        foto: rec.fields['Foto']?.[0]?.url || '',
        accesos
      };
      return new Response(JSON.stringify({ ok: true, fisio, apiToken: FISIO_PASSWORD }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Método no permitido' }), { status: 405, headers: corsHeaders });
}
