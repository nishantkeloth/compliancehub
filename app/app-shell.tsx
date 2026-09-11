import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SignOutButton from "./signout-button";
import { can, getEffectiveAccess } from "@/lib/rbac";
import ShellChrome, { type NavSection, type NavItem } from "./shell-chrome";

// Server half of the app chrome: auth gate, RBAC-driven nav sections,
// company name. Cheap to call more than once per request now that
// getEffectiveAccess() (lib/rbac.ts) and createClient() (lib/supabase/
// server.ts) are both cache()-wrapped — and getEffectiveAccess() now
// also returns fullName/companyName, so this component doesn't run its
// own separate `profiles`/`companies` queries anymore (that used to be
// two more full round trips on every single page load, on top of the
// page's own auth + RBAC calls).
//
// `active`/`title` are optional — pass them explicitly for a page that
// renders <AppShell> directly (root, /actions, /inspections/[id],
// /platform). Pages nested under app/crew/layout.tsx or app/team/layout.tsx
// get AppShell for free from the layout and don't pass them; ShellChrome
// derives both from the current pathname instead.
export default async function AppShell({
  active,
  title,
  headerRight,
  children,
}: {
  active?: string;
  title?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  const companyName = access.companyName ?? "—";

  const overviewItems: NavItem[] = [{ href: "/", key: "dashboard", label: "Dashboard" }];

  const complianceItems: NavItem[] = [
    { href: "/actions", key: "actions", label: "Corrective Actions" },
  ];
  if (access.orgId) {
    // Visible to every company member (not permission-gated) — someone a
    // schedule is assigned to needs to see it even if they can't create one.
    complianceItems.push({ href: "/team/schedules", key: "schedules", label: "Inspection Schedules" });
  }
  if (can(access, "templates.manage")) {
    complianceItems.push({ href: "/team/templates", key: "templates", label: "Checklist Templates" });
  }

  const contractItems: NavItem[] = [];
  if (can(access, "contracts.view")) {
    contractItems.push({ href: "/contracts", key: "contracts", label: "Contracts" });
  }
  if (can(access, "projects.view")) {
    contractItems.push({ href: "/projects", key: "projects", label: "Projects" });
  }

  const crewItems: NavItem[] = [];
  if (can(access, "crew.view")) {
    crewItems.push({ href: "/crew/profiles", key: "crew-profiles", label: "Crew Profiles" });
    crewItems.push({ href: "/crew/roster", key: "crew-roster", label: "Vessel Roster" });
  }
  if (can(access, "crew.matrix.view")) {
    crewItems.push({ href: "/crew/matrices", key: "crew-matrices", label: "Crew Matrices" });
  }
  if (can(access, "crew.documents.view")) {
    crewItems.push({ href: "/crew/documents", key: "crew-documents", label: "Crew Documents" });
  }
  if (can(access, "crew.manage")) {
    crewItems.push({ href: "/crew/clients", key: "crew-clients", label: "Clients" });
    crewItems.push({ href: "/crew/contractors", key: "crew-contractors", label: "Contractors" });
    crewItems.push({ href: "/crew/setup", key: "crew-setup", label: "Crew Setup" });
  }

  const mobilizationItems: NavItem[] = [];
  if (can(access, "mobilization.view")) {
    mobilizationItems.push({ href: "/mobilizations", key: "mobilizations", label: "Mobilizations" });
    mobilizationItems.push({ href: "/readiness", key: "readiness", label: "Compliance Dashboard" });
    mobilizationItems.push({ href: "/rotations", key: "rotations", label: "Rotations" });
  }

  const adminItems: NavItem[] = [];
  if (can(access, "team.view")) {
    adminItems.push({ href: "/team", key: "team", label: "Manage Users" });
  }
  if (can(access, "team.manage_roles")) {
    adminItems.push({ href: "/team/roles", key: "roles", label: "Roles & Permissions" });
  }
  if (can(access, "team.manage_number_ranges")) {
    adminItems.push({ href: "/team/number-ranges", key: "number-ranges", label: "Number Ranges" });
  }

  const navSections: NavSection[] = [
    { title: "Overview", items: overviewItems },
    { title: "Compliance & Inspections", items: complianceItems },
    { title: "Contracts & Projects", items: contractItems },
    { title: "Crew Matrix", items: crewItems },
    { title: "Mobilization", items: mobilizationItems },
    { title: "Administration", items: adminItems },
  ].filter((section) => section.items.length > 0);

  const initials =
    (access.fullName || user.email || "?").trim()[0]?.toUpperCase() || "?";

  return (
    <ShellChrome
      navSections={navSections}
      companyName={companyName}
      userDisplayName={access.fullName ?? user.email ?? ""}
      roleName={access.roleName ?? ""}
      initials={initials}
      active={active}
      title={title}
      headerRight={headerRight}
      signOutButton={<SignOutButton />}
    >
      {children}
    </ShellChrome>
  );
}
