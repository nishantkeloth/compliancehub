import AppShell from "@/app/app-shell";

// Persistent layout for /contracts/* — see app/crew/layout.tsx for why
// this exists (keeps the sidebar chrome mounted across navigations
// instead of AppShell re-rendering on every click).
export default function ContractsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
