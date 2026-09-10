import AppShell from "@/app/app-shell";

// Persistent layout for everything under /crew/* (Profiles, Vessel
// Roster, Crew Documents, Clients, Contractors, Crew Setup). AppShell
// does its own auth check and redirects to /login if needed — this layout
// doesn't duplicate that.
//
// Each page underneath still does its own specific permission check
// (crew.view / crew.documents.view / crew.manage) and its own data
// fetching exactly as before; only the sidebar chrome moved here so Next
// can keep it mounted across navigations within /crew/* instead of
// re-rendering it on every click (see next.config.ts's staleTimes).
export default function CrewLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
