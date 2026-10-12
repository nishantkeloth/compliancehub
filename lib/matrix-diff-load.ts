// Version-to-version comparison — the I/O half. Loads a matrix with every
// name resolved (roles, rotations, skills, document types), compares two of
// them, and freezes the result onto a version. The comparison rules live in
// matrix-diff.ts and are pure.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  diffMatrices,
  totalChanges,
  summarizeDiff,
  type MatrixDiff,
  type SnapLine,
  type SnapMatrix,
} from "@/lib/matrix-diff";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase rows, same pattern as the rest of the matrix code */

export async function loadMatrixSnapshot(supabase: SupabaseClient, orgId: string, matrixId: string): Promise<SnapMatrix | null> {
  const { data: m } = await supabase
    .from("crew_matrices")
    .select("id, title, effective_from, effective_to, expected_pob, notes")
    .eq("id", matrixId)
    .eq("org_id", orgId)
    .single();
  if (!m) return null;

  const { data: lineRows } = await supabase.from("crew_matrix_lines").select("*").eq("crew_matrix_id", matrixId).order("line_number");
  const lines = (lineRows ?? []) as any[];
  const lineIds = lines.map((l) => l.id as string);

  const [roles, rotations, skillsRes, docsRes, compRes, reqRes, skillNames, docNames] = await Promise.all([
    supabase.from("job_roles").select("id, name").eq("org_id", orgId),
    supabase.from("rotation_templates").select("id, name").eq("org_id", orgId),
    lineIds.length ? supabase.from("crew_matrix_line_skills").select("line_id, skill_id").in("line_id", lineIds) : Promise.resolve({ data: [] }),
    lineIds.length
      ? supabase
          .from("crew_matrix_line_documents")
          .select("line_id, document_type_id, minimum_remaining_validity_days, is_mandatory, waiver_permitted")
          .in("line_id", lineIds)
      : Promise.resolve({ data: [] }),
    lineIds.length
      ? supabase.from("crew_matrix_line_competencies").select("line_id, competency_name, minimum_grade, notes").in("line_id", lineIds)
      : Promise.resolve({ data: [] }),
    lineIds.length
      ? supabase.from("crew_matrix_line_client_requirements").select("line_id, requirement_text, is_mandatory").in("line_id", lineIds)
      : Promise.resolve({ data: [] }),
    supabase.from("skills").select("id, name").eq("org_id", orgId),
    supabase.from("document_types").select("id, name").eq("org_id", orgId),
  ]);

  const nameOf = (rows: any[] | null | undefined) => new Map((rows ?? []).map((r) => [r.id as string, r.name as string]));
  const roleName = nameOf(roles.data);
  const rotName = nameOf(rotations.data);
  const skillName = nameOf(skillNames.data);
  const docName = nameOf(docNames.data);

  const group = <T extends { line_id: string }>(rows: T[] | null | undefined) => {
    const g = new Map<string, T[]>();
    for (const r of rows ?? []) {
      const arr = g.get(r.line_id) ?? [];
      arr.push(r);
      g.set(r.line_id, arr);
    }
    return g;
  };
  const skillsBy = group(skillsRes.data as any[]);
  const docsBy = group(docsRes.data as any[]);
  const compBy = group(compRes.data as any[]);
  const reqBy = group(reqRes.data as any[]);

  const snapLines: SnapLine[] = lines.map((l) => ({
    job_role_id: l.job_role_id,
    roleName: roleName.get(l.job_role_id) ?? "Unknown role",
    line_number: l.line_number,
    required_headcount: l.required_headcount ?? null,
    day_shift_quantity: l.day_shift_quantity ?? null,
    night_shift_quantity: l.night_shift_quantity ?? null,
    other_shift_quantity: l.other_shift_quantity ?? null,
    rotationName: l.rotation_template_id ? rotName.get(l.rotation_template_id) ?? null : null,
    employment_type_preference: l.employment_type_preference ?? null,
    nationality_preference: l.nationality_preference ?? null,
    language_requirement: l.language_requirement ?? null,
    minimum_experience_years: l.minimum_experience_years ?? null,
    mobilization_lead_days: l.mobilization_lead_days ?? null,
    client_approval_required: !!l.client_approval_required,
    remarks: l.remarks ?? null,
    skills: (skillsBy.get(l.id) ?? []).map((s: any) => ({ id: s.skill_id as string, name: skillName.get(s.skill_id) ?? "Unknown skill" })),
    documents: (docsBy.get(l.id) ?? []).map((d: any) => ({
      document_type_id: d.document_type_id as string,
      name: docName.get(d.document_type_id) ?? "Unknown document",
      minimum_remaining_validity_days: d.minimum_remaining_validity_days ?? null,
      is_mandatory: !!d.is_mandatory,
      waiver_permitted: !!d.waiver_permitted,
    })),
    competencies: (compBy.get(l.id) ?? []).map((c: any) => ({
      competency_name: c.competency_name as string,
      minimum_grade: c.minimum_grade ?? null,
      notes: c.notes ?? null,
    })),
    clientReqs: (reqBy.get(l.id) ?? []).map((r: any) => ({ requirement_text: r.requirement_text as string, is_mandatory: !!r.is_mandatory })),
  }));

  return {
    title: m.title as string,
    effective_from: (m.effective_from as string | null) ?? null,
    effective_to: (m.effective_to as string | null) ?? null,
    expected_pob: (m.expected_pob as number | null) ?? null,
    notes: (m.notes as string | null) ?? null,
    lines: snapLines,
  };
}

export async function compareMatrixIds(supabase: SupabaseClient, orgId: string, fromId: string, toId: string): Promise<MatrixDiff | null> {
  const [a, b] = await Promise.all([loadMatrixSnapshot(supabase, orgId, fromId), loadMatrixSnapshot(supabase, orgId, toId)]);
  if (!a || !b) return null;
  return diffMatrices(a, b);
}

export type FrozenSummary = {
  fromMatrixId: string;
  fromVersion: number | null;
  diff: MatrixDiff;
  sentences: string[];
  total: number;
};

/**
 * Work out which version this one should be compared with: the one it was
 * created from, or failing that the next-lower version of the same matrix.
 */
export async function findPreviousVersion(
  supabase: SupabaseClient,
  orgId: string,
  matrixId: string
): Promise<{ id: string; version_number: number } | null> {
  const { data: m } = await supabase
    .from("crew_matrices")
    .select("id, matrix_number, version_number, compared_to_matrix_id")
    .eq("id", matrixId)
    .eq("org_id", orgId)
    .single();
  if (!m) return null;
  if (m.compared_to_matrix_id) {
    const { data: prev } = await supabase
      .from("crew_matrices")
      .select("id, version_number")
      .eq("id", m.compared_to_matrix_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (prev) return prev as { id: string; version_number: number };
  }
  if (!m.matrix_number || (m.version_number as number) <= 1) return null;
  const { data: prev } = await supabase
    .from("crew_matrices")
    .select("id, version_number")
    .eq("org_id", orgId)
    .eq("matrix_number", m.matrix_number)
    .lt("version_number", m.version_number)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (prev as { id: string; version_number: number } | null) ?? null;
}

export async function buildSummary(supabase: SupabaseClient, orgId: string, matrixId: string): Promise<FrozenSummary | null> {
  const prev = await findPreviousVersion(supabase, orgId, matrixId);
  if (!prev) return null;
  const diff = await compareMatrixIds(supabase, orgId, prev.id, matrixId);
  if (!diff) return null;
  return { fromMatrixId: prev.id, fromVersion: prev.version_number, diff, sentences: summarizeDiff(diff), total: totalChanges(diff) };
}

/**
 * Store the change list on the version. Called when the version is
 * submitted for approval and again when it is activated. Best effort: a
 * problem here (for example the 0043 columns not created yet) must never
 * stop the approval or activation itself.
 */
export async function freezeChangeSummary(supabase: SupabaseClient, orgId: string, matrixId: string): Promise<void> {
  try {
    const summary = await buildSummary(supabase, orgId, matrixId);
    if (!summary) return;
    await supabase
      .from("crew_matrices")
      .update({
        change_summary_json: summary,
        change_summary_frozen_at: new Date().toISOString(),
        compared_to_matrix_id: summary.fromMatrixId,
      })
      .eq("id", matrixId)
      .eq("org_id", orgId);
  } catch {
    /* best effort */
  }
}
