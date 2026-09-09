"use client";

import { useState, useTransition } from "react";
import { createCompany } from "./actions";

export default function NewCompanyForm() {
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!companyName.trim()) return;
    setError(null);
    setResult(null);
    const formData = new FormData();
    formData.set("companyName", companyName.trim());
    formData.set("adminName", adminName.trim());
    formData.set("adminEmail", adminEmail.trim());
    startTransition(async () => {
      const res = await createCompany(formData);
      if (res?.error) setError(res.error);
      if (res?.admin) setResult(res.admin);
      if (!res?.error) {
        setCompanyName("");
        setAdminName("");
        setAdminEmail("");
      }
    });
  };

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className="border rounded-lg px-3 py-2 text-sm sm:col-span-2"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Company name"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
        <input
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Admin full name (optional)"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
        />
        <input
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Admin email (optional)"
          type="email"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
        />
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
        Leave the admin fields blank to just create the company — you can onboard an admin later.
      </p>
      <button
        onClick={submit}
        disabled={pending || !companyName.trim()}
        className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 mt-3"
      >
        {pending ? "Adding…" : "Add company"}
      </button>

      {error && (
        <div
          className="text-sm mt-3 rounded-lg px-3 py-2"
          style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}
        >
          {error}
        </div>
      )}
      {result && (
        <div
          className="text-sm mt-3 rounded-lg px-3 py-2"
          style={{ background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }}
        >
          Admin account created for <strong>{result.email}</strong>.
          <br />
          Temporary password: <strong>{result.tempPassword}</strong>
          <br />
          <span style={{ color: "var(--ch-ink)" }}>
            Share this with them now — it won&apos;t be shown again.
          </span>
        </div>
      )}
    </div>
  );
}
