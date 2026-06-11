"use strict";
const webpush = require('web-push');
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';

webpush.setVapidDetails('mailto:info@fisioterapia365.com', VAPID_PUBLIC, VAPID_PRIVATE);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, status: 'notificar online' });

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(req.body || '{}'); } catch(e) { body = {}; }
  }

  const { subscription, title, message, pacienteId, pwd } = body;

  if (subscription) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify({
        title: title || 'FISIO365',
        body: message || 'Tienes un nuevo mensaje'
      }));
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (pacienteId && pwd === FISIO_PASSWORD) {
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      const d = await r.json();
      // Get ALL fields to find PushSubscription
      const fields = d.fields || {};
      const subStr = fields['PushSubscription'] || fields['pushSubscription'] || fields['push_subscription'] || null;
      
      if (!subStr) {
        return res.status(200).json({ 
          ok: false, 
          error: 'Sin suscripcion',
          debug: { fieldKeys: Object.keys(fields), pacienteId }
        });
      }
      
      await webpush.sendNotification(JSON.parse(subStr), JSON.stringify({
        title: title || 'FISIO365',
        body: message || 'Tu fisio te ha enviado un mensaje'
      }));
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Faltan datos' });
};
