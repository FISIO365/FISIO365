"use strict";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';
const PROGRESO_TABLE = 'tblbOukia79RVtTVt';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = {};
  if (req.method === 'POST') {
    try { body = await new Promise((resolve) => {
      let d = ''; req.on('data', c => d += c);
      req.on('end', () => resolve(JSON.parse(d || '{}')));
    }); } catch(e) {}
  }

  const action = req.query.action || body.action || '';

  // ── GET PROGRESO ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'progreso') {
    const { pwd, fisioId } = req.query;
    if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });
    if (!fisioId) return res.status(400).json({ ok: false, error: 'Falta fisioId' });
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}?filterByFormula={FisioId}="${fisioId}"`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const progreso = {};
      (data.records || []).forEach(rec => {
        progreso[rec.fields['Seccion']] = {
          estado: rec.fields['Estado'] || '',
          fecha: rec.fields['Fecha'] || '',
          recordId: rec.id
        };
      });
      return res.status(200).json({ ok: true, progreso });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── POST PROGRESO ────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'progreso') {
    const pwd = body.pwd || '';
    if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const { fisioId, seccion, estado } = body;
    if (!fisioId || !seccion) return res.status(400).json({ ok: false, error: 'Faltan datos' });
    try {
      const checkUrl = `https://api.airtable.com/v0/${BASE_ID}/${PROGRESO_TABLE}?filterByFormula=AND({FisioId}="${fisioId}",{Seccion}="${seccion}")`;
      const checkR = await fetch(checkUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
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
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── POST LOGIN FISIO ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { nombre, password } = body;
    if (!nombre || !password) return res.status(400).json({ ok: false, error: 'Faltan datos' });
    try {
      const nombreClean = nombre.trim().toUpperCase();
      const url = `https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}?filterByFormula=UPPER({Name})="${nombreClean}"`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      if (!data.records?.length) return res.status(200).json({ ok: false, error: 'Usuario no encontrado' });
      const rec = data.records[0];
      const fields = rec.fields;
      if (String(fields['Password'] || '').trim() !== String(password).trim()) {
        return res.status(200).json({ ok: false, error: 'Contraseña incorrecta' });
      }
      const role = (fields['Role'] || '').toLowerCase();
      if (!role) return res.status(200).json({ ok: false, error: 'Sin acceso al panel' });
      const accesos = {};
      Object.keys(fields).forEach(key => {
        if (key.startsWith('acc_')) accesos[key.replace('acc_', '')] = fields[key] === true;
      });
      return res.status(200).json({
        ok: true,
        apiToken: FISIO_PASSWORD,
        fisio: {
          id: rec.id,
          nombre: fields['Name'] || nombre,
          role,
          colegiado: fields['NºColegiado'] || '',
          foto: fields['Foto']?.[0]?.url || '',
          accesos
        }
      });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET VERSION ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'version') {
    const { pwd } = req.query;
    if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });
    return res.status(200).json({ ok: true, version: process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString() });
  }

  // ── GET LISTA FISIOS ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { pwd } = req.query;
    if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const fisios = (data.records || [])
        .filter(rec => rec.fields['Role'])
        .map(rec => ({
          id: rec.id,
          nombre: rec.fields['Name'] || '',
          colegiado: rec.fields['NºColegiado'] || '',
          foto: rec.fields['Foto']?.[0]?.url || '',
          role: rec.fields['Role'] || 'fisio'
        }));
      return res.status(200).json({ ok: true, fisios });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
};
