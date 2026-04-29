"use strict";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const TABLE_ID = 'tblxJmnb7LHML2ZZh';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(req.body || '{}'); } catch(e) { body = {}; }
    }
    const { patientId, fecha, valor } = body;
    if (!patientId || !fecha || valor === undefined) return res.status(400).json({ ok: false });
    try {
      const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=AND({PacienteID}="${patientId}",{Fecha}="${fecha}")`;
      const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const searchData = await searchRes.json();
      if (searchData.records?.length > 0) {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${searchData.records[0].id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { Valor: parseInt(valor) } })
        });
      } else {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields: { PacienteID: patientId, Fecha: fecha, Valor: parseInt(valor) } }] })
        });
      }
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === 'GET') {
    const { patientId } = req.query;
    if (!patientId) return res.status(400).json({ ok: false });
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula={PacienteID}="${patientId}"&sort[0][field]=Fecha&sort[0][direction]=asc&pageSize=100`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const registros = (data.records || []).map(rec => ({
        fecha: rec.fields['Fecha'],
        valor: rec.fields['Valor'] || 0
      }));
      return res.status(200).json({ ok: true, registros });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
}
