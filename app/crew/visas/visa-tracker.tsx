"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type VisaRow = {
  docId: string;
  crewId: string;
  crewName: string;
  roleName: string | null;
  siteName: string | null;
  employmentStatus: string;
  country: string | null;
  visaTypeName: string | null;
  documentTypeName: string;
  documentNumber: string | null;
  recordedStatus: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  entryDate: string | null;
  state: string;
  severity: "ok" | "warning" | "critical" | "expired" | "none";
  label: string;
  detail: string;
  keyLabel: string;
  keyDate: string | null;
  keyDays: number | null;
};
export type NoVisaRow = { crewId: string; crewName: string; roleName: string | null; siteName: string | null };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

const SEVERITY_COLORS: Record<VisaRow["severity"], { bg: string; fg: string }> = {
  ok: { bg: "#e6f6ec", fg: "#1a7d3d" },
  warning: { bg: "#fff6e0", fg: "#9a6b00" },
  critical: { bg: "#ffe4d6", fg: "#c2410c" },
  expired: { bg: "#fbe0e0", fg: "#b3261e" },
  none: { bg: "#eef1f6", fg: "#6b7686" },
};
const SEVERITY_RANK: Record<VisaRow["severity"], number> = { expired: 0, critical: 1, warning: 2, none: 3, ok: 4 };

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

type View = "visas" | "none";

export default function VisaTracker({
  rows,
  noVisa,
  today,
  noVisaDocType,
}: {
  rows: VisaRow[];
  noVisa: NoVisaRow[];
  today: string;
  noVisaDocType: boolean;
}) {
  const [view, setView] = useState<View>("visas");
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [visaType, setVisaType] = useState("");
  const [attention, setAttention] = useState(false);
  const [withinDays, setWithinDays] = useState("");

  const countries = useMemo(() => Array.from(new Set(rows.map((r) => r.country).filter((c): c is string => !!c))).sort(), [rows]);
  const types = useMemo(
    () => Array.from(new Set(rows.filter((r) => !country || r.country === country).map((r) => r.visaTypeName).filter((c): c is string => !!c))).sort(),
    [rows, country]
  );

  const counts = useMemo(() => {
    const c = { total: rows.length, attention: 0, expired: 0, awaiting: 0, valid: 0 };
    for (const r of rows) {
      if (r.severity === "expired") c.expired++;
      if (r.severity === "expired" || r.severity === "critical" || r.severity === "warning") c.attention++;
      if (r.state === "awaiting_entry" || r.state === "enter_soon") c.awaiting++;
      if (r.state === "valid") c.valid++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const n = withinDays ? Number(withinDays) : null;
    return rows
      .filter((r) => !q || r.crewName.toLowerCase().includes(q) || (r.documentNumber ?? "").toLowerCase().includes(q))
      .filter((r) => !country || r.country === country)
      .filter((r) => !visaType || r.visaTypeName === visaType)
      .filter((r) => !attention || r.severity === "expired" || r.severity === "critical" || r.severity === "warning")
      .filter((r) => n == null || (r.keyDays != null && r.keyDays <= n))
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.keyDays ?? 99999) - (b.keyDays ?? 99999) || a.crewName.localeCompare(b.crewName));
  }, [rows, search, country, visaType, attention, withinDays]);

  const filteredNone = useMemo(() => {
    const q = search.trim().toLowerCase();
    return noVisa.filter((r) => !q || r.crewName.toLowerCase().includes(q));
  }, [noVisa, search]);

  const tile = (label: string, value: number, color?: string) => (
    <div className={`${cardCls} px-4 py-3`} style={cardStyle}>
      <div className="text-2xl font-bold" style={{ color: color ?? "var(--ch-ink)" }}>{value}</div>
      <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{label}</div>
    </div>
  );

  return (
    <div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5 mb-4">
        {tile("Visas on record", counts.total)}
        {tile("Need attention", counts.attention, counts.attention ? "#c2410c" : undefined)}
        {tile("Expired or missed", counts.expired, counts.expired ? "#b3261e" : undefined)}
        {tile("Awaiting entry", counts.awaiting)}
        {tile("People with no visa", noVisa.length, noVisa.length ? "#9a6b00" : undefined)}
      </div>

      <div className="flex items-center gap-1 rounded-lg border p-1 mb-4 w-fit" style={{ borderColor: "var(--ch-line)" }}>
        {([["visas", `Visas (${rows.length})`], ["none", `No visa on file (${noVisa.length})`]] as [View, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap"
            style={view === k ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-3 flex-wrap mb-4">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Search
          <input className={`${inputCls} block mt-1`} style={inputStyle} placeholder="Name or visa number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {view === "visas" && (
          <>
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Country
              <select className={`${inputCls} block mt-1`} style={inputStyle} value={country} onChange={(e) => { setCountry(e.target.value); setVisaType(""); }}>
                <option value="">All</option>
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Visa type
              <select className={`${inputCls} block mt-1`} style={inputStyle} value={visaType} onChange={(e) => setVisaType(e.target.value)}>
                <option value="">All</option>
                {types.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Key date within (days)
              <input type="number" min={0} className={`${inputCls} block mt-1 w-28`} style={inputStyle} placeholder="any" value={withinDays} onChange={(e) => setWithinDays(e.target.value)} />
            </label>
            <label className="flex items-center gap-1.5 text-xs pb-2" style={{ color: "var(--ch-ink)" }}>
              <input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Needs attention only
            </label>
          </>
        )}
      </div>

      {view === "visas" ? (
        <div className={`${cardCls} overflow-x-auto`} style={cardStyle}>
          {noVisaDocType && (
            <div className="p-4 text-sm" style={{ color: "var(--ch-sub)" }}>
              No document type is in the Visa category yet. Add one under Crew Setup → Document Types (category: Visa), then record visas on crew profiles.
            </div>
          )}
          {!noVisaDocType && filtered.length === 0 && (
            <div className="p-4 text-sm" style={{ color: "var(--ch-sub)" }}>{rows.length === 0 ? "No visas recorded yet." : "No visas match these filters."}</div>
          )}
          {filtered.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: "var(--ch-sub)" }}>
                  <th className="px-3 py-2 font-semibold">Crew member</th>
                  <th className="px-3 py-2 font-semibold">Country · type</th>
                  <th className="px-3 py-2 font-semibold">State</th>
                  <th className="px-3 py-2 font-semibold">Key date</th>
                  <th className="px-3 py-2 font-semibold">Issued</th>
                  <th className="px-3 py-2 font-semibold">Expires</th>
                  <th className="px-3 py-2 font-semibold">Entered</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const c = SEVERITY_COLORS[r.severity];
                  return (
                    <tr key={r.docId} className="border-t align-top" style={{ borderColor: "var(--ch-line)" }}>
                      <td className="px-3 py-2">
                        <Link href={`/crew/profiles/${r.crewId}?tab=documents`} className="font-semibold ch-link-navy">{r.crewName}</Link>
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{[r.roleName, r.siteName].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{[r.country, r.visaTypeName].filter(Boolean).join(" · ") || <span style={{ color: "var(--ch-sub)" }}>Type not set</span>}</div>
                        {r.documentNumber && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>#{r.documentNumber}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>{r.label}</span>
                        {r.recordedStatus && <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>Recorded: {r.recordedStatus}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.keyDate ? (
                          <>
                            <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{r.keyLabel}</div>
                            <div className="font-medium">{fmt(r.keyDate)}</div>
                            {r.keyDays != null && (
                              <div className="text-xs" style={{ color: r.keyDays < 0 ? "#b3261e" : "var(--ch-sub)" }}>
                                {r.keyDays < 0 ? `${-r.keyDays} days ago` : `in ${r.keyDays} days`}
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ color: "var(--ch-sub)" }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(r.issueDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(r.expiryDate)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(r.entryDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className={`${cardCls} overflow-x-auto`} style={cardStyle}>
          {filteredNone.length === 0 ? (
            <div className="p-4 text-sm" style={{ color: "var(--ch-sub)" }}>{noVisa.length === 0 ? "Everyone has a visa on record." : "No one matches that search."}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: "var(--ch-sub)" }}>
                  <th className="px-3 py-2 font-semibold">Crew member</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">Site</th>
                </tr>
              </thead>
              <tbody>
                {filteredNone.map((r) => (
                  <tr key={r.crewId} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                    <td className="px-3 py-2"><Link href={`/crew/profiles/${r.crewId}?tab=documents`} className="font-semibold ch-link-navy">{r.crewName}</Link></td>
                    <td className="px-3 py-2">{r.roleName ?? "—"}</td>
                    <td className="px-3 py-2">{r.siteName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="text-xs mt-3" style={{ color: "var(--ch-sub)" }}>
        State is worked out as of {fmt(today)} from each visa&apos;s dates and its visa type&apos;s rules. &quot;Key date&quot; is the next date that matters: the entry deadline until the person has entered, then the end of their stay (or the visa expiry).
      </div>
    </div>
  );
}
