import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import Link from "next/link";
import { getResetPreviewCounts } from "../reset-actions";
import ResetPanel from "../reset-panel";

// Bulk Data Migration — Reset Crew Matrix / Site / Project / Contract
// data. Company-admin-only, same gate as the rest of Bulk Data
// Migration (crew.bulk_intake.manage) plus the specific manage
// permissions each affected module already requires — see
// requireResetAccess() in ../reset-actions.ts for exactly what's
// checked and why.
export default async function ResetDataPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (
    !can(access, "crew.bulk_intake.manage") ||
    !can(access, "crew.matrix.manage") ||
    !can(access, "crew.manage") ||
    !can(access, "projects.manage") ||
    !can(access, "contracts.manage") ||
    !access.orgId
  ) {
    redirect("/team/bulk-intake");
  }

  const counts = await getResetPreviewCounts();

  return (
    <>
      <Link href="/team/bulk-intake" className="text-xs font-semibold mb-3 inline-block" style={{ color: "var(--ch-sub)" }}>
        ← Bulk Data Migration
      </Link>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        A one-time clean-slate reset for the Crew Matrix &amp; Deployment side of the app — clears crew matrices,
        offshore sites, projects, and contracts (and everything that hangs off them) before going live. Contractors,
        Clients, and crew profiles are never touched.
      </p>
      <ResetPanel counts={counts} />
    </>
  );
}
