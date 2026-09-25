import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import Link from "next/link";

// Bulk Data Migration — company-admin-only home for legacy-data and
// data-reset tools:
//   1. Crew register import (Excel/CSV export from the old system) — live,
//      see ./crew-register (upload → review/match → commit).
//   2. AI-assisted bulk document intake (one folder per crew member,
//      matched against existing crew_profiles and uploaded into the
//      same crew-documents storage/versioning path the single-person
//      AI intake flow already uses) — live, see ./document-intake
//      (folder → crew match → AI classify per file → review → commit).
//   3. Reset crew matrix/site/project/contract data — live, see
//      ./reset-data (typed-confirmation full wipe, for clearing
//      test/demo data before go-live).
//
// Gated on crew.bulk_intake.manage (0027_bulk_intake_permission.sql),
// granted to company_admin only — same pattern as ai.configure.
export default async function BulkIntakePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.bulk_intake.manage") || !access.orgId) redirect("/team");

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        One-time migration tools for bringing in data from the legacy system. Restricted to
        company admins.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/team/bulk-intake/crew-register"
          className="block bg-white border rounded-xl p-5 hover:shadow-sm transition-shadow"
          style={{ borderColor: "var(--ch-line)" }}
        >
          <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>
            Crew Register Import →
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            Upload the filled-in crew register template (Excel) — crew profiles and their
            document numbers/validity dates — review the matches, and import.
          </p>
          <span
            className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "var(--ch-pass-bg, #dcfce7)", color: "var(--ch-pass, #15803d)" }}
          >
            Ready
          </span>
        </Link>

        <Link
          href="/team/bulk-intake/document-intake"
          className="block bg-white border rounded-xl p-5 hover:shadow-sm transition-shadow"
          style={{ borderColor: "var(--ch-line)" }}
        >
          <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>
            Bulk Document Intake →
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            Select a batch of per-crew-member document folders. AI matches each folder to an
            existing crew member, classifies each file by document type, and stores it as a new
            document version.
          </p>
          <span
            className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "var(--ch-pass-bg, #dcfce7)", color: "var(--ch-pass, #15803d)" }}
          >
            Ready
          </span>
        </Link>

        <Link
          href="/team/bulk-intake/reset-data"
          className="block bg-white border rounded-xl p-5 hover:shadow-sm transition-shadow"
          style={{ borderColor: "var(--ch-fail)" }}
        >
          <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-fail)" }}>
            Reset Crew Matrix / Site / Project / Contract Data →
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            Permanently clear crew matrices, offshore sites, projects, and contracts — and everything that hangs off
            them — before going live. Contractors, Clients, and crew profiles are left untouched.
          </p>
          <span
            className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}
          >
            Destructive
          </span>
        </Link>
      </div>
    </>
  );
}
