"use client";

// "Initiate Mobilization" — shown on the Staffing Plan's Assigned tab once the
// matrix is approved (or live). One click opens a short form; submitting it
// creates a mobilization request from this matrix and pre-fills each position
// with the crew shown on the Assigned tab (see initiateMobilizationFromMatrix
// in app/mobilizations/actions.ts). If a request is already open for this
// matrix the button turns into a link to it instead, so it can't be started
// twice by accident.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { initiateMobilizationFromMatrix } from "@/app/mobilizations/actions";

const MOBILIZATION_TYPES = ["initial", "rotation_change", "replacement", "additional_manpower", "emergency", "demobilization"];
const PRIORITIES = ["normal", "urgent", "emergency"];

const inputCls = "border rounded-lg px-3 py-2 text-sm w-full mt-1";
const inputStyle = { borderColor: "var(--ch-line)" };
const lblStyle = { color: "var(--ch-sub)" };

type Result = {
  id: string;
  count: number;
  prefilled: number;
  unplaced: { name: string; reason: "extra" | "reserved_elsewhere" }[];
  generateError?: string;
};

export default function InitiateMobilization({
  crewMatrixId,
  defaultOnboardDate,
  assignedCount,
  existing,
}: {
  crewMatrixId: string;
  // Earliest Start Date among the assigned crew — just a starting value.
  defaultOnboardDate: string | null;
  assignedCount: number;
  existing: { id: string; mobilization_number: string | null; status: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [mobilizationType, setMobilizationType] = useState("initial");
  const [priority, setPriority] = useState("normal");
  const [requiredOnboardDate, setRequiredOnboardDate] = useState(defaultOnboardDate ?? "");
  const [crewChangeLocation, setCrewChangeLocation] = useState("");
  const [travelOrigin, setTravelOrigin] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");

  if (existing) {
    return (
      <Link
        href={`/mobilizations/${existing.id}`}
        className="text-xs font-semibold rounded-lg px-3 py-1.5 border"
        style={{ borderColor: "var(--ch-navy)", color: "var(--ch-navy)" }}
        title={`A mobilization request is already open for this matrix (${existing.status.replace(/_/g, " ")}).`}
      >
        View mobilization{existing.mobilization_number ? ` ${existing.mobilization_number}` : ""} →
      </Link>
    );
  }

  const submit = () => {
    if (!requiredOnboardDate || pending) return;
    setError(null);
    const fd = new FormData();
    fd.set("mobilizationType", mobilizationType);
    fd.set("priority", priority);
    fd.set("requiredOnboardDate", requiredOnboardDate);
    fd.set("crewChangeLocation", crewChangeLocation);
    fd.set("travelOrigin", travelOrigin);
    fd.set("specialInstructions", specialInstructions);
    startTransition(async () => {
      const res = await initiateMobilizationFromMatrix(crewMatrixId, fd);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if ("existing" in res) {
        // Someone started one a moment ago — go to it.
        router.push(`/mobilizations/${res.existing.id}`);
        return;
      }
      // Anything the user needs to read (people left out, or positions that
      // failed to generate) is shown before leaving; otherwise go straight in.
      if (res.unplaced.length > 0 || res.generateError) {
        setResult(res);
        return;
      }
      router.push(`/mobilizations/${res.id}`);
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold rounded-lg px-3 py-1.5"
        style={{ background: "var(--ch-navy)", color: "#fff" }}
        title="Create a mobilization request from this matrix and pre-fill it with the crew assigned below."
      >
        Initiate Mobilization
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 23, 42, 0.45)" }}
          onClick={() => !pending && !result && setOpen(false)}
        >
          <div
            className="bg-white border rounded-xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            style={{ borderColor: "var(--ch-line)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {result ? (
              <>
                <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>Mobilization request created</div>
                <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
                  {result.generateError
                    ? "The request was created, but its positions couldn't be generated automatically."
                    : `${result.prefilled} of ${result.count} positions were pre-filled from the assigned crew.`}
                </div>
                {result.generateError && (
                  <div className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{result.generateError}</div>
                )}
                {result.unplaced.some((u) => u.reason === "extra") && (
                  <div className="text-xs mb-2">
                    <span className="font-semibold" style={{ color: "var(--ch-fail)" }}>Assigned beyond the required headcount (no position):</span>{" "}
                    {result.unplaced.filter((u) => u.reason === "extra").map((u) => u.name).join(", ")}
                  </div>
                )}
                {result.unplaced.some((u) => u.reason === "reserved_elsewhere") && (
                  <div className="text-xs mb-2">
                    <span className="font-semibold" style={{ color: "var(--ch-fail)" }}>Already reserved on another mobilization (position left open):</span>{" "}
                    {result.unplaced.filter((u) => u.reason === "reserved_elsewhere").map((u) => u.name).join(", ")}
                  </div>
                )}
                <div className="flex justify-end mt-4">
                  <button
                    onClick={() => router.push(`/mobilizations/${result.id}`)}
                    className="text-sm font-semibold rounded-lg px-4 py-2"
                    style={{ background: "var(--ch-navy)", color: "#fff" }}
                  >
                    Open mobilization
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>Initiate mobilization</div>
                <div className="text-xs mb-4" style={lblStyle}>
                  Creates a mobilization request from this matrix and fills each position with the {assignedCount} crew member
                  {assignedCount === 1 ? "" : "s"} currently assigned. Project, site and client-approval requirements come across from the matrix.
                </div>
                {error && (
                  <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 mb-3">
                  <label className="text-xs" style={lblStyle}>
                    Mobilization type
                    <select className={inputCls} style={inputStyle} value={mobilizationType} onChange={(e) => setMobilizationType(e.target.value)}>
                      {MOBILIZATION_TYPES.map((t) => (
                        <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs" style={lblStyle}>
                    Priority
                    <select className={inputCls} style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="text-xs block mb-3" style={lblStyle}>
                  Required onboard date
                  <input type="date" className={inputCls} style={inputStyle} value={requiredOnboardDate} onChange={(e) => setRequiredOnboardDate(e.target.value)} />
                  <span className="block mt-1">Each position then takes its own crew member&apos;s Start Date.</span>
                </label>
                <div className="grid gap-3 sm:grid-cols-2 mb-3">
                  <label className="text-xs" style={lblStyle}>
                    Crew change location
                    <input className={inputCls} style={inputStyle} value={crewChangeLocation} onChange={(e) => setCrewChangeLocation(e.target.value)} />
                  </label>
                  <label className="text-xs" style={lblStyle}>
                    Travel origin
                    <input className={inputCls} style={inputStyle} value={travelOrigin} onChange={(e) => setTravelOrigin(e.target.value)} />
                  </label>
                </div>
                <label className="text-xs block mb-4" style={lblStyle}>
                  Special instructions
                  <textarea className={inputCls} style={inputStyle} rows={2} value={specialInstructions} onChange={(e) => setSpecialInstructions(e.target.value)} />
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    disabled={pending}
                    className="text-sm font-semibold rounded-lg px-4 py-2 border disabled:opacity-50"
                    style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={pending || !requiredOnboardDate}
                    className="text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
                    style={{ background: "var(--ch-navy)", color: "#fff" }}
                  >
                    {pending ? "Creating…" : "Create mobilization"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
