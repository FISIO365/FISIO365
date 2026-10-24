/* FISIO365 · Racha (días con ejercicios hechos)
   Uso: FisioRacha.pintar(elemento, ['2026-10-01', ...], { quien: 'paciente' | 'fisio', nombre })
   Lo usan la app del paciente (pestaña Racha) y el panel del fisio (ficha del paciente). */
(function () {
  const css = `
  .rc{font-family:'Poppins',sans-serif;color:#1a1a1a;max-width:460px;margin:0 auto}
  .rc-hero{background:#1a1a1a;color:#f5f2ee;border-radius:26px;padding:22px;position:relative;overflow:hidden;display:flex;align-items:center;gap:16px}
  .rc-hero::after{content:'';position:absolute;right:-50px;top:-50px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(217,119,79,.5),rgba(217,119,79,0) 70%)}
  .rc-llama{width:66px;height:66px;border-radius:20px;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;flex:none;font-size:34px;position:relative;z-index:1}
  .rc-llama.apagada{filter:grayscale(1);opacity:.5}
  .rc-num{font-size:40px;font-weight:800;letter-spacing:-1.5px;line-height:1;position:relative;z-index:1}
  .rc-num small{font-size:15px;font-weight:600;letter-spacing:0;margin-left:6px;color:#d9774f}
  .rc-msg{font-size:13.5px;color:rgba(245,242,238,.7);margin-top:6px;line-height:1.45;position:relative;z-index:1}
  .rc-semana{display:flex;gap:6px;margin-top:14px;position:relative;z-index:1}
  .rc-semana div{flex:1;text-align:center;font-size:10px;font-weight:600;color:rgba(245,242,238,.45)}
  .rc-semana i{display:block;height:6px;border-radius:99px;background:rgba(255,255,255,.12);margin-top:5px}
  .rc-semana .ok i{background:#d9774f}
  .rc-semana .hoy{color:#f5f2ee}
  .rc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}
  .rc-stat{background:#fff;border-radius:20px;padding:14px 10px;text-align:center;box-shadow:0 1px 2px rgba(26,26,26,.04),0 8px 24px rgba(26,26,26,.05)}
  .rc-stat b{display:block;font-size:24px;font-weight:800;letter-spacing:-.6px;line-height:1.1}
  .rc-stat span{font-size:11px;color:#8a857e}
  .rc-cal{background:#fff;border-radius:24px;padding:18px 16px 16px;box-shadow:0 1px 2px rgba(26,26,26,.04),0 8px 24px rgba(26,26,26,.05)}
  .rc-cab{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .rc-cab button{width:36px;height:36px;border-radius:50%;border:none;background:#f5f2ee;font-size:18px;cursor:pointer;color:#1a1a1a}
  .rc-cab button[disabled]{visibility:hidden}
  .rc-nota{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;font-size:13px;color:#8a857e;margin:12px 4px 0}
  .rc-mes{text-align:center}
  .rc-mes b{display:block;font-size:15px}
  .rc-mes span{font-size:11.5px;color:#8a857e}
  .rc-dias,.rc-grid{display:grid;grid-template-columns:repeat(7,1fr);row-gap:6px}
  .rc-dias div{text-align:center;font-size:10.5px;font-weight:600;color:#b9b4ad;margin-bottom:2px}
  .rc-d{position:relative;height:38px;display:flex;align-items:center;justify-content:center}
  .rc-d span{position:relative;z-index:1;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:500;color:#9a958e}
  .rc-d.ok span{background:#c2552e;color:#fff;font-weight:700}
  .rc-d.ok.izq::before,.rc-d.ok.der::after{content:'';position:absolute;top:2px;height:34px;background:#efc7b4;z-index:0}
  .rc-d.ok.izq::before{left:0;right:50%}
  .rc-d.ok.der::after{left:50%;right:0}
  .rc-d.hoy span{box-shadow:inset 0 0 0 2px #1a1a1a;color:#1a1a1a;font-weight:700}
  .rc-d.ok.hoy span{box-shadow:0 0 0 3px #fff,0 0 0 5px #1a1a1a;color:#fff}
  .rc-d.fut span{color:#ddd8d1}
  .rc-ley{display:flex;gap:14px;justify-content:center;font-size:11px;color:#8a857e;margin-top:12px}
  .rc-ley i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#c2552e;margin-right:5px;vertical-align:-1px}
  .rc-ley i.h{background:#fff;box-shadow:inset 0 0 0 2px #1a1a1a}
  `;
  if (!document.getElementById('rc-css')) { const s = document.createElement('style'); s.id = 'rc-css'; s.textContent = css; document.head.appendChild(s); }

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const pad = n => String(n).padStart(2, '0');
  const clave = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sumar = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function pintar(el, fechas, o) {
    o = o || {};
    const tu = o.quien !== 'fisio';
    const hechos = new Set((fechas || []).filter(Boolean).map(f => String(f).slice(0, 10)));
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const kHoy = clave(hoy);

    // Racha actual: cuenta desde hoy, o desde ayer si hoy aún no lo ha hecho
    let inicio = hechos.has(kHoy) ? hoy : sumar(hoy, -1), actual = 0;
    while (hechos.has(clave(sumar(inicio, -actual)))) actual++;
    const pendienteHoy = !hechos.has(kHoy) && actual > 0;

    // Mejor racha
    const orden = [...hechos].sort();
    let mejor = 0, r = 0, prev = null;
    orden.forEach(k => { const d = new Date(k + 'T00:00:00'); r = prev && clave(sumar(prev, 1)) === k ? r + 1 : 1; if (r > mejor) mejor = r; prev = d; });

    // Este mes
    const mesHechos = [...hechos].filter(k => k.startsWith(kHoy.slice(0, 7))).length;

    const n = o.nombre ? String(o.nombre).split(' ')[0] : '';
    let msg;
    if (actual === 0) msg = tu ? 'Hoy es un buen día para empezar. Haz tus ejercicios y enciende la racha.' : 'Ahora mismo no tiene racha activa.';
    else if (pendienteHoy) msg = tu ? 'Haz hoy tus ejercicios para no perderla.' : 'Aún no ha hecho los ejercicios de hoy.';
    else if (actual < 3) msg = tu ? '¡Buen comienzo! Vuelve mañana para seguir sumando.' : 'Ha empezado una racha.';
    else if (actual < 7) msg = tu ? '¡Vas muy bien! La constancia es lo que más ayuda.' : 'Va muy constante.';
    else msg = tu ? '¡Increíble constancia! Así es como se mejora.' : '¡Muy constante! Buen momento para felicitarle.';

    // Últimos 7 días
    const ini = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    let semana = '';
    for (let i = 6; i >= 0; i--) { const d = sumar(hoy, -i); semana += `<div class="${hechos.has(clave(d)) ? 'ok' : ''}${i === 0 ? ' hoy' : ''}">${i === 0 ? 'Hoy' : ini[d.getDay()]}<i></i></div>`; }

    // Mes más antiguo con datos
    let minOff = 0;
    if (orden.length) { const y = +orden[0].slice(0, 4), m = +orden[0].slice(5, 7) - 1; minOff = Math.min(0, (y - hoy.getFullYear()) * 12 + (m - hoy.getMonth())); }
    // En el panel del fisio se puede mirar siempre hasta un año atrás, aunque no haya días marcados
    if (!tu) minOff = Math.min(minOff, -12);
    let off = 0;

    el.innerHTML = `<div class="rc">
      <div class="rc-hero"><div class="rc-llama${actual ? '' : ' apagada'}">🔥</div><div style="flex:1;min-width:0">
        <div class="rc-num">${actual}<small>${actual === 1 ? 'día seguido' : 'días seguidos'}</small></div>
        <div class="rc-msg">${msg}</div>
        <div class="rc-semana">${semana}</div></div></div>
      <div class="rc-stats">
        <div class="rc-stat"><b>${mesHechos}</b><span>este mes</span></div>
        <div class="rc-stat"><b>${hechos.size}</b><span>en total</span></div>
        <div class="rc-stat"><b>${mejor}</b><span>mejor racha</span></div>
      </div>
      <div class="rc-cal"><div class="rc-cab"><button type="button" data-d="-1" aria-label="Mes anterior">‹</button><div class="rc-mes"><b></b><span></span></div><button type="button" data-d="1" aria-label="Mes siguiente">›</button></div>
        <div class="rc-dias"><div>L</div><div>M</div><div>X</div><div>J</div><div>V</div><div>S</div><div>D</div></div>
        <div class="rc-grid"></div>
        <div class="rc-ley"><span><i></i>${tu ? 'Hecho' : 'Ejercicios hechos'}</span><span><i class="h"></i>Hoy</span></div></div>
      ${tu ? '' : `<div class="rc-nota"><span>¿Qué cuenta la racha?</span><button type="button" class="fp-i" data-info="Los días en que el paciente pulsa «He terminado por hoy» en la app.${orden.length ? '' : ' Si sale a 0, puede que no haga los ejercicios, que los haga sin marcarlo o que no use la app.'}" aria-label="Información">i</button></div>`}
    </div>`;

    function mes() {
      const ref = new Date(hoy.getFullYear(), hoy.getMonth() + off, 1);
      const nd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
      const hue = (ref.getDay() + 6) % 7;
      let h = '', cuenta = 0;
      for (let i = 0; i < hue; i++) h += '<div></div>';
      for (let d = 1; d <= nd; d++) {
        const f = new Date(ref.getFullYear(), ref.getMonth(), d), k = clave(f), ok = hechos.has(k);
        if (ok) cuenta++;
        const col = (hue + d - 1) % 7;
        const izq = ok && col > 0 && d > 1 && hechos.has(clave(sumar(f, -1)));
        const der = ok && col < 6 && d < nd && hechos.has(clave(sumar(f, 1)));
        h += `<div class="rc-d${ok ? ' ok' : ''}${izq ? ' izq' : ''}${der ? ' der' : ''}${k === kHoy ? ' hoy' : ''}${k > kHoy ? ' fut' : ''}"><span>${d}</span></div>`;
      }
      el.querySelector('.rc-grid').innerHTML = h;
      el.querySelector('.rc-mes b').textContent = `${MESES[ref.getMonth()]} ${ref.getFullYear()}`;
      el.querySelector('.rc-mes span').textContent = cuenta === 1 ? '1 día hecho' : `${cuenta} días hechos`;
      el.querySelector('[data-d="-1"]').disabled = off <= minOff;
      el.querySelector('[data-d="1"]').disabled = off >= 0;
    }
    el.querySelectorAll('.rc-cab button').forEach(b => b.onclick = () => { off = Math.max(minOff, Math.min(0, off + +b.dataset.d)); mes(); });
    mes();
  }

  window.FisioRacha = { pintar };
})();
