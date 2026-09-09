import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEffectiveAccess, can } from "@/lib/rbac";
import AppShell from "@/app/app-shell";
import NewTemplateForm from "./new-template-form";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "templates.manage")) redirect("/");

  const { data: templates } = await supabase
    .from("templates")
    .select(
      "id, code, name, revision, scoring_type, status, template_sections(id, template_items(id))"
    )
    .eq("org_id", access.orgId)
    .order("code");

  const rows = (templates ?? []).map((t: any) => {
    const sections = t.template_sections ?? [];
    const itemCount = sections.reduce(
      (n: number, s: any) => n + (s.template_items?.length ?? 0),
      0
    );
    return { ...t, sectionCount: sections.length, itemCount };
  });

  return (
    <AppShell active="templates" title="Checklist Templates">
      <div className="max-w-3xl">
        <NewTemplateForm />

        <div className="mt-6 space-y-3">
          {rows.length === 0 && (
            <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
              No templates yet — create one above.
            </div>
          )}
          {rows.map((t: any) => (
            <Link
              key={t.id}
              href={`/team/templates/${t.id}`}
              className="block bg-white border rounded-xl p-4 hover:shadow-sm transition"
              style={{ borderColor: "var(--ch-line)" }}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold text-sm" style={{ color: "var(--ch-ink)" }}>
                    {t.code} — {t.name}
                  </div>
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    Rev {t.revision} · {t.scoring_type} · {t.sectionCount} section
                    {t.sectionCount === 1 ? "" : "s"}, {t.itemCount} item
                    {t.itemCount === 1 ? "" : "s"}
                  </div>
                </div>
                <span
                  className="text-xs font-semibold px-2 py-1 rounded-full"
                  style={
                    t.status === "active"
                      ? { background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }
                      : t.status === "draft"
                      ? { background: "#fef3e2", color: "#b45309" }
                      : { background: "#e5e7eb", color: "#374151" }
                  }
                >
                  {t.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
