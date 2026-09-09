"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTemplate } from "./actions";

export default function NewTemplateForm() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [scoringType, setScoringType] = useState("checklist");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!code.trim() || !name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("code", code.trim());
    fd.set("name", name.trim());
    fd.set("scoringType", scoringType);
    startTransition(async () => {
      const res = await createTemplate(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.id) router.push(`/team/templates/${res.id}`);
    });
  };

  return (
    <div className="bg-white border rounded-xl p-4" style={{ borderColor: "var(--ch-line)" }}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <input
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Code, e.g. AHM MS 33"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="border rounded-lg px-3 py-2 text-sm sm:col-span-2"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Name, e.g. FSMS Audit Checklist"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-4 mb-3 text-sm" style={{ color: "var(--ch-ink)" }}>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={scoringType === "checklist"}
            onChange={() => setScoringType("checklist")}
          />
          Checklist (pass/fail)
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={scoringType === "scored"}
            onChange={() => setScoringType("scored")}
          />
          Scored (marks)
        </label>
      </div>
      <button
        onClick={submit}
        disabled={pending || !code.trim() || !name.trim()}
        className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {pending ? "Creating…" : "New template"}
      </button>
      {error && (
        <div
          className="text-sm mt-3 rounded-lg px-3 py-2"
          style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
