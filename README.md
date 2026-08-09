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

## DuoPlus dev debugging (ADB ↔ command API)

When ADB is enabled on a phone in the DuoPlus dashboard you get `IP:PORT`. Locally:

```bash
adb connect IP:PORT
adb -s IP:PORT shell uiautomator dump /sdcard/uidump.xml
adb pull /sdcard/uidump.xml
python parse_dump_advanced.py uidump.xml --clickable-only
```

In production, `duoCommand(phoneId, '…')` in `lib/core.js` is the same as `adb shell …` — it hits DuoPlus `POST /cloudPhone/command`. Screen recording, file checks (`ls`, `cat`), and uploads all use this path. Optional local shortcut: set `DUOPLUS_ADB_ADDRS=dEW12=IP:PORT` so screenrecord can run via real adb when not on Vercel.

| Goal | Local adb | Cloud (Vercel) |
|---|---|---|
| Run shell | `adb shell "cmd"` | `duoCommand(phoneId, "cmd")` |
| UI dump (Maps app) | `adb shell uiautomator dump /sdcard/uidump.xml` | same command via `duoCommand`, then `cat` |
| UI dump (Chrome / dynamic) | use DuoPlus dashboard Execute Command | `duoCommand(phoneId, 'DuoPlusDumpUI')` — not `adb shell DuoPlusDumpUI` |

RPA stuck at `task_issued` means the collect webhook never fired — check Vercel logs for `/api/collect`, `PUBLIC_BASE_URL`, and the DuoPlus template webhook step. Screen recordings (`video_url` on each point) show what the phone was doing; UI dumps are for fixing selectors in the template, not wired into scans.

For manual DuoPlus imports (`duoplus_rpa_fixed_template.json`), use the `grid_webhook` default on `geo-grid-rose.vercel.app` and replace `PASTE_SCAN_TOKEN_FOR_MANUAL_TEST` with that scan's token from Supabase.

## Go live
1. Paste `supabase/geo_grid_v3.sql` into the ledger project's SQL Editor (idempotent; includes the
   full v1 schema plus the Chrome pack / raw-harvest / video columns and the Storage bucket the code needs).
2. Set env vars above → redeploy.
3. Open the app → enter ADMIN_KEY → Launch scan (defaults are the South Beach client).
4. Watch pins turn green on `/scan/<id>`.

Credits: scans cost 100 credits when LEDGER_ENABLED=true (rl_debit/rl_credit calls live in
`lib/core.js` — align the two rpc param names with rl_ledger_v1.sql, one-line edit).
Stripe packs: 500/$25 · 1000/$50 · 2000/$100 via `/api/checkout`; webhook credits the ledger.
