"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitSelfUploadDocument, extractSelfUploadDocumentFields } from "@/app/crew/profiles/upload-link-actions";
import type { DocumentReadResult } from "@/app/crew/profiles/document-ai-actions";
import { DocumentReadModal } from "@/components/document-read-modal";

type PreviewItem = { document_type_id: string; name: string; category: string | null; has_current_file: boolean };
type Preview =
  | { valid: true; crew_name: string; company_name: string; expires_at: string; items: PreviewItem[] }
  | { valid: false };

export default function UploadDocumentsForm({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc("get_document_upload_link_preview", { p_token: token }).then(({ data, error }) => {
      if (error || !data?.valid) {
        setPreview({ valid: false });
        return;
      }
      setPreview(data as Preview);
    });
  }, [token]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--ch-paper)" }}>
      <div className="w-full max-w-lg bg-white rounded-xl border p-8 shadow-sm" style={{ borderColor: "var(--ch-line)" }}>
        <h1 className="text-xl font-bold" style={{ color: "var(--ch-navy)" }}>
          Compliance<span style={{ color: "var(--ch-ink)", opacity: 0.6 }}>Hub</span>
        </h1>

        {preview === null && (
          <p className="text-sm mt-4" style={{ color: "var(--ch-sub)" }}>
            Loading…
          </p>
        )}

        {preview !== null && !preview.valid && (
          <>
            <p className="text-sm mt-4" style={{ color: "var(--ch-sub)" }}>
              This upload link has expired, been revoked, or is not valid. Ask whoever sent it to you for a new
              one.
            </p>
          </>
        )}

        {preview !== null && preview.valid && (
          <>
            <p className="text-sm mt-1 mb-6" style={{ color: "var(--ch-sub)" }}>
              Hi <strong>{preview.crew_name}</strong> — <strong>{preview.company_name}</strong> has asked you to
              upload the document(s) below. No account or password is needed. This link expires{" "}
              {new Date(preview.expires_at).toDateString()}.
            </p>
            <div className="space-y-4">
              {preview.items.map((item) => (
                <DocumentUploadItem key={item.document_type_id} token={token} item={item} companyName={preview.company_name} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function DocumentUploadItem({
  token,
  item,
  companyName,
}: {
  token: string;
  item: PreviewItem;
  companyName: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [documentNumber, setDocumentNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reading, setReading] = useState(false);
  const [pendingRead, setPendingRead] = useState<DocumentReadResult | null>(null);
  const [confirmedByAi, setConfirmedByAi] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const autoRead = async (targetFile?: File) => {
    const f = targetFile ?? file;
    if (!f) {
      setError("Choose a file first, then Auto-read.");
      return;
    }
    setReading(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", f);
    const res = await extractSelfUploadDocumentFields(token, item.document_type_id, fd);
    setReading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setPendingRead(res.result);
  };

  const confirmRead = (values: { documentNumber: string; issueDate: string; expiryDate: string }) => {
    setDocumentNumber(values.documentNumber);
    setIssueDate(values.issueDate);
    setExpiryDate(values.expiryDate);
    setConfirmedByAi(true);
    if (pendingRead) {
      const notes: string[] = [`Read by ${pendingRead.modelLabel} — confirmed by the crew member before submitting.`];
      if (pendingRead.typeMismatch) notes.push(`Flagged as possibly "${pendingRead.document_type_name}" instead of "${item.name}".`);
      if (pendingRead.confidence < 0.5) notes.push("Low confidence read.");
      setAiNote(notes.join(" "));
    }
    setPendingRead(null);
  };

  const submit = async () => {
    setError(null);
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    if (documentNumber.trim()) fd.set("documentNumber", documentNumber.trim());
    if (issueDate) fd.set("issueDate", issueDate);
    if (expiryDate) fd.set("expiryDate", expiryDate);
    if (aiNote) fd.set("aiNote", aiNote);
    const res = await submitSelfUploadDocument(token, item.document_type_id, fd);
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setDone(true);
  };

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--ch-line)" }}>
      <div className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>
        {item.name}
        {item.has_current_file && (
          <span className="text-xs font-normal ml-2" style={{ color: "var(--ch-sub)" }}>
            (already on file — this uploads a new one for review)
          </span>
        )}
      </div>

      {done ? (
        <div className="mt-2 space-y-2">
          <div
            className="flex items-center gap-1.5 text-sm font-semibold rounded-lg px-3 py-2"
            style={{ background: "#e6f4ea", color: "#1e7a34" }}
          >
            <span aria-hidden="true">✓</span> Saved — {companyName} will review it
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ReadOnlyField label="Document number" value={documentNumber} />
            <ReadOnlyField label="Issue date" value={issueDate} />
            <ReadOnlyField label="Expiry date" value={expiryDate} />
          </div>
          <button
            onClick={() => {
              setDone(false);
              setFile(null);
              setDocumentNumber("");
              setIssueDate("");
              setExpiryDate("");
              setConfirmedByAi(false);
              setAiNote(null);
            }}
            className="underline text-xs font-semibold"
            style={{ color: "var(--ch-navy)" }}
          >
            Upload a different file
          </button>
        </div>
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setConfirmedByAi(false);
              setAiNote(null);
              if (f) autoRead(f);
            }}
            className="hidden"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
            >
              + Choose file
            </button>
            {file && (
              <span className="text-xs truncate" style={{ color: "var(--ch-sub)" }}>
                {file.name}
              </span>
            )}
          </div>
          <div className="mt-2">
            <button
              onClick={() => autoRead()}
              disabled={!file || reading || busy}
              className="text-xs font-semibold rounded-lg border px-3 py-1.5 disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
            >
              {reading ? "Reading…" : "Auto-read number & expiry"}
            </button>
          </div>
          {confirmedByAi && (
            <div className="text-xs rounded-lg px-2 py-1.5 mt-2" style={{ background: "#e6f4ea", color: "#1e7a34" }}>
              AI-read values confirmed below — edit anything before submitting if needed.
            </div>
          )}
          {pendingRead && (
            <DocumentReadModal result={pendingRead} expectedTypeName={item.name} onConfirm={confirmRead} onCancel={() => setPendingRead(null)} />
          )}
          <div className="grid grid-cols-3 gap-2 mt-2">
            <input
              className="border rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)" }}
              placeholder="Document number (optional)"
              value={documentNumber}
              disabled={busy}
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
            <input
              type="date"
              className="border rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)" }}
              value={issueDate}
              disabled={busy}
              onChange={(e) => setIssueDate(e.target.value)}
              title="Issue date (optional)"
            />
            <input
              type="date"
              className="border rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)" }}
              value={expiryDate}
              disabled={busy}
              onChange={(e) => setExpiryDate(e.target.value)}
              title="Expiry date (optional)"
            />
          </div>
          {error && (
            <div className="text-xs rounded-lg px-2 py-1.5 mt-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
              {error}
            </div>
          )}
          <button
            onClick={submit}
            disabled={busy}
            className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold mt-2 disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload File"}
          </button>
        </>
      )}
    </div>
  );
}

// Plain read-only display for a field after it's been saved — same
// visual footprint as the editable input it replaces, so the layout
// doesn't jump, but nothing here can be typed into.
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg px-2 py-1.5 text-xs"
      style={{ background: "var(--ch-bg)", border: "1px solid var(--ch-line)" }}
    >
      <div style={{ color: "var(--ch-sub)" }}>{label}</div>
      <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>{value || "—"}</div>
    </div>
  );
}
