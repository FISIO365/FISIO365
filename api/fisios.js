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

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // GET — lista de fisios
  if (req.method === 'GET') {
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}?fields[]=Name&fields[]=Role&fields[]=NºColegiado&fields[]=Foto`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const fisios = (data.records || []).map(rec => ({
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
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
    } catch(e) { body = {}; }

    const { nombre, password } = body;

    if (!nombre || !password) {
      return new Response(JSON.stringify({ ok: false, error: 'Introduce tu nombre y contraseña' }), { status: 400, headers: corsHeaders });
    }

    try {
      // Traer todos los fisios y comparar en JS (evita problemas con acentos en Airtable)
      const url = `https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}?fields[]=Name&fields[]=Password&fields[]=Role&fields[]=NºColegiado&fields[]=Foto&fields[]=acc_programas&fields[]=acc_anamnesis&fields[]=acc_informes&fields[]=acc_school&fields[]=acc_checklist`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();

      const rec = (data.records || []).find(r =>
        (r.fields['Name'] || '').trim().toLowerCase() === nombre.trim().toLowerCase()
      );

      if (!rec) {
        return new Response(JSON.stringify({ ok: false, error: 'Usuario no encontrado' }), { headers: corsHeaders });
      }

      const pwdAirtable = (rec.fields['Password'] || '').trim();
      if (pwdAirtable !== password.trim()) {
        return new Response(JSON.stringify({ ok: false, error: 'Contraseña incorrecta' }), { headers: corsHeaders });
      }

      const fisio = {
        id: rec.id,
        nombre: rec.fields['Name'] || '',
        role: rec.fields['Role'] || 'fisio',
        colegiado: rec.fields['NºColegiado'] || '',
        foto: rec.fields['Foto']?.[0]?.url || '',
        acc_programas: rec.fields['acc_programas'] || false,
        acc_anamnesis: rec.fields['acc_anamnesis'] || false,
        acc_informes: rec.fields['acc_informes'] || false,
        acc_school: rec.fields['acc_school'] || false,
        acc_checklist: rec.fields['acc_checklist'] || false,
      };

      return new Response(JSON.stringify({
        ok: true,
        fisio,
        apiToken: FISIO_PASSWORD
      }), { headers: corsHeaders });

    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Método no permitido' }), { status: 405, headers: corsHeaders });
}
