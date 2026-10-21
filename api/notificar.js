"use strict";
// Envía avisos:
//  · del fisio al paciente (con la contraseña del panel): { pacienteId, pwd, title, message, url }
//  · del paciente a su fisio cuando escribe en el chat: { fisioId, pacienteId, pacienteNombre, message }
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const { avisar, idValido } = require('./_push');

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
  const corta = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  // Paciente → su fisio (mensaje de chat)
  if (body.fisioId) {
    const { fisioId, pacienteId, pacienteNombre, message } = body;
    if (!idValido(fisioId) || !idValido(pacienteId)) return res.status(400).json({ ok: false });
    const nombre = corta(String(pacienteNombre || 'Un paciente').split(' ')[0], 30);
    const ok = await avisar('fisio', fisioId, {
      title: `${nombre} te ha escrito`,
      body: corta(message, 140) || 'Nuevo mensaje en el chat',
      url: `/fisio?s=msg&p=${pacienteId}`,
      tag: 'chat-' + pacienteId
    });
    return res.status(200).json({ ok });
  }

  // Fisio → paciente
  if (body.pacienteId && String(body.pwd || '').trim() === FISIO_PASSWORD.trim()) {
    const ok = await avisar('paciente', body.pacienteId, {
      title: corta(body.title || 'FISIO365', 60),
      body: corta(body.message || 'Tu fisio te ha enviado un mensaje', 160),
      url: body.url || '/?s=mensajes',
      tag: body.tag || ''
    });
    return res.status(200).json({ ok });
  }

  return res.status(400).json({ ok: false, error: 'Faltan datos' });
};
