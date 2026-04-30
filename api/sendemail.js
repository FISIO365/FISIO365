"use strict";
const BREVO_API_KEY = process.env.BREVO_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(req.body || '{}'); } catch(e) { body = {}; }
  }

  const { nombre, email, pin } = body;
  if (!nombre || !email || !pin) return res.status(400).json({ ok: false, error: 'Faltan datos' });

  const htmlContent = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#f5f2ee;padding:32px;border-radius:16px;">
      <div style="background:#000;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
        <h1 style="color:#f5f2ee;font-size:28px;margin:0;letter-spacing:-1px;">FISIO365</h1>
      </div>
      <h2 style="color:#000;font-size:20px;">¡Hola, ${nombre}! 👋</h2>
      <p style="color:#666;line-height:1.6;">Tu fisioterapeuta te ha dado acceso a la app FISIO365, donde podrás ver tu programa de ejercicios personalizado cada día.</p>
      
      <div style="background:white;border-radius:12px;padding:20px;margin:20px 0;border:1.5px solid rgba(0,0,0,0.1);">
        <p style="margin:0 0 8px;color:#888;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Tu acceso</p>
        <p style="margin:0 0 4px;color:#000;"><strong>Email:</strong> ${email}</p>
        <p style="margin:0;color:#000;"><strong>PIN:</strong> <span style="font-size:24px;font-weight:800;color:#ada3da;letter-spacing:4px;">${pin}</span></p>
      </div>

      <div style="background:white;border-radius:12px;padding:20px;margin:20px 0;border:1.5px solid rgba(0,0,0,0.1);">
        <p style="margin:0 0 12px;color:#888;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Cómo entrar</p>
        <p style="margin:0 0 8px;color:#000;">1️⃣ Abre <a href="https://fisio365.vercel.app" style="color:#ada3da;font-weight:600;">fisio365.vercel.app</a> en tu móvil</p>
        <p style="margin:0 0 8px;color:#000;">2️⃣ Introduce tu email y el PIN de arriba</p>
        <p style="margin:0;color:#000;">3️⃣ ¡Listo! Ya puedes ver tu programa</p>
      </div>

      <div style="background:white;border-radius:12px;padding:20px;margin:20px 0;border:1.5px solid rgba(0,0,0,0.1);">
        <p style="margin:0 0 12px;color:#888;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Instalar en tu móvil</p>
        <p style="margin:0 0 6px;color:#000;font-weight:600;">iPhone:</p>
        <p style="margin:0 0 12px;color:#666;font-size:13px;">Abre Safari → botón Compartir ↑ → "Añadir a pantalla de inicio"</p>
        <p style="margin:0 0 6px;color:#000;font-weight:600;">Android:</p>
        <p style="margin:0;color:#666;font-size:13px;">Abre Chrome → 3 puntos ⋮ → "Añadir a pantalla de inicio"</p>
      </div>

      <p style="color:#888;font-size:12px;text-align:center;margin-top:24px;">Si tienes alguna duda, contacta con tu fisioterapeuta.<br>FISIO365 — fisioterapia365.com</p>
    </div>
  `;

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'FISIO365', email: 'info@fisioterapia365.com' },
        to: [{ email, name: nombre }],
        subject: `¡Bienvenido/a a FISIO365, ${nombre}! 🎉`,
        htmlContent
      })
    });

    if (response.ok) {
      return res.status(200).json({ ok: true });
    } else {
      const err = await response.json();
      return res.status(500).json({ ok: false, error: err.message });
    }
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
