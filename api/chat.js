// api/chat.js — Chat paciente ↔ fisio (texto, fotos y PDFs)
// Guarda cada mensaje en la tabla MENSAJES de Airtable con Tipo="chat", De="paciente"|"fisio" y Adjuntos.
// También devuelve los mensajes antiguos (diario / nota al fisio / respuesta) convertidos a burbujas,
// para que el historial de cada paciente no se pierda.
export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const MENSAJES = 'tblIsWo3g6x1QzJyl';
const CAMPO_ADJUNTOS = 'fldeDjLloaa82SoG7';
const MAX_BYTES = 2.6 * 1024 * 1024; // límite por archivo (Vercel no acepta peticiones de más de ~4,5 MB y el archivo viaja en base64)
const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf'];

const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: H });
const AT = { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };
const idValido = (s) => /^rec[A-Za-z0-9]{14}$/.test(s || '');
const fechaES = () => new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

function adjuntos(f) {
  return (f.Adjuntos || []).map(a => ({
    url: a.url, nombre: a.filename, tipo: a.type || '', bytes: a.size || 0,
    mini: a.thumbnails?.large?.url || a.thumbnails?.small?.url || ''
  }));
}

// Convierte los registros (nuevos y antiguos) en una lista de burbujas ordenada
function aBurbujas(records) {
  const out = [];
  for (const r of records) {
    const f = r.fields, t = r.createdTime;
    const base = { id: r.id, fisioId: f.FisioId || '', fisioNombre: f.FisioNombre || '' };
    if (f.Tipo === 'chat') {
      out.push({ ...base, de: f.De === 'fisio' ? 'fisio' : 'paciente', texto: f.Texto || '', adjuntos: adjuntos(f), fecha: t,
        leido: f.De === 'fisio' ? !!f.RespuestaLeida : !!f.Visto });
      continue;
    }
    // Formato antiguo
    const deFisio = f.Tipo === 'fisio';
    if (f.Texto) out.push({ ...base, de: deFisio ? 'fisio' : 'paciente', texto: f.Texto, adjuntos: [], fecha: t, etiqueta: f.Tipo === 'dolor' ? 'Dolor' : '', leido: true, antiguo: true });
    if (f.Respuesta) {
      const t2 = new Date(new Date(t).getTime() + 1000).toISOString();
      out.push({ ...base, id: r.id + '-r', de: deFisio ? 'paciente' : 'fisio', texto: f.Respuesta, adjuntos: [], fecha: t2, leido: true, antiguo: true });
    }
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

async function todos(formula) {
  let recs = [], offset = '';
  do {
    const u = `https://api.airtable.com/v0/${BASE_ID}/${MENSAJES}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100${offset ? '&offset=' + offset : ''}`;
    const d = await (await fetch(u, { headers: AT })).json();
    if (d.error) throw new Error(d.error.message || d.error.type || 'Airtable');
    recs = recs.concat(d.records || []); offset = d.offset || '';
  } while (offset && recs.length < 1000);
  return recs;
}

async function patch(records) {
  for (let i = 0; i < records.length; i += 10) {
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MENSAJES}`, { method: 'PATCH', headers: AT, body: JSON.stringify({ records: records.slice(i, i + 10) }) });
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: H });
  const url = new URL(req.url);
  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch (e) { return json({ ok: false, error: 'Petición no válida' }, 400); } }
  const action = url.searchParams.get('action') || body.action || '';
  const pwd = url.searchParams.get('pwd') || body.pwd || '';
  const esFisio = pwd && pwd.trim() === FISIO_PASSWORD.trim();

  // ── Hilo de un paciente ──────────────────────────────────────────
  if (action === 'hilo') {
    const pacienteId = url.searchParams.get('pacienteId') || '';
    if (!idValido(pacienteId)) return json({ ok: false, error: 'Paciente no válido' }, 400);
    try {
      const recs = await todos(`{PacienteId}="${pacienteId}"`);
      const mensajes = aBurbujas(recs);
      const ultimoFisio = [...recs].sort((a, b) => b.createdTime.localeCompare(a.createdTime)).find(r => r.fields.FisioId);
      return json({ ok: true, mensajes, fisio: ultimoFisio ? { id: ultimoFisio.fields.FisioId, nombre: ultimoFisio.fields.FisioNombre || '' } : null });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  // ── Conversaciones de un fisio (panel) ──────────────────────────
  if (action === 'conversaciones') {
    if (!esFisio) return json({ ok: false, error: 'No autorizado' }, 401);
    const fisioId = url.searchParams.get('fisioId') || '';
    try {
      const recs = await todos(fisioId && idValido(fisioId) ? `{FisioId}="${fisioId}"` : 'TRUE()');
      const por = {};
      for (const r of recs) {
        const f = r.fields, id = f.PacienteId; if (!id) continue;
        const c = por[id] || (por[id] = { pacienteId: id, pacienteNombre: f.PacienteNombre || '', ultimo: '', texto: '', de: '', sinLeer: 0 });
        if (!c.pacienteNombre && f.PacienteNombre) c.pacienteNombre = f.PacienteNombre;
        const deFisio = f.Tipo === 'chat' ? f.De === 'fisio' : f.Tipo === 'fisio';
        if (!f.Visto && !deFisio) c.sinLeer++;
        const t = r.createdTime;
        if (t > c.ultimo) { c.ultimo = t; c.texto = f.Texto || (f.Adjuntos?.length ? (/^image\//.test(f.Adjuntos[0].type) ? '📷 Foto' : '📄 ' + f.Adjuntos[0].filename) : ''); c.de = deFisio ? 'fisio' : 'paciente'; }
      }
      const lista = Object.values(por).sort((a, b) => b.ultimo.localeCompare(a.ultimo));
      return json({ ok: true, conversaciones: lista });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  // ── Cuántos mensajes del fisio no ha leído el paciente ──────────
  if (action === 'sin-leer') {
    const pacienteId = url.searchParams.get('pacienteId') || '';
    if (!idValido(pacienteId)) return json({ ok: true, sinLeer: 0 });
    try {
      const recs = await todos(`AND({PacienteId}="${pacienteId}",{RespuestaLeida}=FALSE(),OR(AND({Tipo}="chat",{De}="fisio"),{Tipo}="fisio",AND({Tipo}!="chat",{Respuesta}!="")))`);
      return json({ ok: true, sinLeer: recs.length });
    } catch (e) { return json({ ok: true, sinLeer: 0 }); }
  }

  // ── Marcar como leído ────────────────────────────────────────────
  if (action === 'leido' && req.method === 'POST') {
    const { pacienteId, quien } = body;
    if (!idValido(pacienteId)) return json({ ok: false }, 400);
    try {
      if (quien === 'fisio') {
        if (!esFisio) return json({ ok: false, error: 'No autorizado' }, 401);
        const recs = await todos(`AND({PacienteId}="${pacienteId}",{Visto}=FALSE())`);
        await patch(recs.map(r => ({ id: r.id, fields: { Visto: true } })));
      } else {
        const recs = await todos(`AND({PacienteId}="${pacienteId}",{RespuestaLeida}=FALSE())`);
        await patch(recs.map(r => ({ id: r.id, fields: { RespuestaLeida: true } })));
      }
      return json({ ok: true });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  // ── Enviar un mensaje (con o sin archivo) ────────────────────────
  if (action === 'enviar' && req.method === 'POST') {
    const { pacienteId, pacienteNombre, de, texto, fisioId, fisioNombre, archivo } = body;
    if (!idValido(pacienteId)) return json({ ok: false, error: 'Paciente no válido' }, 400);
    if (de === 'fisio' && !esFisio) return json({ ok: false, error: 'No autorizado' }, 401);
    const txt = String(texto || '').slice(0, 4000).trim();
    if (!txt && !archivo) return json({ ok: false, error: 'Mensaje vacío' }, 400);
    if (archivo) {
      if (!TIPOS_OK.includes(archivo.tipo)) return json({ ok: false, error: 'Solo se pueden enviar fotos o PDFs' }, 400);
      if (!archivo.base64 || archivo.base64.length * 0.75 > MAX_BYTES) return json({ ok: false, error: 'El archivo es demasiado grande (máximo 2,5 MB)' }, 413);
    }
    try {
      const deFisio = de === 'fisio';
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MENSAJES}`, {
        method: 'POST', headers: AT,
        body: JSON.stringify({ fields: {
          PacienteId: pacienteId, PacienteNombre: pacienteNombre || '', FisioId: fisioId || '', FisioNombre: fisioNombre || '',
          Texto: txt, Fecha: fechaES(), Tipo: 'chat', De: deFisio ? 'fisio' : 'paciente',
          Visto: deFisio, RespuestaLeida: !deFisio
        } })
      });
      const rec = await r.json();
      if (!rec.id) return json({ ok: false, error: rec.error?.message || 'No se ha podido guardar' }, 500);
      let fields = rec.fields;
      if (archivo) {
        const nombre = String(archivo.nombre || 'archivo').replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 120);
        const up = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${rec.id}/${CAMPO_ADJUNTOS}/uploadAttachment`, {
          method: 'POST', headers: AT, body: JSON.stringify({ contentType: archivo.tipo, file: archivo.base64, filename: nombre })
        });
        const ud = await up.json();
        if (!up.ok) {
          if (!txt) await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MENSAJES}/${rec.id}`, { method: 'DELETE', headers: AT });
          return json({ ok: false, error: 'No se ha podido subir el archivo' }, 500);
        }
        fields = { ...fields, Adjuntos: ud.fields?.[CAMPO_ADJUNTOS] || ud.fields?.Adjuntos || [] };
      }
      const [m] = aBurbujas([{ id: rec.id, createdTime: rec.createdTime, fields }]);
      return json({ ok: true, mensaje: m });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  return json({ ok: false, error: 'Acción no encontrada' }, 404);
}
