import AppShell from "@/app/app-shell";

// Persistent layout for /readiness — see app/crew/layout.tsx for why this
// exists (keeps the sidebar chrome mounted across navigations instead of
// AppShell re-rendering on every click).
export default function ReadinessLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
