import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SignOutButton from "../signout-button";
import NewCompanyForm from "./new-company-form";

export default async function PlatformPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: platformAdminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Not a platform admin -> this console isn't theirs, send them to their
  // normal tenant dashboard instead.
  if (!platformAdminRow) redirect("/");

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen" style={{ background: "var(--ch-paper)" }}>
      <div style={{ background: "var(--ch-sidebar)" }} className="text-white">
        <div className="max-w-4xl mx-auto px-8 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">
              Compliance<span style={{ color: "#fff", opacity: 0.7 }}>Hub</span>
            </h1>
            <p className="text-sm" style={{ color: "#8a96ab" }}>
              Platform Admin console
            </p>
          </div>
          <SignOutButton />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-8">
        <h2
          className="text-sm font-semibold uppercase tracking-wide mb-3"
          style={{ color: "var(--ch-sub)" }}
        >
          Companies
        </h2>

        <NewCompanyForm />

        <div className="space-y-3 mt-6">
          {(companies ?? []).map((c) => (
            <div
              key={c.id}
              className="bg-white border rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap"
              style={{ borderColor: "var(--ch-line)" }}
            >
              <div>
                <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>
                  {c.name}
                </div>
                <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
                  Created {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
              <span
                className="text-xs font-bold uppercase rounded-full px-3 py-1"
                style={
                  c.status === "active"
                    ? { background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }
                    : { background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }
                }
              >
                {c.status}
              </span>
            </div>
          ))}
          {(companies ?? []).length === 0 && (
            <div
              className="bg-white border rounded-xl p-6 text-sm"
              style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
            >
              No companies yet — add the first one above.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
