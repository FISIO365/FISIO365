"use strict";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(req.body || '{}'); } catch(e) { body = {}; }
  }

  const { patientId, comentario } = body;
  if (!patientId || !comentario?.trim()) return res.status(400).json({ ok: false, error: 'Faltan datos' });

  try {
    const getRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${patientId}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const getData = await getRes.json();
    const fields = getData.fields || {};
    const diarioActual = fields['Diario'] || '';

    const today = new Date().toISOString().split('T')[0];
    const fechaHoy = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nuevaEntrada = `${fechaHoy} — ${comentario.trim()}`;
    const nuevoDiario = diarioActual ? `${nuevaEntrada}\n${diarioActual}` : nuevaEntrada;

    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${patientId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { Diario: nuevoDiario, UltimaSession: today } })
    });

    return res.status(200).json({ ok: true });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
