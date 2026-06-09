export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const TABLE_PACIENTES = 'tbldBVgClS4HY2mOJ';
const TABLE_MENSAJES = 'MENSAJES';

async function airtableGet(table, formula) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${table}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=100&sort%5B0%5D%5Bfield%5D=Fecha&sort%5B0%5D%5Bdirection%5D=desc`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  return r.json();
}

async function airtablePatch(table, id, fields) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${table}/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return r.json();
}

async function airtableCreate(table, fields) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${table}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return r.json();
}

export default async function handler(req) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  // GET — leer mensajes del paciente
  if (req.method === 'GET') {
    const action = url.searchParams.get('action');
    const patientId = url.searchParams.get('patientId') || url.searchParams.get('pacienteId');

    if (action === 'get-mensajes' && patientId) {
      try {
        const data = await airtableGet(TABLE_MENSAJES, `{PacienteId}="${patientId}"`);
        const mensajes = (data.records || []).map(r => ({
          id: r.id,
          texto: r.fields.Texto || '',
          fecha: r.fields.Fecha || '',
          fisioId: r.fields.FisioId || '',
          fisioNombre: r.fields.FisioNombre || '',
          respuesta: r.fields.Respuesta || '',
          respuestaLeida: r.fields.RespuestaLeida || false,
          tipo: r.fields.Tipo || 'diario'
        }));
        return new Response(JSON.stringify({ ok: true, mensajes }), { headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { headers: corsHeaders });
      }
    }
  }

  // POST — guardar entrada de diario
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { patientId, comentario, enviarFisio, fisioDestinatarioId, fisioDestinatarioNombre } = body;

      if (!patientId) {
        return new Response(JSON.stringify({ ok: false, error: 'patientId requerido' }), { headers: corsHeaders });
      }

      // 1. Siempre guardar en el campo Diario del paciente
      const pac = await airtableGet(TABLE_PACIENTES, `RECORD_ID()="${patientId}"`);
      if (pac.records && pac.records.length > 0) {
        const rec = pac.records[0];
        const diarioActual = rec.fields.Diario || '';
        const fecha = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
        const nuevaEntrada = comentario
          ? `${fecha}: ${comentario}`
          : `${fecha}: Tarea hecha ✓`;
        const diarioNuevo = diarioActual ? diarioActual + '\n' + nuevaEntrada : nuevaEntrada;
        await airtablePatch(TABLE_PACIENTES, rec.id, { Diario: diarioNuevo });
      }

      // 2. Si enviarFisio=true, crear registro en tabla MENSAJES
      if (enviarFisio && fisioDestinatarioId) {
        const fecha = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
        const esDolorAumento = comentario && comentario.startsWith('[Dolor aumentó]');
        await airtableCreate(TABLE_MENSAJES, {
          PacienteId: patientId,
          FisioId: fisioDestinatarioId,
          FisioNombre: fisioDestinatarioNombre || '',
          Texto: comentario || '',
          Fecha: fecha,
          Tipo: esDolorAumento ? 'dolor' : 'diario',
          Visto: false,
          RespuestaLeida: false
        });
      }

      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405,
    headers: corsHeaders
  });
}