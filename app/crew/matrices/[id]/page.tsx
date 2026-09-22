import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import MatrixDetail from "./matrix-detail";
import { REASON_CODES } from "./roster-change-shared";

export default async function CrewMatrixDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.matrix.view") || !access.orgId) redirect("/");

  const { data: matrix } = await supabase
    .from("crew_matrices")
    .select("*, projects(project_name, operating_region), offshore_sites(name, operating_region)")
    .eq("id", id)
    .eq("org_id", access.orgId)
    .single();
  if (!matrix) notFound();

  // Query plan below is deliberately staged by DEPENDENCY, not by topic, so
  // each stage runs everything it possibly can in one Promise.all instead
  // of round-tripping to Supabase one query at a time — this page used to
  // take ~7 sequential round trips (most of them not actually depending on
  // each other), which is what made every Assign/Unassign's background
  // page refresh feel slow. Down to 4 stages now:
  //   1) matrix (only thing everything else needs id/org_id/site_id from)
  //   2) everything that only needs matrix/access — lines, history,
  //      versions, job roles/skills/rotation templates/document types,
  //      AI settings, this site's assignments, org-wide active
  //      assignments, and custom field defs
  //   3) everything that only needs stage 2's results — per-line
  //      skills/documents/competencies/client requirements, and the two
  //      crew_profiles lookups (assigned-here matched crew, and the
  //      org-wide role-matched candidate pool)
  //   4) the two crew_documents lookups, which need both a crew-id list
  //      from stage 3 and the required document-type-id list from stage 3
  const [
    { data: lines },
    { data: history },
    { data: versions },
    { data: jobRoles },
    { data: skills },
    { data: rotationTemplates },
    { data: documentTypes },
    { data: aiSettings },
    { data: siteAssignments },
    { data: allActiveAssignments },
    { data: fieldDefs },
    { data: stagedChanges },
  ] = await Promise.all([
    supabase
      .from("crew_matrix_lines")
      .select("*, job_roles(name), rotation_templates(name)")
      .eq("crew_matrix_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("crew_matrix_status_history")
      .select("id, old_status, new_status, changed_at, comment")
      .eq("crew_matrix_id", id)
      .order("changed_at", { ascending: false })
      .limit(30),
    supabase
      .from("crew_matrices")
      .select("id, version_number, status")
      .eq("matrix_number", matrix.matrix_number ?? "__none__")
      .order("version_number", { ascending: false }),
    supabase.from("job_roles").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase.from("skills").select("id, name").eq("org_id", access.orgId).order("name"),
    supabase.from("rotation_templates").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase
      .from("document_types")
      .select("id, name, category, warning_threshold_days, tracks_number")
      .eq("org_id", access.orgId)
      .eq("is_active", true)
      .order("name"),
    // Phase 9: AI review is offered unless the company has switched AI off.
    supabase.from("ai_settings").select("ai_enabled").eq("org_id", access.orgId).maybeSingle(),
    // Staffing Plan "Assigned" view: who's currently assigned to THIS
    // matrix's site. start_date/planned_end_date are carried through so the
    // Assigned tab can show when each person started and, if one was
    // entered at Assign time, when they're planned to come off — end_date
    // itself is always null here by definition (that's what "assigned"
    // means), so it isn't worth selecting.
    supabase
      .from("crew_assignments")
      .select("crew_id, start_date, planned_end_date")
      .eq("org_id", access.orgId)
      .eq("offshore_site_id", matrix.offshore_site_id)
      .is("end_date", null),
    // Staffing Plan "Available candidates" view: who holds no active
    // assignment ANYWHERE in the company (org-wide, not just this site) —
    // deliberately lighter than the Phase 3/4 candidate + readiness engine
    // (no skills/experience/nationality/rest-period checks, no
    // reservation); this exists to answer "do we have enough free people
    // for this rank" while planning, before a Mobilization Request exists.
    supabase.from("crew_assignments").select("crew_id").eq("org_id", access.orgId).is("end_date", null),
    supabase.from("document_custom_field_definitions").select("id, label, field_key, applies_to_document_type_id").eq("org_id", access.orgId).eq("is_active", true),
    // Phase 17 (revised) — a new-version draft (or one already submitted
    // for its own internal/client review, but not yet Activated) can
    // carry staged roster changes recorded via requestRosterChange
    // (roster-change-actions.ts) — status "approved", not yet applied to
    // the real crew_assignments rows. Fetched unconditionally (cheap, and
    // there's nothing to fetch for a first-ever draft or an active
    // matrix); the overlay below only uses it when it's actually
    // meaningful. See "staged, not applied on request" in
    // roster-change-actions.ts for why this preview exists at all.
    supabase
      .from("roster_change_requests")
      .select("change_type, outgoing_crew_id, incoming_crew_id, effective_date, reason_code, reason_notes")
      .eq("crew_matrix_id", id)
      .eq("org_id", access.orgId)
      .eq("status", "approved")
      .is("applied_assignment_id", null),
  ]);

  const aiVisible = aiSettings?.ai_enabled ?? true;

  const lineIds = (lines ?? []).map((l) => l.id as string);
  // Staffing Plan (real crew, by rank): matched to a line by
  // primary_job_role_id. Document columns are kept to whichever document
  // types the matrix's lines actually require (fetched in stage 4, once
  // crew_matrix_line_documents below is known), not every org document
  // type, to avoid an expensive fetch of irrelevant records.
  const lineJobRoleIds = Array.from(new Set((lines ?? []).map((l) => l.job_role_id as string)));

  // Phase 17 (revised) — overlay this matrix's own staged roster changes
  // (fetched above) onto the site-wide assignment lists BEFORE anything
  // below queries crew_profiles/candidates from them, so a new-version
  // draft's Staffing Plan already shows what it would look like if
  // activated as-is: outgoing crew drop off Assigned and reappear as
  // Available (as far as this one page's preview goes — their real
  // crew_assignments row is untouched), incoming crew show as Assigned.
  // Only ever non-empty for a matrix that could actually have staged
  // requests (see the query above); an active matrix's approved requests
  // are always already applied (see applyApprovedRosterChanges), so this
  // is a no-op there in practice, same as for a matrix's first version.
  const stagedOutgoingIds = new Set<string>();
  const stagedIncoming = new Map<string, string>(); // crew_id -> effective_date
  for (const r of stagedChanges ?? []) {
    if ((r.change_type === "unassign" || r.change_type === "replace") && r.outgoing_crew_id) {
      stagedOutgoingIds.add(r.outgoing_crew_id as string);
    }
    if ((r.change_type === "assign" || r.change_type === "replace") && r.incoming_crew_id) {
      stagedIncoming.set(r.incoming_crew_id as string, r.effective_date as string);
    }
  }

  const assignedCrewIdSet = new Set((siteAssignments ?? []).map((a) => a.crew_id as string));
  const assignedAnywhereCrewIds = new Set((allActiveAssignments ?? []).map((a) => a.crew_id as string));
  for (const crewId of stagedOutgoingIds) {
    assignedCrewIdSet.delete(crewId);
    assignedAnywhereCrewIds.delete(crewId); // frees them up in this draft's Available preview too
  }
  for (const crewId of stagedIncoming.keys()) {
    assignedCrewIdSet.add(crewId);
    assignedAnywhereCrewIds.add(crewId); // don't also list them as available
  }
  const assignedCrewIds = Array.from(assignedCrewIdSet);

  // crew_id -> this site's active assignment dates, for the Assigned tab
  // (see staffingCrew below). One active assignment per crew member is
  // enforced by the DB, so a plain last-write-wins map is safe here.
  const assignmentDatesByCrewId = new Map<string, { start_date: string | null; planned_end_date: string | null }>();
  for (const a of siteAssignments ?? []) {
    assignmentDatesByCrewId.set(a.crew_id as string, {
      start_date: a.start_date as string | null,
      planned_end_date: a.planned_end_date as string | null,
    });
  }
  for (const [crewId, effectiveDate] of stagedIncoming) {
    assignmentDatesByCrewId.set(crewId, { start_date: effectiveDate, planned_end_date: null });
  }

  const [{ data: lineSkills }, { data: lineDocuments }, { data: lineCompetencies }, { data: lineClientReqs }, { data: matchedCrew }, { data: roleMatchedCrew }] =
    await Promise.all([
      lineIds.length
        ? supabase.from("crew_matrix_line_skills").select("id, line_id, skill_id, skills(name)").in("line_id", lineIds)
        : Promise.resolve({ data: [] }),
      lineIds.length
        ? supabase
            .from("crew_matrix_line_documents")
            .select("id, line_id, document_type_id, minimum_remaining_validity_days, is_mandatory, waiver_permitted, document_types(name)")
            .in("line_id", lineIds)
        : Promise.resolve({ data: [] }),
      lineIds.length
        ? supabase.from("crew_matrix_line_competencies").select("id, line_id, competency_name, minimum_grade, notes").in("line_id", lineIds)
        : Promise.resolve({ data: [] }),
      lineIds.length
        ? supabase.from("crew_matrix_line_client_requirements").select("id, line_id, requirement_text, is_mandatory").in("line_id", lineIds)
        : Promise.resolve({ data: [] }),
      assignedCrewIds.length && lineJobRoleIds.length
        ? supabase
            .from("crew_profiles")
            .select("id, full_name, nationality, primary_job_role_id")
            .eq("org_id", access.orgId)
            .eq("employment_status", "active")
            .in("id", assignedCrewIds)
            .in("primary_job_role_id", lineJobRoleIds)
        : Promise.resolve({ data: [] }),
      lineJobRoleIds.length
        ? supabase
            .from("crew_profiles")
            .select("id, full_name, nationality, primary_job_role_id, availability_date, current_location")
            .eq("org_id", access.orgId)
            .eq("employment_status", "active")
            .in("primary_job_role_id", lineJobRoleIds)
        : Promise.resolve({ data: [] }),
    ]);

  // Phase 17 (traffic light) — a short, human note per staged-incoming crew
  // member, for the amber dot's tooltip on the Assigned view. Built here
  // (rather than back where stagedIncoming/stagedOutgoingIds were computed)
  // because a "replace"'s note names the outgoing person, and their name
  // only becomes available once roleMatchedCrew comes back — it's an
  // org-wide, role-matched, unfiltered-by-assignment lookup, so it already
  // contains anyone who was staffing a matching rank before being replaced
  // out, with no extra query needed. Falls back to a generic phrase on the
  // rare case their role doesn't match any of this matrix's lines.
  const crewNameById = new Map<string, string>();
  for (const c of roleMatchedCrew ?? []) crewNameById.set(c.id as string, c.full_name as string);
  for (const c of matchedCrew ?? []) crewNameById.set(c.id as string, c.full_name as string);
  const reasonLabel = (code: string | null) => REASON_CODES.find((r) => r.value === code)?.label ?? "reason not set";
  const stagedIncomingNote = new Map<string, string>();
  for (const r of stagedChanges ?? []) {
    const incomingId = r.incoming_crew_id as string | null;
    if (!incomingId) continue;
    if (r.change_type === "assign") {
      stagedIncomingNote.set(incomingId, `New assignment — ${reasonLabel(r.reason_code as string | null)}`);
    } else if (r.change_type === "replace") {
      const outgoingName = r.outgoing_crew_id ? crewNameById.get(r.outgoing_crew_id as string) : null;
      stagedIncomingNote.set(incomingId, `Replacing ${outgoingName ?? "previous crew"} — ${reasonLabel(r.reason_code as string | null)}`);
    }
  }

  const usedDocTypeIds = Array.from(new Set((lineDocuments ?? []).map((d) => d.document_type_id as string)));
  const matchedCrewIds = (matchedCrew ?? []).map((c) => c.id as string);
  const todayStr = new Date().toISOString().slice(0, 10);
  const candidateCrewProfiles = (roleMatchedCrew ?? []).filter(
    (c) => !assignedAnywhereCrewIds.has(c.id as string) && (!c.availability_date || (c.availability_date as string) <= todayStr)
  );
  const candidateCrewIds = candidateCrewProfiles.map((c) => c.id as string);

  const [{ data: crewDocs }, { data: candidateDocs }] = await Promise.all([
    matchedCrewIds.length && usedDocTypeIds.length
      ? supabase
          .from("crew_documents")
          .select("crew_id, document_type_id, document_number, issue_date, expiry_date, custom_fields, created_at")
          .eq("org_id", access.orgId)
          .in("crew_id", matchedCrewIds)
          .in("document_type_id", usedDocTypeIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    candidateCrewIds.length && usedDocTypeIds.length
      ? supabase
          .from("crew_documents")
          .select("crew_id, document_type_id, document_number, issue_date, expiry_date, custom_fields, created_at")
          .eq("org_id", access.orgId)
          .in("crew_id", candidateCrewIds)
          .in("document_type_id", usedDocTypeIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  // Keep only the most recent crew_documents row per (crew_id, document_type_id).
  const latestDocByCrewAndType = new Map<
    string,
    { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }
  >();
  for (const d of crewDocs ?? []) {
    const key = `${d.crew_id}:${d.document_type_id}`;
    if (!latestDocByCrewAndType.has(key)) {
      latestDocByCrewAndType.set(key, {
        document_number: d.document_number as string | null,
        issue_date: d.issue_date as string | null,
        expiry_date: d.expiry_date as string | null,
        custom_fields: (d.custom_fields as Record<string, unknown> | null) ?? null,
      });
    }
  }

  const staffingCrew = (matchedCrew ?? []).map((c) => {
    const documents: Record<
      string,
      { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }
    > = {};
    for (const docTypeId of usedDocTypeIds) {
      const entry = latestDocByCrewAndType.get(`${c.id}:${docTypeId}`);
      if (entry) documents[docTypeId] = entry;
    }
    const assignmentDates = assignmentDatesByCrewId.get(c.id as string);
    return {
      crew_id: c.id as string,
      full_name: c.full_name as string,
      nationality: c.nationality as string | null,
      job_role_id: c.primary_job_role_id as string,
      assignment_start_date: assignmentDates?.start_date ?? null,
      assignment_planned_end_date: assignmentDates?.planned_end_date ?? null,
      documents,
      rosterChangeNote: stagedIncomingNote.get(c.id as string) ?? null,
    };
  });

  const latestCandidateDocByCrewAndType = new Map<
    string,
    { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }
  >();
  for (const d of candidateDocs ?? []) {
    const key = `${d.crew_id}:${d.document_type_id}`;
    if (!latestCandidateDocByCrewAndType.has(key)) {
      latestCandidateDocByCrewAndType.set(key, {
        document_number: d.document_number as string | null,
        issue_date: d.issue_date as string | null,
        expiry_date: d.expiry_date as string | null,
        custom_fields: (d.custom_fields as Record<string, unknown> | null) ?? null,
      });
    }
  }

  const candidateStaffingCrew = candidateCrewProfiles.map((c) => {
    const documents: Record<
      string,
      { document_number: string | null; issue_date: string | null; expiry_date: string | null; custom_fields: Record<string, unknown> | null }
    > = {};
    for (const docTypeId of usedDocTypeIds) {
      const entry = latestCandidateDocByCrewAndType.get(`${c.id}:${docTypeId}`);
      if (entry) documents[docTypeId] = entry;
    }
    return {
      crew_id: c.id as string,
      full_name: c.full_name as string,
      nationality: c.nationality as string | null,
      job_role_id: c.primary_job_role_id as string,
      availability_date: c.availability_date as string | null,
      current_location: c.current_location as string | null,
      documents,
    };
  });

  const project = (Array.isArray(matrix.projects) ? matrix.projects[0] : matrix.projects) as { project_name?: string; operating_region?: string | null } | null;
  const site = (Array.isArray(matrix.offshore_sites) ? matrix.offshore_sites[0] : matrix.offshore_sites) as { name?: string; operating_region?: string | null } | null;
  // Phase 16 — the matrix's own region, for splitting Available Candidates
  // into region-matched vs other-region groups. Site's region wins when
  // set (a matrix is normally tied to one physical site); falls back to
  // the project's region when the site doesn't have one. Both fields stay
  // free text on offshore_sites/projects (unlike crew_profiles.current_location,
  // which Phase 16 constrained to lib/regions.ts's fixed list) — matching
  // only works when an admin has typed the same string here as a crew
  // member's Current location dropdown value (e.g. "Qatar", "Abu Dhabi").
  const matrixRegion = (site?.operating_region || project?.operating_region || null) as string | null;

  const rows = (lines ?? []).map((l) => {
    const role = (Array.isArray(l.job_roles) ? l.job_roles[0] : l.job_roles) as { name?: string } | null;
    const rotation = (Array.isArray(l.rotation_templates) ? l.rotation_templates[0] : l.rotation_templates) as { name?: string } | null;
    return {
      id: l.id as string,
      line_number: l.line_number as number,
      job_role_id: l.job_role_id as string,
      job_role_name: role?.name ?? "—",
      required_headcount: l.required_headcount as number,
      day_shift_quantity: l.day_shift_quantity as number | null,
      night_shift_quantity: l.night_shift_quantity as number | null,
      other_shift_quantity: l.other_shift_quantity as number | null,
      rotation_template_id: l.rotation_template_id as string | null,
      rotation_template_name: rotation?.name ?? null,
      employment_type_preference: l.employment_type_preference as string | null,
      nationality_preference: l.nationality_preference as string | null,
      language_requirement: l.language_requirement as string | null,
      minimum_experience_years: l.minimum_experience_years as number | null,
      mobilization_lead_days: l.mobilization_lead_days as number | null,
      client_approval_required: l.client_approval_required as boolean,
      remarks: l.remarks as string | null,
      sort_order: l.sort_order as number,
      skills: (lineSkills ?? [])
        .filter((s) => s.line_id === l.id)
        .map((s) => {
          const skillRel = (Array.isArray(s.skills) ? s.skills[0] : s.skills) as { name?: string } | null;
          return { id: s.id as string, skill_id: s.skill_id as string, name: skillRel?.name ?? "—" };
        }),
      documents: (lineDocuments ?? [])
        .filter((d) => d.line_id === l.id)
        .map((d) => {
          const docTypeRel = (Array.isArray(d.document_types) ? d.document_types[0] : d.document_types) as { name?: string } | null;
          return {
            id: d.id as string,
            document_type_id: d.document_type_id as string,
            name: docTypeRel?.name ?? "—",
            minimum_remaining_validity_days: d.minimum_remaining_validity_days as number | null,
            is_mandatory: d.is_mandatory as boolean,
            waiver_permitted: d.waiver_permitted as boolean,
          };
        }),
      competencies: (lineCompetencies ?? [])
        .filter((c) => c.line_id === l.id)
        .map((c) => ({ id: c.id as string, competency_name: c.competency_name as string, minimum_grade: c.minimum_grade as string | null, notes: c.notes as string | null })),
      clientRequirements: (lineClientReqs ?? [])
        .filter((r) => r.line_id === l.id)
        .map((r) => ({ id: r.id as string, requirement_text: r.requirement_text as string, is_mandatory: r.is_mandatory as boolean })),
    };
  });

  return (
    <MatrixDetail
      matrix={{
        id: matrix.id,
        matrix_number: matrix.matrix_number,
        version_number: matrix.version_number,
        title: matrix.title,
        status: matrix.status,
        project_id: matrix.project_id,
        offshore_site_id: matrix.offshore_site_id,
        project_name: project?.project_name ?? "—",
        site_name: site?.name ?? "—",
        effective_from: matrix.effective_from,
        effective_to: matrix.effective_to,
        expected_pob: matrix.expected_pob,
        notes: matrix.notes,
        client_approval_reference: matrix.client_approval_reference,
        rejection_reason: matrix.rejection_reason,
        approved_at: matrix.approved_at,
        created_at: matrix.created_at,
      }}
      lines={rows}
      history={history ?? []}
      versions={(versions ?? []).map((v) => ({ id: v.id as string, version_number: v.version_number as number, status: v.status as string }))}
      jobRoles={jobRoles ?? []}
      skills={skills ?? []}
      rotationTemplates={rotationTemplates ?? []}
      documentTypes={documentTypes ?? []}
      staffingCrew={staffingCrew}
      candidateStaffingCrew={candidateStaffingCrew}
      matrixRegion={matrixRegion}
      customFieldDefinitions={(fieldDefs ?? []).map((f) => ({
        id: f.id as string,
        label: f.label as string,
        field_key: f.field_key as string,
        applies_to_document_type_id: f.applies_to_document_type_id as string | null,
      }))}
      canManage={can(access, "crew.matrix.manage")}
      canAssignCrew={can(access, "crew.manage")}
      canShareMatrix={can(access, "crew.matrix.share")}
      canSubmit={can(access, "crew.matrix.submit")}
      canApproveInternal={can(access, "crew.matrix.approve_internal")}
      canApproveClient={can(access, "crew.matrix.approve_client")}
      aiVisible={aiVisible}
    />
  );
}
