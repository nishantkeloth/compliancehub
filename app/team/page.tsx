import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "../app-shell";
import NewMemberForm from "./new-member-form";
import MemberRow from "./member-row";

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "company_admin" || !profile.org_id) {
    redirect("/");
  }

  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name, role, status")
    .eq("org_id", profile.org_id)
    .order("full_name");

  return (
    <AppShell active="team" title="Manage Users">
      <h2
        className="text-sm font-semibold uppercase tracking-wide mb-3"
        style={{ color: "var(--ch-sub)" }}
      >
        Add a team member
      </h2>
      <NewMemberForm />

      <h2
        className="text-sm font-semibold uppercase tracking-wide mb-3 mt-8"
        style={{ color: "var(--ch-sub)" }}
      >
        Team ({(members ?? []).length})
      </h2>
      <div className="space-y-3">
        {(members ?? []).map((m) => (
          <MemberRow key={m.id} member={m} isSelf={m.id === user.id} />
        ))}
      </div>
    </AppShell>
  );
}
