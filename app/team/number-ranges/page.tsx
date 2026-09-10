import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { can, getEffectiveAccess } from "@/lib/rbac";
import NumberRangesManager from "./number-ranges-manager";

export default async function NumberRangesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "team.manage_number_ranges") || !access.orgId) {
    redirect("/team");
  }

  const { data: ranges } = await supabase
    .from("number_range_configs")
    .select("id, entity_type, prefix, padding_length, current_number, is_active")
    .eq("org_id", access.orgId)
    .order("entity_type");

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Configure how Client, Contractor, Contract, Project, and Crew Matrix codes are
        auto-generated when new records are created — a prefix, how many digits to pad to, and
        the last number issued.
      </p>
      <NumberRangesManager ranges={ranges ?? []} />
    </>
  );
}
