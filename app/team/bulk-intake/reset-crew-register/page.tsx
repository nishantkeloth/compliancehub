import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import Link from "next/link";
import { getCrewRegisterResetPreviewCounts } from "../reset-crew-register-actions";
import ResetCrewRegisterPanel from "../reset-crew-register-panel";

// Bulk Data Migration — Reset Crew Register data. Company-admin-only, same
// gate as the rest of Bulk Data Migration (crew.bulk_intake.manage) plus the
// specific manage permissions the wipe itself needs — see
// requireCrewRegisterResetAccess() in ../reset-crew-register-actions.ts for
// exactly what's checked and why.
//
// Separate from ./reset-data (Matrix/Site/Project/Contract reset), which
// explicitly never touches crew profiles — this is the tool for clearing
// the crew register itself.
export default async function ResetCrewRegisterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (
    !can(access, "crew.bulk_intake.manage") ||
    !can(access, "crew.manage") ||
    !can(access, "crew.documents.manage") ||
    !can(access, "crew.matrix.manage") ||
    !access.orgId
  ) {
    redirect("/team/bulk-intake");
  }

  const counts = await getCrewRegisterResetPreviewCounts();

  return (
    <>
      <Link href="/team/bulk-intake" className="text-xs font-semibold mb-3 inline-block" style={{ color: "var(--ch-sub)" }}>
        ← Bulk Data Migration
      </Link>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        A full reset of the crew register — every crew profile and every crew document, org-wide — plus the crew
        matrices, assignments, and mobilizations that have to go with them. Contractors, Clients, Projects, Contracts,
        and Offshore Sites are never touched.
      </p>
      <ResetCrewRegisterPanel counts={counts} />
    </>
  );
}
