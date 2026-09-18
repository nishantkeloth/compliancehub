"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitSelfUploadDocument } from "@/app/crew/profiles/upload-link-actions";

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
        <div
          className="text-sm rounded-lg px-3 py-2 mt-2"
          style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
        >
          Submitted — {companyName} will review it.{" "}
          <button
            onClick={() => {
              setDone(false);
              setFile(null);
            }}
            className="underline font-semibold"
          >
            Upload a different file
          </button>
        </div>
      ) : (
        <>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm mt-2 block"
          />
          <div className="grid grid-cols-3 gap-2 mt-2">
            <input
              className="border rounded-lg px-2 py-1.5 text-xs"
              style={{ borderColor: "var(--ch-line)" }}
              placeholder="Document number (optional)"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
            <input
              type="date"
              className="border rounded-lg px-2 py-1.5 text-xs"
              style={{ borderColor: "var(--ch-line)" }}
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              title="Issue date (optional)"
            />
            <input
              type="date"
              className="border rounded-lg px-2 py-1.5 text-xs"
              style={{ borderColor: "var(--ch-line)" }}
              value={expiryDate}
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
            {busy ? "Uploading…" : "Upload"}
          </button>
        </>
      )}
    </div>
  );
}
