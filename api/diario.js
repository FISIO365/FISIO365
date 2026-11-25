export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const { BASE_ID } = require('./_base');
const TABLE_PACIENTES = 'tbldBVgClS4HY2mOJ';
const TABLE_MENSAJES = 'tblIsWo3g6x1QzJyl'; // MENSAJES (por id: la tabla se puede renombrar)

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

      // Guardar tarea hecha en TAREAS
      // Marcar o quitar a mano un día de ejercicios (si se le olvidó). El paciente: solo los últimos 7 días; el fisio (con la contraseña): cualquier día pasado.
      if (body.action === 'marcar-dia') {
        const TAREAS_TABLE = 'tblIXYE5ToRNY7MN4', pid = String(body.pacienteId || ''), f = String(body.fecha || '');
        const esFisio = !!body.pwd && String(body.pwd).trim() === String(process.env.FISIO_PASSWORD || 'FISIO365App').trim();
        const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
        const lim = new Date(hoy + 'T12:00:00Z'); lim.setUTCDate(lim.getUTCDate() - 7); const min = lim.toISOString().slice(0, 10);
        if (!/^rec[A-Za-z0-9]{14}$/.test(pid) || !/^\d{4}-\d{2}-\d{2}$/.test(f) || f > hoy || (!esFisio && f < min)) return new Response(JSON.stringify({ ok: false, error: 'Ese día no se puede cambiar' }), { status: 400, headers: corsHeaders });
        try {
          const ex = await airtableGet(TAREAS_TABLE, `AND({PacienteId}='${pid}',DATETIME_FORMAT({Fecha},'YYYY-MM-DD')='${f}')`);
          const recs = ex.records || [];
          if (body.hecho) {
            if (!recs.length) await airtableCreate(TAREAS_TABLE, { 'fld9vav48MeCYpZXA': pid, 'fldMVdTRZUzYsUhZg': String(body.pacienteNombre || '').toUpperCase(), 'fldZsAjUSEegQk8Xq': f, 'fldOTlWCJgMl074Uo': esFisio ? `Marcado desde el panel${body.quien ? ' por ' + String(body.quien).slice(0, 40) : ''}` : 'Marcado después por el paciente' });
          } else {
            for (let i = 0; i < recs.length; i += 10) await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TAREAS_TABLE}?${recs.slice(i, i + 10).map(r => 'records[]=' + r.id).join('&')}`, { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
          }
          return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
        } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
      }
      if (body.action === 'guardar-tarea') {
        const TAREAS_TABLE = 'tblIXYE5ToRNY7MN4';
        try {
          await airtableCreate(TAREAS_TABLE, {
            'fld9vav48MeCYpZXA': body.pacienteId || '',
            'fldMVdTRZUzYsUhZg': (body.pacienteNombre || '').toUpperCase(),
            'fldZsAjUSEegQk8Xq': body.fecha || new Date().toISOString().split('T')[0],
            'fldOTlWCJgMl074Uo': body.nota || ''
          });
          return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
        } catch(e) {
          return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
        }
      }

      // Acción: responder al fisio (sin contraseña, desde app paciente)
      if (body.action === 'responder-al-fisio') {
        const { mensajeId, respuesta } = body;
        if (!mensajeId || !respuesta) return new Response(JSON.stringify({ ok: false, error: 'Faltan datos' }), { headers: corsHeaders });
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_MENSAJES}/${mensajeId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { Respuesta: respuesta, RespuestaLeida: false } })
        });
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      const { patientId, pacienteNombre, comentario, enviarFisio, fisioDestinatarioId, fisioDestinatarioNombre } = body;

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
        const fecha = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
        const esDolorAumento = comentario && comentario.startsWith('[Dolor aumentó]');
        await airtableCreate(TABLE_MENSAJES, {
          PacienteId: patientId,
          PacienteNombre: pacienteNombre || '',
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
