"use client";

// Client-side half of the app chrome. Split out of app-shell.tsx so the
// server half (auth + RBAC + nav-section data) can live in a persistent
// layout (app/crew/layout.tsx, app/team/layout.tsx) without needing to
// know, at layout-render time, which specific page is being shown.
//
// usePathname() runs correctly on both the initial server render (Next
// resolves it from the request URL) and every client-side navigation
// after, so there's no flash of the wrong active link or title.
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; key: string; label: string };
export type NavSection = { title: string; items: NavItem[] };

// Longest-prefix match against the same nav list already computed
// server-side — no separate title/route table to keep in sync. A page
// nested under a nav item's href (e.g. /crew/profiles/[id] under
// /crew/profiles) inherits that item's key + label.
function matchNavItem(pathname: string, navSections: NavSection[]): NavItem | null {
  let best: NavItem | null = null;
  for (const section of navSections) {
    for (const item of section.items) {
      const isMatch =
        item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
      if (isMatch && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best;
}

export default function ShellChrome({
  navSections,
  companyName,
  userDisplayName,
  roleName,
  initials,
  active,
  title,
  headerRight,
  signOutButton,
  children,
}: {
  navSections: NavSection[];
  companyName: string;
  userDisplayName: string;
  roleName: string;
  initials: string;
  // Both optional: when a page still passes them explicitly (root,
  // actions, inspections, platform), that wins. Otherwise they're derived
  // from the current pathname against navSections.
  active?: string;
  title?: string;
  headerRight?: React.ReactNode;
  signOutButton: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const matched = matchNavItem(pathname, navSections);
  const activeKey = active ?? matched?.key;
  const resolvedTitle = title ?? matched?.label ?? "";

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

        <nav className="px-2.5 pt-3.5 flex-1 overflow-y-auto">
          {navSections.map((section, i) => (
            <div key={section.title} className={i === 0 ? "" : "mt-3.5"}>
              <div
                className="px-2.5 pb-1.5 text-[10.5px] font-bold tracking-wider uppercase"
                style={{ color: "#5c6a82" }}
              >
                {section.title}
              </div>
              {section.items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13.5px] font-semibold mb-0.5"
                  style={
                    activeKey === item.key
                      ? { background: "var(--ch-sidebar-active)", color: "#fff" }
                      : { color: "#aeb9cc" }
                  }
                >
                  {item.label}
                </Link>
              ))}
            </div>
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
              <div className="text-[13px] font-bold text-white">{userDisplayName}</div>
              <div className="text-[11px]" style={{ color: "#8a96ab" }}>
                {roleName}
              </div>
            </div>
          </div>
          <div className="mt-2.5">{signOutButton}</div>
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
            {resolvedTitle}
          </h1>
          {headerRight}
        </div>
        <div className="px-8 py-6 pb-16">{children}</div>
      </main>
    </div>
  );
}
