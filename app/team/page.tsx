import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import NewMemberForm from "./new-member-form";
import MemberRow from "./member-row";

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "team.view") || !access.orgId) {
    redirect("/");
  }

  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name, status, roles(name)")
    .eq("org_id", access.orgId)
    .order("full_name");

  const { data: roles } = await supabase
    .from("roles")
    .select("id, name")
    .eq("org_id", access.orgId)
    .order("name");

  const canInvite = can(access, "team.invite");
  const canManageStatus = can(access, "team.manage_status");

  return (
    <>
      {canInvite && (
        <>
          <h2
            className="text-sm font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--ch-sub)" }}
          >
            Add a team member
          </h2>
          <NewMemberForm roles={roles ?? []} />
        </>
      )}

      <h2
        className="text-sm font-semibold uppercase tracking-wide mb-3 mt-8"
        style={{ color: "var(--ch-sub)" }}
      >
        Team ({(members ?? []).length})
      </h2>
      <div className="space-y-3">
        {(members ?? []).map((m: any) => (
          <MemberRow
            key={m.id}
            member={{ id: m.id, full_name: m.full_name, status: m.status, roleName: m.roles?.name ?? "—" }}
            isSelf={m.id === user.id}
            canManageStatus={canManageStatus}
          />
        ))}
      </div>
    </>
  );
}
