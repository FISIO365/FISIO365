// api/facturas.js — Facturas del paciente desde Holded (solo lectura)
// GET /api/facturas?patientId=rec...            → lista de facturas
// GET /api/facturas?patientId=rec...&id=DOCID   → PDF (base64) de una factura suya
// Necesita la variable de entorno HOLDED_API_KEY (Holded → Configuración → Desarrolladores).
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const HOLDED_KEY = process.env.HOLDED_API_KEY;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PACIENTES = 'tbldBVgClS4HY2mOJ';
const H = 'https://api.holded.com/api/invoicing/v1';

let cacheContactos = null, cacheT = 0;

const holded = async path => {
  const r = await fetch(H + path, { headers: { key: HOLDED_KEY, accept: 'application/json' } });
  if (!r.ok) throw new Error('Holded ' + r.status);
  return r.json();
};
const soloDigitos = t => String(t || '').replace(/\D/g, '').slice(-9);

async function contactos() {
  if (cacheContactos && Date.now() - cacheT < 10 * 60 * 1000) return cacheContactos;
  let todos = [];
  for (let page = 1; page <= 40; page++) {
    const lote = await holded('/contacts?page=' + page);
    if (!Array.isArray(lote) || !lote.length) break;
    todos = todos.concat(lote);
    if (lote.length < 500) break;
  }
  cacheContactos = todos; cacheT = Date.now();
  return todos;
}

// Contactos de Holded que corresponden al paciente (por email o por móvil)
async function contactosDelPaciente(patientId) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES}/${patientId}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) return [];
  const f = (await r.json()).fields || {};
  const email = String(f['EMAIL'] || '').trim().toLowerCase();
  const tel = soloDigitos(f['WHATSAPP']);
  const lista = await contactos();
  return lista.filter(c => {
    const ce = String(c.email || '').trim().toLowerCase();
    if (email && ce && ce === email) return true;
    if (tel && tel.length === 9 && (soloDigitos(c.mobile) === tel || soloDigitos(c.phone) === tel)) return true;
    return false;
  }).map(c => c.id);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { patientId, id } = req.query;
  if (!/^rec[A-Za-z0-9]{14}$/.test(patientId || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
  if (!HOLDED_KEY) return res.status(200).json({ ok: false, sinConfigurar: true, facturas: [] });
  try {
    const ids = await contactosDelPaciente(patientId);
    if (id) {
      if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ ok: false, error: 'Factura no válida' });
      const doc = await holded('/documents/invoice/' + id);
      if (!doc || !ids.includes(doc.contact)) return res.status(403).json({ ok: false, error: 'No autorizado' });
      const pdf = await holded('/documents/invoice/' + id + '/pdf');
      if (!pdf || !pdf.data) return res.status(502).json({ ok: false, error: 'PDF no disponible' });
      return res.status(200).json({ ok: true, nombre: 'Factura_' + String(doc.docNumber || id).replace(/[^\w-]/g, '_') + '.pdf', pdf: pdf.data });
    }
    let facturas = [];
    for (const cid of ids) {
      const docs = await holded('/documents/invoice?contactid=' + encodeURIComponent(cid));
      (Array.isArray(docs) ? docs : []).forEach(d => {
        if (d.draft) return;
        facturas.push({ id: d.id, numero: d.docNumber || '', fecha: d.date || 0, total: Number(d.total || 0), pagada: d.status === 1, concepto: (d.products && d.products[0] && d.products[0].name) || d.desc || '' });
      });
    }
    facturas.sort((a, b) => b.fecha - a.fecha);
    return res.status(200).json({ ok: true, facturas });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'No se han podido cargar las facturas' });
  }
};
