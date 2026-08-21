import { useEffect, useMemo, useState } from "react";
import { Tag, Search, RefreshCw } from "lucide-react";
import DealCard from "./components/DealCard";
import { supabase } from "./lib/supabaseClient";

const CATEGORIES = ["All Deals", "Tech", "Home", "Groceries", "Under $25"];
const SKELETON_COUNT = 10;

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("en-CA", { numeric: "auto" });
const RELATIVE_TIME_UNITS = [
  { unit: "year", ms: 1000 * 60 * 60 * 24 * 365 },
  { unit: "month", ms: 1000 * 60 * 60 * 24 * 30 },
  { unit: "day", ms: 1000 * 60 * 60 * 24 },
  { unit: "hour", ms: 1000 * 60 * 60 },
  { unit: "minute", ms: 1000 * 60 },
];

// Same relative-time convention as DealCard's "Added ... ago" — used here to
// drive the page-level "Updated ..." freshness chip off the real newest
// created_at in the live data, never a hardcoded date.
function formatRelativeTime(timestamp) {
  if (!timestamp) return null;
  const ms = new Date(timestamp).getTime();
  if (Number.isNaN(ms)) return null;
  const diffMs = ms - Date.now();
  for (const { unit, ms: unitMs } of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffMs) >= unitMs) {
      return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / unitMs), unit);
    }
  }
  return "just now";
}

function DealCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="aspect-square w-full animate-pulse bg-gray-100" />
      <div className="h-9 w-full animate-pulse border-b border-gray-100 bg-gray-50" />
      <div className="flex flex-col gap-2 p-4">
        <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
        <div className="h-3.5 w-full animate-pulse rounded bg-gray-100" />
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-gray-100" />
        <div className="mt-2 h-6 w-24 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 h-11 w-full animate-pulse rounded-xl bg-gray-100" />
      </div>
    </div>
  );
}

export default function App() {
  const [deals, setDeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("All Deals");

  useEffect(() => {
    let isCancelled = false;

    async function fetchDeals() {
      setIsLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from("deals")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (isCancelled) return;

      if (error) {
        console.error("Failed to fetch deals from Supabase:", error);
        setLoadError(error.message);
        setDeals([]);
      } else {
        setDeals(data ?? []);
      }
      setIsLoading(false);
    }

    fetchDeals();

    return () => {
      isCancelled = true;
    };
  }, []);

  const filteredDeals = useMemo(() => {
    let result = deals;

    // "Under $25" is a price filter, not a category — handle it separately
    // from the rest of the pills, which match against a `category` column.
    if (activeCategory === "Under $25") {
      result = result.filter((deal) => Number(deal.deal_price) < 25);
    } else if (activeCategory !== "All Deals") {
      result = result.filter(
        (deal) => (deal.category ?? "").toLowerCase() === activeCategory.toLowerCase()
      );
    }

    const query = searchTerm.trim().toLowerCase();
    if (query) {
      result = result.filter((deal) =>
        `${deal.title ?? ""} ${deal.brand ?? ""} ${deal.category ?? ""}`
          .toLowerCase()
          .includes(query)
      );
    }

    return result;
  }, [deals, searchTerm, activeCategory]);

  // "Updated ..." chip mirrors the freshness stamp on deal-roundup sites —
  // driven by the newest created_at actually present in the live data.
  const lastUpdatedLabel = useMemo(() => {
    if (deals.length === 0) return null;
    const newestMs = deals.reduce((latest, deal) => {
      const ts = new Date(deal.created_at).getTime();
      return Number.isFinite(ts) && ts > latest ? ts : latest;
    }, 0);
    return newestMs ? formatRelativeTime(new Date(newestMs).toISOString()) : null;
  }, [deals]);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Sticky top nav */}
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          {/* Placeholder logo */}
          <a href="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600">
              <Tag className="h-5 w-5 text-white" strokeWidth={2.5} />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-gray-900">
              Mega Deals Canada
            </span>
          </a>

          {/* Search input */}
          <div className="relative ml-auto w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search today's deals..."
              className="w-full rounded-full border border-gray-200 bg-gray-100 py-2 pl-9 pr-4 text-sm text-gray-900 outline-none transition-colors focus:border-red-300 focus:bg-white"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="border-t border-gray-100">
          <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-2.5 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CATEGORIES.map((category) => {
              const isActive = category === activeCategory;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                    isActive
                      ? "bg-red-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Page header block — chip + accented title + subtitle + freshness
            stamp, modeled on the deal-roundup page format */}
        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
            <Tag className="h-3 w-3" strokeWidth={3} />
            Amazon.ca Deals
          </span>

          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
            Today's Best <span className="text-red-600">Amazon.ca</span> Deals
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Every deal below is checked against real Keepa price history before it's posted, so
            you're seeing an actual price drop — not a fake "was" price.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {lastUpdatedLabel && !isLoading && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
                <RefreshCw className="h-3 w-3" />
                Updated {lastUpdatedLabel}
              </span>
            )}
            {!isLoading && !loadError && (
              <span className="text-xs font-medium text-gray-500">
                {filteredDeals.length} deal{filteredDeals.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
              <DealCardSkeleton key={index} />
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-red-200 bg-red-50 py-20 text-center">
            <p className="text-sm font-medium text-red-600">
              Couldn't load live deals right now. Please try again shortly.
            </p>
          </div>
        ) : deals.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 py-20 text-center">
            <p className="text-sm font-medium text-gray-500">
              No live deals found. Check back shortly!
            </p>
          </div>
        ) : filteredDeals.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filteredDeals.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 py-20 text-center">
            <p className="text-sm font-medium text-gray-500">
              No deals match {searchTerm ? `"${searchTerm}"` : "this filter"}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
