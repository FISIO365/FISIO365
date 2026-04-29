"use strict";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parsear body manualmente si no está parseado
  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      body = JSON.parse(req.body || '{}');
    } catch(e) {
      body = {};
    }
  }

  const { patientId, comentario } = body;
  if (!patientId) return res.status(400).json({ ok: false, error: 'Falta patientId' });

  try {
    const getRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${patientId}?fields[]=Diario&fields[]=UltimaSession&fields[]=RachaDias`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const getData = await getRes.json();
    const fields = getData.fields || {};

    const today = new Date().toISOString().split('T')[0];
    const ultimaSession = fields['UltimaSession'] || '';
    const rachaActual = parseInt(fields['RachaDias']) || 0;

    let nuevaRacha = 1;
    if (ultimaSession) {
      if (ultimaSession === today) {
        nuevaRacha = rachaActual;
      } else {
        const [ay, am, ad] = ultimaSession.split('-').map(Number);
        const [by, bm, bd] = today.split('-').map(Number);
        const dateA = new Date(ay, am-1, ad);
        const dateB = new Date(by, bm-1, bd);
        const diffDias = Math.round((dateB - dateA) / (1000 * 60 * 60 * 24));
        if (diffDias === 1) nuevaRacha = rachaActual + 1;
        else nuevaRacha = 1;
      }
    }

    const diarioActual = fields['Diario'] || '';
    const fechaHoy = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const updateFields = {
      UltimaSession: today,
      RachaDias: nuevaRacha
    };

    if (comentario?.trim()) {
      const nuevaEntrada = `${fechaHoy} — ${comentario.trim()}`;
      updateFields['Diario'] = diarioActual ? `${nuevaEntrada}\n${diarioActual}` : nuevaEntrada;
    }

    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${patientId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: updateFields })
    });

    return res.status(200).json({ ok: true, racha: nuevaRacha });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
