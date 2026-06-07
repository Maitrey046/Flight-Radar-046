


// ═══════════════════════════════════════════════════════
// CONSTANTS & STATE
// ═══════════════════════════════════════════════════════
const SITE_URL = 'https://maitrey046.github.io/Flight-Radar-046/';
const MAX_ALT_FT = 15000;

let LAT = 18.5204, LON = 73.8567, LOC_NAME = 'Pune, India';
let RANGE_NM = 25;
let notifRadius = 5; // km
let planes = [], selHex = null, panelOpen = true, sweepAng = 0;
let swReg = null, sw = null;
let alertsActive = false;
let demoMode = false;
let lastFetch = 0;
let weatherData = null;
let aodMode = false;
let wakeLock = null;
let burnInTimer = null;
let aodClockTimer = null;

const SETTINGS_KEY = 'skywatch_settings_v2';
const AOD_KEY = 'skywatch_aod_v1';

function loadAppSettings() {
  let raw = '';
  try {
    raw = localStorage.getItem(SETTINGS_KEY) || '';
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.lat === 'number') LAT = s.lat;
      if (typeof s.lon === 'number') LON = s.lon;
      if (typeof s.locName === 'string') LOC_NAME = s.locName;
      if (Number.isFinite(s.rangeNm)) RANGE_NM = parseInt(s.rangeNm, 10);
      if (Number.isFinite(s.notifRadius)) notifRadius = parseInt(s.notifRadius, 10);
      if (typeof s.alertsActive === 'boolean') alertsActive = s.alertsActive;
      if (typeof s.aodMode === 'boolean') aodMode = s.aodMode;
    }
  } catch(e) {}
  try {
    const savedLoc = localStorage.getItem('skywatch_loc');
    if (savedLoc && !raw) {
      const d = JSON.parse(savedLoc);
      LAT = d.lat ?? LAT;
      LON = d.lon ?? LON;
      LOC_NAME = d.name ?? LOC_NAME;
    }
  } catch(e) {}
  try {
    const savedRadius = localStorage.getItem('skywatch_radius');
    if (savedRadius && !raw) notifRadius = parseInt(savedRadius, 10);
  } catch(e) {}
  try {
    const savedAlerts = localStorage.getItem('skywatch_alerts');
    if (savedAlerts === 'on') alertsActive = true;
  } catch(e) {}
  try {
    const savedAod = localStorage.getItem(AOD_KEY);
    if (savedAod != null) aodMode = savedAod === 'on';
  } catch(e) {}
}

function saveAppSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      lat: LAT,
      lon: LON,
      locName: LOC_NAME,
      rangeNm: RANGE_NM,
      notifRadius,
      alertsActive,
      aodMode
    }));
    localStorage.setItem('skywatch_loc', JSON.stringify({ lat: LAT, lon: LON, name: LOC_NAME }));
    localStorage.setItem('skywatch_radius', String(notifRadius));
    localStorage.setItem('skywatch_alerts', alertsActive ? 'on' : 'off');
    localStorage.setItem(AOD_KEY, aodMode ? 'on' : 'off');
  } catch(e) {}
}


const WEATHER_CODES = {
  0: { label: 'Clear sky', icon: '☀' },
  1: { label: 'Mainly clear', icon: '🌤' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁' },
  45: { label: 'Fog', icon: '🌫' },
  48: { label: 'Rime fog', icon: '🌫' },
  51: { label: 'Light drizzle', icon: '🌦' },
  53: { label: 'Drizzle', icon: '🌦' },
  55: { label: 'Heavy drizzle', icon: '🌧' },
  61: { label: 'Light rain', icon: '🌧' },
  63: { label: 'Rain', icon: '🌧' },
  65: { label: 'Heavy rain', icon: '🌧' },
  71: { label: 'Light snow', icon: '🌨' },
  73: { label: 'Snow', icon: '🌨' },
  75: { label: 'Heavy snow', icon: '🌨' },
  80: { label: 'Rain showers', icon: '🌦' },
  81: { label: 'Rain showers', icon: '🌦' },
  82: { label: 'Violent showers', icon: '⛈' },
  95: { label: 'Thunderstorm', icon: '⛈' },
  96: { label: 'Thunderstorm + hail', icon: '⛈' },
  99: { label: 'Thunderstorm + hail', icon: '⛈' },
};

function setConnectionStatus(isConnected) {
  const dot = document.getElementById('liveDot');
  const label = document.getElementById('liveLabel');
  if (!dot || !label) return;
  if (isConnected) {
    dot.className = 'live-dot';
    label.textContent = 'LIVE';
  } else {
    dot.className = 'live-dot demo';
    label.textContent = 'DISCONNECTED';
  }
}

function weatherFromCode(code) {
  return WEATHER_CODES[code] || { label: 'Unknown conditions', icon: '☁' };
}

async function fetchWeather() {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    weatherData = d.current || null;
    renderWeather();
  } catch (e) {
    weatherData = null;
    renderWeather(true);
  }
}

function renderWeather(isError = false) {
  const place = document.getElementById('weatherPlace');
  const temp = document.getElementById('weatherTemp');
  const meta = document.getElementById('weatherMeta');
  const status = document.getElementById('weatherStatus');
  if (!place || !temp || !meta || !status) return;

  place.textContent = LOC_NAME;
  if (!weatherData) {
    temp.textContent = '—';
    meta.textContent = isError ? 'Weather unavailable right now.' : 'Fetching weather…';
    status.textContent = 'Selected watch point weather';
    return;
  }

  const c = weatherFromCode(weatherData.weather_code);
  temp.textContent = `${Math.round(weatherData.temperature_2m)}°`;
  meta.innerHTML = `${c.icon} <strong>${c.label}</strong> · Wind ${Math.round(weatherData.wind_speed_10m ?? 0)} km/h`;
  status.textContent = `Updated ${new Date(weatherData.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      if (aodMode) setTimeout(requestWakeLock, 1200);
    });
  } catch (e) {}
}

async function releaseWakeLock() {
  try {
    if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {}
}

async function enterFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch (e) {}
}

async function exitFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (e) {}
}

function updateAODClock() {
  const el = document.getElementById('aodClock');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
}

function applyBurnInOffset() {
  const wrap = document.getElementById('radarWrap');
  const overlay = document.getElementById('aodOverlay');
  if (!wrap || !overlay) return;
  const t = Date.now() / 60000;
  const x = Math.round(Math.sin(t * 1.3) * 2);
  const y = Math.round(Math.cos(t * 1.1) * 2);
  wrap.style.transform = `translate(${x}px, ${y}px)`;
  overlay.style.transform = `translate(${Math.round(-x/2)}px, ${Math.round(-y/2)}px)`;
}

function startBurnInProtection() {
  clearInterval(burnInTimer);
  applyBurnInOffset();
  burnInTimer = setInterval(applyBurnInOffset, 45000);
  clearInterval(aodClockTimer);
  updateAODClock();
  aodClockTimer = setInterval(updateAODClock, 1000);
}

function stopBurnInProtection() {
  clearInterval(burnInTimer);
  clearInterval(aodClockTimer);
  burnInTimer = null;
  aodClockTimer = null;
  const wrap = document.getElementById('radarWrap');
  const overlay = document.getElementById('aodOverlay');
  if (wrap) wrap.style.transform = '';
  if (overlay) overlay.style.transform = '';
}

async function setAODMode(on) {
  aodMode = !!on;
  document.body.classList.toggle('aod-mode', aodMode);
  const btn = document.getElementById('aodBtn');
  if (btn) {
    btn.textContent = aodMode ? 'ON' : 'OFF';
    btn.classList.toggle('on', aodMode);
  }
  const mini = document.getElementById('aodMini');
  if (mini) mini.textContent = aodMode ? 'AMOLED AOD • KEEP AWAKE' : 'AMOLED AOD';
  saveAppSettings();

  if (aodMode) {
    await requestWakeLock();
    await enterFullscreen();
    startBurnInProtection();
    showToast('AOD mode enabled');
  } else {
    await releaseWakeLock();
    await exitFullscreen();
    stopBurnInProtection();
    showToast('AOD mode disabled');
  }
}

// ── TODAY'S STATS (localStorage) ──
const TODAY_KEY = 'skywatch_stats_' + new Date().toDateString();
let todayStats = loadTodayStats();

function loadTodayStats() {
  try {
    const raw = localStorage.getItem(TODAY_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { seenHexes: {}, highestAlt: null, highAltFlight: null, closest: null, closestFlight: null, airlines: {} };
}

function saveTodayStats() {
  try { localStorage.setItem(TODAY_KEY, JSON.stringify(todayStats)); } catch(e) {}
}

function recordPlanes(arr) {
  arr.forEach(p => {
    const hex = p.hex || p.icao24 || '';
    if (!hex) return;

    // Count unique aircraft
    if (!todayStats.seenHexes[hex]) todayStats.seenHexes[hex] = true;

    // Highest altitude
    const alt = p.alt_baro ?? p.alt_geom;
    if (alt != null && (todayStats.highestAlt === null || alt > todayStats.highestAlt)) {
      todayStats.highestAlt = alt;
      todayStats.highAltFlight = (p.flight || p.hex || '?').trim();
    }

    // Closest aircraft (need distance)
    if (p._distKm != null) {
      if (todayStats.closest === null || p._distKm < todayStats.closest) {
        todayStats.closest = p._distKm;
        todayStats.closestFlight = (p.flight || p.hex || '?').trim();
      }
    }

    // Airline tally (use first 3 chars of callsign = ICAO airline code)
    const call = (p.flight || '').trim();
    if (call.length >= 3 && /^[A-Z]{2,3}/.test(call)) {
      const code = call.match(/^[A-Z]+/)[0].substring(0, 3);
      todayStats.airlines[code] = (todayStats.airlines[code] || 0) + 1;
    }
  });
  saveTodayStats();
}

// ═══════════════════════════════════════════════════════
// CANVAS / RADAR
// ═══════════════════════════════════════════════════════
const rc = document.getElementById('radarCanvas');
const sc = document.getElementById('sweepCanvas');
const rctx = rc.getContext('2d');
const sctx = sc.getContext('2d');
let W = 0, H = 0, R = 0;

function resizeCanvases() {
  const wrap = document.getElementById('radarWrap');
  const dpr  = window.devicePixelRatio || 1;
  // clientHeight can be 0 on first paint on mobile — fall back to vw-based estimate
  const cssW = wrap.clientWidth  || window.innerWidth;
  const cssH = wrap.clientHeight || Math.round(window.innerHeight * 0.55);
  const cssSize = Math.max(100, Math.min(cssW, cssH) - 4);
  W = H = Math.round(cssSize * dpr);   // physical pixels
  R = W / 2;
  rc.width  = sc.width  = W;
  rc.height = sc.height = H;
  // CSS size stays at cssSize so layout is correct
  const s = `width:${cssSize}px;height:${cssSize}px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)`;
  rc.style.cssText = sc.style.cssText = s;
  // Scale context so 1 unit = 1 CSS pixel on all screens
  rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // R in CSS pixels for all coordinate math
  R = cssSize / 2;
  W = H = cssSize;
}

function drawRadar() {
  rctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;

  // Background glow
  const bg = rctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, 'rgba(0,40,20,.6)');
  bg.addColorStop(1, 'rgba(3,12,5,0)');
  rctx.fillStyle = bg;
  rctx.beginPath(); rctx.arc(cx, cy, R, 0, Math.PI * 2); rctx.fill();

  // Rings
  [.25, .5, .75, 1].forEach(f => {
    rctx.beginPath();
    rctx.arc(cx, cy, R * f, 0, Math.PI * 2);
    rctx.strokeStyle = f === 1 ? 'rgba(0,255,136,.3)' : 'rgba(0,255,136,.1)';
    rctx.lineWidth = f === 1 ? 1.5 : .8;
    rctx.stroke();
    if (f < 1) {
      const nm = Math.round(RANGE_NM * f);
      rctx.fillStyle = 'rgba(0,255,136,.4)';
      rctx.font = `${Math.max(9, R * 0.045)}px 'Share Tech Mono'`;
      rctx.fillText(`${nm}nm`, cx + R * f + 3, cy - 3);
    }
  });

  // Cross hairs
  rctx.strokeStyle = 'rgba(0,255,136,.15)';
  rctx.lineWidth = .7;
  rctx.setLineDash([4, 4]);
  rctx.beginPath(); rctx.moveTo(cx, cy - R); rctx.lineTo(cx, cy + R); rctx.stroke();
  rctx.beginPath(); rctx.moveTo(cx - R, cy); rctx.lineTo(cx + R, cy); rctx.stroke();
  rctx.setLineDash([]);

  // Center dot
  rctx.beginPath(); rctx.arc(cx, cy, 4, 0, Math.PI * 2);
  rctx.fillStyle = 'var(--g)'; rctx.fill();

  // Planes
  // RANGE_NM covers the full radius. 1 nm = 1/60 degree lat.
  // pixels per nm = R / RANGE_NM
  const pxPerNm = R / RANGE_NM;
  planes.forEach(p => {
    if (!p.lat || !p.lon) return;
    // Convert lat/lon delta to nautical miles, then to pixels
    const dLat = p.lat - LAT;
    const dLon = p.lon - LON;
    const dLatNm = dLat * 60;                                          // 1 deg lat = 60 nm
    const dLonNm = dLon * 60 * Math.cos(LAT * Math.PI / 180);         // correct for longitude
    const dx = dLonNm * pxPerNm;
    const dy = -dLatNm * pxPerNm;                                      // canvas y is inverted
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > R) return;
    const px = cx + dx, py = cy + dy;

    const alt    = p.alt_baro ?? p.alt_geom;
    const isOver = p._distKm != null && p._distKm * 1000 < notifRadius * 1000;
    const isSel  = p.hex === selHex;
    const col    = isOver ? '#ffb300' : isSel ? '#00ff88' : '#00cc66';
    const belowMax = alt == null || alt <= MAX_ALT_FT;
    const planeCol = belowMax ? col : 'rgba(255,100,68,.8)';

    // Heading: use track if available, else 0 (north up)
    const hdgRad = ((p.track ?? 0) - 90) * Math.PI / 180; // canvas 0=east so offset -90
    const sz = isSel ? 9 : 7;

    // Draw a more realistic top-down airplane silhouette
    rctx.save();
    rctx.translate(px, py);
    rctx.rotate(hdgRad);

    rctx.fillStyle = planeCol;
    rctx.shadowColor = planeCol;
    rctx.shadowBlur = isSel ? 10 : 5;

    // Main fuselage
    rctx.beginPath();
    rctx.moveTo(sz * 1.75, 0);
    rctx.quadraticCurveTo(sz * 1.35, -sz * 0.16, sz * 0.95, -sz * 0.16);
    rctx.lineTo(-sz * 0.6, -sz * 0.1);
    rctx.quadraticCurveTo(-sz * 1.05, 0, -sz * 0.6, sz * 0.1);
    rctx.lineTo(sz * 0.95, sz * 0.16);
    rctx.quadraticCurveTo(sz * 1.35, sz * 0.16, sz * 1.75, 0);
    rctx.closePath();
    rctx.fill();

    // Nose / cockpit
    rctx.beginPath();
    rctx.moveTo(sz * 1.95, 0);
    rctx.lineTo(sz * 1.45, -sz * 0.18);
    rctx.lineTo(sz * 1.45, sz * 0.18);
    rctx.closePath();
    rctx.fill();

    // Main wings
    rctx.beginPath();
    rctx.moveTo(sz * 0.2, 0);
    rctx.lineTo(-sz * 0.25, -sz * 1.0);
    rctx.lineTo(-sz * 0.85, -sz * 1.0);
    rctx.lineTo(-sz * 0.3, -sz * 0.05);
    rctx.lineTo(-sz * 0.3, sz * 0.05);
    rctx.lineTo(-sz * 0.85, sz * 1.0);
    rctx.lineTo(-sz * 0.25, sz * 1.0);
    rctx.closePath();
    rctx.fill();

    // Tail plane
    rctx.beginPath();
    rctx.moveTo(-sz * 0.55, 0);
    rctx.lineTo(-sz * 1.0, -sz * 0.45);
    rctx.lineTo(-sz * 1.1, -sz * 0.22);
    rctx.lineTo(-sz * 0.82, 0);
    rctx.lineTo(-sz * 1.1, sz * 0.22);
    rctx.lineTo(-sz * 1.0, sz * 0.45);
    rctx.closePath();
    rctx.fill();

    // Vertical stabilizer
    rctx.beginPath();
    rctx.moveTo(-sz * 0.72, 0);
    rctx.lineTo(-sz * 1.05, -sz * 0.62);
    rctx.lineTo(-sz * 0.78, -sz * 0.62);
    rctx.lineTo(-sz * 0.6, -sz * 0.05);
    rctx.lineTo(-sz * 0.6, sz * 0.05);
    rctx.lineTo(-sz * 0.78, sz * 0.62);
    rctx.lineTo(-sz * 1.05, sz * 0.62);
    rctx.closePath();
    rctx.fill();

    // Engine pods for a jet-like look
    rctx.beginPath();
    rctx.ellipse(sz * 0.15, -sz * 0.58, sz * 0.16, sz * 0.08, 0, 0, Math.PI * 2);
    rctx.ellipse(sz * 0.15, sz * 0.58, sz * 0.16, sz * 0.08, 0, 0, Math.PI * 2);
    rctx.fill();

    rctx.shadowBlur = 0;
    rctx.restore();

    // Selection ring
    if (isSel || isOver) {
      rctx.strokeStyle = col;
      rctx.lineWidth = 1.2;
      rctx.setLineDash([3, 3]);
      rctx.beginPath(); rctx.arc(px, py, sz + 5, 0, Math.PI * 2); rctx.stroke();
      rctx.setLineDash([]);
    }

    // Label
    const call = (p.flight || p.hex || '?').trim();
    rctx.fillStyle = col;
    rctx.font = `${Math.max(8, R * 0.042)}px 'Share Tech Mono'`;
    rctx.fillText(call, px + 6, py - 5);
  });
}

function drawSweep(ts) {
  sctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const dt = ts ? (ts - (lastTs || ts)) / 1000 : 0;
  lastTs = ts;
  sweepAng = (sweepAng + dt * 0.09) % (Math.PI * 2);

  const spread = Math.PI * 0.3;
  const grad = sctx.createConicalGradient ? null : null; // fallback
  sctx.save();
  sctx.beginPath(); sctx.arc(cx, cy, R, 0, Math.PI * 2); sctx.clip();

  // Sweep trail
  for (let i = 0; i < 24; i++) {
    const a = sweepAng - (i / 24) * spread;
    const alpha = (1 - i / 24) * 0.22;
    sctx.beginPath();
    sctx.moveTo(cx, cy);
    sctx.arc(cx, cy, R, a, a + (spread / 24));
    sctx.closePath();
    sctx.fillStyle = `rgba(0,255,136,${alpha})`;
    sctx.fill();
  }

  // Sweep line
  sctx.beginPath();
  sctx.moveTo(cx, cy);
  sctx.lineTo(cx + Math.cos(sweepAng) * R, cy + Math.sin(sweepAng) * R);
  sctx.strokeStyle = 'rgba(0,255,136,.9)';
  sctx.lineWidth = 1.5;
  sctx.stroke();
  sctx.restore();

  requestAnimationFrame(drawSweep);
}
let lastTs = 0;

// ═══════════════════════════════════════════════════════
// COORDINATE HELPERS
// ═══════════════════════════════════════════════════════
function latDeg() { return 1 / 111.32; }
function lonDeg() { return 1 / (111.32 * Math.cos(LAT * Math.PI / 180)); }
function distKm(la1, lo1, la2, lo2) {
  const R = 6371, d2r = d => d * Math.PI / 180;
  const dla = d2r(la2 - la1), dlo = d2r(lo2 - lo1);
  const a = Math.sin(dla / 2) ** 2 + Math.cos(d2r(la1)) * Math.cos(d2r(la2)) * Math.sin(dlo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═══════════════════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════════════════
const APIS = [
  (la, lo, nm) => `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/${nm}`,
  (la, lo, nm) => `https://api.airplanes.live/v2/point/${la}/${lo}/${nm}`,
  (la, lo, nm) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${nm}`,
];
let apiIdx = 0, fetchFail = 0;

async function fetchPlanes() {
  for (let i = 0; i < APIS.length; i++) {
    const idx = (apiIdx + i) % APIS.length;
    try {
      const r = await fetch(APIS[idx](LAT, LON, RANGE_NM), { signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      apiIdx = idx; fetchFail = 0; demoMode = false;
      setConnectionStatus(true);
      updatePlanes((data.ac || []).filter(p => p.lat != null && p.lon != null));
      return;
    } catch(e) { /* try next */ }
  }
  fetchFail++;
  if (fetchFail >= 3) { demoMode = true; updateDisconnectedMode(); }
}

function updateDisconnectedMode() {
  setConnectionStatus(false);
}

function updatePlanes(raw) {
  // Annotate with distance
  raw.forEach(p => {
    p._distKm = distKm(LAT, LON, p.lat, p.lon);
  });

  // Record stats
  recordPlanes(raw);

  planes = raw.sort((a, b) => a._distKm - b._distKm);
  lastFetch = Date.now();
  renderList();
  updateStatsBar();
  drawRadar();
}

// ═══════════════════════════════════════════════════════
// RENDER LIST
// ═══════════════════════════════════════════════════════
function renderList() {
  const list = document.getElementById('acList');
  document.getElementById('panelCount').textContent = planes.length;
  document.getElementById('statTotal').textContent = planes.length;

  const overhead = planes.filter(p => p._distKm * 1000 < notifRadius * 1000);
  document.getElementById('statOverhead').textContent = overhead.length;

  if (!planes.length) { list.innerHTML = '<div style="padding:12px;font-family:\'Share Tech Mono\',monospace;font-size:.65rem;color:var(--muted);text-align:center">No aircraft in range</div>'; return; }

  list.innerHTML = planes.slice(0, 30).map(p => {
    const call = (p.flight || p.hex || '?').trim();
    const alt  = p.alt_baro ?? p.alt_geom;
    const fl   = alt ? `FL${Math.round(alt / 100).toString().padStart(3, '0')}` : 'GND';
    const spd  = p.gs ? `${Math.round(p.gs)}kt` : '—';
    const dist = p._distKm.toFixed(1);
    const isOver = p._distKm * 1000 < notifRadius * 1000;
    const isSel  = p.hex === selHex;
    return `<div class="ac-card${isOver ? ' overhead' : ''}${isSel ? ' sel' : ''}" onclick="selectPlane('${p.hex}')">
      <div class="ac-dot" style="background:${isOver ? 'var(--amber)' : 'var(--g)'}"></div>
      <div class="ac-main">
        <div class="ac-call">${call}${isOver ? '<span class="overhead-tag">OVERHEAD</span>' : ''}</div>
        <div class="ac-sub">${fl} · ${spd} · ${p.t || '?'}</div>
      </div>
      <div class="ac-dist">${dist} km</div>
    </div>`;
  }).join('');
}

function updateStatsBar() {
  if (!planes.length) return;
  const alts = planes.filter(p => (p.alt_baro ?? p.alt_geom) != null).map(p => p.alt_baro ?? p.alt_geom);
  const maxAlt = alts.length ? Math.max(...alts) : null;
  document.getElementById('statMax').textContent = maxAlt ? `FL${Math.round(maxAlt/100).toString().padStart(3,'0')}` : '—';
  const cl = planes[0]; // already sorted by distance
  document.getElementById('statClosest').textContent = cl ? `${cl._distKm.toFixed(1)}km` : '—';
}

// ═══════════════════════════════════════════════════════
// SELECT PLANE
// ═══════════════════════════════════════════════════════
function selectPlane(hex) {
  selHex = hex;
  const p = planes.find(x => x.hex === hex);
  if (!p) return;

  const call = (p.flight || p.hex || '?').trim();
  const alt  = p.alt_baro ?? p.alt_geom;
  const fl   = alt ? `FL${Math.round(alt / 100).toString().padStart(3, '0')} (${Math.round(alt).toLocaleString()} ft)` : 'Unknown';
  const spd  = p.gs ? `${Math.round(p.gs)} kt` : '—';
  const hdg  = p.track != null ? `${Math.round(p.track)}°` : '—';
  const cat  = p.t || p.category || '—';

  document.getElementById('detailCall').textContent = call;
  document.getElementById('detailBody').innerHTML = `
    <div class="di"><div class="di-label">ALTITUDE</div><div class="di-val">${fl}</div></div>
    <div class="di"><div class="di-label">SPEED</div><div class="di-val">${spd}</div></div>
    <div class="di"><div class="di-label">HEADING</div><div class="di-val">${hdg}</div></div>
    <div class="di"><div class="di-label">AIRCRAFT TYPE</div><div class="di-val">${cat}</div></div>
    <div class="di"><div class="di-label">DISTANCE</div><div class="di-val">${p._distKm.toFixed(2)} km</div></div>
    <div class="di"><div class="di-label">HEX / ICAO</div><div class="di-val">${p.hex || '—'}</div></div>
    <div class="di"><div class="di-label">SQUAWK</div><div class="di-val">${p.squawk || '—'}</div></div>
    <div class="di"><div class="di-label">POSITION</div><div class="di-val">${p.lat.toFixed(4)}°N, ${p.lon.toFixed(4)}°E</div></div>
  `;
  document.getElementById('detailOverlay').classList.add('open');
  drawRadar();
}

function closeDetail(e) {
  if (e && e.target !== document.getElementById('detailOverlay')) return;
  document.getElementById('detailOverlay').classList.remove('open');
  selHex = null; drawRadar();
}

// ═══════════════════════════════════════════════════════
// PANEL
// ═══════════════════════════════════════════════════════
function togglePanel() {
  panelOpen = !panelOpen;
  document.getElementById('bottomPanel').classList.toggle('collapsed', !panelOpen);
}

// ═══════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════
function openSettings() { document.getElementById('settingsOverlay').classList.add('open'); }
function closeSettings(e) {
  if (e && e.target !== document.getElementById('settingsOverlay')) return;
  document.getElementById('settingsOverlay').classList.remove('open');
}

function onRangeChange(v) {
  RANGE_NM = parseInt(v, 10);
  document.getElementById('rangeVal').textContent = `${v} nm`;
  saveAppSettings();
  if (sw) sw.postMessage({ type: 'RANGE_CHANGE', rangeNm: RANGE_NM });
  if (alertsActive && sw) sw.postMessage({ type: 'START_WATCH', lat: LAT, lon: LON, rangeNm: RANGE_NM, radiusKm: notifRadius, maxAltFt: MAX_ALT_FT });
  fetchPlanes();
}

function onRadiusChange(v) {
  notifRadius = parseInt(v, 10);
  document.getElementById('radiusVal').textContent = `${v} km`;
  saveAppSettings();
  if (sw) sw.postMessage({ type: 'RADIUS_CHANGE', radiusKm: notifRadius });
  if (alertsActive && sw) sw.postMessage({ type: 'START_WATCH', lat: LAT, lon: LON, rangeNm: RANGE_NM, radiusKm: notifRadius, maxAltFt: MAX_ALT_FT });
}

function setLocation(lat, lon, name) {
  LAT = lat; LON = lon; LOC_NAME = name;
  document.getElementById('currentLocLabel').textContent = name;
  saveAppSettings();
  if (sw) sw.postMessage({ type: 'LOCATION_CHANGE', lat, lon });
  if (alertsActive && sw) sw.postMessage({ type: 'START_WATCH', lat: LAT, lon: LON, rangeNm: RANGE_NM, radiusKm: notifRadius, maxAltFt: MAX_ALT_FT });
  fetchWeather();
  fetchPlanes();
}

function useGPS() {
  if (!navigator.geolocation) { showToast('Geolocation not supported'); return; }
  showToast('Getting GPS position…');
  navigator.geolocation.getCurrentPosition(
    pos => { setLocation(pos.coords.latitude, pos.coords.longitude, `${pos.coords.latitude.toFixed(4)}°N, ${pos.coords.longitude.toFixed(4)}°E`); showToast('Location updated'); },
    () => showToast('GPS unavailable')
  );
}

let locTimer;
function onLocInput() {
  clearTimeout(locTimer);
  const v = document.getElementById('locInput').value.trim();
  if (v.length < 3) { document.getElementById('locSuggestions').style.display = 'none'; return; }
  locTimer = setTimeout(() => searchLocation(v), 400);
}

async function searchLocation(q) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`);
    const d = await r.json();
    const s = document.getElementById('locSuggestions');
    if (!d.length) { s.style.display = 'none'; return; }
    s.innerHTML = d.map(x => `<div class="loc-sugg-item" onclick="pickLoc(${x.lat},${x.lon},'${x.display_name.replace(/'/g,"\'")}')"><b>${x.name || x.display_name.split(',')[0]}</b><br><small>${x.display_name}</small></div>`).join('');
    s.style.display = 'block';
  } catch(e) {}
}

function pickLoc(lat, lon, name) {
  setLocation(parseFloat(lat), parseFloat(lon), name);
  document.getElementById('locInput').value = '';
  document.getElementById('locSuggestions').style.display = 'none';
  showToast('Location set: ' + name.split(',')[0]);
}

// ═══════════════════════════════════════════════════════
// ALERTS — BUG FIXES APPLIED HERE
// ═══════════════════════════════════════════════════════
function toggleAlerts() {
  if (alertsActive) {
    document.getElementById('disableModal').classList.add('open');
  } else {
    document.getElementById('alertModal').classList.add('open');
  }
}

async function toggleAOD() {
  await setAODMode(!aodMode);
}

function closeAlertModal() { document.getElementById('alertModal').classList.remove('open'); }
function closeDisableModal() { document.getElementById('disableModal').classList.remove('open'); }

async function registerBackgroundCheck() {
  try {
    if (swReg && 'periodicSync' in swReg) {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state === 'granted') {
        await swReg.periodicSync.register('skywatch-check', { minInterval: 15 * 60 * 1000 });
      }
    }
  } catch(e) {}
}

async function enableNotifications() {
  closeAlertModal();

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { showToast('⚠ Notification permission denied'); return; }

  // BUG FIX 1: safely get SW controller after ready
  const reg = await navigator.serviceWorker.ready;
  // controller may be null on first load — fall back to active
  const ctrl = navigator.serviceWorker.controller || reg.active;
  if (ctrl) {
    ctrl.postMessage({ type: 'START_WATCH', lat: LAT, lon: LON, rangeNm: RANGE_NM, radiusKm: notifRadius, maxAltFt: MAX_ALT_FT });
    sw = ctrl;
  }

  // BUG FIX 2: persist alert state
  alertsActive = true;
  saveAppSettings();
  document.getElementById('alertBtn').classList.add('active');
  document.getElementById('alertBtn').textContent = '🔔 ALERTS ON';

  await registerBackgroundCheck();

  showToast('✅ Overhead alerts enabled (below FL150)');
}

function disableNotifications() {
  closeDisableModal();
  if (sw) sw.postMessage({ type: 'STOP_WATCH' });
  // BUG FIX 2: persist alert state
  alertsActive = false;
  saveAppSettings();
  document.getElementById('alertBtn').classList.remove('active');
  document.getElementById('alertBtn').textContent = '🔔 ALERTS';
  showToast('Alerts disabled');
}

// ═══════════════════════════════════════════════════════
// STATS SCREEN
// ═══════════════════════════════════════════════════════
function openStats() {
  refreshStatsUI();
  document.getElementById('statsOverlay').classList.add('open');
}
function closeStats() { document.getElementById('statsOverlay').classList.remove('open'); }

function refreshStatsUI() {
  renderWeather();
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  document.getElementById('statsDate').textContent = today;
  document.getElementById('scDate').textContent = `📍 ${LOC_NAME.split(',')[0]} · ${today} · skywatch`;

  const total = Object.keys(todayStats.seenHexes).length;
  document.getElementById('sTotalSeen').textContent = total;
  document.getElementById('scTotal').textContent = total;

  if (todayStats.highestAlt != null) {
    const fl = `FL${Math.round(todayStats.highestAlt / 100).toString().padStart(3, '0')}`;
    document.getElementById('sHighAlt').textContent = fl;
    document.getElementById('sHighAltFlight').textContent = todayStats.highAltFlight || '—';
    document.getElementById('scHighAlt').textContent = fl;
  } else {
    document.getElementById('sHighAlt').textContent = '—';
    document.getElementById('sHighAltFlight').textContent = 'no data yet';
    document.getElementById('scHighAlt').textContent = '—';
  }

  if (todayStats.closest != null) {
    const cl = `${todayStats.closest.toFixed(1)} km`;
    document.getElementById('sClosest').textContent = cl;
    document.getElementById('sClosestFlight').textContent = todayStats.closestFlight || '—';
    document.getElementById('scClosest').textContent = cl;
  } else {
    document.getElementById('sClosest').textContent = '—';
    document.getElementById('sClosestFlight').textContent = 'no data yet';
    document.getElementById('scClosest').textContent = '—';
  }

  // Top airline
  const airlines = todayStats.airlines;
  const sorted = Object.entries(airlines).sort((a, b) => b[1] - a[1]);
  if (sorted.length) {
    document.getElementById('sTopAirline').textContent = sorted[0][0];
    document.getElementById('sTopAirlineCount').textContent = `${sorted[0][1]} aircraft`;
    document.getElementById('scAirline').textContent = sorted[0][0];
  } else {
    document.getElementById('sTopAirline').textContent = '—';
    document.getElementById('sTopAirlineCount').textContent = 'no data yet';
    document.getElementById('scAirline').textContent = '—';
  }

  // Airline bars
  const barWrap = document.getElementById('airlineBarWrap');
  if (sorted.length) {
    const max = sorted[0][1];
    barWrap.innerHTML = sorted.slice(0, 6).map(([code, cnt]) => `
      <div class="airline-bar-item">
        <div class="airline-name">${code}</div>
        <div class="airline-bar"><div class="airline-bar-fill" style="width:${Math.round(cnt / max * 100)}%"></div></div>
        <div class="airline-count">${cnt}</div>
      </div>
    `).join('');
  } else {
    barWrap.innerHTML = '<div style="font-family:\'Share Tech Mono\',monospace;font-size:.65rem;color:var(--muted)">No data yet — start watching!</div>';
  }
}

// ═══════════════════════════════════════════════════════
// SHARE STATS
// ═══════════════════════════════════════════════════════
function buildStatsText() {
  const total = Object.keys(todayStats.seenHexes).length;
  const fl = todayStats.highestAlt ? `FL${Math.round(todayStats.highestAlt / 100).toString().padStart(3, '0')}` : '—';
  const cl = todayStats.closest != null ? `${todayStats.closest.toFixed(1)} km` : '—';
  const sorted = Object.entries(todayStats.airlines).sort((a, b) => b[1] - a[1]);
  const airline = sorted.length ? sorted[0][0] : '—';
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return `✈ My SkyWatch Stats — ${today}
📍 ${LOC_NAME.split(',')[0]}

🛫 Aircraft seen today: ${total}
⬆ Highest altitude: ${fl}
📍 Closest aircraft: ${cl}
🏆 Top airline: ${airline}

Track planes near you 👇
${SITE_URL}`;
}

async function copyStatsText() {
  try {
    await navigator.clipboard.writeText(buildStatsText());
    showToast('Stats copied to clipboard!');
  } catch(e) { showToast('Copy failed — try Share'); }
}

async function shareStats() {
  const txt = buildStatsText();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'My SkyWatch Stats', text: txt });
    } catch(e) {}
  } else {
    await copyStatsText();
  }
}

// ═══════════════════════════════════════════════════════
// SHARE WEBSITE
// ═══════════════════════════════════════════════════════
async function copyWebsiteLink() {
  try {
    await navigator.clipboard.writeText(SITE_URL);
    showToast('Link copied!');
  } catch(e) { showToast('Copy failed'); }
}

async function shareWebsite() {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'SkyWatch · Live Flight Radar', text: '🛫 Track planes flying over you in real-time!', url: SITE_URL });
    } catch(e) {}
  } else {
    copyWebsiteLink();
  }
}

function shareWhatsApp() {
  const msg = encodeURIComponent(`🛫 Check out SkyWatch — track live planes near you!
${SITE_URL}`);
  window.open(`https://wa.me/?text=${msg}`, '_blank');
}

function shareTwitter() {
  const msg = encodeURIComponent(`🛫 Tracking live planes overhead with SkyWatch! Check it out 👇
${SITE_URL}`);
  window.open(`https://twitter.com/intent/tweet?text=${msg}`, '_blank');
}

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ═══════════════════════════════════════════════════════
// SW MESSAGE HANDLER
// ═══════════════════════════════════════════════════════
function handleSWMessage(e) {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'PLANES_UPDATE') { updatePlanes(msg.planes); }
  if (msg.type === 'SELECT') { selectPlane(msg.hex); }
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
  loadAppSettings();

  document.getElementById('currentLocLabel').textContent = LOC_NAME;
  document.getElementById('rangeSlider').value = RANGE_NM;
  document.getElementById('rangeVal').textContent = `${RANGE_NM} nm`;
  document.getElementById('radiusSlider').value = notifRadius;
  document.getElementById('radiusVal').textContent = `${notifRadius} km`;
  document.getElementById('alertBtn').classList.toggle('active', alertsActive);
  document.getElementById('alertBtn').textContent = alertsActive ? '🔔 ALERTS ON' : '🔔 ALERTS';
  setConnectionStatus(true);
  const aodBtn = document.getElementById('aodBtn');
  if (aodBtn) {
    aodBtn.textContent = aodMode ? 'ON' : 'OFF';
    aodBtn.classList.toggle('on', aodMode);
  }
  document.body.classList.toggle('aod-mode', aodMode);

  resizeCanvases();
  drawRadar();
  requestAnimationFrame(drawSweep);
  renderWeather();
  updateAODClock();
  if (aodMode) {
    startBurnInProtection();
    requestWakeLock();
  }

  // Register SW
  if ('serviceWorker' in navigator) {
    try {
      swReg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;

      // BUG FIX 1: reliable controller reference
      sw = navigator.serviceWorker.controller || swReg.active;

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        sw = navigator.serviceWorker.controller;
        // Re-send START_WATCH if alerts were active (new SW took over)
        if (alertsActive) {
          sw.postMessage({ type: 'START_WATCH', lat: LAT, lon: LON, rangeNm: RANGE_NM, radiusKm: notifRadius, maxAltFt: MAX_ALT_FT });
        }
      });

      navigator.serviceWorker.addEventListener('message', handleSWMessage);

      // Auto-restart alerts if previously enabled
      if (alertsActive && Notification.permission === 'granted') {
        document.getElementById('alertBtn').classList.add('active');
        document.getElementById('alertBtn').textContent = '🔔 ALERTS ON';
        const ctrl = navigator.serviceWorker.controller || swReg.active;
        if (ctrl) {
          ctrl.postMessage({ type: 'START_WATCH', lat: LAT, lon: LON, rangeNm: RANGE_NM, radiusKm: notifRadius, maxAltFt: MAX_ALT_FT });
          sw = ctrl;
        }
        await registerBackgroundCheck();
      }

    } catch(e) { console.warn('[App] SW registration failed:', e); }
  }

  // Show notification banner if not decided yet
  if (!('Notification' in window) || Notification.permission === 'default') {
    document.getElementById('notifBanner').classList.add('show');
  }

  // Fetch weather + planes
  await fetchWeather();
  await fetchPlanes();

  // Hide loader, show app
  document.getElementById('loader').classList.add('gone');
  document.getElementById('app').classList.add('ready');

  // Fetch loop every 20s
  setInterval(fetchPlanes, 20000);
  setInterval(fetchWeather, 30 * 60 * 1000);
  setInterval(() => { if (aodMode) updateAODClock(); }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (aodMode && !document.hidden) requestWakeLock();
  });

  // Resize
  window.addEventListener('resize', () => { resizeCanvases(); drawRadar(); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && alertsActive) saveAppSettings();
  });
  window.addEventListener('pagehide', () => {
    if (alertsActive) saveAppSettings();
  });
}

init();


