import { db, env, ledgerCredit, getUrl } from '../../../lib/core';
export const dynamic = 'force-dynamic';

const PACKS = {
  starter: { credits: 500,  usd: 2500,  name: 'Geo-Grid 500 credits (5 scans)' },
  pro:     { credits: 1000, usd: 5000,  name: 'Geo-Grid 1,000 credits (10 scans)' },
  agency:  { credits: 2000, usd: 10000, name: 'Geo-Grid 2,000 credits (20 scans)' }
};

export async function POST(req) {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return Response.json({ error: 'Stripe not configured' }, { status: 500 });
  const { pack = 'starter', ledger_key } = await req.json();
  const p = PACKS[pack];
  if (!p || !ledger_key) return Response.json({ error: 'pack + ledger_key required' }, { status: 400 });
  const origin = env.BASE_URL || getUrl(req).origin;

  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${origin}/?paid=1`,
    cancel_url: `${origin}/?canceled=1`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(p.usd),
    'line_items[0][price_data][product_data][name]': p.name,
    'metadata[ledger_key]': ledger_key,
    'metadata[credits]': String(p.credits)
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sk}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  const session = await r.json();
  if (!r.ok) return Response.json({ error: session.error?.message || 'stripe error' }, { status: 502 });
  return Response.json({ url: session.url });
}
