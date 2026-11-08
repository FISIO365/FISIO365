// Monta FISIO365 para Cloudflare Pages en ../build-cf (no toca nada de lo que usa Vercel).
//   node cloudflare/build.mjs <proyecto>     → build-cf/ listo para «wrangler pages deploy»
// - dist/: solo los archivos que Vercel sirve (builds @vercel/static de vercel.json)
// - functions/[[path]].js: entry.js, que atiende api/ y las rutas de vercel.json con el mismo req/res de Vercel
// - api/: copia de api/ con web-push y @resvg/resvg-js cambiados por sus versiones para Cloudflare
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const AQUI = path.dirname(url.fileURLToPath(import.meta.url)), RAIZ = path.resolve(AQUI, '..'), OUT = path.join(RAIZ, 'build-cf');
const proyecto = process.argv[2] || 'fisio365-prueba';
const V = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));
fs.rmSync(OUT, { recursive: true, force: true });
const cp = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };

// 1) Archivos estáticos: lo mismo que Vercel publica, en la raíz (public/x → /x)
const globARegex = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*') + '$');
const pats = V.builds.filter(b => b.use === '@vercel/static').map(b => globARegex(b.src));
const todos = []; (function rec(d) { for (const f of fs.readdirSync(path.join(RAIZ, d), { withFileTypes: true })) { const r = path.posix.join(d, f.name); if (f.isDirectory()) { if (!['node_modules', '.git', 'build-cf', 'cloudflare'].includes(f.name)) rec(r); } else todos.push(r); } })('.');
let n = 0;
for (const f of todos.map(x => x.replace(/^\.\//, ''))) if (pats.some(re => re.test(f))) { cp(path.join(RAIZ, f), path.join(OUT, 'dist', f.replace(/^public\//, ''))); n++; }
if (fs.existsSync(path.join(RAIZ, 'public/icons/favicon.ico'))) cp(path.join(RAIZ, 'public/icons/favicon.ico'), path.join(OUT, 'dist/favicon.ico'));
fs.writeFileSync(path.join(OUT, 'dist/404.html'), '<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:sans-serif;padding:40px">Página no encontrada</p>');
// Cabeceras que Vercel ponía en algunas rutas
const cab = []; V.routes.filter(r => r.headers && /^\/public\//.test(r.dest || '')).forEach(r => {
  const ruta = r.src.replace(/\\\./g, '.').replace(/\(\.\*\)$/, '*');
  cab.push(ruta, ...Object.entries(r.headers).map(([k, v]) => `  ${k}: ${v}`), '');
});
fs.writeFileSync(path.join(OUT, 'dist/_headers'), cab.join('\n'));

// 2) Rutas que van a funciones (las demás son archivos)
const RUTAS = V.routes.filter(r => r.dest && /^\/api\//.test(r.dest) && r.src !== '/api/(.*)').map(r => ({ src: r.src, dest: r.dest }));
fs.mkdirSync(path.join(OUT, 'cf'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'cf/rutas.json'), JSON.stringify(RUTAS));
const incl = new Set(['/api/*']);
for (const r of RUTAS) {
  const lit = r.src.replace(/\\\./g, '\u0001').split(/[([?*+\\]/)[0].replace(/\u0001/g, '.');
  const resto = r.src.slice(r.src.replace(/\\\./g, '__').split(/[([?*+\\]/)[0].length);
  if (!resto) incl.add(lit); else if (resto === '?' && lit.endsWith('/')) { incl.add(lit.slice(0, -1)); incl.add(lit); } else incl.add(lit.replace(/\/?$/, '/') + '*');
}
fs.writeFileSync(path.join(OUT, 'dist/_routes.json'), JSON.stringify({ version: 1, include: [...incl], exclude: [] }, null, 1));

// 3) Código: api/ (con los dos módulos de Node cambiados), entry y función comodín
for (const f of fs.readdirSync(path.join(RAIZ, 'api'))) {
  const a = path.join(RAIZ, 'api', f), b = path.join(OUT, 'api', f);
  if (!f.endsWith('.js')) { cp(a, b); continue; }
  let s = fs.readFileSync(a, 'utf8');
  s = s.replace(/require\(['"]web-push['"]\)/g, "require('../cf/webpush.js')").replace(/require\(['"]@resvg\/resvg-js['"]\)/g, "require('../cf/resvg.js')");
  fs.mkdirSync(path.dirname(b), { recursive: true }); fs.writeFileSync(b, s);
}
for (const f of ['entry.js', 'resvg.js', 'webpush.js', 'package.json']) cp(path.join(AQUI, f), path.join(OUT, f === 'package.json' ? f : 'cf/' + f));
fs.mkdirSync(path.join(OUT, 'functions'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'functions/[[path]].js'), "export { onRequest } from '../cf/entry.js';\n");
fs.writeFileSync(path.join(OUT, 'wrangler.toml'), `name = "${proyecto}"\npages_build_output_dir = "dist"\ncompatibility_date = "2025-09-01"\ncompatibility_flags = ["nodejs_compat"]\n`);
console.log(`build-cf listo para ${proyecto}: ${n} archivos estáticos, ${RUTAS.length} rutas, _routes con ${incl.size} reglas`);
