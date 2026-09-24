import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";

// Bulk Data Migration — company-admin-only home for the two legacy-data
// tools Nishant asked for:
//   1. Crew register import (Excel/CSV export from the old system).
//   2. AI-assisted bulk document intake (one folder per crew member,
//      matched against existing crew_profiles and uploaded into the
//      same crew-documents storage/versioning path the single-person
//      AI intake flow already uses).
//
// Gated on crew.bulk_intake.manage (0027_bulk_intake_permission.sql),
// granted to company_admin only — same pattern as ai.configure. Both
// tools below are placeholders until Nishant provides a sample crew
// register file and the document folders are staged; this page exists
// now so the access boundary is in place and reviewable in Roles &
// Permissions before either tool has any data to act on.
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
        <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>
            Crew Register Import
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            Upload the legacy crew register (Excel/CSV) — crew profiles and their document
            numbers/validity dates — and map its columns to ComplianceHub&apos;s crew records.
          </p>
          <span
            className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "var(--ch-navy-soft, #eef1f6)", color: "var(--ch-navy)" }}
          >
            Coming soon — waiting on a sample export
          </span>
        </div>

        <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>
            Bulk Document Intake
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
            Upload a batch of per-crew-member document folders. AI matches each folder to an
            existing crew member, classifies each file by document type, and stores it as a new
            document version.
          </p>
          <span
            className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "var(--ch-navy-soft, #eef1f6)", color: "var(--ch-navy)" }}
          >
            Coming soon — waiting on the document folders
          </span>
        </div>
      </div>
    </>
  );
}
