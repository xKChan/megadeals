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
 * MIN_DEAL_DISCOUNT_PERCENT (default 20), DEAL_DISCOVERY_LIMIT (default 20,
 * caps how many candidates get run through the full per-ASIN pipeline in
 * one call), MIN_DEAL_RATING_STARS (default 3.5), and DEAL_BRAND_ALLOWLIST
 * (comma-separated brand names — see DEFAULT_DEAL_BRAND_ALLOWLIST for the
 * starter list). Books/DVDs are excluded and FBA is verified downstream in
 * buildDealPayload() from real per-offer Keepa data, not at discovery time
 * — see getExcludedCategoryLabel() / hasLiveFbaNewOffer() below for why.
 *
 * ── Discovery mode (added 2026-08-21) ────────────────────────────────────
 * DISCOVERY_MODE env var picks the discovery source: "deals" (default,
 * discoverDealAsins — Keepa's day-over-day price-drop feed) or "finder"
 * (discoverDealAsinsViaProductFinder — Keepa's broader /query endpoint,
 * filtered by category/sales-rank/rating/review-count/90-day price trend).
 * Both functions live in this file regardless of which is active, so trying
 * "finder" and going back to "deals" is a one-line .env.local edit — no code
 * changes, no lost work either way. See discoverDealAsinsViaProductFinder()
 * for field-by-field notes, including which parts of the category-ID setup
 * are still unverified.
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
const MIN_DEAL_DISCOUNT_PERCENT = Number(process.env.MIN_DEAL_DISCOUNT_PERCENT) || 20;
const DEAL_DISCOVERY_LIMIT = Number(process.env.DEAL_DISCOVERY_LIMIT) || 20;

// Minimum product star rating (0-5). Keepa's own `minRating` selection field
// uses a 0-50 integer scale (45 = 4.5 stars, confirmed against Keepa's docs
// at https://keepa.com/api-docs/deals.html), so this converts once here.
const MIN_DEAL_RATING_STARS = Number(process.env.MIN_DEAL_RATING_STARS) || 3.5;
const MIN_DEAL_RATING_KEEPA_SCALE = Math.round(MIN_DEAL_RATING_STARS * 10);

// "Popular brand" allowlist — a starter list of well-known consumer brands,
// editable anytime in .env.local (comma-separated) without touching code.
// Keepa's `brand` selection field ("Include only products from the
// specified brand", array of strings, per Keepa's docs) filters discovery
// results server-side, before any product/Creators-API/LinkTwin call is
// spent on a candidate. Brand matching against Keepa's tracked brand string
// hasn't been confirmed against a live run yet — if a brand you expect to
// see never turns up, it may need exact-casing/spelling to match what
// Keepa/Amazon has on file for that ASIN.
const DEFAULT_DEAL_BRAND_ALLOWLIST =
  "Sony,Samsung,Apple,Anker,Bose,JBL,Logitech,LEGO,Philips,Panasonic,Dyson,KitchenAid,Instant Pot,Ninja,Shark,Keurig,Black+Decker,Cuisinart,Hasbro,Mattel,Nike,Adidas,Under Armour,Crocs,Levi's,Nintendo,Microsoft,Google,Fitbit,Garmin,Bissell,Braun,Oral-B,Gillette,L'Oréal,Nivea";
const DEAL_BRAND_ALLOWLIST = (process.env.DEAL_BRAND_ALLOWLIST || DEFAULT_DEAL_BRAND_ALLOWLIST)
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
      .slice(0, DEAL_DISCOVERY_LIMIT);
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
// Root category node IDs for Amazon.ca (Electronics, Kitchen & Dining,
// Tools, Smart Home) are UNVERIFIED — Keepa doesn't error on a wrong numeric
// category ID, it just silently matches nothing, so `totalResults` logged
// below is the tell: if it's consistently 0, check these IDs first via
// Keepa's category browser before assuming a filter elsewhere is at fault.
// Override via PRODUCT_FINDER_CATEGORY_IDS (comma-separated) in .env.local.
const PRODUCT_FINDER_CATEGORIES = (
  process.env.PRODUCT_FINDER_CATEGORY_IDS || "2242989011,2224025011,3379552011,6368817011"
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
    rootCategory: PRODUCT_FINDER_CATEGORIES,
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
    perPage: Math.max(DEAL_DISCOVERY_LIMIT, 50),
    // No categories_exclude for books/DVDs here for the same reason as
    // /deal — needs numeric IDs we haven't verified. Every candidate this
    // returns still passes through buildDealPayload()'s excluded-category
    // and FBA checks (Keepa /product data), so nothing skips those gates.
  };

  try {
    const { data } = await axios.get(KEEPA_QUERY_URL, {
      params: { key: KEEPA_API_KEY, domain: KEEPA_DOMAIN_CA, selection: JSON.stringify(selection) },
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
      `  Product Finder matched ${data.totalResults ?? asinList.length} total product(s) before capping ` +
        `(0 here usually means PRODUCT_FINDER_CATEGORY_IDS need checking).`
    );
    return asinList.slice(0, DEAL_DISCOVERY_LIMIT);
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

async function fetchKeepaProduct(asin) {
  const { data } = await axios.get(KEEPA_PRODUCT_URL, {
    params: {
      key: KEEPA_API_KEY,
      domain: KEEPA_DOMAIN_CA,
      asin,
      offers: 20,
      // Keepa only computes/returns `product.stats` (current price, list
      // price, rating, review count — everything getCurrentPriceCents(),
      // getListPriceCents(), getRating(), and getRatingCount() read) when a
      // `stats` window is explicitly requested. Omitting it is why
      // deal_price/list_price/rating all came back null on the first live
      // run. 180 = compute stats over the trailing 180 days.
      stats: 180,
    },
  });

  const product = data?.products?.[0];
  if (!product) {
    throw new Error(`Keepa returned no product data for ASIN ${asin}`);
  }
  return product;
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
    { headers: { Authorization: `Bearer ${LINKTWIN_API_KEY}` } }
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

// ── Build + upsert one deal ─────────────────────────────────────────────────
async function buildDealPayload(asin) {
  const product = await fetchKeepaProduct(asin);

  // Fail fast on Keepa-only data before spending a Creators API call or a
  // LinkTwin call on a candidate that can never publish anyway.
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
  // key it can't find a matching column for.
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
  };
}

async function syncDeal(asin) {
  console.log(`\n→ Syncing ${asin}...`);
  try {
    const payload = await buildDealPayload(asin);
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
    console.log(`  Found ${asins.length} candidate deal(s) (capped at DEAL_DISCOVERY_LIMIT=${DEAL_DISCOVERY_LIMIT}).`);
  }

  console.log(
    `Syncing ${asins.length} ASIN(s) (Keepa + Amazon Creators API cross-check)...`
  );

  for (const asin of asins) {
    await syncDeal(asin);
    await sleep(1200); // be polite to Keepa's rate limits between calls
  }

  console.log("\nDone.");
}

main();
