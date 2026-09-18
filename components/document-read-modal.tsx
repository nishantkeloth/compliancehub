"use client";

import { useState } from "react";
import type { DocumentReadResult } from "@/app/crew/profiles/document-ai-actions";

// Shared by every place that reads a document with AI and needs someone
// to confirm the result before it lands in a form field — the staff
// upload panel, the staff review-a-pending-self-upload screen, and the
// crew member's own self-upload page (see crew-editor.tsx and
// app/upload-documents/[token]/upload-documents-form.tsx). Surfacing
// the read as a modal rather than silently pre-filling the inputs makes
// the "AI proposed this" moment impossible to miss, and nothing reaches
// the actual form until Use these values is clicked — Cancel leaves
// the form exactly as it was.
//
// Deliberately no backdrop-click-to-dismiss: a stray click outside the
// card (easy to do on a phone, which is how most crew members reach the
// self-upload page) used to silently discard the read with no
// confirmation. Only the two explicit buttons below can close this.
export function DocumentReadModal({
  result,
  expectedTypeName,
  onConfirm,
  onCancel,
}: {
  result: DocumentReadResult;
  expectedTypeName: string;
  onConfirm: (values: { documentNumber: string; issueDate: string; expiryDate: string }) => void;
  onCancel: () => void;
}) {
  const [documentNumber, setDocumentNumber] = useState(result.document_number ?? "");
  const [issueDate, setIssueDate] = useState(result.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(result.expiry_date ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15, 23, 42, 0.5)" }}
    >
      <div
        className="w-full max-w-sm bg-white rounded-xl border p-5 shadow-lg"
        style={{ borderColor: "var(--ch-line)" }}
      >
        <div className="text-sm font-bold" style={{ color: "var(--ch-ink)" }}>
          Confirm what was read
        </div>
        <div className="text-xs mt-1 mb-3" style={{ color: "var(--ch-sub)" }}>
          Read by {result.modelLabel} for <strong>{expectedTypeName}</strong>. Check the values below — they
          aren&apos;t saved until you confirm.
        </div>

        {result.typeMismatch && (
          <div className="text-xs rounded-lg px-3 py-2 mb-2" style={{ background: "#fff6e0", color: "#9a6b00" }}>
            This looks like it might be &quot;{result.document_type_name}&quot;, not &quot;{expectedTypeName}&quot;
            — double check this is the right file.
          </div>
        )}
        {result.confidence < 0.5 && (
          <div className="text-xs rounded-lg px-3 py-2 mb-2" style={{ background: "#fff6e0", color: "#9a6b00" }}>
            Low confidence — the document may be unclear or partly unreadable. Check the values carefully.
          </div>
        )}
        {result.source_excerpt && (
          <div className="text-xs italic mb-3" style={{ color: "var(--ch-sub)" }}>
            &quot;{result.source_excerpt}&quot;
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-xs">
            <span style={{ color: "var(--ch-sub)" }}>Document number</span>
            <input
              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
              style={{ borderColor: "var(--ch-line)" }}
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <label className="block text-xs flex-1">
              <span style={{ color: "var(--ch-sub)" }}>Issue date</span>
              <input
                type="date"
                className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
                style={{ borderColor: "var(--ch-line)" }}
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </label>
            <label className="block text-xs flex-1">
              <span style={{ color: "var(--ch-sub)" }}>Expiry date</span>
              <input
                type="date"
                className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
                style={{ borderColor: "var(--ch-line)" }}
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => onConfirm({ documentNumber, issueDate, expiryDate })}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold"
          >
            Use these values
          </button>
          <button onClick={onCancel} className="text-sm font-semibold" style={{ color: "var(--ch-sub)" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
