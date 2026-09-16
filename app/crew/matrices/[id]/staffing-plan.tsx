"use client";

// Staffing Plan — a rank-led view of the same Required Document Types data
// already captured on each line under the Lines tab. Rows are ranks (crew
// matrix lines); columns are every document type required for at least one
// rank on this matrix (in the org's canonical document-type order). A cell
// shows the requirement (Mandatory/Optional, waiver OK, min. days valid)
// when that rank's line actually lists the document under Required
// Document Types, and "N/A" otherwise — mirroring the client's own crew
// matrix template, where a rank only carries the certificates that apply
// to it.
//
// This reads directly off `lines` (no separate query, no new table) — it's
// a pivot of crew_matrix_line_documents, not a named-crew compliance
// report. A named-crew version (real people, live document expiry dates)
// is a separate, larger feature — see claude/phase10-client-crew-reports-
// requirement.md in the project.

import type { Line, Ref } from "./lines-editor";

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

export default function StaffingPlanView({ lines, documentTypes }: { lines: Line[]; documentTypes: Ref[] }) {
  const orderedLines = [...lines].sort((a, b) => a.line_number - b.line_number);

  const usedDocTypeIds = new Set<string>();
  for (const line of orderedLines) {
    for (const doc of line.documents) usedDocTypeIds.add(doc.document_type_id);
  }
  // Keep the org's canonical (alphabetical) document-type order rather than
  // first-seen-per-line order, so the column order stays stable as lines
  // are added, reordered or copied.
  const columns = documentTypes.filter((d) => usedDocTypeIds.has(d.id));

  if (orderedLines.length === 0) {
    return <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No lines yet — add lines under the Lines tab first.</div>;
  }

  if (columns.length === 0) {
    return (
      <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
        No rank has any Required Document Types configured yet. Add them under the Lines tab — every document required
        for at least one rank becomes a column here, with N/A for ranks it doesn&apos;t apply to.
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        One column per document type required for at least one rank on this matrix. N/A means that rank&apos;s line
        doesn&apos;t list the document under Required Document Types.
      </div>
      <div className={`${cardCls} overflow-x-auto`} style={cardStyle}>
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr style={{ background: "var(--ch-paper)" }}>
              <th className="text-left font-semibold px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>Rank</th>
              <th className="text-left font-semibold px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>Headcount</th>
              {columns.map((col) => (
                <th key={col.id} className="text-left font-semibold px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedLines.map((line) => {
              const byTypeId = new Map(line.documents.map((d) => [d.document_type_id, d]));
              return (
                <tr key={line.id} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--ch-ink)" }}>{line.job_role_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-ink)" }}>{line.required_headcount}</td>
                  {columns.map((col) => {
                    const doc = byTypeId.get(col.id);
                    if (!doc) {
                      return (
                        <td key={col.id} className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>
                          N/A
                        </td>
                      );
                    }
                    return (
                      <td key={col.id} className="px-3 py-2 whitespace-nowrap">
                        <span style={{ color: doc.is_mandatory ? "var(--ch-ink)" : "var(--ch-sub)", fontWeight: doc.is_mandatory ? 600 : 400 }}>
                          {doc.is_mandatory ? "Mandatory" : "Optional"}
                        </span>
                        {doc.waiver_permitted && <span style={{ color: "var(--ch-sub)" }}> · waiver OK</span>}
                        {doc.minimum_remaining_validity_days != null && (
                          <span style={{ color: "var(--ch-sub)" }}> · min. {doc.minimum_remaining_validity_days}d</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
