export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const ANAMNESIS_TABLE = 'tblF4as0orW1b6KIw';
const MENSAJES_TABLE = 'MENSAJES'; // ← crear en Airtable
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const queryPwd = url.searchParams.get('pwd') || '';

  let body = {};
  if (req.method === 'POST') {
    try { const text = await req.text(); body = text ? JSON.parse(text) : {}; } catch(e) { body = {}; }
  }

  const action = url.searchParams.get('action') || body.action || '';

  // ── ENDPOINTS PÚBLICOS (sin contraseña) ─────────────────────────────────
  // get-mensajes — app paciente no tiene pwd
  if (action === 'get-mensajes') {
    const pacienteId = url.searchParams.get('pacienteId') || '';
    try {
      const formula = pacienteId ? `{PacienteId}="${pacienteId}"` : '';
      const filterQ = formula ? `filterByFormula=${encodeURIComponent(formula)}&` : '';
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${MENSAJES_TABLE}?${filterQ}sort[0][field]=Fecha&sort[0][direction]=desc&pageSize=50`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      if (data.error) return new Response(JSON.stringify({ ok: true, mensajes: [] }), { headers: corsHeaders });
      const mensajes = (data.records || []).map(rec => ({
        id: rec.id,
        texto: rec.fields['Texto'] || '',
        fecha: rec.fields['Fecha'] || '',
        fisioNombre: rec.fields['FisioNombre'] || '',
        respuesta: rec.fields['Respuesta'] || '',
        respuestaLeida: rec.fields['RespuestaLeida'] || false,
        tipo: rec.fields['Tipo'] || 'diario'
      }));
      return new Response(JSON.stringify({ ok: true, mensajes }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: true, mensajes: [] }), { headers: corsHeaders }); }
  }

  // ── MARCAR RESPUESTA LEÍDA (paciente) ───────────────────────────────────────
  if (action === 'marcar-respuesta-leida') {
    const pacienteId = url.searchParams.get('pacienteId') || '';
    try {
      // Get all messages for this patient with unread responses
      const formula = `AND({PacienteId}="${pacienteId}",{RespuestaLeida}=FALSE(),{Respuesta}!="")`;
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${MENSAJES_TABLE}?filterByFormula=${encodeURIComponent(formula)}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      const records = data.records || [];
      // Mark all as read
      for(const rec of records){
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MENSAJES_TABLE}/${rec.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { RespuestaLeida: true } })
        });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders }); }
  }

  const pwd = (body.pwd || queryPwd || '').trim();
  const expected = (FISIO_PASSWORD || '').trim();
  if (pwd !== expected) return new Response(JSON.stringify({ ok: false, error: 'Contrasena incorrecta' }), { status: 401, headers: corsHeaders });

  // ── LISTAR INFORMES ──────────────────────────────────────────────────────
  if (action === 'listar-informes') {
    try {
      const fields = ['PacienteID','PacienteNombre','FisioNombre','FechaValoracion','InformeGenerado','Protocolo'];
      const fp = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}?${fp}&sort[0][field]=FechaValoracion&sort[0][direction]=desc&pageSize=50`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const informes = (data.records || []).map(rec => ({ id: rec.id, pacienteId: rec.fields['PacienteID'] || '', pacienteNombre: rec.fields['PacienteNombre'] || '—', fisioNombre: rec.fields['FisioNombre'] || '—', fecha: rec.fields['FechaValoracion'] || '—', informe: rec.fields['InformeGenerado'] || '', protocolo: rec.fields['Protocolo'] || 'hernia' }));
      return new Response(JSON.stringify({ ok: true, informes }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── GUARDAR INFORME ──────────────────────────────────────────────────────
  if (action === 'guardar-informe' && req.method === 'POST') {
    const { pacienteId, fisioNombre, protocolo, informe, pacienteNombre } = body;
    try {
      const fecha = new Date().toLocaleDateString('es-ES');
      const entrada = `--- ${fecha} | ${fisioNombre||''} | ${protocolo||''} ---\n${informe||''}\n`;
      let textoActual = '';
      if (pacienteId) {
        const rGet = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}?fields[]=Anamnesis`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const dGet = await rGet.json();
        textoActual = dGet.fields?.['Anamnesis'] || '';
      }
      const nuevoTexto = entrada + (textoActual ? '\n' + textoActual : '');
      if (pacienteId) await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}`, { method: 'PATCH', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { Anamnesis: nuevoTexto } }) });
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [{ fields: { PacienteID: pacienteId || '', PacienteNombre: pacienteNombre || '', FisioNombre: fisioNombre || '', FechaValoracion: new Date().toISOString().split('T')[0], InformeGenerado: informe || '', Protocolo: protocolo || 'hernia' } }] }) });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── ACTUALIZAR INFORME ───────────────────────────────────────────────────
  if (action === 'actualizar-informe' && req.method === 'POST') {
    const { id, informe } = body;
    if (!id) return new Response(JSON.stringify({ ok: false, error: 'Falta id' }), { status: 400, headers: corsHeaders });
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { InformeGenerado: informe || '' } }) });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── BORRAR INFORME (panel fisio) ────────────────────────────────────────
  if (action === 'borrar-informe' && req.method === 'POST') {
    const { id } = body;
    if (!id) return new Response(JSON.stringify({ ok: false, error: 'Falta id' }), { status: 400, headers: corsHeaders });
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── BORRAR INFORME DEL PACIENTE (tabla INFORMES) ─────────────────────────
  if (action === 'borrar-informe-paciente' && req.method === 'POST') {
    const { pacienteId, fecha } = body;
    const INFORMES_TABLE = 'tblwvWQxXNJPdR0Iv';
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}?pageSize=50`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const record = (data.records || []).find(rec =>
        rec.fields['PacienteID'] === pacienteId && rec.fields['Fecha'] === fecha
      );
      if (record) {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}/${record.id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
        });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── GENERAR INFORME IA ───────────────────────────────────────────────────
  if (action === 'informe' && req.method === 'POST') {
    try {
      const { pacienteNombre, fisioNombre, fisioColegiado, datos } = body;
      const d = datos || {};
      const tipo = d.tipo || 'hernia';
      const fa = arr => (!arr || !arr.length) ? '-' : arr.join(', ');
      const fecha = new Date().toLocaleDateString('es-ES');
      const hayFlags = (d.flags && d.flags.length) || (d.banderas && d.banderas.length);
      const colNum = fisioColegiado ? ` | Colegiado nº ${fisioColegiado}` : '';
      const cabecera = `Fisioterapeuta: ${fisioNombre||'-'}${colNum} | Fecha: ${fecha}\nPaciente: ${pacienteNombre||'-'} | Edad: ${d.edad||'-'} | Actividad: ${d.act||'-'}`;
      const estructura = `\nRedacta con EXACTAMENTE estas secciones:\nMOTIVO DE CONSULTA\nEXPLORACIÓN Y HALLAZGOS\nDIAGNÓSTICO FISIOTERAPÉUTICO\nOBJETIVOS TERAPÉUTICOS${hayFlags?'\nALERTAS':''}\nNO incluyas otras secciones.`;
      const datosCompactos = Object.entries(d).filter(([k,v])=>v&&v!=='-'&&!(Array.isArray(v)&&!v.length)).map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(', '):v}`).join('\n');
      const prompt = `Eres fisioterapeuta experto. Informe de valoración de ${tipo.toUpperCase()}. Sin markdown, párrafos, términos técnicos explicados entre paréntesis.\n${cabecera}\nDATOS:\n${datosCompactos}\n${hayFlags?'RED FLAGS: '+fa(d.flags||d.banderas):''}\n${estructura}`;
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) });
      const data = await r.json();
      const informe = data.content?.[0]?.text || '';
      if (!informe) return new Response(JSON.stringify({ ok: false, error: data.error?.message || 'Error Anthropic' }), { status: 500, headers: corsHeaders });
      return new Response(JSON.stringify({ ok: true, informe }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── GUARDAR INFORME EN PERFIL PACIENTE ─────────────────────────────────
  if (action === 'guardar-informe-panel' && req.method === 'POST') {
    const { pacienteId, pacienteNombre, fisioNombre, tipo, contenido, fecha } = body;
    const INFORMES_TABLE = 'tblwvWQxXNJPdR0Iv';
    try {
      let finalPacienteId = pacienteId || '';
      if (!finalPacienteId && pacienteNombre) {
        const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}?fields[]=FULL NAME&fields[]=PIN`;
        const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const searchData = await searchRes.json();
        const found = (searchData.records || []).find(r =>
          (r.fields['FULL NAME'] || '').trim().toLowerCase() === pacienteNombre.trim().toLowerCase()
        );
        if (found) finalPacienteId = found.id;
      }
      const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: {
          PacienteID: finalPacienteId,
          PacienteNombre: pacienteNombre || '',
          FisioNombre: fisioNombre || '',
          Fecha: fecha || new Date().toLocaleDateString('es-ES'),
          Tipo: tipo || 'hernia',
          Contenido: contenido || ''
        }}]})
      });
      const atData = await atRes.json();
      if (atData.error) {
        return new Response(JSON.stringify({ ok: false, error: atData.error.message || JSON.stringify(atData.error), atData }), { headers: corsHeaders });
      }
      return new Response(JSON.stringify({ ok: true, pacienteId: finalPacienteId, recordId: atData.records?.[0]?.id }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── GET DIARIO PACIENTE ──────────────────────────────────────────────────
  if (action === 'get-diario') {
    const pacienteId = url.searchParams.get('pacienteId') || '';
    if (!pacienteId) return new Response(JSON.stringify({ ok: false, error: 'Falta pacienteId' }), { status: 400, headers: corsHeaders });
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      const data = await r.json();
      const fields = data.fields || {};
      const diario = fields['Diario'] || fields['diario'] || fields['DIARIO'] || fields['Diary'] || '';
      const fieldNames = Object.keys(fields);
      return new Response(JSON.stringify({ ok: true, diario, fieldNames }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── ENVIAR MENSAJE FISIO → PACIENTE ─────────────────────────────────────
  if (action === 'enviar-mensaje-fisio' && req.method === 'POST') {
    const { pacienteId, pacienteNombre, fisioId, fisioNombre, texto, fecha } = body;
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MENSAJES_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          PacienteId: pacienteId || '',
          PacienteNombre: pacienteNombre || '',
          FisioId: fisioId || '',
          FisioNombre: fisioNombre || '',
          Texto: texto || '',
          Fecha: fecha || new Date().toLocaleDateString('es-ES'),
          Tipo: 'fisio',
          Visto: true,
          RespuestaLeida: false
        }})
      });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── GET MENSAJES FISIO ───────────────────────────────────────────────────
  if (action === 'get-mensajes-fisio') {
    const fisioId = url.searchParams.get('fisioId') || '';
    const soloCount = url.searchParams.get('soloCount') === '1';
    try {
      const formula = fisioId ? `{FisioId}="${fisioId}"` : '';
      const sortQ = 'sort[0][field]=Fecha&sort[0][direction]=desc';
      const filterQ = formula ? `filterByFormula=${encodeURIComponent(formula)}&` : '';
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${MENSAJES_TABLE}?${filterQ}${sortQ}&pageSize=50`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      if (data.error) return new Response(JSON.stringify({ ok: false, error: data.error.message, sinLeer: 0, mensajes: [] }), { headers: corsHeaders });
      const mensajes = (data.records || []).map(rec => ({
        id: rec.id,
        pacienteId: rec.fields['PacienteId'] || '',
        pacienteNombre: rec.fields['PacienteNombre'] || '',
        fisioId: rec.fields['FisioId'] || '',
        fisioNombre: rec.fields['FisioNombre'] || '',
        texto: rec.fields['Texto'] || '',
        fecha: rec.fields['Fecha'] || '',
        tipo: rec.fields['Tipo'] || 'diario',
        visto: rec.fields['Visto'] || false,
        respuesta: rec.fields['Respuesta'] || '',
        respuestaLeida: rec.fields['RespuestaLeida'] || false
      }));
      const sinLeer = mensajes.filter(m => !m.visto).length;
      if (soloCount) return new Response(JSON.stringify({ ok: true, sinLeer }), { headers: corsHeaders });
      return new Response(JSON.stringify({ ok: true, mensajes, sinLeer }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message, sinLeer: 0, mensajes: [] }), { status: 500, headers: corsHeaders }); }
  }



  // ── RESPONDER MENSAJE ────────────────────────────────────────────────────
  if (action === 'responder-mensaje' && req.method === 'POST') {
    const { mensajeId, respuesta, fisioNombre, pacienteId, pacienteNombre } = body;
    if (!mensajeId || !respuesta) return new Response(JSON.stringify({ ok: false, error: 'Faltan datos' }), { status: 400, headers: corsHeaders });
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MENSAJES_TABLE}/${mensajeId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { Respuesta: respuesta, Visto: true, RespuestaLeida: false } })
      });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── MARCAR VISTO ─────────────────────────────────────────────────────────
  if (action === 'marcar-visto' && req.method === 'POST') {
    const { mensajeId } = body;
    if (!mensajeId) return new Response(JSON.stringify({ ok: false, error: 'Falta mensajeId' }), { status: 400, headers: corsHeaders });
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MENSAJES_TABLE}/${mensajeId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { Visto: true } })
      });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── GET PACIENTES ────────────────────────────────────────────────────────
  if (req.method === 'GET' && !action) {
    try {
      let allRecords = [], offset = null;
      do {
        const pageUrl = `https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}?fields[]=FULL NAME&fields[]=EMAIL&fields[]=PIN&fields[]=WHATSAPP&sort[0][field]=FULL NAME&sort[0][direction]=asc&pageSize=100${offset?'&offset='+offset:''}`;
        const pageRes = await fetch(pageUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const pageData = await pageRes.json();
        allRecords = allRecords.concat(pageData.records || []);
        offset = pageData.offset;
      } while (offset);
      const pacientes = allRecords.map(rec => ({ id: rec.id, nombre: rec.fields['FULL NAME'] || '—', email: rec.fields['EMAIL'] || '', pin: rec.fields['PIN'] || '', telefono: rec.fields['WHATSAPP'] || '' }));
      return new Response(JSON.stringify({ ok: true, pacientes }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  // ── POST NUEVO PACIENTE ──────────────────────────────────────────────────
  if (req.method === 'POST' && !action) {
    const { nombre, email, telefono } = body;
    if (!nombre || !email) return new Response(JSON.stringify({ ok: false, error: 'Nombre y email obligatorios' }), { status: 400, headers: corsHeaders });
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [{ fields: { 'FULL NAME': nombre, EMAIL: email, WHATSAPP: telefono || '', PIN: pin } }] }) });
      const data = await r.json();
      const rec = data.records?.[0];
      return new Response(JSON.stringify({ ok: true, paciente: { id: rec.id, nombre, email, pin } }), { headers: corsHeaders });
    } catch(e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders }); }
  }

  return new Response(JSON.stringify({ ok: false, error: 'Ruta no encontrada' }), { status: 404, headers: corsHeaders });
}
