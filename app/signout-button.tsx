"use client";

import { createClient } from "@/lib/supabase/client";
import { clearGuideState } from "@/lib/guide/state";

export default function SignOutButton() {
  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Guided Workflows state is sessionStorage-backed so it survives a
    // refresh — which also means it survives this sign-out's page reload
    // unless cleared explicitly. An in-progress guide should never resume
    // for whoever signs in next on this tab.
    clearGuideState();
    window.location.href = "/login";
  };

  return (
    <button
      onClick={signOut}
      className="text-sm font-medium bg-white/10 hover:bg-white/20 rounded-lg px-4 py-2 transition-colors"
    >
      Sign out
    </button>
  );
}
