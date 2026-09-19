"use client";

// Public, token-gated Crew Matrix Sharing page (Increment 1). No
// ComplianceHub account needed; the token is validated by a SECURITY
// DEFINER RPC that only ever returns THIS package's snapshotted staff
// and document status — never a live query, never another package's
// data. Increment 1 shows document status (numbers/dates/expiry), the
// same fidelity already shipped for the per-candidate resource-profile
// link — it does not expose the underlying document files themselves;
// that's planned alongside ZIP delivery in a later increment so file
// access gets its own signed-URL + audit handling rather than being
// added here as an afterthought.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_STATUS_COLORS, type DocumentStatus } from "@/lib/document-status";

type DocSnap = { name: string; category: string | null; is_mandatory: boolean; status_text: string; status_kind: "na" | "missing" | "empty" | "value"; status: DocumentStatus | null };
type StaffSnap = { share_staff_id: string; staff: { full_name: string; nationality: string | null; job_role_name: string }; documents: DocSnap[] };

type Preview =
  | {
      valid: true;
      share_reference: string;
      matrix_title: string;
      matrix_number: string | null;
      matrix_version: number;
      matrix_status_at_share: string;
      client_name: string | null;
      project_name: string | null;
      site_name: string | null;
      company_name: string;
      recipient_name: string;
      expires_at: string;
      staff: StaffSnap[];
    }
  | { valid: false };

function groupByRank(staff: StaffSnap[]): { rank: string; people: StaffSnap[] }[] {
  const groups: { rank: string; people: StaffSnap[] }[] = [];
  for (const s of staff) {
    const last = groups[groups.length - 1];
    if (last && last.rank === s.staff.job_role_name) last.people.push(s);
    else groups.push({ rank: s.staff.job_role_name, people: [s] });
  }
  return groups;
}

export default function ShareView({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc("get_crew_matrix_share_preview", { p_token: token }).then(({ data, error }) => {
      if (error || !data?.valid) {
        setPreview({ valid: false });
        return;
      }
      setPreview(data as Preview);
    });
  }, [token]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--ch-paper)" }}>
      <div className="w-full max-w-3xl bg-white rounded-xl border p-8 shadow-sm print:shadow-none print:border-0" style={{ borderColor: "var(--ch-line)" }}>
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
            This secure crew-matrix link has expired or is no longer available. Please contact the sender for an updated link.
          </p>
        )}

        {preview !== null && preview.valid && (
          <>
            <h2 className="text-lg font-semibold mt-3" style={{ color: "var(--ch-ink)" }}>{preview.matrix_title}</h2>
            <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>
              {preview.matrix_number ?? "—"} · v{preview.matrix_version}
              {preview.project_name ? ` · ${preview.project_name}` : ""}
              {preview.site_name ? ` · ${preview.site_name}` : ""}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--ch-sub)" }}>
              {preview.company_name}
              {preview.client_name ? ` for ${preview.client_name}` : ""} · Sharing reference {preview.share_reference}
            </div>
            <div className="text-[11px] mt-1 no-print" style={{ color: "var(--ch-sub)" }}>
              Prepared for {preview.recipient_name} — link expires {new Date(preview.expires_at).toDateString()}. Please do not forward this link.
            </div>

            <div className="mt-5 space-y-5">
              {groupByRank(preview.staff).map((group) => (
                <div key={group.rank}>
                  <div className="text-xs font-bold tracking-wide mb-2 uppercase" style={{ color: "var(--ch-navy)" }}>{group.rank}</div>
                  <div className="space-y-3">
                    {group.people.map((p) => (
                      <div key={p.share_staff_id} className="rounded-lg border p-3" style={{ borderColor: "var(--ch-line)" }}>
                        <div className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>
                          {p.staff.full_name}
                          {p.staff.nationality && <span className="font-normal" style={{ color: "var(--ch-sub)" }}> · {p.staff.nationality}</span>}
                        </div>
                        <div className="mt-2 space-y-1">
                          {p.documents.map((doc) => (
                            <DocRow key={doc.name} doc={doc} />
                          ))}
                        </div>
                      </div>
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

function DocRow({ doc }: { doc: DocSnap }) {
  const colors =
    doc.status_kind === "missing"
      ? DOCUMENT_STATUS_COLORS.expired
      : doc.status_kind === "empty"
        ? DOCUMENT_STATUS_COLORS.none
        : doc.status
          ? DOCUMENT_STATUS_COLORS[doc.status]
          : null;

  return (
    <div className="flex items-center justify-between gap-2 text-xs py-1 border-b last:border-0" style={{ borderColor: "var(--ch-line)" }}>
      <span style={{ color: "var(--ch-ink)" }}>
        {doc.name}
        {doc.is_mandatory && <span className="ml-0.5 font-semibold" style={{ color: "var(--ch-fail)" }}>*</span>}
      </span>
      <span
        className={colors ? "rounded px-1.5 py-0.5 font-semibold" : "font-semibold"}
        style={colors ? { background: colors.bg, color: colors.fg } : { color: "var(--ch-ink)" }}
      >
        {doc.status_text}
      </span>
    </div>
  );
}
