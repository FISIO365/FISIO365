// Sustituto de «web-push» para Cloudflare (sin módulos de Node): avisos push con WebCrypto.
// Cifrado aes128gcm (RFC 8291) + firma VAPID ES256 (RFC 8292). Misma interfaz: setVapidDetails, sendNotification.
const enc = new TextEncoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ub64u = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const junta = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
let VAPID = null;
function setVapidDetails(subject, publicKey, privateKey) { VAPID = { subject, publicKey, privateKey }; }
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function claveVapid() {
  const pub = ub64u(VAPID.publicKey); // 65 bytes: 0x04 | x | y
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: b64u(ub64u(VAPID.privateKey)), ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
async function cabeceraVapid(endpoint) {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID.subject })));
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await claveVapid(), enc.encode(h + '.' + p));
  return `vapid t=${h}.${p}.${b64u(firma)}, k=${VAPID.publicKey}`;
}
async function cifrar(sub, payload) {
  const uaPub = ub64u(sub.keys.p256dh), auth = ub64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, junta(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const datos = junta(typeof payload === 'string' ? enc.encode(payload) : new Uint8Array(payload || []), new Uint8Array([2]));
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, datos));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return junta(salt, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}
async function sendNotification(sub, payload, opts) {
  if (!VAPID) throw new Error('VAPID sin configurar');
  const ttl = String((opts && opts.TTL) || 2419200);
  const body = payload ? await cifrar(sub, payload) : null;
  const headers = { TTL: ttl, Authorization: await cabeceraVapid(sub.endpoint), Urgency: 'normal' };
  if (body) { headers['Content-Encoding'] = 'aes128gcm'; headers['Content-Type'] = 'application/octet-stream'; }
  const r = await fetch(sub.endpoint, { method: 'POST', headers, body });
  if (!r.ok) { const e = new Error('Push ' + r.status); e.statusCode = r.status; e.body = await r.text().catch(() => ''); throw e; }
  return { statusCode: r.status };
}
export { setVapidDetails, sendNotification };
export default { setVapidDetails, sendNotification };
