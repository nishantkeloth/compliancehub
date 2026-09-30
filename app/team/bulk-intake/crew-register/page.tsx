import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import Link from "next/link";
import CrewRegisterImportPanel from "./crew-register-panel";

// A large workbook's parse/match (parseCrewRegisterFile) and the commit loop
// (commitCrewRegisterImport) can take a while on the server — raise the
// ceiling for whatever headroom the hosting plan allows, mirroring the same
// fix already applied to the Bulk Document Intake page.
export const maxDuration = 300;

export default async function CrewRegisterImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.bulk_intake.manage") || !access.orgId) redirect("/team");

  return (
    <>
      <Link href="/team/bulk-intake" className="text-xs font-semibold mb-3 inline-block" style={{ color: "var(--ch-sub)" }}>
        ← Bulk Data Migration
      </Link>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Upload the filled-in{" "}
        <a
          href="/api/crew/register-template"
          download
          className="font-semibold underline"
          style={{ color: "var(--ch-navy)" }}
        >
          crew register template
        </a>{" "}
        (Crew Profile + Documents tabs — generated fresh each time from this company&rsquo;s current Document Types and their custom fields), or a client-provided crew list in its own layout — columns are matched automatically when the template tabs aren&rsquo;t found. Nothing is saved until you review the matches below and confirm the import.
      </p>
      <CrewRegisterImportPanel canDocuments={can(access, "crew.documents.manage")} />
    </>
  );
}
