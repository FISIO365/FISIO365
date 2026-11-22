// FISIO365 · Ajustes de avisos (app del paciente y panel del fisio)
// F365Avisos.pintar(el, { clave, datos: () => ({patientId} | {fisioId, pwd}), lista: [..], onInstalar, onCambio })
window.F365Avisos = (function () {
  const VAPID = 'BI32ty3ZY7XihYoArCZXx9JsHvx55YRlRpi0-OWxCfkjDmE1FMcprKMq3bodpzXFeo2puW4XYeXF6c9AMX5wln8';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const instalada = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const posible = () => ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
  const apagados = clave => ls.get(clave + '_off') === '1';
  function u8(b) { const p = '='.repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); }
  async function suscripcion(crear) {
    const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    if (!s && crear) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(VAPID) });
    return s;
  }
  async function estado(clave) {
    if (ios && !instalada()) return 'instalar';
    if (!posible()) return 'no';
    if (Notification.permission === 'denied') return 'bloqueado';
    if (apagados(clave) || Notification.permission !== 'granted') return 'off';
    try { return (await suscripcion(false)) ? 'on' : 'off'; } catch (e) { return 'off'; }
  }
  async function activar(clave, datos) {
    ls.set(clave + '_off', null);
    if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') return estado(clave);
    const s = await suscripcion(true);
    const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...datos, subscription: s }) });
    if (!r.ok) throw new Error('No se ha podido guardar');
    return 'on';
  }
  async function desactivar(clave, datos) {
    // No se borra la suscripción del navegador (la comparten las dos apps en el mismo móvil): solo se quita de Airtable
    ls.set(clave + '_off', '1');
    await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...datos, borrar: true }) });
    return 'off';
  }
  function comoDesbloquear() {
    if (ios) return 'Abre <b>Ajustes</b> del iPhone › <b>Notificaciones</b> › <b>FISIO365</b> y activa <b>Permitir notificaciones</b>.';
    if (android) return 'Mantén pulsado el icono de la app › <b>Información de la aplicación</b> › <b>Notificaciones</b> y actívalas.';
    return 'Pulsa el candado que hay junto a la dirección web › <b>Notificaciones</b> › <b>Permitir</b>, y recarga la página.';
  }

  let css = false;
  function estilos() {
    if (css) return; css = true;
    const st = document.createElement('style');
    st.textContent = `
.f365av{background:#fff;border-radius:22px;padding:18px;box-shadow:0 2px 14px rgba(26,26,26,.06);font-family:inherit;color:#1a1a1a;margin-bottom:18px}
.f365av-top{display:flex;align-items:center;gap:13px}
.f365av-ic{width:46px;height:46px;border-radius:14px;background:#fbeee7;display:flex;align-items:center;justify-content:center;flex:none}
.f365av-ic svg{width:23px;height:23px;fill:none;stroke:#c2552e;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.f365av-tx{flex:1;min-width:0}.f365av-tx b{display:block;font-size:15.5px;font-weight:700}.f365av-tx span{display:block;font-size:13px;color:#7d6a60;margin-top:2px}
.f365av-sw{position:relative;width:52px;height:31px;border-radius:99px;border:none;background:#d9d3cc;cursor:pointer;flex:none;transition:background .2s;padding:0}
.f365av-sw::after{content:'';position:absolute;top:3px;left:3px;width:25px;height:25px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.2);transition:transform .2s}
.f365av-sw.on{background:#c2552e}.f365av-sw.on::after{transform:translateX(21px)}
.f365av-sw[disabled]{opacity:.5;cursor:default}
.f365av-li{margin:14px 0 0;padding:14px 0 0;border-top:1px solid #f0ebe6;list-style:none;display:flex;flex-direction:column;gap:7px}
.f365av-li li{font-size:13.5px;color:#4a423c;padding-left:16px;position:relative;line-height:1.4}
.f365av-li li::before{content:'';position:absolute;left:3px;top:7px;width:6px;height:6px;border-radius:50%;background:#d9774f}
.f365av-nota{margin-top:14px;background:#fbeee7;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.5;color:#5b4a40}
.f365av-nota b{color:#1a1a1a}
.f365av-bt{margin-top:10px;border:none;border-radius:99px;background:#c2552e;color:#fff;font-family:inherit;font-size:13.5px;font-weight:700;padding:10px 16px;cursor:pointer}`;
    document.head.appendChild(st);
  }

  async function pintar(el, o) {
    if (!el) return; estilos();
    const est = await estado(o.clave);
    const sub = { on: 'Activados en este móvil', off: 'Desactivados', bloqueado: 'Bloqueados en el móvil', instalar: 'Instala la app para recibirlos', no: 'Este navegador no los permite' }[est];
    let nota = '';
    if (est === 'bloqueado') nota = `<div class="f365av-nota">Al preguntarte el móvil se pulsó <b>No permitir</b>, y por seguridad el móvil ya no deja que la app lo vuelva a preguntar. Solo se puede cambiar desde el propio móvil: ${comoDesbloquear()}<br>Después vuelve aquí y ya podrás activarlos y desactivarlos con el interruptor.</div>`;
    if (est === 'instalar') nota = `<div class="f365av-nota">En iPhone los avisos solo llegan con la app instalada en la pantalla de inicio. Instálala y vuelve aquí para activarlos.${o.onInstalar ? '<br><button type="button" class="f365av-bt" data-inst>Cómo instalarla</button>' : ''}</div>`;
    if (est === 'off' && 'Notification' in window && Notification.permission === 'default') nota = `<div class="f365av-nota">Al activarlos, el móvil te preguntará si quieres recibir notificaciones: pulsa <b>Permitir</b>.</div>`;
    if (est === 'no') nota = `<div class="f365av-nota">Prueba desde el móvil con la app instalada.</div>`;
    const sw = (est === 'on' || est === 'off') ? `<button type="button" class="f365av-sw${est === 'on' ? ' on' : ''}" role="switch" aria-checked="${est === 'on'}" aria-label="Avisos"></button>` : '';
    el.innerHTML = `<div class="f365av"><div class="f365av-top"><div class="f365av-ic"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div><div class="f365av-tx"><b>Avisos</b><span>${sub}</span></div>${sw}</div>${(o.lista || []).length ? '<ul class="f365av-li">' + o.lista.map(t => '<li>' + t + '</li>').join('') + '</ul>' : ''}${nota}</div>`;
    const b = el.querySelector('.f365av-sw');
    if (b) b.onclick = async () => {
      b.disabled = true; const encender = !b.classList.contains('on');
      b.classList.toggle('on', encender);
      let r;
      try { r = encender ? await activar(o.clave, o.datos()) : await desactivar(o.clave, o.datos()); }
      catch (e) { r = 'error'; }
      if (o.onCambio) o.onCambio(r);
      pintar(el, o);
    };
    const i = el.querySelector('[data-inst]'); if (i) i.onclick = o.onInstalar;
  }
  return { pintar, estado, apagados, activar, desactivar };
})();
