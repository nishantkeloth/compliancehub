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
      className="text-sm font-medium text-neutral-500 hover:text-neutral-900 border border-neutral-300 rounded-lg px-4 py-2"
    >
      Sign out
    </button>
  );
}
