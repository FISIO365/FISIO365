// Devuelve las respuestas del formulario de Tally «Descúbrete · ¿Te suena?»
// Necesita en Vercel: TALLY_API_KEY y RESP_PASS
const FORM = 'KpVlEX';

function flatten(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(', ');
  if (typeof value === 'object') return Object.values(value).map(flatten).filter(Boolean).join(', ');
  return String(value);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  if (!process.env.RESP_PASS || body.pass !== process.env.RESP_PASS) return res.status(401).json({ error: 'pass' });
  if (!process.env.TALLY_API_KEY) return res.status(500).json({ error: 'nokey' });
  const out = [];
  let page = 1;
  try {
    for (let guard = 0; guard < 20; guard++) {
      const r = await fetch('https://api.tally.so/forms/' + FORM + '/submissions?limit=100&page=' + page, {
        headers: { Authorization: 'Bearer ' + process.env.TALLY_API_KEY }
      });
      if (!r.ok) return res.status(502).json({ error: 'tally', status: r.status });
      const data = await r.json();
      const qs = {};
      (data.questions || []).forEach((q) => {
        qs[q.id] = q;
        (q.fields || []).forEach((f) => { qs[f.uuid || f.id] = Object.assign({ parentType: q.type }, f); });
      });
      (data.submissions || []).forEach((s) => {
        const row = { fecha: s.submittedAt || s.createdAt, situaciones: '', tema: '', pagina: '', otra: '' };
        (s.responses || []).forEach((r2) => {
          const q = qs[r2.questionId] || {};
          const title = String(q.title || q.label || '').toLowerCase();
          const v = r2.answer !== undefined ? r2.answer : r2.value;
          if (v && typeof v === 'object' && !Array.isArray(v) && (q.type === 'HIDDEN_FIELDS' || 'situaciones' in v || 'tema' in v)) {
            ['situaciones', 'tema', 'pagina'].forEach((k) => { if (v[k]) row[k] = flatten(v[k]); });
          } else if (/situaciones/.test(title)) row.situaciones = flatten(v);
          else if (/^tema/.test(title)) row.tema = flatten(v);
          else if (/pagina|página/.test(title)) row.pagina = flatten(v);
          else if (/algo más|algo mas/.test(title)) row.otra = flatten(v);
        });
        out.push(row);
      });
      if (!data.hasMore) break;
      page++;
    }
  } catch (e) {
    return res.status(502).json({ error: 'fetch' });
  }
  return res.status(200).json({ rows: out });
};
