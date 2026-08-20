import { Flame, Scissors, Layers, Percent, Tag, Star, ExternalLink } from "lucide-react";

/**
 * DealCard.jsx
 *
 * Renders a single Amazon Canada deal fetched live from Supabase's `deals`
 * table. Column names are snake_case (Postgres convention) and are mapped
 * to display props right at the top of the component.
 *
 * Pricing hierarchy:
 *   - List price (list_price): small, muted, strikethrough, labeled.
 *   - Deal price (deal_price): large, bold, high-contrast — the visual anchor.
 *   - Discount % (discount_percentage): compact chip next to the deal price.
 */

const CAD_FORMATTER = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

function formatCAD(amount) {
  const value = Number(amount);
  return Number.isFinite(value) ? CAD_FORMATTER.format(value) : null;
}

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("en-CA", { numeric: "auto" });
const RELATIVE_TIME_UNITS = [
  { unit: "year", ms: 1000 * 60 * 60 * 24 * 365 },
  { unit: "month", ms: 1000 * 60 * 60 * 24 * 30 },
  { unit: "day", ms: 1000 * 60 * 60 * 24 },
  { unit: "hour", ms: 1000 * 60 * 60 },
  { unit: "minute", ms: 1000 * 60 },
];

// Turns a created_at timestamp into "Posted 2 hours ago" style text.
function formatPostedAt(createdAt) {
  if (!createdAt) return null;
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return null;

  const diffMs = createdMs - Date.now();
  for (const { unit, ms } of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffMs) >= ms) {
      return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}

// promo_text is free text from the pipeline (e.g. "Buy 2 for $6",
// "Extra 10% at Checkout"). Pick a reasonable icon based on its content
// since there's no discrete promo-type enum coming from the table.
function pickPromoIcon(promoText) {
  const text = (promoText || "").toLowerCase();
  if (text.includes("checkout")) return Percent;
  if (text.includes("buy")) return Layers;
  return Tag;
}

function Badge({ icon: Icon, label, className }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide shadow-sm ${className}`}
    >
      {Icon ? <Icon className="h-3 w-3" strokeWidth={2.75} /> : null}
      {label}
    </span>
  );
}

export default function DealCard({ deal }) {
  const {
    title,
    brand,
    image_url: imageUrl,
    deal_price: dealPrice,
    list_price: listPrice,
    discount_percentage: discountPercent,
    affiliate_url: affiliateUrl,
    is_all_time_low: isAllTimeLow,
    has_coupon: hasCoupon,
    coupon_text: couponText,
    promo_text: promoText,
    promo_code: promoCode,
    created_at: createdAt,
    rating,
    review_count: reviewCount,
  } = deal;

  const postedAt = formatPostedAt(createdAt);
  const PromoIcon = pickPromoIcon(promoText);

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow duration-200 hover:shadow-lg">
      {/* Image container — strictly bounded so a missing/broken image (and its
          alt text) can never spill out and overlap the badges or card below */}
      <div className="relative w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden rounded-t-xl">
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          className="h-full w-full object-contain p-4 transition-transform duration-200 group-hover:scale-105"
        />

        {/* Badges float on top of the image container */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {isAllTimeLow && (
            <Badge icon={Flame} label="All-Time Low" className="bg-red-600 text-white" />
          )}
          {hasCoupon && (
            <Badge
              icon={Scissors}
              label={couponText || "Clip Coupon"}
              className="bg-orange-500 text-white"
            />
          )}
          {promoText && (
            <Badge icon={PromoIcon} label={promoText} className="bg-violet-600 text-white" />
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex h-full flex-1 flex-col gap-2 p-4">
        {brand && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {brand}
          </span>
        )}

        {postedAt && <span className="text-xs text-gray-500">Posted {postedAt}</span>}

        <h3
          title={title}
          className="line-clamp-3 min-h-[3.75rem] text-sm font-semibold leading-snug text-gray-900"
        >
          {title}
        </h3>

        {typeof rating === "number" && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <span className="font-medium text-gray-700">{rating.toFixed(1)}</span>
            {reviewCount ? (
              <span className="text-gray-400">({Number(reviewCount).toLocaleString("en-CA")})</span>
            ) : null}
          </div>
        )}

        {promoCode && (
          <div className="mt-1 cursor-pointer rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-gray-600 transition-colors duration-150 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-600">
            Code: {promoCode}
          </div>
        )}

        {/* Pricing + CTA — pinned to the bottom of the card as a unit, so
            cards line up perfectly regardless of how many lines the title
            or promo code box above take up */}
        <div className="mt-auto">
          <div className="flex items-end justify-between pt-2">
            <div className="flex flex-col">
              <span className="text-xs text-gray-400">
                List Price:{" "}
                <span className="line-through decoration-gray-400">{formatCAD(listPrice)}</span>
              </span>
              <span className="text-2xl font-extrabold leading-tight text-gray-900">
                {formatCAD(dealPrice)}
              </span>
            </div>

            {typeof discountPercent === "number" && (
              <span className="mb-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                -{discountPercent}%
              </span>
            )}
          </div>

          <a
            href={affiliateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-orange-600 active:bg-orange-700"
          >
            View Deal
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
          </a>
        </div>
      </div>
    </div>
  );
}
