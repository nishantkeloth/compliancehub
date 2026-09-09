"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Preview =
  | { valid: true; company_name: string; role: string; email: string | null }
  | { valid: false };

export default function AcceptInviteForm({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc("get_invite_preview", { p_token: token }).then(({ data, error }) => {
      if (error || !data?.valid) {
        setPreview({ valid: false });
        return;
      }
      setPreview(data as Preview);
      if (data.email) setEmail(data.email);
    });
  }, [token]);

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    const supabase = createClient();

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    if (signUpError) {
      setBusy(false);
      setError(signUpError.message);
      return;
    }

    if (!signUpData.session) {
      // Email confirmation is required before there's an active session —
      // redeem_invite needs auth.uid(), so it can't run yet.
      setBusy(false);
      setInfo("Account created — check your email to confirm it, then reopen this invite link to finish joining.");
      return;
    }

    const { error: redeemError } = await supabase.rpc("redeem_invite", { p_token: token });
    setBusy(false);
    if (redeemError) {
      setError(redeemError.message);
      return;
    }
    setDone(true);
    window.location.href = "/";
  };

  if (preview === null) {
    return (
      <main
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--ch-paper)" }}
      >
        <p style={{ color: "var(--ch-sub)" }}>Loading invite…</p>
      </main>
    );
  }

  if (!preview.valid) {
    return (
      <main
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--ch-paper)" }}
      >
        <div
          className="w-full max-w-sm bg-white rounded-xl border p-8 shadow-sm text-center"
          style={{ borderColor: "var(--ch-line)" }}
        >
          <h1 className="text-lg font-bold" style={{ color: "var(--ch-navy)" }}>
            Invite not valid
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--ch-sub)" }}>
            This invite link has expired, been used already, or been revoked. Ask whoever invited you
            to send a new one.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--ch-paper)" }}
    >
      <div
        className="w-full max-w-sm bg-white rounded-xl border p-8 shadow-sm"
        style={{ borderColor: "var(--ch-line)" }}
      >
        <h1 className="text-xl font-bold" style={{ color: "var(--ch-navy)" }}>
          Compliance<span style={{ color: "var(--ch-ink)", opacity: 0.6 }}>Hub</span>
        </h1>
        <p className="text-sm mt-1 mb-6" style={{ color: "var(--ch-sub)" }}>
          You&apos;re invited to join <strong>{preview.company_name}</strong> as{" "}
          <strong>{preview.role}</strong>. Set up your account below.
        </p>

        <input
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={!!preview.email}
        />
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm mb-4"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Choose a password (min 6 characters)"
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
        {info && (
          <div
            className="text-sm rounded-lg px-3 py-2 mb-4"
            style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
          >
            {info}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy || done}
          className="w-full ch-btn-primary rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Setting up…" : done ? "Done — redirecting…" : "Create account & join"}
        </button>
      </div>
    </main>
  );
}
