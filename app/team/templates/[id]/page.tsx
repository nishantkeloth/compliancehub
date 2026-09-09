import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getEffectiveAccess, can } from "@/lib/rbac";
import AppShell from "@/app/app-shell";
import TemplateEditor from "./template-editor";

export default async function TemplateDetailPage({
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
  if (!can(access, "templates.manage")) redirect("/");

  const { data: template } = await supabase
    .from("templates")
    .select("id, org_id, code, name, revision, scoring_type, status")
    .eq("id", id)
    .single();
  if (!template || template.org_id !== access.orgId) notFound();

  const { data: sections } = await supabase
    .from("template_sections")
    .select(
      "id, title, sort_order, template_items(id, prompt, sort_order, max_marks, response_type, risk_level, requires_photo_on_fail)"
    )
    .eq("template_id", id)
    .order("sort_order");

  const orderedSections = (sections ?? [])
    .slice()
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((s: any) => ({
      id: s.id,
      title: s.title,
      sortOrder: s.sort_order,
      items: [...(s.template_items ?? [])]
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((it: any) => ({
          id: it.id,
          prompt: it.prompt,
          sortOrder: it.sort_order,
          maxMarks: it.max_marks,
          responseType: it.response_type,
          riskLevel: it.risk_level,
          requiresPhotoOnFail: it.requires_photo_on_fail,
        })),
    }));

  return (
    <AppShell active="templates" title={`${template.code} — ${template.name}`}>
      <div className="max-w-3xl">
        <Link
          href="/team/templates"
          className="text-sm hover:underline"
          style={{ color: "var(--ch-navy)" }}
        >
          ‹ All templates
        </Link>

        <TemplateEditor
          templateId={template.id}
          initialMeta={{
            code: template.code,
            name: template.name,
            revision: template.revision ?? "00",
            scoringType: template.scoring_type,
            status: template.status,
          }}
          initialSections={orderedSections}
        />
      </div>
    </AppShell>
  );
}
