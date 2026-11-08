// FISIO365 en Cloudflare Pages: una sola función que atiende todo lo que en Vercel eran las funciones de api/
// y las rutas de vercel.json. Los archivos de public/ los sirve Cloudflare directamente (ver _routes.json).
// Las funciones de api/ NO se tocan: aquí se les da el mismo req/res que tenían en Vercel.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import { iniciarResvg } from './resvg.js';
import RUTAS from './rutas.json';

// Una conexión a la base de datos por petición (Cloudflare no deja reutilizarlas entre peticiones): ver db() en api/_pg.js
globalThis.__PG_ALS__ = new AsyncLocalStorage();
import '../api/_pg.js';

import cron from '../api/cron.js';
import dolor from '../api/dolor.js';
import ejercicios from '../api/ejercicios.js';
import login from '../api/login.js';
import notificar from '../api/notificar.js';
import programa from '../api/programa.js';
import schedule from '../api/schedule.js';
import sendemail from '../api/sendemail.js';
import subscribe from '../api/subscribe.js';
import informe from '../api/informe.js';
import tareas from '../api/tareas.js';
import chat from '../api/chat.js';
import citas from '../api/citas.js';
import diario from '../api/diario.js';
import fisios from '../api/fisios.js';
import pacientes from '../api/pacientes.js';
import progreso from '../api/progreso.js';
import recordatorios from '../api/recordatorios.js';
import reservar from '../api/reservar.js';

// estilo Node (req, res) o estilo «edge» (Request → Response), como en Vercel
const NODE = { cron, dolor, ejercicios, login, notificar, programa, schedule, sendemail, subscribe, informe, tareas };
const EDGE = { chat, citas, diario, fisios, pacientes, progreso, recordatorios, reservar };
const fn = m => (m && m.default) || m;

function aQuery(sp) {
  const q = {};
  for (const [k, v] of sp) { if (k in q) q[k] = [].concat(q[k], v); else q[k] = v; }
  return q;
}

async function leerCuerpo(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const buf = Buffer.from(await request.arrayBuffer());
  if (!buf.length) return null;
  const ct = String(request.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) { try { return JSON.parse(buf.toString('utf8')); } catch (e) { const er = new Error('JSON'); er.malJson = true; throw er; } }
  if (ct.includes('application/x-www-form-urlencoded')) return aQuery(new URLSearchParams(buf.toString('utf8')));
  if (ct.startsWith('text/')) return buf.toString('utf8');
  return buf;
}

async function llamarNode(handler, request, url, ctx) {
  let body;
  try { body = await leerCuerpo(request); } catch (e) { return new Response('Invalid JSON', { status: 400 }); }
  const headers = {}; request.headers.forEach((v, k) => { headers[k] = v; });
  const req = { method: request.method, url: url.pathname + url.search, headers, query: aQuery(url.searchParams), body, cookies: {} };
  return new Promise(resolve => {
    const H = new Map(); const fin = []; let hecho = false;
    const res = {
      statusCode: 200,
      setHeader(k, v) { H.set(String(k).toLowerCase(), [String(k), v]); return res; },
      getHeader(k) { const x = H.get(String(k).toLowerCase()); return x && x[1]; },
      removeHeader(k) { H.delete(String(k).toLowerCase()); return res; },
      status(c) { res.statusCode = c; return res; },
      on(ev, f) { if (ev === 'finish' || ev === 'close') fin.push(f); return res; },
      json(o) { if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end(JSON.stringify(o)); },
      send(b) {
        if (b !== null && typeof b === 'object' && !(b instanceof Uint8Array) && !(b instanceof ArrayBuffer)) return res.json(b);
        if (typeof b === 'string' && !res.getHeader('content-type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (b instanceof Uint8Array && !res.getHeader('content-type')) res.setHeader('Content-Type', 'application/octet-stream');
        return res.end(b);
      },
      redirect(a, b) { const [c, u] = typeof a === 'number' ? [a, b] : [307, a]; res.statusCode = c; res.setHeader('Location', u); return res.end(); },
      end(b) {
        if (hecho) return res; hecho = true;
        const h = new Headers();
        for (const [, [k, v]] of H) { if (Array.isArray(v)) v.forEach(x => h.append(k, String(x))); else if (v != null) h.set(k, String(v)); }
        const sinCuerpo = request.method === 'HEAD' || [204, 304].includes(res.statusCode);
        resolve(new Response(sinCuerpo || b == null ? null : b, { status: res.statusCode, headers: h }));
        fin.forEach(f => { try { f(); } catch (e) {} });
        return res;
      },
    };
    const p = (async () => { await handler(req, res); })().then(
      () => { if (!hecho) res.end(); },
      e => { console.error('ERROR', url.pathname, e && (e.stack || e.message)); if (!hecho) { res.statusCode = 500; H.clear(); res.setHeader('Content-Type', 'text/plain'); res.end('A server error has occurred'); } }
    );
    const st = globalThis.__PG_ALS__.getStore(); if (st) st.p = p;
    ctx.waitUntil(p);
  });
}

async function llamarEdge(handler, request, url) {
  const init = { method: request.method, headers: request.headers };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  try { return await handler(new Request(url.toString(), init)); }
  catch (e) { console.error('ERROR', url.pathname, e && (e.stack || e.message)); return new Response('A server error has occurred', { status: 500 }); }
}

// Rutas de vercel.json: devuelve la URL interna (/api/x?…) o null
function enrutar(url) {
  const p = url.pathname;
  for (const r of RUTAS) {
    const m = new RegExp('^' + r.src + '$').exec(p);
    if (!m) continue;
    const dest = r.dest.replace(/\$(\d+)/g, (_, i) => m[+i] || '');
    const d = new URL(dest, url.origin);
    for (const [k, v] of url.searchParams) if (!d.searchParams.has(k)) d.searchParams.append(k, v);
    return d;
  }
  if (p.startsWith('/api/')) return new URL(url.pathname + url.search, url.origin);
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const d = enrutar(url);
  if (!d) return env.ASSETS.fetch(request);
  const nombre = d.pathname.replace(/^\/api\//, '').replace(/\.js$/, '').replace(/\/$/, '');
  const N = NODE[nombre], E = EDGE[nombre];
  if (!N && !E) return new Response('Not found', { status: 404 });
  const est = {};
  return globalThis.__PG_ALS__.run(est, async () => {
    try {
      await iniciarResvg();
      return N ? await llamarNode(fn(N), request, d, context) : await llamarEdge(fn(E), request, d);
    } finally {
      context.waitUntil((async () => { try { await est.p; } catch (e) {} try { if (est.db && est.db.cerrar) await est.db.cerrar(); } catch (e) {} })());
    }
  });
}
