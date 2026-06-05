// ─── SKYWATCH SERVICE WORKER ───────────────────────────────
const CACHE = 'skywatch-v1';
const OVERHEAD_RADIUS_M = 3000; // 3 km = "above you"

// Install & cache the app shell
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['./index.html']))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Serve from cache when offline
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ─── BACKGROUND SYNC / PERIODIC CHECK ─────────────────────
// The app page sends us config via postMessage
let config = { lat: 18.5204, lon: 73.8567, rangeNm: 25, overheadM: 3000 };
let notifiedHexes = {}; // hex -> timestamp, avoid repeat notifications

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CONFIG') {
    config = { ...config, ...e.data.payload };
  }
  if (e.data && e.data.type === 'PLANES') {
    checkOverhead(e.data.planes);
  }
});

function dist(la1, lo1, la2, lo2) {
  const R = 6371000, r2d = d => d * Math.PI / 180;
  const dla = r2d(la2-la1), dlo = r2d(lo2-lo1);
  const a = Math.sin(dla/2)**2 + Math.cos(r2d(la1))*Math.cos(r2d(la2))*Math.sin(dlo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function checkOverhead(planes) {
  const now = Date.now();
  const radius = config.overheadM || 3000;

  planes.forEach(p => {
    if (!p.lat || !p.lon) return;
    const d = dist(config.lat, config.lon, p.lat, p.lon);
    if (d > radius) return;

    const hex = p.hex || p.icao24 || '';
    const lastNotif = notifiedHexes[hex] || 0;
    // Don't re-notify same plane within 5 minutes
    if (now - lastNotif < 5 * 60 * 1000) return;

    notifiedHexes[hex] = now;

    const call = (p.flight || p.hex || 'Unknown').trim();
    const alt = p.alt_baro ?? p.alt_geom;
    const fl = alt ? `FL${Math.round(alt/30.48).toString().padStart(3,'0')}` : '?';
    const spd = p.gs ? `${Math.round(p.gs)} kt` : '?';
    const dm = Math.round(d / 1000 * 10) / 10;

    self.registration.showNotification(`✈ ${call} overhead!`, {
      body: `${fl} · ${spd} · ${dm} km away`,
      icon: './icon.png',
      badge: './badge.png',
      tag: hex,
      renotify: false,
      vibrate: [200, 100, 200],
      data: { hex, call, fl, spd, dm },
      actions: [
        { action: 'track', title: '📡 Track' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    });
  });

  // Clean up old entries
  Object.keys(notifiedHexes).forEach(h => {
    if (now - notifiedHexes[h] > 10 * 60 * 1000) delete notifiedHexes[h];
  });
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(cs => {
      if (cs.length) { cs[0].focus(); cs[0].postMessage({ type: 'SELECT', hex: e.notification.data.hex }); }
      else clients.openWindow('./index.html');
    })
  );
});
