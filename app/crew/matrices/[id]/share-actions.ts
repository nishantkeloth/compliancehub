"use server";

// Client Crew Matrix Sharing (Increment 1) — server actions backing the
// "Send Matrix to Client" wizard and "Sharing History" panel on the
// Staffing Plan tab. See supabase/migrations/0018_client_contacts_and_matrix_sharing.sql
// for the schema this writes to, and the project doc
// phase11-crew-matrix-client-sharing-assessment.md for what was
// deliberately deferred out of this increment (ZIP/PDF attachments, OTP,
// sender-domain verification, a background job queue).
//
// Everything here re-fetches the matrix/lines/assigned-crew/documents
// fresh from the database at send time rather than trusting client-
// supplied snapshot data — the wizard only ever shows a preview of this
// same data, it never becomes the source of truth for what gets sent.

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { sendEmail, companyFromAddress } from "@/lib/email";
import {
  cellInfo,
  orderDocumentColumns,
  buildStaffingPlanWorkbook,
  type DocTypeRef,
  type LineLike,
  type StaffingCrew,
  type FieldDef,
} from "@/lib/staffing-plan-shared";

const LINK_EXPIRY_DAYS = 30;
const SHAREABLE_STATUSES = new Set(["approved", "active"]);

async function requireShare(message = "You don't have permission to share crew matrices with clients.") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.matrix.share")) throw new Error(message);
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id, userEmail: user.email ?? null };
}

async function requireClientManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) throw new Error("You don't have permission to manage client contacts.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

const revalidateMatrix = (crewMatrixId: string) => revalidatePath(`/crew/matrices/${crewMatrixId}`);

// ------------------------------------------------------------
// Wizard bootstrap — the matrix's client and that client's contacts.
// ------------------------------------------------------------

export async function getMatrixShareContext(crewMatrixId: string) {
  const { supabase, access } = await requireShare();

  const { data: matrix, error: matrixErr } = await supabase
    .from("crew_matrices")
    .select("id, projects(contracts(client_id, clients(id, name)))")
    .eq("id", crewMatrixId)
    .eq("org_id", access.orgId)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };

  const project = (Array.isArray(matrix.projects) ? matrix.projects[0] : matrix.projects) as
    | { contracts?: { client_id?: string; clients?: { id?: string; name?: string } | { id?: string; name?: string }[] } | { client_id?: string; clients?: { id?: string; name?: string } | { id?: string; name?: string }[] }[] }
    | null;
  const contract = project?.contracts ? (Array.isArray(project.contracts) ? project.contracts[0] : project.contracts) : null;
  const clientRel = contract?.clients ? (Array.isArray(contract.clients) ? contract.clients[0] : contract.clients) : null;
  const clientId = clientRel?.id ?? null;
  const clientName = clientRel?.name ?? null;

  const { data: contacts } = clientId
    ? await supabase
        .from("client_contacts")
        .select("id, full_name, email, title, is_active")
        .eq("org_id", access.orgId)
        .eq("client_id", clientId)
        .eq("is_active", true)
        .order("full_name")
    : { data: [] };

  return {
    clientId,
    clientName,
    contacts: (contacts ?? []).map((c) => ({ id: c.id as string, fullName: c.full_name as string, email: c.email as string, title: c.title as string | null })),
  };
}

export async function createClientContact(clientId: string, fullName: string, email: string, title?: string) {
  const { supabase, access, userId } = await requireClientManage();
  if (!fullName.trim() || !email.trim()) return { error: "Name and email are required." };
  const { data: client, error: clientErr } = await supabase.from("clients").select("id").eq("id", clientId).eq("org_id", access.orgId).single();
  if (clientErr || !client) return { error: "Client not found." };

  const { data, error } = await supabase
    .from("client_contacts")
    .insert({
      org_id: access.orgId,
      client_id: clientId,
      full_name: fullName.trim(),
      email: email.trim(),
      title: title?.trim() || null,
      created_by: userId,
      updated_by: userId,
    })
    .select("id, full_name, email, title")
    .single();
  if (error) return { error: error.message };
  return { contact: { id: data.id as string, fullName: data.full_name as string, email: data.email as string, title: data.title as string | null } };
}

// ------------------------------------------------------------
// Send
// ------------------------------------------------------------

type Recipient = { name: string; email: string; clientContactId?: string | null };

export async function sendMatrixSharePackage(input: {
  crewMatrixId: string;
  recipients: Recipient[];
  subject: string;
  bodyText: string;
  includeExcel: boolean;
}) {
  const { supabase, access, userId, userEmail } = await requireShare();
  const recipients = input.recipients.filter((r) => r.name.trim() && r.email.trim());
  if (recipients.length === 0) return { error: "Add at least one recipient." };
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const badEmail = recipients.find((r) => !emailPattern.test(r.email.trim()));
  if (badEmail) return { error: `"${badEmail.email}" doesn't look like a valid email address.` };
  if (!input.subject.trim()) return { error: "Subject is required." };
  if (!input.bodyText.trim()) return { error: "Message body is required." };

  // ---- Re-fetch the matrix, its lines, and its currently-assigned crew
  // fresh from the database — never trust client-supplied snapshot data
  // for what actually gets sent.
  const { data: matrix, error: matrixErr } = await supabase
    .from("crew_matrices")
    .select(
      "id, matrix_number, version_number, title, status, offshore_site_id, projects(project_name, contracts(client_id, clients(name))), offshore_sites(name)"
    )
    .eq("id", input.crewMatrixId)
    .eq("org_id", access.orgId)
    .single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };

  if (!SHAREABLE_STATUSES.has(matrix.status as string)) {
    return { error: `This matrix is "${matrix.status}" — only an approved or active matrix can be sent to a client.` };
  }

  const { data: lines } = await supabase
    .from("crew_matrix_lines")
    .select("id, line_number, job_role_id, job_roles(name), required_headcount, crew_matrix_line_documents(document_type_id, is_mandatory)")
    .eq("crew_matrix_id", input.crewMatrixId)
    .order("sort_order", { ascending: true });
  const orderedLines: LineLike[] = (lines ?? []).map((l) => {
    const role = (Array.isArray(l.job_roles) ? l.job_roles[0] : l.job_roles) as { name?: string } | null;
    return {
      id: l.id as string,
      line_number: l.line_number as number,
      job_role_id: l.job_role_id as string,
      job_role_name: role?.name ?? "—",
      required_headcount: l.required_headcount as number,
      documents: ((l.crew_matrix_line_documents ?? []) as { document_type_id: string; is_mandatory: boolean }[]).map((d) => ({
        document_type_id: d.document_type_id,
        is_mandatory: d.is_mandatory,
      })),
    };
  });
  if (orderedLines.length === 0) return { error: "This matrix has no lines to share yet." };

  const lineJobRoleIds = Array.from(new Set(orderedLines.map((l) => l.job_role_id)));
  const usedDocTypeIds = new Set<string>();
  for (const l of orderedLines) for (const d of l.documents) usedDocTypeIds.add(d.document_type_id);

  const { data: documentTypesRaw } = await supabase
    .from("document_types")
    .select("id, name, category, warning_threshold_days, tracks_number")
    .eq("org_id", access.orgId)
    .in("id", Array.from(usedDocTypeIds));
  const documentTypes: DocTypeRef[] = (documentTypesRaw ?? []) as DocTypeRef[];

  const { data: fieldDefsRaw } = await supabase
    .from("document_custom_field_definitions")
    .select("id, label, field_key, applies_to_document_type_id")
    .eq("org_id", access.orgId)
    .eq("is_active", true);
  const customFieldDefinitions: FieldDef[] = (fieldDefsRaw ?? []) as FieldDef[];

  const { data: siteAssignments } = await supabase
    .from("crew_assignments")
    .select("crew_id")
    .eq("org_id", access.orgId)
    .eq("offshore_site_id", matrix.offshore_site_id)
    .is("end_date", null);
  const assignedCrewIds = Array.from(new Set((siteAssignments ?? []).map((a) => a.crew_id as string)));

  const { data: matchedCrew } =
    assignedCrewIds.length && lineJobRoleIds.length
      ? await supabase
          .from("crew_profiles")
          .select("id, full_name, nationality, primary_job_role_id")
          .eq("org_id", access.orgId)
          .eq("employment_status", "active")
          .in("id", assignedCrewIds)
          .in("primary_job_role_id", lineJobRoleIds)
      : { data: [] };

  if (!matchedCrew || matchedCrew.length === 0) {
    return { error: "No crew are currently assigned to this matrix's ranks — nothing to send." };
  }

  const matchedCrewIds = matchedCrew.map((c) => c.id as string);
  const { data: crewDocs } =
    matchedCrewIds.length && usedDocTypeIds.size
      ? await supabase
          .from("crew_documents")
          .select("crew_id, document_type_id, document_number, issue_date, expiry_date, custom_fields, created_at")
          .eq("org_id", access.orgId)
          .in("crew_id", matchedCrewIds)
          .in("document_type_id", Array.from(usedDocTypeIds))
          .order("created_at", { ascending: false })
      : { data: [] };

  const latestDoc = new Map<string, { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }>();
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

  const staffingCrew: StaffingCrew[] = matchedCrew.map((c) => {
    const documents: StaffingCrew["documents"] = {};
    for (const docTypeId of usedDocTypeIds) {
      const entry = latestDoc.get(`${c.id}:${docTypeId}`);
      if (entry) documents[docTypeId] = entry;
    }
    return {
      crew_id: c.id as string,
      full_name: c.full_name as string,
      nationality: c.nationality as string | null,
      job_role_id: c.primary_job_role_id as string,
      documents,
    };
  });

  const project = (Array.isArray(matrix.projects) ? matrix.projects[0] : matrix.projects) as
    | { project_name?: string; contracts?: { clients?: { name?: string } | { name?: string }[] } | { clients?: { name?: string } | { name?: string }[] }[] }
    | null;
  const contract = project?.contracts ? (Array.isArray(project.contracts) ? project.contracts[0] : project.contracts) : null;
  const clientRel = contract?.clients ? (Array.isArray(contract.clients) ? contract.clients[0] : contract.clients) : null;
  const site = (Array.isArray(matrix.offshore_sites) ? matrix.offshore_sites[0] : matrix.offshore_sites) as { name?: string } | null;

  // ---- Build the same styled workbook the on-screen "Export to Excel"
  // button produces, from this freshly-fetched data.
  let excelBase64: string | null = null;
  let excelFileName: string | null = null;
  if (input.includeExcel) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = await buildStaffingPlanWorkbook(ExcelJS, orderedLines, staffingCrew, documentTypes, customFieldDefinitions);
    const buffer = await wb.xlsx.writeBuffer();
    excelBase64 = Buffer.from(buffer).toString("base64");
    const safeMatrixNumber = (matrix.matrix_number ?? matrix.id).replace(/[^a-zA-Z0-9_-]/g, "_");
    excelFileName = `Crew_Matrix_${safeMatrixNumber}_V${matrix.version_number}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  // ---- Sender identity: the logged-in staff member's name via the
  // configured Aifexis-managed address (Stage A — see lib/email.ts),
  // Reply-To set to their own verified sign-in email.
  const { data: company } = await supabase.from("companies").select("name, notify_prefix").eq("id", access.orgId).single();
  const companyDisplayName = company?.name ?? access.companyName ?? "ComplianceHub";
  const fromAddress = companyFromAddress(companyDisplayName, company?.notify_prefix ?? null);
  const fromDisplayName = access.fullName ? `${access.fullName} via ComplianceHub` : `${companyDisplayName} via ComplianceHub`;
  const fromHeader = `${fromDisplayName} <${fromAddress}>`;

  // ---- Reference number + immutable package row.
  const { data: shareReference, error: refErr } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "crew_matrix_share",
  });
  if (refErr) return { error: `Could not assign a sharing reference: ${refErr.message}` };

  const bodyTextTrimmed = input.bodyText.trim();
  const bodyHtml = renderEmailHtml({
    companyName: companyDisplayName,
    bodyText: bodyTextTrimmed,
    matrixTitle: matrix.title as string,
    matrixNumber: matrix.matrix_number as string | null,
    matrixVersion: matrix.version_number as number,
    clientName: clientRel?.name ?? null,
    projectName: project?.project_name ?? null,
    siteName: site?.name ?? null,
    shareReference: shareReference as string,
  });

  const { data: pkg, error: pkgErr } = await supabase
    .from("crew_matrix_share_packages")
    .insert({
      org_id: access.orgId,
      crew_matrix_id: input.crewMatrixId,
      share_reference: shareReference,
      matrix_title_snapshot: matrix.title,
      matrix_number_snapshot: matrix.matrix_number,
      matrix_version_snapshot: matrix.version_number,
      matrix_status_at_share: matrix.status,
      client_id: (contract as { client_id?: string } | null)?.client_id ?? null,
      client_name_snapshot: clientRel?.name ?? null,
      project_name_snapshot: project?.project_name ?? null,
      site_name_snapshot: site?.name ?? null,
      company_name_snapshot: companyDisplayName,
      status: "sent",
      from_address_snapshot: fromHeader,
      from_display_name_snapshot: fromDisplayName,
      reply_to_snapshot: userEmail,
      email_subject_snapshot: input.subject.trim(),
      email_body_html_snapshot: bodyHtml,
      email_body_text_snapshot: bodyTextTrimmed,
      excel_attached: input.includeExcel,
      staff_count: staffingCrew.length,
      document_count: 0, // updated below once the snapshot rows are written
      created_by: userId,
    })
    .select("id")
    .single();
  if (pkgErr || !pkg) return { error: pkgErr?.message ?? "Could not create the share package." };

  await logEvent(supabase, access.orgId!, pkg.id, null, "created", "success", userId);

  // ---- Staff + document snapshot rows.
  let documentCount = 0;
  let displayOrder = 0;
  for (const line of orderedLines) {
    const crewForLine = staffingCrew.filter((c) => c.job_role_id === line.job_role_id).sort((a, b) => a.full_name.localeCompare(b.full_name));
    if (crewForLine.length === 0) continue;
    const lineColumns = orderDocumentColumns(documentTypes, new Set(line.documents.map((d) => d.document_type_id)));
    const mandatoryIds = new Set(line.documents.filter((d) => d.is_mandatory).map((d) => d.document_type_id));

    for (const person of crewForLine) {
      const { data: staffRow, error: staffErr } = await supabase
        .from("crew_matrix_share_staff")
        .insert({
          org_id: access.orgId,
          share_package_id: pkg.id,
          crew_id: person.crew_id,
          job_role_name_snapshot: line.job_role_name,
          display_order: displayOrder++,
          staff_snapshot_json: { full_name: person.full_name, nationality: person.nationality, job_role_name: line.job_role_name },
        })
        .select("id")
        .single();
      if (staffErr || !staffRow) continue;

      if (lineColumns.length === 0) continue;
      const docRows = lineColumns.map((col, i) => {
        const info = cellInfo(true, col, person.documents[col.id], customFieldDefinitions.filter((f) => f.applies_to_document_type_id === col.id || f.applies_to_document_type_id === null));
        return {
          org_id: access.orgId,
          share_package_id: pkg.id,
          share_staff_id: staffRow.id,
          document_type_id: col.id,
          display_order: i,
          document_snapshot_json: {
            name: col.name,
            category: col.category,
            is_mandatory: mandatoryIds.has(col.id),
            status_text: info.text,
            status_kind: info.kind,
            status: info.status ?? null,
          },
        };
      });
      const { error: docsErr } = await supabase.from("crew_matrix_share_documents").insert(docRows);
      if (!docsErr) documentCount += docRows.length;
    }
  }

  await supabase.from("crew_matrix_share_packages").update({ document_count: documentCount }).eq("id", pkg.id);

  // ---- One recipient row (own token) + one email per recipient.
  const origin = await appOrigin();
  const results: { name: string; email: string; status: "sent" | "failed"; error?: string }[] = [];
  let anySent = false;
  let anyFailed = false;

  for (const r of recipients) {
    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: recipientRow, error: recErr } = await supabase
      .from("crew_matrix_share_recipients")
      .insert({
        org_id: access.orgId,
        share_package_id: pkg.id,
        client_contact_id: r.clientContactId ?? null,
        recipient_name: r.name.trim(),
        recipient_email: r.email.trim(),
        token,
        token_expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (recErr || !recipientRow) {
      results.push({ name: r.name, email: r.email, status: "failed", error: recErr?.message ?? "Could not create recipient link." });
      anyFailed = true;
      continue;
    }

    const shareUrl = `${origin}/crew-matrix-share/${token}`;
    const html = bodyHtml.replace("{{SECURE_LINK}}", shareUrl);
    const text = `${bodyTextTrimmed}\n\nView the secure crew matrix: ${shareUrl}\n(This link is intended only for ${r.email.trim()} and expires ${new Date(expiresAt).toDateString()}.)`;

    const sendResult = await sendEmail({
      from: fromHeader,
      to: r.email.trim(),
      subject: input.subject.trim(),
      html,
      text,
      replyTo: userEmail ?? undefined,
      attachments: excelBase64 && excelFileName ? [{ filename: excelFileName, content: excelBase64, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] : undefined,
    });

    if (sendResult.error) {
      await supabase.from("crew_matrix_share_recipients").update({ delivery_status: "failed", send_error: sendResult.error }).eq("id", recipientRow.id);
      await logEvent(supabase, access.orgId!, pkg.id, recipientRow.id, "send_failed", "failure", userId, sendResult.error);
      results.push({ name: r.name, email: r.email, status: "failed", error: sendResult.error });
      anyFailed = true;
    } else {
      await supabase.from("crew_matrix_share_recipients").update({ delivery_status: "sent", provider_message_id: sendResult.id }).eq("id", recipientRow.id);
      await logEvent(supabase, access.orgId!, pkg.id, recipientRow.id, "sent", "success", userId);
      results.push({ name: r.name, email: r.email, status: "sent" });
      anySent = true;
    }
  }

  const finalStatus = anySent && anyFailed ? "partially_sent" : anySent ? "sent" : "failed";
  await supabase.from("crew_matrix_share_packages").update({ status: finalStatus }).eq("id", pkg.id);

  revalidateMatrix(input.crewMatrixId);
  return { shareReference: shareReference as string, results };
}

function renderEmailHtml(opts: {
  companyName: string;
  bodyText: string;
  matrixTitle: string;
  matrixNumber: string | null;
  matrixVersion: number;
  clientName: string | null;
  projectName: string | null;
  siteName: string | null;
  shareReference: string;
}) {
  const escaped = opts.bodyText
    .split("\n")
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br/>");
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; line-height: 1.6;">
      <p>${escaped}</p>
      <table cellpadding="0" cellspacing="0" style="margin: 16px 0; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; background: #f8fafc;">
        <tr><td style="color:#64748b; font-size:12px; padding-bottom:4px;">Matrix reference</td><td style="padding-left:16px; font-weight:600;">${opts.matrixNumber ?? "—"} · v${opts.matrixVersion}</td></tr>
        <tr><td style="color:#64748b; font-size:12px; padding-bottom:4px;">Matrix</td><td style="padding-left:16px;">${opts.matrixTitle}</td></tr>
        ${opts.projectName ? `<tr><td style="color:#64748b; font-size:12px; padding-bottom:4px;">Project</td><td style="padding-left:16px;">${opts.projectName}</td></tr>` : ""}
        ${opts.siteName ? `<tr><td style="color:#64748b; font-size:12px; padding-bottom:4px;">Vessel / site</td><td style="padding-left:16px;">${opts.siteName}</td></tr>` : ""}
      </table>
      <p><a href="{{SECURE_LINK}}" style="display:inline-block; background:#0f2c4c; color:#fff; text-decoration:none; padding:10px 18px; border-radius:6px; font-weight:600;">View secure crew matrix</a></p>
      <p style="font-size:12px; color:#64748b;">This link is intended only for the recipient it was sent to and will expire — please do not forward it. Sharing reference ${opts.shareReference}.</p>
      <p style="font-size:12px; color:#94a3b8; margin-top:24px; border-top:1px solid #e5e7eb; padding-top:12px;">Confidential — this message and its attachments are intended solely for the named recipient and may contain personal data. ${opts.companyName}.</p>
    </div>
  `;
}

async function logEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  sharePackageId: string,
  recipientId: string | null,
  eventType: string,
  outcome: string,
  actorUserId: string | null,
  detail?: string
) {
  await supabase.from("crew_matrix_share_events").insert({
    org_id: orgId,
    share_package_id: sharePackageId,
    recipient_id: recipientId,
    event_type: eventType,
    outcome,
    actor_user_id: actorUserId,
    detail: detail ?? null,
  });
}

async function appOrigin() {
  const { headers } = await import("next/headers");
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

// ------------------------------------------------------------
// Sharing History
// ------------------------------------------------------------

export async function getSharingHistory(crewMatrixId: string) {
  const { supabase, access } = await requireShare();
  const { data: packages, error } = await supabase
    .from("crew_matrix_share_packages")
    .select(
      "id, share_reference, status, matrix_version_snapshot, excel_attached, staff_count, document_count, created_at, revoked_at, revocation_reason, crew_matrix_share_recipients(id, recipient_name, recipient_email, delivery_status, view_count, first_opened_at, last_opened_at, revoked_at, token_expires_at)"
    )
    .eq("org_id", access.orgId)
    .eq("crew_matrix_id", crewMatrixId)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return {
    packages: (packages ?? []).map((p) => ({
      id: p.id as string,
      shareReference: p.share_reference as string,
      status: p.status as string,
      matrixVersion: p.matrix_version_snapshot as number,
      excelAttached: p.excel_attached as boolean,
      staffCount: p.staff_count as number,
      documentCount: p.document_count as number,
      createdAt: p.created_at as string,
      revokedAt: p.revoked_at as string | null,
      revocationReason: p.revocation_reason as string | null,
      recipients: ((p.crew_matrix_share_recipients ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        name: r.recipient_name as string,
        email: r.recipient_email as string,
        deliveryStatus: r.delivery_status as string,
        viewCount: r.view_count as number,
        firstOpenedAt: r.first_opened_at as string | null,
        lastOpenedAt: r.last_opened_at as string | null,
        revokedAt: r.revoked_at as string | null,
        tokenExpiresAt: r.token_expires_at as string,
      })),
    })),
  };
}

export async function revokeSharePackage(packageId: string, reason?: string) {
  const { supabase, access, userId } = await requireShare();
  const { data: pkg, error: pkgErr } = await supabase.from("crew_matrix_share_packages").select("id, crew_matrix_id").eq("id", packageId).eq("org_id", access.orgId).single();
  if (pkgErr || !pkg) return { error: "Share package not found." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("crew_matrix_share_packages")
    .update({ status: "revoked", revoked_at: now, revoked_by: userId, revocation_reason: reason?.trim() || null })
    .eq("id", packageId);
  if (error) return { error: error.message };

  await supabase.from("crew_matrix_share_recipients").update({ revoked_at: now }).eq("share_package_id", packageId).is("revoked_at", null);
  await logEvent(supabase, access.orgId!, packageId, null, "revoked", "success", userId, reason);

  revalidateMatrix(pkg.crew_matrix_id as string);
  return {};
}
