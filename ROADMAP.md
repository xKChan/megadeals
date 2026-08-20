# Mega Deals Canada — Roadmap & Recommendations

_Last updated 2026-08-20_

## Where things stand

Working pipeline: `scripts/syncDeals.js` pulls a product from Keepa (Amazon.ca), computes an all-time-low flag from Keepa's price history, generates a Link TW affiliate link, and upserts into the Supabase `deals` table. The React/Vite frontend reads live rows from Supabase and renders them. Both sides are running locally and syncing real data.

Right now the pipeline trusts Keepa's price as gospel. Keepa updates on a delay (it polls Amazon periodically, not instantly), so there's a real window where a "deal" has already expired, changed, or gone out of stock on Amazon by the time it lands on your site. That's the gap the Amazon Creators API closes.

## Important: PA-API is dead — you're already on the right track

Worth flagging clearly since it changes what's buildable: the old Amazon Product Advertising API (PA-API 5.0) was fully retired on **May 15, 2026**. It's been replaced by the **Amazon Creators API** — new OAuth 2.0 authentication, a new endpoint, restructured JSON. So "add the Creators API" isn't an optional nice-to-have sitting alongside PA-API, it's the *only* currently-working way to query Amazon directly for live price/availability by ASIN. Good that you already have access to it.

Access requires staying enrolled in Amazon Associates with **at least 10 qualifying sales in the trailing 30 days** (this doubled from PA-API's old 3-sale threshold) — worth keeping an eye on, since losing that threshold would cut off the verification step this whole plan leans on. The relevant operation is `GetItems`, which takes one or more ASINs and returns current offer listings (price, availability, Prime eligibility) alongside product attributes.

(Sources: [Amazon Creators API — PA-API deprecation notice](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation), [Creators API introduction](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction), [Creators API reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference))

## Recommended pipeline shape

```
1. DISCOVER  candidate ASINs (watchlist, Keepa Deals API, or a scraper)
2. ENRICH    Keepa product+stats -> price history, ATL flag, promo signals
3. VERIFY    Amazon Creators API GetItems(asin) -> live price + in-stock + Prime
4. RECONCILE compare Keepa price vs. Creators API price
             - match (within a few cents)  -> publish, use Creators API price as
               the displayed price (it's the one that's actually true right now)
             - mismatch / out of stock       -> do NOT publish; log and skip
             - Creators API call fails        -> don't publish blind; keep the
               last known-good row as-is rather than overwriting with stale data
5. PUBLISH   upsert to Supabase `deals`, set is_active accordingly
6. EXPIRE    a separate sweep flips is_active=false for deals not re-confirmed
             within N hours (stops showing deals nobody's re-checked recently)
```

Step 4 is the actual answer to "cross-reference before pushing" — Keepa tells you *something looks like a deal*, the Creators API confirms *it's still real right now*. Treat Keepa as the discovery/history signal and the Creators API as the source of truth for what gets displayed.

## Other things worth building in, roughly in priority order

**Compliance — do this early, not last.** The Amazon Associates Operating Agreement requires displayed prices to be accurate or clearly disclaimed. Since your site shows synced-from-Supabase prices rather than truly live ones, add a visible "price last verified: [timestamp]" badge on each deal card, and keep the sync interval tight enough that this stays honest. This is a real account-termination risk if skipped, not just a nice-to-have.

**Discovery at scale.** Right now ASINs are a hardcoded test array. Two realistic paths: (a) a `watchlist` table in Supabase you add ASINs to (simplest, fully manual), or (b) Keepa's Deals API, which returns bulk deal candidates matching filters (discount %, category, domain=6) instead of you tracking ASINs one at a time — this is what actually makes it "automated" rather than "a list I maintain by hand." ScrapeOps (from your original plan) is a fallback for sources Keepa doesn't cover well.

**Orchestration/scheduling.** The script works locally but nothing runs it on a timer yet. Options: n8n (fits your original plan, gives you a visual pipeline for steps 1–6 above without more code, and makes adding a second scraping source later just another node), a scheduled GitHub Actions workflow (simplest, free, good if you'd rather stay in code), or Supabase's built-in cron (pg_cron) calling an Edge Function. Worth deciding this before building much more — it shapes how the next few scripts get written.

**Sanity guardrails.** Amazon "glitch pricing" (a $5 laptop typo, essentially) happens and gets corrected within minutes — Keepa sometimes captures it as a fake "all-time low" for a moment. A floor check (e.g. reject anything showing more than ~85–90% off list price without a human glancing at it) avoids publishing something that embarrasses you when Amazon fixes the price five minutes later. The Creators API cross-check in step 4 already catches most of this, but a sanity cap is cheap insurance.

**Rate limits & token budgets.** Keepa charges tokens per request (product+offers+stats all cost tokens); the Creators API has its own rate limits tied to your Associates tier. As ASIN volume grows, batch requests where the API allows it (check whether `GetItems` accepts multiple ASINs per call) and add retry/backoff rather than hammering either API.

**Operational visibility.** A pipeline that silently breaks is worse than one that loudly breaks. A Slack/Discord webhook (or n8n's built-in error workflow) firing on sync failures means you find out same-day, not when a customer emails asking why a deal is dead.

**Housekeeping.** This folder isn't a git repo yet — worth `git init`-ing before wiring up GitHub Actions or anything CI-based. `.gitignore` already excludes `*.local`, so `.env.local` is safe once you do. Also worth a `--dry-run` flag on `syncDeals.js` so future changes can be tested without touching Supabase or burning a LinkTwin call.

## What I'd suggest doing first

Of everything above, the two with outsized leverage are the Amazon Creators API verification step (directly derisks "am I showing a real deal") and picking the orchestration approach (unblocks everything else being automated instead of manually triggered). Let me know which you want to tackle first and I'll build it out.
