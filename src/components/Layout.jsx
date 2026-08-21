import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Tag, Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// How many real categories to show as pills, on top of "All Deals" and
// "Under $25". Keepa's category-tree names can be granular/inconsistent
// (a specific subcategory rather than a broad one), so rather than show
// every distinct value verbatim — which could be a long, messy row — this
// caps it to the most common ones actually present in the live data.
// Arbitrary, tune once real category values are visible in production.
const MAX_CATEGORY_PILLS = 8;

/**
 * Layout.jsx — the sticky header and footer shared by every route, and
 * (as of 2026-08-21) the single place deals are fetched from Supabase.
 *
 * Deals live here rather than in HomePage because the category pills need
 * the real, live `category` values to build their chip list — the backend
 * confirmed every row already carries a real Keepa category (getCategory()
 * in syncDeals.js), so the fix is purely frontend: stop hardcoding a guess
 * and derive the chip list from what's actually in the data.
 *
 * Fetched once when Layout mounts (not re-fetched on every navigation,
 * since Layout persists across route changes and deals only change on the
 * backend's hourly sync cadence — re-fetching per-navigation would just be
 * wasted requests). Everything the routed pages need — deals, loading/error
 * state, search term, active category — flows down through React Router's
 * Outlet context.
 */
export default function Layout() {
  const location = useLocation();
  const isHome = location.pathname === "/";

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

  // Real category pills, derived from the live data instead of a hardcoded
  // guess. Dedupes case-insensitively (keeping the first-seen casing as the
  // display label, e.g. "Electronics" not "electronics"), ranks by how many
  // live deals actually carry that category, and keeps only the top
  // MAX_CATEGORY_PILLS so an unexpectedly granular/messy category column
  // doesn't blow out the pill row into a huge horizontal-scroll mess.
  // "All Deals" and "Under $25" are pinned separately — "Under $25" is a
  // price filter, not a real category value, so it can't come from this data.
  const categoryOptions = useMemo(() => {
    const counts = new Map();
    for (const deal of deals) {
      const raw = (deal.category ?? "").trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { label: raw, count: 1 });
    }

    const topCategories = Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CATEGORY_PILLS)
      .map((entry) => entry.label);

    return ["All Deals", ...topCategories, "Under $25"];
  }, [deals]);

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      {/* Sticky top nav */}
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          {/* Logo */}
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600">
              <Tag className="h-5 w-5 text-white" strokeWidth={2.5} />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-gray-900">
              Mega Deals Canada
            </span>
          </Link>

          {/* Search input — home page only */}
          {isHome && (
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
          )}
        </div>

        {/* Category pills — home page only, real categories from live data */}
        {isHome && (
          <div className="border-t border-gray-100">
            <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-2.5 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {categoryOptions.map((category) => {
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
        )}
      </header>

      {/* Routed page content */}
      <div className="flex-1">
        <Outlet context={{ deals, isLoading, loadError, searchTerm, activeCategory }} />
      </div>

      {/* Footer — affiliate disclosure required for Amazon Associates/FTC
          compliance, shown on every page, plus real routed nav links */}
      <footer className="mt-10 border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 text-center sm:px-6">
          <p className="mx-auto max-w-2xl text-xs leading-relaxed text-gray-500">
            Mega Deals Canada may earn a commission from purchases made through links on
            this site. Every deal is checked against Keepa's price history before it's
            posted, but prices and availability can change — always confirm the current
            price on Amazon.ca before buying. #ad
          </p>
          <nav className="mt-4 flex items-center justify-center gap-3 text-xs font-medium text-gray-500">
            <Link
              to="/"
              className="underline decoration-gray-300 underline-offset-2 hover:text-gray-700"
            >
              Home
            </Link>
            <span aria-hidden="true">·</span>
            <Link
              to="/about"
              className="underline decoration-gray-300 underline-offset-2 hover:text-gray-700"
            >
              About
            </Link>
            <span aria-hidden="true">·</span>
            <Link
              to="/privacy"
              className="underline decoration-gray-300 underline-offset-2 hover:text-gray-700"
            >
              Privacy
            </Link>
            <span aria-hidden="true">·</span>
            <Link
              to="/terms"
              className="underline decoration-gray-300 underline-offset-2 hover:text-gray-700"
            >
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
