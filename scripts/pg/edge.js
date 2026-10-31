// Prueba del camino «edge»: chat.js (edge) → /api/schedule?action=pg-proxy → Postgres (PGlite)
(async () => {
  process.env.DB_URL = process.env.DB_URL || 'postgres://prueba'; process.env.APP_URL = 'http://localhost:8899';
  const db = await require('./pglite')(); global.__PG_TEST__ = db;
  const PG = require('../../api/_pg.js');
  for (const s of PG.SQL_INIT.split(';').map(x => x.trim()).filter(Boolean)) await db.query(s);
  const datos = require('./datos-falsos')();
  for (const [tb, L] of Object.entries(datos)) for (let i = 0; i < L.length; i += 500) {
    const lote = L.slice(i, i + 500), vals = [], ps = [];
    lote.forEach((r, j) => { ps.push(`($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4},$${j * 4 + 4})`); vals.push(tb, r.id, JSON.stringify(r.fields), r.creado); });
    await db.query('insert into registros (tabla,id,fields,creado,modificado) values ' + ps.join(','), vals);
  }
  const S = require('../../api/schedule.js');
  // Servidor con schedule.js (como Vercel en Node)
  await new Promise(ok => require('http').createServer((rq, rs) => {
    let b = ''; rq.on('data', c => b += c); rq.on('end', async () => {
      const u = new URL(rq.url, 'http://x'); const h = {};
      const res = { setHeader: (k, v) => { h[k] = v; }, getHeader: k => h[k], status(c) { rs.statusCode = c; return res; }, json(j) { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(j)); }, send(x) { Object.entries(h).forEach(([k, v]) => rs.setHeader(k, v)); rs.end(x); }, end(x) { rs.end(x); }, on() {} };
      await S({ method: rq.method, query: Object.fromEntries(u.searchParams), body: b ? JSON.parse(b) : undefined, headers: rq.headers, url: rq.url }, res);
    });
  }).listen(8899, ok));
  // chat.js convertido a CommonJS, con EdgeRuntime definido
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../api/chat.js'), 'utf8').replace(/export const config[^\n]*\n/, '').replace('export default async function handler', 'module.exports = async function handler');
  const tmp = path.join(__dirname, '../../api/_tmp_chat_edge.js'); fs.writeFileSync(tmp, src);
  globalThis.EdgeRuntime = 'prueba';
  try {
    delete require.cache[require.resolve('../../api/_base.js')];
    const chat = require(tmp);
    const pac = datos['tbldBVgClS4HY2mOJ'][0].id;
    const pwd = process.env.FISIO_PASSWORD || 'FISIO365App';
    const t0 = Date.now();
    let r = await chat(new Request(`http://localhost/api/chat?action=hilo&pwd=${pwd}&pacienteId=${pac}`));
    console.log('chat (edge) hilo:', r.status, (await r.text()).slice(0, 200), Date.now() - t0, 'ms');
    r = await chat(new Request(`http://localhost/api/chat`, { method: 'POST', body: JSON.stringify({ action: 'enviar', pwd, pacienteId: pac, de: 'fisio', fisioId: datos['tbl2mLUrnaKCFTs6g'][0].id, texto: 'Hola, ¿cómo va?', archivo: { tipo: 'image/png', base64: Buffer.from('fakepng').toString('base64'), nombre: 'foto.png' } }) }));
    console.log('chat (edge) enviar:', r.status, (await r.text()).slice(0, 300));
    r = await chat(new Request(`http://localhost/api/chat?action=hilo&pwd=${pwd}&pacienteId=${pac}`));
    const tx = await r.text(); console.log('chat (edge) hilo después:', r.status, tx.slice(-300));
    const au = (tx.match(/http:\/\/localhost:8899\/api\/schedule\?action=archivo[^"]+/) || [])[0]; if (au) { const a = await fetch(au); console.log('adjunto servido:', a.status, a.headers.get('content-type'), (await a.text())); }
  } finally { fs.unlinkSync(tmp); }
  process.exit(0);
})().catch(e => { console.error('FALLO', e.message, String(e.stack).split('\n').slice(1, 4).join(' | ')); process.exit(1); });
