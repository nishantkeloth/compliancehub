"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  parseDocumentTypesFile,
  commitDocumentTypesImport,
  type DocumentTypesImportPreview,
  type DocumentTypesImportResult,
} from "./document-types-import-actions";

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

const CATEGORY_LABELS: Record<string, string> = {
  visa: "Visa",
  travel_document: "Travel document",
  certificate: "Certificate",
  vaccination: "Vaccination",
};

export default function DocumentTypesImportPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentTypesImportPreview | null>(null);
  const [deleteUnmatched, setDeleteUnmatched] = useState(false);
  const [result, setResult] = useState<DocumentTypesImportResult | null>(null);

  function handleFile(file: File) {
    setError(null);
    setResult(null);
    setPreview(null);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await parseDocumentTypesFile(fd);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setPreview(res.preview);
    });
  }

  function commit() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const res = await commitDocumentTypesImport(JSON.stringify({ rows: preview.rows, deleteUnmatched }));
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult(res.result);
      router.refresh();
    });
  }

  const includedRows = preview?.rows.filter((r) => !r.errors.length) ?? [];
  const errorRows = preview?.rows.filter((r) => r.errors.length) ?? [];

  if (result) {
    return (
      <div className={`${cardCls} p-4 mb-4`} style={cardStyle}>
        <div className="text-sm font-semibold mb-2" style={{ color: "var(--ch-ink)" }}>Import complete</div>
        <p className="text-sm mb-2" style={{ color: "var(--ch-sub)" }}>
          Created {result.created}, updated {result.updated}{deleteUnmatched ? `, deleted ${result.deleted}` : ""}.
        </p>
        {result.deleteSkipped.length > 0 && (
          <div className="text-sm rounded-lg px-3 py-2 mb-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
            {result.deleteSkipped.length} document type{result.deleteSkipped.length === 1 ? "" : "s"} couldn&rsquo;t be deleted (still in
            use): {result.deleteSkipped.map((d) => d.name).join(", ")}. Their crew documents need reassigning first if you still want them
            gone.
          </div>
        )}
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className={`${cardCls} p-4 mb-4`} style={cardStyle}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>Import document types from Excel</div>
        <button onClick={onClose} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Cancel</button>
      </div>

      {!preview && (
        <>
          <p className="text-sm mb-3" style={{ color: "var(--ch-sub)" }}>
            Upload a filled-in copy of the template. A row whose name matches an existing document type (case-insensitive) updates it;
            anything else is created new.
          </p>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <a
              href="/templates/document-types-import-template.xlsx"
              download
              className="text-xs font-semibold rounded-lg px-3 py-2 border"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
            >
              ↓ Download template
            </a>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className={`${inputCls}`}
              style={inputStyle}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              disabled={busy}
            />
          </div>
          {busy && <p className="text-xs" style={{ color: "var(--ch-sub)" }}>Reading file…</p>}
        </>
      )}

      {preview && (
        <>
          <p className="text-sm mb-3" style={{ color: "var(--ch-sub)" }}>
            {includedRows.length} row{includedRows.length === 1 ? "" : "s"} ready — {includedRows.filter((r) => r.action === "create").length}{" "}
            new, {includedRows.filter((r) => r.action === "update").length} updating an existing type.
            {errorRows.length > 0 && ` ${errorRows.length} row(s) have errors and will be skipped.`}
          </p>

          <div className="max-h-80 overflow-y-auto border rounded-lg mb-3" style={{ borderColor: "var(--ch-line)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: "var(--ch-sub)" }}>
                  <th className="px-2 py-1.5">Row</th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Category</th>
                  <th className="px-2 py-1.5">Validity</th>
                  <th className="px-2 py-1.5">Warning</th>
                  <th className="px-2 py-1.5">Doc #</th>
                  <th className="px-2 py-1.5">Active</th>
                  <th className="px-2 py-1.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                    <td className="px-2 py-1.5" style={{ color: "var(--ch-sub)" }}>{r.rowNumber}</td>
                    <td className="px-2 py-1.5 font-semibold" style={{ color: r.errors.length ? "var(--ch-fail)" : "var(--ch-ink)" }}>
                      {r.name || "—"}
                      {(r.errors.length > 0 || r.warnings.length > 0) && (
                        <div className="font-normal" style={{ color: r.errors.length ? "var(--ch-fail)" : "var(--ch-sub)" }}>
                          {[...r.errors, ...r.warnings].join(" ")}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{r.category ? CATEGORY_LABELS[r.category] : "—"}</td>
                    <td className="px-2 py-1.5">{r.defaultValidityMonths != null ? `${r.defaultValidityMonths}mo` : "—"}</td>
                    <td className="px-2 py-1.5">{r.warningThresholdDays != null ? `${r.warningThresholdDays}d` : "—"}</td>
                    <td className="px-2 py-1.5">{r.tracksNumber ? "Yes" : "No"}</td>
                    <td className="px-2 py-1.5">{r.isActive ? "Yes" : "No"}</td>
                    <td className="px-2 py-1.5">
                      {r.errors.length ? (
                        <span style={{ color: "var(--ch-fail)" }}>Skip</span>
                      ) : r.action === "update" ? (
                        <span style={{ color: "var(--ch-navy)" }}>Update</span>
                      ) : (
                        <span style={{ color: "var(--ch-pass, #15803d)" }}>Create</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.unmatchedExisting.length > 0 && (
            <div className="rounded-lg border p-3 mb-3" style={{ borderColor: "var(--ch-fail)", background: "var(--ch-fail-bg)" }}>
              <label className="flex items-start gap-2 text-xs" style={{ color: "var(--ch-fail)" }}>
                <input type="checkbox" className="mt-0.5" checked={deleteUnmatched} onChange={(e) => setDeleteUnmatched(e.target.checked)} />
                <span>
                  <span className="font-semibold">
                    Also delete the {preview.unmatchedExisting.length} existing document type{preview.unmatchedExisting.length === 1 ? "" : "s"}{" "}
                    not in this file
                  </span>{" "}
                  ({preview.unmatchedExisting.map((e) => e.name).join(", ")}). Permanent. One still referenced by a crew member&rsquo;s
                  documents will be skipped rather than deleted, and reported after the import.
                </span>
              </label>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={commit}
              disabled={busy || includedRows.length === 0}
              className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Importing…" : `Import ${includedRows.length} document type${includedRows.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => {
                setPreview(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="rounded-lg px-4 py-2 text-sm font-semibold border"
              style={{ borderColor: "var(--ch-line)" }}
            >
              Choose a different file
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="text-sm mt-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>
      )}
    </div>
  );
}
