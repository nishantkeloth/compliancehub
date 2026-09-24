import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import Link from "next/link";
import DocumentIntakePanel from "./document-intake-panel";

export default async function DocumentIntakePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.bulk_intake.manage") || !access.orgId) redirect("/team");
  if (!can(access, "crew.documents.manage")) redirect("/team/bulk-intake");

  return (
    <>
      <Link href="/team/bulk-intake" className="text-xs font-semibold mb-3 inline-block" style={{ color: "var(--ch-sub)" }}>
        ← Bulk Data Migration
      </Link>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Select the documents folder on your computer — one subfolder per crew member, their files
        inside it. Each folder is matched to an existing crew member, each file is read and
        classified by AI, and nothing is uploaded until you review and confirm.
      </p>
      <DocumentIntakePanel />
    </>
  );
}
