import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEffectiveAccess, can } from "@/lib/rbac";
import NewContainerForm from "./new-container-form";

export default async function NewContainerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "containers.manage") || !access.orgId) redirect("/containers");

  return (
    <>
      <Link href="/containers" className="text-sm hover:underline" style={{ color: "var(--ch-navy)" }}>‹ All containers</Link>
      <h2 className="text-lg font-bold mt-2 mb-4" style={{ color: "var(--ch-ink)" }}>New container</h2>
      <NewContainerForm />
    </>
  );
}
