"use server";

// Client Compliance Reports (Phase 10) — server actions backing the
// "Client Reports" section: template management, the review/preview
// screen, the actual Generate & Send, and send history. See
// supabase/migrations/0037_client_compliance_reports.sql for the schema
// and lib/reports/report-columns.ts for the column catalog/resolver this
// shares with the preview screen and the workbook builder.
//
// Same convention as crew matrix sharing (app/crew/matrices/[id]/share-
// actions.ts): the review screen only ever shows a preview built from
// data fetched here, and sendClientReport() below re-fetches everything
// fresh from the database rather than trusting anything the client sent
// back — the preview is for a human to check, never the source of truth
// for what gets emailed.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { sendEmail, companyFromAddress } from "@/lib/email";
import {
  buildColumnCatalog,
  type ReportColumn,
  type ReportCrewRow,
  type ReportDocTypeRef,
  type ReportCustomFieldDef,
} from "@/lib/reports/report-columns";

const PREVIEW_WATERMARK = "PREVIEW — NOT YET SENT";

async function requireReportAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.report.send")) throw new Error("You don't have permission to build or send client compliance reports.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, userEmail: user.email ?? null };
}

const revalidateReports = () => revalidatePath("/reports");

/* ------------------------------------------------------------ */
/* Site → client resolution                                      */
/* ------------------------------------------------------------ */

type SiteClientRow = {
  id: string;
  name: string;
  site_type: string;
  status: string;
  clientId: string | null;
  clientName: string | null;
};

async function resolveSitesWithClients(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<SiteClientRow[]> {
  // Deliberately flat selects + a JS join, not a nested PostgREST embed
  // (offshore_sites.contractors(clients(...)), offshore_sites.projects
  // (contracts(clients(...)))) — this is the same pattern app/sites/
  // page.tsx already uses for these exact tables. A two-path embed off
  // one base table turned out to come back empty rather than erring, so
  // this avoids that risk entirely rather than chasing it further.
  const [{ data: sites, error: sitesErr }, { data: contractors }, { data: projects }, { data: contracts }, { data: clients }] = await Promise.all([
    supabase.from("offshore_sites").select("id, name, site_type, status, contractor_id, project_id").eq("org_id", orgId).eq("status", "active").order("name"),
    supabase.from("contractors").select("id, client_id").eq("org_id", orgId),
    supabase.from("projects").select("id, contract_id").eq("org_id", orgId),
    supabase.from("contracts").select("id, client_id").eq("org_id", orgId),
    supabase.from("clients").select("id, name").eq("org_id", orgId),
  ]);
  if (sitesErr) {
    console.error("resolveSitesWithClients: offshore_sites query failed", sitesErr);
    return [];
  }

  const contractorById = new Map((contractors ?? []).map((c) => [c.id as string, c.client_id as string | null]));
  const projectById = new Map((projects ?? []).map((p) => [p.id as string, p.contract_id as string | null]));
  const contractById = new Map((contracts ?? []).map((c) => [c.id as string, c.client_id as string | null]));
  const clientNameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));

  return (sites ?? []).map((s) => {
    let clientId: string | null = null;
    const contractId = s.project_id ? projectById.get(s.project_id as string) ?? null : null;
    if (contractId) clientId = contractById.get(contractId) ?? null;
    if (!clientId && s.contractor_id) clientId = contractorById.get(s.contractor_id as string) ?? null;

    return {
      id: s.id as string,
      name: s.name as string,
      site_type: s.site_type as string,
      status: s.status as string,
      clientId,
      clientName: clientId ? clientNameById.get(clientId) ?? null : null,
    };
  });
}

async function resolveTemplateForSite(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, siteId: string, clientId: string) {
  const { data: templates } = await supabase
    .from("report_templates")
    .select("id, name, columns, offshore_site_id")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .eq("is_active", true);
  const list = templates ?? [];
  return list.find((t) => t.offshore_site_id === siteId) ?? list.find((t) => t.offshore_site_id === null) ?? null;
}

export async function listReportableSites() {
  const { supabase, access } = await requireReportAccess();
  const sites = await resolveSitesWithClients(supabase, access.orgId!);

  const { data: assignments } = await supabase
    .from("crew_assignments")
    .select("crew_id, offshore_site_id")
    .eq("org_id", access.orgId)
    .is("end_date", null);
  const crewCountBySite = new Map<string, number>();
  for (const a of assignments ?? []) {
    crewCountBySite.set(a.offshore_site_id as string, (crewCountBySite.get(a.offshore_site_id as string) ?? 0) + 1);
  }

  const results = [];
  for (const site of sites) {
    let hasTemplate = false;
    if (site.clientId) {
      const tpl = await resolveTemplateForSite(supabase, access.orgId!, site.id, site.clientId);
      hasTemplate = !!tpl;
    }
    results.push({ ...site, crewCount: crewCountBySite.get(site.id) ?? 0, hasTemplate });
  }
  return results;
}

/* ------------------------------------------------------------ */
/* Template management                                           */
/* ------------------------------------------------------------ */

export async function getReportColumnCatalog() {
  const { supabase, access } = await requireReportAccess();
  const [{ data: docTypes }, { data: customFields }] = await Promise.all([
    supabase.from("document_types").select("id, name, category, warning_threshold_days").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase
      .from("document_custom_field_definitions")
      .select("id, label, field_key, field_type, applies_to_document_type_id")
      .eq("org_id", access.orgId)
      .eq("is_active", true),
  ]);
  const docTypesList = (docTypes ?? []) as ReportDocTypeRef[];
  const customFieldsList = (customFields ?? []) as ReportCustomFieldDef[];
  return { catalog: buildColumnCatalog(docTypesList, customFieldsList), docTypes: docTypesList };
}

export async function listClientsForReports() {
  const { supabase, access } = await requireReportAccess();
  const { data } = await supabase.from("clients").select("id, name").eq("org_id", access.orgId).order("name");
  return data ?? [];
}

export async function listReportTemplates(clientId?: string) {
  const { supabase, access } = await requireReportAccess();
  let query = supabase
    .from("report_templates")
    .select("id, client_id, offshore_site_id, name, columns, is_active, clients(name), offshore_sites(name)")
    .eq("org_id", access.orgId)
    .order("name");
  if (clientId) query = query.eq("client_id", clientId);
  const { data } = await query;
  return (data ?? []).map((t) => ({
    id: t.id as string,
    clientId: t.client_id as string,
    clientName: (Array.isArray(t.clients) ? t.clients[0] : t.clients)?.name ?? null,
    siteId: t.offshore_site_id as string | null,
    siteName: (Array.isArray(t.offshore_sites) ? t.offshore_sites[0] : t.offshore_sites)?.name ?? null,
    name: t.name as string,
    columns: (t.columns ?? []) as ReportColumn[],
    isActive: t.is_active as boolean,
  }));
}

export async function saveReportTemplate(input: { id?: string; clientId: string; siteId: string | null; name: string; columns: ReportColumn[] }) {
  const { supabase, access, userId } = await requireReportAccess();
  if (!input.name.trim()) return { error: "Template name is required." };
  if (!input.columns.length) return { error: "Add at least one column." };

  if (input.id) {
    const { error } = await supabase
      .from("report_templates")
      .update({ name: input.name.trim(), offshore_site_id: input.siteId, columns: input.columns, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("org_id", access.orgId);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("report_templates").insert({
      org_id: access.orgId,
      client_id: input.clientId,
      offshore_site_id: input.siteId,
      name: input.name.trim(),
      columns: input.columns,
      created_by: userId,
      updated_by: userId,
    });
    if (error) return { error: error.message };
  }
  revalidateReports();
  return {};
}

export async function setReportTemplateActive(id: string, isActive: boolean) {
  const { supabase, access } = await requireReportAccess();
  const { error } = await supabase.from("report_templates").update({ is_active: isActive }).eq("id", id).eq("org_id", access.orgId);
  if (error) return { error: error.message };
  revalidateReports();
  return {};
}

/* ------------------------------------------------------------ */
/* Data gathering shared by preview and send                     */
/* ------------------------------------------------------------ */

async function gatherReportData(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, siteId: string, columns: ReportColumn[]) {
  const docTypeIds = new Set<string>();
  for (const col of columns) {
    const m = col.source.match(/^document\.([0-9a-f-]+)\./);
    if (m) docTypeIds.add(m[1]);
  }

  const { data: assignments } = await supabase
    .from("crew_assignments")
    .select("crew_id, start_date, actual_start_date")
    .eq("org_id", orgId)
    .eq("offshore_site_id", siteId)
    .is("end_date", null);
  const assignmentByCrewId = new Map<string, { assignment_start_date: string | null }>();
  const crewIds: string[] = [];
  for (const a of assignments ?? []) {
    const crewId = a.crew_id as string;
    crewIds.push(crewId);
    assignmentByCrewId.set(crewId, { assignment_start_date: (a.actual_start_date as string | null) ?? (a.start_date as string | null) });
  }

  if (crewIds.length === 0) return { rows: [] as ReportCrewRow[], docTypes: [] as ReportDocTypeRef[] };

  const { data: crew } = await supabase
    .from("crew_profiles")
    .select("id, full_name, nationality, employee_code, crew_code, primary_job_role_id")
    .eq("org_id", orgId)
    .eq("employment_status", "active")
    .in("id", crewIds);

  const jobRoleIds = Array.from(new Set((crew ?? []).map((c) => c.primary_job_role_id as string).filter(Boolean)));
  const { data: jobRoles } = jobRoleIds.length
    ? await supabase.from("job_roles").select("id, name, is_key_officer").in("id", jobRoleIds)
    : { data: [] };
  const jobRoleById = new Map((jobRoles ?? []).map((r) => [r.id as string, { name: r.name as string, is_key_officer: r.is_key_officer as boolean }]));

  const { data: docTypesRaw } = docTypeIds.size
    ? await supabase.from("document_types").select("id, name, category, warning_threshold_days").in("id", Array.from(docTypeIds))
    : { data: [] };
  const docTypes = (docTypesRaw ?? []) as ReportDocTypeRef[];

  const { data: crewDocs } =
    crewIds.length && docTypeIds.size
      ? await supabase
          .from("crew_documents")
          .select("crew_id, document_type_id, document_number, issue_date, expiry_date, custom_fields, created_at")
          .eq("org_id", orgId)
          .in("crew_id", crewIds)
          .in("document_type_id", Array.from(docTypeIds))
          .order("created_at", { ascending: false })
      : { data: [] };

  const latestDoc = new Map<string, ReportCrewRow["documents"][string]>();
  for (const d of crewDocs ?? []) {
    const key = `${d.crew_id}:${d.document_type_id}`;
    if (!latestDoc.has(key)) {
      latestDoc.set(key, {
        document_number: d.document_number as string | null,
        issue_date: d.issue_date as string | null,
        expiry_date: d.expiry_date as string | null,
        custom_fields: (d.custom_fields as Record<string, unknown> | null) ?? null,
      });
    }
  }

  const rows: ReportCrewRow[] = (crew ?? [])
    .map((c) => {
      const role = jobRoleById.get(c.primary_job_role_id as string);
      const documents: ReportCrewRow["documents"] = {};
      for (const docTypeId of docTypeIds) {
        const entry = latestDoc.get(`${c.id}:${docTypeId}`);
        if (entry) documents[docTypeId] = entry;
      }
      return {
        crew_id: c.id as string,
        full_name: c.full_name as string,
        nationality: c.nationality as string | null,
        employee_code: c.employee_code as string | null,
        crew_code: c.crew_code as string | null,
        job_role_name: role?.name ?? "—",
        is_key_officer: role?.is_key_officer ?? false,
        assignment_start_date: assignmentByCrewId.get(c.id as string)?.assignment_start_date ?? null,
        documents,
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return { rows, docTypes };
}

/* ------------------------------------------------------------ */
/* Preview (review-before-send)                                  */
/* ------------------------------------------------------------ */

export async function getClientReportPreview(siteId: string) {
  const { supabase, access } = await requireReportAccess();
  const sites = await resolveSitesWithClients(supabase, access.orgId!);
  const site = sites.find((s) => s.id === siteId);
  if (!site) return { error: "Site not found." };
  if (!site.clientId) return { error: "This site has no client set up (via Projects/Contracts or a Contractor) — nothing to report against." };

  const template = await resolveTemplateForSite(supabase, access.orgId!, siteId, site.clientId);
  if (!template) return { error: "No report template is set up for this client/site yet. Build one under the Templates tab first." };

  const columns = (template.columns ?? []) as ReportColumn[];
  const { rows, docTypes } = await gatherReportData(supabase, access.orgId!, siteId, columns);
  if (rows.length === 0) return { error: "No crew are currently assigned to this site — nothing to report." };

  const { data: contacts } = await supabase
    .from("client_contacts")
    .select("id, full_name, email, title")
    .eq("org_id", access.orgId)
    .eq("client_id", site.clientId)
    .eq("is_active", true)
    .order("full_name");

  const { resolveColumn } = await import("@/lib/reports/report-columns");
  const docTypesById = new Map(docTypes.map((d) => [d.id, d]));
  const flaggedCount = rows.filter((row) =>
    columns.some((col) => {
      const resolved = resolveColumn(col, row, docTypesById);
      return resolved.status === "expired" || resolved.status === "critical";
    })
  ).length;

  return {
    siteId,
    siteName: site.name,
    clientId: site.clientId ?? null,
    clientName: site.clientName ?? null,
    templateId: template.id as string,
    templateName: template.name as string,
    columns,
    docTypes,
    rows,
    flaggedCount,
    contacts: (contacts ?? []).map((c) => ({ id: c.id as string, fullName: c.full_name as string, email: c.email as string, title: c.title as string | null })),
    previewWatermark: PREVIEW_WATERMARK,
  };
}

/* ------------------------------------------------------------ */
/* Generate & Send                                                */
/* ------------------------------------------------------------ */

export async function sendClientReport(input: {
  siteId: string;
  recipients: { clientContactId?: string | null; name: string; email: string }[];
  subject: string;
  bodyText: string;
}) {
  const { supabase, access, userId, userEmail } = await requireReportAccess();
  const recipients = input.recipients.filter((r) => r.name.trim() && r.email.trim());
  if (recipients.length === 0) return { error: "Add at least one recipient." };
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const badEmail = recipients.find((r) => !emailPattern.test(r.email.trim()));
  if (badEmail) return { error: `"${badEmail.email}" doesn't look like a valid email address.` };
  if (!input.subject.trim()) return { error: "Subject is required." };
  if (!input.bodyText.trim()) return { error: "Message body is required." };

  const sites = await resolveSitesWithClients(supabase, access.orgId!);
  const site = sites.find((s) => s.id === input.siteId);
  if (!site || !site.clientId) return { error: "Site or client not found." };

  const template = await resolveTemplateForSite(supabase, access.orgId!, input.siteId, site.clientId);
  if (!template) return { error: "No report template is set up for this client/site." };

  const columns = (template.columns ?? []) as ReportColumn[];
  const { rows, docTypes } = await gatherReportData(supabase, access.orgId!, input.siteId, columns);
  if (rows.length === 0) return { error: "No crew are currently assigned to this site — nothing to send." };

  const { resolveColumn } = await import("@/lib/reports/report-columns");
  const docTypesById = new Map(docTypes.map((d) => [d.id, d]));
  const flaggedCount = rows.filter((row) =>
    columns.some((col) => {
      const resolved = resolveColumn(col, row, docTypesById);
      return resolved.status === "expired" || resolved.status === "critical";
    })
  ).length;

  const { buildClientReportWorkbook } = await import("@/lib/reports/build-report-workbook");
  const ExcelJS = (await import("exceljs")).default;
  const wb = await buildClientReportWorkbook(ExcelJS, site.name, columns, rows, docTypes);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const excelBase64 = buffer.toString("base64");
  const safeSiteName = site.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${safeSiteName}_Compliance_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;

  const { data: company } = await supabase.from("companies").select("name, notify_prefix").eq("id", access.orgId).single();
  const companyDisplayName = company?.name ?? access.companyName ?? "ComplianceHub";
  const fromAddress = companyFromAddress(companyDisplayName, company?.notify_prefix ?? null);
  const fromDisplayName = access.fullName ? `${access.fullName} via ComplianceHub` : `${companyDisplayName} via ComplianceHub`;
  const fromHeader = `${fromDisplayName} <${fromAddress}>`;

  const storagePath = `${access.orgId}/${site.id}/${Date.now()}-${fileName}`;
  const { error: uploadErr } = await supabase.storage.from("client-reports").upload(storagePath, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (uploadErr) return { error: `Could not save the generated report: ${uploadErr.message}` };

  const bodyTextTrimmed = input.bodyText.trim();
  const bodyHtml = renderReportEmailHtml({
    bodyText: bodyTextTrimmed,
    siteName: site.name,
    clientName: site.clientName,
    rowCount: rows.length,
    flaggedCount,
  });

  const { data: pkg, error: pkgErr } = await supabase
    .from("report_send_packages")
    .insert({
      org_id: access.orgId,
      report_template_id: template.id,
      offshore_site_id: site.id,
      client_id: site.clientId,
      site_name_snapshot: site.name,
      client_name_snapshot: site.clientName,
      template_name_snapshot: template.name,
      row_count: rows.length,
      flagged_count: flaggedCount,
      status: "sent",
      from_address_snapshot: fromHeader,
      from_display_name_snapshot: fromDisplayName,
      reply_to_snapshot: userEmail,
      email_subject_snapshot: input.subject.trim(),
      email_body_snapshot: bodyTextTrimmed,
      storage_path: storagePath,
      file_name: fileName,
      rows_snapshot: { columns, rows },
      created_by: userId,
    })
    .select("id")
    .single();
  if (pkgErr || !pkg) return { error: pkgErr?.message ?? "Could not create the send record." };

  const results: { name: string; email: string; status: "sent" | "failed"; error?: string }[] = [];
  let anySent = false;
  let anyFailed = false;

  for (const r of recipients) {
    const { data: recipientRow, error: recErr } = await supabase
      .from("report_send_recipients")
      .insert({
        org_id: access.orgId,
        send_package_id: pkg.id,
        client_contact_id: r.clientContactId ?? null,
        recipient_name: r.name.trim(),
        recipient_email: r.email.trim(),
      })
      .select("id")
      .single();
    if (recErr || !recipientRow) {
      results.push({ name: r.name, email: r.email, status: "failed", error: recErr?.message ?? "Could not record recipient." });
      anyFailed = true;
      continue;
    }

    const sendResult = await sendEmail({
      from: fromHeader,
      to: r.email.trim(),
      subject: input.subject.trim(),
      html: bodyHtml,
      text: bodyTextTrimmed,
      replyTo: userEmail ?? undefined,
      attachments: [{ filename: fileName, content: excelBase64, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
    });

    if (sendResult.error) {
      await supabase.from("report_send_recipients").update({ delivery_status: "failed", send_error: sendResult.error }).eq("id", recipientRow.id);
      results.push({ name: r.name, email: r.email, status: "failed", error: sendResult.error });
      anyFailed = true;
    } else {
      await supabase.from("report_send_recipients").update({ delivery_status: "sent", provider_message_id: sendResult.id }).eq("id", recipientRow.id);
      results.push({ name: r.name, email: r.email, status: "sent" });
      anySent = true;
    }
  }

  const finalStatus = anySent && anyFailed ? "partially_sent" : anySent ? "sent" : "failed";
  await supabase.from("report_send_packages").update({ status: finalStatus }).eq("id", pkg.id);

  revalidateReports();
  return { packageId: pkg.id as string, results };
}

function renderReportEmailHtml(opts: { bodyText: string; siteName: string; clientName: string | null; rowCount: number; flaggedCount: number }) {
  const escaped = opts.bodyText
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br/>");
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; line-height: 1.6;">
      <p>${escaped}</p>
      <table cellpadding="0" cellspacing="0" style="margin: 16px 0; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; background: #f8fafc;">
        <tr><td style="color:#64748b; font-size:12px; padding-bottom:4px;">Vessel / site</td><td style="padding-left:16px; font-weight:600;">${opts.siteName}</td></tr>
        ${opts.clientName ? `<tr><td style="color:#64748b; font-size:12px; padding-bottom:4px;">Client</td><td style="padding-left:16px;">${opts.clientName}</td></tr>` : ""}
        <tr><td style="color:#64748b; font-size:12px; padding-bottom:4px;">Crew on report</td><td style="padding-left:16px;">${opts.rowCount}</td></tr>
      </table>
      <p>The compliance report is attached as an Excel workbook.</p>
    </div>
  `;
}

/* ------------------------------------------------------------ */
/* Send history                                                  */
/* ------------------------------------------------------------ */

export async function listReportSendHistory(siteId?: string) {
  const { supabase, access } = await requireReportAccess();
  let query = supabase
    .from("report_send_packages")
    .select("id, site_name_snapshot, client_name_snapshot, template_name_snapshot, row_count, flagged_count, status, file_name, created_at")
    .eq("org_id", access.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (siteId) query = query.eq("offshore_site_id", siteId);
  const { data: packages } = await query;
  if (!packages || packages.length === 0) return [];

  const { data: recipients } = await supabase
    .from("report_send_recipients")
    .select("send_package_id, recipient_name, recipient_email, delivery_status")
    .in(
      "send_package_id",
      packages.map((p) => p.id)
    );
  const recipientsByPackage = new Map<string, { name: string; email: string; status: string }[]>();
  for (const r of recipients ?? []) {
    const list = recipientsByPackage.get(r.send_package_id as string) ?? [];
    list.push({ name: r.recipient_name as string, email: r.recipient_email as string, status: r.delivery_status as string });
    recipientsByPackage.set(r.send_package_id as string, list);
  }

  return packages.map((p) => ({
    id: p.id as string,
    siteName: p.site_name_snapshot as string,
    clientName: p.client_name_snapshot as string | null,
    templateName: p.template_name_snapshot as string | null,
    rowCount: p.row_count as number,
    flaggedCount: p.flagged_count as number,
    status: p.status as string,
    fileName: p.file_name as string,
    createdAt: p.created_at as string,
    recipients: recipientsByPackage.get(p.id as string) ?? [],
  }));
}

export async function getReportFileDownloadUrl(packageId: string) {
  const { supabase, access } = await requireReportAccess();
  const { data: pkg, error } = await supabase.from("report_send_packages").select("storage_path").eq("id", packageId).eq("org_id", access.orgId).single();
  if (error || !pkg) return { error: "Report not found." };
  const { data, error: signErr } = await supabase.storage.from("client-reports").createSignedUrl(pkg.storage_path, 300);
  if (signErr || !data) return { error: signErr?.message ?? "Could not create a download link." };
  return { url: data.signedUrl };
}
