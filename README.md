# Geo-Grid Rank Tracker

Real-device Maps rank scanning on a live GPS grid. DuoPlus cloud phones + Supabase + Vercel.
Replaces the entire Make.com dispatcher/collector pipeline.

## How it moves
`POST /api/scan` → debits credits (optional) → builds the grid → GPS-positions the phone →
(55s settle) → fires the DuoPlus RPA task → the device POSTs its 20-title harvest to
`/api/collect?token=…` → position computed server-side (JSON array — no pipe-join bug) →
the same request immediately GPS-kicks the next point (event-driven chain). `/api/tick` is a
watchdog: requeues stalls, resumes scans; wired to the Resume button, callable by pg_cron.

## Env vars (Vercel → Project → Settings → Environment Variables)
| var | value |
|---|---|
| SUPABASE_URL | ledger project URL (same one SERP Signal uses) |
| SUPABASE_SERVICE_ROLE_KEY | its service-role key |
| ADMIN_KEY | any strong secret — gate for launching scans |
| DUOPLUS_API_KEY | your DuoPlus OpenAPI key |
| DUOPLUS_TEMPLATE_ID | the saved rank-check flow's template ID |
| DUOPLUS_PHONE_IDS | `dEW12` (comma-separated to parallelize later) |
| LEDGER_ENABLED | unset for now; `true` once rl_debit params are aligned |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET | when switching on paid packs |

## Go live
1. Paste `supabase/geo_grid_v1.sql` into the ledger project's SQL Editor.
2. Set env vars above → redeploy.
3. Open the app → enter ADMIN_KEY → Launch scan (defaults are the South Beach client).
4. Watch pins turn green on `/scan/<id>`.

Credits: scans cost 100 credits when LEDGER_ENABLED=true (rl_debit/rl_credit calls live in
`lib/core.js` — align the two rpc param names with rl_ledger_v1.sql, one-line edit).
Stripe packs: 500/$25 · 1000/$50 · 2000/$100 via `/api/checkout`; webhook credits the ledger.
