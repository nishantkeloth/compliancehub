import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import NewMatrixForm from "./new-matrix-form";

export default async function NewCrewMatrixPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.matrix.manage") || !access.orgId) redirect("/crew/matrices");

  const [{ data: projects }, { data: sites }, { data: aiSettings }] = await Promise.all([
    supabase.from("projects").select("id, project_name").eq("org_id", access.orgId).order("project_name"),
    supabase.from("offshore_sites").select("id, name, project_id").eq("org_id", access.orgId).order("name"),
    supabase.from("ai_settings").select("ai_enabled").eq("org_id", access.orgId).maybeSingle(),
  ]);
  // Phase 9: the AI option is shown unless the company has switched AI off.
  const aiVisible = aiSettings?.ai_enabled ?? true;

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Start a version-controlled crew matrix for an offshore site — as a blank draft, generated
        from that site&rsquo;s existing manning requirements, or proposed by AI from a client
        document or the project context (always reviewed before it becomes a draft).
      </p>
      <NewMatrixForm projects={projects ?? []} sites={sites ?? []} aiVisible={aiVisible} />
    </>
  );
}
