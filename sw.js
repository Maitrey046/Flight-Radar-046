// ─── SKYWATCH SERVICE WORKER v4 ─────────────────────────────
// Persisted watch config so alerts can continue even after the tab closes.
const CACHE = 'skywatch-v4';
const STATE_REQ = new Request('./__skywatch_state__.json');

let config = {
  lat: 18.5204,
  lon: 73.8567,
  rangeNm: 25,
  radiusM: 5000,
  maxAltFt: 15000,
  watching: false
};
let notifiedHexes = {};
let fetchTimer = null;
let activeFetch = false;

async function loadState() {
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(STATE_REQ);
    if (!res) return;
    const data = await res.json();
    if (data && data.config) config = { ...config, ...data.config };
    if (data && data.notifiedHexes) notifiedHexes = data.notifiedHexes;
  } catch (e) {
    console.warn('[SW] loadState failed', e);
  }
}

async function saveState() {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(
      STATE_REQ,
      new Response(JSON.stringify({ config, notifiedHexes }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
  } catch (e) {
    console.warn('[SW] saveState failed', e);
  }
}

async function clearState() {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(
      STATE_REQ,
      new Response(JSON.stringify({ config: null, notifiedHexes: {} }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
  } catch (e) {
    console.warn('[SW] clearState failed', e);
  }
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(['./index.html', './manifest.json', './icon.png', './badge.png'])
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await loadState();
    if (config.watching) startFetchLoop();
    await clients.claim();
  })());
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
      config.lat      = msg.lat      ?? config.lat;
      config.lon      = msg.lon      ?? config.lon;
      config.rangeNm  = msg.rangeNm   ?? config.rangeNm;
      config.radiusM  = (msg.radiusKm ?? 5) * 1000;
      config.maxAltFt = msg.maxAltFt  ?? 15000;
      config.watching = true;
      saveState();
      startFetchLoop();
      break;

    case 'STOP_WATCH':
      config.watching = false;
      stopFetchLoop();
      clearState();
      break;

    case 'RANGE_CHANGE':
      config.rangeNm = msg.rangeNm ?? config.rangeNm;
      saveState();
      break;

    case 'RADIUS_CHANGE':
      config.radiusM = (msg.radiusKm ?? 5) * 1000;
      saveState();
      break;

    case 'LOCATION_CHANGE':
      config.lat = msg.lat ?? config.lat;
      config.lon = msg.lon ?? config.lon;
      saveState();
      break;

    case 'CONFIG':
      if (msg.payload) {
        config.lat      = msg.payload.lat      ?? config.lat;
        config.lon      = msg.payload.lon      ?? config.lon;
        config.rangeNm  = msg.payload.rangeNm  ?? config.rangeNm;
        config.radiusM  = msg.payload.overheadM ?? config.radiusM;
        config.maxAltFt = msg.payload.maxAltFt  ?? config.maxAltFt;
        saveState();
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
  if (fetchTimer) return;
  console.log('[SW] Starting background fetch loop');
  const tick = async () => {
    if (!config.watching) {
      fetchTimer = null;
      return;
    }
    await doFetch();
    fetchTimer = setTimeout(tick, 20000);
  };
  tick();
}

function stopFetchLoop() {
  if (fetchTimer) {
    clearTimeout(fetchTimer);
    fetchTimer = null;
  }
  activeFetch = false;
  console.log('[SW] Stopped background fetch loop');
}

async function doFetch() {
  if (!config.watching || activeFetch) return;
  activeFetch = true;

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
      activeFetch = false;
      return;
    } catch (err) {
      console.warn('[SW] API', idx, 'failed:', err.message);
    }
  }

  activeFetch = false;
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

    const alt = p.alt_baro ?? p.alt_geom;
    if (alt != null && alt > maxAltFt) return;

    const hex = p.hex || p.icao24 || '';
    const lastNotif = notifiedHexes[hex] || 0;
    if (now - lastNotif < 5 * 60 * 1000) return;

    notifiedHexes[hex] = now;
    saveState();

    const call = (p.flight || p.hex || 'Unknown').trim();
    const fl   = alt ? `FL${Math.round(alt / 30.48).toString().padStart(3, '0')}` : '?';
    const spd  = p.gs ? `${Math.round(p.gs)} kt` : '?';
    const dm   = (d / 1000).toFixed(1);

    self.registration.showNotification(`✈ New plane entered range`, {
      body: `${call} · ${fl} · ${spd} · ${dm} km away`,
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
    e.waitUntil((async () => {
      await loadState();
      if (config.watching) await doFetch();
    })());
  }
});
