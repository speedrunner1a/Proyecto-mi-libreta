/* sw.js — Service Worker de Mi Libreta
   -----------------------------------------------------------------
   Qué hace:
   1) Permite mostrar notificaciones desde "segundo plano" usando
      Periodic Background Sync (Chrome/Android, incluida la TWA de la
      APK). Esto NO es push real desde un servidor — es el propio
      dispositivo el que despierta al Service Worker cada tanto (el
      intervalo mínimo real ronda ~12h, lo decide el sistema operativo
      según batería/uso, Google no garantiza el intervalo exacto) y
      revisa si hay recordatorios vencidos guardados en IndexedDB/caché.
   2) Cachea el shell de la app para que abra rápido / funcione offline.

   IMPORTANTE — límite real de esto: sin un backend propio (o Firebase
   Cloud Messaging) no existe forma de "empujar" una notificación en el
   momento exacto en que vence un recordatorio si la app está cerrada.
   Lo que sí se puede lograr, y es lo que hace este archivo, es que el
   sistema operativo despierte la app periódicamente (idealmente 1 vez
   por día) y dispare la notificación si corresponde. Para avisos
   puntuales a una hora exacta (ej: "hoy a las 9am"), el mejor recurso
   dentro de una TWA es usar la propia Trigger/Notification API con
   showTrigger, que hoy solo soporta Chrome de escritorio — en Android
   no está disponible. En Android, el chequeo periódico es la opción
   realista sin servidor.
------------------------------------------------------------------- */

const CACHE_NAME = 'mi-libreta-v1';
const APP_SHELL = [
  './',
  './index.html'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Offline-first simple: si hay red, usa red y refresca caché; si no, cae al caché.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

/* ---------- Periodic Background Sync ----------
   El registro (periodicSync.register) se hace desde la app principal
   (ver registrarChequeoPeriodico() en el HTML), no acá. Acá solo se
   reacciona al evento cuando el sistema operativo lo dispara. */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'chequeo-recordatorios') {
    event.waitUntil(revisarRecordatoriosPendientes());
  }
});

// Fallback para navegadores que no soportan Periodic Background Sync
// pero sí Background Sync "a demanda" (se registra al perder conexión
// o al cerrar la app en algunos casos).
self.addEventListener('sync', (event) => {
  if (event.tag === 'chequeo-recordatorios-once') {
    event.waitUntil(revisarRecordatoriosPendientes());
  }
});

async function revisarRecordatoriosPendientes() {
  try {
    const cache = await caches.open('mi-libreta-datos');
    const res = await cache.match('recordatorios');
    if (!res) return;
    const data = await res.json();
    const hoy = new Date().toISOString().slice(0, 10);
    const ultimaNotif = data.ultimaNotificacion || '';
    if (ultimaNotif === hoy) return; // ya se avisó hoy

    const vencidos = (data.recordatorios || []).filter(
      (r) => !r.completado && r.fecha <= hoy
    );

    if (vencidos.length) {
      await self.registration.showNotification('💰 Mi Libreta', {
        body: vencidos.length === 1
          ? `${vencidos[0].titulo}${vencidos[0].monto ? ' — ' + vencidos[0].monto : ''}`
          : `Tenés ${vencidos.length} recordatorios pendientes`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'recordatorios-mi-libreta'
      });
    }

    data.ultimaNotificacion = hoy;
    await cache.put('recordatorios', new Response(JSON.stringify(data)));
  } catch (e) {
    // Fallamos en silencio: esto corre en segundo plano sin UI para avisar.
  }
}

// Permite que la app abra directo desde la notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
