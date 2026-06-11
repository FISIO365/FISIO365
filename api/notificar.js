// api/notificar-mensaje.js — Node.js runtime para poder usar web-push
const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const MENSAJES_TABLE = 'MENSAJES';

webpush.setVapidDetails('mailto:info@fisioterapia365.com', VAPID_PUBLIC, VAPID_PRIVATE);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(req.body || '{}'); } catch(e) { body = {}; }
  }

  const { pwd, pacienteId, pacienteNombre, fisioId, fisioNombre, texto, fecha, tipo } = body;
  if ((pwd||'').trim() !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'Auth' });

  try {
    // 1. Guardar en MENSAJES
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MENSAJES_TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        PacienteId: pacienteId || '',
        PacienteNombre: pacienteNombre || '',
        FisioId: fisioId || '',
        FisioNombre: fisioNombre || '',
        Texto: texto || '',
        Fecha: fecha || new Date().toLocaleDateString('es-ES'),
        Tipo: tipo || 'fisio',
        Visto: true,
        RespuestaLeida: false
      }})
    });

    // 2. Buscar suscripción push y notificar
    const rPac = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}?fields[]=PushSubscription`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const dPac = await rPac.json();
    const subStr = dPac.fields?.PushSubscription;

    if (subStr) {
      const subscription = JSON.parse(subStr);
      await webpush.sendNotification(subscription, JSON.stringify({
        title: `Mensaje de ${fisioNombre || 'tu fisio'}`,
        body: texto || 'Tu fisio te ha enviado un mensaje'
      }));
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
