"use client";

import { useState, useTransition } from "react";
import { setUserStatus } from "./actions";

export default function MemberRow({
  member,
  isSelf,
  canManageStatus,
}: {
  member: { id: string; full_name: string | null; roleName: string; status: string };
  isSelf: boolean;
  canManageStatus: boolean;
}) {
  const [status, setStatus] = useState(member.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = status === "active" ? "inactive" : "active";
    setError(null);
    startTransition(async () => {
      const res = await setUserStatus(member.id, next);
      if (res?.error) {
        setError(res.error);
      } else {
        setStatus(next);
      }
    });
  };

  return (
    <div
      className="bg-white border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap"
      style={{ borderColor: "var(--ch-line)" }}
    >
      <div>
        <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>
          {member.full_name || "—"} {isSelf && <span style={{ color: "var(--ch-sub)" }}>(you)</span>}
        </div>
        <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
          {member.roleName}
        </div>
        {error && (
          <div className="text-xs mt-1" style={{ color: "var(--ch-fail)" }}>
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span
          className="text-xs font-bold uppercase rounded-full px-3 py-1"
          style={
            status === "active"
              ? { background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }
              : { background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }
          }
        >
          {status}
        </span>
        {canManageStatus && !isSelf && (
          <button
            onClick={toggle}
            disabled={pending}
            className="text-xs font-semibold border rounded-lg px-3 py-1.5 disabled:opacity-50"
            style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
          >
            {pending ? "…" : status === "active" ? "Deactivate" : "Reactivate"}
          </button>
        )}
      </div>
    </div>
  );
}
