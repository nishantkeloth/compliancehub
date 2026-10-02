import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import ReportsManager from "./reports-manager";
import { listReportableSites, listClientsForReports, listReportTemplates, listReportSendHistory } from "./actions";

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.report.send")) redirect("/");

  const [sites, clients, templates, history] = await Promise.all([
    listReportableSites(),
    listClientsForReports(),
    listReportTemplates(),
    listReportSendHistory(),
  ]);

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Generate the per-vessel crew roster + document-compliance workbook clients expect, review it, and send it — every
        send is kept with the exact file and data that went out, for when a client disputes it.
      </p>
      <ReportsManager sites={sites} clients={clients} templates={templates} history={history} />
    </>
  );
}
