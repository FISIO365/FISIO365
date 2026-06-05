const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const ANAMNESIS_TABLE = 'tblF4as0orW1b6KIw';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || '';
  const queryPwd = req.query.pwd || '';

  let body = {};
  if (req.method === 'POST') {
    try {
      if (typeof req.body === 'string') body = JSON.parse(req.body);
      else body = req.body || {};
    } catch(e) {
      const chunks = [];
      await new Promise(resolve => { req.on('data', c => chunks.push(c)); req.on('end', resolve); });
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch(e) { body = {}; }
    }
  }

  const pwd = (body.pwd || queryPwd || '').trim();
  const expected = (FISIO_PASSWORD || '').trim();
  if (pwd !== expected) return res.status(401).json({ ok: false, error: 'Contrasena incorrecta' });

  // ── LISTAR INFORMES ──────────────────────────────────────────────────────
  if (action === 'listar-informes') {
    try {
      const fields = ['PacienteNombre','FisioNombre','FechaValoracion','InformeGenerado','Protocolo'];
      const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
      const aUrl = `https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}?${fieldParams}&sort[0][field]=FechaValoracion&sort[0][direction]=desc&pageSize=50`;
      const r = await fetch(aUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const informes = (data.records || []).map(rec => ({
        id: rec.id,
        pacienteNombre: rec.fields['PacienteNombre'] || '—',
        fisioNombre: rec.fields['FisioNombre'] || '—',
        fecha: rec.fields['FechaValoracion'] || '—',
        informe: rec.fields['InformeGenerado'] || '',
        protocolo: rec.fields['Protocolo'] || 'hernia',
      }));
      return res.status(200).json({ ok: true, informes });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GUARDAR INFORME EN PACIENTE ─────────────────────────────────────────
  if (action === 'guardar-informe' && req.method === 'POST') {
    const { pacienteId, fisioNombre, protocolo, informe, pacienteNombre } = body;
    try {
      const fecha = new Date().toLocaleDateString('es-ES');
      const entrada = `--- ${fecha} | ${fisioNombre||''} | ${protocolo||''} ---\n${informe||''}\n`;

      let textoActual = '';
      if (pacienteId) {
        const rGet = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}?fields[]=Anamnesis`, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
        });
        const dGet = await rGet.json();
        textoActual = dGet.fields?.['Anamnesis'] || '';
      }

      const nuevoTexto = entrada + (textoActual ? '\n' + textoActual : '');

      if (pacienteId) {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { Anamnesis: nuevoTexto } })
        });
      }

      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: {
          PacienteNombre: pacienteNombre || '',
          FisioNombre: fisioNombre || '',
          FechaValoracion: new Date().toISOString().split('T')[0],
          InformeGenerado: informe || '',
          Protocolo: protocolo || 'hernia'
        }}]})
      });

      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── ACTUALIZAR INFORME ───────────────────────────────────────────────────
  if (action === 'actualizar-informe' && req.method === 'POST') {
    const { id, informe } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'Falta id' });
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { InformeGenerado: informe || '' } })
      });
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── BORRAR INFORME ───────────────────────────────────────────────────────
  if (action === 'borrar-informe' && req.method === 'POST') {
    const { id } = body;
    if (!id) return res.status(400).json({ ok: false, error: 'Falta id' });
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET PACIENTES ────────────────────────────────────────────────────────
  if (req.method === 'GET' && !action) {
    try {
      let allRecords = [], offset = null;
      do {
        const pageUrl = `https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}?fields[]=FULL NAME&fields[]=EMAIL&fields[]=PIN&fields[]=WHATSAPP&sort[0][field]=FULL NAME&sort[0][direction]=asc&pageSize=100${offset ? '&offset=' + offset : ''}`;
        const pageRes = await fetch(pageUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const pageData = await pageRes.json();
        allRecords = allRecords.concat(pageData.records || []);
        offset = pageData.offset;
      } while (offset);
      const pacientes = allRecords.map(rec => ({
        id: rec.id,
        nombre: rec.fields['FULL NAME'] || '—',
        email: rec.fields['EMAIL'] || '',
        pin: rec.fields['PIN'] || '',
        telefono: rec.fields['WHATSAPP'] || ''
      }));
      return res.status(200).json({ ok: true, pacientes });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── POST NUEVO PACIENTE ──────────────────────────────────────────────────
  if (req.method === 'POST' && !action) {
    const { nombre, email, telefono } = body;
    if (!nombre || !email) return res.status(400).json({ ok: false, error: 'Nombre y email obligatorios' });
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: { 'FULL NAME': nombre, EMAIL: email, WHATSAPP: telefono || '', PIN: pin } }] })
      });
      const data = await r.json();
      const rec = data.records?.[0];
      return res.status(200).json({ ok: true, paciente: { id: rec.id, nombre, email, pin } });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(404).json({ ok: false, error: 'Ruta no encontrada' });
};
