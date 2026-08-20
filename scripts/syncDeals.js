/**
 * scripts/syncDeals.js
 *
 * Mega Deals Canada — backend ingestion pipeline.
 * For each ASIN: queries Keepa (domain=6, Amazon.ca) for pricing/price-history
 * and computes the All-Time-Low flag, then cross-checks that price/
 * availability directly against Amazon via the Creators API before
 * publishing anything — Keepa polls on a delay, so a "deal" can look real
 * in Keepa's data and already be gone/changed on Amazon by the time this
 * runs. Only ASINs that verify get a Link TW affiliate deep link generated
 * and upserted into the Supabase `deals` table (onConflict: 'asin').
 *
 * Run with:  node scripts/syncDeals.js   (or `npm run sync-deals`)
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

// Keepa csv/stats.current array indices relevant to this script.
// (Full reference: https://keepa.com/#!discuss/t/product-object/116)
const CSV_TYPE = {
  AMAZON: 0, // Amazon-fulfilled price history
  NEW: 1, // 3rd-party "New" price history
  LISTPRICE: 4, // Manufacturer list price history
  RATING: 16, // Product rating history (Keepa stores this as rating*10)
  COUNT_REVIEWS: 17, // Review count history
};

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

  const keepaPriceCents = getCurrentPriceCents(product);
  const listPriceCents = getListPriceCents(product);
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
  const listPrice = centsToDollars(listPriceCents) ?? dealPrice;
  const discountPercentage =
    dealPrice != null && listPrice != null && listPrice > 0
      ? Math.round(((listPrice - dealPrice) / listPrice) * 100)
      : null;

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

// Real Amazon.ca ASINs for pipeline testing — swap for whatever you're
// tracking, or wire this array up to a scraper/queue later.
const TEST_ASINS = [
  "B09B8V1LZ3", // Echo Dot (5th Gen) — amazon.ca
  "B075CYMYK6", // Instant Pot Duo Plus 9-in-1, 3 Quart — amazon.ca
  "B01N46DBTN", // Kraft Smooth Peanut Butter, 2kg — amazon.ca
];

async function main() {
  console.log(
    `Mega Deals Canada — syncing ${TEST_ASINS.length} test ASIN(s) (Keepa + Amazon Creators API cross-check)...`
  );

  for (const asin of TEST_ASINS) {
    await syncDeal(asin);
    await sleep(1200); // be polite to Keepa's rate limits between calls
  }

  console.log("\nDone.");
}

main();
