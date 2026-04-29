"use strict";
const webpush = require('web-push');
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails('mailto:info@fisio365.com', VAPID_PUBLIC, VAPID_PRIVATE);

module.exports = async function handler(req, res) {
  // Solo permitir llamadas del cron de Vercel
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    // Obtener todos los pacientes con suscripción push
    let allRecords = [], offset = null;
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}?fields[]=UltimaSession&fields[]=PushSubscription&fields[]=FULL NAME&pageSize=100${offset ? '&offset=' + offset : ''}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const d = await r.json();
      allRecords = allRecords.concat(d.records || []);
      offset = d.offset;
    } while (offset);

    let enviadas = 0, errores = 0;

    for (const rec of allRecords) {
      const { UltimaSession, PushSubscription } = rec.fields || {};
      if (!PushSubscription) continue;
      if (UltimaSession === today) continue; // ya completó hoy

      try {
        const sub = JSON.parse(PushSubscription);
        await webpush.sendNotification(sub, JSON.stringify({
          title: 'FISIO365 💪',
          body: '¡Recuerda hacer tus ejercicios de hoy! Tu recuperación depende de la constancia.'
        }));
        enviadas++;
      } catch(e) {
        errores++;
      }
    }

    return res.status(200).json({ ok: true, enviadas, errores });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
