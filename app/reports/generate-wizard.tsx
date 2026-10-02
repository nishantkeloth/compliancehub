"use client";

// Client Compliance Reports — "Generate & Send" wizard. Two steps:
// review (every row, with expired/critical cells called out, exactly as
// the phase10 requirement doc insists stays mandatory even once this is
// trusted) then recipients + message. Sending re-fetches and re-builds
// everything server-side (see app/reports/actions.ts's sendClientReport)
// — this screen's table is a preview, never the source of truth.

import { useEffect, useMemo, useState } from "react";
import { getClientReportPreview, sendClientReport } from "./actions";
import { resolveColumn, type ReportColumn, type ReportCrewRow, type ReportDocTypeRef } from "@/lib/reports/report-columns";
import { DOCUMENT_STATUS_COLORS } from "@/lib/document-status";

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

type Contact = { id: string; fullName: string; email: string; title: string | null };
type Recipient = { key: string; name: string; email: string; clientContactId: string | null };

export default function GenerateReportWizard({ siteId, siteName, onClose }: { siteId: string; siteName: string; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientName, setClientName] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [docTypes, setDocTypes] = useState<ReportDocTypeRef[]>([]);
  const [rows, setRows] = useState<ReportCrewRow[]>([]);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const [selected, setSelected] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResults, setSendResults] = useState<{ name: string; email: string; status: "sent" | "failed"; error?: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getClientReportPreview(siteId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      if (!res || "error" in res) return;
      setClientName(res.clientName ?? null);
      setTemplateName(res.templateName ?? null);
      setColumns(res.columns ?? []);
      setDocTypes(res.docTypes ?? []);
      setRows(res.rows ?? []);
      setFlaggedCount(res.flaggedCount ?? 0);
      setContacts(res.contacts ?? []);
      setSubject(`${siteName} — Crew Compliance Report`);
      setBodyText(`Please find attached the current crew roster and document compliance status for ${siteName}.`);
    });
    return () => {
      cancelled = true;
    };
  }, [siteId, siteName]);

  const docTypesById = useMemo(() => new Map(docTypes.map((d) => [d.id, d])), [docTypes]);

  const toggleContact = (c: Contact) => {
    setSelected((prev) => {
      const exists = prev.find((r) => r.clientContactId === c.id);
      if (exists) return prev.filter((r) => r.clientContactId !== c.id);
      return [...prev, { key: c.id, name: c.fullName, email: c.email, clientContactId: c.id }];
    });
  };

  const handleSend = () => {
    setSendError(null);
    setSending(true);
    sendClientReport({
      siteId,
      recipients: selected.map((r) => ({ clientContactId: r.clientContactId, name: r.name, email: r.email })),
      subject,
      bodyText,
    }).then((res) => {
      setSending(false);
      if (res?.error) {
        setSendError(res.error);
        return;
      }
      setSendResults(res?.results ?? []);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`${cardCls} w-full max-w-4xl max-h-[90vh] overflow-y-auto`} style={cardStyle}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--ch-line)" }}>
          <div>
            <div className="font-semibold">Generate & Send Report — {siteName}</div>
            <div className={lbl} style={lblStyle}>
              {clientName ? `Client: ${clientName}` : ""} {templateName ? `· Template: ${templateName}` : ""}
            </div>
          </div>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--ch-sub)" }}>
            Close
          </button>
        </div>

        <div className="p-6">
          {loading && <div className="text-sm" style={lblStyle}>Loading…</div>}
          {error && <div className="text-sm rounded-lg p-3 bg-red-50 text-red-700">{error}</div>}

          {!loading && !error && step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Review before sending — {rows.length} crew on this report</div>
                {flaggedCount > 0 && (
                  <div className="text-sm rounded-lg px-3 py-1 bg-red-50 text-red-700">{flaggedCount} crew with an expired or critical document</div>
                )}
              </div>
              <div className="overflow-x-auto border rounded-lg" style={{ borderColor: "var(--ch-line)" }}>
                <table className="text-sm w-full">
                  <thead>
                    <tr>
                      {columns.map((c, i) => (
                        <th key={i} className="text-left px-3 py-2 border-b font-medium whitespace-nowrap" style={{ borderColor: "var(--ch-line)" }}>
                          {c.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.crew_id}>
                        {columns.map((c, i) => {
                          const resolved = resolveColumn(c, row, docTypesById);
                          const colors = resolved.status && resolved.status !== "ok" && resolved.status !== "none" ? DOCUMENT_STATUS_COLORS[resolved.status] : null;
                          return (
                            <td
                              key={i}
                              className="px-3 py-1.5 border-b whitespace-nowrap"
                              style={{ borderColor: "var(--ch-line)", background: colors?.bg, color: colors?.fg }}
                            >
                              {resolved.text || "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  className="text-sm rounded-lg px-4 py-2 text-white"
                  style={{ background: "var(--ch-accent, #0f2c4c)" }}
                >
                  Next — choose recipients
                </button>
              </div>
            </div>
          )}

          {!loading && !error && step === 2 && !sendResults && (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-2">Recipients</div>
                {contacts.length === 0 && (
                  <div className="text-sm" style={lblStyle}>
                    No contacts saved for this client yet. Add one under Crew → Clients.
                  </div>
                )}
                <div className="space-y-1">
                  {contacts.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!selected.find((r) => r.clientContactId === c.id)} onChange={() => toggleContact(c)} />
                      <span>
                        {c.fullName} <span style={lblStyle}>— {c.email}{c.title ? ` (${c.title})` : ""}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl} style={lblStyle}>
                  Subject
                </label>
                <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div>
                <label className={lbl} style={lblStyle}>
                  Message
                </label>
                <textarea
                  className={`${inputCls} w-full mt-1`}
                  style={inputStyle}
                  rows={4}
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                />
              </div>
              {sendError && <div className="text-sm rounded-lg p-3 bg-red-50 text-red-700">{sendError}</div>}
              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="text-sm rounded-lg px-4 py-2 border" style={{ borderColor: "var(--ch-line)" }}>
                  Back
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending || selected.length === 0}
                  className="text-sm rounded-lg px-4 py-2 text-white disabled:opacity-50"
                  style={{ background: "var(--ch-accent, #0f2c4c)" }}
                >
                  {sending ? "Sending…" : `Send to ${selected.length} recipient${selected.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}

          {sendResults && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Send results</div>
              {sendResults.map((r, i) => (
                <div key={i} className="text-sm flex items-center justify-between border-b py-1" style={{ borderColor: "var(--ch-line)" }}>
                  <span>
                    {r.name} — {r.email}
                  </span>
                  <span style={{ color: r.status === "sent" ? "#1a7d3d" : "#b3261e" }}>{r.status === "sent" ? "Sent" : `Failed: ${r.error}`}</span>
                </div>
              ))}
              <div className="flex justify-end">
                <button onClick={onClose} className="text-sm rounded-lg px-4 py-2 border" style={{ borderColor: "var(--ch-line)" }}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
