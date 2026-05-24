"use strict";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── LOGIN FISIO (POST /api/fisios?action=login) ──────────────────────────
  if (req.method === 'POST') {
    let body = {};
    try { body = await new Promise((resolve) => {
      let d = ''; req.on('data', c => d += c);
      req.on('end', () => resolve(JSON.parse(d || '{}')));
    }); } catch(e) {}

    const { nombre, password } = body;
    if (!nombre || !password) {
      return res.status(400).json({ ok: false, error: 'Faltan datos' });
    }

    try {
      const nombreClean = nombre.trim().toUpperCase();
      const url = `https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}?filterByFormula=UPPER({Name})="${nombreClean}"&fields[]=Name&fields[]=Password&fields[]=Role&fields[]=NºColegiado&fields[]=Foto`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();

      if (!data.records?.length) {
        return res.status(200).json({ ok: false, error: 'Usuario no encontrado' });
      }

      const rec = data.records[0];
      const pwdAirtable = String(rec.fields['Password'] || '').trim();
      const pwdInput = String(password).trim();

      if (pwdAirtable !== pwdInput) {
        return res.status(200).json({ ok: false, error: 'Contraseña incorrecta' });
      }

      const role = (rec.fields['Role'] || 'fisio').toLowerCase();
      if (!role) {
        return res.status(200).json({ ok: false, error: 'Sin acceso al panel' });
      }

      return res.status(200).json({
        ok: true,
        fisio: {
          id: rec.id,
          nombre: rec.fields['Name'] || nombre,
          role: role,
          colegiado: rec.fields['NºColegiado'] || '',
          foto: rec.fields['Foto']?.[0]?.url || ''
        }
      });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET LISTA FISIOS (para selector de anamnesis, etc.) ──────────────────
  if (req.method === 'GET') {
    const { pwd } = req.query;
    if (pwd !== FISIO_PASSWORD) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}?fields[]=Name&fields[]=NºColegiado&fields[]=Foto&fields[]=Role`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const fisios = (data.records || [])
        .filter(rec => rec.fields['Role']) // solo los que tienen role
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
