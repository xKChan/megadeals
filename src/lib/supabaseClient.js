import { createClient } from "@supabase/supabase-js";

/**
 * Single shared Supabase client for the app.
 *
 * Reads VITE_SUPABASE_URL and a client-safe key from Vite's env system
 * (import.meta.env). Vite only exposes env vars prefixed with VITE_ to
 * client-side code, so these must be set in a .env.local file at the
 * project root:
 *
 *   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
 *   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
 *
 * (Older Supabase projects call this the "anon key" instead of
 * "publishable key" — VITE_SUPABASE_ANON_KEY is also accepted below.)
 *
 * IMPORTANT — SECURITY: only ever use the publishable/anon key here. NEVER
 * VITE_SUPABASE_SECRET_KEY (or a legacy service_role key) — anything
 * prefixed VITE_ that this file reads can end up visible in the browser's
 * bundled JS, and the secret key bypasses Row Level Security entirely. If
 * that key reaches the browser, anyone opening dev tools gets full
 * read/write access to your database. The publishable/anon key is safe to
 * ship to the browser precisely because Supabase Row Level Security (RLS)
 * policies on the table are what actually enforce access control. Make
 * sure the `deals` table has RLS enabled with a policy allowing SELECT for
 * anon/authenticated where is_active = true, otherwise the fetch in
 * App.jsx will silently return zero rows.
 *
 * scripts/syncDeals.js (the backend ingestion script) is the only place
 * that should ever read VITE_SUPABASE_SECRET_KEY — that script runs on
 * your machine/server, not in the browser.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  const hasSecretKeyOnly =
    !supabasePublishableKey && !!import.meta.env.VITE_SUPABASE_SECRET_KEY;

  throw new Error(
    hasSecretKeyOnly
      ? "Missing a client-safe Supabase key. .env.local only has VITE_SUPABASE_SECRET_KEY, " +
        "which must never be used in frontend code (it bypasses Row Level Security). Add " +
        "VITE_SUPABASE_PUBLISHABLE_KEY (from Supabase dashboard -> Project Settings -> API " +
        "Keys -> \"Publishable key\") to .env.local, then restart the dev server."
      : "Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY " +
        "to a .env.local file at your project root, then restart the dev server."
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
