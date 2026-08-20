import { useEffect, useMemo, useState } from "react";
import { Tag, Search } from "lucide-react";
import DealCard from "./components/DealCard";
import { supabase } from "./lib/supabaseClient";

const CATEGORIES = ["All Deals", "Tech", "Home", "Groceries", "Under $25"];
const SKELETON_COUNT = 10;

function DealCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="aspect-square w-full animate-pulse bg-gray-100" />
      <div className="flex flex-col gap-2 p-4">
        <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
        <div className="h-3.5 w-full animate-pulse rounded bg-gray-100" />
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-gray-100" />
        <div className="mt-2 h-6 w-24 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 h-10 w-full animate-pulse rounded-xl bg-gray-100" />
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky top nav */}
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          {/* Placeholder logo */}
          <a href="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900">
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
              className="w-full rounded-full border border-gray-200 bg-gray-100 py-2 pl-9 pr-4 text-sm text-gray-900 outline-none transition-colors focus:border-gray-400 focus:bg-white"
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
                      ? "bg-gray-900 text-white"
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
        <div className="mb-5 flex items-baseline justify-between">
          <h1 className="text-xl font-bold text-gray-900">Today's Deals</h1>
          {!isLoading && !loadError && (
            <span className="text-sm text-gray-500">
              {filteredDeals.length} deal{filteredDeals.length === 1 ? "" : "s"}
            </span>
          )}
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
