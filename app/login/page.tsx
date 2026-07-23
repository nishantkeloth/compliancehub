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
    window.location.href = "/";
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--ch-paper)" }}>
      <div className="w-full max-w-sm bg-white rounded-xl border p-8 shadow-sm" style={{ borderColor: "var(--ch-line)" }}>
        <h1 className="text-xl font-bold" style={{ color: "var(--ch-navy)" }}>
          Compliance<span style={{ color: "var(--ch-ink)", opacity: 0.6 }}>Hub</span>
        </h1>
        <p className="text-sm mt-1 mb-6" style={{ color: "var(--ch-sub)" }}>
          {mode === "signin" ? "Sign in to your workspace" : "Create your account"}
        </p>

        {mode === "signup" && (
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
            style={{ borderColor: "var(--ch-line)" }}
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        )}
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm mb-4"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Password (min 6 characters)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        {error && (
          <div
            className="text-sm rounded-lg px-3 py-2 mb-4"
            style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}
          >
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full ch-btn-primary rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <button
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
          className="w-full text-sm mt-4"
          style={{ color: "var(--ch-sub)" }}
        >
          {mode === "signin"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
