"use client";

// Public, token-gated "resource profile" for one candidate on one crew
// matrix rank — generated from the Staffing Plan tab's "Share link"
// action (see app/crew/matrices/[id]/staffing-actions.ts and migration
// 0017_candidate_resource_profile_links.sql). No ComplianceHub account
// needed; the token is validated by a SECURITY DEFINER RPC that only
// ever returns this one candidate's name/nationality/rank and their
// status for the document types required by that rank — never a raw
// crew_profiles row or anything outside that scope.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { computeDocumentStatus, DOCUMENT_STATUS_COLORS, type DocumentStatus } from "@/lib/document-status";

type DocItem = {
  name: string;
  category: string | null;
  is_mandatory: boolean;
  tracks_number: boolean;
  warning_threshold_days: number | null;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
};

type Preview =
  | {
      valid: true;
      crew_name: string;
      nationality: string | null;
      job_role_name: string;
      matrix_title: string | null;
      matrix_number: string | null;
      site_name: string | null;
      company_name: string;
      expires_at: string;
      documents: DocItem[];
    }
  | { valid: false };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// "certificate" -> "CERTIFICATES" — mirrors the same label formatting
// used on the Staffing Plan tab's own category bands.
function formatCategoryLabel(category: string | null): string {
  if (!category) return "GENERAL";
  const upper = category.replace(/[_-]+/g, " ").trim().toUpperCase();
  return /S$/.test(upper) ? upper : `${upper}S`;
}

function groupByCategory(docs: DocItem[]): { category: string | null; items: DocItem[] }[] {
  const groups: { category: string | null; items: DocItem[] }[] = [];
  for (const doc of docs) {
    const last = groups[groups.length - 1];
    if (last && last.category === doc.category) last.items.push(doc);
    else groups.push({ category: doc.category, items: [doc] });
  }
  return groups;
}

type CellInfo = { text: string; kind: "missing" | "empty" | "value"; status?: DocumentStatus };

function cellInfo(doc: DocItem): CellInfo {
  const hasAny = doc.document_number || doc.issue_date || doc.expiry_date;
  if (!hasAny) return { text: "Missing", kind: "missing" };

  const parts: string[] = [];
  let status: DocumentStatus | undefined;

  if (doc.tracks_number && doc.document_number) parts.push(doc.document_number);

  // Travel documents carry both an issue date and an expiry date — show
  // both, labeled, mirroring the Staffing Plan tab's own cellInfo().
  const showsBothDates = doc.category === "travel_document" && !!doc.issue_date && !!doc.expiry_date;
  if (showsBothDates) {
    parts.push(`Iss ${formatDate(doc.issue_date) ?? doc.issue_date}`);
  }

  if (doc.expiry_date) {
    const r = computeDocumentStatus(doc.expiry_date, doc.warning_threshold_days, doc.category);
    status = r.status;
    const expiryText = formatDate(doc.expiry_date) ?? doc.expiry_date;
    parts.push(showsBothDates ? `Exp ${expiryText}` : expiryText);
  } else if (doc.issue_date) {
    parts.push(formatDate(doc.issue_date) ?? doc.issue_date);
  }

  if (parts.length === 0) return { text: "On file, no date/number set", kind: "empty" };
  return { text: parts.join(" · "), kind: "value", status };
}

export default function ResourceProfileView({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc("get_resource_profile_preview", { p_token: token }).then(({ data, error }) => {
      if (error || !data?.valid) {
        setPreview({ valid: false });
        return;
      }
      setPreview(data as Preview);
    });
  }, [token]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--ch-paper)" }}>
      <div className="w-full max-w-2xl bg-white rounded-xl border p-8 shadow-sm print:shadow-none print:border-0" style={{ borderColor: "var(--ch-line)" }}>
        <div className="flex items-start justify-between gap-3 mb-1 no-print">
          <h1 className="text-xl font-bold" style={{ color: "var(--ch-navy)" }}>
            Compliance<span style={{ color: "var(--ch-ink)", opacity: 0.6 }}>Hub</span>
          </h1>
          {preview?.valid && (
            <button
              onClick={() => window.print()}
              className="text-xs font-semibold rounded-lg px-3 py-1.5 border"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
            >
              Print / Save as PDF
            </button>
          )}
        </div>

        {preview === null && <p className="text-sm mt-4" style={{ color: "var(--ch-sub)" }}>Loading…</p>}

        {preview !== null && !preview.valid && (
          <p className="text-sm mt-4" style={{ color: "var(--ch-sub)" }}>
            This link has expired, been revoked, or is not valid. Ask whoever sent it to you for a new one.
          </p>
        )}

        {preview !== null && preview.valid && (
          <>
            <h2 className="text-lg font-semibold mt-3" style={{ color: "var(--ch-ink)" }}>{preview.crew_name}</h2>
            <div className="text-sm mt-0.5" style={{ color: "var(--ch-sub)" }}>
              {preview.job_role_name}
              {preview.nationality ? ` · ${preview.nationality}` : ""}
            </div>
            <div className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
              {preview.company_name}
              {preview.matrix_title ? ` · ${preview.matrix_title}` : ""}
              {preview.matrix_number ? ` (${preview.matrix_number})` : ""}
              {preview.site_name ? ` · ${preview.site_name}` : ""}
            </div>
            <div className="text-[11px] mt-1 no-print" style={{ color: "var(--ch-sub)" }}>
              Link expires {new Date(preview.expires_at).toDateString()}
            </div>

            <div className="mt-5 space-y-4">
              {groupByCategory(preview.documents).map((group) => (
                <div key={group.category ?? "general"}>
                  <div className="text-[11px] font-bold tracking-wide mb-1.5" style={{ color: "var(--ch-navy)" }}>
                    {formatCategoryLabel(group.category)}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((doc) => (
                      <DocRow key={doc.name} doc={doc} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>
    </main>
  );
}

function DocRow({ doc }: { doc: DocItem }) {
  const info = cellInfo(doc);
  const colors =
    info.kind === "missing"
      ? DOCUMENT_STATUS_COLORS.expired
      : info.kind === "empty"
        ? DOCUMENT_STATUS_COLORS.none
        : info.status
          ? DOCUMENT_STATUS_COLORS[info.status]
          : null;

  return (
    <div className="flex items-center justify-between gap-2 text-xs py-1 border-b" style={{ borderColor: "var(--ch-line)" }}>
      <span style={{ color: "var(--ch-ink)" }}>
        {doc.name}
        {doc.is_mandatory && (
          <span className="ml-0.5 font-semibold" style={{ color: "var(--ch-fail)" }}>*</span>
        )}
      </span>
      <span
        className={colors ? "rounded px-1.5 py-0.5 font-semibold" : "font-semibold"}
        style={colors ? { background: colors.bg, color: colors.fg } : { color: "var(--ch-ink)" }}
      >
        {info.text}
      </span>
    </div>
  );
}
