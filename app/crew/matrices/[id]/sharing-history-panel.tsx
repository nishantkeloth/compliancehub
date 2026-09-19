"use client";

// Sharing History — every "Send Matrix to Client" package for this
// matrix, with per-recipient delivery/open status and a revoke action.
// See share-actions.ts (getSharingHistory / revokeSharePackage).

import { useEffect, useState } from "react";
import { getSharingHistory, revokeSharePackage } from "./share-actions";

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

type Recipient = {
  id: string;
  name: string;
  email: string;
  deliveryStatus: string;
  viewCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  revokedAt: string | null;
  tokenExpiresAt: string;
};
type Package = {
  id: string;
  shareReference: string;
  status: string;
  matrixVersion: number;
  excelAttached: boolean;
  staffCount: number;
  documentCount: number;
  createdAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
  recipients: Recipient[];
};

const STATUS_COLORS: Record<string, string> = {
  sent: "var(--ch-pass)",
  partially_sent: "#b45309",
  failed: "var(--ch-fail)",
  revoked: "var(--ch-sub)",
  superseded: "var(--ch-sub)",
};

export default function SharingHistoryPanel({ crewMatrixId, onClose }: { crewMatrixId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getSharingHistory(crewMatrixId).then((res) => {
      setLoading(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setPackages((res?.packages ?? []) as Package[]);
    });
  };

  useEffect(load, [crewMatrixId]);

  const doRevoke = async (pkg: Package) => {
    if (!window.confirm(`Revoke sharing reference ${pkg.shareReference}? All its recipients' links will stop working immediately. Already-delivered emails and attachments can't be recalled.`)) return;
    setRevoking(pkg.id);
    const res = await revokeSharePackage(pkg.id);
    setRevoking(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15, 23, 42, 0.5)" }}>
      <div className={`${cardCls} w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5`} style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold" style={{ color: "var(--ch-navy)" }}>Sharing History</h3>
          <button onClick={onClose} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Close</button>
        </div>

        {loading && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Loading…</div>}
        {error && <div className="text-sm mb-3" style={{ color: "var(--ch-fail)" }}>{error}</div>}
        {!loading && packages.length === 0 && !error && (
          <div className="text-sm" style={{ color: "var(--ch-sub)" }}>This matrix hasn&apos;t been sent to a client yet.</div>
        )}

        <div className="space-y-3">
          {packages.map((pkg) => (
            <div key={pkg.id} className="rounded-lg border p-3" style={{ borderColor: "var(--ch-line)" }}>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div>
                  <span className="text-sm font-semibold font-mono" style={{ color: "var(--ch-ink)" }}>{pkg.shareReference}</span>
                  <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>v{pkg.matrixVersion} · {new Date(pkg.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase" style={{ color: STATUS_COLORS[pkg.status] ?? "var(--ch-ink)" }}>{pkg.status.replace(/_/g, " ")}</span>
                  {pkg.status !== "revoked" && (
                    <button onClick={() => doRevoke(pkg)} disabled={revoking === pkg.id} className="text-xs font-semibold rounded px-2 py-1 border disabled:opacity-50" style={{ borderColor: "var(--ch-line)", color: "var(--ch-fail)" }}>
                      {revoking === pkg.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs mb-2" style={{ color: "var(--ch-sub)" }}>
                {pkg.staffCount} staff · {pkg.documentCount} document rows · {pkg.excelAttached ? "Excel attached" : "No attachment"}
                {pkg.revokedAt && ` · Revoked ${new Date(pkg.revokedAt).toLocaleString()}${pkg.revocationReason ? ` (${pkg.revocationReason})` : ""}`}
              </div>
              <div className="space-y-1">
                {pkg.recipients.map((r) => (
                  <div key={r.id} className="text-xs flex items-center justify-between gap-2 flex-wrap rounded px-2 py-1" style={{ background: "var(--ch-paper)" }}>
                    <span style={{ color: "var(--ch-ink)" }}>{r.name} <span style={{ color: "var(--ch-sub)" }}>({r.email})</span></span>
                    <span style={{ color: "var(--ch-sub)" }}>
                      {r.deliveryStatus === "sent" ? "Delivered" : r.deliveryStatus === "failed" ? "Send failed" : "Pending"}
                      {" · "}
                      {r.viewCount > 0 ? `Opened ${r.viewCount}× (last ${r.lastOpenedAt ? new Date(r.lastOpenedAt).toLocaleString() : "—"})` : "Not opened yet"}
                      {r.revokedAt && " · Revoked"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
