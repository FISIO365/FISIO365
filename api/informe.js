export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const TABLE_ID = 'tblwvWQxXNJPdR0Iv';

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors });

  const url = new URL(req.url);
  const pwd = url.searchParams.get('pwd') || '';
  const pacienteId = url.searchParams.get('pacienteId') || '';

  if (pwd.trim() !== (FISIO_PASSWORD || '').trim())
    return new Response(JSON.stringify({ ok: false, error: 'Auth' }), { status: 401, headers: cors });

  // GET - listar informes de un paciente
  if (req.method === 'GET') {
    const filter = pacienteId
      ? `&filterByFormula={fldDR9XqkJ9oA3WK0}="${pacienteId}"`
      : '';
    const fields = [
      'fldDR9XqkJ9oA3WK0', // PacienteId
      'fldqoUgXtf81ROqMy', // PacienteNombre
      'fld3YeK9QbDKjdSAd', // FisioNombre
      'fldHXAL8FC00biu1X', // Fecha
      'fldL5BxsNuITe2He9', // Informe
      'fldy5HGlff56RYrOa',  // Protocolo
    ].map(f => `fields[]=${f}`).join('&');

    const r = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${fields}${filter}&sort[0][field]=fldHXAL8FC00biu1X&sort[0][direction]=desc`,
      { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const data = await r.json();
    const informes = (data.records || []).map(rec => ({
      id: rec.id,
      pacienteId:     rec.fields['fldDR9XqkJ9oA3WK0'] || '',
      pacienteNombre: rec.fields['fldqoUgXtf81ROqMy'] || '',
      fisioNombre:    rec.fields['fld3YeK9QbDKjdSAd'] || '',
      fecha:          rec.fields['fldHXAL8FC00biu1X'] || '',
      informe:        rec.fields['fldL5BxsNuITe2He9'] || '',
      protocolo:      rec.fields['fldy5HGlff56RYrOa'] || '',
    }));
    return new Response(JSON.stringify({ ok: true, informes }), { headers: cors });
  }

  // POST - guardar informe
  if (req.method === 'POST') {
    const body = await req.json();
    const { pacienteId: pid, pacienteNombre, fisioNombre, fecha, informe, protocolo } = body;
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields: {
        fldDR9XqkJ9oA3WK0: pid || '',
        fldqoUgXtf81ROqMy: (pacienteNombre || '').toUpperCase(),
        fld3YeK9QbDKjdSAd: fisioNombre || '',
        fldHXAL8FC00biu1X: fecha || new Date().toLocaleDateString('es-ES'),
        fldL5BxsNuITe2He9: informe || '',
        fldy5HGlff56RYrOa: protocolo || '',
      }}]})
    });
    const data = await r.json();
    if (data.error) return new Response(JSON.stringify({ ok: false, error: data.error.message }), { headers: cors });
    return new Response(JSON.stringify({ ok: true, id: data.records?.[0]?.id }), { headers: cors });
  }

  return new Response(JSON.stringify({ ok: false }), { status: 405, headers: cors });
}
