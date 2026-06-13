export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const TABLE_ID = 'tblwvWQxXNJPdR0Iv';

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const FIELDS = 'fields[]=fldDR9XqkJ9oA3WK0&fields[]=fldqoUgXtf81ROqMy&fields[]=fld3YeK9QbDKjdSAd&fields[]=fldHXAL8FC00biu1X&fields[]=fldL5BxsNuITe2He9&fields[]=fldy5HGlff56RYrOa';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors });

  const url = new URL(req.url);
  const pwd = url.searchParams.get('pwd') || '';
  const pacienteId = url.searchParams.get('pacienteId') || '';

  if (pwd.trim() !== (FISIO_PASSWORD || '').trim())
    return new Response(JSON.stringify({ ok: false, error: 'Auth' }), { status: 401, headers: cors });

  if (req.method === 'GET') {
    // Fetch ALL records then filter in JS — avoids filterByFormula encoding issues
    let allRecords = [];
    let offset = null;
    do {
      const offsetParam = offset ? `&offset=${offset}` : '';
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${FIELDS}&pageSize=100${offsetParam}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || null;
    } while (offset);

    let informes = allRecords.map(rec => ({
      id: rec.id,
      pacienteId:     rec.fields['fldDR9XqkJ9oA3WK0'] || '',
      pacienteNombre: rec.fields['fldqoUgXtf81ROqMy'] || '',
      fisioNombre:    rec.fields['fld3YeK9QbDKjdSAd'] || '',
      fecha:          rec.fields['fldHXAL8FC00biu1X'] || '',
      informe:        rec.fields['fldL5BxsNuITe2He9'] || '',
      protocolo:      rec.fields['fldy5HGlff56RYrOa'] || '',
    }));

    // Filter by pacienteId if provided
    if (pacienteId) {
      informes = informes.filter(i => i.pacienteId === pacienteId);
    }

    return new Response(JSON.stringify({ ok: true, informes }), { headers: cors });
  }

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
