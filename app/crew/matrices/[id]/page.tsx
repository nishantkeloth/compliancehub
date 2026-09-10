import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import MatrixDetail from "./matrix-detail";

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
    .select("*, projects(project_name), offshore_sites(name)")
    .eq("id", id)
    .eq("org_id", access.orgId)
    .single();
  if (!matrix) notFound();

  const [{ data: lines }, { data: history }, { data: versions }, { data: jobRoles }, { data: skills }, { data: rotationTemplates }, { data: documentTypes }] =
    await Promise.all([
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
      supabase.from("document_types").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    ]);

  const lineIds = (lines ?? []).map((l) => l.id as string);
  const [{ data: lineSkills }, { data: lineDocuments }, { data: lineCompetencies }, { data: lineClientReqs }] = await Promise.all([
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
  ]);

  const project = (Array.isArray(matrix.projects) ? matrix.projects[0] : matrix.projects) as { project_name?: string } | null;
  const site = (Array.isArray(matrix.offshore_sites) ? matrix.offshore_sites[0] : matrix.offshore_sites) as { name?: string } | null;

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
      }}
      lines={rows}
      history={history ?? []}
      versions={(versions ?? []).map((v) => ({ id: v.id as string, version_number: v.version_number as number, status: v.status as string }))}
      jobRoles={jobRoles ?? []}
      skills={skills ?? []}
      rotationTemplates={rotationTemplates ?? []}
      documentTypes={documentTypes ?? []}
      canManage={can(access, "crew.matrix.manage")}
      canSubmit={can(access, "crew.matrix.submit")}
      canApproveInternal={can(access, "crew.matrix.approve_internal")}
      canApproveClient={can(access, "crew.matrix.approve_client")}
    />
  );
}
