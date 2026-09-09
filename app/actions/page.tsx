import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ActionRow from "./action-row";
import AppShell from "../app-shell";
import { getEffectiveAccess, can } from "@/lib/rbac";

export default async function ActionsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  const canManage = can(access, "actions.close");

  const { data: actions } = await supabase
    .from("corrective_actions")
    .select(
      "id, title, finding, owner_id, owner_name, priority, due_date, status, closed_at, created_at, sites(name), inspection_responses(photo_urls)"
    )
    .order("created_at", { ascending: false });

  let members: { id: string; full_name: string | null }[] = [];
  if (access.orgId) {
    const { data: memberRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", access.orgId)
      .order("full_name");
    members = memberRows ?? [];
  }

  const open = (actions ?? []).filter((a: any) => a.status === "open" || a.status === "in_progress");
  const closed = (actions ?? []).filter((a: any) => a.status === "closed");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell active="actions" title="Corrective Actions">
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Every failed check point becomes a tracked action here automatically.
      </p>

      <div className="mb-8">
        <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
          Open ({open.length})
        </div>
        {open.length === 0 ? (
          <div className="bg-white border rounded-xl p-6 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
            No open actions — nice work.
          </div>
        ) : (
          <div className="space-y-3">
            {open.map((a: any) => (
              <ActionRow key={a.id} action={a} overdue={a.due_date < today} canManage={canManage} members={members} />
            ))}
          </div>
        )}
      </div>

      {closed.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
            Closed ({closed.length})
          </div>
          <div className="space-y-3">
            {closed.map((a: any) => (
              <ActionRow key={a.id} action={a} overdue={false} canManage={canManage} members={members} />
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}
