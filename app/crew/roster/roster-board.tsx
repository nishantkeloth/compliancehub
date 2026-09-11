"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignCrewToSite, endCrewAssignment } from "../profiles/actions";
import { bulkAssignCrew } from "./actions";
import { DOCUMENT_STATUS_COLORS, DOCUMENT_STATUS_LABELS, type DocumentStatus } from "@/lib/document-status";

type CrewRow = {
  id: string;
  fullName: string;
  roleName: string | null;
  employmentStatus: string;
  siteId: string | null;
  docStatus: DocumentStatus;
};
type SiteRow = { id: string; name: string; code: string | null; siteType: string; contractorName: string | null; capacity: number };
type HistoryRow = { id: string; crewId: string; siteId: string; startDate: string; endDate: string | null };

const EMPLOYMENT_TAG: Record<string, { bg: string; fg: string; label: string } | null> = {
  active: null, // the common case — no badge needed
  candidate: { bg: "#f3f4f6", fg: "#6b7280", label: "Candidate" },
  inactive: { bg: "#f3f4f6", fg: "#9ca3af", label: "Inactive" },
  suspended: { bg: "#fef3e2", fg: "#b45309", label: "Suspended" },
};

// Stable per-vessel color for the timeline bars, keyed by position in the
// active sites list rather than anything derived from the id itself.
const PALETTE = ["#1e3a5f", "#2f6690", "#0f6f68", "#6b5b95", "#3f6b4a", "#8a6d3b", "#4b5563", "#7a5240"];
const UNKNOWN_SITE_COLOR = "#9ca3af";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function RosterBoard({
  crew,
  sites,
  history,
  canManage,
  canEmergencyAssign,
}: {
  crew: CrewRow[];
  sites: SiteRow[];
  history: HistoryRow[];
  canManage: boolean;
  canEmergencyAssign: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Optimistic overlay: crewId -> current site id (or null = unassigned),
  // seeded from props and reconciled whenever a background router.refresh()
  // brings fresh server data back down.
  const [localSiteByCrew, setLocalSiteByCrew] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(crew.map((c) => [c.id, c.siteId]))
  );
  useEffect(() => {
    setLocalSiteByCrew(Object.fromEntries(crew.map((c) => [c.id, c.siteId])));
  }, [crew]);

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [bgError, setBgError] = useState<string | null>(null);
  const [dragOverSite, setDragOverSite] = useState<string | null>(null); // null id means the pool column

  const [activeTab, setActiveTab] = useState<"board" | "timeline">("board");
  const [search, setSearch] = useState("");

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkVessel, setBulkVessel] = useState("");
  const [bulkStartDate, setBulkStartDate] = useState(todayIso());
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");

  // Phase 4: dropping a card onto a vessel is the restricted emergency
  // path (creates a crew_assignments row directly, bypassing a
  // mobilization), so it needs a reason — collected in this small modal
  // instead of assigning immediately on drop. Dropping onto the pool
  // (unassign) doesn't create an assignment, so it stays immediate.
  const [pendingAssign, setPendingAssign] = useState<{ crewId: string; siteId: string } | null>(null);
  const [assignReason, setAssignReason] = useState("");

  const crewById = useMemo(() => Object.fromEntries(crew.map((c) => [c.id, c])), [crew]);
  const openAssignmentByCrew = useMemo(() => {
    const map: Record<string, HistoryRow> = {};
    for (const h of history) if (h.endDate === null) map[h.crewId] = h;
    return map;
  }, [history]);

  const matchesSearch = (c: CrewRow) => !search.trim() || c.fullName.toLowerCase().includes(search.trim().toLowerCase());

  const countForSite = (siteId: string | null) =>
    crew.filter((c) => (localSiteByCrew[c.id] ?? null) === siteId).length;

  function moveCrew(crewId: string, newSiteId: string | null, reason?: string) {
    const person = crewById[crewId];
    if (!person || !canManage) return;
    if (newSiteId && !canEmergencyAssign) return;
    const previousSiteId = localSiteByCrew[crewId] ?? null;
    if (previousSiteId === newSiteId) return;

    setBgError(null);
    setLocalSiteByCrew((prev) => ({ ...prev, [crewId]: newSiteId }));
    setPendingIds((prev) => new Set(prev).add(crewId));

    startTransition(async () => {
      let res: { error?: string } = {};
      if (newSiteId) {
        const fd = new FormData();
        fd.set("offshoreSiteId", newSiteId);
        fd.set("startDate", todayIso());
        fd.set("reason", reason ?? "");
        res = await assignCrewToSite(crewId, fd);
      } else {
        const open = openAssignmentByCrew[crewId];
        if (open) {
          const fd = new FormData();
          fd.set("endDate", todayIso());
          res = await endCrewAssignment(open.id, crewId, fd);
        }
      }
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(crewId);
        return next;
      });
      if (res?.error) {
        setLocalSiteByCrew((prev) => ({ ...prev, [crewId]: previousSiteId }));
        setBgError(`Couldn't move ${person.fullName}: ${res.error}`);
        return;
      }
      router.refresh();
    });
  }

  function openBulkModal() {
    setBulkVessel(sites[0]?.id ?? "");
    setBulkStartDate(todayIso());
    setBulkSelected(new Set(crew.filter((c) => (localSiteByCrew[c.id] ?? null) === null).map((c) => c.id)));
    setBulkReason("");
    setBulkOpen(true);
  }

  function submitBulk() {
    const ids = Array.from(bulkSelected);
    if (!bulkVessel || ids.length === 0 || !canEmergencyAssign || !bulkReason.trim()) return;
    const vessel = sites.find((s) => s.id === bulkVessel);
    const previous: Record<string, string | null> = {};
    ids.forEach((id) => (previous[id] = localSiteByCrew[id] ?? null));

    setBgError(null);
    setLocalSiteByCrew((prev) => {
      const next = { ...prev };
      ids.forEach((id) => (next[id] = bulkVessel));
      return next;
    });
    setPendingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setBulkOpen(false);

    startTransition(async () => {
      const res = await bulkAssignCrew(ids, bulkVessel, bulkStartDate, null, bulkReason.trim());
      setPendingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      if (res?.error) {
        setLocalSiteByCrew((prev) => {
          const next = { ...prev };
          ids.forEach((id) => (next[id] = previous[id]));
          return next;
        });
        setBgError(res.error);
        return;
      }
      router.refresh();
      toast(`${ids.length} crew member(s) assigned to ${vessel?.name ?? "vessel"}`);
    });
  }

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 2400);
  }

  return (
    <div>
      {bgError && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {bgError}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-1 rounded-lg border p-1 bg-white" style={{ borderColor: "var(--ch-line)" }}>
          {(["board", "timeline"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className="px-3.5 py-1.5 rounded-md text-xs font-semibold capitalize"
              style={activeTab === t ? { background: "var(--ch-navy)", color: "#fff" } : { color: "var(--ch-sub)" }}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search crew…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm w-56"
          style={{ borderColor: "var(--ch-line)" }}
        />
        <div className="flex-1" />
        {canEmergencyAssign && (
          <button onClick={openBulkModal} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">
            + Bulk assign
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 mb-3 text-xs flex-wrap" style={{ color: "var(--ch-sub)" }}>
        {(["ok", "warning", "critical", "expired"] as DocumentStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ background: DOCUMENT_STATUS_COLORS[s].fg }}
            />
            {DOCUMENT_STATUS_LABELS[s]}
          </span>
        ))}
        {canManage && activeTab === "board" && (
          <span className="ml-auto">
            {canEmergencyAssign
              ? "Drag a card to another vessel to reassign (emergency override — reason required)"
              : "Drag a card to the bench to unassign — assigning to a vessel now happens through an approved mobilization"}
          </span>
        )}
      </div>

      {activeTab === "board" ? (
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div style={{ display: "flex", gap: 12, minWidth: "max-content" }}>
            <RosterColumn
              site={null}
              crew={crew.filter((c) => (localSiteByCrew[c.id] ?? null) === null && matchesSearch(c))}
              count={countForSite(null)}
              pendingIds={pendingIds}
              canManage={canManage}
              isDragOver={dragOverSite === "__pool__"}
              onDragOverCol={() => setDragOverSite("__pool__")}
              onDragLeaveCol={() => setDragOverSite((s) => (s === "__pool__" ? null : s))}
              onDrop={(crewId) => {
                setDragOverSite(null);
                moveCrew(crewId, null);
              }}
            />
            {sites.map((site) => (
              <RosterColumn
                key={site.id}
                site={site}
                crew={crew.filter((c) => (localSiteByCrew[c.id] ?? null) === site.id && matchesSearch(c))}
                count={countForSite(site.id)}
                pendingIds={pendingIds}
                canManage={canManage}
                isDragOver={dragOverSite === site.id}
                onDragOverCol={() => setDragOverSite(site.id)}
                onDragLeaveCol={() => setDragOverSite((s) => (s === site.id ? null : s))}
                onDrop={(crewId) => {
                  setDragOverSite(null);
                  if (!canEmergencyAssign) {
                    setBgError("Direct assignment is a restricted emergency override — assign crew through an approved mobilization's boarding confirmation instead.");
                    return;
                  }
                  setAssignReason("");
                  setPendingAssign({ crewId, siteId: site.id });
                }}
              />
            ))}
            {sites.length === 0 && (
              <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
                No active vessels yet — add one under Crew Setup → Offshore Sites.
              </div>
            )}
          </div>
        </div>
      ) : (
        <TimelineView crew={crew} sites={sites} history={history} search={search} />
      )}

      {bulkOpen && (
        <BulkAssignModal
          sites={sites}
          crew={crew}
          localSiteByCrew={localSiteByCrew}
          vessel={bulkVessel}
          setVessel={setBulkVessel}
          startDate={bulkStartDate}
          setStartDate={setBulkStartDate}
          selected={bulkSelected}
          setSelected={setBulkSelected}
          reason={bulkReason}
          setReason={setBulkReason}
          onCancel={() => setBulkOpen(false)}
          onSubmit={submitBulk}
        />
      )}

      {pendingAssign && (
        <AssignReasonModal
          crewName={crewById[pendingAssign.crewId]?.fullName ?? "Crew member"}
          siteName={sites.find((s) => s.id === pendingAssign.siteId)?.name ?? "vessel"}
          reason={assignReason}
          setReason={setAssignReason}
          onCancel={() => setPendingAssign(null)}
          onConfirm={() => {
            moveCrew(pendingAssign.crewId, pendingAssign.siteId, assignReason.trim());
            setPendingAssign(null);
          }}
        />
      )}

      {toastMsg && (
        <div
          className="fixed z-50 text-sm font-semibold text-white rounded-lg px-4 py-2.5"
          style={{ background: "var(--ch-navy)", left: "50%", bottom: 24, transform: "translateX(-50%)" }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}

function RosterColumn({
  site,
  crew,
  count,
  pendingIds,
  canManage,
  isDragOver,
  onDragOverCol,
  onDragLeaveCol,
  onDrop,
}: {
  site: SiteRow | null;
  crew: CrewRow[];
  count: number;
  pendingIds: Set<string>;
  canManage: boolean;
  isDragOver: boolean;
  onDragOverCol: () => void;
  onDragLeaveCol: () => void;
  onDrop: (crewId: string) => void;
}) {
  const isPool = site === null;
  const short = !isPool && site.capacity > 0 && count < Math.ceil(site.capacity * 0.7);

  return (
    <div
      className="bg-white border rounded-xl flex flex-col"
      style={{
        borderColor: isDragOver ? "var(--ch-navy)" : "var(--ch-line)",
        boxShadow: isDragOver ? "0 0 0 2px var(--ch-navy-soft) inset" : "none",
        width: 250,
        flex: "0 0 250px",
        maxHeight: "74vh",
      }}
    >
      <div className="px-3.5 pt-3 pb-2.5 border-b" style={{ borderColor: "var(--ch-line)" }}>
        <div className="font-bold text-[13.5px]" style={{ color: "var(--ch-ink)" }}>
          {isPool ? "Unassigned / Onshore" : site.name}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--ch-sub)" }}>
          {isPool ? "Bench" : [site.code, site.contractorName].filter(Boolean).join(" · ") || site.siteType}
        </div>
        <div className="mt-2">
          {isPool ? (
            <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: "var(--ch-line)", color: "var(--ch-sub)" }}>
              {count} available
            </span>
          ) : (
            <span
              className="text-[11px] font-bold rounded-full px-2 py-0.5"
              style={
                short
                  ? { background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }
                  : { background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }
              }
            >
              {count}{site.capacity > 0 ? ` / ${site.capacity}` : ""} POB{short ? " · Short" : ""}
            </span>
          )}
        </div>
      </div>
      <div
        className="p-2.5 flex-1 flex flex-col gap-2"
        style={{ overflowY: "auto" }}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOverCol();
        }}
        onDragLeave={onDragLeaveCol}
        onDrop={(e) => {
          e.preventDefault();
          const crewId = e.dataTransfer.getData("text/plain");
          if (crewId) onDrop(crewId);
        }}
      >
        {crew.length === 0 && (
          <div className="text-[11.5px] text-center py-4" style={{ color: "var(--ch-sub)" }}>
            No crew here.
          </div>
        )}
        {crew.map((c) => (
          <RosterCard key={c.id} crew={c} pending={pendingIds.has(c.id)} draggable={canManage} />
        ))}
      </div>
    </div>
  );
}

function RosterCard({ crew, pending, draggable }: { crew: CrewRow; pending: boolean; draggable: boolean }) {
  const tag = EMPLOYMENT_TAG[crew.employmentStatus] ?? null;
  const docColors = DOCUMENT_STATUS_COLORS[crew.docStatus];
  return (
    <div
      draggable={draggable && !pending}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", crew.id)}
      className="border rounded-lg px-2.5 py-2"
      style={{
        borderColor: "var(--ch-line)",
        background: "#fbfbfc",
        cursor: draggable && !pending ? "grab" : "default",
        opacity: pending ? 0.55 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div>
          <div className="font-bold text-[12.5px]" style={{ color: "var(--ch-ink)" }}>
            {crew.fullName}
          </div>
          <div className="text-[11px]" style={{ color: "var(--ch-sub)" }}>
            {crew.roleName ?? "No role set"}
          </div>
        </div>
        {crew.docStatus !== "none" && (
          <span
            className="text-[9.5px] font-bold rounded-full px-1.5 py-[1px] whitespace-nowrap"
            style={{ background: docColors.bg, color: docColors.fg }}
          >
            {DOCUMENT_STATUS_LABELS[crew.docStatus]}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {pending && (
          <span className="text-[10px] italic" style={{ color: "var(--ch-sub)" }}>
            Saving…
          </span>
        )}
        {tag && (
          <span className="text-[9.5px] font-bold rounded-full px-1.5 py-[1px]" style={{ background: tag.bg, color: tag.fg }}>
            {tag.label}
          </span>
        )}
      </div>
    </div>
  );
}

function BulkAssignModal({
  sites,
  crew,
  localSiteByCrew,
  vessel,
  setVessel,
  startDate,
  setStartDate,
  selected,
  setSelected,
  reason,
  setReason,
  onCancel,
  onSubmit,
}: {
  sites: SiteRow[];
  crew: CrewRow[];
  localSiteByCrew: Record<string, string | null>;
  vessel: string;
  setVessel: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  reason: string;
  setReason: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const unassigned = crew.filter((c) => (localSiteByCrew[c.id] ?? null) === null);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.35)" }}
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl border w-full max-w-md p-5"
        style={{ borderColor: "var(--ch-line)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold mb-0.5" style={{ color: "var(--ch-ink)" }}>
          Bulk assign crew
        </h3>
        <p className="text-xs mb-4" style={{ color: "var(--ch-sub)" }}>
          Select unassigned crew and put them on a vessel in one action. This is a restricted
          emergency override — normal assignment happens through an approved mobilization&rsquo;s
          boarding confirmation, and every use here is logged.
        </p>

        <div className="mb-3">
          <label className="text-[11px] font-bold uppercase tracking-wide block mb-1" style={{ color: "var(--ch-sub)" }}>
            Vessel
          </label>
          <select
            className="border rounded-lg px-3 py-2 text-sm w-full"
            style={{ borderColor: "var(--ch-line)" }}
            value={vessel}
            onChange={(e) => setVessel(e.target.value)}
          >
            <option value="">Select vessel…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.contractorName ? ` — ${s.contractorName}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <label className="text-[11px] font-bold uppercase tracking-wide block mb-1" style={{ color: "var(--ch-sub)" }}>
            Start date
          </label>
          <input
            type="date"
            className="border rounded-lg px-3 py-2 text-sm w-full"
            style={{ borderColor: "var(--ch-line)" }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="mb-1">
          <label className="text-[11px] font-bold uppercase tracking-wide block mb-1" style={{ color: "var(--ch-sub)" }}>
            Unassigned crew ({selected.size} selected)
          </label>
          <div className="border rounded-lg" style={{ borderColor: "var(--ch-line)", maxHeight: 160, overflowY: "auto" }}>
            {unassigned.length === 0 && (
              <div className="text-xs px-3 py-3" style={{ color: "var(--ch-sub)" }}>
                No unassigned crew right now.
              </div>
            )}
            {unassigned.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] border-b last:border-b-0"
                style={{ borderColor: "var(--ch-line)" }}
              >
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span>
                  <b>{c.fullName}</b> — {c.roleName ?? "No role set"}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mb-1">
          <label className="text-[11px] font-bold uppercase tracking-wide block mb-1" style={{ color: "var(--ch-sub)" }}>
            Reason (required)
          </label>
          <input
            className="border rounded-lg px-3 py-2 text-sm w-full"
            style={{ borderColor: "var(--ch-line)" }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why these crew members are being assigned directly, outside a mobilization"
          />
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={onSubmit}
            disabled={!vessel || selected.size === 0 || !reason.trim()}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ flex: 1 }}
          >
            Assign selected
          </button>
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignReasonModal({
  crewName,
  siteName,
  reason,
  setReason,
  onCancel,
  onConfirm,
}: {
  crewName: string;
  siteName: string;
  reason: string;
  setReason: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.35)" }}
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl border w-full max-w-sm p-5"
        style={{ borderColor: "var(--ch-line)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold mb-0.5" style={{ color: "var(--ch-ink)" }}>
          Assign {crewName} to {siteName}
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
          Direct assignment is a restricted emergency override — normal assignment happens
          through an approved mobilization&rsquo;s boarding confirmation, and this use will be
          logged.
        </p>
        <label className="text-[11px] font-bold uppercase tracking-wide block mb-1" style={{ color: "var(--ch-sub)" }}>
          Reason (required)
        </label>
        <input
          autoFocus
          className="border rounded-lg px-3 py-2 text-sm w-full"
          style={{ borderColor: "var(--ch-line)" }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this crew member is being assigned directly, outside a mobilization"
        />
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={onConfirm}
            disabled={!reason.trim()}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ flex: 1 }}
          >
            Assign
          </button>
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const DAY_MS = 86400000;
const DOMAIN_DAYS = 365;

function TimelineView({
  crew,
  sites,
  history,
  search,
}: {
  crew: CrewRow[];
  sites: SiteRow[];
  history: HistoryRow[];
  search: string;
}) {
  const crewById = useMemo(() => Object.fromEntries(crew.map((c) => [c.id, c])), [crew]);
  const siteIndex = useMemo(() => Object.fromEntries(sites.map((s, i) => [s.id, i])), [sites]);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "Former vessel";
  const colorFor = (id: string) => (id in siteIndex ? PALETTE[siteIndex[id] % PALETTE.length] : UNKNOWN_SITE_COLOR);

  const now = Date.now();
  const domainStart = now - DOMAIN_DAYS * DAY_MS;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - domainStart) / (now - domainStart)) * 100));

  const rows = useMemo(() => {
    const byCrew: Record<string, HistoryRow[]> = {};
    for (const h of history) {
      const end = h.endDate ? new Date(h.endDate + "T00:00:00").getTime() : now;
      if (end < domainStart) continue;
      byCrew[h.crewId] ??= [];
      byCrew[h.crewId].push(h);
    }
    return Object.entries(byCrew)
      .map(([crewId, rows]) => ({ crewId, person: crewById[crewId], rows }))
      .filter((r) => r.person && (!search.trim() || r.person.fullName.toLowerCase().includes(search.trim().toLowerCase())))
      .sort((a, b) => a.person!.fullName.localeCompare(b.person!.fullName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, crewById, search]);

  const legendSiteIds = Array.from(new Set(rows.flatMap((r) => r.rows.map((h) => h.siteId))));

  const ticks = Array.from({ length: 7 }, (_, i) => {
    const ms = domainStart + (i / 6) * (now - domainStart);
    return new Date(ms).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  });

  if (rows.length === 0) {
    return (
      <div className="text-sm rounded-xl border p-6 text-center" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
        No vessel assignments in the last 12 months yet.
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-xl border bg-white" style={{ borderColor: "var(--ch-line)", overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760, fontSize: 12 }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "9px 12px",
                  borderBottom: "1px solid var(--ch-line)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "var(--ch-sub)",
                  textTransform: "uppercase",
                  letterSpacing: ".03em",
                  minWidth: 170,
                }}
              >
                Crew member
              </th>
              <th style={{ borderBottom: "1px solid var(--ch-line)", padding: "9px 4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ch-sub)" }}>
                  {ticks.map((t, i) => (
                    <span key={i}>{t}</span>
                  ))}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ crewId, person, rows: bars }) => (
              <tr key={crewId}>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--ch-line)" }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{person!.fullName}</div>
                  <div style={{ fontSize: 10.5, color: "var(--ch-sub)" }}>{person!.roleName ?? ""}</div>
                </td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--ch-line)" }}>
                  <div
                    style={{
                      position: "relative",
                      height: 24,
                      background:
                        "repeating-linear-gradient(to right, var(--ch-line) 0, var(--ch-line) 1px, transparent 1px, transparent 14.28%)",
                    }}
                  >
                    {bars.map((h) => {
                      const start = new Date(h.startDate + "T00:00:00").getTime();
                      const end = h.endDate ? new Date(h.endDate + "T00:00:00").getTime() : now;
                      const left = pct(start);
                      const width = Math.max(1.2, pct(end) - left);
                      return (
                        <div
                          key={h.id}
                          title={`${siteName(h.siteId)}: ${h.startDate} → ${h.endDate ?? "present"}`}
                          style={{
                            position: "absolute",
                            top: 2,
                            left: `${left}%`,
                            width: `${width}%`,
                            height: 20,
                            borderRadius: 5,
                            background: colorFor(h.siteId),
                            color: "#fff",
                            fontSize: 9.5,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            padding: "0 6px",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {siteName(h.siteId)}
                        </div>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs flex-wrap" style={{ color: "var(--ch-sub)" }}>
        {legendSiteIds.map((id) => (
          <span key={id} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: colorFor(id) }} />
            {siteName(id)}
          </span>
        ))}
      </div>
    </div>
  );
}
