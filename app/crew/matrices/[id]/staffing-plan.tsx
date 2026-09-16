"use client";

// Staffing Plan — rank-led, real crew data, sourced from the same Required
// Document Types configured under the Lines tab.
//
// For each rank (crew matrix line) this lists the crew currently assigned
// to the matrix's site whose primary job role matches that line, and for
// each document type the matrix uses anywhere, shows that person's actual
// document value when their rank requires it — or N/A when it doesn't
// (mirroring the client's own crew matrix template, e.g. a Camp Boss row
// carries Food Safety Certificate but shows N/A for a deck-only cert like
// a DP certificate). "Missing" (in the expired/critical color) means the
// rank requires the document but no crew_documents record exists yet for
// that person.
//
// This is still a pivot of THIS matrix's Required Document Types config,
// now joined to real crew_profiles/crew_documents rather than showing the
// abstract Mandatory/Optional/N-A structure only — see
// claude/phase10-client-crew-reports-requirement.md in the project for the
// separate, larger "client crew report" feature (multi-client templates,
// email delivery) this does not attempt to replace.

import type { Line, DocTypeRef } from "./lines-editor";
import { computeDocumentStatus, DOCUMENT_STATUS_COLORS } from "@/lib/document-status";

export type StaffingCrew = {
  crew_id: string;
  full_name: string;
  nationality: string | null;
  job_role_id: string;
  documents: Record<string, { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }>;
};

export type FieldDef = { id: string; label: string; field_key: string; applies_to_document_type_id: string | null };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function StaffingPlanView({
  lines,
  documentTypes,
  crew,
  customFieldDefinitions,
}: {
  lines: Line[];
  documentTypes: DocTypeRef[];
  crew: StaffingCrew[];
  customFieldDefinitions: FieldDef[];
}) {
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
        One row per crew member currently assigned to this site, grouped by rank. Columns are every document type
        required for at least one rank on this matrix — N/A means that rank doesn&apos;t require it, &quot;Missing&quot; means it
        does and no record exists yet.
      </div>
      <div className="space-y-4">
        {orderedLines.map((line) => {
          const crewForLine = crew.filter((c) => c.job_role_id === line.job_role_id).sort((a, b) => a.full_name.localeCompare(b.full_name));
          const requiredDocTypeIds = new Set(line.documents.map((d) => d.document_type_id));

          return (
            <div key={line.id} className={`${cardCls} overflow-hidden`} style={cardStyle}>
              <div className="px-3 py-2 flex items-center gap-3 flex-wrap" style={{ background: "var(--ch-navy-soft)" }}>
                <span className="text-sm font-semibold" style={{ color: "var(--ch-navy)" }}>{line.job_role_name}</span>
                <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
                  Headcount required {line.required_headcount} · {crewForLine.length} assigned
                </span>
              </div>
              {crewForLine.length === 0 ? (
                <div className="px-3 py-3 text-sm" style={{ color: "var(--ch-sub)" }}>No crew currently assigned to this rank at this site.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse w-full">
                    <thead>
                      <tr style={{ background: "var(--ch-paper)" }}>
                        <th className="text-left font-semibold px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>Name</th>
                        <th className="text-left font-semibold px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>Nationality</th>
                        {columns.map((col) => (
                          <th key={col.id} className="text-left font-semibold px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>
                            {col.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {crewForLine.map((person) => (
                        <tr key={person.crew_id} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                          <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--ch-ink)" }}>{person.full_name}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-ink)" }}>{person.nationality ?? "—"}</td>
                          {columns.map((col) => (
                            <DocCell
                              key={col.id}
                              required={requiredDocTypeIds.has(col.id)}
                              docType={col}
                              doc={person.documents[col.id]}
                              fieldDefs={customFieldDefinitions.filter((f) => f.applies_to_document_type_id === col.id || f.applies_to_document_type_id === null)}
                            />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DocCell({
  required,
  docType,
  doc,
  fieldDefs,
}: {
  required: boolean;
  docType: DocTypeRef;
  doc: StaffingCrew["documents"][string] | undefined;
  fieldDefs: FieldDef[];
}) {
  if (!required) {
    return (
      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>
        N/A
      </td>
    );
  }

  if (!doc) {
    const colors = DOCUMENT_STATUS_COLORS.expired;
    return (
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="rounded px-1.5 py-0.5 font-semibold" style={{ background: colors.bg, color: colors.fg }}>
          Missing
        </span>
      </td>
    );
  }

  const parts: string[] = [];
  let bg = "transparent";
  let fg = "var(--ch-ink)";

  if (docType.tracks_number && doc.document_number) parts.push(doc.document_number);

  if (doc.expiry_date) {
    const { status } = computeDocumentStatus(doc.expiry_date, docType.warning_threshold_days, docType.category);
    const colors = DOCUMENT_STATUS_COLORS[status];
    bg = colors.bg;
    fg = colors.fg;
    parts.push(formatDate(doc.expiry_date) ?? doc.expiry_date);
  } else if (doc.issue_date) {
    // One-time attendance records (e.g. MOSI, Project HSE Induction) carry
    // no expiry — show the date it was completed, unstyled.
    parts.push(formatDate(doc.issue_date) ?? doc.issue_date);
  }

  for (const f of fieldDefs) {
    const value = doc.custom_fields?.[f.field_key];
    if (value !== undefined && value !== null && value !== "") parts.push(`${f.label}: ${value}`);
  }

  if (parts.length === 0) {
    const colors = DOCUMENT_STATUS_COLORS.none;
    return (
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="rounded px-1.5 py-0.5" style={{ background: colors.bg, color: colors.fg }}>
          On file, no date/number set
        </span>
      </td>
    );
  }

  return (
    <td className="px-3 py-2 whitespace-nowrap">
      <span className={bg !== "transparent" ? "rounded px-1.5 py-0.5" : ""} style={{ background: bg, color: fg }}>
        {parts.join(" · ")}
      </span>
    </td>
  );
}
