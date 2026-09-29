"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetCrewRegisterData } from "./reset-crew-register-actions";

const CONFIRM_PHRASE = "DELETE CREW REGISTER";

type Counts = { crewProfiles: number; crewDocuments: number; crewMatrices: number; crewAssignments: number };

export default function ResetCrewRegisterPanel({ counts }: { counts: Counts }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    deletedCrewProfiles: number;
    deletedCrewDocuments: number;
    deletedCrewMatrices: number;
    deletedCrewAssignments: number;
  } | null>(null);

  const nothingToReset = counts.crewProfiles === 0 && counts.crewDocuments === 0;

  if (result) {
    return (
      <div className="text-sm rounded-lg px-4 py-3" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
        Done. Deleted {result.deletedCrewProfiles} crew profile{result.deletedCrewProfiles === 1 ? "" : "s"} and{" "}
        {result.deletedCrewDocuments} crew document{result.deletedCrewDocuments === 1 ? "" : "s"} — along with{" "}
        {result.deletedCrewMatrices} crew matrix{result.deletedCrewMatrices === 1 ? "" : "es"} and{" "}
        {result.deletedCrewAssignments} crew assignment record{result.deletedCrewAssignments === 1 ? "" : "s"} that had to go with them.
        Contractors, Clients, Projects, Contracts, and Offshore Sites were left untouched.
      </div>
    );
  }

  if (nothingToReset) {
    return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Nothing to reset — no crew profiles or crew documents exist yet.</div>;
  }

  const confirmed = confirmText.trim() === CONFIRM_PHRASE;

  const run = () => {
    if (!confirmed || busy) return;
    setError(null);
    startTransition(async () => {
      const res = await resetCrewRegisterData();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult(res);
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--ch-fail)", background: "var(--ch-fail-bg)" }}>
      <div className="text-sm font-semibold mb-2" style={{ color: "var(--ch-fail)" }}>
        This will permanently delete:
      </div>
      <ul className="text-xs mb-3 space-y-1" style={{ color: "var(--ch-fail)" }}>
        <li>• {counts.crewProfiles} crew profile{counts.crewProfiles === 1 ? "" : "s"} — every crew member in the register, with all their skills, roles, and links</li>
        <li>• {counts.crewDocuments} crew document{counts.crewDocuments === 1 ? "" : "s"} — every certificate/visa/travel-document/vaccination record, with version history and notification history</li>
        <li>• {counts.crewMatrices} crew matrix{counts.crewMatrices === 1 ? "" : "es"} and {counts.crewAssignments} crew assignment record{counts.crewAssignments === 1 ? "" : "s"} — anything that has to go along with the profiles and documents above, since it can&rsquo;t be left pointing at a crew member who no longer exists: matrices and their manning lines, mobilizations end-to-end, boarding/sign-off/roster-change/crew-change records, and manual overrides</li>
      </ul>
      <div className="text-xs mb-3 font-semibold" style={{ color: "var(--ch-fail)" }}>
        Contractors, Clients, Projects, Contracts, and Offshore Sites are never touched. Ops/billing records that reference a
        crew member have that reference cleared, not the record itself — your cost history stays intact.
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--ch-fail)" }}>
        This can&rsquo;t be undone. There is no draft/active distinction here — every crew profile goes, regardless of status.
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs" style={{ color: "var(--ch-fail)" }}>
          Type <span className="font-mono font-bold">{CONFIRM_PHRASE}</span> to confirm
        </label>
        <input
          className="border rounded-lg px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--ch-fail)" }}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
        />
        <button
          onClick={run}
          disabled={!confirmed || busy}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--ch-fail)" }}
        >
          {busy ? "Deleting…" : "Permanently delete"}
        </button>
      </div>
      {error && <div className="text-sm mt-3" style={{ color: "var(--ch-fail)" }}>{error}</div>}
    </div>
  );
}
