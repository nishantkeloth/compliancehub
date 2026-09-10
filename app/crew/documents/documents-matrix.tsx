"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCrewDocument, updateCrewDocument } from "../profiles/actions";
import { computeDocumentStatus, DOCUMENT_STATUS_COLORS, DOCUMENT_STATUS_LABELS, type DocumentStatus } from "@/lib/document-status";

type CrewRow = {
  id: string;
  fullName: string;
  employmentStatus: string;
  roleName: string | null;
  siteId: string | null;
  siteName: string | null;
};
type DocumentType = {
  id: string;
  name: string;
  category: string | null;
  tracks_number: boolean;
  warning_threshold_days: number | null;
  is_active: boolean;
};
type CellRecord = {
  id: string;
  crew_id: string;
  document_type_id: string;
  document_number: string | null;
  sponsor: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  entry_date: string | null;
  extension_date: string | null;
  dose_number: string | null;
  reliever_crew_id: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown> | null;
};
type SiteRef = { id: string; name: string };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };

const STATUS_PILLS: { key: "all" | "expiring" | "expired"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "expiring", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
];

export default function DocumentsMatrix({
  crew,
  documentTypes,
  cellMap,
  offshoreSites,
  canManage,
}: {
  crew: CrewRow[];
  documentTypes: DocumentType[];
  cellMap: Record<string, Record<string, CellRecord>>;
  offshoreSites: SiteRef[];
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "expiring" | "expired">("all");
  const [popover, setPopover] = useState<{ crewId: string; crewName: string; documentTypeId: string } | null>(null);

  const columns = docTypeFilter ? documentTypes.filter((t) => t.id === docTypeFilter) : documentTypes;

  const statusFor = (crewId: string, docTypeId: string) => {
    const type = documentTypes.find((t) => t.id === docTypeId);
    const cell = cellMap[crewId]?.[docTypeId];
    return computeDocumentStatus(cell?.expiry_date ?? null, type?.warning_threshold_days ?? null, type?.category ?? null).status;
  };

  const rows = useMemo(() => {
    return crew.filter((c) => {
      if (search && !c.fullName.toLowerCase().includes(search.toLowerCase())) return false;
      if (siteFilter && c.siteId !== siteFilter) return false;
      if (statusFilter !== "all") {
        const matches = columns.some((col) => {
          const s = statusFor(c.id, col.id);
          return statusFilter === "expired" ? s === "expired" : s === "warning" || s === "critical";
        });
        if (!matches) return false;
      }
      return true;
    });
  }, [crew, search, siteFilter, statusFilter, columns, cellMap, documentTypes]);

  const exportCsv = () => {
    const header = ["Crew member", "Role", "Vessel", ...columns.map((c) => c.name)];
    const lines = [header];
    for (const c of rows) {
      const cells = columns.map((col) => {
        const cell = cellMap[c.id]?.[col.id];
        if (!cell?.expiry_date) return "";
        const { status, daysRemaining } = computeDocumentStatus(cell.expiry_date, col.warning_threshold_days, col.category);
        return `${cell.expiry_date} (${DOCUMENT_STATUS_LABELS[status]}${daysRemaining != null ? `, ${daysRemaining}d` : ""})`;
      });
      lines.push([c.fullName, c.roleName ?? "", c.siteName ?? "", ...cells]);
    }
    const csv = lines.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "crew-documents.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <input
          className={`${inputCls} w-56`}
          style={inputStyle}
          placeholder="Search crew…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={inputCls} style={inputStyle} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
          <option value="">All vessels</option>
          {offshoreSites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select className={inputCls} style={inputStyle} value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}>
          <option value="">All document types</option>
          {documentTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: "var(--ch-line)" }}>
          {STATUS_PILLS.map((p) => (
            <button
              key={p.key}
              onClick={() => setStatusFilter(p.key)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold"
              style={statusFilter === p.key ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={exportCsv} className="ml-auto rounded-lg px-3 py-2 text-xs font-semibold border" style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}>
          Export CSV
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs" style={{ color: "var(--ch-sub)" }}>
        {(["ok", "warning", "critical", "expired"] as DocumentStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: DOCUMENT_STATUS_COLORS[s].fg }} />
            {DOCUMENT_STATUS_LABELS[s]}
          </span>
        ))}
      </div>

      {/* Matrix */}
      <div className="rounded-xl border overflow-auto" style={{ borderColor: "var(--ch-line)", maxHeight: "70vh" }}>
        <table className="text-sm border-collapse w-full">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-20 bg-white text-left px-3 py-2 border-b border-r text-xs font-bold uppercase tracking-wide"
                style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)", minWidth: 200 }}
              >
                Crew member
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="sticky top-0 z-10 bg-white text-left px-3 py-2 border-b text-xs font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-sm" style={{ color: "var(--ch-sub)" }}>
                  No crew match the current filters.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id}>
                <td
                  className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-r"
                  style={{ borderColor: "var(--ch-line)" }}
                >
                  <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>{c.fullName}</div>
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    {c.roleName ?? "—"}{c.siteName ? ` · ${c.siteName}` : ""}
                  </div>
                </td>
                {columns.map((col) => {
                  const cell = cellMap[c.id]?.[col.id];
                  const { status, daysRemaining } = computeDocumentStatus(cell?.expiry_date ?? null, col.warning_threshold_days, col.category);
                  const colors = DOCUMENT_STATUS_COLORS[status];
                  return (
                    <td key={col.id} className="border-b px-2 py-1.5" style={{ borderColor: "var(--ch-line)" }}>
                      <button
                        onClick={() => setPopover({ crewId: c.id, crewName: c.fullName, documentTypeId: col.id })}
                        className="w-full text-left rounded-lg px-2 py-1.5 text-xs font-semibold"
                        style={{ background: colors.bg, color: colors.fg }}
                      >
                        {cell?.expiry_date ? (
                          <>
                            {cell.expiry_date}
                            <span className="block font-normal opacity-80">
                              {DOCUMENT_STATUS_LABELS[status]}{daysRemaining != null ? ` · ${daysRemaining}d` : ""}
                            </span>
                          </>
                        ) : (
                          <span className="opacity-70">{DOCUMENT_STATUS_LABELS[status]}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {popover && (
        <CellEditor
          crewId={popover.crewId}
          crewName={popover.crewName}
          documentType={documentTypes.find((t) => t.id === popover.documentTypeId)!}
          existing={cellMap[popover.crewId]?.[popover.documentTypeId]}
          canManage={canManage}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

function CellEditor({
  crewId,
  crewName,
  documentType,
  existing,
  canManage,
  onClose,
}: {
  crewId: string;
  crewName: string;
  documentType: DocumentType;
  existing?: CellRecord;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [documentNumber, setDocumentNumber] = useState(existing?.document_number ?? "");
  const [sponsor, setSponsor] = useState(existing?.sponsor ?? "");
  const [issueDate, setIssueDate] = useState(existing?.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(existing?.expiry_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isVisa = documentType.category === "visa";

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("documentTypeId", documentType.id);
    fd.set("documentNumber", documentNumber.trim());
    fd.set("sponsor", sponsor.trim());
    fd.set("issueDate", issueDate);
    fd.set("expiryDate", expiryDate);
    // Fields not editable from this quick view are passed through unchanged
    // so a matrix-cell edit never clobbers data entered on the crew profile.
    fd.set("entryDate", existing?.entry_date ?? "");
    fd.set("extensionDate", existing?.extension_date ?? "");
    fd.set("doseNumber", existing?.dose_number ?? "");
    fd.set("relieverCrewId", existing?.reliever_crew_id ?? "");
    fd.set("notes", existing?.notes ?? "");
    fd.set("customFields", JSON.stringify(existing?.custom_fields ?? {}));
    startTransition(async () => {
      const res = existing ? await updateCrewDocument(existing.id, crewId, fd) : await createCrewDocument(crewId, fd);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.35)" }} onClick={onClose}>
      <div className="bg-white rounded-xl border w-full max-w-md p-5" style={{ borderColor: "var(--ch-line)" }} onClick={(e) => e.stopPropagation()}>
        <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--ch-sub)" }}>
          {documentType.name}
        </div>
        <div className="text-sm font-bold mb-4" style={{ color: "var(--ch-ink)" }}>{crewName}</div>

        {documentType.tracks_number && (
          <div className="mb-3">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Document number
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} disabled={!canManage} />
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 mb-3">
          <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Issue date
            <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!canManage} />
          </label>
          <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Expiry date
            <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} disabled={!canManage} />
          </label>
        </div>
        {isVisa && (
          <div className="mb-3">
            <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
              Sponsor
              <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={sponsor} onChange={(e) => setSponsor(e.target.value)} disabled={!canManage} />
            </label>
          </div>
        )}

        {error && <div className="text-xs mb-2" style={{ color: "var(--ch-fail)" }}>{error}</div>}

        <div className="flex items-center gap-2 mt-2">
          {canManage && (
            <button onClick={save} disabled={pending} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {pending ? "Saving…" : "Save"}
            </button>
          )}
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>
            {canManage ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
