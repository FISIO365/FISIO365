// Rumbo: sin caché propia, siempre lo último (sirve para poder instalarla en el móvil) y para los avisos de las tareas
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(_){d={body:e.data&&e.data.text()};}
 e.waitUntil(self.registration.showNotification(d.title||'Rumbo',{body:d.body||'',tag:d.tag||'rumbo',icon:'/icono-192.png',badge:'/icono-192.png',data:{url:d.url||'/'},requireInteraction:true,vibrate:[200,100,200]}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/';
 e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(L=>{for(const c of L){if('focus' in c)return c.focus();}return clients.openWindow(u);}));});
