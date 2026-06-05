// ─── SKYWATCH SERVICE WORKER v3 ─────────────────────────────
// Fixed: proper null checks, START_WATCH guaranteed delivery
const CACHE = 'skywatch-v3';

let config = {
  lat: 18.5204,
  lon: 73.8567,
  rangeNm: 25,
  radiusM: 5000,
  maxAltFt: 15000,   // NEW: max altitude filter
  watching: false
};
let notifiedHexes = {};
let fetchInterval = null;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(['./index.html', './manifest.json', './icon.png', './badge.png'])
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (new URL(e.request.url).origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});

self.addEventListener('message', e => {
  const msg = e.data;
  if (!msg) return;

  switch (msg.type) {
    case 'START_WATCH':
      config.lat       = msg.lat      ?? config.lat;
      config.lon       = msg.lon      ?? config.lon;
      config.rangeNm   = msg.rangeNm  ?? config.rangeNm;
      config.radiusM   = (msg.radiusKm ?? 5) * 1000;
      config.maxAltFt  = msg.maxAltFt ?? 15000;
      config.watching  = true;
      startFetchLoop();
      break;

    case 'STOP_WATCH':
      config.watching = false;
      stopFetchLoop();
      break;

    case 'RANGE_CHANGE':
      config.rangeNm = msg.rangeNm ?? config.rangeNm;
      break;

    case 'RADIUS_CHANGE':
      config.radiusM = (msg.radiusKm ?? 5) * 1000;
      break;

    case 'LOCATION_CHANGE':
      config.lat = msg.lat;
      config.lon = msg.lon;
      break;

    case 'CONFIG':
      if (msg.payload) {
        config.lat      = msg.payload.lat      ?? config.lat;
        config.lon      = msg.payload.lon      ?? config.lon;
        config.rangeNm  = msg.payload.rangeNm  ?? config.rangeNm;
        config.radiusM  = msg.payload.overheadM ?? config.radiusM;
        config.maxAltFt = msg.payload.maxAltFt  ?? config.maxAltFt;
      }
      break;

    case 'PLANES':
      if (msg.planes) checkOverhead(msg.planes);
      break;
  }
});

const APIS = [
  (lat, lon, nm) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
  (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`,
  (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
];
let apiIdx = 0;

function startFetchLoop() {
  if (fetchInterval) return;
  console.log('[SW] Starting background fetch loop');
  doFetch();
  fetchInterval = setInterval(doFetch, 20000);
}

function stopFetchLoop() {
  if (fetchInterval) { clearInterval(fetchInterval); fetchInterval = null; }
  console.log('[SW] Stopped background fetch loop');
}

async function doFetch() {
  if (!config.watching) return;
  const { lat, lon, rangeNm } = config;

  for (let i = 0; i < APIS.length; i++) {
    const idx = (apiIdx + i) % APIS.length;
    try {
      const res = await fetch(APIS[idx](lat, lon, rangeNm), {
        signal: AbortSignal.timeout(9000)
      });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      const planes = (data.ac || []).filter(p => p.lat != null && p.lon != null);
      apiIdx = idx;
      checkOverhead(planes);
      broadcastToClients({ type: 'PLANES_UPDATE', planes });
      return;
    } catch (err) {
      console.warn('[SW] API', idx, 'failed:', err.message);
    }
  }
}

function distM(la1, lo1, la2, lo2) {
  const R = 6371000, d2r = d => d * Math.PI / 180;
  const dla = d2r(la2 - la1), dlo = d2r(lo2 - lo1);
  const a = Math.sin(dla / 2) ** 2 +
            Math.cos(d2r(la1)) * Math.cos(d2r(la2)) * Math.sin(dlo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkOverhead(planes) {
  const now = Date.now();
  const { lat, lon, radiusM, maxAltFt } = config;

  planes.forEach(p => {
    if (!p.lat || !p.lon) return;
    const d = distM(lat, lon, p.lat, p.lon);
    if (d > radiusM) return;

    // Altitude filter — skip planes above maxAltFt
    const alt = p.alt_baro ?? p.alt_geom;
    if (alt != null && alt > maxAltFt) return;

    const hex = p.hex || p.icao24 || '';
    const lastNotif = notifiedHexes[hex] || 0;
    if (now - lastNotif < 5 * 60 * 1000) return;

    notifiedHexes[hex] = now;

    const call = (p.flight || p.hex || 'Unknown').trim();
    const fl   = alt ? `FL${Math.round(alt / 30.48).toString().padStart(3, '0')}` : '?';
    const spd  = p.gs ? `${Math.round(p.gs)} kt` : '?';
    const dm   = (d / 1000).toFixed(1);

    self.registration.showNotification(`✈ ${call} overhead!`, {
      body: `${fl} · ${spd} · ${dm} km away`,
      icon: './icon.png',
      badge: './badge.png',
      tag: hex,
      renotify: false,
      vibrate: [200, 100, 200],
      silent: false,
      data: { hex, call, fl, spd, dm },
      actions: [
        { action: 'track',   title: '📡 Track' },
        { action: 'dismiss', title: 'Dismiss'  }
      ]
    });
  });

  Object.keys(notifiedHexes).forEach(h => {
    if (now - notifiedHexes[h] > 15 * 60 * 1000) delete notifiedHexes[h];
  });
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (cs.length) {
        cs[0].focus();
        cs[0].postMessage({ type: 'SELECT', hex: e.notification.data.hex });
      } else {
        clients.openWindow('./index.html');
      }
    })
  );
});

async function broadcastToClients(msg) {
  const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  cs.forEach(c => c.postMessage(msg));
}

self.addEventListener('periodicsync', e => {
  if (e.tag === 'skywatch-check') {
    e.waitUntil(doFetch());
  }
});
