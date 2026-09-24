import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import Link from "next/link";
import CrewRegisterImportPanel from "./crew-register-panel";

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
          href="/templates/crew-legacy-import-template.xlsx"
          download
          className="font-semibold underline"
          style={{ color: "var(--ch-navy)" }}
        >
          crew register template
        </a>{" "}
        (Crew Profile + Documents tabs). Nothing is saved until you review the matches below and confirm the import.
      </p>
      <CrewRegisterImportPanel canDocuments={can(access, "crew.documents.manage")} />
    </>
  );
}
