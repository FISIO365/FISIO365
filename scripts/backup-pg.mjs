// Copia de seguridad de toda la base de datos de la app (Postgres), en JSON: un archivo por tabla
// (mismo formato que las copias de Airtable: [{ id, createdTime, fields }]). Con --adjuntos baja también los archivos.
// La lanza cada noche GitHub Actions (.github/workflows/backup.yml), que le pasa un token OIDC (sin claves guardadas).
// Uso: OIDC_TOKEN=... node scripts/backup-pg.mjs <carpeta-salida> [--adjuntos]
import fs from 'node:fs';
import path from 'node:path';

const APP = (process.env.APP_URL || 'https://app.fisioterapia365.com').replace(/\/+$/, '');
// El token de GitHub dura poco: se pide uno nuevo cada 4 minutos
let TOK = process.env.OIDC_TOKEN, tokT = Date.now();
async function token() {
  if (Date.now() - tokT > 240000 && process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    const r = await fetch(process.env.ACTIONS_ID_TOKEN_REQUEST_URL + '&audience=fisio365-copia', { headers: { Authorization: 'bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN } });
    const j = await r.json().catch(() => ({})); if (j.value) { TOK = j.value; tokT = Date.now(); }
  }
  return TOK;
}
if (!TOK) { console.error('Falta OIDC_TOKEN'); process.exit(1); }
const OUT = process.argv[2] || 'backup';
const ADJ = process.argv.includes('--adjuntos');
const espera = ms => new Promise(r => setTimeout(r, ms));
async function pide(cuerpo) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${APP}/api/schedule?action=copia-seguridad`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) return j;
    if (r.status === 401) throw new Error('No autorizado (token OIDC)');
    await espera(2000 * (i + 1));
  }
  throw new Error('La app no responde: ' + JSON.stringify(cuerpo).slice(0, 80));
}
const limpio = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'tabla';

const dir = path.join(OUT, 'FISIO365'); fs.mkdirSync(dir, { recursive: true });
const t0 = await pide({ que: 'tablas' });
const resumen = { fecha: new Date().toISOString(), origen: 'Postgres', tablas: {}, archivos: t0.archivos };
fs.writeFileSync(path.join(dir, '_contadores.json'), JSON.stringify(t0.contadores));
let total = 0;
for (const t of t0.tablas) {
  const recs = []; let desde = '';
  for (;;) { const j = await pide({ que: 'registros', tabla: t.id, desde }); recs.push(...j.registros); if (j.registros.length < 1000) break; desde = j.registros[j.registros.length - 1].id; }
  if (recs.length !== t.n) console.warn(`[aviso] ${t.nombre}: ${recs.length} de ${t.n}`);
  fs.writeFileSync(path.join(dir, `${limpio(t.nombre)}__${t.id}.json`), JSON.stringify(recs));
  resumen.tablas[t.nombre] = recs.length; total += recs.length;
  console.log(`${t.nombre}: ${recs.length} registros`);
}
if (total === 0) { console.error('La copia ha salido vacía'); process.exit(1); }
// Archivos (consentimientos, PDFs, fotos…): la lista siempre; los archivos en sí, con --adjuntos
const lista = []; { let desde = ''; for (;;) { const j = await pide({ que: 'archivos', desde }); lista.push(...j.archivos); if (j.archivos.length < 500) break; desde = j.archivos[j.archivos.length - 1].id; } }
fs.writeFileSync(path.join(dir, '_archivos.json'), JSON.stringify(lista));
if (ADJ) {
  const ad = path.join(dir, '_adjuntos'); fs.mkdirSync(ad, { recursive: true }); let n = 0, mb = 0, fallos = 0; const F = [];
  const nom = new Map(lista.map(a => [a.id, a]));
  for (let i = 0; i < lista.length; i += 20) {
    const j = await pide({ que: 'bajar', ids: lista.slice(i, i + 20).map(a => a.id) });
    await Promise.all(j.archivos.map(async x => {
      try {
        let buf; if (x.url) { const r = await fetch(x.url); if (!r.ok) throw 'almacén ' + r.status; buf = Buffer.from(await r.arrayBuffer()); } else if (x.b64 != null) buf = Buffer.from(x.b64, 'base64'); else throw 'sin enlace';
        fs.writeFileSync(path.join(ad, `${x.id}__${String((nom.get(x.id) || {}).nombre || 'archivo').replace(/[\\/:*?"<>|]/g, '_')}`), buf); n++; mb += buf.length / 1048576;
      } catch (e) { fallos++; F.push({ id: x.id, motivo: String(e || 'error') }); }
    }));
  }
  // Dónde se usa cada archivo que no se ha podido bajar (tabla y campo; sin datos de pacientes en el registro público)
  const donde = new Map();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
    const tn = f.replace(/__tbl.*$/, ''); for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) for (const [k, v] of Object.entries(r.fields || {})) if (Array.isArray(v)) for (const a of v) if (a && a.id) { const id = 'att' + String(a.id).slice(3); if (!donde.has(id)) donde.set(id, { tabla: tn, campo: k, registro: r.id, fecha: r.createdTime }); }
  }
  F.forEach(f => Object.assign(f, donde.get(f.id) || { tabla: '(no se usa en ningún registro)' }, { tipo: (nom.get(f.id) || {}).tipo, bytes: (nom.get(f.id) || {}).bytes, subido: (nom.get(f.id) || {}).creado }));
  fs.writeFileSync(path.join(dir, '_fallos_archivos.json'), JSON.stringify(F, null, 1));
  const cuenta = {}; F.forEach(f => { const k = `${f.tabla} · ${f.campo || '-'} · ${f.motivo}`; cuenta[k] = (cuenta[k] || 0) + 1; });
  console.log('Archivos que no se han podido bajar:'); Object.entries(cuenta).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v} × ${k}`));
  F.forEach(f => console.log(`  FALLO ${f.id} ${f.tabla} · ${f.campo || '-'} · ${String(f.fecha || f.subido || '').slice(0, 10)} · ${f.tipo || ''} · ${f.bytes || 0} B · ${f.motivo}`));
  resumen.adjuntos = { bajados: n, MB: Math.round(mb), fallos }; console.log('Archivos:', JSON.stringify(resumen.adjuntos));
}
fs.writeFileSync(path.join(OUT, 'RESUMEN.json'), JSON.stringify(resumen, null, 1));
console.log('Copia terminada:', total, 'registros en', Object.keys(resumen.tablas).length, 'tablas');
