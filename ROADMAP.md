# Mega Deals Canada — Roadmap & Recommendations

_Last updated 2026-08-20_

## Where things stand

`scripts/syncDeals.js` is a working pipeline: it discovers candidate deals via Keepa's Deals API (recent Amazon.ca price drops, no more hardcoded ASIN list), enriches each one with Keepa's price history and an all-time-low flag, cross-checks price/availability directly against Amazon via the Creators API, generates a Link TW affiliate link, and upserts into the Supabase `deals` table. The React/Vite frontend reads live rows from Supabase and renders them. All of this is running locally against real data.

## Done so far

**Amazon Creators API price verification (built 2026-08-20).** Every deal is confirmed directly against Amazon before it's published — Keepa updates on a delay, so this closes the window where a "deal" looks real in Keepa's data but has already expired or gone out of stock on Amazon. If Amazon has no listing or reports out-of-stock, the deal is skipped. When both sources have a price, Amazon's live price wins for what's actually displayed.

Worth knowing: the old Product Advertising API (PA-API 5.0) was fully retired May 15, 2026 — the Creators API is its mandatory replacement (OAuth 2.0, new endpoint). Access requires staying enrolled in Amazon Associates with at least 10 qualifying sales in the trailing 30 days — worth keeping an eye on, since losing that threshold cuts off this verification step. (Sources: [PA-API deprecation notice](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation), [Creators API introduction](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction))

**Discovery at scale via Keepa's Deals API (built 2026-08-20).** `discoverDealAsins()` asks Keepa directly for recent Amazon.ca price drops (`MIN_DEAL_DISCOUNT_PERCENT`, default 20%+) instead of you tracking ASINs by hand — this is confirmed against Keepa's own documentation, so it's on solid ground. `DEAL_DISCOVERY_LIMIT` (default 20) caps how many candidates get run through the full verification pipeline per sync — each one costs a Keepa product lookup + a Creators API call + a LinkTwin call, so this is a real cost knob, not just a display cap. No category/brand filtering is applied yet, so every Amazon.ca deal clearing the discount threshold is in scope.

## Current pipeline shape

```
1. DISCOVER  Keepa Deals API -> candidate ASINs (>= MIN_DEAL_DISCOUNT_PERCENT off)
2. ENRICH    Keepa product+stats -> price history, ATL flag, promo signals
3. VERIFY    Amazon Creators API GetItems(asin) -> live price + in-stock
4. RECONCILE live Amazon price wins for what's displayed; Keepa's is a
             fallback only if the Creators API price can't be parsed;
             no listing / out-of-stock -> skip, don't publish
5. PUBLISH   upsert to Supabase `deals`
```

Not yet built: a step 6 EXPIRE sweep that flips `is_active=false` for deals not re-confirmed within N hours (right now a deal published once stays `is_active: true` forever unless manually changed).

## Still open, roughly in priority order

**Compliance — do this before real visitors see the site.** The Amazon Associates Operating Agreement requires displayed prices to be accurate or clearly disclaimed. Since the site shows synced-from-Supabase prices rather than truly live ones, add a visible "price last verified: [timestamp]" badge on each deal card, and keep the sync interval tight enough that this stays honest. This is a real account-termination risk if skipped.

**Orchestration/scheduling.** The script works locally but nothing runs it on a timer yet. Options: n8n (fits the original plan, gives you a visual pipeline without more code, makes adding a second scraping source later just another node), a scheduled GitHub Actions workflow (simplest, free, stay-in-code), or Supabase's built-in cron (pg_cron) calling an Edge Function. This folder isn't a git repo yet, which blocks the GitHub Actions path specifically — `git init` first if that's the direction. `.gitignore` already excludes `*.local`, so `.env.local` is safe once you do.

**Sanity guardrails — discount floor done, glitch-pricing ceiling still open.** Fixed 2026-08-20: cheap/generic ASINs (a $1.20 pipe coupling, a $2.99 Ethernet cable) were clearing Keepa's raw discount-% discovery filter but had no tracked MSRP, so the site was showing them with a fake "0% off" badge (list price silently defaulted to the deal price). `buildDealPayload()` now derives a real reference price (tracked MSRP, or the highest price actually seen in the last 30 days) and independently re-verifies the discount against `MIN_DEAL_DISCOUNT_PERCENT` before publishing — anything that can't clear the bar with real data gets skipped, not published. Still open: the *other* direction — Amazon "glitch pricing" (a $5 laptop typo, essentially) happens and gets corrected within minutes; a ceiling check (e.g. flag anything showing more than ~85–90% off for a human glance instead of auto-publishing) is cheap insurance on top of the Creators API cross-check. Also still open: the two bad rows published before today's fix (LaSalle Bristol ABS coupling, Monoprice Ethernet cable) are sitting in Supabase with `is_active: true` and need a manual cleanup — there's no EXPIRE sweep yet to catch them automatically.

**Category/brand narrowing — done (2026-08-20).** Discovery now filters to a brand allowlist (`DEAL_BRAND_ALLOWLIST` in `.env.local`, seeded with ~35 well-known consumer brands), a minimum product rating (`MIN_DEAL_RATING_STARS`, default 3.5), excludes books, and requires a live Fulfilled-by-Amazon New offer — see `scripts/syncDeals.js`'s top comment and `isBookProduct()`/`hasLiveFbaNewOffer()` for how. Worth knowing: Amazon's Creators API has no fulfillment-channel field at all in its offersV2 response, so the FBA check reads Keepa's own per-offer data instead — Keepa is now the source of truth for that, not Amazon's API.

**Rate limits & token budgets.** Keepa charges tokens per request (the deals discovery call is 5 tokens per up to 150 results; product+offers+stats calls cost more per ASIN); the Creators API has its own rate limits tied to your Associates tier. `DEAL_DISCOVERY_LIMIT` already caps per-run volume — worth watching actual token consumption as you increase it.

**Operational visibility.** A pipeline that silently breaks is worse than one that loudly breaks. A Slack/Discord webhook (or n8n's built-in error workflow) firing on sync failures means you find out same-day, not when a customer emails asking why a deal is dead.

**Housekeeping.** A `--dry-run` flag on `syncDeals.js` so future changes can be tested without touching Supabase or burning a LinkTwin call.

## What I'd suggest doing next

Of what's left, orchestration/scheduling has the most leverage — it's what turns "a script I run by hand" into an actually-automated site, and it also decides whether `git init` needs to happen first (GitHub Actions) or not (n8n/Supabase cron). Compliance is the other one worth not leaving too long once real traffic shows up. Let me know which to tackle next.
