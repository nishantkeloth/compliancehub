// Shared Readiness Evaluation Engine (Phase 4).
//
// Single source of truth for "is this crew member ready for this
// mobilization position" — used by (a) the readiness-snapshot writer at
// the four workflow trigger points in app/mobilizations/actions.ts, (b)
// the /readiness compliance dashboard, and (c) listCandidates' candidate
// tiering (Phase 3's eligible/partial/ineligible logic is now derived
// from this engine's overall outcome, instead of a second parallel
// implementation).
//
// Split into two phases so callers evaluating many candidates against
// the same position (listCandidates) don't re-fetch the position's own
// requirements once per candidate:
//   1. loadPositionContext() — fetched ONCE per position: the line's
//      required skills/documents, rotation, effective onboard date.
//   2. evaluateCandidateReadiness() / evaluateCandidatesReadiness() —
//      fetch the candidate-specific data (skills held, documents held,
//      current assignment, reservation conflicts, waivers) and run the
//      15 checks against the shared context.
//
// Design decisions (also written up in claude/phase4-readiness-
// compliance.md):
//  * crew_profiles has no generic "years of experience" or "language"
//    field. MIN_EXPERIENCE is proxied via the crew's crew_skills.
//    years_experience on the position's required skills (the closest
//    thing to "experience for this role" the schema tracks).
//    NATIONALITY_LANGUAGE only evaluates nationality structurally; a
//    stated language_requirement is reported as unverifiable rather
//    than silently ignored or wrongly failed.
//  * document_types has no dedicated "medical" category (only visa /
//    travel_document / certificate / vaccination — see
//    app/crew/setup/setup-tabs.tsx's DOCUMENT_CATEGORIES). MEDICAL_
//    FITNESS is matched by document type name (case-insensitive
//    "medical") among the line's required documents; VISA_WORK_PERMIT
//    is matched structurally by category = 'visa'. A line with no
//    matching document type configured reports that check as
//    not_applicable rather than guessing.
//  * REST_PERIOD (mandatory rest period) is proxied from the crew
//    member's own default_rotation_template_id.days_off against the
//    gap since their most recently closed crew_assignments row —
//    crew_assignments doesn't record which rotation template applied
//    to a past tour, so this is an approximation and is deliberately
//    non-blocking.
//  * A compliance_waivers row is scoped to one of the 15 CHECK_CODES
//    for one position/crew — approving it clears that whole named
//    check for that position, not one specific document within it.
export type CheckResult = "pass" | "fail" | "warning" | "overridden" | "not_applicable";

export const CHECK_CODES = [
  "JOB_ROLE",
  "SECONDARY_ROLE",
  "REQUIRED_SKILLS",
  "MIN_EXPERIENCE",
  "REQUIRED_DOCUMENTS",
  "DOC_EXPIRY_VS_ROTATION",
  "MIN_DOC_VALIDITY",
  "NATIONALITY_LANGUAGE",
  "AVAILABILITY_DATE",
  "VESSEL_ASSIGNMENT",
  "RESERVATION_CONFLICT",
  "MEDICAL_FITNESS",
  "VISA_WORK_PERMIT",
  "CLIENT_APPROVAL",
  "REST_PERIOD",
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

export const CHECK_DESCRIPTIONS: Record<CheckCode, string> = {
  JOB_ROLE: "Crew member's job role matches the position's required job role (primary or secondary/backup).",
  SECONDARY_ROLE: "Whether eligibility for this position came through a secondary/backup role rather than the primary role.",
  REQUIRED_SKILLS: "Crew member holds all skills the crew matrix line requires for this position.",
  MIN_EXPERIENCE: "Crew member meets the line's minimum years-of-experience requirement.",
  REQUIRED_DOCUMENTS: "Crew member holds all documents the crew matrix line requires, valid as of the onboard date.",
  DOC_EXPIRY_VS_ROTATION: "Required documents remain valid through the end of the full planned rotation, not just at boarding.",
  MIN_DOC_VALIDITY: "Required documents meet each document's configured minimum-remaining-validity buffer at boarding.",
  NATIONALITY_LANGUAGE: "Crew member's nationality/language matches the line's stated preference.",
  AVAILABILITY_DATE: "Crew member is available on or before the required onboard date.",
  VESSEL_ASSIGNMENT: "Crew member is not currently assigned to another vessel/site.",
  RESERVATION_CONFLICT: "Crew member is not already reserved (pending) on another mobilization.",
  MEDICAL_FITNESS: "Crew member holds a valid medical fitness certificate, where the line requires one.",
  VISA_WORK_PERMIT: "Crew member holds a valid visa/work permit, where the line requires one.",
  CLIENT_APPROVAL: "Client has approved this crew member for the position, where client approval is required.",
  REST_PERIOD: "Crew member has had the mandatory rest period since their last offshore rotation.",
};

export type ReadinessCheck = {
  code: CheckCode;
  description: string;
  result: CheckResult;
  blocking: boolean;
  requiredValue: string | null;
  actualValue: string | null;
  recommendedAction: string | null;
};

export type OverallOutcome = "ready" | "ready_with_warning" | "not_ready" | "overridden";

export type ReadinessEvaluation = {
  positionId: string | null;
  crewId: string;
  checks: ReadinessCheck[];
  overallOutcome: OverallOutcome;
};

type Supa = any;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function single<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null;
  return Array.isArray(x) ? x[0] ?? null : x;
}

type LineSkillReq = { skill_id: string; skill_name: string | null };
type LineDocReq = {
  document_type_id: string;
  document_type_name: string | null;
  category: string | null;
  minimum_remaining_validity_days: number | null;
  is_mandatory: boolean;
  waiver_permitted: boolean;
};

export type PositionContext = {
  // null for an ad-hoc evaluation (e.g. a proposed reliever on a crew
  // change request that hasn't produced a mobilization position yet) —
  // the reservation-conflict and waiver lookups skip the position filter.
  positionId: string | null;
  mobilizationRequestId: string | null;
  orgId: string;
  jobRoleId: string;
  clientApprovalStatus: string;
  effectiveOnboardDate: string;
  requiredSkills: LineSkillReq[];
  requiredDocs: LineDocReq[];
  nationalityPreference: string | null;
  languageRequirement: string | null;
  minimumExperienceYears: number | null;
  lineRotationDaysOn: number | null;
  jobRoleName: string | null;
};

async function buildContext(
  supabase: Supa,
  orgId: string,
  base: { positionId: string | null; mobilizationRequestId: string | null; jobRoleId: string; clientApprovalStatus: string; effectiveOnboardDate: string; crewMatrixLineId: string | null }
): Promise<PositionContext> {
  let requiredSkills: LineSkillReq[] = [];
  let requiredDocs: LineDocReq[] = [];
  let nationalityPreference: string | null = null;
  let languageRequirement: string | null = null;
  let minimumExperienceYears: number | null = null;
  let lineRotationDaysOn: number | null = null;

  if (base.crewMatrixLineId) {
    const [lineRes, skillsRes, docsRes] = await Promise.all([
      supabase
        .from("crew_matrix_lines")
        .select("nationality_preference, language_requirement, minimum_experience_years, rotation_template_id")
        .eq("id", base.crewMatrixLineId)
        .single(),
      supabase.from("crew_matrix_line_skills").select("skill_id, skills(name)").eq("line_id", base.crewMatrixLineId),
      supabase
        .from("crew_matrix_line_documents")
        .select("document_type_id, minimum_remaining_validity_days, is_mandatory, waiver_permitted, document_types(name, category)")
        .eq("line_id", base.crewMatrixLineId),
    ]);
    const line = lineRes.data;
    if (line) {
      nationalityPreference = line.nationality_preference ?? null;
      languageRequirement = line.language_requirement ?? null;
      minimumExperienceYears = line.minimum_experience_years ?? null;
      if (line.rotation_template_id) {
        const { data: rot } = await supabase.from("rotation_templates").select("days_on").eq("id", line.rotation_template_id).single();
        lineRotationDaysOn = rot?.days_on ?? null;
      }
    }
    requiredSkills = (skillsRes.data ?? []).map((s: any) => ({ skill_id: s.skill_id, skill_name: single<{ name?: string }>(s.skills)?.name ?? null }));
    requiredDocs = (docsRes.data ?? []).map((d: any) => {
      const dt = single<{ name?: string; category?: string }>(d.document_types);
      return {
        document_type_id: d.document_type_id,
        document_type_name: dt?.name ?? null,
        category: dt?.category ?? null,
        minimum_remaining_validity_days: d.minimum_remaining_validity_days,
        is_mandatory: d.is_mandatory,
        waiver_permitted: d.waiver_permitted,
      };
    });
  }

  const { data: jobRole } = await supabase.from("job_roles").select("name").eq("id", base.jobRoleId).single();

  return {
    positionId: base.positionId,
    mobilizationRequestId: base.mobilizationRequestId,
    orgId,
    jobRoleId: base.jobRoleId,
    clientApprovalStatus: base.clientApprovalStatus,
    effectiveOnboardDate: base.effectiveOnboardDate,
    requiredSkills,
    requiredDocs,
    nationalityPreference,
    languageRequirement,
    minimumExperienceYears,
    lineRotationDaysOn,
    jobRoleName: jobRole?.name ?? null,
  };
}

export async function loadPositionContext(supabase: Supa, orgId: string, positionId: string): Promise<PositionContext | { error: string }> {
  const { data: position, error: positionError } = await supabase
    .from("mobilization_positions")
    .select("id, mobilization_request_id, job_role_id, required_onboard_date, crew_matrix_line_id, client_approval_status")
    .eq("id", positionId)
    .single();
  if (positionError || !position) return { error: "Could not find that position." };

  const { data: request, error: requestError } = await supabase
    .from("mobilization_requests")
    .select("required_onboard_date")
    .eq("id", position.mobilization_request_id)
    .single();
  if (requestError || !request) return { error: "Could not find the parent mobilization request." };

  return buildContext(supabase, orgId, {
    positionId: position.id,
    mobilizationRequestId: position.mobilization_request_id,
    jobRoleId: position.job_role_id,
    clientApprovalStatus: position.client_approval_status,
    effectiveOnboardDate: position.required_onboard_date ?? request.required_onboard_date,
    crewMatrixLineId: position.crew_matrix_line_id,
  });
}

// Ad-hoc context for evaluating someone against a role + date without a
// mobilization position — used for a proposed reliever on a crew change
// request (Phase 6). Requirements come from the crew matrix line that
// produced the assignment being relieved, when there is one.
export async function loadAdhocContext(
  supabase: Supa,
  orgId: string,
  args: { jobRoleId: string; effectiveOnboardDate: string; crewMatrixLineId: string | null }
): Promise<PositionContext> {
  return buildContext(supabase, orgId, {
    positionId: null,
    mobilizationRequestId: null,
    jobRoleId: args.jobRoleId,
    clientApprovalStatus: "not_required",
    effectiveOnboardDate: args.effectiveOnboardDate,
    crewMatrixLineId: args.crewMatrixLineId,
  });
}

type CrewData = {
  id: string;
  primary_job_role_id: string | null;
  nationality: string | null;
  availability_date: string | null;
  default_rotation_template_id: string | null;
  defaultRotationDaysOn: number | null;
  defaultRotationDaysOff: number | null;
  hasSecondaryRole: boolean;
  skillYears: Record<string, number>;
  docsByType: Record<string, { expiry_date: string | null }>;
  currentVesselName: string | null;
  lastClosedAssignmentEndDate: string | null;
  reservedElsewhereLabel: string | null;
  approvedWaiverCodes: Set<string>;
};

function computeChecks(ctx: PositionContext, crew: CrewData): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const push = (code: CheckCode, blocking: boolean, result: CheckResult, requiredValue: string | null, actualValue: string | null, recommendedAction: string | null) => {
    if (blocking && result === "fail" && crew.approvedWaiverCodes.has(code)) {
      checks.push({ code, description: CHECK_DESCRIPTIONS[code], result: "overridden", blocking, requiredValue, actualValue, recommendedAction: "Covered by an approved compliance waiver." });
      return;
    }
    checks.push({ code, description: CHECK_DESCRIPTIONS[code], result, blocking, requiredValue, actualValue, recommendedAction });
  };

  // 1. JOB_ROLE
  const primaryMatch = crew.primary_job_role_id === ctx.jobRoleId;
  const jobRolePass = primaryMatch || crew.hasSecondaryRole;
  push(
    "JOB_ROLE",
    true,
    jobRolePass ? "pass" : "fail",
    ctx.jobRoleName,
    primaryMatch ? "Matches primary role" : crew.hasSecondaryRole ? "Matches a secondary/backup role" : "No matching primary or secondary role",
    jobRolePass ? null : `Assign or select a crew member whose primary or secondary role is "${ctx.jobRoleName ?? "the required role"}".`
  );

  // 2. SECONDARY_ROLE (informational only)
  push(
    "SECONDARY_ROLE",
    false,
    !jobRolePass ? "not_applicable" : primaryMatch ? "not_applicable" : "pass",
    null,
    primaryMatch ? "Matched via primary role" : crew.hasSecondaryRole ? "Matched via secondary/backup role" : "No secondary/backup role match",
    null
  );

  // 3. REQUIRED_SKILLS
  const missingSkills = ctx.requiredSkills.filter((s) => !(s.skill_id in crew.skillYears));
  push(
    "REQUIRED_SKILLS",
    false,
    ctx.requiredSkills.length === 0 ? "not_applicable" : missingSkills.length === 0 ? "pass" : "warning",
    ctx.requiredSkills.length ? ctx.requiredSkills.map((s) => s.skill_name ?? "skill").join(", ") : null,
    ctx.requiredSkills.length ? `${ctx.requiredSkills.length - missingSkills.length}/${ctx.requiredSkills.length} held` : null,
    missingSkills.length ? `Add or verify: ${missingSkills.map((s) => s.skill_name ?? "skill").join(", ")}.` : null
  );

  // 4. MIN_EXPERIENCE — proxied via years_experience on the required skills
  if (ctx.minimumExperienceYears == null || ctx.requiredSkills.length === 0) {
    push("MIN_EXPERIENCE", false, "not_applicable", ctx.minimumExperienceYears != null ? `${ctx.minimumExperienceYears} yrs` : null, null, null);
  } else {
    const achieved = Math.max(0, ...ctx.requiredSkills.map((s) => crew.skillYears[s.skill_id] ?? 0));
    const ok = achieved >= ctx.minimumExperienceYears;
    push(
      "MIN_EXPERIENCE",
      false,
      ok ? "pass" : "warning",
      `${ctx.minimumExperienceYears} yrs`,
      `${achieved} yrs`,
      ok ? null : `Verify experience — line requires ${ctx.minimumExperienceYears} yrs, crew record shows ${achieved} yrs on the required skill(s).`
    );
  }

  // 5. REQUIRED_DOCUMENTS — presence + basic validity at onboard date
  {
    const missing = ctx.requiredDocs.filter((rd) => {
      const doc = crew.docsByType[rd.document_type_id];
      return !doc?.expiry_date || doc.expiry_date < ctx.effectiveOnboardDate;
    });
    const blockingMissing = missing.filter((rd) => rd.is_mandatory && !rd.waiver_permitted);
    const anyMandatoryMissing = missing.some((rd) => rd.is_mandatory);
    push(
      "REQUIRED_DOCUMENTS",
      blockingMissing.length > 0,
      ctx.requiredDocs.length === 0 ? "not_applicable" : missing.length === 0 ? "pass" : anyMandatoryMissing ? "fail" : "warning",
      ctx.requiredDocs.length ? ctx.requiredDocs.map((d) => d.document_type_name ?? "document").join(", ") : null,
      ctx.requiredDocs.length ? `${ctx.requiredDocs.length - missing.length}/${ctx.requiredDocs.length} held & valid` : null,
      missing.length ? `Obtain/renew: ${missing.map((d) => d.document_type_name ?? "document").join(", ")}.` : null
    );
  }

  // 6. DOC_EXPIRY_VS_ROTATION
  {
    const daysOn = ctx.lineRotationDaysOn ?? crew.defaultRotationDaysOn;
    if (daysOn == null || ctx.requiredDocs.length === 0) {
      push("DOC_EXPIRY_VS_ROTATION", false, "not_applicable", null, null, daysOn == null ? "No rotation template on the line or crew profile to compute the rotation end date." : null);
    } else {
      const rotationEndDate = addDays(ctx.effectiveOnboardDate, daysOn);
      const shortfalls = ctx.requiredDocs.filter((rd) => {
        const doc = crew.docsByType[rd.document_type_id];
        return !doc?.expiry_date || doc.expiry_date < rotationEndDate;
      });
      const blockingShortfalls = shortfalls.filter((rd) => rd.is_mandatory && !rd.waiver_permitted);
      const anyMandatory = shortfalls.some((rd) => rd.is_mandatory);
      push(
        "DOC_EXPIRY_VS_ROTATION",
        blockingShortfalls.length > 0,
        shortfalls.length === 0 ? "pass" : anyMandatory ? "fail" : "warning",
        `Valid through ${rotationEndDate}`,
        shortfalls.length ? `Expires before rotation ends: ${shortfalls.map((d) => d.document_type_name ?? "document").join(", ")}` : "All required documents outlast the rotation",
        shortfalls.length ? `Renew before boarding so validity covers the full rotation ending ${rotationEndDate}.` : null
      );
    }
  }

  // 7. MIN_DOC_VALIDITY
  {
    const withBuffer = ctx.requiredDocs.filter((rd) => rd.minimum_remaining_validity_days != null);
    if (withBuffer.length === 0) {
      push("MIN_DOC_VALIDITY", false, "not_applicable", null, null, null);
    } else {
      const shortfalls = withBuffer.filter((rd) => {
        const doc = crew.docsByType[rd.document_type_id];
        const minValidDate = addDays(ctx.effectiveOnboardDate, rd.minimum_remaining_validity_days as number);
        return !doc?.expiry_date || doc.expiry_date < minValidDate;
      });
      const blockingShortfalls = shortfalls.filter((rd) => rd.is_mandatory && !rd.waiver_permitted);
      const anyMandatory = shortfalls.some((rd) => rd.is_mandatory);
      push(
        "MIN_DOC_VALIDITY",
        blockingShortfalls.length > 0,
        shortfalls.length === 0 ? "pass" : anyMandatory ? "fail" : "warning",
        withBuffer.map((d) => `${d.document_type_name ?? "document"} (${d.minimum_remaining_validity_days}d)`).join(", "),
        shortfalls.length ? `Below buffer: ${shortfalls.map((d) => d.document_type_name ?? "document").join(", ")}` : "All buffers met",
        shortfalls.length ? "Renew the listed document(s) to meet their minimum-remaining-validity buffer." : null
      );
    }
  }

  // 8. NATIONALITY_LANGUAGE
  {
    const hasPref = !!ctx.nationalityPreference;
    const hasLang = !!ctx.languageRequirement;
    if (!hasPref && !hasLang) {
      push("NATIONALITY_LANGUAGE", false, "not_applicable", null, crew.nationality, null);
    } else {
      const nationalityOk = !hasPref || (crew.nationality ?? "").toLowerCase().includes((ctx.nationalityPreference ?? "").toLowerCase()) || (ctx.nationalityPreference ?? "").toLowerCase().includes((crew.nationality ?? "").toLowerCase());
      const langNote = hasLang ? `Language preference "${ctx.languageRequirement}" cannot be verified — crew profiles have no structured language field.` : null;
      push(
        "NATIONALITY_LANGUAGE",
        false,
        nationalityOk ? (hasLang ? "warning" : "pass") : "warning",
        [ctx.nationalityPreference, ctx.languageRequirement].filter(Boolean).join(" / ") || null,
        crew.nationality,
        [nationalityOk ? null : `Line prefers nationality "${ctx.nationalityPreference}" — crew is "${crew.nationality ?? "unset"}".`, langNote].filter(Boolean).join(" ") || null
      );
    }
  }

  // 9. AVAILABILITY_DATE
  {
    const ok = !crew.availability_date || crew.availability_date <= ctx.effectiveOnboardDate;
    push("AVAILABILITY_DATE", true, ok ? "pass" : "fail", `On or before ${ctx.effectiveOnboardDate}`, crew.availability_date, ok ? null : `Crew is not available until ${crew.availability_date}.`);
  }

  // 10. VESSEL_ASSIGNMENT
  push("VESSEL_ASSIGNMENT", false, crew.currentVesselName ? "warning" : "pass", "No current open assignment", crew.currentVesselName, crew.currentVesselName ? `Currently deployed on ${crew.currentVesselName} — confirm release/handover.` : null);

  // 11. RESERVATION_CONFLICT
  push(
    "RESERVATION_CONFLICT",
    true,
    crew.reservedElsewhereLabel ? "fail" : "pass",
    "No other pending reservation",
    crew.reservedElsewhereLabel,
    crew.reservedElsewhereLabel ? `Clear or resolve the reservation on ${crew.reservedElsewhereLabel} first.` : null
  );

  // 12. MEDICAL_FITNESS
  {
    const medicalDocs = ctx.requiredDocs.filter((d) => (d.document_type_name ?? "").toLowerCase().includes("medical"));
    if (medicalDocs.length === 0) {
      push("MEDICAL_FITNESS", false, "not_applicable", null, null, "This line has no medical-fitness document type configured.");
    } else {
      const missing = medicalDocs.filter((rd) => {
        const doc = crew.docsByType[rd.document_type_id];
        return !doc?.expiry_date || doc.expiry_date < ctx.effectiveOnboardDate;
      });
      const blockingMissing = missing.filter((rd) => rd.is_mandatory && !rd.waiver_permitted);
      push(
        "MEDICAL_FITNESS",
        blockingMissing.length > 0,
        missing.length === 0 ? "pass" : missing.some((d) => d.is_mandatory) ? "fail" : "warning",
        medicalDocs.map((d) => d.document_type_name).join(", "),
        missing.length ? "Missing/expired" : "Held & valid",
        missing.length ? "Obtain/renew the medical fitness certificate." : null
      );
    }
  }

  // 13. VISA_WORK_PERMIT
  {
    const visaDocs = ctx.requiredDocs.filter((d) => d.category === "visa");
    if (visaDocs.length === 0) {
      push("VISA_WORK_PERMIT", false, "not_applicable", null, null, "This line has no visa/work-permit document type configured.");
    } else {
      const missing = visaDocs.filter((rd) => {
        const doc = crew.docsByType[rd.document_type_id];
        return !doc?.expiry_date || doc.expiry_date < ctx.effectiveOnboardDate;
      });
      const blockingMissing = missing.filter((rd) => rd.is_mandatory && !rd.waiver_permitted);
      push(
        "VISA_WORK_PERMIT",
        blockingMissing.length > 0,
        missing.length === 0 ? "pass" : missing.some((d) => d.is_mandatory) ? "fail" : "warning",
        visaDocs.map((d) => d.document_type_name).join(", "),
        missing.length ? "Missing/expired" : "Held & valid",
        missing.length ? "Obtain/renew the visa/work permit." : null
      );
    }
  }

  // 14. CLIENT_APPROVAL — 'pending' is a stage-in-progress, not a failure;
  // only an explicit client rejection blocks.
  {
    const status = ctx.clientApprovalStatus;
    push(
      "CLIENT_APPROVAL",
      status === "rejected",
      status === "not_required" ? "not_applicable" : status === "approved" ? "pass" : status === "rejected" ? "fail" : "warning",
      status === "not_required" ? null : "Client approved",
      status,
      status === "rejected" ? "Client rejected this candidate — select a different crew member or seek re-approval." : status === "pending" ? "Awaiting client approval." : null
    );
  }

  // 15. REST_PERIOD
  {
    const daysOff = crew.defaultRotationDaysOff;
    if (!crew.lastClosedAssignmentEndDate || daysOff == null) {
      push("REST_PERIOD", false, "not_applicable", null, crew.lastClosedAssignmentEndDate, !crew.lastClosedAssignmentEndDate ? "No prior offshore assignment on file." : "No rotation template on the crew profile to determine required rest days.");
    } else {
      const lastEnd = new Date(crew.lastClosedAssignmentEndDate + "T00:00:00Z");
      const onboard = new Date(ctx.effectiveOnboardDate + "T00:00:00Z");
      const restDays = Math.round((onboard.getTime() - lastEnd.getTime()) / 86400000);
      const ok = restDays >= daysOff;
      push(
        "REST_PERIOD",
        false,
        ok ? "pass" : "warning",
        `${daysOff} days`,
        `${restDays} days`,
        ok ? null : `Only ${restDays} of ${daysOff} required rest days since the last rotation ended ${crew.lastClosedAssignmentEndDate}.`
      );
    }
  }

  return checks;
}

function overallOutcomeFor(checks: ReadinessCheck[]): OverallOutcome {
  if (checks.some((c) => c.blocking && c.result === "fail")) return "not_ready";
  if (checks.some((c) => c.blocking && c.result === "overridden")) return "overridden";
  if (checks.some((c) => c.result === "warning")) return "ready_with_warning";
  return "ready";
}

async function loadCrewData(supabase: Supa, ctx: PositionContext, crewId: string): Promise<CrewData | { error: string }> {
  const [
    crewRes,
    secondaryRes,
    skillsRes,
    docsRes,
    assignmentRes,
    lastClosedRes,
    reservationRes,
    waiversRes,
  ] = await Promise.all([
    supabase.from("crew_profiles").select("id, primary_job_role_id, nationality, availability_date, default_rotation_template_id").eq("id", crewId).single(),
    supabase.from("crew_secondary_roles").select("id").eq("crew_id", crewId).eq("job_role_id", ctx.jobRoleId),
    supabase.from("crew_skills").select("skill_id, years_experience").eq("crew_id", crewId),
    supabase.from("crew_documents").select("document_type_id, expiry_date").eq("crew_id", crewId),
    supabase.from("crew_assignments").select("offshore_sites(name)").eq("crew_id", crewId).is("end_date", null).limit(1),
    supabase.from("crew_assignments").select("end_date").eq("crew_id", crewId).not("end_date", "is", null).order("end_date", { ascending: false }).limit(1),
    (() => {
      const q = supabase.from("mobilization_positions").select("id, mobilization_requests(mobilization_number)").eq("selected_crew_id", crewId).eq("final_status", "pending");
      return ctx.positionId ? q.neq("id", ctx.positionId) : q;
    })(),
    ctx.positionId
      ? supabase.from("compliance_waivers").select("check_code, status, expires_at").eq("mobilization_position_id", ctx.positionId).eq("crew_id", crewId).eq("status", "approved")
      : Promise.resolve({ data: [] as { check_code: string; status: string; expires_at: string | null }[] }),
  ]);

  const crew = crewRes.data;
  if (!crew) return { error: "Could not find that crew member." };

  let defaultRotationDaysOn: number | null = null;
  let defaultRotationDaysOff: number | null = null;
  if (crew.default_rotation_template_id) {
    const { data: rot } = await supabase.from("rotation_templates").select("days_on, days_off").eq("id", crew.default_rotation_template_id).single();
    defaultRotationDaysOn = rot?.days_on ?? null;
    defaultRotationDaysOff = rot?.days_off ?? null;
  }

  const skillYears: Record<string, number> = {};
  for (const s of skillsRes.data ?? []) skillYears[s.skill_id] = s.years_experience ?? 0;

  const docsByType: Record<string, { expiry_date: string | null }> = {};
  for (const d of docsRes.data ?? []) docsByType[d.document_type_id] = { expiry_date: d.expiry_date };

  const currentVesselName = single<{ name?: string }>(assignmentRes.data?.[0]?.offshore_sites)?.name ?? null;

  const lastClosedAssignmentEndDate = lastClosedRes.data?.[0]?.end_date ?? null;

  const otherReservation = (reservationRes.data ?? [])[0] as any;
  const reservedElsewhereLabel = otherReservation ? single<{ mobilization_number?: string }>(otherReservation.mobilization_requests)?.mobilization_number ?? "another mobilization" : null;

  const today_ = today();
  const approvedWaiverCodes = new Set<string>((waiversRes.data ?? []).filter((w: any) => !w.expires_at || w.expires_at >= today_).map((w: any) => w.check_code));

  return {
    id: crew.id,
    primary_job_role_id: crew.primary_job_role_id,
    nationality: crew.nationality,
    availability_date: crew.availability_date,
    default_rotation_template_id: crew.default_rotation_template_id,
    defaultRotationDaysOn,
    defaultRotationDaysOff,
    hasSecondaryRole: (secondaryRes.data ?? []).length > 0,
    skillYears,
    docsByType,
    currentVesselName,
    lastClosedAssignmentEndDate,
    reservedElsewhereLabel,
    approvedWaiverCodes,
  };
}

export async function evaluateCandidateReadiness(supabase: Supa, ctx: PositionContext, crewId: string): Promise<ReadinessEvaluation | { error: string }> {
  const crew = await loadCrewData(supabase, ctx, crewId);
  if ("error" in crew) return crew;
  const checks = computeChecks(ctx, crew);
  return { positionId: ctx.positionId, crewId, checks, overallOutcome: overallOutcomeFor(checks) };
}

// Batched variant for listCandidates / the dashboard, which evaluate many
// crew members against the same position — avoids N+1 by fetching each
// candidate-specific table once with .in(crewIds) instead of once per
// candidate, then running the same pure computeChecks() per candidate.
export async function evaluateCandidatesReadiness(supabase: Supa, ctx: PositionContext, crewIds: string[]): Promise<Record<string, ReadinessEvaluation>> {
  if (crewIds.length === 0) return {};

  const [crewRes, secondaryRes, skillsRes, docsRes, assignmentsRes, closedRes, reservationsRes, waiversRes] = await Promise.all([
    supabase.from("crew_profiles").select("id, primary_job_role_id, nationality, availability_date, default_rotation_template_id").in("id", crewIds),
    supabase.from("crew_secondary_roles").select("crew_id").eq("job_role_id", ctx.jobRoleId).in("crew_id", crewIds),
    supabase.from("crew_skills").select("crew_id, skill_id, years_experience").in("crew_id", crewIds),
    supabase.from("crew_documents").select("crew_id, document_type_id, expiry_date").in("crew_id", crewIds),
    supabase.from("crew_assignments").select("crew_id, offshore_sites(name)").in("crew_id", crewIds).is("end_date", null),
    supabase.from("crew_assignments").select("crew_id, end_date").in("crew_id", crewIds).not("end_date", "is", null).order("end_date", { ascending: false }),
    (() => {
      const q = supabase.from("mobilization_positions").select("selected_crew_id, mobilization_requests(mobilization_number)").in("selected_crew_id", crewIds).eq("final_status", "pending");
      return ctx.positionId ? q.neq("id", ctx.positionId) : q;
    })(),
    ctx.positionId
      ? supabase.from("compliance_waivers").select("crew_id, check_code, expires_at").eq("mobilization_position_id", ctx.positionId).in("crew_id", crewIds).eq("status", "approved")
      : Promise.resolve({ data: [] as { crew_id: string; check_code: string; expires_at: string | null }[] }),
  ]);

  const rotationIds = Array.from(new Set((crewRes.data ?? []).map((c: any) => c.default_rotation_template_id).filter(Boolean)));
  const rotationsById: Record<string, { days_on: number | null; days_off: number | null }> = {};
  if (rotationIds.length) {
    const { data: rots } = await supabase.from("rotation_templates").select("id, days_on, days_off").in("id", rotationIds);
    for (const r of rots ?? []) rotationsById[r.id] = { days_on: r.days_on, days_off: r.days_off };
  }

  const secondarySet = new Set((secondaryRes.data ?? []).map((r: any) => r.crew_id));
  const closedByCrew: Record<string, string> = {};
  for (const a of closedRes.data ?? []) if (!closedByCrew[a.crew_id]) closedByCrew[a.crew_id] = a.end_date; // already ordered desc — first wins
  const vesselByCrew: Record<string, string | null> = {};
  for (const a of assignmentsRes.data ?? []) vesselByCrew[a.crew_id] = single<{ name?: string }>(a.offshore_sites)?.name ?? null;
  const reservationByCrew: Record<string, string> = {};
  for (const r of reservationsRes.data ?? []) {
    if (!r.selected_crew_id) continue;
    reservationByCrew[r.selected_crew_id] = single<{ mobilization_number?: string }>(r.mobilization_requests)?.mobilization_number ?? "another mobilization";
  }
  const today_ = today();
  const waiversByCrew: Record<string, Set<string>> = {};
  for (const w of waiversRes.data ?? []) {
    if (w.expires_at && w.expires_at < today_) continue;
    (waiversByCrew[w.crew_id] ??= new Set()).add(w.check_code);
  }

  const result: Record<string, ReadinessEvaluation> = {};
  for (const c of crewRes.data ?? []) {
    const rot = c.default_rotation_template_id ? rotationsById[c.default_rotation_template_id] : null;
    const crewData: CrewData = {
      id: c.id,
      primary_job_role_id: c.primary_job_role_id,
      nationality: c.nationality,
      availability_date: c.availability_date,
      default_rotation_template_id: c.default_rotation_template_id,
      defaultRotationDaysOn: rot?.days_on ?? null,
      defaultRotationDaysOff: rot?.days_off ?? null,
      hasSecondaryRole: secondarySet.has(c.id),
      skillYears: Object.fromEntries((skillsRes.data ?? []).filter((s: any) => s.crew_id === c.id).map((s: any) => [s.skill_id, s.years_experience ?? 0])),
      docsByType: Object.fromEntries((docsRes.data ?? []).filter((d: any) => d.crew_id === c.id).map((d: any) => [d.document_type_id, { expiry_date: d.expiry_date }])),
      currentVesselName: vesselByCrew[c.id] ?? null,
      lastClosedAssignmentEndDate: closedByCrew[c.id] ?? null,
      reservedElsewhereLabel: reservationByCrew[c.id] ?? null,
      approvedWaiverCodes: waiversByCrew[c.id] ?? new Set(),
    };
    const checks = computeChecks(ctx, crewData);
    result[c.id] = { positionId: ctx.positionId, crewId: c.id, checks, overallOutcome: overallOutcomeFor(checks) };
  }
  return result;
}

export type TriggerPoint = "internal_approval_sent" | "client_approval_sent" | "ready_to_mobilize" | "boarding_confirmed";

export async function writeReadinessSnapshot(supabase: Supa, ctx: PositionContext, triggerPoint: TriggerPoint, evaluation: ReadinessEvaluation, userId: string): Promise<{ error: { message: string } | null }> {
  if (!ctx.positionId || !ctx.mobilizationRequestId) return { error: { message: "Snapshots need a real mobilization position." } };
  return supabase.from("readiness_snapshots").insert({
    org_id: ctx.orgId,
    mobilization_position_id: evaluation.positionId,
    mobilization_request_id: ctx.mobilizationRequestId,
    crew_id: evaluation.crewId,
    trigger_point: triggerPoint,
    overall_outcome: evaluation.overallOutcome,
    checks: evaluation.checks,
    evaluated_by: userId,
  });
}

// Convenience: evaluate the currently-selected candidate on a position and
// persist a snapshot for it, in one call — what actions.ts's workflow
// transitions use at the four trigger points. Silently skips positions
// with no selected candidate (nothing to snapshot yet) and swallows
// individual failures so one bad position can't block a status change;
// callers can inspect the returned array for { positionId, error }.
export async function snapshotSelectedPositions(supabase: Supa, orgId: string, mobilizationRequestId: string, triggerPoint: TriggerPoint, userId: string) {
  const { data: positions } = await supabase
    .from("mobilization_positions")
    .select("id, selected_crew_id")
    .eq("mobilization_request_id", mobilizationRequestId)
    .not("selected_crew_id", "is", null);

  const outcomes: { positionId: string; error?: string }[] = [];
  for (const p of positions ?? []) {
    const ctx = await loadPositionContext(supabase, orgId, p.id);
    if ("error" in ctx) {
      outcomes.push({ positionId: p.id, error: ctx.error });
      continue;
    }
    const evaluation = await evaluateCandidateReadiness(supabase, ctx, p.selected_crew_id);
    if ("error" in evaluation) {
      outcomes.push({ positionId: p.id, error: evaluation.error });
      continue;
    }
    const { error } = await writeReadinessSnapshot(supabase, ctx, triggerPoint, evaluation, userId);
    outcomes.push({ positionId: p.id, error: error?.message });
  }
  return outcomes;
}
