import AppShell from "@/app/app-shell";

// Persistent layout for everything under /team/* (Manage Users, Roles &
// Permissions, Number Ranges, Inspection Schedules, Checklist Templates).
// See app/crew/layout.tsx for the full rationale — same pattern here.
export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
