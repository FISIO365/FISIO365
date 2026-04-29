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
  if (!patientId) return res.status(400).json({ ok: false, error: 'Falta patientId' });

  try {
    const getRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${patientId}?fields[]=fld5O6xTbie3JkeO8&fields[]=UltimaSession`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const getData = await getRes.json();
    const fields = getData.fields || {};

    const today = new Date().toISOString().split('T')[0];
    const diarioActual = fields['fld5O6xTbie3JkeO8'] || fields['Diario'] || '';
    const fechaHoy = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const updateFields = { UltimaSession: today };

    if (comentario?.trim()) {
      const nuevaEntrada = `${fechaHoy} — ${comentario.trim()}`;
      updateFields['Diario'] = diarioActual ? `${nuevaEntrada}\n${diarioActual}` : nuevaEntrada;
    }

    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${patientId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': '
