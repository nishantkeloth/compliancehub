"use client";

import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
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
