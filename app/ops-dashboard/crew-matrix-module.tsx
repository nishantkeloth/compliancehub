function stat(label: string, value: number) {
  return (
    <div>
      <div className="text-2xl font-bold" style={{ color: "var(--ch-navy)" }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
        {label}
      </div>
    </div>
  );
}

export type MobilizedRow = { crewName: string; roleName: string | null; siteName: string | null };

export default function CrewMatrixModule({
  totalActive,
  totalCandidate,
  totalInactive,
  onshore,
  inTransit,
  onboard,
  mobilized,
}: {
  totalActive: number;
  totalCandidate: number;
  totalInactive: number;
  onshore: number;
  inTransit: number;
  onboard: number;
  mobilized: MobilizedRow[];
}) {
  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <div className="text-sm font-semibold mb-3" style={{ color: "var(--ch-navy)" }}>
        Crew Matrix Overview
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mb-4">
        {stat("Active", totalActive)}
        {stat("Candidates", totalCandidate)}
        {stat("Inactive", totalInactive)}
        {stat("Onshore", onshore)}
        {stat("In transit", inTransit)}
        {stat("Onboard", onboard)}
      </div>

      <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
        Currently mobilized ({mobilized.length})
      </div>
      {mobilized.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
          No one is currently on an active assignment.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
                <th className="py-1.5 pr-3">Crew member</th>
                <th className="py-1.5 pr-3">Role</th>
                <th className="py-1.5 pr-3">Site</th>
              </tr>
            </thead>
            <tbody>
              {mobilized.slice(0, 20).map((m, i) => (
                <tr key={i} className="border-t" style={{ borderColor: "var(--ch-line)" }}>
                  <td className="py-2 pr-3">{m.crewName}</td>
                  <td className="py-2 pr-3">{m.roleName ?? "—"}</td>
                  <td className="py-2 pr-3">{m.siteName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mobilized.length > 20 && (
            <p className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
              +{mobilized.length - 20} more.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
