// ── Marca de la clínica ──
// Todo lo que es «de FISIO365» (nombre, razón social, dirección, teléfono, reseñas…) sale de aquí.
// Los textos del código siguen escritos con los datos de FISIO365; si una clínica tiene otros datos
// en Administración › Ajustes › Datos de la clínica, se cambian al salir (páginas, emails, IA, previews).
// Para FISIO365 no cambia nada: si los datos son los de siempre, el texto sale tal cual.

const DEF = {
  marca: 'FISIO365',
  razon: 'Fourth Dynamic, S.L.',
  nif: 'B56503592',
  direccion: 'C/ Gran de Sant Andreu, 163 · 08030 Barcelona',
  dirCorta: 'Gran de Sant Andreu, 163 · Barcelona',
  zona: 'Sant Andreu',
  ciudad: 'Barcelona',
  tel: '672 89 39 49',
  wa: '34672893949',
  email: 'info@fisioterapia365.com',
  web: 'fisioterapia365.com',
  googlePlace: 'ChIJCadKnf2G6AIRcmUzdzMr4nk',
  iban: 'ES14 0182 2392 8002 0302 2638',
  color: '#c2552e'
};
const OPC_DEF = { sorteo: true, bomba: true };

// Limpia un valor para poder meterlo en HTML, JS y JSON sin romper nada
const limpio = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/["'`\\<>$]/g, '').trim().slice(0, n || 160);

// Junta lo guardado con lo de siempre (lo vacío vuelve al valor de FISIO365)
function datos(guardado) {
  const g = guardado || {}, o = {};
  Object.keys(DEF).forEach(k => { const v = limpio(g[k], 200); o[k] = v || DEF[k]; });
  // Compatibilidad con los nombres antiguos de «Datos de la clínica»
  if (g.tel && !g.wa) { const d = String(g.tel).replace(/\D/g, ''); if (d.length === 9) o.wa = '34' + d; }
  const calle = s => String(s || '').split(/·|,(?=\s*\d{5})/)[0].trim();
  o.calle = calle(o.dirCorta) || calle(o.direccion);
  o.color = /^#[0-9a-f]{6}$/i.test(String(g.color || '')) ? String(g.color).toLowerCase() : DEF.color;
  o.logoV = Number(g.logoV) || 0; // versión del logo subido (0 = el de FISIO365)
  o.opciones = Object.assign({}, OPC_DEF, (g.opciones && typeof g.opciones === 'object') ? g.opciones : {});
  return o;
}


// ── Colores: el coral de FISIO365 y sus tonos se cambian por el color de la clínica ──
const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const aHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mezcla = (c, d, t) => c.map((v, i) => v + (d[i] - v) * t);
// Tonos del coral que usa la app: [color de FISIO365, cómo se saca del color de la clínica]
const BASE = hx('#c2552e'), W = [255, 255, 255], K = [0, 0, 0];
const TONOS = ['#a3441f', '#fdf6ef', '#ab4a27', '#9a3f1f', '#d9774f', '#de8257', '#e0a487', '#e2b7a6', '#e3b9a6', '#e6c9bb', '#e8b597', '#e9cdbd', '#ecd2c4', '#efc7b4', '#f1d9cc', '#f3c9b2', '#f3c9b5', '#f3c9bb', '#f3d9c9', '#f3dccd', '#f3e3da', '#f6d2b8', '#f6dfd2', '#f7e6dd', '#fbe3d7', '#fbeae2', '#fbeee7', '#fbf3ee', '#fdebe1', '#fdeee4', '#fdf0e7', '#fdf0ea', '#fdf1ea', '#fdf1e8', '#fdf3ec', '#fdf6f1', '#fdf6f2', '#fff1ea', '#fff8f4', '#fbe9df', '#f6d5c5', '#e9a98f'];
function tonoDe(orig, P) { // ¿cuánto blanco/negro tiene este tono respecto al coral? Se aplica lo mismo al color nuevo
  const o = hx(orig), luzO = o.reduce((a, b) => a + b, 0), luzB = BASE.reduce((a, b) => a + b, 0);
  if (luzO >= luzB) { const t = (luzO - luzB) / (765 - luzB); return aHex(mezcla(P, W, t)); }
  const t = (luzB - luzO) / luzB; return aHex(mezcla(P, K, t));
}
function paresColor(color) {
  if (!color || color === DEF.color) return [];
  const P = hx(color), L = [[DEF.color, color]];
  TONOS.forEach(t => L.push([t, tonoDe(t, P)]));
  const out = [];
  L.forEach(([a, b]) => { out.push([a, b]); out.push([a.toUpperCase(), b]); });
  out.push(['194,85,46', P.join(',')], ['194, 85, 46', P.join(', ')]);
  return out;
}

// Pares «texto de FISIO365 → texto de la clínica», de más largo a más corto. Solo los que cambian.
function pares(C) {
  const D = datos(null), mayus = s => String(s).toUpperCase();
  // [texto de FISIO365, dato de la clínica del que depende, por qué se cambia]. Solo si ese dato es distinto del de FISIO365.
  const L = [
    ['Carrer Gran de Sant Andreu, 163<br>Sant Andreu – 08030 Barcelona', 'direccion'],
    ['Carrer Gran de Sant Andreu, 163 · Sant Andreu – 08030 Barcelona', 'direccion'],
    [D.direccion, 'direccion'],
    ['C/ Gran de Sant Andreu 163, 08030 Barcelona', 'direccion'],
    ['C/ Gran de Sant Andreu, 163 · Barcelona', 'dirCorta'],
    [D.dirCorta, 'dirCorta'],
    ['Gran de Sant Andreu 163, Barcelona', 'dirCorta'],
    ['Carrer Gran de Sant Andreu, 163', 'calle'],
    ['Gran de Sant Andreu 163', 'calle'],
    ['Gran de Sant Andreu', 'zona'],
    [mayus(D.razon), 'razon', mayus],
    [D.razon, 'razon'],
    [D.nif, 'nif'],
    [D.iban, 'iban'],
    [D.email, 'email'],
    [D.tel, 'tel'],
    ['672 893 949', 'tel'],
    [D.wa, 'wa'],
    [D.googlePlace, 'googlePlace'],
    [D.zona, 'zona'],
    ['(Barcelona)', 'ciudad', v => '(' + v + ')'],
    [D.marca, 'marca']
  ];
  const P = L.filter(([, k]) => C[k] && C[k] !== D[k]).map(([a, k, f]) => [a, f ? f(C[k]) : C[k]]).filter(([a, b]) => a !== b);
  if (C.logoV) P.unshift(['/informe/logo.png', '/api/schedule?action=clinica-logo&v=' + C.logoV]);
  // Otra clínica en su propio despliegue: los enlaces apuntan a su app (APP_URL), no a la de FISIO365
  const app = String(process.env.APP_URL || '').replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9.-]+$/i.test(app) && app !== 'https://app.fisioterapia365.com') P.unshift(['https://app.fisioterapia365.com', app]);
  return P.concat(paresColor(C.color));
}

// Cambia los textos de FISIO365 por los de la clínica. json=true: el texto va dentro de un JSON (emails, IA)
function marcar(txt, C, json) {
  if (typeof txt !== 'string' || !C) return txt;
  const P = C._pares || (C._pares = pares(C));
  if (!P.length) return txt;
  let s = txt;
  P.forEach(([a, b]) => { if (s.includes(a)) s = s.split(a).join(json ? JSON.stringify(b).slice(1, -1) : b); });
  return s;
}

module.exports = { DEF, OPC_DEF, datos, pares, paresColor, marcar, limpio };
