export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';
const PROGRESO_TABLE = 'tblbOukia79RVtTVt';

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

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || '';
  const queryPwd = url.searchParams.get('pwd') || '';

  let body = {};
  if (req.method === 'POST') {
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
    } catch(e) { body = {}; }
  }

  // ── GET VERSIÓN ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'version') {
    const pwd = queryPwd.trim();
    if (pwd !== FISIO_PASSWORD) return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true, version: process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString() }), { headers: corsHeaders });
  }

  // ── GET PROGRESO ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'progreso') {
    const pwd = queryPwd.trim();
    if (pwd !== FISIO_PASSWORD) return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401, headers: corsHeaders });
    const fisioId = url.searchParams.get('fisioId') || '';
    if (!fisioId) return new Response(JSON.stringify({ ok: false, error: 'Falta fisioId' }), { status: 400, headers: corsHeaders });
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}?filterByFormula={FisioId}="${fisioId}"`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const progreso = {};
      (data.records || []).forEach(rec => {
        progreso[rec.fields['Seccion']] = { estado: rec.fields['Estado'] || '', fecha: rec.fields['Fecha'] || '', recordId: rec.id };
      });
      return new Response(JSON.stringify({ ok: true, progreso }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── GET LISTA FISIOS ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const pwd = queryPwd.trim();
    if (pwd !== FISIO_PASSWORD) return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401, headers: corsHeaders });
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const fisios = (data.records || []).filter(rec => rec.fields['Role']).map(rec => ({
        id: rec.id,
        nombre: rec.fields['Name'] || '',
        colegiado: rec.fields['NºColegiado'] || '',
        foto: rec.fields['Foto']?.[0]?.url || '',
        role: rec.fields['Role'] || 'fisio'
      }));
      return new Response(JSON.stringify({ ok: true, fisios }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── POST PROGRESO ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && (action === 'progreso' || body.action === 'progreso')) {
    const pwd = (body.pwd || '').trim();
    if (pwd !== FISIO_PASSWORD) return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401, headers: corsHeaders });
    const { fisioId, seccion, estado } = body;
    if (!fisioId || !seccion) return new Response(JSON.stringify({ ok: false, error: 'Faltan datos' }), { status: 400, headers: corsHeaders });
    try {
      const checkR = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}?filterByFormula=AND({FisioId}="${fisioId}",{Seccion}="${seccion}")`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const checkData = await checkR.json();
      const fecha = new Date().toISOString().split('T')[0];
      const existing = checkData.records?.[0];
      if (existing) {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}/${existing.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { Estado: estado || 'completado', Fecha: fecha } })
        });
      } else {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields: { FisioId: fisioId, Seccion: seccion, Estado: estado || 'completado', Fecha: fecha } }] })
        });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── POST LOGIN ────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { nombre, password } = body;
    if (!nombre || !password) return new Response(JSON.stringify({ ok: false, error: 'Faltan datos' }), { status: 400, headers: corsHeaders });
    try {
      const nombreClean = nombre.trim().toUpperCase();
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}?filterByFormula=UPPER({Name})="${nombreClean}"`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      if (!data.records?.length) return new Response(JSON.stringify({ ok: false, error: 'Usuario no encontrado' }), { headers: corsHeaders });
      const rec = data.records[0];
      const fields = rec.fields;
      if (String(fields['Password'] || '').trim() !== String(password).trim()) {
        return new Response(JSON.stringify({ ok: false, error: 'Contraseña incorrecta' }), { headers: corsHeaders });
      }
      const role = (fields['Role'] || '').toLowerCase();
      if (!role) return new Response(JSON.stringify({ ok: false, error: 'Sin acceso al panel' }), { headers: corsHeaders });
      const accesos = {};
      Object.keys(fields).forEach(key => {
        if (key.startsWith('acc_')) accesos[key.replace('acc_', '')] = fields[key] === true;
      });
      return new Response(JSON.stringify({
        ok: true,
        apiToken: FISIO_PASSWORD,
        fisio: { id: rec.id, nombre: fields['Name'] || nombre, role, colegiado: fields['NºColegiado'] || '', foto: fields['Foto']?.[0]?.url || '', accesos }
      }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Ruta no encontrada' }), { status: 404, headers: corsHeaders });
}
