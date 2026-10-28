// Copia de seguridad de todos los datos de la app (bases de Airtable) en JSON.
// La lanza cada noche GitHub Actions (.github/workflows/backup.yml).
// Uso: AIRTABLE_TOKEN=... node scripts/backup-airtable.mjs <carpeta-salida> [--adjuntos]
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.AIRTABLE_TOKEN;
if (!TOKEN) { console.error('Falta AIRTABLE_TOKEN'); process.exit(1); }
const OUT = process.argv[2] || 'backup';
const ADJ = process.argv.includes('--adjuntos');
const BASES = {
  appsrGnHpFt8sVD5A: 'FISIO365',
  appR5HDJuhjQG504R: 'ESTADISTICAS'
};
// Por si el token no puede leer el esquema: las tablas que usa la app
const TABLAS_APP = 'tbl0OR8AfBuvWyhTo tbl2mLUrnaKCFTs6g tbl2qRD3WsvQVPrwX tbl5ksXlpfsSTZk5i tbl6tWCWWzZfODDns tbl8uv04zFAk5L5bA tblAvnUMOvVo4OBne tblBBSyxl2IZMyU7I tblE7NWfZmxcou5mV tblF4as0orW1b6KIw tblIXYE5ToRNY7MN4 tblIsWo3g6x1QzJyl tblJw7suXLERn8AFQ tblLIcIro0ko9VG6G tblMxPEXHLmnaBnYb tblO5y1Ikg3LIalic tblPXzcT8105MfqvB tblSJPZroRyyWphVp tblTPlcuiSjQngkaD tbla5rZTwMkMpAiaI tblbOukia79RVtTVt tbldBVgClS4HY2mOJ tbldOsLe8iw78Wun7 tblgexkXJ4S36faPa tblgsMcknBLDyfWHu tblkezm4bTQ4jJf1X tbll3K0ar1cZOcVjZ tblmJMoILPnxXzD8w tbloqn3ts872ueJSE tblr27u3cvtzfyqI6 tblrLdMdmTXvM84Kt tbltoikmBZwHYQcpD tblu9YxiktpAh5w87 tblvdXDRDmLrThdWZ tblvgE0a4gsrj4Vhp tblwvWQxXNJPdR0Iv tblxJmnb7LHML2ZZh tblxPpPSvj15NWqNT'.split(' ');

const espera = ms => new Promise(r => setTimeout(r, ms));
async function api(url) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.status === 429 || r.status >= 500) { await espera(1000 * (i + 1)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j.error || j).slice(0, 200)}`);
    await espera(220); // Airtable: máximo 5 peticiones por segundo
    return j;
  }
  throw new Error('Airtable no responde: ' + url);
}
const limpio = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'tabla';

let totalAdj = 0; const MAX_ADJ = 400 * 1024 * 1024;
const resumen = { fecha: new Date().toISOString(), bases: {} };

for (const [baseId, baseNom] of Object.entries(BASES)) {
  const dir = path.join(OUT, baseNom); fs.mkdirSync(dir, { recursive: true });
  let tablas = [];
  try {
    const m = await api(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`);
    tablas = m.tables.map(t => ({ id: t.id, name: t.name }));
    fs.writeFileSync(path.join(dir, '_esquema.json'), JSON.stringify(m, null, 1));
  } catch (e) {
    console.warn(`[${baseNom}] sin acceso al esquema (${e.message}); uso la lista de la app`);
    tablas = baseId === 'appsrGnHpFt8sVD5A' ? TABLAS_APP.map(id => ({ id, name: id })) : [{ id: 'tbloIpGtMu3QVOqoU', name: 'INCOME_MONTH' }];
  }
  resumen.bases[baseNom] = {};
  for (const t of tablas) {
    const recs = []; let off = '';
    try {
      do {
        const j = await api(`https://api.airtable.com/v0/${baseId}/${t.id}?pageSize=100${off ? '&offset=' + off : ''}`);
        recs.push(...(j.records || [])); off = j.offset || '';
      } while (off);
    } catch (e) { console.warn(`[${baseNom}] ${t.name}: ${e.message}`); resumen.bases[baseNom][t.name] = 'ERROR: ' + e.message; continue; }
    fs.writeFileSync(path.join(dir, `${limpio(t.name)}__${t.id}.json`), JSON.stringify(recs));
    resumen.bases[baseNom][t.name] = recs.length;
    console.log(`[${baseNom}] ${t.name}: ${recs.length} registros`);
    if (ADJ) {
      for (const r of recs) for (const [campo, v] of Object.entries(r.fields || {})) {
        if (!Array.isArray(v)) continue;
        for (const a of v) {
          if (!a || typeof a !== 'object' || !a.url || !a.id || totalAdj > MAX_ADJ) continue;
          try {
            const res = await fetch(a.url); if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer()); totalAdj += buf.length;
            const d2 = path.join(dir, '_adjuntos', limpio(t.name), r.id); fs.mkdirSync(d2, { recursive: true });
            fs.writeFileSync(path.join(d2, `${a.id}__${String(a.filename || 'archivo').replace(/[\\/:*?"<>|]/g, '_')}`), buf);
          } catch (e) {}
        }
      }
    }
  }
}
resumen.adjuntosMB = Math.round(totalAdj / 1048576);
fs.writeFileSync(path.join(OUT, 'RESUMEN.json'), JSON.stringify(resumen, null, 1));
console.log('Copia terminada', JSON.stringify(resumen).slice(0, 2000));
