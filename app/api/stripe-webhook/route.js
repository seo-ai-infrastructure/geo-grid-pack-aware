import crypto from 'crypto';
import { db, ledgerCredit } from '../../../lib/core';
export const dynamic = 'force-dynamic';

function verify(payload, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(kv => kv.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex');
  const ok = parts.v1 && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 600;
  return ok && fresh;
}

export async function POST(req) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: 'webhook secret not set' }, { status: 500 });
  const payload = await req.text();
  const sig = req.headers.get('stripe-signature') || '';
  let valid = false;
  try { valid = verify(payload, sig, secret); } catch { valid = false; }
  if (!valid) return Response.json({ error: 'bad signature' }, { status: 400 });

  const event = JSON.parse(payload);
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const key = s.metadata?.ledger_key, credits = parseInt(s.metadata?.credits || '0', 10);
    if (key && credits > 0) {
      const res = await ledgerCredit(db(), key, credits, `stripe ${s.id}`);
      if (!res.ok) return Response.json({ error: res.error }, { status: 500 });   // Stripe retries
    }
  }
  return Response.json({ received: true });
}
