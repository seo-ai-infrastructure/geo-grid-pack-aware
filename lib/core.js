import { createClient } from '@supabase/supabase-js';

// ---------- env ----------
export const env = {
  get SUPABASE_URL() { return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://mvihrrewqzvqpsufzeid.supabase.co'; },
  get SUPABASE_KEY() { return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''; },
  get ADMIN_KEY() { return process.env.ADMIN_KEY || ''; },
  get DUO_KEY() { return process.env.DUOPLUS_API_KEY || ''; },
  get TEMPLATE_ID() { return process.env.DUOPLUS_TEMPLATE_ID || ''; },
  get PHONE_IDS() { return (process.env.DUOPLUS_PHONE_IDS || 'dEW12,TA5Jr,SxRDI').split(',').map(s => s.trim()).filter(Boolean); },
  get GPS_SETTLE_MS() { return parseInt(process.env.GPS_SETTLE_MS || '3000', 10); },
  get RECORD_DURATION_SEC() { return parseInt(process.env.RECORD_DURATION_SEC || '90', 10); },
  get TASK_TIMEOUT_MS() { return parseInt(process.env.TASK_TIMEOUT_MS || '300000', 10); },
  get SCAN_COST() { return parseInt(process.env.SCAN_COST_CREDITS || '100', 10); },
  get LEDGER_ENABLED() { return process.env.LEDGER_ENABLED === 'true'; },
  get BASE_URL() { return process.env.PUBLIC_BASE_URL || ''; }
};

export const db = () => createClient(env.SUPABASE_URL, env.SUPABASE_KEY, { auth: { persistSession: false } });

export const isAdmin = (req) => {
  const expectedKey = env.ADMIN_KEY;
  if (!expectedKey) return true; // If ADMIN_KEY is not set, allow access in dev mode
  const headerKey = req.headers.get('x-admin-key');
  return headerKey === expectedKey;
};

export function getUrl(req) {
  const host = req?.headers?.get?.('host') || 'localhost:3000';
  const proto = req?.headers?.get?.('x-forwarded-proto') || 'http';
  const base = env.BASE_URL || `${proto}://${host}`;
  return new URL(req.url, base);
}

// ---------- ledger (isolated; align signatures with rl_ledger_v1.sql here only) ----------
export async function ledgerDebit(sb, key, amount, memo) {
  if (!env.LEDGER_ENABLED) return { ok: true, skipped: true };
  const { data, error } = await sb.rpc('rl_debit', { p_key: key, p_amount: amount, p_memo: memo });
  if (error) return { ok: false, error: error.message };            // fail closed
  return { ok: true, data };
}
export async function ledgerCredit(sb, key, amount, memo) {
  if (!env.LEDGER_ENABLED) return { ok: true, skipped: true };
  const { data, error } = await sb.rpc('rl_credit', { p_key: key, p_amount: amount, p_memo: memo });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

// ---------- grid ----------
export function buildGrid(centerLat, centerLng, size, spacingMiles) {
  const half = Math.floor(size / 2);
  const dLat = spacingMiles / 69.172;
  const pts = [];
  for (let r = 0; r < size; r++) {
    const lat = centerLat + (half - r) * dLat;                       // row A = north
    const dLng = spacingMiles / (69.172 * Math.cos(lat * Math.PI / 180));
    for (let c = 0; c < size; c++) {
      pts.push({
        label: String.fromCharCode(65 + r) + (c + 1),
        lat: +lat.toFixed(6),
        lng: +(centerLng + (c - half) * dLng).toFixed(6)
      });
    }
  }
  return pts;
}

export function cleanTitles(list) {
  return (list || [])
    .map(t => (t || '').trim())
    .filter(t => t && !/^\$\{[^}]+\}$/.test(t));                     // drop empties + any unresolved ${var}
}
export function matchIndex(gbpName, clean) {
  const needle = (gbpName || '').trim().toLowerCase();
  if (!needle) return 0;
  const i = (clean || []).findIndex(t => {
    const candidate = (t || '').trim().toLowerCase();
    if (!candidate) return false;
    return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
  });
  return i === -1 ? 0 : i + 1;
}
export function computePosition(gbpName, titles) {
  const clean = cleanTitles(titles);
  return { position: matchIndex(gbpName, clean), titles: clean };
}

// ---------- raw-harvest classification (wide TextView capture -> business titles) ----------
const JUNK = [
  /^\d\.\d$/, /^\(\d[\d,]*\)$/, /^sponsored$/i, /^ads?$/i,
  /^(open|closed|closes|opens)\b/i, /\d+(\.\d+)?\s?(mi|km)\b/i,
  /^(call|directions|website|menu|order|book|more businesses|people also ask|videos|images|maps|news|shopping|more|filters?|rating|reviews?|hours|about|overview|services|updates)$/i,
  /^[\d\s()+\-.]{7,}$/, /^[\u00b7\u2022|.\-\s]+$/, /^(ai overview|show more|see more|view all)/i,
  /^\d+\+?$/, /^(am|pm)$/i,
  /^(ai mode|all|short videos|forums|web|books|flights|finance|online appointments|within \d+ mi|open now|top rated|search results|feedback|sign in|google|images|news|videos|shopping|maps)$/i,
  /.*,\s*[A-Z]{2}$/
];
export function classifyBusinessTitles(raw) {
  const seen = new Set(); const out = [];
  for (const t of cleanTitles(raw)) {
    if (JUNK.some(rx => rx.test(t))) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}
export const hasSponsored = raw => cleanTitles(raw).some(t => /^sponsored$/i.test(t));

// ---------- DuoPlus ----------
const DUO = 'https://openapi.duoplus.net/api/v1';
async function duo(path, body) {
  const r = await fetch(`${DUO}${path}`, {
    method: 'POST',
    headers: { 'DuoPlus-API-Key': env.DUO_KEY, 'Content-Type': 'application/json', 'Lang': 'en' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`DuoPlus ${path} ${r.status}: ${text.slice(0, 300)}`);
  return json;
}
export const setGps = (phoneId, lat, lng) =>
  duo('/cloudPhone/update', { images: [{ image_id: phoneId, gps: { type: 2, longitude: String(lng), latitude: String(lat) } }] });

export const duoCommand = (phoneId, command) =>
  duo('/cloudPhone/command', { image_id: phoneId, command });

function dbgLog(location, message, data, hypothesisId) {
  // #region agent log
  fetch('http://127.0.0.1:7300/ingest/1b6c3964-b0bb-446c-96d4-5e00426a7343', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6a3189' }, body: JSON.stringify({ sessionId: '6a3189', location, message, data, hypothesisId, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
}

export function videoPath(scanId, label) {
  return `/sdcard/geogrid_${scanId}_${label}.mp4`;
}

export function shanghaiNow() {
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}
export const addTask = (phoneId, scan, point, collectUrl) =>
  duo('/automation/addTask', {
    template_id: env.TEMPLATE_ID, template_type: '2', name: `GeoGrid ${point.label}`,
    images: [{
      image_id: phoneId,
      config: {
        search_term:  { key: 'search_term',  value: scan.keyword,  type: 'string', required: true },
        gbp_name:     { key: 'gbp_name',     value: scan.gbp_name, type: 'string', required: true },
        grid_label:   { key: 'grid_label',   value: point.label,   type: 'string', required: true },
        grid_webhook: { key: 'grid_webhook', value: collectUrl,    type: 'string', required: true }
      },
      issue_at: shanghaiNow()
    }]
  });

// ---------- dispatch engine (shared by scan / collect / tick) ----------
export function collectUrlFor(scan, origin) {
  const base = env.BASE_URL || origin;
  return `${base}/api/collect?token=${scan.token}`;
}

// Start 90s screenrecord on DuoPlus cloud phone via ADB command API (background).
export async function startCloudScreenRecord(phoneId, scanId, label) {
  const duration = env.RECORD_DURATION_SEC;
  const path = videoPath(scanId, label);
  const cmd = `screenrecord --time-limit ${duration} --bit-rate 8000000 ${path} > /dev/null 2>&1 &`;
  dbgLog('core.js:startCloudScreenRecord', 'starting cloud screenrecord', { phoneId, scanId, label, path, duration, cmd }, 'A');
  try {
    const res = await duoCommand(phoneId, cmd);
    const ok = res?.data?.success ?? res?.code === 200;
    dbgLog('core.js:startCloudScreenRecord', 'screenrecord command result', { phoneId, label, ok, resCode: res?.code }, 'B');
    console.log(`[ScreenRecord] Started ${duration}s on ${phoneId} point ${label}:`, res);
    return { path, duration, ok, res };
  } catch (e) {
    dbgLog('core.js:startCloudScreenRecord', 'screenrecord command failed', { phoneId, label, error: String(e).slice(0, 200) }, 'B');
    console.log(`[ScreenRecord] Failed on ${phoneId} point ${label}:`, e.message || e);
    return { path, duration, ok: false, error: String(e) };
  }
}

// After recording finishes, upload MP4 off the phone and save video_url.
export async function finalizeVideo(sb, scanId, pointId, phoneId, label) {
  const duration = env.RECORD_DURATION_SEC;
  const path = videoPath(scanId, label);
  const logPath = `/sdcard/upload_${scanId}_${label}.log`;
  dbgLog('core.js:finalizeVideo', 'waiting for recording to finish', { scanId, pointId, phoneId, label, duration }, 'C');
  await new Promise(res => setTimeout(res, (duration + 5) * 1000));
  try {
    await duoCommand(phoneId, `curl -F "file=@${path}" https://temp.sh/upload > ${logPath} 2>&1 &`);
    await new Promise(res => setTimeout(res, 20000));
    const logRes = await duoCommand(phoneId, `cat ${logPath}`);
    const content = logRes?.data?.content || '';
    const urlMatch = content.match(/https:\/\/temp\.sh\/[^\s"'<>]+/);
    dbgLog('core.js:finalizeVideo', 'upload log parsed', { label, hasUrl: !!urlMatch, contentLen: content.length }, 'C');
    if (urlMatch) {
      await sb.from('scan_points').update({ video_url: urlMatch[0], video_path: path }).eq('id', pointId);
      dbgLog('core.js:finalizeVideo', 'video_url saved', { pointId, label, video_url: urlMatch[0] }, 'D');
      console.log(`[ScreenRecord] video_url saved for ${label}:`, urlMatch[0]);
    } else {
      dbgLog('core.js:finalizeVideo', 'no upload URL in log', { label, content: content.slice(0, 300) }, 'C');
      console.log(`[ScreenRecord] No upload URL for ${label}, log:`, content.slice(0, 300));
    }
  } catch (e) {
    dbgLog('core.js:finalizeVideo', 'finalize failed', { label, error: String(e).slice(0, 200) }, 'C');
    console.log(`[ScreenRecord] finalize failed for ${label}:`, e.message || e);
  }
}

// Set GPS now, then (after settle) issue the task. Runs inside waitUntil.
export async function kickPoint(sb, scan, point, phoneId, origin) {
  try {
    await setGps(phoneId, point.lat, point.lng);
  } catch (err) {
    console.log(`[setGps note] phone ${phoneId}: ${err.message || err}`);
  }
  await sb.from('scan_points').update({ state: 'gps_set', phone_id: phoneId, gps_set_at: new Date().toISOString(), video_path: videoPath(scan.id, point.label) })
    .eq('id', point.id);

  // Recording FIRST — before GPS settle and RPA task dispatch
  await startCloudScreenRecord(phoneId, scan.id, point.label);
  dbgLog('core.js:kickPoint', 'recording started, waiting GPS settle before RPA', { label: point.label, gpsSettleMs: env.GPS_SETTLE_MS }, 'E');

  await new Promise(res => setTimeout(res, env.GPS_SETTLE_MS));
  const url = collectUrlFor(scan, origin);
  console.log(`[addTask] issuing task to phone ${phoneId} for point ${point.label} with webhook ${url}...`);
  const taskRes = await addTask(phoneId, scan, point, url);
  console.log(`[addTask success] phone ${phoneId}:`, taskRes);
  await sb.from('scan_points').update({ state: 'task_issued', task_issued_at: new Date().toISOString() })
    .eq('id', point.id).eq('state', 'gps_set');
}

// Advance a scan: for each idle phone, kick the next pending point. Returns kicked count.
export async function advanceScan(sb, scan, origin, backgroundFns) {
  const { data: points } = await sb.from('scan_points').select('*').eq('scan_id', scan.id).order('id');
  const busyPhones = new Set(points.filter(p => ['gps_set', 'task_issued'].includes(p.state)).map(p => p.phone_id));
  const pending = points.filter(p => p.state === 'pending');
  const done = points.filter(p => ['done', 'failed'].includes(p.state)).length;

  if (!pending.length && !busyPhones.size) {
    const failed = points.filter(p => p.state === 'failed').length;
    await sb.from('scans').update({
      status: failed ? 'complete_with_failures' : 'complete',
      completed_at: new Date().toISOString(), points_done: done
    }).eq('id', scan.id).eq('status', 'running');
    return 0;
  }
  await sb.from('scans').update({ points_done: done }).eq('id', scan.id);

  let kicked = 0;
  for (const phoneId of env.PHONE_IDS) {
    if (busyPhones.has(phoneId)) continue;
    const point = pending.shift();
    if (!point) break;
    await sb.from('scan_points').update({ state: 'gps_set', phone_id: phoneId, gps_set_at: new Date().toISOString() })
      .eq('id', point.id).eq('state', 'pending');                    // claim (idempotency guard)
    backgroundFns.push(kickPoint(sb, scan, { ...point }, phoneId, origin).catch(async e => {
      await sb.from('scan_points').update({ state: 'failed', error: String(e).slice(0, 500) }).eq('id', point.id);
    }));
    backgroundFns.push(finalizeVideo(sb, scan.id, point.id, phoneId, point.label).catch(e => {
      console.log(`[ScreenRecord] finalizeVideo background error ${point.label}:`, e.message || e);
    }));
    kicked++;
  }
  return kicked;
}

// Watchdog: requeue stalled points (waitUntil died / task never reported back)
export async function sweepStalled(sb, scan) {
  const now = Date.now();
  const { data: points } = await sb.from('scan_points').select('*').eq('scan_id', scan.id)
    .in('state', ['gps_set', 'task_issued']);
  for (const p of points || []) {
    const started = new Date(p.state === 'gps_set' ? p.gps_set_at : p.task_issued_at).getTime();
    const budget = p.state === 'gps_set' ? env.GPS_SETTLE_MS + 120000 : env.TASK_TIMEOUT_MS;
    if (now - started > budget) {
      const next = (p.attempts || 0) < 5 ? 'pending' : 'failed';
      await sb.from('scan_points').update({ state: next, attempts: (p.attempts || 0) + 1, phone_id: null }).eq('id', p.id);
    }
  }
}
