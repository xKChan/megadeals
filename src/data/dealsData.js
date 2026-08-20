/**
 * dealsData.js
 *
 * Mock payload mimicking the shape delivered by the n8n automation pipeline
 * (ScrapeOps scrape -> Keepa API price validation -> Link TW deep link generation).
 *
 * Field notes for whoever wires up the real webhook:
 * - keepa.isAllTimeLow / keepa.priceDropPercent come straight from the Keepa API check.
 * - affiliateUrl is the final Link TW-shortened deep link (already tagged, ready to click).
 * - promoType is a controlled vocabulary the backend sets; the frontend maps it to a badge.
 * - All prices are numbers in CAD (no currency symbols), formatted at render time.
 */

export const PROMO_TYPES = {
  NONE: "NONE",
  CLIP_COUPON: "CLIP_COUPON",
  BUY_2_FOR_X: "BUY_2_FOR_X",
  CHECKOUT_DISCOUNT: "CHECKOUT_DISCOUNT",
};

const dealsData = [
  {
    id: "deal_8f2a1c",
    asin: "B0CHX1W1XY",
    title:
      "Anker 737 Portable Charger, 24,000mAh Power Bank with 140W Output, USB-C Fast Charging",
    brand: "Anker",
    imageUrl:
      "https://placehold.co/400x400/png?text=Anker+737+Power+Bank",
    category: "Electronics",
    rating: 4.7,
    reviewCount: 3218,
    originalPrice: 219.99,
    dealPrice: 139.99,
    currency: "CAD",
    discountPercent: 36,
    affiliateUrl: "https://liinks.to/aff/a8f2a1c-anker737",
    keepa: {
      isAllTimeLow: true,
      priceDropPercent: 36,
      last90DayLow: 159.99,
    },
    hasCoupon: false,
    promoType: PROMO_TYPES.NONE,
    promoLabel: null,
    promoCode: "SAVE20",
    stockStatus: "IN_STOCK",
    scrapedAt: "2026-08-20T13:05:00Z",
  },
  {
    id: "deal_3b7e90",
    asin: "B09B8RXYZ2",
    title:
      "Bounty Paper Towels, Quick-Size, 12 Family Rolls = 30 Regular Rolls",
    brand: "Bounty",
    imageUrl:
      "https://placehold.co/400x400/png?text=Bounty+Paper+Towels",
    category: "Household",
    rating: 4.8,
    reviewCount: 15762,
    originalPrice: 42.99,
    dealPrice: 29.97,
    currency: "CAD",
    discountPercent: 30,
    affiliateUrl: "https://liinks.to/aff/a3b7e90-bounty12pk",
    keepa: {
      isAllTimeLow: false,
      priceDropPercent: 30,
      last90DayLow: 27.49,
    },
    hasCoupon: true,
    promoType: PROMO_TYPES.CLIP_COUPON,
    promoLabel: "Clip 15% Coupon",
    stockStatus: "IN_STOCK",
    scrapedAt: "2026-08-20T13:05:00Z",
  },
  {
    id: "deal_c15d44",
    asin: "B08P2K7QXM",
    title:
      "Kraft Peanut Butter, Smooth, 1kg Jar — Pantry Staple, No Sugar Added Option",
    brand: "Kraft",
    imageUrl:
      "https://placehold.co/400x400/png?text=Kraft+Peanut+Butter",
    category: "Grocery",
    rating: 4.9,
    reviewCount: 2894,
    originalPrice: 8.99,
    dealPrice: 6.0,
    currency: "CAD",
    discountPercent: 33,
    affiliateUrl: "https://liinks.to/aff/ac15d44-kraftpb",
    keepa: {
      isAllTimeLow: false,
      priceDropPercent: 33,
      last90DayLow: 6.49,
    },
    hasCoupon: false,
    promoType: PROMO_TYPES.BUY_2_FOR_X,
    promoLabel: "Buy 2 for $6.00",
    stockStatus: "IN_STOCK",
    scrapedAt: "2026-08-20T13:05:00Z",
  },
  {
    id: "deal_f902ab",
    asin: "B0CT9H4G7L",
    title:
      "Ninja Creami Ice Cream Maker, 7 One-Touch Programs, Pints Included",
    brand: "Ninja",
    imageUrl:
      "https://placehold.co/400x400/png?text=Ninja+Creami",
    category: "Kitchen",
    rating: 4.6,
    reviewCount: 9127,
    originalPrice: 249.99,
    dealPrice: 179.99,
    currency: "CAD",
    discountPercent: 28,
    affiliateUrl: "https://liinks.to/aff/af902ab-ninjacreami",
    keepa: {
      isAllTimeLow: true,
      priceDropPercent: 28,
      last90DayLow: 199.99,
    },
    hasCoupon: false,
    promoType: PROMO_TYPES.CHECKOUT_DISCOUNT,
    promoLabel: "Extra 10% at Checkout",
    stockStatus: "LOW_STOCK",
    scrapedAt: "2026-08-20T13:05:00Z",
  },
];

export default dealsData;
