"use strict";
// Guarda en Airtable a qué móvil enviar los avisos (paciente o fisio), o lo borra si los desactiva
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const { TABLAS, BASE_ID, idValido } = require('./_push');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(req.body || '{}'); } catch(e) { body = {}; }
  }
  const { patientId, fisioId, pwd, subscription, borrar } = body;
  // borrar: true → desactivar avisos (se vacía la suscripción guardada)
  if (!borrar && (!subscription || !subscription.endpoint)) return res.status(400).json({ ok: false });

  let tabla, id;
  if (fisioId) {
    if (String(pwd || '').trim() !== FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false });
    tabla = TABLAS.fisio; id = fisioId;
  } else { tabla = TABLAS.paciente; id = patientId; }
  if (!idValido(id)) return res.status(400).json({ ok: false });

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tabla}/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { PushSubscription: borrar ? '' : JSON.stringify(subscription) } })
    });
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
