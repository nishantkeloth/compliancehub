import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getEffectiveAccess, can } from "@/lib/rbac";
import CrewEditor from "./crew-editor";

const BASE_FIELDS =
  "id, org_id, crew_code, employee_code, full_name, photo_url, employment_status, nationality, date_of_birth, gender, phone, email, home_country, current_location, nearest_airport, primary_job_role_id, employment_type, joining_date, notice_period_days, availability_date, default_rotation_template_id, emergency_contact_name, emergency_contact_phone, notes, linked_profile_id, job_roles(name), rotation_templates(name)";

export default async function CrewProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.view")) redirect("/");
  const canManage = can(access, "crew.manage");
  const canViewCost = can(access, "crew.view_cost");
  const canViewSensitive = can(access, "crew.view_sensitive");
  const canViewDocuments = can(access, "crew.documents.view");
  const canManageDocuments = can(access, "crew.documents.manage");
  // Phase 4: direct vessel assignment from a crew profile is now the
  // restricted emergency path — normal assignments originate from an
  // approved mobilization's boarding confirmation instead. Requires both
  // crew.manage AND mobilization.emergency_override, plus a reason
  // (enforced in assignCrewToSite) — see claude/phase4-readiness-compliance.md.
  const canEmergencyAssign = canManage && can(access, "mobilization.emergency_override");
  // Reserve/soft-lock (migration 0026) is visible wherever the Staffing
  // Plan shows it — gated on crew.matrix.view there, so the same gate
  // applies here rather than canManage, which is stricter.
  const canViewReservations = can(access, "crew.matrix.view");

  const fields =
    BASE_FIELDS +
    (canViewCost ? ", day_rate, currency" : "") +
    (canViewSensitive ? ", dietary_medical_notes" : "");

  const { data: crew } = await supabase.from("crew_profiles").select(fields).eq("id", id).single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing loose typing on the untyped supabase select result, outside this change's scope
  if (!crew || (crew as any).org_id !== access.orgId) notFound();

  const [
    jobRolesRes,
    rotationTemplatesRes,
    skillsRes,
    crewSkillsRes,
    secondaryRolesRes,
    profilesRes,
    offshoreSitesRes,
    assignmentsRes,
    documentTypesRes,
    crewDocumentsRes,
    crewListRes,
    customFieldDefinitionsRes,
    documentVersionCountsRes,
    reservationsRes,
  ] = await Promise.all([
    supabase.from("job_roles").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase.from("rotation_templates").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase.from("skills").select("id, name").eq("org_id", access.orgId).order("name"),
    supabase.from("crew_skills").select("id, skill_id, years_experience, competency_grade, skills(name)").eq("crew_id", id),
    supabase.from("crew_secondary_roles").select("id, job_role_id, job_roles(name)").eq("crew_id", id),
    canManage
      ? supabase.from("profiles").select("id, full_name").eq("org_id", access.orgId).order("full_name")
      : Promise.resolve({ data: [] }),
    supabase.from("offshore_sites").select("id, name").eq("org_id", access.orgId).eq("status", "active").order("name"),
    supabase
      .from("crew_assignments")
      .select(
        "id, offshore_site_id, start_date, end_date, assignment_status, notes, mobilization_request_id, offshore_sites(name, code), mobilization_requests(mobilization_number)"
      )
      .eq("crew_id", id)
      .order("start_date", { ascending: false }),
    canViewDocuments
      ? supabase
          .from("document_types")
          .select("id, name, category, tracks_number, warning_threshold_days, is_active")
          .eq("org_id", access.orgId)
          .eq("is_active", true)
          .order("name")
      : Promise.resolve({ data: [] }),
    canViewDocuments
      ? supabase
          .from("crew_documents")
          .select(
            "id, document_type_id, document_number, sponsor, issue_date, expiry_date, entry_date, extension_date, dose_number, reliever_crew_id, notes, custom_fields"
          )
          .eq("crew_id", id)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    canViewDocuments
      ? supabase.from("crew_profiles").select("id, full_name").eq("org_id", access.orgId).order("full_name")
      : Promise.resolve({ data: [] }),
    canViewDocuments
      ? supabase
          .from("document_custom_field_definitions")
          .select("id, label, field_key, field_type, applies_to_document_type_id, sort_order, is_active")
          .eq("org_id", access.orgId)
          .eq("is_active", true)
          .order("sort_order")
      : Promise.resolve({ data: [] }),
    // Just enough to show a "vN" count per document on the list without
    // fetching every version's full row (that's loaded on demand when
    // someone actually opens the history panel — see getCrewDocumentVersions).
    canViewDocuments
      ? supabase.from("crew_document_versions").select("crew_document_id").eq("crew_id", id)
      : Promise.resolve({ data: [] }),
    // Reserve/soft-lock history (migration 0026) — every reservation this
    // crew member has ever held, active or released, so the profile can
    // show both "currently reserved for X" and the full trail of holds.
    canViewReservations
      ? supabase
          .from("crew_matrix_line_reservations")
          .select(
            "id, crew_matrix_id, crew_matrix_line_id, notes, expected_ready_date, reserved_by, reserved_at, released_at, released_by, crew_matrices(matrix_number, title), crew_matrix_lines(line_number, job_roles(name))"
          )
          .eq("crew_id", id)
          .order("reserved_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const documentVersionCounts: Record<string, number> = {};
  for (const row of documentVersionCountsRes.data ?? []) {
    const key = (row as { crew_document_id: string }).crew_document_id;
    documentVersionCounts[key] = (documentVersionCounts[key] ?? 0) + 1;
  }

  // Reserved/released-by names — a small separate lookup, same pattern as
  // the Staffing Plan page, since profiles isn't a declared FK target of
  // crew_matrix_line_reservations.
  const reservationRows = reservationsRes.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped supabase rows, same pattern as the rest of this file
  const reserverIds = Array.from(
    new Set(
      reservationRows.flatMap((r: any) => [r.reserved_by as string | null, r.released_by as string | null]).filter((v): v is string => !!v)
    )
  );
  const { data: reserverProfiles } = reserverIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", reserverIds)
    : { data: [] };
  const reserverNameById = new Map<string, string>();
  for (const p of reserverProfiles ?? []) reserverNameById.set((p as { id: string }).id, (p as { full_name: string }).full_name);

  const reservations = reservationRows.map((r: any) => {
    const matrixRel = (Array.isArray(r.crew_matrices) ? r.crew_matrices[0] : r.crew_matrices) as { matrix_number?: string | null; title?: string | null } | null;
    const lineRel = (Array.isArray(r.crew_matrix_lines) ? r.crew_matrix_lines[0] : r.crew_matrix_lines) as { line_number?: number | null; job_roles?: unknown } | null;
    const roleRel = lineRel ? ((Array.isArray(lineRel.job_roles) ? lineRel.job_roles[0] : lineRel.job_roles) as { name?: string } | null) : null;
    return {
      id: r.id as string,
      crewMatrixId: r.crew_matrix_id as string,
      notes: r.notes as string | null,
      expectedReadyDate: r.expected_ready_date as string | null,
      reservedAt: r.reserved_at as string,
      releasedAt: r.released_at as string | null,
      reservedByLabel: r.reserved_by ? reserverNameById.get(r.reserved_by as string) ?? "another user" : "another user",
      releasedByLabel: r.released_by ? reserverNameById.get(r.released_by as string) ?? "another user" : null,
      matrixNumber: (matrixRel?.matrix_number as string | null) ?? null,
      matrixTitle: (matrixRel?.title as string | null) ?? null,
      lineNumber: (lineRel?.line_number as number | null) ?? null,
      roleName: roleRel?.name ?? null,
    };
  });

  return (
    <>
      <Link href="/crew/profiles" className="text-sm hover:underline" style={{ color: "var(--ch-navy)" }}>
        ‹ All crew
      </Link>

      {/* The shared header above now shows the static "Crew Register"
          section title (derived from the URL), so the specific crew
          member's name is shown here instead. */}
      <h2 className="text-lg font-bold mt-2 mb-4" style={{ color: "var(--ch-ink)" }}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing loose typing, outside this change's scope */}
        {(crew as any).full_name}
      </h2>

      <CrewEditor
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing loose typing on the untyped supabase select result, outside this change's scope
        crew={crew as any}
        canManage={canManage}
        canEmergencyAssign={canEmergencyAssign}
        canViewCost={canViewCost}
        canViewSensitive={canViewSensitive}
        jobRoles={jobRolesRes.data ?? []}
        rotationTemplates={rotationTemplatesRes.data ?? []}
        skills={skillsRes.data ?? []}
        crewSkills={crewSkillsRes.data ?? []}
        secondaryRoles={secondaryRolesRes.data ?? []}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing loose typing on the untyped supabase select result, outside this change's scope
        profiles={(profilesRes.data ?? []).map((p: any) => ({ id: p.id, name: p.full_name }))}
        offshoreSites={offshoreSitesRes.data ?? []}
        assignments={assignmentsRes.data ?? []}
        canViewDocuments={canViewDocuments}
        canManageDocuments={canManageDocuments}
        documentTypes={documentTypesRes.data ?? []}
        crewDocuments={crewDocumentsRes.data ?? []}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing loose typing on the untyped supabase select result, outside this change's scope
        crewList={(crewListRes.data ?? []).map((c: any) => ({ id: c.id, name: c.full_name }))}
        customFieldDefinitions={customFieldDefinitionsRes.data ?? []}
        documentVersionCounts={documentVersionCounts}
        reservations={reservations}
      />
    </>
  );
}
