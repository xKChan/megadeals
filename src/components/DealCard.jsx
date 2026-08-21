import { useEffect, useState } from "react";
import {
  TrendingDown,
  Scissors,
  Layers,
  Percent,
  Tag,
  Star,
  ArrowRight,
  Clock,
  Share2,
  Bookmark,
  Check,
} from "lucide-react";

/**
 * DealCard.jsx
 *
 * Renders a single Amazon Canada deal fetched live from Supabase's `deals`
 * table. Column names are snake_case (Postgres convention) and are mapped
 * to display props right at the top of the component.
 *
 * Visual language modeled after deal-roundup sites like damgooddeals.ca:
 * a top-right "All-Time Low" badge on the image, a share/save action row,
 * an inline price row (big price + strikethrough list price + red "% OFF"
 * pill), a short blurb line, and a bold red "View on Amazon.ca" CTA.
 *
 * Deliberately NOT copied from the reference: fake comment/upvote counts.
 * There's no backend tracking engagement yet, so showing numbers there
 * would just be made up. Share + Save are real, functional actions instead.
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

// Turns a created_at timestamp into "Added 2 hours ago" style text.
function formatAddedAt(createdAt) {
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

// There's no dedicated "description" column in Supabase. Rather than leave
// the card empty where the reference design has a blurb line, build a short
// generic one from the brand + first few words of the title.
function buildBlurb({ brand, title }) {
  if (!title) return null;
  const shortName = [brand, title.split(" ").slice(0, 3).join(" ")]
    .filter(Boolean)
    .join(" ")
    .trim();
  return `A top-rated favourite shoppers love — ${shortName || "this pick"} is on sale right now.`;
}

const BOOKMARKS_STORAGE_KEY = "megaDealsCanada:bookmarks";

function readBookmarks() {
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBookmarks(ids) {
  try {
    window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage unavailable (private mode, etc.) — bookmarking just won't persist.
  }
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
    id,
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

  const [isBookmarked, setIsBookmarked] = useState(false);
  const [justShared, setJustShared] = useState(false);

  useEffect(() => {
    setIsBookmarked(readBookmarks().includes(id));
  }, [id]);

  function toggleBookmark() {
    const current = readBookmarks();
    const next = current.includes(id)
      ? current.filter((bookmarkedId) => bookmarkedId !== id)
      : [...current, id];
    writeBookmarks(next);
    setIsBookmarked(next.includes(id));
  }

  async function handleShare() {
    const shareData = { title, url: affiliateUrl };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(affiliateUrl);
      setJustShared(true);
      setTimeout(() => setJustShared(false), 1500);
    } catch {
      // User cancelled the share sheet, or clipboard access was denied — no-op.
    }
  }

  const addedAt = formatAddedAt(createdAt);
  const PromoIcon = pickPromoIcon(promoText);
  const blurb = buildBlurb({ brand, title });

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

        {/* Promo/coupon badges float top-left */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
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

        {/* Price-history badge floats top-right, matching the "lowest price
            seen" style badges on deal-roundup sites */}
        {isAllTimeLow && (
          <div className="absolute top-2 right-2">
            <Badge icon={TrendingDown} label="All-Time Low" className="bg-emerald-700 text-white" />
          </div>
        )}
      </div>

      {/* Engagement row — share + bookmark are real, functional actions;
          we deliberately don't show fake comment/upvote counts since
          there's no backend tracking that yet */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
        >
          {justShared ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Share2 className="h-3.5 w-3.5" />
          )}
          {justShared ? "Copied" : "Share"}
        </button>
        <button
          type="button"
          onClick={toggleBookmark}
          aria-pressed={isBookmarked}
          className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            isBookmarked
              ? "border-red-200 bg-red-50 text-red-600"
              : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
          }`}
        >
          <Bookmark className={`h-3.5 w-3.5 ${isBookmarked ? "fill-red-600" : ""}`} />
          {isBookmarked ? "Saved" : "Save"}
        </button>
      </div>

      {/* Body */}
      <div className="flex h-full flex-1 flex-col gap-2 p-4">
        {brand && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {brand}
          </span>
        )}

        {addedAt && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            Added {addedAt}
          </span>
        )}

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

        {/* Inline price row: big price, strikethrough list price, red % pill —
            mirrors the single-line price treatment on the reference site */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-1">
          <span className="text-2xl font-extrabold leading-tight text-gray-900">
            {formatCAD(dealPrice)}
          </span>
          {listPrice && Number(listPrice) > Number(dealPrice) && (
            <span className="text-sm text-gray-400 line-through decoration-gray-400">
              {formatCAD(listPrice)}
            </span>
          )}
          {typeof discountPercent === "number" && discountPercent > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
              {discountPercent}% OFF
            </span>
          )}
        </div>

        {blurb && <p className="line-clamp-2 text-xs leading-snug text-gray-500">{blurb}</p>}

        {promoCode && (
          <div className="mt-1 cursor-pointer rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-gray-600 transition-colors duration-150 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-600">
            Code: {promoCode}
          </div>
        )}

        {/* CTA — pinned to the bottom of the card, so cards line up perfectly
            regardless of how many lines the title/blurb above take up */}
        <a
          href={affiliateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white transition-colors duration-150 hover:bg-red-700 active:bg-red-800"
        >
          View on Amazon.ca
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </a>
      </div>
    </div>
  );
}
