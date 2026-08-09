import { waitUntil } from '@vercel/functions';
import { db, isAdmin, advanceScan, sweepStalled, cancelStaleDuoTasks, getUrl } from '../../../lib/core';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const url = getUrl(req);
  const secret = url.searchParams.get('secret');
  const pass = isAdmin(req) || (secret && secret === process.env.ADMIN_KEY) || !process.env.ADMIN_KEY;

  // The plain watchdog tick stays open (Vercel cron and the scan page poll it
  // anonymously; it only re-drives existing state), but resetting failed points
  // is a mutation reserved for the admin.
  const resetFailed = url.searchParams.get('reset_failed') === '1';
  if (resetFailed && !pass) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const sb = db();
  const { data: scans } = await sb.from('scans').select('*').eq('status', 'running');
  const origin = url.origin;
  const bg = [];
  let kicked = 0;

  if (scans?.length) {
    await cancelStaleDuoTasks(scans.map(s => s.id));
  }

  for (const scan of scans || []) {
    if (resetFailed) {
      await sb.from('scan_points').update({ state: 'pending', attempts: 0, phone_id: null })
        .eq('scan_id', scan.id).eq('state', 'failed');
    }
    await sweepStalled(sb, scan);
    kicked += await advanceScan(sb, scan, origin, bg);
  }

  for (const p of bg) {
    try { waitUntil(p); } catch (e) { /* ignore outside Vercel */ }
  }

  return Response.json({ ok: true, running: (scans || []).length, kicked });
}

export const GET = POST;
