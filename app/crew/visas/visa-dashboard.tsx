"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { VISA_GROUPS, visaGroupOf, type VisaGroup } from "@/lib/visa-groups";
import type { VisaRow, NoVisaRow } from "./visa-tracker";

// The Dashboard tab of the Visa Tracker: one current visa per person, counted
// into six groups, with an expiry timeline and the list of people who need
// action in the next 14 days. Tiles and bar segments open the Visas list
// already filtered (onOpen).

export type DashboardOpen = { label: string; test: (r: VisaRow) => boolean };

const NO_COUNTRY = "Country not set";
const groupMeta = (k: VisaGroup) => VISA_GROUPS.find((g) => g.key === k)!;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

type Tip = { x: number; y: number; text: string } | null;

export default function VisaDashboard({
  rows,
  noVisa,
  today,
  onOpen,
}: {
  rows: VisaRow[]; // one current visa per active person
  noVisa: NoVisaRow[];
  today: string;
  onOpen: (f: DashboardOpen) => void;
}) {
  const [country, setCountry] = useState("");
  const [tip, setTip] = useState<Tip>(null);

  const countries = useMemo(() => Array.from(new Set(rows.map((r) => r.country ?? NO_COUNTRY))).sort(), [rows]);
  const inScope = useMemo(() => (country ? rows.filter((r) => (r.country ?? NO_COUNTRY) === country) : rows), [rows, country]);
  const noneCount = country ? 0 : noVisa.length;
  const people = inScope.length + noneCount;

  const groupOf = (r: VisaRow): VisaGroup => visaGroupOf(r.state);
  const counts = useMemo(() => {
    const c: Record<VisaGroup, number> = { valid: 0, expiring: 0, awaiting: 0, newvisa: 0, expired: 0, other: 0 };
    for (const r of inScope) c[groupOf(r)]++;
    c.other += noneCount;
    return c;
  }, [inScope, noneCount]);

  const soon30 = inScope.filter((r) => groupOf(r) === "expiring" && r.keyDays != null && r.keyDays <= 30).length;
  const enter14 = inScope.filter((r) => groupOf(r) === "awaiting" && r.keyDays != null && r.keyDays <= 14).length;
  const pct = people ? Math.round((counts.valid / people) * 100) : 0;

  // Stacked bars: All countries, then each country (and "No visa on file").
  const stackRows = useMemo(() => {
    const mk = (name: string, list: VisaRow[], extraOther: number, filterCountry: string | null) => {
      const c: Record<VisaGroup, number> = { valid: 0, expiring: 0, awaiting: 0, newvisa: 0, expired: 0, other: extraOther };
      for (const r of list) c[visaGroupOf(r.state)]++;
      return { name, c, total: list.length + extraOther, filterCountry };
    };
    if (country) return [mk(country, inScope, 0, country)];
    const out = [mk("All countries", rows, noVisa.length, null)];
    for (const c of countries) out.push(mk(c, rows.filter((r) => (r.country ?? NO_COUNTRY) === c), 0, c));
    if (noVisa.length) out.push(mk("No visa on file", [], noVisa.length, null));
    return out;
  }, [rows, inScope, country, countries, noVisa.length]);

  // Timeline: valid / expiring visas by the month their expiry (or end of stay) falls in.
  const months = useMemo(() => {
    const start = new Date(today + "T00:00:00");
    const list = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-GB", { month: "short" }).replace("Sept", "Sep"), year: d.getFullYear(), n: 0 };
    });
    for (const r of inScope) {
      const g = groupOf(r);
      if ((g === "valid" || g === "expiring") && r.keyDate && r.keyDays != null && r.keyDays >= 0) {
        const m = list.find((x) => x.key === r.keyDate!.slice(0, 7));
        if (m) m.n++;
      }
    }
    return list;
  }, [inScope, today]);
  const maxMonth = Math.max(5, ...months.map((m) => m.n));
  const top = Math.ceil(maxMonth / 10) * 10;
  const next3 = months.slice(0, 3).reduce((a, m) => a + m.n, 0);
  const total12 = months.reduce((a, m) => a + m.n, 0);

  // Needs action in the next 14 days.
  const actionTest = (r: VisaRow) => {
    const g = groupOf(r);
    const d = r.keyDays;
    if (d == null) return false;
    if (g === "awaiting") return d <= 14;
    if (g === "expiring") return d <= 14;
    if (g === "expired" || g === "newvisa") return d >= -30;
    return false;
  };
  const priority = (r: VisaRow) => {
    const g = groupOf(r);
    const d = r.keyDays ?? 0;
    return g === "awaiting" ? d - 100 : g === "expiring" ? d - 90 : d + 60;
  };
  const actions = useMemo(() => inScope.filter(actionTest).sort((a, b) => priority(a) - priority(b)), [inScope]); // eslint-disable-line react-hooks/exhaustive-deps

  const describe = (r: VisaRow): { what: string; action: string } => {
    const g = groupOf(r);
    const d = r.keyDays ?? 0;
    if (g === "awaiting") return { what: `Must enter by ${fmt(r.keyDate)} (${d} days left)`, action: "Arrange travel" };
    if (g === "expiring") return { what: `${r.keyLabel === "Stay until" ? "Stay ends" : "Expires"} ${fmt(r.keyDate)} (${d} days left)`, action: r.keyLabel === "Stay until" ? "Extend or exit" : "Start renewal" };
    if (g === "expired") return { what: `Expired ${-d} days ago (${fmt(r.keyDate)})`, action: "Renew now" };
    return { what: r.state === "stay_ended" ? `Permitted stay ended ${-d} days ago` : `Entry deadline passed ${-d} days ago`, action: "Apply for a new visa" };
  };

  // By visa type.
  const byType = useMemo(() => {
    const m = new Map<string, { n: number; valid: number; expiring: number; expired: number }>();
    for (const r of inScope) {
      const key = [r.country, r.visaTypeName].filter(Boolean).join(" · ") || "Type not set";
      const o = m.get(key) ?? { n: 0, valid: 0, expiring: 0, expired: 0 };
      o.n++;
      const g = groupOf(r);
      if (g === "valid") o.valid++;
      if (g === "expiring") o.expiring++;
      if (g === "expired") o.expired++;
      m.set(key, o);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [inScope]);

  const tipProps = (text: string) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
    onMouseLeave: () => setTip(null),
  });
  const scopeCountry = (r: VisaRow) => !country || (r.country ?? NO_COUNTRY) === country;
  const openGroup = (label: string, g: VisaGroup, within?: number) =>
    onOpen({
      label,
      test: (r) => scopeCountry(r) && groupOf(r) === g && (within == null || (r.keyDays != null && r.keyDays <= within)),
    });

  const tile = (label: string, value: number, g: VisaGroup, within?: number) => (
    <button
      type="button"
      onClick={() => openGroup(label, g, within)}
      className={`${cardCls} px-4 py-3 text-left hover:border-[var(--ch-navy)]`}
      style={cardStyle}
    >
      <div className="text-2xl font-bold tabular-nums" style={{ color: groupMeta(g).textColor }}>{value}</div>
      <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{label}</div>
      <div className="text-[11px] font-semibold mt-2" style={{ color: "var(--ch-navy)" }}>Open list ›</div>
    </button>
  );

  // Chart geometry for the timeline.
  const W = 560, H = 230, L = 34, B = 28, T = 22;
  const iw = W - L - 6, ih = H - T - B, bw = iw / 12;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex gap-0.5 rounded-lg border p-0.5 bg-white flex-wrap" style={{ borderColor: "var(--ch-line)" }}>
          {["", ...countries].map((c) => (
            <button
              key={c || "all"}
              onClick={() => setCountry(c)}
              className="px-3 py-1 rounded-md text-xs font-semibold"
              style={country === c ? { background: "var(--ch-navy-soft)", color: "var(--ch-navy)" } : { color: "var(--ch-sub)" }}
            >
              {c || "All countries"}
            </button>
          ))}
        </div>
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Counted as of {fmt(today)} · one current visa per person</span>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 mb-4">
        <div className={`${cardCls} p-4 col-span-2`} style={cardStyle}>
          <div className="text-xs" style={{ color: "var(--ch-sub)" }}>People with a valid visa today</div>
          <div className="text-3xl font-bold tabular-nums leading-tight">
            {counts.valid} <span className="text-sm font-semibold" style={{ color: "var(--ch-sub)" }}>of {people} · {pct}%</span>
          </div>
          <div className="flex gap-0.5 h-2.5 rounded-full overflow-hidden my-2.5" style={{ background: "#eef2f7" }}>
            {VISA_GROUPS.map((g) =>
              counts[g.key] ? <i key={g.key} {...tipProps(`${g.label}: ${counts[g.key]}`)} style={{ display: "block", width: `${(counts[g.key] / Math.max(people, 1)) * 100}%`, background: g.color }} /> : null
            )}
          </div>
          <div className="text-xs" style={{ color: "var(--ch-sub)" }}>Everyone else is expiring, expired, waiting to enter, or needs a new visa.</div>
        </div>
        {tile("Expiring in 30 days", soon30, "expiring", 30)}
        {tile("Enter within 14 days", enter14, "awaiting", 14)}
        {tile("Expired", counts.expired, "expired")}
        {tile("Needs a new visa", counts.newvisa, "newvisa")}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr] mb-4">
        <div className={`${cardCls} p-4 min-w-0`} style={cardStyle}>
          <div className="text-sm font-bold">Where each person stands</div>
          <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>Current visa of each person, by country.</div>
          {stackRows.map((s) => (
            <div key={s.name} className="grid items-center gap-2.5 mb-2" style={{ gridTemplateColumns: "120px 1fr 40px" }}>
              <div className="text-xs font-semibold truncate" title={s.name}>{s.name}</div>
              <div className="flex gap-0.5 h-[30px]">
                {VISA_GROUPS.map((g) => {
                  const v = s.c[g.key];
                  if (!v) return null;
                  const w = (v / Math.max(s.total, 1)) * 100;
                  return (
                    <button
                      type="button"
                      key={g.key}
                      onClick={() => onOpen({ label: `${g.label}${s.filterCountry ? ` · ${s.filterCountry}` : ""}`, test: (r) => groupOf(r) === g.key && (!s.filterCountry || (r.country ?? NO_COUNTRY) === s.filterCountry) })}
                      {...tipProps(`${s.name} · ${g.label}: ${v} (${Math.round(w)}%)`)}
                      className="h-full rounded flex items-center justify-center text-[11px] font-bold tabular-nums overflow-hidden min-w-0"
                      style={{ width: `${w}%`, background: g.color, color: g.onColor }}
                    >
                      {w >= 6 ? v : ""}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-right tabular-nums" style={{ color: "var(--ch-sub)" }}>{s.total}</div>
            </div>
          ))}
          <div className="flex gap-x-3.5 gap-y-1.5 flex-wrap mt-3 text-xs" style={{ color: "var(--ch-sub)" }}>
            {VISA_GROUPS.map((g) => (
              <span key={g.key}>
                <span className="inline-block w-2.5 h-2.5 rounded-[3px] mr-1.5" style={{ background: g.color }} />
                {g.label} <b style={{ color: "var(--ch-ink)" }} className="tabular-nums">{counts[g.key]}</b>
              </span>
            ))}
          </div>
        </div>

        <div className={`${cardCls} p-4 min-w-0`} style={cardStyle}>
          <div className="text-sm font-bold">Visas expiring, next 12 months</div>
          <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>Number of visas reaching their expiry date or end of stay in each month.</div>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Visas expiring per month for the next 12 months" className="block max-w-full h-auto">
            {[0, 0.5, 1].map((f) => {
              const y = T + ih - ih * f;
              return (
                <g key={f}>
                  <line x1={L} x2={W - 6} y1={y} y2={y} stroke="#e8ebf0" strokeWidth={1} />
                  <text x={L - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#556070">{Math.round(top * f)}</text>
                </g>
              );
            })}
            {months.map((m, i) => {
              const h = (ih * m.n) / top;
              const bx = L + i * bw + bw * 0.16;
              const w = bw * 0.68;
              const y = T + ih - h;
              return (
                <g key={m.key}>
                  <rect
                    x={bx}
                    y={y}
                    width={w}
                    height={Math.max(h, 0)}
                    rx={3}
                    fill={i < 3 ? "#fab219" : "#2a78d6"}
                    {...tipProps(`${m.label} ${m.year}: ${m.n} visa${m.n === 1 ? "" : "s"} ending`)}
                  />
                  {m.n > 0 && <text x={bx + w / 2} y={y - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="#161a22">{m.n}</text>}
                  <text x={bx + w / 2} y={H - 10} textAnchor="middle" fontSize={11} fill="#556070">{m.label}</text>
                </g>
              );
            })}
          </svg>
          <div className="text-xs mt-2.5" style={{ color: "var(--ch-sub)" }}>
            <span className="inline-block w-2.5 h-2.5 rounded-[3px] mr-1.5" style={{ background: "#fab219" }} />
            <b style={{ color: "var(--ch-ink)" }}>{next3}</b> end in the next three months, out of <b style={{ color: "var(--ch-ink)" }}>{total12}</b> in the next 12.
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr] mb-4">
        <div className={`${cardCls} p-4 min-w-0`} style={cardStyle}>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-bold">Needs action in the next 14 days</div>
              <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
                {actions.length} {actions.length === 1 ? "person" : "people"}. Entry deadlines, visas about to end, and visas that ended in the last 30 days.
              </div>
            </div>
            {actions.length > 8 && (
              <button type="button" className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }} onClick={() => onOpen({ label: "Needs action in the next 14 days", test: (r) => scopeCountry(r) && actionTest(r) })}>
                Open all {actions.length} ›
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
                  <th className="px-2.5 py-2 font-semibold">Crew member</th>
                  <th className="px-2.5 py-2 font-semibold">Country · type</th>
                  <th className="px-2.5 py-2 font-semibold">What is happening</th>
                  <th className="px-2.5 py-2 font-semibold">Action</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {actions.length === 0 && (
                  <tr><td colSpan={5} className="px-2.5 py-3" style={{ color: "var(--ch-sub)" }}>Nothing needs action in the next 14 days.</td></tr>
                )}
                {actions.slice(0, 8).map((r) => {
                  const g = groupMeta(groupOf(r));
                  const { what, action } = describe(r);
                  return (
                    <tr key={r.docId} className="border-t align-top" style={{ borderColor: "var(--ch-line)" }}>
                      <td className="px-2.5 py-2">
                        <div className="font-semibold">{r.crewName}</div>
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{[r.roleName, r.siteName].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td className="px-2.5 py-2">{[r.country, r.visaTypeName].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-2.5 py-2">
                        <span className="text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: g.pillBg, color: g.textColor }}>
                          {groupOf(r) === "newvisa" ? "Needs a new visa" : r.label}
                        </span>
                        <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>{what}</div>
                      </td>
                      <td className="px-2.5 py-2">{action}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <Link href={`/crew/profiles/${r.crewId}?tab=visas`} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Open profile ›</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${cardCls} p-4 min-w-0`} style={cardStyle}>
          <div className="text-sm font-bold">By visa type</div>
          <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>People whose current visa is of each type.</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
                  <th className="px-2.5 py-2 font-semibold">Type</th>
                  <th className="px-2.5 py-2 font-semibold text-right">People</th>
                  <th className="px-2.5 py-2 font-semibold text-right">Valid</th>
                  <th className="px-2.5 py-2 font-semibold text-right">Expiring</th>
                  <th className="px-2.5 py-2 font-semibold text-right">Expired</th>
                </tr>
              </thead>
              <tbody>
                {byType.map(([k, o]) => (
                  <tr key={k} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                    <td className="px-2.5 py-2">{k}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{o.n}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{o.valid}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{o.expiring}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{o.expired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {tip && (
        <div
          className="fixed z-50 pointer-events-none text-xs rounded-md px-2.5 py-1.5 max-w-[260px]"
          style={{ left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 280), top: tip.y + 14, background: "#161a22", color: "#fff" }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
