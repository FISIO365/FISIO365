// ── Fórmulas de Airtable (filterByFormula y campos de fórmula) evaluadas en JavaScript ──
// Lo usa api/_pg.js para responder como Airtable cuando los datos están en Postgres.
// parse(texto) → árbol (se guarda en caché); evaluar(árbol, env) → valor.
// env: { campo(nombre) → valor ya convertido al tipo de fórmula, crudo(nombre) → valor guardado, id, creado, modificado }

// ── Tokens ──
function tokens(src) {
  const T = []; let i = 0; const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') { const j = s.indexOf('}', i + 1); if (j < 0) throw new Error('Fórmula: falta }'); T.push({ t: 'campo', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      while (j < s.length && s[j] !== c) { if (s[j] === '\\' && j + 1 < s.length) { const n = s[j + 1]; v += n === 'n' ? '\n' : n === 't' ? '\t' : n; j += 2; } else { v += s[j]; j++; } }
      if (j >= s.length) throw new Error('Fórmula: texto sin cerrar');
      T.push({ t: 'txt', v }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) { const m = s.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i); T.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    const two = s.slice(i, i + 2);
    if (['!=', '<=', '>=', '<>'].includes(two)) { T.push({ t: 'op', v: two === '<>' ? '!=' : two }); i += 2; continue; }
    if ('=<>&+-*/'.includes(c)) { T.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(' || c === ')' || c === ',') { T.push({ t: c }); i++; continue; }
    const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (m) { T.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    throw new Error('Fórmula: carácter inesperado «' + c + '»');
  }
  return T;
}

// ── Árbol (precedencia: comparación < & < + - < * / < unario) ──
function parseTokens(T) {
  let p = 0;
  const ver = () => T[p], toma = () => T[p++];
  const espera = t => { const x = toma(); if (!x || x.t !== t) throw new Error('Fórmula: se esperaba ' + t); return x; };
  function expr() { return cmp(); }
  function cmp() { let a = cat(); while (ver() && ver().t === 'op' && ['=', '!=', '<', '>', '<=', '>='].includes(ver().v)) { const o = toma().v; a = { k: 'bin', o, a, b: cat() }; } return a; }
  function cat() { let a = add(); while (ver() && ver().t === 'op' && ver().v === '&') { toma(); a = { k: 'bin', o: '&', a, b: add() }; } return a; }
  function add() { let a = mul(); while (ver() && ver().t === 'op' && (ver().v === '+' || ver().v === '-')) { const o = toma().v; a = { k: 'bin', o, a, b: mul() }; } return a; }
  function mul() { let a = un(); while (ver() && ver().t === 'op' && (ver().v === '*' || ver().v === '/')) { const o = toma().v; a = { k: 'bin', o, a, b: un() }; } return a; }
  function un() { if (ver() && ver().t === 'op' && (ver().v === '-' || ver().v === '+')) { const o = toma().v; const x = un(); return o === '-' ? { k: 'neg', x } : x; } return prim(); }
  function prim() {
    const x = toma(); if (!x) throw new Error('Fórmula incompleta');
    if (x.t === 'num') return { k: 'lit', v: x.v };
    if (x.t === 'txt') return { k: 'lit', v: x.v };
    if (x.t === 'campo') return { k: 'campo', n: x.v };
    if (x.t === '(') { const e = expr(); espera(')'); return e; }
    if (x.t === 'id') {
      if (ver() && ver().t === '(') {
        toma(); const args = [];
        if (ver() && ver().t !== ')') { args.push(expr()); while (ver() && ver().t === ',') { toma(); args.push(expr()); } }
        espera(')'); return { k: 'fn', f: x.v.toUpperCase(), args };
      }
      if (/^(TRUE|FALSE)$/i.test(x.v)) return { k: 'lit', v: /^TRUE$/i.test(x.v) };
      return { k: 'campo', n: x.v }; // nombre de campo de una palabra, sin llaves
    }
    throw new Error('Fórmula: no se esperaba «' + (x.v || x.t) + '»');
  }
  const r = expr(); if (p < T.length) throw new Error('Fórmula: sobra texto al final');
  return r;
}
const _cache = new Map();
function parse(src) {
  const k = String(src); let a = _cache.get(k);
  if (!a) { a = parseTokens(tokens(k)); if (_cache.size > 5000) _cache.clear(); _cache.set(k, a); }
  return a;
}

// ── Tipos ──
// Fechas: objetos Date (UTC). Con SET_TIMEZONE se envuelven en { __dt: Date, tz } para formatear en esa zona.
const esFecha = v => v instanceof Date || (v && typeof v === 'object' && v.__dt instanceof Date);
const dt = v => v instanceof Date ? v : v && v.__dt;
const vacio = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'number' && isNaN(v));
function texto(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(texto).join(', ');
  if (esFecha(v)) { const d = dt(v); return isNaN(d) ? '' : d.toISOString(); }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  if (typeof v === 'object') return v.filename || v.name || JSON.stringify(v);
  return String(v);
}
function numero(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (esFecha(v)) return dt(v).getTime();
  if (Array.isArray(v)) return v.length === 1 ? numero(v[0]) : NaN;
  const n = Number(String(v).replace(',', '.').trim()); return isNaN(n) ? NaN : n;
}
const verdad = v => { if (Array.isArray(v)) return v.length > 0 && v.some(verdad); if (esFecha(v)) return !isNaN(dt(v)); if (typeof v === 'number') return v !== 0 && !isNaN(v); return !!v; };
// Texto → fecha (ISO, 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm', con formato de DATETIME_PARSE…)
function aFecha(v, fmt) {
  if (v == null || v === '') return null;
  if (esFecha(v)) return dt(v);
  if (typeof v === 'number') return new Date(v);
  if (Array.isArray(v)) return v.length ? aFecha(v[0], fmt) : null;
  let s = String(v).trim();
  if (fmt) { const d = conFormato(s, fmt); if (d) return d; }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(am|pm)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    let h = +m[4]; if (m[8]) { const pm = /pm/i.test(m[8]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], h, +m[5], +(m[6] || 0), +((m[7] || '0') + '00').slice(0, 3));
    if (m[9] && m[9] !== 'Z') { const z = m[9].replace(':', ''), sg = z[0] === '-' ? -1 : 1; t -= sg * (+z.slice(1, 3) * 60 + +z.slice(3, 5)) * 60000; }
    return new Date(t);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // D/M/YYYY (formato europeo)
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(s); return isNaN(d) ? null : d;
}
function conFormato(s, fmt) {
  // Formatos tipo moment: YYYY MM M DD D HH H hh h mm ss A a
  const partes = []; let re = '';
  String(fmt).replace(/(YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|A|a|[^A-Za-z]+|[A-Za-z]+)/g, t => {
    const map = { YYYY: '(\\d{4})', YY: '(\\d{2})', MM: '(\\d{1,2})', M: '(\\d{1,2})', DD: '(\\d{1,2})', D: '(\\d{1,2})', HH: '(\\d{1,2})', H: '(\\d{1,2})', hh: '(\\d{1,2})', h: '(\\d{1,2})', mm: '(\\d{1,2})', m: '(\\d{1,2})', ss: '(\\d{1,2})', s: '(\\d{1,2})', A: '\\s*(am|pm)?', a: '\\s*(am|pm)?' };
    if (map[t]) { partes.push(t); re += map[t]; } else re += t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    return t;
  });
  const m = s.match(new RegExp('^' + re + '$', 'i')); if (!m) return null;
  let Y = 1970, Mo = 1, D = 1, h = 0, mi = 0, se = 0, ap = '';
  partes.forEach((p, i) => { const v = m[i + 1]; if (v == null) return; if (p === 'YYYY') Y = +v; else if (p === 'YY') Y = 2000 + +v; else if (p[0] === 'M') Mo = +v; else if (p[0] === 'D') D = +v; else if (/^[Hh]/.test(p)) h = +v; else if (p[0] === 'm') mi = +v; else if (p[0] === 's') se = +v; else if (/^a$/i.test(p)) ap = v.toLowerCase(); });
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return new Date(Date.UTC(Y, Mo - 1, D, h, mi, se));
}
// Partes de una fecha en una zona horaria (por defecto UTC, como Airtable)
function partes(v, tz) {
  const d = dt(v); tz = tz || (v && v.tz) || 'UTC';
  if (tz === 'UTC' || tz === 'GMT') return { Y: d.getUTCFullYear(), M: d.getUTCMonth() + 1, D: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(d);
  const g = t => (f.find(x => x.type === t) || {}).value;
  return { Y: +g('year'), M: +g('month'), D: +g('day'), h: +g('hour') % 24, m: +g('minute'), s: +g('second'), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')) };
}
const p2 = n => String(n).padStart(2, '0');
function formatea(v, fmt, tz) {
  const d = dt(v); if (!d || isNaN(d)) return '';
  if (!fmt) return d.toISOString();
  const P = partes(v, tz), h12 = P.h % 12 || 12;
  const F = { YYYY: P.Y, YY: p2(P.Y % 100), MM: p2(P.M), M: P.M, DD: p2(P.D), D: P.D, HH: p2(P.h), H: P.h, hh: p2(h12), h: h12, mm: p2(P.m), ss: p2(P.s), A: P.h < 12 ? 'AM' : 'PM', a: P.h < 12 ? 'am' : 'pm', d: P.wd, X: Math.floor(d.getTime() / 1000), x: d.getTime(), l: `${P.M}/${P.D}/${P.Y}`, L: `${p2(P.M)}/${p2(P.D)}/${P.Y}` };
  return String(fmt).replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|ss|A|a|X|x|l|L|d/g, (t, lit) => lit != null ? lit : String(F[t]));
}
const UNID = { milliseconds: 1, ms: 1, seconds: 1e3, s: 1e3, minutes: 6e4, m: 6e4, hours: 36e5, h: 36e5, days: 864e5, d: 864e5, weeks: 6048e5, w: 6048e5 };
function suma(v, n, u) {
  const d = aFecha(v); if (!d) return null; n = numero(n); u = String(u || 'days').toLowerCase().replace(/s?$/, 's');
  if (u === 'months' || u === 'years' || u === 'quarters') { const k = u === 'years' ? 12 * n : u === 'quarters' ? 3 * n : n; const r = new Date(d); r.setUTCMonth(r.getUTCMonth() + k); return r; }
  const ms = UNID[u] || UNID[u.replace(/s$/, '')] || 864e5; return new Date(d.getTime() + n * ms);
}
function diff(a, b, u) {
  const x = aFecha(a), y = aFecha(b); if (!x || !y) return null; u = String(u || 'seconds').toLowerCase().replace(/s?$/, 's');
  if (u === 'months') return (x.getUTCFullYear() - y.getUTCFullYear()) * 12 + x.getUTCMonth() - y.getUTCMonth();
  if (u === 'years') return x.getUTCFullYear() - y.getUTCFullYear();
  const ms = UNID[u] || 1e3; return Math.trunc((x - y) / ms);
}

// ── Comparaciones con el tipado flexible de Airtable ──
function igual(a, b) {
  if (Array.isArray(a)) a = a.length === 1 ? a[0] : texto(a);
  if (Array.isArray(b)) b = b.length === 1 ? b[0] : texto(b);
  if (esFecha(a) || esFecha(b)) { const x = aFecha(a), y = aFecha(b); if (!x || !y) return vacio(a) && vacio(b) || (!x && !y); return x.getTime() === y.getTime(); }
  if (vacio(a) && vacio(b)) return true;
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'boolean' || typeof b === 'boolean') {
    const x = typeof a === 'string' && a.trim() === '' ? 0 : numero(a), y = typeof b === 'string' && b.trim() === '' ? 0 : numero(b);
    if (!isNaN(x) && !isNaN(y)) return x === y;
  }
  return texto(a) === texto(b);
}
function compara(a, b) { // <0, 0, >0
  if (Array.isArray(a)) a = a.length === 1 ? a[0] : texto(a);
  if (Array.isArray(b)) b = b.length === 1 ? b[0] : texto(b);
  if (esFecha(a) || esFecha(b)) { const x = aFecha(a), y = aFecha(b); if (!x || !y) return NaN; return x - y; }
  const x = numero(a), y = numero(b);
  if (!isNaN(x) && !isNaN(y) && (typeof a !== 'string' || a.trim() !== '' || vacio(a)) && (typeof b !== 'string' || b.trim() !== '' || vacio(b))) return x - y;
  const s = texto(a), t = texto(b); return s < t ? -1 : s > t ? 1 : 0;
}

// ── Funciones ──
const F = {
  AND: (...a) => a.length ? a.every(verdad) : true,
  OR: (...a) => a.some(verdad),
  XOR: (...a) => a.filter(verdad).length % 2 === 1,
  NOT: a => !verdad(a),
  TRUE: () => true, FALSE: () => false, BLANK: () => null,
  LOWER: a => texto(a).toLowerCase(), UPPER: a => texto(a).toUpperCase(), TRIM: a => texto(a).trim(),
  LEN: a => texto(a).length,
  LEFT: (a, n) => texto(a).slice(0, n == null ? 1 : numero(n)),
  RIGHT: (a, n) => { const s = texto(a), k = n == null ? 1 : numero(n); return k <= 0 ? '' : s.slice(-k); },
  MID: (a, i, n) => texto(a).substr(numero(i) - 1, numero(n)),
  FIND: (n, h, i) => { const s = texto(h), k = s.indexOf(texto(n), i ? numero(i) - 1 : 0); return k + 1; },
  SEARCH: (n, h, i) => { const s = texto(h).toLowerCase(), k = s.indexOf(texto(n).toLowerCase(), i ? numero(i) - 1 : 0); return k < 0 ? null : k + 1; },
  SUBSTITUTE: (s, a, b, n) => { s = texto(s); a = texto(a); b = texto(b); if (!a) return s; if (n == null) return s.split(a).join(b); let c = 0; return s.replace(new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), m => (++c === numero(n) ? b : m)); },
  REPLACE: (s, i, n, r) => { s = texto(s); i = numero(i) - 1; return s.slice(0, i) + texto(r) + s.slice(i + numero(n)); },
  CONCATENATE: (...a) => a.map(texto).join(''),
  REPT: (s, n) => texto(s).repeat(Math.max(0, numero(n))),
  T: a => typeof a === 'string' ? a : '',
  VALUE: a => { const n = Number(texto(a).replace(/[^0-9.,-]/g, '').replace(',', '.')); return isNaN(n) ? null : n; },
  ENCODE_URL_COMPONENT: a => encodeURIComponent(texto(a)),
  REGEX_MATCH: (s, r) => new RegExp(texto(r)).test(texto(s)),
  REGEX_EXTRACT: (s, r) => { const m = texto(s).match(new RegExp(texto(r))); return m ? m[0] : null; },
  REGEX_REPLACE: (s, r, x) => texto(s).replace(new RegExp(texto(r), 'g'), texto(x)),
  ARRAYJOIN: (a, sep) => (Array.isArray(a) ? a : vacio(a) ? [] : [a]).map(texto).join(sep == null ? ', ' : texto(sep)),
  ARRAYUNIQUE: a => [...new Set(Array.isArray(a) ? a : [a])],
  ARRAYCOMPACT: a => (Array.isArray(a) ? a : [a]).filter(x => !vacio(x)),
  ARRAYFLATTEN: a => (Array.isArray(a) ? a : [a]).flat(Infinity),
  ARRAYSLICE: (a, i, j) => (Array.isArray(a) ? a : [a]).slice(numero(i) - 1, j == null ? undefined : numero(j)),
  COUNTA: (...a) => a.flat().filter(x => !vacio(x)).length,
  COUNT: (...a) => a.flat().filter(x => typeof x === 'number').length,
  COUNTALL: (...a) => a.flat().length,
  SUM: (...a) => a.flat().reduce((s, x) => s + (numero(x) || 0), 0),
  MAX: (...a) => { const L = a.flat().map(numero).filter(x => !isNaN(x)); return L.length ? Math.max(...L) : 0; },
  MIN: (...a) => { const L = a.flat().map(numero).filter(x => !isNaN(x)); return L.length ? Math.min(...L) : 0; },
  AVERAGE: (...a) => { const L = a.flat().map(numero).filter(x => !isNaN(x)); return L.length ? L.reduce((s, x) => s + x, 0) / L.length : 0; },
  ROUND: (n, d) => { const k = Math.pow(10, d == null ? 0 : numero(d)); return Math.round(numero(n) * k) / k; },
  ROUNDUP: (n, d) => { const k = Math.pow(10, d == null ? 0 : numero(d)); return Math.ceil(numero(n) * k) / k; },
  ROUNDDOWN: (n, d) => { const k = Math.pow(10, d == null ? 0 : numero(d)); return Math.floor(numero(n) * k) / k; },
  INT: n => Math.floor(numero(n)), ABS: n => Math.abs(numero(n)), CEILING: n => Math.ceil(numero(n)), FLOOR: n => Math.floor(numero(n)),
  MOD: (a, b) => numero(a) % numero(b), POWER: (a, b) => Math.pow(numero(a), numero(b)), SQRT: a => Math.sqrt(numero(a)),
  EVEN: n => { const x = Math.ceil(Math.abs(numero(n)) / 2) * 2; return numero(n) < 0 ? -x : x; },
  ODD: n => { let x = Math.ceil(Math.abs(numero(n))); if (x % 2 === 0) x++; return numero(n) < 0 ? -x : x; },
  TODAY: () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); },
  NOW: () => new Date(),
  DATETIME_PARSE: (s, f) => aFecha(s, f == null ? null : texto(f)),
  DATETIME_FORMAT: (d, f) => { if (vacio(d)) return null; const x = esFecha(d) ? d : aFecha(d); return x ? formatea(x, f == null ? null : texto(f)) : null; },
  SET_TIMEZONE: (d, tz) => { const x = aFecha(d); return x ? { __dt: x, tz: texto(tz) } : null; },
  SET_LOCALE: d => d,
  DATESTR: d => { const x = aFecha(d); return x ? formatea(x, 'YYYY-MM-DD') : null; },
  TIMESTR: d => { const x = aFecha(d); return x ? formatea(x, 'HH:mm:ss') : null; },
  DATEADD: (d, n, u) => suma(d, n, u),
  DATETIME_DIFF: (a, b, u) => diff(a, b, u),
  IS_BEFORE: (a, b) => { const x = aFecha(a), y = aFecha(b); return !!(x && y && x < y); },
  IS_AFTER: (a, b) => { const x = aFecha(a), y = aFecha(b); return !!(x && y && x > y); },
  IS_SAME: (a, b, u) => {
    const x = aFecha(a), y = aFecha(b); if (!x || !y) return false; u = String(u || 'milliseconds').toLowerCase();
    const k = { year: 'YYYY', years: 'YYYY', month: 'YYYY-MM', months: 'YYYY-MM', day: 'YYYY-MM-DD', days: 'YYYY-MM-DD', hour: 'YYYY-MM-DD HH', hours: 'YYYY-MM-DD HH', minute: 'YYYY-MM-DD HH:mm', minutes: 'YYYY-MM-DD HH:mm' }[u];
    return k ? formatea(x, k) === formatea(y, k) : x.getTime() === y.getTime();
  },
  YEAR: d => { const x = aFecha(d); return x ? partes(esFecha(d) ? d : x).Y : null; },
  MONTH: d => { const x = aFecha(d); return x ? partes(esFecha(d) ? d : x).M : null; },
  DAY: d => { const x = aFecha(d); return x ? partes(esFecha(d) ? d : x).D : null; },
  HOUR: d => { const x = aFecha(d); return x ? partes(esFecha(d) ? d : x).h : null; },
  MINUTE: d => { const x = aFecha(d); return x ? partes(esFecha(d) ? d : x).m : null; },
  WEEKDAY: d => { const x = aFecha(d); return x ? partes(esFecha(d) ? d : x).wd : null; },
  WEEKNUM: d => { const x = aFecha(d); if (!x) return null; const y = Date.UTC(x.getUTCFullYear(), 0, 1); return Math.ceil(((x - y) / 864e5 + new Date(y).getUTCDay() + 1) / 7); },
  ERROR: () => { throw new Error('#ERROR'); },
  ISERROR: () => false
};

// ── Evaluación ──
function evaluar(n, env) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'campo': return env.campo(n.n);
    case 'neg': return -numero(evaluar(n.x, env));
    case 'bin': {
      const a = evaluar(n.a, env), b = evaluar(n.b, env);
      switch (n.o) {
        case '&': return texto(a) + texto(b);
        case '+': if (esFecha(a) && !esFecha(b)) return new Date(dt(a).getTime() + numero(b) * 864e5); return numero(a) + numero(b);
        case '-': if (esFecha(a) && esFecha(b)) return (dt(a) - dt(b)) / 864e5; return numero(a) - numero(b);
        case '*': return numero(a) * numero(b);
        case '/': { const y = numero(b); return y === 0 ? NaN : numero(a) / y; }
        case '=': return igual(a, b);
        case '!=': return !igual(a, b);
        case '<': return compara(a, b) < 0; case '>': return compara(a, b) > 0;
        case '<=': return compara(a, b) <= 0; case '>=': return compara(a, b) >= 0;
      }
      throw new Error('Operador ' + n.o);
    }
    case 'fn': {
      const f = n.f;
      // Las que no evalúan todos los argumentos o necesitan el registro
      if (f === 'IF') { const c = verdad(evaluar(n.args[0], env)); return c ? (n.args[1] ? evaluar(n.args[1], env) : null) : (n.args[2] ? evaluar(n.args[2], env) : null); }
      if (f === 'SWITCH') { const v = evaluar(n.args[0], env); let i = 1; for (; i + 1 < n.args.length; i += 2) if (igual(v, evaluar(n.args[i], env))) return evaluar(n.args[i + 1], env); return i < n.args.length ? evaluar(n.args[i], env) : null; }
      if (f === 'ISERROR' || f === 'IFERROR') { try { const v = evaluar(n.args[0], env); return f === 'ISERROR' ? false : v; } catch (e) { return f === 'ISERROR' ? true : (n.args[1] ? evaluar(n.args[1], env) : null); } }
      if (f === 'RECORD_ID') { if (n.args[0] && n.args[0].k === 'campo') { const v = env.crudo(n.args[0].n); return Array.isArray(v) ? (v[0] || null) : v || null; } return env.id; }
      if (f === 'CREATED_TIME') return env.creado ? new Date(env.creado) : null;
      if (f === 'LAST_MODIFIED_TIME') return env.modificado ? new Date(env.modificado) : null;
      const fn = F[f]; if (!fn) throw new Error('Función no soportada: ' + f);
      return fn(...n.args.map(a => evaluar(a, env)));
    }
  }
  throw new Error('Nodo ' + n.k);
}
// Nombres de campo que usa una fórmula (para cargar solo lo necesario)
function campos(n, out = new Set()) {
  if (!n) return out;
  if (n.k === 'campo') out.add(n.n);
  if (n.a) campos(n.a, out); if (n.b) campos(n.b, out); if (n.x) campos(n.x, out);
  (n.args || []).forEach(a => campos(a, out));
  return out;
}

module.exports = { parse, evaluar, campos, verdad, texto, numero, aFecha, formatea, compara, igual, vacio, FUNCIONES: Object.keys(F).concat(['IF', 'SWITCH', 'ISERROR', 'IFERROR', 'RECORD_ID', 'CREATED_TIME', 'LAST_MODIFIED_TIME']) };
