"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetCrewMatrixSiteProjectContractData } from "./reset-actions";

const CONFIRM_PHRASE = "RESET ALL DATA";

type Counts = { crewMatrices: number; offshoreSites: number; projects: number; contracts: number };

export default function ResetPanel({ counts }: { counts: Counts }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    deletedMatrices: number;
    deletedSites: number;
    deletedProjects: number;
    deletedContracts: number;
    deletedCrewAssignments: number;
  } | null>(null);

  const nothingToReset = counts.crewMatrices === 0 && counts.offshoreSites === 0 && counts.projects === 0 && counts.contracts === 0;

  if (result) {
    return (
      <div className="text-sm rounded-lg px-4 py-3" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
        Done. Deleted {result.deletedMatrices} crew matrix{result.deletedMatrices === 1 ? "" : "es"}, {result.deletedSites} offshore
        site{result.deletedSites === 1 ? "" : "s"}, {result.deletedProjects} project{result.deletedProjects === 1 ? "" : "s"}, and{" "}
        {result.deletedContracts} contract{result.deletedContracts === 1 ? "" : "s"} — along with {result.deletedCrewAssignments} crew
        assignment record{result.deletedCrewAssignments === 1 ? "" : "s"} that had to go with them. Contractors, Clients, and crew
        profiles were left untouched.
      </div>
    );
  }

  if (nothingToReset) {
    return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Nothing to reset — no crew matrices, sites, projects, or contracts exist yet.</div>;
  }

  const confirmed = confirmText.trim() === CONFIRM_PHRASE;

  const run = () => {
    if (!confirmed || busy) return;
    setError(null);
    startTransition(async () => {
      const res = await resetCrewMatrixSiteProjectContractData();
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
        <li>• {counts.crewMatrices} crew matrix{counts.crewMatrices === 1 ? "" : "es"} — every version, every status, with all manning lines, documents, sharing history, and approval history</li>
        <li>• {counts.offshoreSites} offshore site{counts.offshoreSites === 1 ? "" : "s"} and their manning requirements</li>
        <li>• {counts.projects} project{counts.projects === 1 ? "" : "s"}</li>
        <li>• {counts.contracts} contract{counts.contracts === 1 ? "" : "s"} and their documents/service scope</li>
        <li>• Everything that has to go along with the above: mobilizations end-to-end, crew assignment history (not just current assignments — the full record of who was assigned where and when), boarding/sign-off/roster-change records, manual overrides, and site/project-scoped container and operations records</li>
      </ul>
      <div className="text-xs mb-3 font-semibold" style={{ color: "var(--ch-fail)" }}>
        Contractors, Clients, and crew profiles (the people themselves) are never touched — only their assignment records.
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--ch-fail)" }}>
        This can&rsquo;t be undone. There is no draft/active distinction here — everything above goes, regardless of status.
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
          {busy ? "Deleting…" : "Permanently reset"}
        </button>
      </div>
      {error && <div className="text-sm mt-3" style={{ color: "var(--ch-fail)" }}>{error}</div>}
    </div>
  );
}
