// Adaptador de PGlite (Postgres en memoria) con la misma forma que el de api/_pg.js — solo para pruebas
const { PGlite } = require('@electric-sql/pglite');
module.exports = async function () {
  const pg = new PGlite();
  const ad = { query: (q, p) => pg.query(q, p), tx: fn => pg.transaction(tx => fn({ query: (q, p) => tx.query(q, p) })), pg };
  return ad;
};
