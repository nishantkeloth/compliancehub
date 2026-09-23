"use client";

import { useEffect, useRef, useState } from "react";
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
  const [finishing, setFinishing] = useState(false);
  const redeemAttempted = useRef(false);

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

  // Redeeming needs an authenticated session, but that session doesn't
  // always exist the moment this page first loads:
  //  - it's there immediately if the Supabase project doesn't require
  //    email confirmation (signUp() below returns a session right away)
  //  - otherwise it only shows up once the person clicks the confirmation
  //    link in their email — which now redirects back to this exact page
  //    (see the emailRedirectTo option in submit() below), so Supabase's
  //    client picks the session up from the URL after this page reloads
  //  - or a moment later still, if they come back and sign in normally
  // Rather than only trying once right after signUp(), this watches for
  // a session however it arrives and redeems as soon as one shows up —
  // that's what actually closes the gap that left org_id/role_id null.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const tryRedeem = async () => {
      if (redeemAttempted.current || cancelled) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      redeemAttempted.current = true;
      setFinishing(true);
      setError(null);
      const { error: redeemError } = await supabase.rpc("redeem_invite", { p_token: token });
      if (cancelled) return;
      if (redeemError) {
        // "already been used" means an earlier attempt in this same flow
        // already redeemed it (e.g. a duplicate SIGNED_IN event) — that's
        // success, not a failure, so just continue on to the app.
        if (/already been used/i.test(redeemError.message)) {
          window.location.href = "/";
          return;
        }
        setFinishing(false);
        setError(redeemError.message);
        return;
      }
      window.location.href = "/";
    };

    tryRedeem();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") tryRedeem();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
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
    // Send them right back to this invite link after confirming their
    // email, instead of wherever the project's default redirect points —
    // that's what lets the effect above pick up the new session and
    // finish redeeming automatically.
    const emailRedirectTo = `${window.location.origin}/accept-invite/${token}`;

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() }, emailRedirectTo },
    });

    if (signUpError) {
      // Most likely: this account was already created on an earlier
      // attempt (e.g. they closed the tab after "check your email" and
      // never came back), but the invite was never redeemed. Sign in
      // with the password they just entered instead of dead-ending here.
      if (/already registered|already exists/i.test(signUpError.message)) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          setBusy(false);
          setError(
            "An account with this email already exists. Enter the password you used when you first signed up, then try again."
          );
          return;
        }
        // Signed in — the effect above will pick up the new session and
        // redeem the invite; leave the button in its busy state until the
        // "Finishing setup…" screen takes over.
        return;
      }
      setBusy(false);
      setError(signUpError.message);
      return;
    }

    if (!signUpData.session) {
      // Email confirmation is required before there's an active session.
      setBusy(false);
      setInfo(
        "Account created — check your email and click the confirmation link to finish joining. It'll bring you right back here."
      );
      return;
    }

    // A session came back immediately (this project doesn't require email
    // confirmation) — the effect above will redeem it.
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

  if (finishing) {
    return (
      <main
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--ch-paper)" }}
      >
        <p style={{ color: "var(--ch-sub)" }}>Finishing setup…</p>
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
          disabled={busy}
          className="w-full ch-btn-primary rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Setting up…" : "Create account & join"}
        </button>
      </div>
    </main>
  );
}
