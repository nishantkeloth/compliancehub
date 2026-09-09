"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCrewProfile } from "./actions";

type JobRole = { id: string; name: string };

export default function NewCrewForm({ jobRoles }: { jobRoles: JobRole[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [primaryJobRoleId, setPrimaryJobRoleId] = useState("");
  const [nationality, setNationality] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("candidate");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!fullName.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("fullName", fullName.trim());
    fd.set("employeeCode", employeeCode.trim());
    fd.set("primaryJobRoleId", primaryJobRoleId);
    fd.set("nationality", nationality.trim());
    fd.set("employmentStatus", employmentStatus);
    startTransition(async () => {
      const res = await createCrewProfile(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.id) router.push(`/crew/profiles/${res.id}`);
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">
        + Add crew member
      </button>
    );
  }

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <input
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Employee code (optional)"
          value={employeeCode}
          onChange={(e) => setEmployeeCode(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          value={primaryJobRoleId}
          onChange={(e) => setPrimaryJobRoleId(e.target.value)}
        >
          <option value="">No role yet</option>
          {jobRoles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <input
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Nationality"
          value={nationality}
          onChange={(e) => setNationality(e.target.value)}
        />
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          value={employmentStatus}
          onChange={(e) => setEmploymentStatus(e.target.value)}
        >
          <option value="candidate">Candidate</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        You'll add documents, skills, and remaining details on the crew member's page after creating them.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={pending || !fullName.trim()}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create crew member"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg px-4 py-2 text-sm font-semibold border"
          style={{ borderColor: "var(--ch-line)" }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="text-sm mt-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
