import AppShell from "@/app/app-shell";

// Persistent layout for /sites — see app/crew/layout.tsx for why this
// exists (keeps the sidebar chrome mounted across navigations).
export default function SitesLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
