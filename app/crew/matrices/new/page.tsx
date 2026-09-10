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

  const [{ data: projects }, { data: sites }] = await Promise.all([
    supabase.from("projects").select("id, project_name").eq("org_id", access.orgId).order("project_name"),
    supabase.from("offshore_sites").select("id, name, project_id").eq("org_id", access.orgId).order("name"),
  ]);

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Start a version-controlled crew matrix for an offshore site — either as a blank draft, or
        generated from that site&rsquo;s existing manning requirements as a starting point.
      </p>
      <NewMatrixForm projects={projects ?? []} sites={sites ?? []} />
    </>
  );
}
