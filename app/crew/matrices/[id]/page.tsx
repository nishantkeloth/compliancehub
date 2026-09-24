import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { getCurrentStage, canActOnStage } from "@/lib/workflow";
import MatrixDetail from "./matrix-detail";
import { REASON_CODES } from "./roster-change-shared";
import type { ReservationInfo } from "@/lib/staffing-plan-shared";

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
    .select(
      "*, projects(project_name, operating_region), offshore_sites(id, name, code, site_type, country, operating_region, port_or_heliport, crew_change_location, status)"
    )
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
    [
      { data: lines },
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
      { data: manningRequirements },
      { data: documentTemplates },
      { data: documentTemplateItems },
    ],
    workflowStage,
  ] = await Promise.all([
    Promise.all([
    supabase
      .from("crew_matrix_lines")
      .select("*, job_roles(name), rotation_templates(name)")
      .eq("crew_matrix_id", id)
      .order("sort_order", { ascending: true }),
    // Every version of this matrix (same matrix_number), oldest first isn't
    // needed here — kept newest-first for the Versions tab's own list — but
    // this is also now the source of the full crew_matrix_id set the Roster
    // Change History timeline needs (see allVersionsHistory below) to show
    // one continuous ledger across every version instead of resetting at
    // each new version's own "Draft created". created_at is selected for
    // that timeline's per-version "Draft created" node.
    supabase
      .from("crew_matrices")
      .select("id, version_number, status, created_at")
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
    // Site tab — this site's standing manning requirements (roles +
    // minimum headcount), the same rows the Offshore Sites page manages,
    // so they can be set/edited directly from the matrix without leaving it.
    supabase
      .from("site_manning_requirements")
      .select("id, offshore_site_id, job_role_id, minimum_headcount, preferred_document_template_id")
      .eq("org_id", access.orgId)
      .eq("offshore_site_id", matrix.offshore_site_id),
    // Named, reusable document requirement templates (distinct from the
    // silent per-role/per-client default in job_role_document_requirements)
    // — offered on the Lines tab as an "Apply template" pick, per role.
    supabase
      .from("document_requirement_templates")
      .select("id, name, job_role_id")
      .eq("org_id", access.orgId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("document_requirement_template_items")
      .select("id, template_id, document_type_id, is_mandatory, minimum_remaining_validity_days")
      .eq("org_id", access.orgId),
    ]),
    // The current stage of this matrix's in-progress approval workflow
    // (see lib/workflow.ts) — null once it's approved/rejected/cancelled,
    // or if it was submitted before this feature shipped and is still
    // sitting in the old pending_internal_approval/pending_client_approval
    // path, which doesn't use workflow_instances at all.
    getCurrentStage(supabase, "crew_matrix", id),
  ]);

  const aiVisible = aiSettings?.ai_enabled ?? true;
  const canActCurrentStage = workflowStage ? canActOnStage(workflowStage, user.id, access) : false;
  // A friendly name for a stage assigned to one specific person (rather
  // than "whoever holds this permission") — shown next to the stage
  // progress badge so it's obvious who's being waited on.
  let workflowStageApproverLabel: string | null = null;
  if (workflowStage?.approverType === "user" && workflowStage.approverUserId) {
    const { data: approverProfile } = await supabase.from("profiles").select("full_name").eq("id", workflowStage.approverUserId).maybeSingle();
    workflowStageApproverLabel = (approverProfile?.full_name as string | null) ?? null;
  }

  const lineIds = (lines ?? []).map((l) => l.id as string);
  // Staffing Plan (real crew, by rank): matched to a line by
  // primary_job_role_id. Document columns are kept to whichever document
  // types the matrix's lines actually require (fetched in stage 4, once
  // crew_matrix_line_documents below is known), not every org document
  // type, to avoid an expensive fetch of irrelevant records.
  const lineJobRoleIds = Array.from(new Set((lines ?? []).map((l) => l.job_role_id as string)));

  // Every version's id in this matrix's family (same matrix_number) — used
  // below to pull crew_matrix_status_history across the WHOLE family, not
  // just this one version's own id, so the Roster Change History timeline
  // can be one continuous ledger (see allVersionsHistory and roster-timeline.tsx).
  const versionIds = (versions ?? []).map((v) => v.id as string);

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

  const [{ data: lineSkills }, { data: lineDocuments }, { data: lineCompetencies }, { data: lineClientReqs }, { data: matchedCrew }, { data: roleMatchedCrew }, { data: allVersionsHistory }] =
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
      // Roster Change History timeline continuity (see roster-timeline.tsx
      // and versionIds above) — every status change across EVERY version of
      // this matrix, not just the one being viewed, so the timeline reads
      // as one continuous ledger: v1's own Draft -> Submitted -> Internal
      // approval -> Client approval -> Activated, then v2's on top of it,
      // and so on. crew_matrix_id is selected so each row can be labeled by
      // which version it belongs to.
      versionIds.length
        ? supabase
            .from("crew_matrix_status_history")
            .select("id, crew_matrix_id, old_status, new_status, changed_at, comment")
            .in("crew_matrix_id", versionIds)
            .order("changed_at", { ascending: false })
            .limit(100)
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

  const [{ data: crewDocs }, { data: candidateDocs }, { data: reservationRows }] = await Promise.all([
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
    // Reserve/soft-lock (see migration 0026 + staffing-actions.ts) — every
    // currently-active reservation held by anyone who's also showing up
    // as a candidate on THIS page, whichever matrix reserved them. Small
    // and cheap (at most one active row per candidate, org-wide), fetched
    // here rather than as its own query stage since it only needs
    // candidateCrewIds, same as candidateDocs above.
    candidateCrewIds.length
      ? supabase
          .from("crew_matrix_line_reservations")
          .select("id, crew_id, crew_matrix_id, crew_matrix_line_id, notes, expected_ready_date, reserved_by, crew_matrices(matrix_number, title), crew_matrix_lines(job_roles(name))")
          .eq("org_id", access.orgId)
          .in("crew_id", candidateCrewIds)
          .is("released_at", null)
      : Promise.resolve({ data: [] }),
  ]);

  // Reserved-by names — a second, small lookup (same pattern as
  // workflowStageApproverLabel above) rather than a nested profiles join,
  // since profiles isn't a declared FK target of crew_matrix_line_reservations.
  const reservedByIds = Array.from(new Set((reservationRows ?? []).map((r) => r.reserved_by as string | null).filter((v): v is string => !!v)));
  const { data: reserverProfiles } = reservedByIds.length ? await supabase.from("profiles").select("id, full_name").in("id", reservedByIds) : { data: [] };
  const reserverNameById = new Map<string, string>();
  for (const p of reserverProfiles ?? []) reserverNameById.set(p.id as string, p.full_name as string);

  const reservationByCrewId = new Map<string, ReservationInfo>();
  for (const r of reservationRows ?? []) {
    const matrixRel = (Array.isArray(r.crew_matrices) ? r.crew_matrices[0] : r.crew_matrices) as { matrix_number?: string | null; title?: string | null } | null;
    const lineRel = (Array.isArray(r.crew_matrix_lines) ? r.crew_matrix_lines[0] : r.crew_matrix_lines) as { job_roles?: unknown } | null;
    const roleRel = lineRel ? ((Array.isArray(lineRel.job_roles) ? lineRel.job_roles[0] : lineRel.job_roles) as { name?: string } | null) : null;
    const reservedById = r.reserved_by as string | null;
    reservationByCrewId.set(r.crew_id as string, {
      id: r.id as string,
      crewMatrixId: r.crew_matrix_id as string,
      crewMatrixLineId: r.crew_matrix_line_id as string,
      notes: r.notes as string | null,
      expectedReadyDate: r.expected_ready_date as string | null,
      reservedByLabel: reservedById === user.id ? "you" : reservedById ? (reserverNameById.get(reservedById) ?? "another user") : "another user",
      isThisMatrix: (r.crew_matrix_id as string) === matrix.id,
      matrixNumber: (matrixRel?.matrix_number as string | null) ?? null,
      matrixTitle: (matrixRel?.title as string | null) ?? null,
      roleName: roleRel?.name ?? null,
    });
  }

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
      reservation: reservationByCrewId.get(c.id as string) ?? null,
    };
  });

  const project = (Array.isArray(matrix.projects) ? matrix.projects[0] : matrix.projects) as { project_name?: string; operating_region?: string | null } | null;
  const site = (Array.isArray(matrix.offshore_sites) ? matrix.offshore_sites[0] : matrix.offshore_sites) as {
    id?: string;
    name?: string;
    code?: string | null;
    site_type?: string | null;
    country?: string | null;
    operating_region?: string | null;
    port_or_heliport?: string | null;
    crew_change_location?: string | null;
    status?: string | null;
  } | null;
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

  // Named document requirement templates, nested with their items so
  // LinesEditor can filter by a line's job_role_id and hand the matching
  // ones to DocumentsPanel's "Apply template" control.
  const documentTemplatesWithItems = (documentTemplates ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    job_role_id: t.job_role_id as string,
    items: (documentTemplateItems ?? [])
      .filter((i) => i.template_id === t.id)
      .map((i) => ({
        document_type_id: i.document_type_id as string,
        is_mandatory: i.is_mandatory as boolean,
        minimum_remaining_validity_days: i.minimum_remaining_validity_days as number | null,
      })),
  }));

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
      site={{
        id: site?.id ?? matrix.offshore_site_id,
        name: site?.name ?? "—",
        code: site?.code ?? null,
        site_type: site?.site_type ?? null,
        country: site?.country ?? null,
        operating_region: site?.operating_region ?? null,
        port_or_heliport: site?.port_or_heliport ?? null,
        crew_change_location: site?.crew_change_location ?? null,
        status: site?.status ?? null,
      }}
      manningRequirements={(manningRequirements ?? []).map((m) => ({
        id: m.id as string,
        offshore_site_id: m.offshore_site_id as string,
        job_role_id: m.job_role_id as string,
        minimum_headcount: m.minimum_headcount as number,
        preferred_document_template_id: m.preferred_document_template_id as string | null,
      }))}
      documentTemplates={documentTemplatesWithItems}
      lines={rows}
      history={allVersionsHistory ?? []}
      versions={(versions ?? []).map((v) => ({ id: v.id as string, version_number: v.version_number as number, status: v.status as string, created_at: v.created_at as string }))}
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
      workflowStage={
        workflowStage
          ? { name: workflowStage.name, sequence: workflowStage.sequence, totalStages: workflowStage.totalStages, approverLabel: workflowStageApproverLabel }
          : null
      }
      canActCurrentStage={canActCurrentStage}
      aiVisible={aiVisible}
    />
  );
}
