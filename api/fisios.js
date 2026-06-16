export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';
const PROGRESO_TABLE = 'tblbOukia79RVtTVt';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';

async function airtableFetch(path, options = {}) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

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

  // GET lista-publica
  if (req.method === 'GET' && action === 'lista-publica') {
    try {
      const r = await airtableFetch(FISIOS_TABLE);
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

  // GET progreso — obtener progreso de un fisio desde tabla PROGRESO
  if (req.method === 'GET' && action === 'progreso') {
    const pwd = url2.searchParams.get('pwd') || '';
    const fisioId = url2.searchParams.get('fisioId') || '';
    if (pwd !== FISIO_PASSWORD) return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401, headers: corsHeaders });
    if (!fisioId) return new Response(JSON.stringify({ ok: false, error: 'fisioId requerido' }), { status: 400, headers: corsHeaders });
    try {
      const filter = encodeURIComponent(`{FisioID} = "${fisioId}"`);
      const r = await airtableFetch(`${PROGRESO_TABLE}?filterByFormula=${filter}`);
      const data = await r.json();
      const progreso = {};
      (data.records || []).forEach(rec => {
        const seccion = rec.fields['Seccion'];
        const estado = rec.fields['Estado'];
        const fecha = rec.fields['Fecha'] || '';
        if (seccion) progreso[seccion] = { estado, fecha, _recordId: rec.id };
      });
      return new Response(JSON.stringify({ ok: true, progreso }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // GET version
  if (req.method === 'GET' && action === 'version') {
    return new Response(JSON.stringify({ ok: true, version: '1.0' }), { headers: corsHeaders });
  }

  // GET — lista completa de fisios
  if (req.method === 'GET') {
    try {
      const r = await airtableFetch(FISIOS_TABLE);
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

  // POST
  if (req.method === 'POST') {
    let body = {};
    try { const text = await req.text(); body = text ? JSON.parse(text) : {}; } catch(e) { body = {}; }

    const postAction = body.action || '';

    // POST progreso — crear o actualizar registro en tabla PROGRESO
    if (postAction === 'progreso') {
      const { pwd, fisioId, seccion, estado } = body;
      if (pwd !== FISIO_PASSWORD) return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401, headers: corsHeaders });
      if (!fisioId || !seccion || !estado) return new Response(JSON.stringify({ ok: false, error: 'Faltan datos' }), { status: 400, headers: corsHeaders });
      try {
        const fecha = new Date().toISOString().split('T')[0];

        // Buscar si ya existe un registro para este fisio + sección
        const filter = encodeURIComponent(`AND({FisioID} = "${fisioId}", {Seccion} = "${seccion}")`);
        const existing = await airtableFetch(`${PROGRESO_TABLE}?filterByFormula=${filter}`);
        const existingData = await existing.json();
        const existingRecord = (existingData.records || [])[0];

        let result;
        if (existingRecord) {
          // Actualizar registro existente
          result = await airtableFetch(`${PROGRESO_TABLE}/${existingRecord.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ fields: { Estado: estado, Fecha: fecha } })
          });
        } else {
          // Crear nuevo registro
          result = await airtableFetch(PROGRESO_TABLE, {
            method: 'POST',
            body: JSON.stringify({ fields: { FisioID: fisioId, Seccion: seccion, Estado: estado, Fecha: fecha } })
          });
        }

        const resultData = await result.json();
        if (resultData.error) return new Response(JSON.stringify({ ok: false, error: resultData.error.message || 'Error Airtable' }), { status: 400, headers: corsHeaders });
        return new Response(JSON.stringify({ ok: true, fecha }), { headers: corsHeaders });
      } catch(e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // POST login fisio
    const { nombre, password } = body;
    if (!nombre || !password) return new Response(JSON.stringify({ ok: false, error: 'Introduce tu nombre y contraseña' }), { status: 400, headers: corsHeaders });

    try {
      const r = await airtableFetch(FISIOS_TABLE);
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
