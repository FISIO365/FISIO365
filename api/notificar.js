"use strict";
const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails('mailto:info@fisioterapia365.com', VAPID_PUBLIC, VAPID_PRIVATE);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(req.body || '{}'); } catch(e) { body = {}; }
  }

  const { subscription, title, message } = body;
  if (!subscription) return res.status(400).json({ ok: false });

  try {
    await webpush.sendNotification(subscription, JSON.stringify({
      title: title || 'FISIO365',
      body: message || 'Tu fisio ha actualizado tu programa 💪'
    }));
    return res.status(200).json({ ok: true });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
