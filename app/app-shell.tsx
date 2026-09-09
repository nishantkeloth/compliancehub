import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SignOutButton from "./signout-button";

export default async function AppShell({
  active,
  title,
  headerRight,
  children,
}: {
  active: string;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, org_id")
    .eq("id", user.id)
    .single();

  let companyName = "Platform Admin";
  if (profile?.org_id) {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", profile.org_id)
      .single();
    companyName = company?.name ?? "—";
  }

  const navItems: { href: string; key: string; label: string }[] = [
    { href: "/", key: "dashboard", label: "Dashboard" },
    { href: "/actions", key: "actions", label: "Corrective Actions" },
  ];
  if (profile?.role === "company_admin" && profile?.org_id) {
    navItems.push({ href: "/team", key: "team", label: "Manage Users" });
  }

  const initials =
    (profile?.full_name || user.email || "?").trim()[0]?.toUpperCase() || "?";

  return (
    <div className="flex min-h-screen" style={{ background: "var(--ch-paper)" }}>
      <aside
        className="w-[236px] shrink-0 flex flex-col sticky top-0 h-screen"
        style={{ background: "var(--ch-sidebar)", color: "#c7d3e0" }}
      >
        <div className="px-[18px] pt-[18px] pb-[14px] flex items-center gap-2.5 border-b border-white/10">
          <div
            className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-white font-extrabold text-[15px] shrink-0"
            style={{ background: "linear-gradient(135deg, var(--ch-navy), var(--ch-ai))" }}
          >
            C
          </div>
          <div>
            <div className="font-extrabold text-[14.5px] text-white leading-tight">
              ComplianceHub
            </div>
            <div className="text-[10.5px]" style={{ color: "#8a96ab" }}>
              {companyName}
            </div>
          </div>
        </div>

        <div
          className="px-[18px] pt-4 pb-1.5 text-[10.5px] font-bold tracking-wider uppercase"
          style={{ color: "#5c6a82" }}
        >
          Workspace
        </div>
        <nav className="px-2.5 flex-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13.5px] font-semibold mb-0.5"
              style={
                active === item.key
                  ? { background: "var(--ch-sidebar-active)", color: "#fff" }
                  : { color: "#aeb9cc" }
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-white/10 px-[18px] py-3.5">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-[13px] shrink-0"
              style={{ background: "var(--ch-ai)", color: "#1c1c1c" }}
            >
              {initials}
            </div>
            <div>
              <div className="text-[13px] font-bold text-white">
                {profile?.full_name ?? user.email}
              </div>
              <div className="text-[11px]" style={{ color: "#8a96ab" }}>
                {profile?.role ?? ""}
              </div>
            </div>
          </div>
          <div className="mt-2.5">
            <SignOutButton />
          </div>
        </div>
        <div className="text-[10px] px-[18px] pb-3.5" style={{ color: "#4a5670" }}>
          Powered by ComplianceHub AI
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div
          className="flex items-center justify-between px-8 py-5 border-b bg-white flex-wrap gap-3"
          style={{ borderColor: "var(--ch-line)" }}
        >
          <h1 className="text-[22px] font-extrabold m-0" style={{ color: "var(--ch-navy)" }}>
            {title}
          </h1>
          {headerRight}
        </div>
        <div className="px-8 py-6 pb-16">{children}</div>
      </main>
    </div>
  );
}
