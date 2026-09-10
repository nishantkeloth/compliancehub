"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMobilizationRequest, generatePositionsFromMatrix } from "../actions";

type MatrixOption = { id: string; label: string; site_name: string; project_name: string; status: string };
type Profile = { id: string; full_name: string };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

const MOBILIZATION_TYPES = ["initial", "rotation_change", "replacement", "additional_manpower", "emergency", "demobilization"];
const PRIORITIES = ["normal", "urgent", "emergency"];

export default function NewMobilizationForm({ matrices, profiles }: { matrices: MatrixOption[]; profiles: Profile[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [crewMatrixId, setCrewMatrixId] = useState(matrices[0]?.id ?? "");
  const [mobilizationType, setMobilizationType] = useState("initial");
  const [requiredOnboardDate, setRequiredOnboardDate] = useState("");
  const [crewChangeLocation, setCrewChangeLocation] = useState("");
  const [travelOrigin, setTravelOrigin] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [priority, setPriority] = useState("normal");
  const [coordinatorUserId, setCoordinatorUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMatrix = matrices.find((m) => m.id === crewMatrixId);

  const submit = () => {
    if (!crewMatrixId || !requiredOnboardDate || submitting) return;
    setError(null);
    setSubmitting(true);
    const fd = new FormData();
    fd.set("crewMatrixId", crewMatrixId);
    fd.set("mobilizationType", mobilizationType);
    fd.set("requiredOnboardDate", requiredOnboardDate);
    fd.set("crewChangeLocation", crewChangeLocation);
    fd.set("travelOrigin", travelOrigin);
    fd.set("specialInstructions", specialInstructions);
    fd.set("priority", priority);
    fd.set("coordinatorUserId", coordinatorUserId);
    startTransition(async () => {
      const res = await createMobilizationRequest(fd);
      if (res?.error) {
        setSubmitting(false);
        setError(res.error);
        return;
      }
      if (res?.id) {
        const genRes = await generatePositionsFromMatrix(res.id);
        if (genRes?.error) {
          // The request itself was created fine — just take the user
          // there so they can generate positions manually.
          router.push(`/mobilizations/${res.id}`);
          return;
        }
        router.push(`/mobilizations/${res.id}`);
      }
    });
  };

  if (matrices.length === 0) {
    return (
      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
          No approved or active crew matrices are available yet. Approve a crew matrix first, then come back here.
        </div>
      </div>
    );
  }

  return (
    <div className={`${cardCls} p-4 max-w-2xl`} style={cardStyle}>
      {error && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>
      )}

      <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
        Crew matrix
        <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={crewMatrixId} onChange={(e) => setCrewMatrixId(e.target.value)}>
          {matrices.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>
      {selectedMatrix && (
        <div className="text-xs mt-1 mb-3" style={{ color: "var(--ch-sub)" }}>
          {selectedMatrix.site_name} · {selectedMatrix.project_name}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 mt-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Mobilization type
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={mobilizationType} onChange={(e) => setMobilizationType(e.target.value)}>
            {MOBILIZATION_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Priority
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Required onboard date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={requiredOnboardDate} onChange={(e) => setRequiredOnboardDate(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Coordinator
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={coordinatorUserId} onChange={(e) => setCoordinatorUserId(e.target.value)}>
            <option value="">—</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Crew change location
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={crewChangeLocation} onChange={(e) => setCrewChangeLocation(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Travel origin
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={travelOrigin} onChange={(e) => setTravelOrigin(e.target.value)} />
        </label>
      </div>

      <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
        Special instructions
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={specialInstructions} onChange={(e) => setSpecialInstructions(e.target.value)} />
      </label>

      <p className="text-xs mt-3 mb-3" style={{ color: "var(--ch-sub)" }}>
        Positions will be generated automatically from the selected matrix&rsquo;s lines once you save.
      </p>

      <button
        onClick={submit}
        disabled={submitting || !crewMatrixId || !requiredOnboardDate}
        className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create mobilization request"}
      </button>
    </div>
  );
}
