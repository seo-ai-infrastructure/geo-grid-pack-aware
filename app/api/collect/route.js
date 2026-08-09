import { waitUntil } from '@vercel/functions';
import { db, computePosition, cleanTitles, matchIndex, classifyBusinessTitles, hasSponsored, advanceScan, sweepStalled, getUrl } from '../../../lib/core';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const url = getUrl(req);
  const token = url.searchParams.get('token');
  if (!token) return Response.json({ error: 'missing token' }, { status: 401 });
  const sb = db();
  const { data: scan } = await sb.from('scans').select('*').eq('token', token).single();
  if (!scan) return Response.json({ error: 'bad token' }, { status: 401 });

  let body; try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const label = (body.grid_label || '').trim();
  if (!label) return Response.json({ error: 'missing grid_label' }, { status: 400 });

  // EARLY Chrome POST (mid-task): enrich the point, keep state, do NOT free the phone
  if (body.surface === 'chrome_serp_pack' && Array.isArray(body.raw_serp)) {
    const cands = classifyBusinessTitles(body.raw_serp);
    const pack_titles = cands.slice(0, 3);
    await sb.from('scan_points').update({
      raw_serp: cleanTitles(body.raw_serp), pack_titles,
      pack_position: matchIndex(scan.gbp_name, pack_titles),
      pack_has_ad: hasSponsored(body.raw_serp), surface: 'chrome_serp_pack'
    }).eq('scan_id', scan.id).eq('label', label).neq('state', 'done');
    return Response.json({ ok: true, phase: 'early', pack: pack_titles.length });
  }

  let position, titles, packFields = {};
  if (Array.isArray(body.raw_finder)) {
    // Chrome final: classify wide harvests server-side
    titles = classifyBusinessTitles(body.raw_finder);
    if ((!titles || !titles.length) && Array.isArray(body.raw_serp)) {
      titles = classifyBusinessTitles(body.raw_serp);
    }
    position = matchIndex(scan.gbp_name, titles);
    const packCands = classifyBusinessTitles(body.raw_serp || []);
    packFields = {
      raw_serp: cleanTitles(body.raw_serp || []), raw_finder: cleanTitles(body.raw_finder),
      pack_titles: packCands.slice(0, 3),
      pack_position: matchIndex(scan.gbp_name, packCands.slice(0, 3)),
      pack_has_ad: hasSponsored(body.raw_serp || [])
    };
  } else {
    ({ position, titles } = computePosition(scan.gbp_name, body.titles));
    if (Array.isArray(body.pack_titles)) {
      const pack_titles = cleanTitles(body.pack_titles);
      packFields = { pack_titles, pack_position: matchIndex(scan.gbp_name, pack_titles) };
    }
  }

  const isDone = Boolean(titles && titles.length);

  // Empty harvest = retry, but count it: without an attempts bump a point that
  // always reports empty would ping-pong pending -> task_issued forever.
  const { data: pt } = await sb.from('scan_points').select('id, attempts')
    .eq('scan_id', scan.id).eq('label', label).single();
  const attempts = (pt?.attempts || 0) + (isDone ? 0 : 1);
  const nextState = isDone ? 'done' : (attempts >= 5 ? 'failed' : 'pending');

  const { data: updated } = await sb.from('scan_points').update({
    state: nextState, position: isDone ? position : null, titles: isDone ? titles : null, surface: body.surface || 'maps_app_organic',
    done_at: isDone ? new Date().toISOString() : null, phone_id: null, attempts,
    error: nextState === 'failed' ? 'empty harvest after 5 attempts' : null, ...packFields
  }).eq('scan_id', scan.id).eq('label', label).select();

  // event-driven advance: this result frees the phone -> kick the next point now
  const origin = url.origin;
  const bg = [];
  await sweepStalled(sb, scan);
  await advanceScan(sb, scan, origin, bg);
  for (const p of bg) waitUntil(p);

  return Response.json({ ok: true, matched: (updated || []).length, position });
}
