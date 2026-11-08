// Mudanza a Cloudflare (nov 2026): entrega las variables de la app SOLO al workflow
// .github/workflows/fisio365.yml del repo privado FISIO365/fisio-school (rama main),
// que se identifica con un token OIDC firmado por GitHub. Nadie más puede pedirlo.
// Vercel no deja leer las variables «sensitive» desde fuera; por eso hace falta esto.
// Se apaga sola el 31/12/2026 y se borra al terminar la mudanza.
const crypto = require('crypto');
const CLAVES = ['AIRTABLE_TOKEN', 'ANTHROPIC_API_KEY', 'ARCHIVOS_CLAVE', 'ARCHIVOS_URL', 'BREVO_API_KEY', 'CRON_SECRET', 'DB_URL', 'DIAG_KEY', 'EMITIR_TOKEN', 'FISIO_PASSWORD', 'HOLDED_API_KEY', 'MIGRAR_KEY', 'STRIPE_SECRET_KEY', 'SUG_KEY', 'TALLY_API_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY'];
const ISS = 'https://token.actions.githubusercontent.com', AUD = 'fisio365-entorno-cf', REPO = 'FISIO365/fisio-school';
const b64 = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function verificar(jwt) {
  const [h, p, s] = String(jwt || '').split('.');
  if (!h || !p || !s) return null;
  const cab = JSON.parse(b64(h)), dat = JSON.parse(b64(p));
  if (cab.alg !== 'RS256' || !cab.kid) return null;
  const r = await fetch(ISS + '/.well-known/jwks');
  const jwk = ((await r.json()).keys || []).find(k => k.kid === cab.kid);
  if (!jwk) return null;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64(s));
  const ahora = Date.now() / 1000;
  if (!ok || dat.iss !== ISS || dat.aud !== AUD || dat.repository !== REPO || dat.ref !== 'refs/heads/main') return null;
  if (!String(dat.workflow_ref || '').startsWith(REPO + '/.github/workflows/fisio365.yml@')) return null;
  if (!(dat.exp > ahora) || !(dat.iat > ahora - 600) || (dat.nbf && dat.nbf > ahora + 60)) return null;
  return dat;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || Date.now() > Date.UTC(2026, 11, 31)) return res.status(404).end();
  let dat = null;
  try { dat = await verificar(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')); } catch (e) { dat = null; }
  if (!dat) return res.status(404).end();
  const env = {};
  for (const k of CLAVES) if (process.env[k]) env[k] = process.env[k];
  return res.status(200).json({ ok: true, env });
};
