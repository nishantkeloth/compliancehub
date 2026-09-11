import AppShell from "@/app/app-shell";

// Persistent layout for /containers/* — see app/crew/layout.tsx for why
// this exists (keeps the sidebar chrome mounted across navigations).
export default function ContainersLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
