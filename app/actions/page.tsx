import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ActionRow from "./action-row";

export default async function ActionsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: actions } = await supabase
    .from("corrective_actions")
    .select("id, title, finding, owner_name, priority, due_date, status, closed_at, created_at, sites(name)")
    .order("created_at", { ascending: false });

  const open = (actions ?? []).filter((a: any) => a.status === "open" || a.status === "in_progress");
  const closed = (actions ?? []).filter((a: any) => a.status === "closed");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="min-h-screen p-8" style={{ background: "var(--ch-paper)" }}>
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-sm hover:underline" style={{ color: "var(--ch-navy)" }}>
          ‹ Dashboard
        </Link>
        <h1 className="text-xl font-bold mt-3 mb-1" style={{ color: "var(--ch-ink)" }}>Corrective actions</h1>
        <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
          Every failed check point becomes a tracked action here automatically.
        </p>

        <div className="mb-8">
          <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
            Open ({open.length})
          </div>
          {open.length === 0 ? (
            <div className="bg-white border rounded-xl p-6 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
              No open actions — nice work.
            </div>
          ) : (
            <div className="space-y-3">
              {open.map((a: any) => (
                <ActionRow key={a.id} action={a} overdue={a.due_date < today} />
              ))}
            </div>
          )}
        </div>

        {closed.length > 0 && (
          <div>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
              Closed ({closed.length})
            </div>
            <div className="space-y-3">
              {closed.map((a: any) => (
                <ActionRow key={a.id} action={a} overdue={false} />
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
