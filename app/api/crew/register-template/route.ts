import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { buildCrewRegisterTemplateWorkbook } from "@/lib/crew-register-template";

// GET /api/crew/register-template — the "Download crew register template"
// link on the Bulk Data Migration → Crew Register Import page. Generated
// on every request from this org's LIVE document types + custom field
// definitions (Crew Setup) instead of a static file, so it never goes
// stale as document types get added, renamed, or given new custom fields —
// the same gap that prompted this route: the old static template only
// ever listed a few example document types, not this company's real ones,
// and had no way to carry a document type's custom fields (e.g. CICPA
// Pass's "Oil Field") at all. Same permission bar as the rest of Bulk Data
// Migration (app/team/bulk-intake/crew-register-actions.ts's
// requireBulkIntakeAccess): company admins only.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.bulk_intake.manage") || !can(access, "crew.manage") || !access.orgId) {
    return NextResponse.json({ error: "Bulk Data Migration is restricted to company admins." }, { status: 403 });
  }

  const [dt, cf] = await Promise.all([
    supabase.from("document_types").select("id, name, category").eq("org_id", access.orgId).eq("is_active", true).order("name"),
    supabase
      .from("document_custom_field_definitions")
      .select("id, label, field_key, applies_to_document_type_id")
      .eq("org_id", access.orgId)
      .eq("is_active", true)
      .order("label"),
  ]);
  if (dt.error) return NextResponse.json({ error: dt.error.message }, { status: 500 });
  if (cf.error) return NextResponse.json({ error: cf.error.message }, { status: 500 });

  const ExcelJS = (await import("exceljs")).default;
  const wb = buildCrewRegisterTemplateWorkbook(ExcelJS, dt.data ?? [], cf.data ?? []);
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="crew-register-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
