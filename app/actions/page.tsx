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
    <main className="min-h-screen bg-neutral-100 p-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ‹ Dashboard
        </Link>
        <h1 className="text-xl font-bold text-neutral-900 mt-3 mb-1">Corrective actions</h1>
        <p className="text-sm text-neutral-500 mb-6">
          Every failed check point becomes a tracked action here automatically.
        </p>

        <div className="mb-8">
          <div className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2">
            Open ({open.length})
          </div>
          {open.length === 0 ? (
            <div className="bg-white border border-neutral-200 rounded-xl p-6 text-sm text-neutral-500">
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
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-2">
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
