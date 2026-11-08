// Sustituto de @resvg/resvg-js (módulo nativo de Node) para Cloudflare: la misma clase Resvg, en WebAssembly.
// entry.js llama a iniciarResvg() antes de atender cada petición; después new Resvg(svg, opts).render().asPng() funciona igual.
import { Resvg as R, initWasm } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
let listo = null;
export function iniciarResvg() { if (!listo) listo = initWasm(wasm).catch(e => { if (!/already/i.test(String(e))) { listo = null; throw e; } }); return listo; }
export class Resvg extends R {
  constructor(svg, opts) {
    const o = Object.assign({}, opts || {});
    if (o.font) { const f = Object.assign({}, o.font); delete f.fontFiles; delete f.loadSystemFonts; o.font = f; }
    super(svg, o);
  }
}
export default { Resvg };
