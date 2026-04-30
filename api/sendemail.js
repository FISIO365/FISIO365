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
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#e8e8e8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#f5f2ee;border-radius:16px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
    
    <div style="background:#000;padding:32px;text-align:center;">
      <div style="color:#f5f2ee;font-size:32px;font-weight:800;letter-spacing:-1px;font-family:'Helvetica Neue',Arial,sans-serif;">FISIO365</div>
    </div>

    <div style="padding:36px 32px;">
      
      <h2 style="font-size:22px;font-weight:700;color:#000;margin:0 0 20px;">Hola, ${nombre} 👋</h2>
      
      <p style="color:#555;line-height:1.7;font-size:15px;margin:0 0 32px;">Tu fisioterapeuta te ha dado acceso a la app de FISIO365, donde podrás ver tu programa de ejercicios personalizado cada día y registrar tu progreso.</p>

      <div style="background:white;border-radius:12px;padding:24px;margin-bottom:24px;">
        <p style="margin:0 0 16px;color:#999;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Tu acceso</p>
        <p style="margin:0 0 8px;color:#000;font-size:14px;"><strong>Email:</strong> ${email}</p>
        <p style="margin:8px 0 0;color:#000;font-size:14px;"><strong>PIN:</strong> <span style="font-size:22px;font-weight:800;color:#ada3da;letter-spacing:6px;">${pin}</span></p>
      </div>

      <a href="https://fisio365.vercel.app" style="display:block;background:#000;color:#f5f2ee;text-align:center;padding:16px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;margin-bottom:32px;">Abrir FISIO365</a>

      <div style="background:white;border-radius:12px;padding:24px;margin-bottom:32px;">
        <p style="margin:0 0 16px;color:#999;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Instalar en tu móvil</p>
        <p style="margin:0 0 6px;color:#000;font-size:14px;font-weight:600;">iPhone</p>
        <p style="margin:0 0 16px;color:#666;font-size:13px;line-height:1.6;">Abre Safari → toca el botón Compartir ↑ → "Añadir a pantalla de inicio"</p>
        <p style="margin:0 0 6px;color:#000;font-size:14px;font-weight:600;">Android</p>
        <p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Abre Chrome → toca los 3 puntos ⋮ → "Añadir a pantalla de inicio"</p>
      </div>

      <p style="color:#aaa;font-size:12px;text-align:center;margin:0;line-height:1.6;">Si tienes alguna duda, contacta con tu fisioterapeuta.<br>FISIO365 — fisioterapia365.com</p>

    </div>
  </div>
</body>
</html>`;

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
        subject: 'Tu área de seguimiento y ejercicios',
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
