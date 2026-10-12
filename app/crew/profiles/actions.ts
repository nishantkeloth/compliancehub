"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { sha256Hex, checkDuplicateFile, checkDuplicateDocumentNumber, validateDocumentDates } from "@/lib/documents/checks";

async function requireCrewManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.manage")) {
    throw new Error("You don't have permission to manage crew profiles.");
  }
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

// Documents/certifications are gated behind their own crew.documents.manage
// permission (mirrors crew.view_cost / crew.view_sensitive) rather than the
// general crew.manage, since sponsor/document-number fields are sensitive
// enough to warrant a separate grant — matches the RLS policies on
// crew_documents, which check the same permission key.
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

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}
function optNum(formData: FormData, key: string) {
  const v = str(formData, key);
  return v ? Number(v) : null;
}

const revalidateList = () => revalidatePath("/crew/profiles");
const revalidateDetail = (id: string) => revalidatePath(`/crew/profiles/${id}`);
// The documents matrix (/crew/documents) shows the same crew_documents rows
// as the per-crew detail page, so any write from either screen needs to
// invalidate both.
const revalidateMatrix = () => revalidatePath("/crew/documents");
// Same reasoning for the vessel-first roster board (/crew/roster) — it
// reads the same crew_assignments rows as this per-crew detail page.
const revalidateRoster = () => revalidatePath("/crew/roster");

/* ---------------- Crew profile ---------------- */

export async function createCrewProfile(formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const fullName = str(formData, "fullName");
  if (!fullName) return { error: "Full name is required." };

  const { data: crewCode, error: codeError } = await supabase.rpc("next_number_range_code", {
    p_org_id: access.orgId,
    p_entity_type: "crew",
  });
  if (codeError) return { error: `Could not assign a crew code: ${codeError.message}` };

  const { data, error } = await supabase
    .from("crew_profiles")
    .insert({
      org_id: access.orgId,
      crew_code: crewCode,
      full_name: fullName,
      employee_code: optStr(formData, "employeeCode"),
      primary_job_role_id: optStr(formData, "primaryJobRoleId"),
      nationality: optStr(formData, "nationality"),
      employment_status: str(formData, "employmentStatus") || "candidate",
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateList();
  return { id: data.id };
}

export async function updateCrewProfile(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const fullName = str(formData, "fullName");
  if (!fullName) return { error: "Full name is required." };

  const { error } = await supabase
    .from("crew_profiles")
    .update({
      full_name: fullName,
      employee_code: optStr(formData, "employeeCode"),
      photo_url: optStr(formData, "photoUrl"),
      employment_status: str(formData, "employmentStatus") || "candidate",
      nationality: optStr(formData, "nationality"),
      date_of_birth: optStr(formData, "dateOfBirth"),
      gender: optStr(formData, "gender"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      home_country: optStr(formData, "homeCountry"),
      current_location: optStr(formData, "currentLocation"),
      nearest_airport: optStr(formData, "nearestAirport"),
      primary_job_role_id: optStr(formData, "primaryJobRoleId"),
      employment_type: optStr(formData, "employmentType"),
      joining_date: optStr(formData, "joiningDate"),
      notice_period_days: optNum(formData, "noticePeriodDays"),
      availability_date: optStr(formData, "availabilityDate"),
      default_rotation_template_id: optStr(formData, "defaultRotationTemplateId"),
      // emergency_contact_name / _phone are deliberately not written here:
      // they are set from the primary contact by saveEmergencyContacts.
      notes: optStr(formData, "notes"),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(id);
  revalidateList();
  return {};
}

/* ---------------- Emergency contacts / next of kin ---------------- */

export type EmergencyContactInput = {
  fullName: string;
  relationship: string;
  phone: string;
  email: string;
  address: string;
  isPrimary: boolean;
};

const MAX_EMERGENCY_CONTACTS = 3;

// Replaces the person's whole contact list with what the form holds. The
// list is tiny (max 3) and edited as one unit, so replace-all is simpler and
// safer than tracking per-row changes. The primary contact's name and phone
// are copied to crew_profiles.emergency_contact_name/phone so older screens,
// reports and imports that read those two columns stay correct.
export async function saveEmergencyContacts(crewId: string, contacts: EmergencyContactInput[]) {
  const { supabase, access, userId } = await requireCrewManage();
  if (contacts.length > MAX_EMERGENCY_CONTACTS) {
    return { error: `You can record up to ${MAX_EMERGENCY_CONTACTS} emergency contacts.` };
  }
  const cleaned = contacts.map((c) => ({
    fullName: (c.fullName ?? "").trim(),
    relationship: (c.relationship ?? "").trim(),
    phone: (c.phone ?? "").trim(),
    email: (c.email ?? "").trim(),
    address: (c.address ?? "").trim(),
    isPrimary: !!c.isPrimary,
  }));
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    const label = `Contact ${i + 1}`;
    if (!c.fullName) return { error: `${label}: enter the person's name.` };
    if (!c.relationship) return { error: `${label} (${c.fullName}): enter the relationship, for example Spouse or Father.` };
    if (!c.phone) return { error: `${label} (${c.fullName}): enter a phone number.` };
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
      return { error: `${label} (${c.fullName}): that email address does not look right.` };
    }
  }
  // Exactly one primary when there is anyone at all: keep the first one the
  // user ticked, otherwise the first contact.
  const primaryIdx = Math.max(0, cleaned.findIndex((c) => c.isPrimary));

  const { data: crew } = await supabase.from("crew_profiles").select("id, org_id").eq("id", crewId).single();
  if (!crew || (crew as { org_id: string }).org_id !== access.orgId) return { error: "Crew member not found." };

  // Keep the old rows so a failed insert can put them back rather than
  // leaving the person with no contacts at all.
  const { data: oldRows } = await supabase.from("crew_emergency_contacts").select("*").eq("crew_id", crewId);
  const { error: delErr } = await supabase.from("crew_emergency_contacts").delete().eq("crew_id", crewId);
  if (delErr) return { error: delErr.message };

  if (cleaned.length) {
    const { error: insErr } = await supabase.from("crew_emergency_contacts").insert(
      cleaned.map((c, i) => ({
        org_id: access.orgId,
        crew_id: crewId,
        full_name: c.fullName,
        relationship: c.relationship,
        phone: c.phone,
        email: c.email || null,
        address: c.address || null,
        is_primary: i === primaryIdx,
        sort_order: i,
        created_by: userId,
      }))
    );
    if (insErr) {
      if (oldRows?.length) await supabase.from("crew_emergency_contacts").insert(oldRows);
      return { error: insErr.message };
    }
  }

  const primary = cleaned.length ? cleaned[primaryIdx] : null;
  const { error: syncErr } = await supabase
    .from("crew_profiles")
    .update({
      emergency_contact_name: primary ? primary.fullName : null,
      emergency_contact_phone: primary ? primary.phone : null,
      updated_by: userId,
    })
    .eq("id", crewId);
  if (syncErr) return { error: syncErr.message };

  revalidateDetail(crewId);
  revalidateList();
  return {};
}

// Cost fields are separated into their own action so the UI can gate the
// form that calls it behind crew.view_cost, independent of the general
// crew.manage-gated edit form above.
export async function updateCrewCost(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const { error } = await supabase
    .from("crew_profiles")
    .update({
      day_rate: optNum(formData, "dayRate"),
      currency: optStr(formData, "currency") ?? "USD",
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(id);
  return {};
}

// Sensitive medical/dietary notes, same reasoning — separated so the UI can
// gate this specific form behind crew.view_sensitive.
export async function updateCrewSensitive(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const { error } = await supabase
    .from("crew_profiles")
    .update({
      dietary_medical_notes: optStr(formData, "dietaryMedicalNotes"),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(id);
  return {};
}

export async function linkCrewToUser(id: string, formData: FormData) {
  const { supabase, userId } = await requireCrewManage();
  const { error } = await supabase
    .from("crew_profiles")
    .update({ linked_profile_id: optStr(formData, "linkedProfileId"), updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(id);
  return {};
}

export async function deleteCrewProfile(id: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("crew_profiles").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateList();
  return {};
}

/* ---------------- Crew skills ---------------- */

export async function addCrewSkill(crewId: string, formData: FormData) {
  const { supabase } = await requireCrewManage();
  const skillId = str(formData, "skillId");
  if (!skillId) return { error: "Select a skill." };

  const { error } = await supabase.from("crew_skills").upsert(
    {
      crew_id: crewId,
      skill_id: skillId,
      years_experience: optNum(formData, "yearsExperience"),
      competency_grade: optStr(formData, "competencyGrade"),
    },
    { onConflict: "crew_id,skill_id" }
  );
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}

export async function removeCrewSkill(id: string, crewId: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("crew_skills").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}

/* ---------------- Crew secondary roles ---------------- */

export async function addCrewSecondaryRole(crewId: string, jobRoleId: string) {
  const { supabase } = await requireCrewManage();
  if (!jobRoleId) return { error: "Select a role." };
  const { error } = await supabase
    .from("crew_secondary_roles")
    .upsert({ crew_id: crewId, job_role_id: jobRoleId }, { onConflict: "crew_id,job_role_id" });
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}

export async function removeCrewSecondaryRole(id: string, crewId: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("crew_secondary_roles").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  return {};
}

/* ---------------- Crew vessel assignments ---------------- */

// Phase 4: normal assignments now originate from an approved
// mobilization's boarding confirmation (see confirmBoarding in
// app/mobilizations/actions.ts, the only other writer of
// crew_assignments). This function is the restricted emergency path —
// it requires mobilization.emergency_override on top of crew.manage, a
// reason, and logs every use to manual_assignment_overrides.
export async function assignCrewToSite(crewId: string, formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  if (!can(access, "mobilization.emergency_override")) {
    return { error: "Direct assignment is a restricted emergency override — you need that permission to use it. Assign crew through an approved mobilization instead." };
  }
  const offshoreSiteId = str(formData, "offshoreSiteId");
  if (!offshoreSiteId) return { error: "Select a vessel." };
  const reason = str(formData, "reason");
  if (!reason) return { error: "A reason is required for a direct (non-mobilization) assignment." };
  const startDate = str(formData, "startDate") || new Date().toISOString().slice(0, 10);

  // Phase 6 control: an active assignment ends only on sign-off — never
  // silently closed here. Only one open (end_date is null) assignment
  // per crew_id is allowed (DB index crew_assignments_one_active_idx).
  const { data: stillActive } = await supabase.from("crew_assignments").select("id, offshore_sites(name)").eq("crew_id", crewId).is("end_date", null).limit(1);
  if (stillActive && stillActive.length > 0) {
    const site = (Array.isArray(stillActive[0].offshore_sites) ? stillActive[0].offshore_sites[0] : stillActive[0].offshore_sites) as { name?: string } | null;
    return { error: `This crew member is still active on ${site?.name ?? "another vessel"} — record their sign-off under Rotations first.` };
  }

  const { data: assignment, error } = await supabase
    .from("crew_assignments")
    .insert({
      org_id: access.orgId,
      crew_id: crewId,
      offshore_site_id: offshoreSiteId,
      start_date: startDate,
      planned_start_date: startDate,
      actual_start_date: startDate,
      assignment_status: "active",
      notes: optStr(formData, "notes"),
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("crew_assignments_one_active_idx")) return { error: "This crew member already has an active vessel assignment — record their sign-off first." };
    return { error: error.message };
  }
  await supabase.from("crew_profiles").update({ deployment_status: "onboard" }).eq("id", crewId);

  await supabase.from("manual_assignment_overrides").insert({
    org_id: access.orgId,
    crew_id: crewId,
    offshore_site_id: offshoreSiteId,
    crew_assignment_id: assignment?.id,
    reason,
    created_by: userId,
  });

  revalidateDetail(crewId);
  revalidateRoster();
  return {};
}

// Phase 6: an assignment ends only on a sign-off confirmation (recorded
// under Rotations, with the demob checklist). This quick path is the
// emergency sign-off — it needs a reason and mobilization.emergency_override,
// and writes a signoff_confirmations row flagged is_emergency so it's
// audited like any other rotation exception.
export async function endCrewAssignment(id: string, crewId: string, formData: FormData) {
  const { supabase, access, userId } = await requireCrewManage();
  const reason = str(formData, "reason");
  if (!reason) return { error: "Record the sign-off under Rotations (with the demobilization checklist), or give a reason for an emergency sign-off here." };
  if (!can(access, "mobilization.emergency_override")) {
    return { error: "Emergency sign-off requires the emergency-override permission — record a normal sign-off under Rotations instead." };
  }
  const endDate = str(formData, "endDate") || new Date().toISOString().slice(0, 10);

  const { data: assignment } = await supabase.from("crew_assignments").select("id, org_id, offshore_site_id, planned_end_date, end_date").eq("id", id).single();
  if (!assignment) return { error: "Could not find that assignment." };
  if (assignment.end_date) return { error: "This assignment is already signed off." };

  const { data: signoff, error: signoffError } = await supabase
    .from("signoff_confirmations")
    .insert({
      org_id: assignment.org_id,
      crew_assignment_id: id,
      crew_id: crewId,
      offshore_site_id: assignment.offshore_site_id,
      planned_signoff_date: assignment.planned_end_date,
      actual_signoff_at: endDate + "T00:00:00Z",
      is_emergency: true,
      emergency_reason: reason,
      authorized_by: userId,
      confirmed_by: userId,
    })
    .select("id")
    .single();
  if (signoffError) return { error: signoffError.message };

  const { error } = await supabase
    .from("crew_assignments")
    .update({ end_date: endDate, actual_end_date: endDate, assignment_status: "signed_off", signoff_confirmation_id: signoff?.id, updated_by: userId })
    .eq("id", id);
  if (error) return { error: error.message };
  await supabase.from("crew_profiles").update({ deployment_status: "onshore" }).eq("id", crewId);
  await supabase.from("crew_change_requests").update({ status: "completed", updated_at: new Date().toISOString() }).eq("crew_assignment_id", id).eq("status", "approved");

  revalidateDetail(crewId);
  revalidateRoster();
  revalidatePath("/rotations");
  return {};
}

export async function deleteCrewAssignment(id: string, crewId: string) {
  const { supabase } = await requireCrewManage();
  const { error } = await supabase.from("crew_assignments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  revalidateRoster();
  return {};
}

/* ---------------- Crew Staffing Plan reservations (soft lock) ---------------- */

// A crew profile's own counterpart to unreserveCandidate in
// app/crew/matrices/[id]/staffing-actions.ts (same soft-release pattern,
// migration 0026) — lets Unreserve be clicked from the profile's
// Assignment tab, where a reservation is now also surfaced, without an
// import across route segments. Gated on crew.manage, same as that
// function, so it succeeds under RLS for the same people who could
// already reserve/unreserve from the Staffing Plan itself.
export async function releaseCrewReservation(reservationId: string, crewId: string, crewMatrixId?: string) {
  const { supabase, userId } = await requireCrewManage();
  const { error } = await supabase
    .from("crew_matrix_line_reservations")
    .update({ released_at: new Date().toISOString(), released_by: userId, updated_at: new Date().toISOString() })
    .eq("id", reservationId)
    .is("released_at", null);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  if (crewMatrixId) revalidatePath(`/crew/matrices/${crewMatrixId}`);
  return {};
}

/* ---------------- Crew documents & certifications ---------------- */

// Custom-field values are submitted as a single JSON-encoded object (the
// client only includes keys for definitions that apply to the selected
// document type), so this just needs to parse it defensively.
function parseCustomFields(formData: FormData): Record<string, unknown> {
  const raw = str(formData, "customFields");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const VISA_STATUS_VALUES = ["applied", "approved", "awaiting_entry", "entered", "cancelled"];

// The four optional visa fields on a document. Left empty for any document
// that is not a visa (the form sends them blank).
function visaFields(formData: FormData) {
  const status = str(formData, "visaStatus");
  return {
    visa_country: optStr(formData, "visaCountry"),
    visa_type_id: optStr(formData, "visaTypeId"),
    visa_application_date: optStr(formData, "visaApplicationDate"),
    visa_status: VISA_STATUS_VALUES.includes(status) ? status : null,
  };
}

/* ---------------- Visa change log (migration 0045) ---------------- */

type VisaEventInput = { type: string; summary: string; oldValue?: string | null; newValue?: string | null };

function niceDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// Best effort: the log must never make a save fail, so every error is
// swallowed. The visa itself has already been saved by the time this runs.
async function writeVisaEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: { orgId: string; crewId: string; documentId: string; userId: string },
  events: VisaEventInput[]
) {
  if (events.length === 0) return;
  try {
    await supabase.from("crew_visa_events").insert(
      events.map((e) => ({
        org_id: ctx.orgId,
        crew_id: ctx.crewId,
        crew_document_id: ctx.documentId,
        event_type: e.type,
        summary: e.summary,
        old_value: e.oldValue ?? null,
        new_value: e.newValue ?? null,
        created_by: ctx.userId,
      }))
    );
  } catch {
    /* ignore */
  }
}

async function isVisaDocumentType(supabase: Awaited<ReturnType<typeof createClient>>, documentTypeId: string): Promise<boolean> {
  try {
    const { data } = await supabase.from("document_types").select("category").eq("id", documentTypeId).maybeSingle();
    return data?.category === "visa";
  } catch {
    return false;
  }
}

async function visaTypeLabels(supabase: Awaited<ReturnType<typeof createClient>>, ids: (string | null)[]): Promise<Record<string, string>> {
  const real = ids.filter((v): v is string => !!v);
  if (real.length === 0) return {};
  try {
    const { data } = await supabase.from("visa_types").select("id, country, name").in("id", real);
    const out: Record<string, string> = {};
    for (const t of data ?? []) out[t.id as string] = `${t.country} · ${t.name}`;
    return out;
  } catch {
    return {};
  }
}

type VisaSnapshot = {
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  entry_date: string | null;
  extension_date: string | null;
  visa_country: string | null;
  visa_type_id: string | null;
  visa_application_date: string | null;
  visa_status: string | null;
};

const VISA_STATUS_TEXT: Record<string, string> = {
  applied: "Applied",
  approved: "Approved",
  awaiting_entry: "Awaiting entry",
  entered: "Entered",
  cancelled: "Cancelled",
};

function diffVisa(before: VisaSnapshot, after: VisaSnapshot, typeLabel: Record<string, string>): VisaEventInput[] {
  const out: VisaEventInput[] = [];
  const statusName = (v: string | null) => (v ? VISA_STATUS_TEXT[v] ?? v : "none");
  if ((before.visa_status ?? null) !== (after.visa_status ?? null)) {
    out.push({
      type: "status",
      summary: `Status changed from ${statusName(before.visa_status)} to ${statusName(after.visa_status)}`,
      oldValue: before.visa_status,
      newValue: after.visa_status,
    });
  }
  const bt = before.visa_type_id ? typeLabel[before.visa_type_id] ?? "unknown" : null;
  const at = after.visa_type_id ? typeLabel[after.visa_type_id] ?? "unknown" : null;
  if ((before.visa_type_id ?? null) !== (after.visa_type_id ?? null) || (before.visa_country ?? null) !== (after.visa_country ?? null)) {
    const from = bt ?? before.visa_country ?? "not set";
    const to = at ?? after.visa_country ?? "not set";
    if (from !== to) out.push({ type: "type", summary: `Visa type changed from ${from} to ${to}`, oldValue: from, newValue: to });
  }
  const dateChange = (key: keyof VisaSnapshot, label: string, type: string, recordedWord?: string) => {
    const o = before[key] ?? null;
    const n = after[key] ?? null;
    if (o === n) return;
    let summary: string;
    if (!o && n && recordedWord) summary = `${recordedWord} — ${niceDay(n)}`;
    else if (o && !n) summary = `${label} cleared (was ${niceDay(o)})`;
    else if (!o && n) summary = `${label} set to ${niceDay(n)}`;
    else summary = `${label} changed from ${niceDay(o)} to ${niceDay(n)}`;
    out.push({ type, summary, oldValue: o, newValue: n });
  };
  dateChange("visa_application_date", "Application date", "application_date");
  dateChange("issue_date", "Issue date", "issue_date");
  dateChange("expiry_date", "Expiry date", "expiry_date");
  dateChange("entry_date", "Entry date", "entry_date", "Entry date recorded");
  dateChange("extension_date", "Extension date", "extension_date");
  if ((before.document_number ?? null) !== (after.document_number ?? null)) {
    out.push({
      type: "number",
      summary: `Visa number changed from ${before.document_number ?? "—"} to ${after.document_number ?? "—"}`,
      oldValue: before.document_number,
      newValue: after.document_number,
    });
  }
  return out;
}

const VISA_SNAPSHOT_COLUMNS =
  "document_type_id, document_number, issue_date, expiry_date, entry_date, extension_date, visa_country, visa_type_id, visa_application_date, visa_status";

export async function createCrewDocument(crewId: string, formData: FormData) {
  const { supabase, access, userId } = await requireDocumentsManage();
  const documentTypeId = str(formData, "documentTypeId");
  if (!documentTypeId) return { error: "Select a document type." };

  const { data: created, error } = await supabase.from("crew_documents").insert({
    org_id: access.orgId,
    crew_id: crewId,
    document_type_id: documentTypeId,
    document_number: optStr(formData, "documentNumber"),
    sponsor: optStr(formData, "sponsor"),
    issue_date: optStr(formData, "issueDate"),
    expiry_date: optStr(formData, "expiryDate"),
    entry_date: optStr(formData, "entryDate"),
    extension_date: optStr(formData, "extensionDate"),
    dose_number: optStr(formData, "doseNumber"),
    reliever_crew_id: optStr(formData, "relieverCrewId"),
    notes: optStr(formData, "notes"),
    custom_fields: parseCustomFields(formData),
    ...visaFields(formData),
    created_by: userId,
    updated_by: userId,
  }).select("id").single();
  if (error) return { error: error.message };
  if (created?.id && (await isVisaDocumentType(supabase, documentTypeId))) {
    const vf = visaFields(formData);
    const labels = await visaTypeLabels(supabase, [vf.visa_type_id]);
    const bits = [
      vf.visa_status ? `status ${VISA_STATUS_TEXT[vf.visa_status] ?? vf.visa_status}` : null,
      vf.visa_application_date ? `application date ${niceDay(vf.visa_application_date)}` : null,
      vf.visa_type_id && labels[vf.visa_type_id] ? labels[vf.visa_type_id] : vf.visa_country,
    ].filter(Boolean);
    await writeVisaEvents(
      supabase,
      { orgId: access.orgId as string, crewId, documentId: created.id as string, userId },
      [{ type: "recorded", summary: `Visa recorded${bits.length ? " — " + bits.join(", ") : ""}`, newValue: vf.visa_status }]
    );
  }
  revalidateDetail(crewId);
  revalidateMatrix();
  return {};
}

export async function updateCrewDocument(id: string, crewId: string, formData: FormData) {
  const { supabase, access, userId } = await requireDocumentsManage();
  const documentTypeId = str(formData, "documentTypeId");
  if (!documentTypeId) return { error: "Select a document type." };

  // For the visa change log: what the row looked like before this save.
  let visaBefore: (VisaSnapshot & { document_type_id: string }) | null = null;
  try {
    const { data } = await supabase.from("crew_documents").select(VISA_SNAPSHOT_COLUMNS).eq("id", id).maybeSingle();
    visaBefore = (data as (VisaSnapshot & { document_type_id: string }) | null) ?? null;
  } catch {
    visaBefore = null;
  }

  const { error } = await supabase
    .from("crew_documents")
    .update({
      document_type_id: documentTypeId,
      document_number: optStr(formData, "documentNumber"),
      sponsor: optStr(formData, "sponsor"),
      issue_date: optStr(formData, "issueDate"),
      expiry_date: optStr(formData, "expiryDate"),
      entry_date: optStr(formData, "entryDate"),
      extension_date: optStr(formData, "extensionDate"),
      dose_number: optStr(formData, "doseNumber"),
      reliever_crew_id: optStr(formData, "relieverCrewId"),
      notes: optStr(formData, "notes"),
      custom_fields: parseCustomFields(formData),
      ...visaFields(formData),
      updated_by: userId,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  if (visaBefore && ((await isVisaDocumentType(supabase, documentTypeId)) || (await isVisaDocumentType(supabase, visaBefore.document_type_id)))) {
    const vf = visaFields(formData);
    const after: VisaSnapshot = {
      document_number: optStr(formData, "documentNumber"),
      issue_date: optStr(formData, "issueDate"),
      expiry_date: optStr(formData, "expiryDate"),
      entry_date: optStr(formData, "entryDate"),
      extension_date: optStr(formData, "extensionDate"),
      ...vf,
    };
    const labels = await visaTypeLabels(supabase, [visaBefore.visa_type_id, after.visa_type_id]);
    await writeVisaEvents(
      supabase,
      { orgId: access.orgId as string, crewId, documentId: id, userId },
      diffVisa(visaBefore, after, labels)
    );
  }
  revalidateDetail(crewId);
  revalidateMatrix();
  return {};
}

// "Remove" no longer hard-deletes once a document can carry real files and
// version history behind it (Phase 13) — a hard delete would destroy the
// audit trail (crew_document_versions rows survive via ON DELETE CASCADE,
// which is exactly what we don't want). Deactivating keeps the row and its
// full history; the documents list/readiness engine just stop counting it.
export async function deactivateCrewDocument(id: string, crewId: string) {
  const { supabase, userId } = await requireDocumentsManage();
  const { error } = await supabase.from("crew_documents").update({ is_active: false, updated_by: userId }).eq("id", id);
  if (error) return { error: error.message };
  revalidateDetail(crewId);
  revalidateMatrix();
  return {};
}

/* ---------------- Document file uploads & versions (Phase 13) ---------------- */

// This file crosses to the server as part of a Server Action's request
// body, which on Vercel is hard-capped at 4.5MB per request regardless of
// any app-level config (https://vercel.com/docs/functions/limitations#request-body-size).
// 20MB used to be allowed here on the mistaken belief that was the real
// ceiling; anything bigger reached Vercel's edge, got rejected before
// this code ever ran, and surfaced as the generic "An unexpected response
// was received from the server" message instead of this clean error (see
// app/team/bulk-intake/document-intake/document-intake-panel.tsx's
// CHUNK_MAX_BYTES comment for the full story — the same bug, found there
// first). 4MB leaves headroom for multipart overhead on top of the file.
const MAX_DOCUMENT_FILE_BYTES = 4 * 1024 * 1024;

function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-120) || "file";
}

// Every upload is a NEW version, never an overwrite — crew_document_versions
// is insert-only (see 0014_crew_document_versions.sql), so a renewed
// certificate's old file and old number/expiry stay exactly as they were on
// the day they were uploaded, for audit. The parent crew_documents row's
// document_number/issue_date/expiry_date get synced to whatever this new
// version carries, so every existing screen that reads crew_documents
// directly (readiness engine, documents matrix, the badges on this page)
// keeps working unchanged and always reflects the current version.
export async function uploadCrewDocumentVersion(documentId: string, crewId: string, formData: FormData) {
  const { supabase, access, userId } = await requireDocumentsManage();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_DOCUMENT_FILE_BYTES) {
    return { error: `File is too large (max ${Math.round(MAX_DOCUMENT_FILE_BYTES / 1024 / 1024)} MB).` };
  }

  const documentNumber = optStr(formData, "documentNumber");
  const issueDate = optStr(formData, "issueDate");
  const expiryDate = optStr(formData, "expiryDate");
  const source = optStr(formData, "source") || "manual";

  // Issue-after-expiry is a real data error — block before anything is
  // written. Everything else below (duplicate file, duplicate document
  // number elsewhere, already-expired) is a warning: the upload still
  // goes through (insert-only version history, never blocked on a
  // judgment call), it just comes back flagged for the uploader to see.
  const dateCheck = validateDocumentDates(issueDate, expiryDate);
  if (dateCheck.errors.length) return { error: dateCheck.errors.join(" ") };
  const warnings: string[] = [...dateCheck.warnings];

  const { data: docRow, error: docErr } = await supabase
    .from("crew_documents")
    .select("document_type_id")
    .eq("id", documentId)
    .single();
  if (docErr || !docRow) return { error: "Document record not found." };

  const { data: latest, error: latestErr } = await supabase
    .from("crew_document_versions")
    .select("version_number")
    .eq("crew_document_id", documentId)
    .order("version_number", { ascending: false })
    .limit(1);
  if (latestErr) return { error: latestErr.message };
  const nextVersion = (latest?.[0]?.version_number ?? 0) + 1;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = sha256Hex(bytes);

  const dupFile = await checkDuplicateFile(supabase, access.orgId!, crewId, fileHash);
  if (dupFile) {
    warnings.push(
      `This exact file was already uploaded${dupFile.documentTypeName ? ` (as ${dupFile.documentTypeName})` : ""} on ${new Date(dupFile.uploadedAt).toLocaleDateString()} — check this isn't an accidental re-upload.`
    );
  }
  if (documentNumber) {
    const dupNumber = await checkDuplicateDocumentNumber(supabase, access.orgId!, docRow.document_type_id as string, documentNumber, crewId);
    if (dupNumber) {
      warnings.push(
        `Document number "${documentNumber}" is already on file for ${dupNumber.fullName}${dupNumber.employeeCode ? ` (${dupNumber.employeeCode})` : ""} — check this isn't a data-entry mistake or the same document attached to two people.`
      );
    }
  }

  // A random token is mixed into the path (not just nextVersion) so a
  // retry after an earlier partial failure never collides with a
  // leftover object from that attempt. It used to be purely
  // version-numbered, which meant a crash after the storage write but
  // before the crew_document_versions insert below left an orphaned
  // object sitting at that exact path — invisible on this document's
  // history (nothing to show a link to), yet blocking a plain retry
  // with "The resource already exists" since nextVersion is computed
  // from the database, which still thinks that version was never
  // written. upsert: true papered over that ("Upload failed: new row
  // violates row-level security policy") because crew-documents is
  // deliberately append-only — no UPDATE policy on storage.objects —
  // and an upsert onto an existing path resolves as an update, which
  // RLS then has nothing to allow. Giving every attempt its own path
  // avoids the collision outright, so a plain insert (no upsert) is
  // always correct and the orphaned object, if any, is just dead
  // weight rather than something a retry has to overwrite.
  const filePath = `${access.orgId}/${crewId}/${documentId}/${nextVersion}_${crypto.randomUUID()}_${sanitizeFileName(file.name)}`;

  const { error: upErr } = await supabase.storage
    .from("crew-documents")
    .upload(filePath, bytes, { contentType: file.type || "application/octet-stream" });
  if (upErr) return { error: `Upload failed: ${upErr.message}` };

  const { error: versionErr } = await supabase.from("crew_document_versions").insert({
    org_id: access.orgId,
    crew_document_id: documentId,
    crew_id: crewId,
    version_number: nextVersion,
    file_path: filePath,
    file_name: file.name,
    content_type: file.type || null,
    file_size_bytes: file.size,
    file_hash: fileHash,
    document_number: documentNumber || null,
    issue_date: issueDate || null,
    expiry_date: expiryDate || null,
    source,
    uploaded_by: userId,
  });
  if (versionErr) return { error: versionErr.message };

  const syncUpdate: Record<string, unknown> = { updated_by: userId };
  if (documentNumber) syncUpdate.document_number = documentNumber;
  if (issueDate) syncUpdate.issue_date = issueDate;
  if (expiryDate) syncUpdate.expiry_date = expiryDate;
  const { error: syncErr } = await supabase.from("crew_documents").update(syncUpdate).eq("id", documentId);
  if (syncErr) return { error: syncErr.message };

  revalidateDetail(crewId);
  revalidateMatrix();
  return { versionNumber: nextVersion, warnings };
}

async function requireDocumentsView() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.documents.view") && !can(access, "crew.documents.manage")) {
    throw new Error("You don't have permission to view crew documents.");
  }
  return { supabase, access };
}

// The embedded crew_document_version_reviews comes back as an array
// (PostgREST's default shape for the reverse side of the relation) even
// though the unique index on crew_document_version_id guarantees at
// most one row — callers read reviews[0]. A self_upload version with an
// empty array is exactly "pending review": nothing is stored for that
// common case, matching the insert-only, derive-don't-store pattern
// used everywhere else in this table (see migration 0015's notes).
export async function getCrewDocumentVersions(documentId: string) {
  const { supabase } = await requireDocumentsView();
  const { data, error } = await supabase
    .from("crew_document_versions")
    .select(
      "id, version_number, file_name, file_size_bytes, document_number, issue_date, expiry_date, source, notes, uploaded_by, created_at, crew_document_version_reviews(decision, note, reviewed_by, created_at)"
    )
    .eq("crew_document_id", documentId)
    .order("version_number", { ascending: false });
  if (error) return { error: error.message };
  return { versions: data ?? [] };
}

// Files live in a private bucket, so viewing/downloading one goes through a
// short-lived signed URL generated on demand rather than a stored public
// link — these are passports and medical certificates, not profile photos.
export async function getCrewDocumentFileUrl(versionId: string) {
  const { supabase } = await requireDocumentsView();
  const { data: version, error } = await supabase
    .from("crew_document_versions")
    .select("file_path")
    .eq("id", versionId)
    .single();
  if (error || !version) return { error: "Version not found." };
  const { data: signed, error: signErr } = await supabase.storage.from("crew-documents").createSignedUrl(version.file_path, 60);
  if (signErr || !signed) return { error: signErr?.message ?? "Could not generate a link." };
  return { url: signed.signedUrl };
}
