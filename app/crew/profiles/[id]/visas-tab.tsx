"use client";

import { useState, type ReactNode } from "react";
import { getCrewDocumentFileUrl } from "../actions";
import type { VisaCard } from "@/lib/visa-card";

// The Visas tab on a crew profile: active visas as cards, expired and past
// visas as a table. Purely presentational — the cards are built on the server
// (see lib/visa-card.ts) and the edit / upload / add forms are passed in by
// the editor, so they are exactly the forms used on the Documents tab.

const PILL: Record<string, { bg: string; fg: string }> = {
  ok: { bg: "#e6f6ec", fg: "#1a7d3d" },
  warning: { bg: "#fff6e0", fg: "#9a6b00" },
  critical: { bg: "#ffe4d6", fg: "#c2410c" },
  expired: { bg: "#fbe0e0", fg: "#b3261e" },
  none: { bg: "#eef1f6", fg: "#6b7686" },
};

function niceDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
function niceStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function Pill({ severity, children }: { severity: string; children: ReactNode }) {
  const c = PILL[severity] ?? PILL.none;
  return (
    <span className="inline-block text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
      {children}
    </span>
  );
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>{label}</div>
      <div className="text-sm font-semibold tabular-nums" style={{ color: muted ? "var(--ch-sub)" : "var(--ch-ink)" }}>{value}</div>
    </div>
  );
}

function History({ card, defaultOpen }: { card: VisaCard; defaultOpen?: boolean }) {
  return (
    <details className="mt-3 pt-3 border-t border-dashed" style={{ borderColor: "var(--ch-line)" }} open={defaultOpen}>
      <summary className="cursor-pointer text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>
        History ({card.history.length} {card.history.length === 1 ? "event" : "events"})
      </summary>
      {card.history.length === 0 ? (
        <div className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>Nothing logged yet. Changes made from now on appear here.</div>
      ) : (
        <ul className="mt-3 ml-1 pl-4 border-l-2 list-none" style={{ borderColor: "var(--ch-line)" }}>
          {card.history.map((h, i) => (
            <li key={i} className="relative pb-2.5 pl-3 text-[13px]" style={{ color: "var(--ch-ink)" }}>
              <span className="absolute w-2.5 h-2.5 rounded-full" style={{ left: -22, top: 5, background: "var(--ch-navy)", border: "2px solid #fff" }} />
              <div>{h.text}</div>
              <div className="text-xs tabular-nums" style={{ color: "var(--ch-sub)" }}>
                {niceStamp(h.at)}
                {h.by ? ` · ${h.by}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export default function VisasTab({
  cards,
  canManage,
  addForm,
  editForm,
  uploadPanel,
  onAdd,
  onEdit,
  onUpload,
  editingId,
  uploadingId,
  adding,
  hasVisaTypes,
}: {
  cards: VisaCard[];
  canManage: boolean;
  adding: boolean;
  editingId: string | null;
  uploadingId: string | null;
  addForm: () => ReactNode;
  editForm: (id: string) => ReactNode;
  uploadPanel: (id: string) => ReactNode;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onUpload: (id: string) => void;
  hasVisaTypes: boolean;
}) {
  const active = cards.filter((c) => c.active);
  const past = cards.filter((c) => !c.active);
  const [view, setView] = useState<"active" | "past">("active");
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openFile = async (versionId: string | null) => {
    if (!versionId) return;
    setError(null);
    const res = await getCrewDocumentFileUrl(versionId);
    if (res?.error) {
      setError(res.error);
      return;
    }
    if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const linkCls = "text-xs font-semibold";
  const linkStyle = { color: "var(--ch-navy)" };

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="flex gap-0.5 rounded-lg border p-0.5 bg-white" style={{ borderColor: "var(--ch-line)" }}>
          {(["active", "past"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className="px-3 py-1 rounded-md text-xs font-semibold"
              style={view === k ? { background: "var(--ch-navy-soft)", color: "var(--ch-navy)" } : { color: "var(--ch-sub)" }}
            >
              {k === "active" ? `Active (${active.length})` : `Expired & past (${past.length})`}
            </button>
          ))}
        </div>
        <span className="text-xs flex-1 min-w-[200px]" style={{ color: "var(--ch-sub)" }}>
          Newest first. A visa moves to “Expired &amp; past” when it expires, its entry deadline passes, the permitted stay ends, or it is cancelled.
        </span>
        {canManage && !adding && (
          <button onClick={onAdd} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">
            + Add visa
          </button>
        )}
      </div>

      {error && <div className="text-sm mb-2" style={{ color: "var(--ch-fail)" }}>{error}</div>}
      {adding && <div className="mb-3">{addForm()}</div>}
      {canManage && !hasVisaTypes && !adding && (
        <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
          A “Visa” document type is set up automatically the first time you add a visa.
        </div>
      )}

      {view === "active" && (
        <div>
          {active.length === 0 && (
            <div className="bg-white border rounded-xl p-5 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
              No active visas.
            </div>
          )}
          {active.map((c) => {
            if (editingId === c.id) return <div key={c.id} className="mb-3">{editForm(c.id)}</div>;
            if (uploadingId === c.id) return <div key={c.id} className="mb-3">{uploadPanel(c.id)}</div>;
            const bar = c.keyPercent == null ? null : c.keyPercent;
            const barColor = c.keyDays != null && c.keyDays <= 14 ? "#d9531e" : c.keyDays != null && c.keyDays <= 30 ? "#d99a1b" : "#17803d";
            return (
              <div key={c.id} className="bg-white border rounded-xl p-4 mb-3" style={{ borderColor: "var(--ch-line)" }}>
                <div className="flex gap-3 items-start flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[15px]" style={{ color: "var(--ch-ink)" }}>{c.title}</span>
                      <Pill severity={c.severity}>{c.label}</Pill>
                    </div>
                    <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                      {[c.documentNumber ? `Visa #${c.documentNumber}` : null, c.sponsor ? `Sponsor: ${c.sponsor}` : null, c.recordedStatus ? `Status: ${c.recordedStatus}` : null]
                        .filter(Boolean)
                        .join(" · ") || "No details recorded yet"}
                    </div>
                  </div>
                  <div className="flex-1" />
                  <div className="flex gap-3.5 flex-wrap">
                    {c.latestVersionId && (
                      <button onClick={() => openFile(c.latestVersionId)} className={linkCls} style={linkStyle}>View file</button>
                    )}
                    {canManage && (
                      <>
                        <button onClick={() => onUpload(c.id)} className={linkCls} style={linkStyle}>
                          {c.latestVersionId ? "Upload new version" : "Upload file"}
                        </button>
                        <button onClick={() => onEdit(c.id)} className={linkCls} style={linkStyle}>Edit</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid gap-x-4 gap-y-3 mt-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
                  <Field label="Applied" value={niceDate(c.applicationDate)} />
                  <Field label="Issued" value={niceDate(c.issueDate)} />
                  <Field label="Expires" value={niceDate(c.expiryDate)} />
                  <Field label="Entered" value={c.entryDate ? niceDate(c.entryDate) : "Not yet"} muted={!c.entryDate} />
                  {c.planned && <Field label="Planned arrival" value={niceDate(c.planned.date)} />}
                </div>

                {(c.keyDate || c.stayText || c.planned || c.nextReminder) && (
                  <div className="mt-3.5 rounded-lg px-3 py-2.5 flex gap-x-6 gap-y-3 flex-wrap" style={{ background: "var(--ch-navy-soft)" }}>
                    {c.keyDate && (
                      <div>
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                          {c.mode === "enter_by" ? "Must enter by" : c.mode === "stay" ? "Stay allowed until" : "Valid until"}
                        </div>
                        <div className="font-bold text-sm">{niceDate(c.keyDate)}</div>
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                          {c.keyDays != null ? (c.keyDays < 0 ? `${-c.keyDays} days ago` : `${c.keyDays} days left`) : ""}
                          {c.mode === "validity" && c.entryType ? ` · ${c.entryType} entry` : ""}
                        </div>
                        {bar != null && (
                          <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: "#fff", minWidth: 160 }}>
                            <div className="h-full" style={{ width: `${bar}%`, background: barColor }} />
                          </div>
                        )}
                      </div>
                    )}
                    {c.stayText && c.mode === "enter_by" && (
                      <div>
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>Then may stay until</div>
                        <div className="font-bold text-sm">{c.stayText.split(" (")[0]}</div>
                        {c.stayText.includes(" (") && (
                          <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{c.stayText.slice(c.stayText.indexOf("(") + 1, -1)}</div>
                        )}
                      </div>
                    )}
                    {c.planned && (
                      <div>
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>Planned arrival check</div>
                        {c.planned.ok ? (
                          <div className="font-bold text-sm" style={{ color: "#17803d" }}>Within the deadline</div>
                        ) : (
                          c.planned.messages.map((m, i) => (
                            <div key={i} className="font-semibold text-sm max-w-xs" style={{ color: "#c2410c" }}>{m}</div>
                          ))
                        )}
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{c.planned.label}</div>
                      </div>
                    )}
                    {c.nextReminder && (
                      <div>
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>Next reminder</div>
                        <div className="font-bold text-sm">{niceDate(c.nextReminder.date)}</div>
                        <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{c.nextReminder.text}</div>
                      </div>
                    )}
                  </div>
                )}

                <History card={c} />
              </div>
            );
          })}
        </div>
      )}

      {view === "past" && (
        <div>
          <div className="bg-white border rounded-xl overflow-x-auto" style={{ borderColor: "var(--ch-line)" }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
                  {["Country · type", "Outcome", "Issued", "Expired / ended", "Entered", "File"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {past.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4" style={{ color: "var(--ch-sub)" }}>No expired or past visas.</td></tr>
                )}
                {past.map((c) => {
                  if (editingId === c.id) return <tr key={c.id}><td colSpan={6} className="p-3">{editForm(c.id)}</td></tr>;
                  if (uploadingId === c.id) return <tr key={c.id}><td colSpan={6} className="p-3">{uploadPanel(c.id)}</td></tr>;
                  return (
                    <>
                      <tr key={c.id} className="border-t align-top" style={{ borderColor: "var(--ch-line)" }}>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>{c.title}</div>
                          <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                            {[c.documentNumber ? `#${c.documentNumber}` : null, c.sponsor ? `Sponsor: ${c.sponsor}` : null].filter(Boolean).join(" · ")}
                          </div>
                          <div className="flex gap-3 mt-1">
                            <button onClick={() => setOpenHistory(openHistory === c.id ? null : c.id)} className={linkCls} style={linkStyle}>
                              {openHistory === c.id ? "Hide history" : "History"}
                            </button>
                            {canManage && <button onClick={() => onEdit(c.id)} className={linkCls} style={linkStyle}>Edit</button>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Pill severity={c.state === "cancelled" ? "none" : "expired"}>{c.label}</Pill>
                          {c.outcomeNote && <div className="text-xs mt-0.5" style={{ color: "var(--ch-sub)" }}>{c.outcomeNote}</div>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{niceDate(c.issueDate)}</td>
                        <td className="px-3 py-2.5 tabular-nums">{niceDate(c.endedOn ?? c.expiryDate)}</td>
                        <td className="px-3 py-2.5 tabular-nums">{niceDate(c.entryDate)}</td>
                        <td className="px-3 py-2.5">
                          {c.latestVersionId ? (
                            <button onClick={() => openFile(c.latestVersionId)} className={linkCls} style={linkStyle}>View</button>
                          ) : (
                            <span style={{ color: "var(--ch-sub)" }}>—</span>
                          )}
                        </td>
                      </tr>
                      {openHistory === c.id && (
                        <tr key={c.id + "-h"}>
                          <td colSpan={6} className="px-3 pb-3"><History card={c} defaultOpen /></td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>Past visas stay on record with their files and history. Nothing is deleted.</p>
        </div>
      )}
    </div>
  );
}
