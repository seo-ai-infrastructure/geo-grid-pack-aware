import { waitUntil } from '@vercel/functions';
import { db, env, isAdmin, buildGrid, ledgerDebit, advanceScan, cancelStaleDuoTasks, getUrl } from '../../../lib/core';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!isAdmin(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (!env.TEMPLATE_ID) return Response.json({ error: 'DUOPLUS_TEMPLATE_ID not set' }, { status: 500 });
  const b = await req.json();
  const { client = '', keyword, gbp_name, center_lat, center_lng } = b;
  const grid_size = parseInt(b.grid_size || 7, 10);
  const spacing_miles = parseFloat(b.spacing_miles || 1);
  if (!keyword || !gbp_name || !isFinite(+center_lat) || !isFinite(+center_lng))
    return Response.json({ error: 'keyword, gbp_name, center_lat, center_lng required' }, { status: 400 });
  if (!Number.isFinite(grid_size) || grid_size < 1 || grid_size > 15)
    return Response.json({ error: 'grid_size must be 1-15' }, { status: 400 });
  if (!Number.isFinite(spacing_miles) || spacing_miles <= 0 || spacing_miles > 25)
    return Response.json({ error: 'spacing_miles must be 0-25' }, { status: 400 });

  const sb = db();
  const ledger_key = b.ledger_key || 'owner';
  const debit = await ledgerDebit(sb, ledger_key, env.SCAN_COST, `geo-grid scan: ${keyword}`);
  if (!debit.ok) return Response.json({ error: `credit debit failed: ${debit.error}` }, { status: 402 });

  const points = buildGrid(+center_lat, +center_lng, grid_size, spacing_miles);
  const { data: scan, error } = await sb.from('scans').insert({
    client, keyword, gbp_name, center_lat: +center_lat, center_lng: +center_lng,
    grid_size, spacing_miles, status: 'running', points_total: points.length,
    credits_debited: env.LEDGER_ENABLED ? env.SCAN_COST : 0, ledger_key
  }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { error: e2 } = await sb.from('scan_points')
    .insert(points.map(p => ({ scan_id: scan.id, ...p, state: 'pending' })));
  if (e2) return Response.json({ error: e2.message }, { status: 500 });

  const origin = getUrl(req).origin;
  const bg = [];
  await cancelStaleDuoTasks([scan.id]);
  await advanceScan(sb, scan, origin, bg);
  for (const p of bg) waitUntil(p);
  return Response.json({ ok: true, scan_id: scan.id, points: points.length });
}

export async function GET(req) {
  if (!isAdmin(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data } = await db().from('scans').select('*').order('created_at', { ascending: false }).limit(50);
  return Response.json({ scans: data || [] });
}
