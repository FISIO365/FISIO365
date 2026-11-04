const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const { BASE_ID } = require('./_base');
require('./_pg'); // con DB_URL, los datos salen de Postgres en vez de Airtable (api/_pg.js)
const TABLE_ID = 'tbloqn3ts872ueJSE';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.method === 'POST' ? (req.body || {}) : req.query;
  if (String(q.pwd || '').trim() !== String(FISIO_PASSWORD).trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
  const at = async (path, opt = {}) => (await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, { ...opt, headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' } })).json();
  // Biblioteca editable desde el panel: crear, editar y borrar ejercicios
  if (req.method === 'POST') {
    const okId = x => /^rec[A-Za-z0-9]{14}$/.test(x || '');
    try {
      if (q.accion === 'borrar') { if (!okId(q.id)) return res.status(400).json({ ok: false }); const d = await at(`${TABLE_ID}/${q.id}`, { method: 'DELETE' }); return res.status(200).json({ ok: !d.error }); }
      if (q.accion === 'zonas') { // varias a la vez: [{id, zona}]
        const L = (Array.isArray(q.lista) ? q.lista : []).filter(x => okId(x.id)).slice(0, 300); let n = 0;
        for (let i = 0; i < L.length; i += 10) { const d = await at(TABLE_ID, { method: 'PATCH', body: JSON.stringify({ records: L.slice(i, i + 10).map(x => ({ id: x.id, fields: { Zona: String(x.zona || '').slice(0, 60) } })) }) }); if (!d.error) n += Math.min(10, L.length - i); }
        return res.status(200).json({ ok: true, n });
      }
      if (q.accion === 'ia-sp') { // Redacta la explicación de suelo pélvico de un ejercicio (la revisa el fisio antes de guardar)
        const K = process.env.ANTHROPIC_API_KEY; if (!K) return res.status(200).json({ ok: false, error: 'Falta la clave de la IA' });
        const nombre = String(q.nombre || '').trim().slice(0, 150), desc = String(q.descripcion || '').trim().slice(0, 1500);
        if (!nombre) return res.status(400).json({ ok: false, error: 'Pon el nombre del ejercicio' });
        const prompt = `Eres fisioterapeuta especialista en suelo pélvico. Escribe cómo tiene que gestionar la respiración y el suelo pélvico un paciente al hacer este ejercicio.

EJERCICIO: ${nombre}
${desc ? 'CÓMO SE HACE (explicación general): ' + desc : ''}

EJEMPLO (sentadilla), copia este formato y este tono:
1. Al bajar: inspira despacio hacia costillas y abdomen, dejando el suelo pélvico relajado y suelto.
2. Abajo: mantén la relajación, sin empujar hacia abajo ni apretar.
3. Al subir: exhala y contrae suavemente el suelo pélvico. Hazlo antes de empezar a empujar, no a mitad del esfuerzo.
4. Arriba: relájalo del todo.

REGLAS:
- Pasos numerados según las fases reales de ESTE ejercicio (de 2 a 5), cada uno empieza por la fase («Al subir:», «Al estirar:», «Mientras aguantas:»…).
- Inspira en la fase fácil con el suelo pélvico relajado; exhala y contrae suavemente el suelo pélvico justo antes del esfuerzo, no a mitad; al terminar el esfuerzo, relájalo del todo.
- Si es un ejercicio sin esfuerzo (estiramiento, movilidad, postura mantenida): respiración tranquila y suelo pélvico relajado, sin aguantar el aire.
- Nunca empujar hacia abajo ni aguantar la respiración.
- No expliques la técnica general del ejercicio ni añadas repeticiones, avisos ni introducción: solo los pasos.
- Español de España, tuteando, frases cortas y cercanas. Máximo 70 palabras. Texto plano, sin negritas.`;
        let texto = '', err = '';
        for (const model of ['claude-sonnet-4-5', 'claude-haiku-4-5']) {
          try {
            const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': K, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }) });
            const j = await r.json(); texto = String(((j.content || []).find(b => b && b.type === 'text') || {}).text || '').replace(/\*\*|^#+\s*/gm, '').trim();
            if (texto) break; err = (j.error && j.error.message) || ('HTTP ' + r.status);
          } catch (e) { err = e.message; }
        }
        if (!texto) return res.status(200).json({ ok: false, error: 'La IA no ha podido redactarlo' + (err ? ': ' + err : '') });
        return res.status(200).json({ ok: true, texto });
      }
      const c = q.campos || {}, f = {};
      if (c.nombre !== undefined) f.Nombre = String(c.nombre || '').trim().slice(0, 150);
      if (c.zona !== undefined) f.Zona = String(c.zona || '').slice(0, 60);
      if (c.descripcion !== undefined) f.Descripcion = String(c.descripcion || '').slice(0, 5000);
      if (c.descripcionSP !== undefined) f['Descripcion suelo pelvico'] = String(c.descripcionSP || '').slice(0, 5000);
      if (c.youtube !== undefined) f.YouTubeURL = String(c.youtube || '').trim().slice(0, 300) || null;
      if (!okId(q.id) && !f.Nombre) return res.status(400).json({ ok: false, error: 'Falta el nombre' });
      const d = okId(q.id) ? await at(`${TABLE_ID}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) }) : await at(TABLE_ID, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }] }) });
      if (d.error) return res.status(200).json({ ok: false, error: d.error.message || 'No se ha podido guardar' });
      const id = d.id || (d.records && d.records[0].id);
      // Foto opcional (subida desde el panel)
      if (q.foto && q.foto.b64) { const fid = 'fldXYCWY9gPOh657M'; if (okId(q.id)) await at(`${TABLE_ID}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { Imagenes: [] } }) });
        await fetch(`https://content.airtable.com/v0/${BASE_ID}/${id}/${fid}/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: q.foto.tipo || 'image/jpeg', file: q.foto.b64, filename: 'ejercicio.jpg' }) }).catch(() => {}); }
      return res.status(200).json({ ok: true, id });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  try {
    let allRecords = [];
    let offset = null;

    // Bucle de paginación — carga TODOS los ejercicios, no solo los primeros 100
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?pageSize=100${offset ? '&offset=' + offset : ''}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || null;
    } while (offset);

    const ejercicios = allRecords.map(rec => ({
      id: rec.id,
      nombre: rec.fields['Nombre'] || rec.fields['Name'] || '—',
      zona: rec.fields['Zona'] || '',
      descripcion: rec.fields['Descripcion'] || '',
      descripcionSP: rec.fields['Descripcion suelo pelvico'] || '',
      youtubeUrl: rec.fields['YouTubeURL'] || '',
      imagen: rec.fields['Imagenes']?.[0]?.thumbnails?.large?.url || rec.fields['Imagenes']?.[0]?.url || '',
      creado: rec.createdTime || '',
      series: rec.fields['Series'] || 3,
      reps: rec.fields['Reps'] || 10,
      duracion: rec.fields['Duracion'] || 0,
      descanso: rec.fields['Descanso'] || 0,
    }));

    return res.status(200).json({ ok: true, ejercicios });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
