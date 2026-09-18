"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { sendEmail, companyFromAddress } from "@/lib/email";

// Phase 13 follow-up — self-upload link for crew members who don't have
// a ComplianceHub account. Same random-token pattern already used for
// team invites (app/team/actions.ts's randomToken(), app/accept-invite/
// [token]) and the same "preview via a SECURITY DEFINER RPC the anon
// role can call" shape (get_document_upload_link_preview, migration
// 0015) as get_invite_preview. Where this differs from an invite: the
// actual write is a file upload, which an RPC can't do cleanly, and we
// deliberately do NOT open storage.objects to anon writes (that would
// have no per-token check of its own — anyone could write anywhere).
// So submitSelfUploadDocument below re-validates the token itself and
// then uses the service-role client to do the write, the same way
// team/actions.ts's admin.auth.admin.createUser() already bypasses
// normal auth for a privileged, pre-validated action.

const MAX_DOCUMENT_FILE_BYTES = 20 * 1024 * 1024; // matches the cap in actions.ts's uploadCrewDocumentVersion
const DEFAULT_LINK_DAYS = 7;

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-120) || "file";
}

async function requireDocumentsManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.documents.manage")) {
    throw new Error("You don't have permission to manage crew documents.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

const revalidateDetail = (crewId: string) => revalidatePath(`/crew/profiles/${crewId}`);
const revalidateMatrix = () => revalidatePath("/crew/documents");

async function appOrigin() {
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

/* ================= Staff side: create / list / revoke links ================= */

export async function createDocumentUploadLink(
  crewId: string,
  documentTypeIds: string[],
  opts?: { expiresInDays?: number; sendEmailToCrew?: boolean }
) {
  const { supabase, access, userId } = await requireDocumentsManage();
  if (documentTypeIds.length === 0) return { error: "Pick at least one document type to request." };

  const { data: crew, error: crewErr } = await supabase
    .from("crew_profiles")
    .select("id, full_name, email")
    .eq("id", crewId)
    .single();
  if (crewErr || !crew) return { error: "Crew member not found." };

  // Confirm every requested type actually belongs to this org — never
  // trust client-submitted ids without checking, same as the role-id
  // check in team/actions.ts's inviteTeamMember.
  const { data: types, error: typesErr } = await supabase
    .from("document_types")
    .select("id")
    .eq("org_id", access.orgId)
    .in("id", documentTypeIds);
  if (typesErr) return { error: typesErr.message };
  const validIds = new Set((types ?? []).map((t) => t.id));
  const chosenIds = documentTypeIds.filter((id) => validIds.has(id));
  if (chosenIds.length === 0) return { error: "Choose valid document types." };

  const days = opts?.expiresInDays && opts.expiresInDays > 0 ? opts.expiresInDays : DEFAULT_LINK_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const token = randomToken();

  const { data: link, error: linkErr } = await supabase
    .from("crew_document_upload_links")
    .insert({ org_id: access.orgId, crew_id: crewId, token, created_by: userId, expires_at: expiresAt })
    .select("id")
    .single();
  if (linkErr || !link) return { error: linkErr?.message ?? "Could not create the link." };

  const { error: itemsErr } = await supabase
    .from("crew_document_upload_link_items")
    .insert(chosenIds.map((document_type_id) => ({ link_id: link.id, document_type_id })));
  if (itemsErr) return { error: itemsErr.message };

  const origin = await appOrigin();
  const url = `${origin}/upload-documents/${token}`;

  let emailSent = false;
  let emailError: string | null = null;
  if (opts?.sendEmailToCrew) {
    if (!crew.email) {
      emailError = "This crew member has no email address on file — share the link with them directly instead.";
    } else {
      const { data: company } = await supabase.from("companies").select("name, notify_prefix").eq("id", access.orgId).single();
      const from = companyFromAddress(company?.name ?? "ComplianceHub", company?.notify_prefix ?? null);
      const { error: sendErr } = await sendEmail({
        from,
        to: crew.email,
        subject: `Document upload request — ${company?.name ?? "ComplianceHub"}`,
        html: `
          <p>Hi ${crew.full_name ?? "there"},</p>
          <p>Please use the link below to upload the requested document(s). No account or password is needed.</p>
          <p><a href="${url}">${url}</a></p>
          <p>This link expires on ${new Date(expiresAt).toDateString()}.</p>
        `,
      });
      if (sendErr) emailError = sendErr;
      else emailSent = true;
    }
  }

  revalidateDetail(crewId);
  return { url, token, expiresAt, emailSent, emailError };
}

export async function listDocumentUploadLinks(crewId: string) {
  const { supabase } = await requireDocumentsManage();
  const { data, error } = await supabase
    .from("crew_document_upload_links")
    .select("id, expires_at, revoked_at, created_at, crew_document_upload_link_items(document_type_id, document_types(name))")
    .eq("crew_id", crewId)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return { links: data ?? [] };
}

export async function revokeDocumentUploadLink(linkId: string, crewId: string) {
  const { supabase } = await requireDocumentsManage();
  const { error } = await supabase
    .from("crew_document_upload_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}

/* ================= Staff side: review a self-uploaded version ================= */

// Approving syncs the parent crew_documents row from this version, the
// same sync uploadCrewDocumentVersion already does for staff/AI uploads
// — a self upload just goes through this extra gate first instead of
// syncing immediately. Rejecting records the decision and touches
// nothing else; the version itself is never deleted (it's evidence of
// what was submitted, wrong or not). crew_document_version_reviews has
// a unique index on crew_document_version_id, so a second review
// attempt on the same version fails here with a clear message rather
// than silently overwriting the first decision.
export async function reviewCrewDocumentVersion(
  versionId: string,
  crewId: string,
  decision: "approved" | "rejected",
  note?: string
) {
  const { supabase, access, userId } = await requireDocumentsManage();

  const { data: version, error: versionErr } = await supabase
    .from("crew_document_versions")
    .select("id, crew_document_id, document_number, issue_date, expiry_date")
    .eq("id", versionId)
    .single();
  if (versionErr || !version) return { error: "Version not found." };

  const { error: reviewErr } = await supabase.from("crew_document_version_reviews").insert({
    org_id: access.orgId,
    crew_document_version_id: versionId,
    decision,
    note: note?.trim() || null,
    reviewed_by: userId,
  });
  if (reviewErr) {
    return {
      error: reviewErr.code === "23505" ? "This version has already been reviewed." : reviewErr.message,
    };
  }

  if (decision === "approved") {
    const syncUpdate: Record<string, unknown> = { updated_by: userId };
    if (version.document_number) syncUpdate.document_number = version.document_number;
    if (version.issue_date) syncUpdate.issue_date = version.issue_date;
    if (version.expiry_date) syncUpdate.expiry_date = version.expiry_date;
    const { error: syncErr } = await supabase.from("crew_documents").update(syncUpdate).eq("id", version.crew_document_id);
    if (syncErr) return { error: syncErr.message };
  }

  revalidateDetail(crewId);
  revalidateMatrix();
  return {};
}

/* ================= Crew side: the public, unauthenticated upload ================= */

// No auth.uid() here at all — the token itself IS the authorization,
// re-checked from scratch server-side (never trust the org_id/crew_id a
// client could otherwise supply) before touching the service-role
// client. Runs entirely through admin (service role): RLS never even
// enters into it for this one path, by design — see the file header.
export async function submitSelfUploadDocument(token: string, documentTypeId: string, formData: FormData) {
  const admin = createAdminClient();

  const { data: link, error: linkErr } = await admin
    .from("crew_document_upload_links")
    .select("id, org_id, crew_id, expires_at, revoked_at")
    .eq("token", token)
    .single();
  if (linkErr || !link) return { error: "This upload link is not valid." };
  if (link.revoked_at || new Date(link.expires_at) < new Date()) {
    return { error: "This upload link has expired or been revoked. Ask your company for a new one." };
  }

  const { data: item, error: itemErr } = await admin
    .from("crew_document_upload_link_items")
    .select("document_type_id")
    .eq("link_id", link.id)
    .eq("document_type_id", documentTypeId)
    .maybeSingle();
  if (itemErr || !item) return { error: "That document type wasn't requested on this link." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_DOCUMENT_FILE_BYTES) {
    return { error: `File is too large (max ${Math.round(MAX_DOCUMENT_FILE_BYTES / 1024 / 1024)} MB).` };
  }

  // The crew member may be providing this document type for the first
  // time — find their crew_documents row for it, or create an empty one
  // (number/dates null) so the version has somewhere to attach, exactly
  // like a staff member choosing "+ Add document" would.
  let documentId: string;
  const { data: existingDoc } = await admin
    .from("crew_documents")
    .select("id")
    .eq("crew_id", link.crew_id)
    .eq("document_type_id", documentTypeId)
    .maybeSingle();
  if (existingDoc) {
    documentId = existingDoc.id;
  } else {
    const { data: createdDoc, error: createErr } = await admin
      .from("crew_documents")
      .insert({ org_id: link.org_id, crew_id: link.crew_id, document_type_id: documentTypeId })
      .select("id")
      .single();
    if (createErr || !createdDoc) return { error: createErr?.message ?? "Could not prepare this document record." };
    documentId = createdDoc.id;
  }

  const { data: latest } = await admin
    .from("crew_document_versions")
    .select("version_number")
    .eq("crew_document_id", documentId)
    .order("version_number", { ascending: false })
    .limit(1);
  const nextVersion = (latest?.[0]?.version_number ?? 0) + 1;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filePath = `${link.org_id}/${link.crew_id}/${documentId}/${nextVersion}_${sanitizeFileName(file.name)}`;

  const { error: upErr } = await admin.storage
    .from("crew-documents")
    .upload(filePath, bytes, { contentType: file.type || "application/octet-stream" });
  if (upErr) return { error: `Upload failed: ${upErr.message}` };

  const documentNumber = (formData.get("documentNumber") as string | null)?.trim() || null;
  const issueDate = (formData.get("issueDate") as string | null)?.trim() || null;
  const expiryDate = (formData.get("expiryDate") as string | null)?.trim() || null;

  const { error: versionErr } = await admin.from("crew_document_versions").insert({
    org_id: link.org_id,
    crew_document_id: documentId,
    crew_id: link.crew_id,
    version_number: nextVersion,
    file_path: filePath,
    file_name: file.name,
    content_type: file.type || null,
    file_size_bytes: file.size,
    document_number: documentNumber,
    issue_date: issueDate,
    expiry_date: expiryDate,
    source: "self_upload",
    upload_link_id: link.id,
  });
  if (versionErr) return { error: versionErr.message };

  return {};
}
