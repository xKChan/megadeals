import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Tag, Search } from "lucide-react";

const CATEGORIES = ["All Deals", "Tech", "Home", "Groceries", "Under $25"];

/**
 * Layout.jsx — the sticky header and footer shared by every route.
 *
 * The search input and category pills are homepage-only concerns (they
 * filter the deal grid), but they live here in the shared header rather
 * than in HomePage itself, matching the original single-page design. Their
 * state is lifted to this component and handed down to whichever route is
 * active via React Router's Outlet context (see useOutletContext() in
 * HomePage.jsx) — they're simply not rendered when you're on a route other
 * than "/", since they'd have nothing to filter.
 */
export default function Layout() {
  const location = useLocation();
  const isHome = location.pathname === "/";

  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("All Deals");

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

        {/* Category pills — home page only */}
        {isHome && (
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
        )}
      </header>

      {/* Routed page content */}
      <div className="flex-1">
        <Outlet context={{ searchTerm, activeCategory }} />
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
