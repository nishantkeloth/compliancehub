"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const supabase = createClient();

    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
          });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Full reload so the server sees the new session cookies
    window.location.href = "/";
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-neutral-200 p-8 shadow-sm">
        <h1 className="text-xl font-bold text-neutral-900">
          Compliance<span className="text-amber-500">Hub</span>
        </h1>
        <p className="text-sm text-neutral-500 mt-1 mb-6">
          {mode === "signin" ? "Sign in to your workspace" : "Create your account"}
        </p>

        {mode === "signup" && (
          <input
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3"
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        )}
        <input
          className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-4"
          placeholder="Password (min 6 characters)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <button
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
          className="w-full text-sm text-neutral-500 hover:text-neutral-800 mt-4"
        >
          {mode === "signin"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
