import { createClient } from '@supabase/supabase-js';

// ---------- env ----------
export const env = {
  SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  ADMIN_KEY: process.env.ADMIN_KEY || '',
  DUO_KEY: process.env.DUOPLUS_API_KEY || '',
  TEMPLATE_ID: process.env.DUOPLUS_TEMPLATE_ID || '',
  PHONE_IDS: (process.env.DUOPLUS_PHONE_IDS || 'dEW12').split(',').map(s => s.trim()).filter(Boolean),
  GPS_SETTLE_MS: parseInt(process.env.GPS_SETTLE_MS || '55000', 10),
  TASK_TIMEOUT_MS: parseInt(process.env.TASK_TIMEOUT_MS || '300000', 10),
  SCAN_COST: parseInt(process.env.SCAN_COST_CREDITS || '100', 10),
  LEDGER_ENABLED: process.env.LEDGER_ENABLED === 'true',
  BASE_URL: process.env.PUBLIC_BASE_URL || ''
};

export const db = () => createClient(env.SUPABASE_URL, env.SUPABASE_KEY, { auth: { persistSession: false } });

export const isAdmin = (req) =>
  !!env.ADMIN_KEY && (req.headers.get('x-admin-key') === env.ADMIN_KEY);

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
  const i = clean.findIndex(t => t.toLowerCase() === needle);
  return i === -1 ? 0 : i + 1;
}
export function computePosition(gbpName, titles) {
  const clean = cleanTitles(titles);
  return { position: matchIndex(gbpName, clean), titles: clean };
}

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

// Set GPS now, then (after settle) issue the task. Runs inside waitUntil.
export async function kickPoint(sb, scan, point, phoneId, origin) {
  await setGps(phoneId, point.lat, point.lng);
  await sb.from('scan_points').update({ state: 'gps_set', phone_id: phoneId, gps_set_at: new Date().toISOString() })
    .eq('id', point.id);
  await new Promise(res => setTimeout(res, env.GPS_SETTLE_MS));
  await addTask(phoneId, scan, point, collectUrlFor(scan, origin));
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
      const next = (p.attempts || 0) < 2 ? 'pending' : 'failed';
      await sb.from('scan_points').update({ state: next, attempts: (p.attempts || 0) + 1, phone_id: null }).eq('id', p.id);
    }
  }
}
