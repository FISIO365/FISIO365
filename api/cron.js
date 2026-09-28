"use strict";
const webpush = require('web-push');
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const TAREAS_TABLE = 'tblIXYE5ToRNY7MN4'; // aquí se guarda cada vez que un paciente pulsa "Hecho"
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
webpush.setVapidDetails('mailto:info@fisio365.com', VAPID_PUBLIC, VAPID_PRIVATE);

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  // Misma fecha que usa la app al guardar "Hecho" (index.html: TODAY)
  const today = new Date().toISOString().split('T')[0];
  try {
    // 1. Pacientes que YA han pulsado "Hecho" hoy.
    //    Se lee la tabla de tareas de la más reciente a la más antigua
    //    y se para en cuanto aparece una fecha anterior a hoy.
    const hechosHoy = new Set();
    let offsetT = null, seguir = true;
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${TAREAS_TABLE}?fields[]=PacienteId&fields[]=Fecha&sort[0][field]=Fecha&sort[0][direction]=desc&pageSize=100${offsetT ? '&offset=' + offsetT : ''}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const d = await r.json();
      if (d.error) throw new Error('Tareas: ' + (d.error.message || d.error));
      for (const rec of (d.records || [])) {
        const fecha = String(rec.fields?.['Fecha'] || '').slice(0, 10);
        if (fecha === today) hechosHoy.add(rec.fields?.['PacienteId'] || '');
        else if (fecha && fecha < today) { seguir = false; break; }
      }
      offsetT = d.offset || null;
    } while (offsetT && seguir);

    // 2. Pacientes con notificaciones activadas
    let allRecords = [], offset = null;
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}?fields[]=UltimaSession&fields[]=PushSubscription&fields[]=FULL NAME&pageSize=100${offset ? '&offset=' + offset : ''}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const d = await r.json();
      allRecords = allRecords.concat(d.records || []);
      offset = d.offset;
    } while (offset);

    // 3. Avisar solo a quien NO ha hecho los ejercicios hoy
    let enviadas = 0, errores = 0, yaHechos = 0;
    for (const rec of allRecords) {
      const { UltimaSession, PushSubscription } = rec.fields || {};
      if (!PushSubscription) continue;
      if (UltimaSession === today || hechosHoy.has(rec.id)) { yaHechos++; continue; }
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
    return res.status(200).json({ ok: true, enviadas, errores, yaHechos });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
