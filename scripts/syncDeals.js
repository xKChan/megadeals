/**
 * scripts/syncDeals.js
 *
 * Mega Deals Canada — backend ingestion pipeline.
 * Discovers candidate deals via Keepa's Deals API (recent price drops on
 * Amazon.ca, domain=6) instead of a hardcoded ASIN list. For each candidate:
 * queries Keepa's product endpoint for pricing/price-history and computes
 * the All-Time-Low flag, then cross-checks that price/availability directly
 * against Amazon via the Creators API before publishing anything — Keepa
 * polls on a delay, so a "deal" can look real in Keepa's data and already
 * be gone/changed on Amazon by the time this runs. Only ASINs that verify
 * get a Link TW affiliate deep link generated and upserted into the
 * Supabase `deals` table (onConflict: 'asin').
 *
 * Run with:  node scripts/syncDeals.js   (or `npm run sync-deals`)
 *
 * ── Keepa Deals API notes ─────────────────────────────────────────────────
 * discoverDealAsins() hits GET https://api.keepa.com/deal with a JSON
 * "selection" object as a query param — confirmed against Keepa's own docs
 * (https://keepa.com/api-docs/deals.html), including the response shape
 * (deals.dr is the array). Tunable via env vars without touching code:
 * MIN_DEAL_DISCOUNT_PERCENT (default 40 — this site's actual bar for what
 * counts as "a deal"), DEAL_DISCOVERY_LIMIT (default 20,
 * caps how many candidates get run through the full per-ASIN pipeline in
 * one call), MIN_DEAL_RATING_STARS (default 3.5), and DEAL_BRAND_ALLOWLIST
 * (comma-separated brand names, empty/off by default as of 2026-08-22 —
 * see DEFAULT_DEAL_BRAND_ALLOWLIST for the
 * starter list). Books/DVDs are excluded and FBA is verified downstream in
 * buildDealPayload() from real per-offer Keepa data, not at discovery time
 * — see getExcludedCategoryLabel() / hasLiveFbaNewOffer() below for why.
 *
 * ── Variant family expansion (added 2026-08-21, rewritten same day) ──────
 * Amazon color/size variants of one physical product are separate ASINs, so
 * discovery can surface several "deals" that are really the same item — and
 * separately, Keepa's discovery endpoints (both /deal and Product Finder)
 * disproportionately surface the parent/family ASIN itself rather than a
 * buyable child (confirmed live: runs where 17/20, 30/71, even 69/69 raw
 * candidates were parent records). The first version of this fix just
 * rejected parent ASINs outright — correct (a parent has no single price
 * and no buyable /dp/ page, which is what caused a real "View Deal" link to
 * land on a size-less "choose your options" page instead of the specific
 * variant shown on the card), but wasteful: it threw away every family
 * Keepa found instead of asking "does *any* size/colour in this family
 * actually qualify as a deal?" — which is usually yes.
 *
 * dedupeAsinsByVariantFamily() now does that instead: when a raw candidate
 * is a true parent ASIN, its `variations` list (free — Keepa returns it on
 * any fetch of the parent, no extra call) becomes a new batch of child
 * candidates, each price-checked up to MAX_VARIANTS_TO_CHECK_PER_FAMILY.
 * Every child that clears the full buildDealPayload() pipeline (discount
 * floor, live FBA offer, Creators API cross-check, etc. — unchanged, each
 * variant goes through the exact same per-ASIN verification a standalone
 * deal would) gets published as its OWN row, tagged with a shared
 * `parent_asin` column so the frontend can group same-family rows onto one
 * card (e.g. "Size 3" and "Size 4" both available, "Size 5" omitted because
 * it didn't clear MIN_DEAL_DISCOUNT_PERCENT) and a `variant_attributes`
 * jsonb column (Keepa's own dimension/value pairs, e.g. [{"dimension":
 * "Size","value":"4"}]) for the human-readable label. Both columns are
 * nullable and omitted from the payload entirely for a standalone
 * (non-family) deal or during the EXPIRE sweep's re-verify pass (which
 * doesn't re-resolve family context) — Supabase upsert only touches columns
 * present in the payload, so omitting them preserves whatever was already
 * stored rather than wiping it to null. Requires two new nullable columns
 * on `deals` (parent_asin text, variant_attributes jsonb) — see the
 * migration note in ROADMAP.md. This is a discovery-time fix;
 * already-published duplicate rows aren't retroactively touched or merged.
 *
 * ── EXPIRE sweep (added 2026-08-21) ───────────────────────────────────────
 * A published deal used to stay is_active: true forever, since discovery
 * only ever surfaces NEW/recently-dropped candidates. Every run now ends
 * with refreshStaleActiveDeals() (actively re-verifies the stalest existing
 * active rows through the full pipeline) and expireStaleDeals() (a cheap
 * safety-net cutoff). Requires the last_verified_at column — see that
 * section's own doc comment above main() for the full design/cost notes.
 *
 * ── Discovery mode (added 2026-08-21) ────────────────────────────────────
 * DISCOVERY_MODE env var picks the discovery source: "deals" (default,
 * discoverDealAsins — Keepa's day-over-day price-drop feed) or "finder"
 * (discoverDealAsinsViaProductFinder — Keepa's broader /query endpoint,
 * filtered by category/sales-rank/rating/review-count/90-day price trend).
 * Both functions live in this file regardless of which is active, so trying
 * "finder" and going back to "deals" is a one-line .env.local edit — no code
 * changes, no lost work either way. See discoverDealAsinsViaProductFinder()
 * for field-by-field notes. Category scoping uses an EXCLUDE list
 * (PRODUCT_FINDER_EXCLUDED_CATEGORY_IDS — digital/media categories only,
 * confirmed 2026-08-21 against a live Amazon.ca category lookup) rather than
 * an include list — an earlier include-list attempt used wrong IDs and
 * silently searched only "Sports & Outdoors" instead of the intended
 * Electronics/Kitchen/Tools/Smart Home.
 *
 * ── Amazon Creators API notes ────────────────────────────────────────────
 * PA-API 5.0 was retired 2026-05-15; the Creators API is its replacement.
 * Uses the `amazon-creators-api` SDK (wraps Amazon's official client, OAuth
 * handled internally from AMAZON_CREDENTIAL_ID / AMAZON_CREDENTIAL_SECRET /
 * AMAZON_CREDENTIAL_VERSION — no raw token endpoint to configure). Built
 * against the SDK's documented usage — there's no live Creators API account
 * to test against in this environment, so treat the GetItems response
 * *parsing* (extractCreatorsApiPriceCents / extractCreatorsApiInStock) as
 * "should be right" rather than confirmed. If a live run logs a "couldn't
 * parse" warning with a raw payload dump, paste that back — the parsing
 * can be tightened immediately against real response data, same as
 * happened with Keepa.
 *
 * ── Env var notes ──────────────────────────────────────────────────────────
 * This project's env file is `.env.local` (not `.env`), so it's loaded
 * explicitly below rather than relying on dotenv's default filename.
 *
 * Supabase's dashboard has moved through a couple of key-naming schemes:
 * legacy "anon key" / "service_role key" (JWTs), then "publishable key" /
 * "secret key" (sb_publishable_... / sb_secret_...). This project's
 * `.env.local` currently holds a secret key as VITE_SUPABASE_SECRET_KEY —
 * that's actually the right choice for a backend write script like this one
 * (it bypasses Row Level Security the way a service-role key used to), so
 * it's preferred first. The script also falls back to
 * VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY in case the env
 * file ever reverts to a client-safe key — note a publishable/anon key is
 * subject to RLS and may cause the upsert to fail with a permissions error.
 * NEVER expose the secret key to frontend code.
 * ────────────────────────────────────────────────────────────────────────── */

import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApiClient as CreatorsApiClient,
  GetItemsRequestContent,
  GetItemsResource,
  TypedDefaultApi as CreatorsApiDefaultApi,
} from "amazon-creators-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const {
  KEEPA_API_KEY,
  AMAZON_AFFILIATE_TAG,
  LINKTWIN_API_KEY,
  VITE_SUPABASE_URL,
  VITE_SUPABASE_SECRET_KEY,
  VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_SUPABASE_ANON_KEY,
  AMAZON_CREDENTIAL_ID,
  AMAZON_CREDENTIAL_SECRET,
  AMAZON_CREDENTIAL_VERSION,
  AMAZON_MARKETPLACE,
} = process.env;

// Prefer the secret key (bypasses RLS, correct for a backend script) and
// fall back to whatever client-safe key is present.
const SUPABASE_KEY =
  VITE_SUPABASE_SECRET_KEY ||
  VITE_SUPABASE_PUBLISHABLE_KEY ||
  VITE_SUPABASE_ANON_KEY;

function requireEnv() {
  const missing = [
    ["KEEPA_API_KEY", KEEPA_API_KEY],
    ["AMAZON_AFFILIATE_TAG", AMAZON_AFFILIATE_TAG],
    ["LINKTWIN_API_KEY", LINKTWIN_API_KEY],
    ["VITE_SUPABASE_URL", VITE_SUPABASE_URL],
    [
      "VITE_SUPABASE_SECRET_KEY / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY",
      SUPABASE_KEY,
    ],
    ["AMAZON_CREDENTIAL_ID", AMAZON_CREDENTIAL_ID],
    ["AMAZON_CREDENTIAL_SECRET", AMAZON_CREDENTIAL_SECRET],
    ["AMAZON_CREDENTIAL_VERSION", AMAZON_CREDENTIAL_VERSION],
    ["AMAZON_MARKETPLACE", AMAZON_MARKETPLACE],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    console.error("Missing required env vars in .env.local:");
    missing.forEach(([name]) => console.error(`  - ${name}`));
    process.exit(1);
  }
}

requireEnv();

const supabase = createClient(VITE_SUPABASE_URL, SUPABASE_KEY);

// ── Keepa constants ─────────────────────────────────────────────────────────
const KEEPA_DOMAIN_CA = 6; // Amazon.ca
const KEEPA_PRODUCT_URL = "https://api.keepa.com/product";
const KEEPA_DEAL_URL = "https://api.keepa.com/deal";
const KEEPA_QUERY_URL = "https://api.keepa.com/query"; // Product Finder

// Added 2026-08-22: none of this file's axios calls had a `timeout` set,
// which means axios' default applies — no timeout at all. Fine for a
// handful of candidates, but a real problem once discovery routinely
// returns hundreds (opening up the brand allowlist took one run from 12
// candidates to 413) — dedupeAsinsByVariantFamily() fetches each candidate
// one at a time in a sequential loop, so a single Keepa request that hangs
// (rather than erroring) blocks every candidate behind it and can stall an
// entire run past the workflow's 20-minute job timeout, publishing nothing
// even though hundreds of real candidates were sitting there. Every Keepa/
// LinkTwin axios call below now passes this timeout; the existing per-ASIN
// try/catch around each call site turns a timed-out request into a logged
// warning and a move to the next candidate, instead of a silent full stall.
const KEEPA_REQUEST_TIMEOUT_MS = Number(process.env.KEEPA_REQUEST_TIMEOUT_MS) || 20000;

// Added 2026-08-22: the flat 1200ms sleep between every Keepa call (below,
// throughout this file) was calibrated for a plan with a much higher token
// rate than this account actually has. Checked directly against the
// account's own Keepa dashboard: 20 tokens/minute, 1200 token bucket cap.
// Checked against Keepa's own docs (keepa.com/api-docs/): a /product call
// costs 1 token per ASIN, plus 6 tokens per "offer page" of up to 10
// offers when `offers` is requested — this script asks for `offers: 20`
// (2 pages), so a full fetch (offers+stats) costs roughly 1 + 6*2 = 13
// tokens; the cheap fetch (no offers/stats) costs the base 1 token. NOTE:
// Keepa's docs don't spell out whether `stats` itself adds further cost on
// top of that — 13 is treated as a floor, not a confirmed exact number,
// which is why KEEPA_FULL_FETCH_TOKEN_COST below is deliberately
// overridable and the values include a safety margin rather than pacing
// to the exact minimum. A flat 1.2s pause implies a ~50 requests/minute
// budget — at 1 token/request that's already over 2x this account's 20/min
// rate, and at 13 tokens/request (every full fetch) it's roughly 30x over
// budget, which is the real reason runs were hitting 429 almost
// immediately rather than any bug in the retry/timeout logic itself.
// keepaPaceDelayMs() paces each call to what the account can actually
// sustain rather than an arbitrary fixed number, so a run trades speed for
// not getting rate-limited, instead of both being slow AND rate-limited.
const KEEPA_TOKENS_PER_MINUTE = Number(process.env.KEEPA_TOKENS_PER_MINUTE) || 20;
const KEEPA_CHEAP_FETCH_TOKEN_COST = Number(process.env.KEEPA_CHEAP_FETCH_TOKEN_COST) || 1;
const KEEPA_FULL_FETCH_TOKEN_COST = Number(process.env.KEEPA_FULL_FETCH_TOKEN_COST) || 13;

function keepaPaceDelayMs(tokenCost) {
  return Math.ceil((tokenCost / KEEPA_TOKENS_PER_MINUTE) * 60000);
}

// Keepa csv/stats.current array indices relevant to this script.
// (Full reference: https://keepa.com/#!discuss/t/product-object/116)
const CSV_TYPE = {
  AMAZON: 0, // Amazon-fulfilled price history
  NEW: 1, // 3rd-party "New" price history
  LISTPRICE: 4, // Manufacturer list price history
  RATING: 16, // Product rating history (Keepa stores this as rating*10)
  COUNT_REVIEWS: 17, // Review count history
};

// Keepa Deals API ("selection" request) enums — confirmed against Keepa's
// own docs at https://keepa.com/api-docs/deals.html.
const KEEPA_PRICE_TYPE = { AMAZON: 0, NEW: 1 };
const KEEPA_DATE_RANGE = { DAY: 0, WEEK: 1, MONTH: 2, NINETY_DAYS: 3 };
const KEEPA_SORT_TYPE = {
  DEAL_AGE: 1,
  ABSOLUTE_DELTA: 2,
  SALES_RANK: 3,
  PERCENT_DELTA: 4,
};

// Tunable without touching code — how big a discount counts as "a deal",
// and how many discovered ASINs to actually process in one run (each one
// costs a Keepa product lookup + a Creators API call + a LinkTwin call).
// Bumped 20 -> 40 (2026-08-21): the site's actual goal, per the user, is
// "40% OFF or more" — 20 was an early placeholder that never matched that.
// Still fully overridable via MIN_DEAL_DISCOUNT_PERCENT without a code edit.
const MIN_DEAL_DISCOUNT_PERCENT = Number(process.env.MIN_DEAL_DISCOUNT_PERCENT) || 40;
const DEAL_DISCOVERY_LIMIT = Number(process.env.DEAL_DISCOVERY_LIMIT) || 20;

// How many RAW candidates to pull from Keepa before variant-dedup/parent-
// ASIN filtering, as opposed to DEAL_DISCOVERY_LIMIT (the final count that
// actually gets the costly Creators API + LinkTwin treatment). These used
// to be the same cap, which meant a parent-ASIN-heavy raw feed could starve
// a run down to almost nothing — confirmed live 2026-08-21: 17 of 20 raw
// candidates were parent ASINs (one had 727 variations), leaving only 3
// real products, one of which then got excluded as a DVD. Pulling a wider
// raw pool up front and filtering BEFORE the final slice fixes that.
// Tunable — a bigger multiplier means more Keepa /product token spend per
// run (dedupeAsinsByVariantFamily fetches every raw candidate to check
// isParentAsin), so dial it back if Keepa's rate limits start complaining.
const DEAL_DISCOVERY_RAW_POOL =
  Number(process.env.DEAL_DISCOVERY_RAW_POOL) || DEAL_DISCOVERY_LIMIT * 4;

// How many sibling ASINs to price-check when a discovered candidate turns
// out to be a parent/family ASIN (added 2026-08-21 — see the "Variant
// family expansion" doc section above main() for the full design). A
// family can have anywhere from 2 to 900+ variations (both seen live), and
// each one checked costs a full Keepa /product (offers+stats) fetch, so
// this caps the worst case rather than checking all of them. Tunable —
// raise it to surface more simultaneously-qualifying size/colour options
// per family at the cost of more Keepa spend on families that turn out to
// have only one or two real deals buried in a big variation list.
const MAX_VARIANTS_TO_CHECK_PER_FAMILY =
  Number(process.env.MAX_VARIANTS_TO_CHECK_PER_FAMILY) || 25;

// Minimum product star rating (0-5). Keepa's own `minRating` selection field
// uses a 0-50 integer scale (45 = 4.5 stars, confirmed against Keepa's docs
// at https://keepa.com/api-docs/deals.html), so this converts once here.
const MIN_DEAL_RATING_STARS = Number(process.env.MIN_DEAL_RATING_STARS) || 3.5;
const MIN_DEAL_RATING_KEEPA_SCALE = Math.round(MIN_DEAL_RATING_STARS * 10);

// "Popular brand" allowlist — OFF by default (removed 2026-08-22, user
// request: the ~35-brand starter list below, combined with the discount/
// rating/review-count/sales-rank filters, was narrowing the already-small
// Product Finder candidate pool too far — e.g. one run matched only 12
// total products across all of Amazon.ca once MIN_DEAL_REVIEW_COUNT was
// also raised to 500). Set DEAL_BRAND_ALLOWLIST (comma-separated, in
// .env.local or as a repo Variable) any time you want to bring brand
// restriction back — no code change needed either way. Keepa's `brand`
// selection field ("Include only products from the specified brand", array
// of strings, per Keepa's docs) filters discovery results server-side,
// before any product/Creators-API/LinkTwin call is spent on a candidate.
// Brand matching against Keepa's tracked brand string hasn't been confirmed
// against a live run yet — if a brand you expect to see never turns up, it
// may need exact-casing/spelling to match what Keepa/Amazon has on file for
// that ASIN.
const DEFAULT_DEAL_BRAND_ALLOWLIST = "";
// Sample starter list, kept here for reference / easy copy-paste back into
// DEFAULT_DEAL_BRAND_ALLOWLIST above (or DEAL_BRAND_ALLOWLIST in .env.local)
// if brand restriction is ever wanted again:
// "Sony,Samsung,Apple,Anker,Bose,JBL,Logitech,LEGO,Philips,Panasonic,Dyson,
//  KitchenAid,Instant Pot,Ninja,Shark,Keurig,Black+Decker,Cuisinart,Hasbro,
//  Mattel,Nike,Adidas,Under Armour,Crocs,Levi's,Nintendo,Microsoft,Google,
//  Fitbit,Garmin,Bissell,Braun,Oral-B,Gillette,L'Oréal,Nivea"
//
// Uses `!== undefined` rather than `||` so an explicitly-empty override (a
// repo Variable set to "") is respected as "no brands" rather than falling
// back to the default — `"" || DEFAULT` would silently re-apply whatever
// DEFAULT_DEAL_BRAND_ALLOWLIST is, which isn't what "I set it to nothing"
// should mean.
const DEAL_BRAND_ALLOWLIST = (
  process.env.DEAL_BRAND_ALLOWLIST !== undefined
    ? process.env.DEAL_BRAND_ALLOWLIST
    : DEFAULT_DEAL_BRAND_ALLOWLIST
)
  .split(",")
  .map((b) => b.trim())
  .filter(Boolean);

// Discovery: ask Keepa for recent price drops instead of tracking ASINs by
// hand. Returns a list of candidate ASINs — each one still goes through the
// full buildDealPayload() pipeline (Keepa product lookup, Creators API
// verification, book/FBA gates below) before anything is published, so a
// bad discovery result can't skip the verification gate.
async function discoverDealAsins() {
  const selection = {
    page: 0,
    domainId: KEEPA_DOMAIN_CA,
    // Keepa rejects a multi-value priceTypes array ("queryJSON is of
    // invalid format") — it wants a single price type per deals query, not
    // a list. AMAZON (Amazon-as-seller price) is the most relevant one for
    // "is this actually a deal on Amazon.ca".
    priceTypes: [KEEPA_PRICE_TYPE.AMAZON],
    dateRange: KEEPA_DATE_RANGE.DAY,
    isRangeEnabled: true,
    deltaPercentRange: [MIN_DEAL_DISCOUNT_PERCENT, 100],
    isFilterEnabled: true,
    hasReviews: true,
    minRating: MIN_DEAL_RATING_KEEPA_SCALE,
    sortType: KEEPA_SORT_TYPE.PERCENT_DELTA,
    // Brand filtering only applied when the allowlist is non-empty — an
    // empty DEAL_BRAND_ALLOWLIST env var means "no brand restriction".
    ...(DEAL_BRAND_ALLOWLIST.length > 0 ? { brand: DEAL_BRAND_ALLOWLIST } : {}),
    // Books are excluded downstream in buildDealPayload() via a category
    // keyword check, not here — Keepa's excludeCategories field needs
    // per-marketplace numeric category IDs that haven't been looked up for
    // Amazon.ca, and FBA is verified downstream too, from real per-offer
    // data (see hasLiveFbaNewOffer below) rather than Keepa's
    // mustHaveAmazonOffer, which only covers Amazon-sold-and-fulfilled —
    // narrower than "any FBA offer regardless of seller".
  };

  // This call must never crash the whole process — a Keepa rejection or
  // outage here should fall back to FALLBACK_ASINS in main(), the same way
  // syncDeal() swallows per-ASIN errors instead of taking down the batch.
  try {
    const { data } = await axios.get(KEEPA_DEAL_URL, {
      params: { key: KEEPA_API_KEY, selection: JSON.stringify(selection) },
      timeout: KEEPA_REQUEST_TIMEOUT_MS,
    });

    const deals = data?.deals?.dr;
    if (!Array.isArray(deals)) {
      console.warn(
        `  ! Keepa Deals API response didn't have the expected deals.dr array. ` +
          `Raw top-level keys: ${Object.keys(data ?? {}).join(", ")}`
      );
      return [];
    }

    return deals
      .map((deal) => deal.asin)
      .filter(Boolean)
      .slice(0, DEAL_DISCOVERY_RAW_POOL);
  } catch (err) {
    console.warn(
      `  ! Keepa Deals API request failed: ` +
        (err.response?.data ? JSON.stringify(err.response.data) : err.message)
    );
    return [];
  }
}

// ── Alternate discovery: Keepa Product Finder (/query) ─────────────────────
// A second, swappable discovery source — see DISCOVERY_MODE below for how to
// pick between this and discoverDealAsins() above without deleting either.
// Confirmed against Keepa's own docs (https://keepa.com/api-docs/product-
// finder.html): unlike /deal, the JSON "selection" object here does NOT
// include domain — domain is a separate top-level query param — and the
// response is a flat { asinList: [...], totalResults } rather than deals.dr.
//
// Category scoping — CONFIRMED 2026-08-21 against a live lookup of Amazon.ca's
// real root categories (GET https://api.keepa.com/category?domain=6&category=0,
// run by the user with their own key). That live data caught a real bug: the
// original 4 "include" category IDs from the other AI's suggestion were
// wrong for Amazon.ca — only one (2242989011) was even a valid category on
// this marketplace, and it's actually "Sports & Outdoors", not "Electronics"
// as claimed (the other three matched nothing at all). That's why finder
// mode was only ever returning adidas gear: it was quietly searching Sports
// & Outdoors alone. Switched approach entirely per the user's follow-up
// request — instead of guessing at which categories to include, EXCLUDE the
// ones that are obviously wrong for a physical-product deals site (digital
// goods, media, subscriptions) and allow everything else. `categories_exclude`
// is a real Keepa Product Finder field (confirmed earlier); no `rootCategory`
// include-filter is set, so the whole Amazon.ca catalog is in scope minus
// these. Override via PRODUCT_FINDER_EXCLUDED_CATEGORY_IDS (comma-separated)
// in .env.local — defaults to the user-confirmed real IDs for: Alexa Skills,
// Amazon Appstore, Audible Books & Originals, Books, Kindle Store, Movies &
// TV, Music, Prime Video, Software, and (added 2026-08-21) Clothing, Shoes &
// Accessories (21204935011) — cross-referenced against multiple live
// amazon.ca search-result URLs (n:21204935011 appears consistently across
// many searches filtered by brand/size/style under that department, not
// just one page), same verify-before-trusting standard as the other IDs
// here. Clothing was added because apparel variation families are enormous
// by nature (a shirt in every size x every colour is easily 100-1200+
// variations — confirmed live: families with 727, 905, 979, and 1204
// variations all showed up in one finder-mode run, eating most of
// MAX_VARIANTS_TO_CHECK_PER_FAMILY on a department this site was never
// trying to feature to begin with).
const PRODUCT_FINDER_EXCLUDED_CATEGORIES = (
  process.env.PRODUCT_FINDER_EXCLUDED_CATEGORY_IDS ||
  "16286269011,6386371011,20037537011,916520,2972705011,917972,916514,18730296011,3198021,21204935011"
)
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => Number.isFinite(id));

const MIN_DEAL_REVIEW_COUNT = Number(process.env.MIN_DEAL_REVIEW_COUNT) || 100;

// Best Sellers Rank ceiling — a low-BSR requirement so a big discount can't
// alone qualify a product nobody actually buys. Keepa's `current_SALES_lte`
// filter is an ABSOLUTE rank number, not a percentile — Keepa's API has no
// "top N% of category" filter to ask for directly, so a true "top 1-5% of
// category" requirement isn't something this request can express exactly.
// The practical effect: the same ceiling is stricter in a small category
// than a huge one (e.g. 30000 is a demanding bar in "Smart Home" but a
// looser one in all of "Electronics"). Tunable via PRODUCT_FINDER_MAX_SALES_
// RANK rather than hardcoded so it's easy to tighten per-category by trial
// once you see what's actually coming through.
const PRODUCT_FINDER_MAX_SALES_RANK = Number(process.env.PRODUCT_FINDER_MAX_SALES_RANK) || 30000;

async function discoverDealAsinsViaProductFinder() {
  const selection = {
    // Confirmed 2026-08-21 against Keepa's own Product Finder docs
    // (keepa.com/api-docs/product-finder.html): productType 5 =
    // VARIATION_PARENT ("product is a parent ASIN. Only sales rank and
    // variations is set."). A parent ASIN still has a sales rank (and,
    // per Amazon's shared-review behavior across variations, often a
    // rating too) even though it has no single price and isn't buyable —
    // which is exactly why the sales-rank/rating/review-count filters
    // below match so many of them.
    //
    // productType: 0 (STANDARD) is left in as a best-effort, zero-cost
    // hint — the field name/type is doc-correct (a plain Integer per
    // Keepa's schema table, confirmed against their docs; an earlier
    // version wrongly sent `productType: [0]` as an array). BUT: even with
    // the correct shape, this filter does NOT reliably keep
    // VARIATION_PARENT records out of the results — confirmed live
    // 2026-08-21 across two separate runs *after* deploying the
    // doc-correct version, one showing 69/69 and another ~30/71 raw
    // candidates still being true parent ASINs. Keepa's docs never
    // explicitly promise this filter is enforced server-side, and in
    // practice it isn't (or isn't reliably). Do not treat this field as a
    // real guarantee — it may do nothing.
    //
    // Because of that, the actual fix for wasted API spend lives in
    // fetchKeepaProduct()/dedupeAsinsByVariantFamily(): every candidate
    // gets a cheap parent-check fetch (no offers/stats) before any
    // candidate pays for the expensive full fetch, so a Product-Finder
    // response that's mostly parents no longer burns full-price Keepa
    // calls rejecting them. The runtime isParentAsin() check remains the
    // one thing actually verified to work, and is the only guard at all
    // for DISCOVERY_MODE=deals (no Product Finder-style field exists
    // there to filter server-side either way).
    productType: 0,
    ...(PRODUCT_FINDER_EXCLUDED_CATEGORIES.length > 0
      ? { categories_exclude: PRODUCT_FINDER_EXCLUDED_CATEGORIES }
      : {}),
    current_SALES_gte: 1,
    current_SALES_lte: PRODUCT_FINDER_MAX_SALES_RANK,
    // "Percent change from average" over the trailing 90 days — positive
    // means the current price is that much BELOW its own 90-day average, a
    // sustained-discount signal rather than /deal's single-day price-drop
    // event. Reuses the same MIN_DEAL_DISCOUNT_PERCENT tunable as the /deal
    // path so there's one discount threshold, not two to keep in sync.
    deltaPercent90_AMAZON_gte: MIN_DEAL_DISCOUNT_PERCENT,
    current_RATING_gte: MIN_DEAL_RATING_KEEPA_SCALE,
    current_COUNT_REVIEWS_gte: MIN_DEAL_REVIEW_COUNT,
    hasReviews: true,
    ...(DEAL_BRAND_ALLOWLIST.length > 0 ? { brand: DEAL_BRAND_ALLOWLIST } : {}),
    page: 0,
    perPage: Math.max(DEAL_DISCOVERY_RAW_POOL, 50),
    // categories_exclude above covers digital/media categories (books, movies,
    // music, etc. — see PRODUCT_FINDER_EXCLUDED_CATEGORIES). It doesn't cover
    // DVDs specifically (Movies & TV is a media category but Amazon files
    // physical DVDs there too, alongside digital video — excluding the whole
    // category is intentional and correct here). Every candidate this returns
    // still passes through buildDealPayload()'s excluded-category and FBA
    // checks (Keepa /product data) as a second, independent layer — nothing
    // skips those gates regardless of what discovery already filtered out.
  };

  try {
    const { data } = await axios.get(KEEPA_QUERY_URL, {
      params: { key: KEEPA_API_KEY, domain: KEEPA_DOMAIN_CA, selection: JSON.stringify(selection) },
      timeout: KEEPA_REQUEST_TIMEOUT_MS,
    });

    const asinList = data?.asinList;
    if (!Array.isArray(asinList)) {
      console.warn(
        `  ! Keepa Product Finder response didn't have the expected asinList array. ` +
          `Raw top-level keys: ${Object.keys(data ?? {}).join(", ")}`
      );
      return [];
    }

    console.log(
      `  Product Finder matched ${data.totalResults ?? asinList.length} total product(s) before capping.`
    );
    return asinList.slice(0, DEAL_DISCOVERY_RAW_POOL);
  } catch (err) {
    console.warn(
      `  ! Keepa Product Finder request failed: ` +
        (err.response?.data ? JSON.stringify(err.response.data) : err.message)
    );
    return [];
  }
}

// Which discovery source main() uses — "deals" (default, discoverDealAsins,
// Keepa's day-over-day price-drop feed) or "finder" (discoverDealAsinsVia
// ProductFinder, Keepa's broader filtered search). Both functions stay in
// the file either way, so switching back is a one-line .env.local edit, not
// a code change or a git operation.
const DISCOVERY_MODE = (process.env.DISCOVERY_MODE || "deals").toLowerCase();

// ── EXPIRE sweep (added 2026-08-21) ─────────────────────────────────────────
// Discovery only ever looks at NEW/recently-dropped candidates — a deal that
// was legitimately published can go stale (price crept back up, went out of
// stock, coupon expired) without ever showing up in a future discovery batch
// again, since Keepa's feeds surface drop EVENTS, not "still on sale" status.
// Left alone, a deal published once stays is_active: true forever. Two-part
// fix, both run at the end of every sync:
//   1. refreshStaleActiveDeals() actively re-checks the N stalest currently-
//      active rows (oldest last_verified_at first) through the exact same
//      verification pipeline as a new candidate — still discounted enough,
//      still in stock, still passes every gate? If yes, it's re-upserted
//      with a fresh last_verified_at. If it throws for any reason, it's
//      deactivated immediately rather than left silently stale.
//   2. expireStaleDeals() is a cheap safety net (no API calls, one Supabase
//      update) that deactivates anything not touched — by discovery OR the
//      refresh pass — within EXPIRE_STALE_HOURS, catching edge cases (an
//      ASIN delisted from Keepa entirely, repeated transient errors, etc.).
// Cost note: refreshStaleActiveDeals() runs full buildDealPayload() per row,
// including a NEW LinkTwin generateDeepLink() call each time — this is real
// added API cost per run (Keepa + Creators API + LinkTwin), same trade-off
// as DEAL_DISCOVERY_RAW_POOL above. Keep EXPIRE_REVERIFY_BATCH_SIZE modest.
// Tune the two together: if the active-deal count grows faster than
// EXPIRE_REVERIFY_BATCH_SIZE can cycle through it within EXPIRE_STALE_HOURS,
// the safety net will start expiring deals that were simply still waiting
// in the refresh queue, not actually bad — widen the batch size or the
// stale-hours window (or both) if that starts happening.
const EXPIRE_REVERIFY_BATCH_SIZE = Number(process.env.EXPIRE_REVERIFY_BATCH_SIZE) || 10;
const EXPIRE_STALE_HOURS = Number(process.env.EXPIRE_STALE_HOURS) || 48;

// `full: false` (default true) skips the `offers`/`stats` params — those are
// the token-expensive parts of a Keepa /product call. `parentAsin` and
// `variations` (what isParentAsin() checks) are core fields Keepa always
// returns regardless, at no extra cost. This split exists because Keepa's
// own Product Finder `productType` selection filter (documented as a plain
// Integer, values 0=STANDARD/5=VARIATION_PARENT — verified against their
// docs table, so this isn't a param-shape bug) does NOT reliably keep
// VARIATION_PARENT records out of the results in practice: confirmed live
// 2026-08-21 across two separate runs (both after the filter was deployed)
// that ~90-100% of raw Product Finder candidates were still true parent
// ASINs. Rather than keep trusting a third-party filter that isn't behaving
// as documented, the cheap call below lets every candidate get checked for
// real before paying for the expensive one — so a flood of parent ASINs
// (which used to each burn a full offers+stats fetch just to be rejected)
// now only costs the cheap call, no matter how badly Product Finder's
// server-side filtering performs.
async function fetchKeepaProduct(asin, { full = true } = {}) {
  const { data } = await axios.get(KEEPA_PRODUCT_URL, {
    params: {
      key: KEEPA_API_KEY,
      domain: KEEPA_DOMAIN_CA,
      asin,
      ...(full
        ? {
            offers: 20,
            // Keepa only computes/returns `product.stats` (current price,
            // list price, rating, review count — everything
            // getCurrentPriceCents(), getListPriceCents(), getRating(), and
            // getRatingCount() read) when a `stats` window is explicitly
            // requested. Omitting it is why deal_price/list_price/rating
            // all came back null on the first live run. 180 = compute
            // stats over the trailing 180 days.
            stats: 180,
          }
        : {}),
    },
    timeout: KEEPA_REQUEST_TIMEOUT_MS,
  });

  const product = data?.products?.[0];
  if (!product) {
    throw new Error(`Keepa returned no product data for ASIN ${asin}`);
  }
  return product;
}

// Added 2026-08-22: wraps fetchKeepaProduct() with one retry on a 429
// ("Too Many Requests" — this account is out of tokens or over Keepa's
// rate limit right now, not a bad ASIN or a network blip). A transient
// 429 can clear itself in a few seconds; a sustained one (e.g. the token
// bucket is genuinely empty, or two runs are hitting the same API key at
// once) won't, so after one cooldown+retry this throws with
// `isKeepaRateLimit: true` set on the error rather than retrying forever —
// callers (dedupeAsinsByVariantFamily()'s Pass 1/Pass 3 loops) use that
// flag to stop checking further candidates for the rest of this run
// instead of burning through the remaining pool as guaranteed-fail 429s.
const KEEPA_RATE_LIMIT_COOLDOWN_MS = Number(process.env.KEEPA_RATE_LIMIT_COOLDOWN_MS) || 15000;

async function fetchKeepaProductWithRateLimitRetry(asin, options) {
  try {
    return await fetchKeepaProduct(asin, options);
  } catch (err) {
    if (err.response?.status !== 429) throw err;
    console.warn(
      `  ! Keepa returned 429 for ${asin} — waiting ${KEEPA_RATE_LIMIT_COOLDOWN_MS / 1000}s and retrying once...`
    );
    await sleep(KEEPA_RATE_LIMIT_COOLDOWN_MS);
    try {
      return await fetchKeepaProduct(asin, options);
    } catch (retryErr) {
      if (retryErr.response?.status === 429) {
        retryErr.isKeepaRateLimit = true;
      }
      throw retryErr;
    }
  }
}

// ── Price helpers ───────────────────────────────────────────────────────────
// Keepa prices are in cents; -1 means "no data" and must be ignored.

function centsToDollars(cents) {
  return typeof cents === "number" && cents >= 0
    ? Number((cents / 100).toFixed(2))
    : null;
}

// Fallback for when `stats.current` is missing a given index (e.g. an ASIN
// with no tracked list price) even though `stats` was requested: read the
// most recent value straight out of the raw csv[] change-log instead.
function getLastCsvValue(csvArray) {
  if (!Array.isArray(csvArray)) return null;
  for (let i = csvArray.length - 1; i > 0; i -= 2) {
    const value = csvArray[i];
    if (typeof value === "number" && value !== -1) return value;
  }
  return null;
}

function getCurrentPriceCents(product) {
  const current = product.stats?.current ?? [];
  const amazon = current[CSV_TYPE.AMAZON];
  const newPrice = current[CSV_TYPE.NEW];
  if (typeof amazon === "number" && amazon !== -1) return amazon;
  if (typeof newPrice === "number" && newPrice !== -1) return newPrice;

  const amazonFallback = getLastCsvValue(product.csv?.[CSV_TYPE.AMAZON]);
  if (amazonFallback != null) return amazonFallback;
  return getLastCsvValue(product.csv?.[CSV_TYPE.NEW]);
}

function getListPriceCents(product) {
  const listPrice = product.stats?.current?.[CSV_TYPE.LISTPRICE];
  if (typeof listPrice === "number" && listPrice !== -1) return listPrice;
  return getLastCsvValue(product.csv?.[CSV_TYPE.LISTPRICE]);
}

// Keepa timestamps in csv[] arrays are "Keepa minutes" — minutes since the
// Keepa epoch (2011-01-01T00:00:00Z) — not Unix time.
const KEEPA_EPOCH_MS = Date.UTC(2011, 0, 1);
const REFERENCE_PRICE_WINDOW_DAYS = 30;

// Highest Amazon/New price actually recorded for this ASIN in the last
// REFERENCE_PRICE_WINDOW_DAYS days — used as a "price before this drop"
// signal for ASINs with no tracked MSRP (see getReferencePriceCents below).
function getRecentHighPriceCents(product) {
  const cutoffKeepaMinutes =
    (Date.now() - REFERENCE_PRICE_WINDOW_DAYS * 24 * 60 * 60 * 1000 - KEEPA_EPOCH_MS) / 60000;

  let highest = null;
  for (const type of [CSV_TYPE.AMAZON, CSV_TYPE.NEW]) {
    const csvArray = product.csv?.[type];
    if (!Array.isArray(csvArray)) continue;
    for (let i = 0; i < csvArray.length; i += 2) {
      const ts = csvArray[i];
      const price = csvArray[i + 1];
      if (
        typeof ts === "number" &&
        typeof price === "number" &&
        price !== -1 &&
        ts >= cutoffKeepaMinutes
      ) {
        highest = highest == null ? price : Math.max(highest, price);
      }
    }
  }
  return highest;
}

// The "was" price used to compute discount_percentage. Genuine tracked MSRP
// (list price) wins when Keepa has it — but most generic/hardware ASINs
// (the kind that clear a raw % discount filter easily, e.g. a $2.99 cable)
// have no MSRP tracked at all. Previously that meant listPriceCents was
// null and the code fell back straight to dealPrice, which silently drew
// list_price == deal_price and displayed a fake "-0%" badge on cards that
// Keepa's Deals API had genuinely flagged as real price drops. Falling back
// to the recent trading high instead keeps the displayed discount honest
// and tied to an actual observed price.
function getReferencePriceCents(product) {
  const listPriceCents = getListPriceCents(product);
  if (listPriceCents != null) return listPriceCents;
  return getRecentHighPriceCents(product);
}

// Keepa stores rating as (stars * 10), e.g. 45 => 4.5.
function getRating(product) {
  const raw = product.stats?.current?.[CSV_TYPE.RATING];
  const value =
    typeof raw === "number" && raw !== -1
      ? raw
      : getLastCsvValue(product.csv?.[CSV_TYPE.RATING]);
  return value != null ? Number((value / 10).toFixed(1)) : null;
}

function getRatingCount(product) {
  const raw = product.stats?.current?.[CSV_TYPE.COUNT_REVIEWS];
  if (typeof raw === "number" && raw !== -1) return raw;
  return getLastCsvValue(product.csv?.[CSV_TYPE.COUNT_REVIEWS]);
}

// Category exclusions (books, DVDs). Keepa's excludeCategories selection
// field needs numeric per-marketplace category IDs we haven't looked up for
// Amazon.ca, so this checks category/product-group text instead — safer
// than guessing at an unverified numeric ID (the same mistake that broke
// priceTypes earlier). Add more excluded types here as new keyword groups
// rather than one growing flat list, so the skip message stays specific
// about which rule actually matched.
const EXCLUDED_CATEGORY_KEYWORDS = {
  book: ["book", "ebook", "e-book", "kindle", "audible", "textbook"],
  dvd: ["dvd", "blu-ray", "bluray", "movies & tv"],
};

// Returns the excluded-category label ("book"/"dvd") this product matched,
// or null if it doesn't match any exclusion.
function getExcludedCategoryLabel(product) {
  const categoryNames = (product.categoryTree ?? []).map((c) => c.name ?? "");
  const haystack = [...categoryNames, product.productGroup ?? ""]
    .join(" ")
    .toLowerCase();

  for (const [label, keywords] of Object.entries(EXCLUDED_CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return label;
  }
  return null;
}

// FBA verification. The Amazon Creators API's offersV2 response has no
// fulfillment-channel field at all (confirmed 2026-08-20 against Amazon's
// own Creators API docs — DeliveryInfo/IsAmazonFulfilled from the old PA-API
// was dropped in offersV2), so "is this offer Fulfilled by Amazon" can only
// be checked from Keepa's own /product `offers` array, which does carry a
// real per-offer `isFBA` boolean (confirmed against Keepa's official
// api_backend Offer.java source) — independent of whether Amazon itself is
// the seller, unlike Keepa's discovery-time `mustHaveAmazonOffer` field.
// `liveOffersOrder` is Keepa's list of which `offers[]` entries are
// currently live (the array can also hold historical offers); fall back to
// treating every returned offer as live if Keepa omits it.
function hasLiveFbaNewOffer(product) {
  const offers = product.offers;
  if (!Array.isArray(offers) || offers.length === 0) return false;

  const liveIndices =
    Array.isArray(product.liveOffersOrder) && product.liveOffersOrder.length > 0
      ? product.liveOffersOrder
      : offers.map((_, i) => i);

  return liveIndices.some((i) => {
    const offer = offers[i];
    return offer && offer.isFBA === true && offer.condition === 1; // 1 = New
  });
}

// Best-effort category label — Keepa's categoryTree is a breadcrumb array
// ([{ catId, name }, ...]); the top-level entry is the closest match to a
// simple storefront category. Falls back to productGroup when absent.
function getCategory(product) {
  return product.categoryTree?.[0]?.name ?? product.productGroup ?? null;
}

// Best-effort low-stock signal. Keepa doesn't expose a literal stock
// quantity for Amazon-fulfilled listings, so this treats a thin new-offer
// count as a proxy. Tighten this once you can see real offers/availability
// data for your ASINs — it's a heuristic, not a precise stock read.
function getIsLowStock(product) {
  const newOfferCount = product.stats?.current?.[11]; // COUNT_NEW
  return typeof newOfferCount === "number" && newOfferCount > 0
    ? newOfferCount <= 1
    : false;
}

// Keepa csv[] arrays are flat [timestamp, price, timestamp, price, ...] pairs.
// Pull out just the price values, dropping the -1 "no data" sentinel.
function extractPriceHistory(csvArray) {
  if (!Array.isArray(csvArray)) return [];
  const prices = [];
  for (let i = 1; i < csvArray.length; i += 2) {
    const price = csvArray[i];
    if (typeof price === "number" && price !== -1) prices.push(price);
  }
  return prices;
}

// All-Time Low: current price <= the lowest price ever recorded in the
// Amazon (csv[0]) or New (csv[1]) history arrays.
function computeAllTimeLow(product, currentPriceCents) {
  const amazonHistory = extractPriceHistory(product.csv?.[CSV_TYPE.AMAZON]);
  const newHistory = extractPriceHistory(product.csv?.[CSV_TYPE.NEW]);
  const combined = [...amazonHistory, ...newHistory];

  if (combined.length === 0 || currentPriceCents == null) {
    return { isAllTimeLow: false, historicLowCents: null };
  }

  const historicLowCents = Math.min(...combined);
  return {
    isAllTimeLow: currentPriceCents <= historicLowCents,
    historicLowCents,
  };
}

// Keepa has shipped two different shapes for product images over time:
//   - newer responses: `images`, an array of objects (e.g. { l: "name.jpg", ... })
//   - older/deprecated: `imagesCSV`, a comma-separated string of filenames
// Try both; a bare filename gets built into a full CDN URL, an already-
// absolute URL (some accounts get full URLs back) is used as-is.
function getPrimaryImageUrl(product) {
  if (Array.isArray(product.images) && product.images.length > 0) {
    const first = product.images[0];
    const fileName =
      first?.l || first?.large || first?.hiRes || first?.m || first?.name;
    if (fileName) {
      return /^https?:\/\//.test(fileName)
        ? fileName
        : `https://m.media-amazon.com/images/I/${fileName}`;
    }
  }

  const firstImage = product.imagesCSV?.split(",")[0];
  if (firstImage) {
    return `https://m.media-amazon.com/images/I/${firstImage}`;
  }

  return null;
}

// Best-effort mapping of Keepa's `promotions` field onto our `deals` table's
// promo columns. Keepa's promotion payload shape varies by marketplace/
// version — if your Keepa plan returns promotions, console.log(
// product.promotions) for a real ASIN and tighten this mapping against the
// actual data.
function mapPromotions(product) {
  const promotions = product.promotions;
  if (!Array.isArray(promotions) || promotions.length === 0) {
    return {
      hasCoupon: false,
      couponText: null,
      promoText: null,
      promoCode: null,
    };
  }

  const promo = promotions[0];
  const type = String(promo.type || "").toUpperCase();
  const promoCode = promo.code || null;

  if (type.includes("COUPON")) {
    return {
      hasCoupon: true,
      couponText: promo.description || "Clip Coupon",
      promoText: null,
      promoCode,
    };
  }
  if (type.includes("BUY") || type.includes("BOGO")) {
    return {
      hasCoupon: false,
      couponText: null,
      promoText: promo.description || "Multi-buy Discount",
      promoCode,
    };
  }
  if (type.includes("CHECKOUT") || type.includes("PROMOTION")) {
    return {
      hasCoupon: false,
      couponText: null,
      promoText: promo.description || "Discount at Checkout",
      promoCode,
    };
  }
  return { hasCoupon: false, couponText: null, promoText: null, promoCode };
}

// ── Link TW affiliate deep link ─────────────────────────────────────────────
async function generateDeepLink(rawUrl) {
  const response = await axios.post(
    "https://linktw.in/api/url/add",
    { url: rawUrl },
    {
      headers: { Authorization: `Bearer ${LINKTWIN_API_KEY}` },
      timeout: KEEPA_REQUEST_TIMEOUT_MS,
    }
  );

  const shortUrl = response.data?.shorturl;
  if (!shortUrl) {
    throw new Error(`LinkTwin did not return a shorturl for ${rawUrl}`);
  }
  return shortUrl;
}

// ── Amazon Creators API (price/availability cross-check) ───────────────────
// This is the "make sure it's actually still real" gate: Keepa says a deal
// looks good, this confirms it directly against Amazon before anything gets
// published. partnerTag reuses AMAZON_AFFILIATE_TAG — it's the same
// Associates tracking ID used to build the raw affiliate URL below.
//
// Uses the `amazon-creators-api` SDK rather than hand-rolled HTTP: it wraps
// Amazon's official client and handles OAuth token exchange/refresh and
// endpoint resolution internally from the three credential values below, so
// there's no token endpoint URL to guess at or configure separately.

const creatorsApiClient = new CreatorsApiClient();
creatorsApiClient.credentialId = AMAZON_CREDENTIAL_ID;
creatorsApiClient.credentialSecret = AMAZON_CREDENTIAL_SECRET;
creatorsApiClient.version = AMAZON_CREDENTIAL_VERSION;
const creatorsApi = new CreatorsApiDefaultApi(creatorsApiClient);

const CREATORS_API_RESOURCES = [
  "itemInfo.title",
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.condition",
].map((resource) => GetItemsResource.constructFromObject(resource));

// Best-effort parsing — tries a couple of plausible nesting shapes since
// this hasn't been verified against a live response yet. Logs the raw
// listing when it can't find a price so this can be tightened quickly.
function extractCreatorsApiPriceCents(listing) {
  const amount =
    listing.price?.money?.amount ?? listing.price?.amount ?? listing.price?.value;
  if (typeof amount !== "number") return null;
  // Documented as whole currency units (dollars), unlike Keepa's cents.
  return Math.round(amount * 100);
}

function extractCreatorsApiInStock(listing) {
  const availability = listing.availability;
  if (!availability) return true; // assume in stock if the field is absent
  const type = String(availability.type ?? "").toUpperCase();
  const message = String(availability.message ?? "").toUpperCase();
  return !(
    type.includes("OUT_OF_STOCK") ||
    message.includes("OUT OF STOCK") ||
    message.includes("UNAVAILABLE")
  );
}

// Returns { priceCents, inStock, raw } for the live Amazon listing, or null
// if Amazon has no item at all for this ASIN on this marketplace.
async function fetchAmazonListing(asin) {
  const getItemsRequest = new GetItemsRequestContent(AMAZON_AFFILIATE_TAG, [asin]);
  getItemsRequest.resources = CREATORS_API_RESOURCES;

  const response = await creatorsApi.getItems(AMAZON_MARKETPLACE, getItemsRequest);

  const item = response?.itemsResult?.items?.[0];
  if (!item) return null;

  const listings = item.offersV2?.listings ?? [];
  // Only trust new-condition listings for deal pricing — a used/refurbished
  // offer being cheap would otherwise look like a false "deal".
  const newListing =
    listings.find((l) => (l.condition?.value ?? l.condition) === "NEW") ??
    listings[0];

  if (!newListing) {
    console.warn(
      `  ! Creators API returned no offer listings for ${asin}. Raw item: ` +
        `${JSON.stringify(item)?.slice(0, 300)}`
    );
    return { priceCents: null, inStock: false, raw: item };
  }

  const priceCents = extractCreatorsApiPriceCents(newListing);
  if (priceCents == null) {
    console.warn(
      `  ! Couldn't parse a price out of the Creators API listing for ${asin}. ` +
        `Raw listing: ${JSON.stringify(newListing)?.slice(0, 300)}`
    );
  }

  return {
    priceCents,
    inStock: extractCreatorsApiInStock(newListing),
    raw: newListing,
  };
}

// ── Variant family expansion (added 2026-08-21, rewritten same day) ────────
// Amazon color/size options of the same physical product are separate ASINs
// — Keepa (and Amazon) treat "adidas soccer ball, size 3" and "...size 4" as
// two entirely different products, each with its own price/discount, so
// discovery can legitimately surface several of them for what a shopper
// sees as ONE item.
//
// Keepa's `parentAsin` field is the real "these are the same underlying
// product" signal — confirmed against Keepa's own api_backend source
// (https://github.com/keepacom/api_backend, Product.java): "The ASIN of the
// parent product (if the product has variations, otherwise null)".
// dedupeAsinsByVariantFamily() groups candidates by parentAsin and, as of
// this rewrite, PUBLISHES every sibling that independently clears the full
// deal pipeline (discount floor, live FBA offer, Creators API cross-check —
// same gates a standalone deal goes through, nothing skipped) as its own
// row, tagged with a shared `parent_asin` column. The frontend groups
// same-family rows onto one card — e.g. "Size 3" and "Size 4" both shown as
// available, "Size 5" simply never published because it didn't clear
// MIN_DEAL_DISCOUNT_PERCENT. The first version of this (same day) picked
// only the single cheapest variant per family and discarded the rest —
// changed because the actual ask is "show every size/colour that's
// genuinely on sale", not "collapse to one".
//
// This is a discovery-time fix, not retroactive: duplicate variant rows
// already published from earlier runs stay in Supabase (is_active: true)
// until re-synced or manually cleaned up — same caveat as the two pre-fix
// junk rows noted in ROADMAP.md.
//
// A parent/family ASIN itself has no single buyable price and no single
// Amazon listing of its own — its /dp/ page is the "choose your options"
// page with a price RANGE, exactly what showed up when a deal link didn't
// land on a specific size (found 2026-08-21: a real deal's rawUrl resolved
// to a parent ASIN via Keepa discovery, which is why the affiliate link
// didn't preselect anything). The parent record itself must never be
// published as a deal — but per the above, its family is now expanded into
// real children rather than the whole family being discarded.
//
// CORRECTED 2026-08-22: originally this checked only `variations.length >
// 0`, on the assumption (based on a reading of Keepa's api_backend source)
// that Keepa only ever populates `variations` on the true top-of-tree
// parent. A live run proved that wrong — Keepa attaches a `variations`
// array to CHILD records too (every family member gets the same sibling
// list, not just the parent). That false assumption made Pass 3 below
// treat every single fetched child as "unexpectedly its own parent" and
// throw it away, silently zeroing out every Finder-mode run. The real
// signal for "is this record itself the top of the family tree" is
// `parentAsin`: a true parent has none; every child, however many arrays
// Keepa also hangs off its record, always points up via `parentAsin`.
function isParentAsin(product) {
  return (
    !product.parentAsin &&
    Array.isArray(product.variations) &&
    product.variations.length > 0
  );
}

async function dedupeAsinsByVariantFamily(asins) {
  const seenAsins = new Set();

  // Pass 1: cheap-check every raw candidate (no offers/stats — just enough
  // to see parentAsin/variations, both core fields Keepa always returns
  // regardless). See fetchKeepaProduct() doc comment for why this exists:
  // Product Finder's own productType filter doesn't reliably keep parent
  // ASINs out, so every candidate still needs checking, but there's no
  // reason to pay for offers+stats on one just to inspect its family shape.
  const cheapChecked = [];
  for (const asin of asins) {
    if (seenAsins.has(asin)) continue;
    seenAsins.add(asin);
    try {
      const cheapProduct = await fetchKeepaProductWithRateLimitRetry(asin, { full: false });
      cheapChecked.push({ asin, cheapProduct });
    } catch (err) {
      if (err.isKeepaRateLimit) {
        // Added 2026-08-22: a 429 here means Keepa itself is rejecting
        // every request for this account right now (out of tokens, or too
        // many requests too fast) — continuing to loop through the
        // remaining candidates would just burn through all of them as
        // guaranteed-fail 429s (seen live: ~380 consecutive 429 lines in
        // one run, wasting the whole job). Stop checking new candidates
        // for the rest of THIS run instead — whatever's already in
        // cheapChecked still gets processed, and the next scheduled run
        // (or a manual retry once Keepa's limit window resets) picks up
        // where this left off.
        console.warn(
          `  ! Keepa is rate-limiting this API key (429) — stopping new candidate ` +
            `checks for this run after ${cheapChecked.length}/${asins.length}. Check ` +
            `your Keepa account's token balance/rate limit before the next run.`
        );
        break;
      }
      console.warn(
        `  ! Couldn't fetch Keepa product for ${asin} during variant dedup: ${err.message}`
      );
    }
    await sleep(keepaPaceDelayMs(KEEPA_CHEAP_FETCH_TOKEN_COST));
  }

  // Pass 2: build the list of candidates that actually need a full
  // (price-bearing) fetch — either a raw candidate itself, or a family's
  // children when the raw candidate turned out to be the parent.
  const toCheckFull = []; // [{asin, familyAsin, variantAttributes}, ...]
  const bareChildrenByParent = new Map(); // parentAsin -> [{asin}, ...] (children found directly, not via a parent hit)

  for (const { asin, cheapProduct } of cheapChecked) {
    if (isParentAsin(cheapProduct)) {
      // A true parent ASIN — instead of discarding the whole family (the
      // first version of this fix), fan out into its real children.
      // `variations[].attributes` (the "Size: 4" style label) comes free
      // with this same fetch — only each child's own price needs a further
      // call. See MAX_VARIANTS_TO_CHECK_PER_FAMILY doc comment above.
      const total = cheapProduct.variations.length;
      const variations = cheapProduct.variations.slice(0, MAX_VARIANTS_TO_CHECK_PER_FAMILY);
      console.log(
        `  ${asin} is a parent ASIN with ${total} variation(s) — checking ` +
          `${variations.length === total ? "all of them" : `the first ${variations.length} (MAX_VARIANTS_TO_CHECK_PER_FAMILY)`} ` +
          `for a live deal instead of discarding the family.`
      );
      for (const variation of variations) {
        if (!variation?.asin || seenAsins.has(variation.asin)) continue;
        seenAsins.add(variation.asin);
        toCheckFull.push({
          asin: variation.asin,
          familyAsin: asin,
          variantAttributes: variation.attributes ?? null,
        });
      }
      continue; // the parent record itself never gets checked/published
    }

    if (cheapProduct.parentAsin) {
      // A real child, discovered directly rather than via its parent — the
      // original "duplicate soccer ball cards" scenario when 2+ of these
      // share a parentAsin. Queue it for the shared-parent label lookup
      // below rather than looking it up per-candidate.
      const list = bareChildrenByParent.get(cheapProduct.parentAsin) ?? [];
      list.push(asin);
      bareChildrenByParent.set(cheapProduct.parentAsin, list);
    } else {
      // Standalone — no family at all.
      toCheckFull.push({ asin, familyAsin: null, variantAttributes: null });
    }
  }

  // Pass 2b: for any parentAsin with 2+ bare children in this batch, one
  // cheap fetch of the shared parent gets real "Size 4" style labels for
  // the whole group. A lone bare child (no sibling surfaced this run) isn't
  // worth an extra call for — it still gets its parent_asin set correctly
  // (that's read straight off its own record, not this lookup), just
  // without a label; a future run that surfaces a sibling — or the parent
  // itself — fills the label in then via upsert, nothing is lost.
  for (const [parentAsin, memberAsins] of bareChildrenByParent.entries()) {
    let labelByAsin = null;
    if (memberAsins.length > 1) {
      try {
        await sleep(keepaPaceDelayMs(KEEPA_CHEAP_FETCH_TOKEN_COST));
        const parentProduct = await fetchKeepaProduct(parentAsin, { full: false });
        if (Array.isArray(parentProduct.variations)) {
          labelByAsin = new Map(
            parentProduct.variations.map((v) => [v.asin, v.attributes ?? null])
          );
        }
      } catch (err) {
        console.warn(
          `  ! Couldn't fetch parent ${parentAsin} for variant labels: ${err.message}`
        );
      }
    }
    for (const asin of memberAsins) {
      toCheckFull.push({
        asin,
        familyAsin: parentAsin,
        variantAttributes: labelByAsin?.get(asin) ?? null,
      });
    }
  }

  // Pass 3: the full (offers+stats) fetch — the actual data used for price/
  // discount and the eventual deal payload — for every survivor, expanded
  // children and bare/standalone candidates alike.
  const results = []; // [{asin, product, familyAsin, variantAttributes}, ...]
  for (const entry of toCheckFull) {
    try {
      await sleep(keepaPaceDelayMs(KEEPA_FULL_FETCH_TOKEN_COST)); // paced to the account's real token budget
      const product = await fetchKeepaProductWithRateLimitRetry(entry.asin, { full: true });
      if (isParentAsin(product)) {
        // Genuinely rare now that isParentAsin() checks parentAsin rather
        // than just variations.length (see the 2026-08-22 correction on
        // that function) — this only fires for a real nested case, e.g. a
        // second-level sub-family, where entry.asin turned out to be a
        // parent in its own right rather than a directly-buyable child.
        console.warn(
          `  ! ${entry.asin} is itself a parent ASIN (nested variation family) — skipping.`
        );
        continue;
      }
      results.push({ ...entry, product });
    } catch (err) {
      if (err.isKeepaRateLimit) {
        // Same reasoning as Pass 1's rate-limit guard above — stop paying
        // for more full fetches this run rather than burning through the
        // rest of toCheckFull as guaranteed 429s.
        console.warn(
          `  ! Keepa is rate-limiting this API key (429) — stopping full-fetch checks ` +
            `for this run after ${results.length}/${toCheckFull.length}.`
        );
        break;
      }
      console.warn(`  ! Couldn't fetch Keepa product for ${entry.asin}: ${err.message}`);
    }
  }

  return results;
}

// ── Build + upsert one deal ─────────────────────────────────────────────────
// `prefetchedProduct` lets callers that already fetched Keepa product data
// (the variant-dedup pass above) reuse it instead of spending a second
// Keepa /product call on the same ASIN.
//
// `variantMeta` (added 2026-08-21) carries family context from
// dedupeAsinsByVariantFamily(): { familyAsin, variantAttributes } — set
// only when discovery resolved this ASIN as part of a variant family this
// run. Deliberately left null/omitted rather than passed for the EXPIRE
// sweep's re-verify calls (see refreshStaleActiveDeals()), which don't
// re-resolve family context — the returned payload only includes
// parent_asin/variant_attributes as keys when variantMeta provides them, so
// a re-verify upsert (which omits these keys entirely) never overwrites a
// row's existing family tag with null. See the "Variant family expansion"
// doc section near the top of this file for the full design.
async function buildDealPayload(asin, prefetchedProduct = null, variantMeta = null) {
  const product = prefetchedProduct || (await fetchKeepaProduct(asin));

  // Fail fast on Keepa-only data before spending a Creators API call or a
  // LinkTwin call on a candidate that can never publish anyway.
  //
  // Redundant with the same check in dedupeAsinsByVariantFamily() by design
  // (defense in depth, same pattern as the discount-floor re-check below) —
  // this catches a parent/family ASIN even if it reached buildDealPayload()
  // through a path that skipped dedup (e.g. FALLBACK_ASINS). A parent ASIN
  // has no single price and its /dp/ link can't preselect a variant — found
  // 2026-08-21 as the actual cause of "View Deal" landing on a "choose your
  // options" page instead of the specific size/color shown on the card.
  if (isParentAsin(product)) {
    throw new Error(
      `${asin}: this is a parent/family ASIN (${product.variations.length} variation(s), no single price) — not a buyable listing, skipping.`
    );
  }

  const excludedCategory = getExcludedCategoryLabel(product);
  if (excludedCategory) {
    throw new Error(`${asin}: excluded category (${excludedCategory}) — skipping.`);
  }
  if (!hasLiveFbaNewOffer(product)) {
    throw new Error(`${asin}: no live Fulfilled-by-Amazon New offer found — skipping.`);
  }

  const keepaPriceCents = getCurrentPriceCents(product);
  const referencePriceCents = getReferencePriceCents(product);
  const { hasCoupon, couponText, promoText, promoCode } =
    mapPromotions(product);

  // ── Cross-reference with Amazon directly before publishing ──────────────
  // This is the actual "make sure it's correct" gate: Keepa is the
  // discovery/history signal, the Creators API is the source of truth for
  // what's real right now. Refuse to publish rather than trust Keepa alone.
  const amazonListing = await fetchAmazonListing(asin);
  if (!amazonListing) {
    throw new Error(
      `Amazon Creators API has no listing for ${asin} on ${AMAZON_MARKETPLACE} — skipping.`
    );
  }
  if (amazonListing.inStock === false) {
    throw new Error(`${asin} is out of stock on Amazon per the Creators API — skipping.`);
  }

  // Prefer the live Amazon price — it's the one the customer will actually
  // pay. Fall back to Keepa's only if the Creators API price couldn't be
  // parsed (logged above). A >3% gap between the two is worth knowing
  // about even though the live price still wins either way.
  const currentPriceCents = amazonListing.priceCents ?? keepaPriceCents;
  if (amazonListing.priceCents != null && keepaPriceCents != null) {
    const diff = Math.abs(amazonListing.priceCents - keepaPriceCents);
    const pctDiff = diff / Math.max(keepaPriceCents, 1);
    if (pctDiff > 0.03) {
      console.warn(
        `  ! Price mismatch for ${asin}: Keepa says $${centsToDollars(keepaPriceCents)}, ` +
          `Amazon says $${centsToDollars(amazonListing.priceCents)} — using the live Amazon price.`
      );
    }
  }

  // historicLowCents is only used to derive the is_all_time_low boolean below —
  // it isn't stored, since the `deals` table has no history/cents column.
  // Judged against the live Amazon price, since that's what's displayed.
  const { isAllTimeLow } = computeAllTimeLow(product, currentPriceCents);

  const dealPrice = centsToDollars(currentPriceCents);
  if (dealPrice == null) {
    // deal_price is NOT NULL in the deals table — surface a clear reason
    // now rather than letting a generic Postgres constraint error hide what
    // actually went wrong (Keepa had no price data AND the Creators API
    // price couldn't be parsed either).
    throw new Error(
      `No usable price found for ${asin} from either Keepa or the Creators ` +
        `API — cannot set deal_price.`
    );
  }
  const listPrice = centsToDollars(referencePriceCents);
  const discountPercentage =
    listPrice != null && listPrice > dealPrice
      ? Math.round(((listPrice - dealPrice) / listPrice) * 100)
      : null;

  // Discovery's own discount % can be stale by the time this enrichment
  // step runs (Keepa updates on a delay, and cheap/generic ASINs often have
  // no tracked MSRP at all — see getReferencePriceCents). Recompute and
  // re-verify against MIN_DEAL_DISCOUNT_PERCENT here rather than trusting
  // the candidate list blindly; publishing a card with a 0%/fake discount
  // badge is worse than not publishing it. FALLBACK_ASINS aren't
  // necessarily live deals either, so this can legitimately skip some of
  // them too — that's the point, not a bug.
  if (discountPercentage == null || discountPercentage < MIN_DEAL_DISCOUNT_PERCENT) {
    throw new Error(
      `${asin}: no verifiable discount of at least ${MIN_DEAL_DISCOUNT_PERCENT}% ` +
        `(reference price ${listPrice != null ? `$${listPrice}` : "unavailable"} vs deal price ` +
        `$${dealPrice}) — skipping rather than publish a misleading discount badge.`
    );
  }

  const rawUrl = `https://www.amazon.ca/dp/${asin}?tag=${AMAZON_AFFILIATE_TAG}`;
  const affiliateUrl = await generateDeepLink(rawUrl);

  // image_url is NOT NULL in the deals table. If Keepa genuinely returns no
  // image for this ASIN (or the response shape has drifted again), fall
  // back to a placeholder rather than letting the whole upsert fail.
  const imageUrl = getPrimaryImageUrl(product);
  if (!imageUrl) {
    console.warn(
      `  ! No image found in Keepa response for ${asin} — using a placeholder. ` +
        `(raw fields — images: ${JSON.stringify(product.images)?.slice(0, 200)}, imagesCSV: ${product.imagesCSV})`
    );
  }

  // Column names below match the `deals` table exactly — keep this object's
  // keys in lockstep with the schema; Supabase's PostgREST layer rejects any
  // key it can't find a matching column for. (parent_asin/variant_attributes
  // are the one exception — conditionally spread in further down, see the
  // buildDealPayload() doc comment above for why they're sometimes omitted
  // entirely rather than always present.)
  return {
    asin,
    title: product.title ?? null,
    brand: product.brand ?? null,
    category: getCategory(product),
    image_url:
      imageUrl ||
      `https://placehold.co/400x400/png?text=${encodeURIComponent(
        product.title || asin
      )}`,
    affiliate_url: affiliateUrl,
    deal_price: dealPrice,
    list_price: listPrice,
    discount_percentage: discountPercentage,
    rating: getRating(product),
    rating_count: getRatingCount(product),
    is_all_time_low: isAllTimeLow,
    is_low_stock: getIsLowStock(product),
    has_coupon: hasCoupon,
    coupon_text: couponText,
    promo_text: promoText,
    promo_code: promoCode,
    is_active: true,
    // Amazon Associates compliance: displayed prices must be accurate or
    // clearly disclaimed. This is the moment the Creators API cross-check
    // above actually confirmed the price/availability directly against
    // Amazon — set fresh on every successful sync (not just first publish),
    // so the frontend can show a real "price verified X ago" badge instead
    // of implying every displayed price is live. Requires a `last_verified_at`
    // timestamptz column on `deals` — see the migration note in ROADMAP.md.
    last_verified_at: new Date().toISOString(),
    // Variant family expansion (see doc section near the top of this file
    // and the buildDealPayload() doc comment above) — conditionally
    // included ONLY when variantMeta was actually passed in, so a re-verify
    // upsert that omits variantMeta never blanks out an existing tag.
    // Requires two new nullable columns on `deals`: parent_asin (text),
    // variant_attributes (jsonb) — see the migration note in ROADMAP.md.
    ...(variantMeta?.familyAsin ? { parent_asin: variantMeta.familyAsin } : {}),
    ...(variantMeta?.variantAttributes
      ? { variant_attributes: variantMeta.variantAttributes }
      : {}),
  };
}

async function syncDeal(asin, prefetchedProduct = null, variantMeta = null) {
  console.log(`\n→ Syncing ${asin}...`);
  try {
    const payload = await buildDealPayload(asin, prefetchedProduct, variantMeta);
    const { error } = await supabase
      .from("deals")
      .upsert(payload, { onConflict: "asin" });

    if (error) throw error;

    console.log(
      `  ✓ ${payload.title ?? "(no title)"} — $${payload.deal_price} CAD` +
        (payload.is_all_time_low ? " (ALL-TIME LOW)" : "")
    );
    return payload;
  } catch (err) {
    const message = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error(`  ✗ Failed to sync ${asin}: ${message}`);
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Real Amazon.ca ASINs — used only as a fallback if Keepa Deals API
// discovery comes back empty (API hiccup, filters too strict, etc.), so the
// pipeline still has something to run against rather than doing nothing.
const FALLBACK_ASINS = [
  "B09B8V1LZ3", // Echo Dot (5th Gen) — amazon.ca
  "B075CYMYK6", // Instant Pot Duo Plus 9-in-1, 3 Quart — amazon.ca
  "B01N46DBTN", // Kraft Smooth Peanut Butter, 2kg — amazon.ca
];

// Re-verify the stalest currently-active deals through the full pipeline —
// see the EXPIRE sweep doc comment above for why this exists and its cost.
async function refreshStaleActiveDeals() {
  const { data: staleRows, error } = await supabase
    .from("deals")
    .select("asin")
    .eq("is_active", true)
    .order("last_verified_at", { ascending: true })
    .limit(EXPIRE_REVERIFY_BATCH_SIZE);

  if (error) {
    console.warn(`  ! Couldn't fetch stale active deals to re-verify: ${error.message}`);
    return;
  }
  if (!staleRows || staleRows.length === 0) return;

  console.log(
    `\nRe-verifying ${staleRows.length} existing active deal(s) (oldest last_verified_at first)...`
  );

  for (const { asin } of staleRows) {
    try {
      const payload = await buildDealPayload(asin);
      const { error: upsertError } = await supabase
        .from("deals")
        .upsert(payload, { onConflict: "asin" });
      if (upsertError) throw upsertError;
      console.log(`  ✓ Re-verified ${asin} — still a live deal.`);
    } catch (err) {
      const message = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.warn(`  ! ${asin} no longer clears the bar (${message}) — deactivating.`);
      const { error: deactivateError } = await supabase
        .from("deals")
        .update({ is_active: false })
        .eq("asin", asin);
      if (deactivateError) {
        console.warn(`  ! Also failed to deactivate ${asin}: ${deactivateError.message}`);
      }
    }
    await sleep(keepaPaceDelayMs(KEEPA_FULL_FETCH_TOKEN_COST)); // buildDealPayload() does a full fetch here too
  }
}

// Safety-net sweep — no API calls, just Supabase. Deactivates anything not
// touched (by discovery or the refresh pass above) within EXPIRE_STALE_HOURS,
// regardless of the specific reason. See the EXPIRE sweep doc comment above.
async function expireStaleDeals() {
  const cutoffIso = new Date(Date.now() - EXPIRE_STALE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("deals")
    .update({ is_active: false })
    .eq("is_active", true)
    .lt("last_verified_at", cutoffIso)
    .select("asin");

  if (error) {
    console.warn(`  ! EXPIRE safety-net sweep failed: ${error.message}`);
    return;
  }
  if (data && data.length > 0) {
    console.log(
      `  Deactivated ${data.length} deal(s) not re-confirmed in over ${EXPIRE_STALE_HOURS}h: ${data
        .map((d) => d.asin)
        .join(", ")}`
    );
  }
}

async function main() {
  console.log(
    `Mega Deals Canada — discovering deals via Keepa [mode=${DISCOVERY_MODE}] ` +
      `(>= ${MIN_DEAL_DISCOUNT_PERCENT}% off, Amazon.ca)...`
  );

  let asins =
    DISCOVERY_MODE === "finder"
      ? await discoverDealAsinsViaProductFinder()
      : await discoverDealAsins();

  if (asins.length === 0) {
    console.warn(
      `  ! Keepa discovery (mode=${DISCOVERY_MODE}) returned no candidates — falling back to ${FALLBACK_ASINS.length} manual ASIN(s).`
    );
    asins = FALLBACK_ASINS;
  } else {
    console.log(`  Found ${asins.length} candidate deal(s) (capped at DEAL_DISCOVERY_RAW_POOL=${DEAL_DISCOVERY_RAW_POOL}).`);
  }

  console.log(`Checking ${asins.length} candidate(s) for duplicate size/color variants...`);
  const deduped = await dedupeAsinsByVariantFamily(asins);
  console.log(
    `  ${deduped.length} unique product(s) after variant grouping (was ${asins.length} candidate(s)).`
  );

  // Re-apply the real cost cap here, AFTER filtering — DEAL_DISCOVERY_RAW_POOL
  // above intentionally over-fetches raw candidates so a parent-ASIN-heavy
  // feed doesn't starve a run; this is what keeps the costly per-ASIN stage
  // (Creators API + LinkTwin) bounded at DEAL_DISCOVERY_LIMIT regardless.
  const toSync = deduped.slice(0, DEAL_DISCOVERY_LIMIT);

  console.log(
    `Syncing ${toSync.length} ASIN(s) (Keepa + Amazon Creators API cross-check)...`
  );

  for (const { asin, product, familyAsin, variantAttributes } of toSync) {
    const variantMeta = familyAsin ? { familyAsin, variantAttributes } : null;
    await syncDeal(asin, product, variantMeta);
    await sleep(1200); // be polite to Keepa's rate limits between calls
  }

  await refreshStaleActiveDeals();
  await expireStaleDeals();

  console.log("\nDone.");
}

main();
