import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses Row-Level Security entirely. Only ever
// import this from server-only code (Server Actions, Route Handlers) that
// has ALREADY verified the caller is authorized for the privileged action
// it's about to perform — this client provides no authorization of its
// own, RLS is switched off for it entirely.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
