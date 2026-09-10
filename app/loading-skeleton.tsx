// Shared shimmer skeleton used by the route-level loading.tsx files under
// /crew/* and /team/*. Only ever rendered inside a route's content area —
// the sidebar/header (app/app-shell.tsx via the crew/team layouts) stays
// mounted and doesn't re-render, so this is the only thing that appears
// while the new page's data is being fetched.
export default function LoadingSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-2/3 max-w-md rounded" style={{ background: "var(--ch-line)" }} />
      <div className="h-9 w-40 rounded-lg mt-4" style={{ background: "var(--ch-line)" }} />
      <div className="space-y-2 mt-5">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-xl border"
            style={{ borderColor: "var(--ch-line)", background: "#fff" }}
          />
        ))}
      </div>
    </div>
  );
}
