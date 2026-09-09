"use client";

import { useState, useTransition } from "react";
import { createCompany } from "./actions";

export default function NewCompanyForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim()) return;
    setError(null);
    const formData = new FormData();
    formData.set("name", name.trim());
    startTransition(async () => {
      const result = await createCompany(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setName("");
      }
    });
  };

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[220px]"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="New company name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button
          onClick={submit}
          disabled={pending || !name.trim()}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add company"}
        </button>
      </div>
      {error && (
        <div className="text-sm mt-2" style={{ color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
