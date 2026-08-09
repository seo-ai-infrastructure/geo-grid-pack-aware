import { db } from '../../../../lib/core';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(_req, { params }) {
  const sb = db();
  const { data: scan } = await sb.from('scans').select(
    'id, client, keyword, gbp_name, center_lat, center_lng, grid_size, spacing_miles, status, points_total, points_done, created_at, completed_at'
  ).eq('id', params.id).single();
  if (!scan) return Response.json({ error: 'not found' }, { status: 404 });
  const { data: points } = await sb.from('scan_points')
    .select('*')
    .eq('scan_id', params.id).order('id');
  return Response.json({ scan, points: points || [] });
}
