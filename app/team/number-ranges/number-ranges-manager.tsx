"use client";

import { useState, useTransition } from "react";
import { updateNumberRange } from "./actions";

type Range = {
  id: string;
  entity_type: "client" | "contractor";
  prefix: string;
  padding_length: number;
  current_number: number;
  is_active: boolean;
};

const ENTITY_LABELS: Record<Range["entity_type"], { title: string; help: string; defaultPrefix: string }> = {
  client: {
    title: "Client Codes",
    help: "Assigned automatically when a new Client is created in Crew Setup.",
    defaultPrefix: "CLI",
  },
  contractor: {
    title: "Contractor Codes",
    help: "Assigned automatically when a new EPC Contractor is created in Crew Setup.",
    defaultPrefix: "CON",
  },
};

function nextCodePreview(prefix: string, paddingLength: number, currentNumber: number) {
  const n = Number.isFinite(currentNumber) ? currentNumber : 0;
  const padding = Number.isFinite(paddingLength) && paddingLength > 0 ? paddingLength : 5;
  return `${prefix}${String(n + 1).padStart(padding, "0")}`;
}

export default function NumberRangesManager({ ranges }: { ranges: Range[] }) {
  const byType: Record<Range["entity_type"], Range | undefined> = {
    client: ranges.find((r) => r.entity_type === "client"),
    contractor: ranges.find((r) => r.entity_type === "contractor"),
  };

  return (
    <div className="space-y-4">
      {(["client", "contractor"] as const).map((entityType) => (
        <RangeCard key={entityType} entityType={entityType} range={byType[entityType]} />
      ))}
    </div>
  );
}

function RangeCard({ entityType, range }: { entityType: Range["entity_type"]; range?: Range }) {
  const meta = ENTITY_LABELS[entityType];
  const [prefix, setPrefix] = useState(range?.prefix ?? meta.defaultPrefix);
  const [paddingLength, setPaddingLength] = useState(range?.padding_length ?? 5);
  const [currentNumber, setCurrentNumber] = useState(range?.current_number ?? 0);
  const [isActive, setIsActive] = useState(range?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("prefix", prefix.trim());
    fd.set("paddingLength", String(paddingLength));
    fd.set("currentNumber", String(currentNumber));
    if (isActive) fd.set("isActive", "on");
    // Optimistic: show "Saved" immediately, let the write happen in the
    // background. If it turns out to have failed, surface the error —
    // the fields stay as typed so the user can just hit Save again.
    setSaved(true);
    startTransition(async () => {
      const res = await updateNumberRange(entityType, fd);
      if (res?.error) {
        setSaved(false);
        setError(res.error);
      }
    });
  };

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>
          {meta.title}
        </div>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Auto-numbering
          enabled
        </label>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
        {meta.help}
      </p>

      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Prefix
          <input
            className="border rounded-lg px-3 py-2 text-sm w-full mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            maxLength={10}
          />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Padding (digits)
          <input
            type="number"
            min={1}
            max={10}
            className="border rounded-lg px-3 py-2 text-sm w-full mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            value={paddingLength}
            onChange={(e) => setPaddingLength(Number(e.target.value))}
          />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Last number issued
          <input
            type="number"
            min={0}
            className="border rounded-lg px-3 py-2 text-sm w-full mt-1"
            style={{ borderColor: "var(--ch-line)" }}
            value={currentNumber}
            onChange={(e) => setCurrentNumber(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        Next code will be{" "}
        <span className="font-mono font-semibold" style={{ color: "var(--ch-navy)" }}>
          {nextCodePreview(prefix, paddingLength, currentNumber)}
        </span>
        . Changing &ldquo;Last number issued&rdquo; changes where the sequence continues from — use it to fix a
        gap, not routinely.
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold"
        >
          Save
        </button>
        {saved && !error && (
          <span className="text-xs font-semibold" style={{ color: "var(--ch-ok, #1a7f37)" }}>
            Saved
          </span>
        )}
      </div>

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
