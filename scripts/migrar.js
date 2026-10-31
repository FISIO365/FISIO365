// Copia la base de Airtable de la clínica a Postgres (ver docs/POSTGRES.md). La lógica está en api/_migrar.js.
//
//   AIRTABLE_TOKEN=… DB_URL=postgres://… node scripts/migrar.js            copia todo (se puede repetir: actualiza y borra lo que ya no está)
//   … node scripts/migrar.js --sin-adjuntos                                 sin descargar los archivos (más rápido, para probar)
//   … node scripts/migrar.js --tabla tblTPlcuiSjQngkaD                      solo una tabla
//   … --sin-comprobar                                                       no comprobar que el esquema está al día
const FETCH0 = global.fetch; // el fetch de verdad (api/_pg.js lo cambia si hay DB_URL)
const { migrar } = require('../api/_migrar.js');
if (require.main === module) {
  const arg = process.argv.slice(2), val = k => { const i = arg.indexOf(k); return i >= 0 ? arg[i + 1] : null; };
  if (!process.env.AIRTABLE_TOKEN || !process.env.DB_URL) { console.error('Faltan AIRTABLE_TOKEN y DB_URL'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DB_URL, max: 2, ssl: /localhost|127\.0\.0\.1/.test(process.env.DB_URL) ? false : { rejectUnauthorized: false } });
  migrar({ db: pool, fetch: FETCH0, token: process.env.AIRTABLE_TOKEN, adjuntos: !arg.includes('--sin-adjuntos'), tabla: val('--tabla'), comprobar: !arg.includes('--sin-comprobar'), log: console.log })
    .then(r => { console.log('Hecho.', JSON.stringify(r)); return pool.end(); })
    .catch(e => { console.error('Error:', e.message); process.exit(1); });
}
module.exports = { migrar: o => migrar({ fetch: FETCH0, token: process.env.AIRTABLE_TOKEN, ...o }) };
