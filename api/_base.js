// ── Base de datos de la clínica ──
// FISIO365 usa su base de Airtable de siempre. Otra clínica (otro despliegue) pone su base en AIRTABLE_BASE_ID
// (una copia de la de FISIO365): como al copiar una base cambian los ids de tablas y campos, aquí se traducen solos,
// buscando cada tabla y campo por su nombre. También se puede dar la traducción hecha en AIRTABLE_ID_MAP (JSON).
// Para FISIO365 no hace nada.
const DEF_BASE = 'appsrGnHpFt8sVD5A';
const BASE_ID = process.env.AIRTABLE_BASE_ID || DEF_BASE;
const OTRA = BASE_ID !== DEF_BASE;
let trad = null, cargando = null;
const cambia = (s, L) => { if (typeof s !== 'string') return s; for (const [a, b] of L) if (s.includes(a)) s = s.split(a).join(b); return s; };
async function cargar(f) {
  if (trad) return trad; if (cargando) return cargando;
  cargando = (async () => {
    let m = null; try { m = JSON.parse(process.env.AIRTABLE_ID_MAP || 'null'); } catch (e) {}
    if (!m) {
      const MAP = require('./_ids.json');
      const r = await f(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
      const d = await r.json(), porNombre = {};
      (d.tables || []).forEach(t => { porNombre[t.name] = { id: t.id, f: {} }; (t.fields || []).forEach(x => { porNombre[t.name].f[x.name] = x.id; }); });
      m = {};
      Object.entries(MAP.t).forEach(([id, n]) => { if (porNombre[n]) m[id] = porNombre[n].id; });
      Object.entries(MAP.f).forEach(([id, [tn, fn]]) => { if (porNombre[tn] && porNombre[tn].f[fn]) m[id] = porNombre[tn].f[fn]; });
    }
    const fwd = Object.entries(m).filter(([a, b]) => a && b && a !== b);
    trad = { fwd: [[DEF_BASE, BASE_ID], ...fwd], back: fwd.map(([a, b]) => [b, a]) };
    return trad;
  })();
  try { return await cargando; } finally { cargando = null; }
}
if (OTRA && global.fetch && !global.fetch._base) {
  const _f = global.fetch;
  const nf = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    if (!/^https:\/\/api\.airtable\.com\/v0\/(?!meta\/)/.test(url)) return _f(u, o);
    const t = await cargar(_f);
    const o2 = o && typeof o.body === 'string' ? Object.assign({}, o, { body: cambia(o.body, t.fwd) }) : o;
    const r = await _f(cambia(url, t.fwd), o2);
    const txt = await r.text();
    return new Response(cambia(txt, t.back), { status: r.status, statusText: r.statusText, headers: r.headers });
  };
  nf._base = 1; nf._marca = _f._marca; global.fetch = nf;
}
module.exports = { BASE_ID, DEF_BASE, OTRA };
