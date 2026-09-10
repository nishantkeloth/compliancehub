import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

// Wrapped in React's cache() so every call within the same request/render
// returns the exact same client instance instead of a fresh one each time.
// This is what lets getEffectiveAccess() (lib/rbac.ts) actually dedupe --
// it's memoized on (supabase, userId), so it only produces a cache hit if
// every caller is handed back the same `supabase` object. Safe because a
// request's cookies never change mid-request, and cache() is scoped to a
// single request in Server Components (reset on the next navigation).
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore,
            // the browser client keeps the session refreshed.
          }
        },
      },
    }
  );
});
