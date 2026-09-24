"use client";

// "Send Matrix to Client" — Increment 1 wizard. Three steps: readiness
// summary, recipients (existing client contacts + inline "add contact"),
// and an editable email. Sending re-validates and re-fetches everything
// server-side (see share-actions.ts) — this wizard's own summary is a
// preview, not the source of truth for what gets sent.

import { useEffect, useMemo, useState } from "react";
import type { LineLike, StaffingCrew, DocTypeRef, FieldDef } from "@/lib/staffing-plan-shared";
import { cellInfo, orderDocumentColumns } from "@/lib/staffing-plan-shared";
import { getMatrixShareContext, createClientContact, sendMatrixSharePackage } from "./share-actions";

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

// A matrix can be sent at any status, including draft — the send action
// (share-actions.ts) watermarks the attachment and secure page as
// "DRAFT — NOT YET APPROVED" whenever the status isn't one of these, it
// never blocks the send.
const FINAL_STATUSES = new Set(["approved", "active"]);

type Contact = { id: string; fullName: string; email: string; title: string | null };
type SelectedRecipient = { key: string; name: string; email: string; clientContactId: string | null };

export default function SendMatrixWizard({
  crewMatrixId,
  matrixTitle,
  matrixNumber,
  matrixVersion,
  matrixStatus,
  lines,
  assignedCrew,
  documentTypes,
  customFieldDefinitions,
  onClose,
}: {
  crewMatrixId: string;
  matrixTitle?: string;
  matrixNumber?: string | null;
  matrixVersion?: number;
  matrixStatus?: string;
  lines: LineLike[];
  assignedCrew: StaffingCrew[];
  documentTypes: DocTypeRef[];
  customFieldDefinitions: FieldDef[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loadingContext, setLoadingContext] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<SelectedRecipient[]>([]);
  const [addingContact, setAddingContact] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [includeExcel, setIncludeExcel] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResults, setSendResults] = useState<{ name: string; email: string; status: "sent" | "failed"; error?: string }[] | null>(null);
  const [shareReference, setShareReference] = useState<string | null>(null);

  const isDraftShare = !!matrixStatus && !FINAL_STATUSES.has(matrixStatus);

  useEffect(() => {
    let cancelled = false;
    getMatrixShareContext(crewMatrixId).then((res) => {
      if (cancelled) return;
      setLoadingContext(false);
      if (res?.error) {
        setContextError(res.error);
        return;
      }
      setClientId(res?.clientId ?? null);
      setClientName(res?.clientName ?? null);
      setContacts(res?.contacts ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [crewMatrixId]);

  // Readiness summary, computed from the same data the on-screen Staffing
  // Plan already loaded — a preview only; the send action re-derives this
  // itself from the database.
  const summary = useMemo(() => {
    let requiredHeadcount = 0;
    let assignedCount = 0;
    let missingDocs = 0;
    let expiredDocs = 0;
    for (const line of lines) {
      requiredHeadcount += line.required_headcount;
      const crewForLine = assignedCrew.filter((c) => c.job_role_id === line.job_role_id);
      assignedCount += crewForLine.length;
      const lineColumns = orderDocumentColumns(documentTypes, new Set(line.documents.map((d) => d.document_type_id)));
      for (const person of crewForLine) {
        for (const col of lineColumns) {
          const info = cellInfo(true, col, person.documents[col.id], customFieldDefinitions.filter((f) => f.applies_to_document_type_id === col.id || f.applies_to_document_type_id === null));
          if (info.kind === "missing") missingDocs++;
          if (info.kind === "value" && info.status === "expired") expiredDocs++;
        }
      }
    }
    return { requiredHeadcount, assignedCount, vacant: Math.max(0, requiredHeadcount - assignedCount), missingDocs, expiredDocs };
  }, [lines, assignedCrew, documentTypes, customFieldDefinitions]);

  useEffect(() => {
    if (step !== 3 || subject) return;
    setSubject(`Crew Matrix – ${matrixTitle ?? "Staffing Plan"}${matrixNumber ? ` – ${matrixNumber}` : ""}${matrixVersion ? ` – Version ${matrixVersion}` : ""}`);
    setBodyText(
      `Please find attached the crew matrix for ${matrixTitle ?? "this vessel/site"}${clientName ? ` under ${clientName}` : ""}.\n\n` +
        `Matrix reference: ${matrixNumber ?? "—"}\nVersion: ${matrixVersion ?? "—"}\n\n` +
        `The supporting personnel and document status can be accessed securely using the link below. Please do not forward this link.`
    );
  }, [step, subject, matrixTitle, matrixNumber, matrixVersion, clientName]);

  const toggleContact = (c: Contact) => {
    setSelected((prev) => {
      const exists = prev.find((r) => r.clientContactId === c.id);
      if (exists) return prev.filter((r) => r.clientContactId !== c.id);
      return [...prev, { key: c.id, name: c.fullName, email: c.email, clientContactId: c.id }];
    });
  };

  const saveNewContact = async () => {
    if (!clientId || !newName.trim() || !newEmail.trim() || savingContact) return;
    setSavingContact(true);
    const res = await createClientContact(clientId, newName.trim(), newEmail.trim());
    setSavingContact(false);
    if (res?.error) {
      setContextError(res.error);
      return;
    }
    if (res?.contact) {
      setContacts((prev) => [...prev, res.contact!].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      setSelected((prev) => [...prev, { key: res.contact!.id, name: res.contact!.fullName, email: res.contact!.email, clientContactId: res.contact!.id }]);
    }
    setNewName("");
    setNewEmail("");
    setAddingContact(false);
  };

  const send = async () => {
    setSending(true);
    setSendError(null);
    const res = await sendMatrixSharePackage({
      crewMatrixId,
      recipients: selected.map((r) => ({ name: r.name, email: r.email, clientContactId: r.clientContactId })),
      subject,
      bodyText,
      includeExcel,
    });
    setSending(false);
    if (res?.error) {
      setSendError(res.error);
      return;
    }
    setShareReference(res?.shareReference ?? null);
    setSendResults(res?.results ?? []);
    setStep(4);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15, 23, 42, 0.5)" }}>
      <div className={`${cardCls} w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5`} style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold" style={{ color: "var(--ch-navy)" }}>Send Matrix to Client</h3>
          <button onClick={onClose} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Close</button>
        </div>

        {isDraftShare && (
          <div className="text-sm rounded-lg px-3 py-2 mb-4 font-semibold" style={{ background: "#dc2626", color: "#fff" }}>
            This matrix is &quot;{matrixStatus}&quot; — not yet approved. It can still be sent; the recipient will see a clearly marked DRAFT — NOT YET APPROVED notice on the email, the secure page, and the Excel attachment.
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Matrix &amp; readiness</div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
              <Row label="Matrix" value={`${matrixTitle ?? "—"}${matrixNumber ? ` (${matrixNumber})` : ""}${matrixVersion ? ` v${matrixVersion}` : ""}`} />
              <Row label="Client" value={loadingContext ? "Loading…" : clientName ?? "No client linked to this matrix's project"} />
              <Row label="Required headcount" value={String(summary.requiredHeadcount)} />
              <Row label="Currently assigned" value={String(summary.assignedCount)} />
              <Row label="Vacant positions" value={String(summary.vacant)} warn={summary.vacant > 0} />
              <Row label="Missing documents" value={String(summary.missingDocs)} warn={summary.missingDocs > 0} />
              <Row label="Expired documents" value={String(summary.expiredDocs)} warn={summary.expiredDocs > 0} />
            </div>
            {(summary.missingDocs > 0 || summary.expiredDocs > 0) && (
              <div className="text-xs rounded-lg px-3 py-2 mb-4" style={{ background: "#fff7ed", color: "#9a3412" }}>
                Some assigned crew have missing or expired documents. Their status will be shown to the client exactly as it appears on the Staffing Plan tab — you can still send, or fix these first.
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => setStep(2)} disabled={summary.assignedCount === 0} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                Next: Recipients
              </button>
            </div>
            {summary.assignedCount === 0 && (
              <div className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>No crew are currently assigned to this matrix's ranks — assign crew before sending.</div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Recipients</div>
            {contextError && <div className="text-xs mb-2" style={{ color: "var(--ch-fail)" }}>{contextError}</div>}
            {!clientId && !loadingContext && (
              <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>This matrix's project has no client linked, so contacts can&apos;t be looked up. Contact your admin to link a client.</div>
            )}
            <div className="space-y-1.5 mb-3">
              {contacts.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm rounded-lg border px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
                  <input type="checkbox" checked={!!selected.find((r) => r.clientContactId === c.id)} onChange={() => toggleContact(c)} />
                  <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{c.fullName}</span>
                  <span style={{ color: "var(--ch-sub)" }}>{c.email}</span>
                  {c.title && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>· {c.title}</span>}
                </label>
              ))}
              {contacts.length === 0 && !loadingContext && clientId && (
                <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No contacts saved for {clientName} yet.</div>
              )}
            </div>

            {clientId && (
              addingContact ? (
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <label className={lbl} style={lblStyle}>Name<input className={`${inputCls} mt-1`} style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
                  <label className={lbl} style={lblStyle}>Email<input className={`${inputCls} mt-1`} style={inputStyle} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></label>
                  <button onClick={saveNewContact} disabled={savingContact || !newName.trim() || !newEmail.trim()} className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">
                    {savingContact ? "Saving…" : "Save contact"}
                  </button>
                  <button onClick={() => setAddingContact(false)} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setAddingContact(true)} className="text-xs font-semibold mb-4" style={{ color: "var(--ch-navy)" }}>
                  + Add a new contact for {clientName}
                </button>
              )
            )}

            <div className="flex justify-between mt-2">
              <button onClick={() => setStep(1)} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Back</button>
              <button onClick={() => setStep(3)} disabled={selected.length === 0} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                Next: Compose email ({selected.length} recipient{selected.length === 1 ? "" : "s"})
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Compose email</div>
            <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
              Sending to: {selected.map((r) => r.name).join(", ")}. Each recipient gets their own email with their own secure link — recipients are never listed in each other&apos;s email.
            </div>
            <label className={`${lbl} block mb-3`} style={lblStyle}>
              Subject
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className={`${lbl} block mb-2`} style={lblStyle}>
              Message
              <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={7} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            </label>
            <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
              A secure &quot;View secure crew matrix&quot; button, the matrix reference, and a confidentiality notice are added automatically below your message.
            </div>
            <label className="flex items-center gap-1.5 text-xs mb-4" style={{ color: "var(--ch-ink)" }}>
              <input type="checkbox" checked={includeExcel} onChange={(e) => setIncludeExcel(e.target.checked)} /> Attach the matrix as an Excel file
            </label>
            {sendError && <div className="text-sm mb-3" style={{ color: "var(--ch-fail)" }}>{sendError}</div>}
            <div className="flex justify-between">
              <button onClick={() => setStep(2)} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Back</button>
              <button onClick={send} disabled={sending || !subject.trim() || !bodyText.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {sending ? "Sending…" : "Send to Client"}
              </button>
            </div>
          </div>
        )}

        {step === 4 && sendResults && (
          <div>
            <div className="text-sm font-semibold mb-3" style={{ color: "var(--ch-pass)" }}>
              Sent — sharing reference {shareReference}
            </div>
            <div className="space-y-1.5 mb-4">
              {sendResults.map((r) => (
                <div key={r.email} className="text-sm flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
                  <span>{r.name} <span style={{ color: "var(--ch-sub)" }}>({r.email})</span></span>
                  <span className="font-semibold" style={{ color: r.status === "sent" ? "var(--ch-pass)" : "var(--ch-fail)" }}>
                    {r.status === "sent" ? "Sent" : `Failed${r.error ? `: ${r.error}` : ""}`}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10px]" style={{ color: "var(--ch-sub)" }}>{label}</div>
      <div className="text-sm font-semibold" style={{ color: warn ? "var(--ch-fail)" : "var(--ch-ink)" }}>{value}</div>
    </div>
  );
}
