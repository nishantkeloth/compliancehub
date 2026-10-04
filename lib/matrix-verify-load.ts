import "server-only";
import type { VerifyItem } from "./matrix-verify";

// Which documents would go out with a matrix, and what the record says
// about each — shared by the verify step (verify-actions.ts) and the send
// action (share-actions.ts) so both always agree on the list. Mirrors the
// way the send action picks crew for the Excel: assigned to the matrix's
// site, active, and holding one of the matrix's ranks; documents are the
// latest record per crew member and required document type.

export type ServerVerifyItem = VerifyItem & {
  filePath: string | null;
  contentType: string | null;
  fileSize: number | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the server and admin clients are both valid here
type Supa = any;

export async function loadVerifyItems(supabase: Supa, orgId: string, crewMatrixId: string): Promise<{ items: ServerVerifyItem[] } | { error: string }> {
  const { data: matrix, error: matrixErr } = await supabase.from("crew_matrices").select("id, offshore_site_id").eq("id", crewMatrixId).eq("org_id", orgId).single();
  if (matrixErr || !matrix) return { error: "Matrix not found." };

  const { data: lines } = await supabase
    .from("crew_matrix_lines")
    .select("id, job_role_id, job_roles(name), crew_matrix_line_documents(document_type_id)")
    .eq("crew_matrix_id", crewMatrixId)
    .order("sort_order", { ascending: true });
  if (!lines || lines.length === 0) return { items: [] };

  type LineRow = { job_role_id: string; job_roles: { name?: string } | { name?: string }[] | null; crew_matrix_line_documents: { document_type_id: string }[] | null };
  const lineRows = lines as LineRow[];
  const roleIds = Array.from(new Set(lineRows.map((l) => l.job_role_id)));
  const docTypeIds = Array.from(new Set(lineRows.flatMap((l) => (l.crew_matrix_line_documents ?? []).map((d) => d.document_type_id))));
  if (docTypeIds.length === 0) return { items: [] };

  const { data: assignments } = await supabase.from("crew_assignments").select("crew_id").eq("org_id", orgId).eq("offshore_site_id", matrix.offshore_site_id).is("end_date", null);
  const assignedIds = Array.from(new Set((assignments ?? []).map((a: { crew_id: string }) => a.crew_id)));
  if (assignedIds.length === 0) return { items: [] };

  const { data: crew } = await supabase
    .from("crew_profiles")
    .select("id, full_name, primary_job_role_id")
    .eq("org_id", orgId)
    .eq("employment_status", "active")
    .in("id", assignedIds)
    .in("primary_job_role_id", roleIds);
  if (!crew || crew.length === 0) return { items: [] };
  const crewIds = crew.map((c: { id: string }) => c.id);

  const [{ data: types }, { data: docs }] = await Promise.all([
    supabase.from("document_types").select("id, name, tracks_number").eq("org_id", orgId).in("id", docTypeIds),
    supabase
      .from("crew_documents")
      .select("id, crew_id, document_type_id, document_number, issue_date, expiry_date, created_at")
      .eq("org_id", orgId)
      .in("crew_id", crewIds)
      .in("document_type_id", docTypeIds)
      .order("created_at", { ascending: false }),
  ]);
  const typeById = new Map<string, { name: string; tracks_number: boolean }>((types ?? []).map((t: { id: string; name: string; tracks_number: boolean }) => [t.id, { name: t.name, tracks_number: !!t.tracks_number }]));

  type DocRow = { id: string; crew_id: string; document_type_id: string; document_number: string | null; issue_date: string | null; expiry_date: string | null };
  const latestDoc = new Map<string, DocRow>();
  for (const d of (docs ?? []) as DocRow[]) {
    const k = `${d.crew_id}:${d.document_type_id}`;
    if (!latestDoc.has(k)) latestDoc.set(k, d);
  }

  const docIds = Array.from(latestDoc.values()).map((d) => d.id);
  const { data: versions } = docIds.length
    ? await supabase
        .from("crew_document_versions")
        .select("id, crew_document_id, version_number, file_path, file_name, content_type, file_size_bytes")
        .eq("org_id", orgId)
        .in("crew_document_id", docIds)
        .order("version_number", { ascending: false })
    : { data: [] };
  type VerRow = { id: string; crew_document_id: string; file_path: string; file_name: string | null; content_type: string | null; file_size_bytes: number | null };
  const latestVersion = new Map<string, VerRow>();
  for (const v of (versions ?? []) as VerRow[]) if (!latestVersion.has(v.crew_document_id)) latestVersion.set(v.crew_document_id, v);

  const items: ServerVerifyItem[] = [];
  const seen = new Set<string>();
  for (const line of lineRows) {
    const role = Array.isArray(line.job_roles) ? line.job_roles[0] : line.job_roles;
    const roleName = role?.name ?? "—";
    const lineDocTypes = (line.crew_matrix_line_documents ?? []).map((d) => d.document_type_id);
    const people = (crew as { id: string; full_name: string; primary_job_role_id: string }[]).filter((c) => c.primary_job_role_id === line.job_role_id).sort((a, b) => a.full_name.localeCompare(b.full_name));
    for (const person of people) {
      for (const docTypeId of lineDocTypes) {
        const key = `${person.id}:${docTypeId}`;
        if (seen.has(key)) continue;
        const doc = latestDoc.get(key);
        const type = typeById.get(docTypeId);
        if (!doc || !type) continue; // no record at all — shown as "missing" in the matrix, nothing to verify
        seen.add(key);
        const ver = latestVersion.get(doc.id) ?? null;
        items.push({
          key,
          crewId: person.id,
          crewName: person.full_name,
          roleName,
          docTypeId,
          docTypeName: type.name,
          versionId: ver?.id ?? null,
          fileName: ver?.file_name ?? null,
          filePath: ver?.file_path ?? null,
          contentType: ver?.content_type ?? null,
          fileSize: ver?.file_size_bytes != null ? Number(ver.file_size_bytes) : null,
          expected: {
            crewName: person.full_name,
            typeName: type.name,
            tracksNumber: type.tracks_number,
            number: doc.document_number,
            issueDate: doc.issue_date,
            expiryDate: doc.expiry_date,
          },
        });
      }
    }
  }
  return { items };
}

import type { DocRead, ReadRow } from "./matrix-verify";

export async function loadReads(supabase: Supa, orgId: string, versionIds: string[]): Promise<Map<string, ReadRow>> {
  const out = new Map<string, ReadRow>();
  if (versionIds.length === 0) return out;
  const { data } = await supabase
    .from("crew_document_verification_reads")
    .select("crew_document_version_id, read_ok, read_json, read_error")
    .eq("org_id", orgId)
    .in("crew_document_version_id", versionIds);
  for (const r of (data ?? []) as { crew_document_version_id: string; read_ok: boolean; read_json: DocRead | null; read_error: string | null }[]) {
    out.set(r.crew_document_version_id, { read_ok: r.read_ok, read_json: r.read_json, read_error: r.read_error });
  }
  return out;
}
