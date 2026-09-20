"use client";

// Phase 12 admin screen — configure a client's mobilization tracks
// (onboarding pathways, e.g. "New Joiner" vs "Returning Crew") and each
// track's ordered checklist of steps. Deliberately client-agnostic:
// nothing here is specific to any one client's process — an admin
// types in whatever a client's flow actually requires. See
// claude/phase12-adnoc-mobilization-flow-scope.md.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTrack,
  updateTrack,
  deleteTrack,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  type TrackRow,
  type ChecklistTemplateItemRow,
} from "../tracks-actions";

type ClientOpt = { id: string; name: string };
type DocTypeOpt = { id: string; name: string };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };

const ORG_WIDE = "__org_wide__";
const ALL = "__all__";

const DUE_BASIS_LABEL: Record<string, string> = {
  request_created: "days after the request is created",
  required_onboard_date: "days relative to the required onboard date",
  relative_to_item: "days after another step is done",
};

function dueRuleSummary(item: ChecklistTemplateItemRow, allItems: ChecklistTemplateItemRow[]) {
  if (item.due_basis === "relative_to_item") {
    const target = allItems.find((i) => i.id === item.due_relative_item_id);
    return `${item.due_offset_days} day(s) after "${target?.title ?? "—"}" is done`;
  }
  if (item.due_basis === "required_onboard_date") {
    return item.due_offset_days === 0 ? "on the required onboard date" : `${item.due_offset_days} day(s) ${item.due_offset_days < 0 ? "before" : "after"} the required onboard date`;
  }
  return item.due_offset_days === 0 ? "on the day the request is created" : `${item.due_offset_days} day(s) after the request is created`;
}

export default function TracksManager({
  clients,
  tracks,
  items,
  documentTypes,
}: {
  clients: ClientOpt[];
  tracks: TrackRow[];
  items: ChecklistTemplateItemRow[];
  documentTypes: DocTypeOpt[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<string>(ALL);
  const [creatingTrack, setCreatingTrack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string } | undefined>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      onOk?.();
      router.refresh();
    });
  };

  const visibleTracks = tracks.filter((t) => {
    if (filter === ALL) return true;
    if (filter === ORG_WIDE) return t.client_id === null;
    return t.client_id === filter;
  });

  return (
    <div>
      {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <select className={inputCls} style={inputStyle} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value={ALL}>All clients</option>
          <option value={ORG_WIDE}>Org-wide default (no client)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button onClick={() => setCreatingTrack((v) => !v)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">
          {creatingTrack ? "Cancel" : "+ New track"}
        </button>
      </div>

      {creatingTrack && (
        <div className={`${cardCls} p-4 mb-4`} style={cardStyle}>
          <TrackForm
            clients={clients}
            defaultClientId={filter !== ALL && filter !== ORG_WIDE ? filter : ""}
            onSubmit={(fd) => run(() => createTrack(fd), () => setCreatingTrack(false))}
            onCancel={() => setCreatingTrack(false)}
          />
        </div>
      )}

      {visibleTracks.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No tracks yet for this scope.</div>}

      <div className="space-y-5">
        {visibleTracks.map((track) => (
          <TrackCard
            key={track.id}
            track={track}
            clients={clients}
            documentTypes={documentTypes}
            items={items.filter((i) => i.track_id === track.id).sort((a, b) => a.sequence - b.sequence)}
            run={run}
          />
        ))}
      </div>
    </div>
  );
}

function TrackCard({
  track,
  clients,
  documentTypes,
  items,
  run,
}: {
  track: TrackRow;
  clients: ClientOpt[];
  documentTypes: DocTypeOpt[];
  items: ChecklistTemplateItemRow[];
  run: (fn: () => Promise<{ error?: string } | undefined>, onOk?: () => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      {editing ? (
        <TrackForm
          clients={clients}
          initial={track}
          onSubmit={(fd) => run(() => updateTrack(track.id, fd), () => setEditing(false))}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{track.name}</span>
          <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{track.client_name ?? "Org-wide default"}</span>
          {track.notice_days_override != null && (
            <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
              {track.notice_days_override}-day notice
            </span>
          )}
          {!track.is_active && (
            <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
              inactive
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setEditing(true)} className="text-xs font-semibold ch-link-navy">Edit</button>
            <button
              onClick={() => {
                if (window.confirm(`Delete track "${track.name}"?`)) run(() => deleteTrack(track.id));
              }}
              className="text-xs font-semibold"
              style={{ color: "var(--ch-fail)" }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {track.description && !editing && <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>{track.description}</div>}

      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>Checklist steps</div>
        {items.length === 0 && <div className="text-xs mb-2" style={{ color: "var(--ch-sub)" }}>No steps configured yet.</div>}
        <div className="space-y-1.5">
          {items.map((item) =>
            editingItemId === item.id ? (
              <div key={item.id} className="border rounded-lg p-3" style={{ borderColor: "var(--ch-line)" }}>
                <ItemForm
                  trackItems={items.filter((i) => i.id !== item.id)}
                  documentTypes={documentTypes}
                  initial={item}
                  onSubmit={(fd) => run(() => updateChecklistItem(item.id, fd), () => setEditingItemId(null))}
                  onCancel={() => setEditingItemId(null)}
                />
              </div>
            ) : (
              <div key={item.id} className="flex items-start gap-2 flex-wrap text-sm border rounded-lg px-2.5 py-1.5" style={{ borderColor: "var(--ch-line)" }}>
                <span className="text-[10px] font-mono rounded px-1 py-0.5 mt-0.5" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)" }}>
                  {item.sequence}
                </span>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium" style={{ color: "var(--ch-ink)" }}>
                    {item.title}
                    {item.is_parallel && <span className="ml-1 text-[10px]" style={{ color: "var(--ch-sub)" }}>(parallel)</span>}
                  </div>
                  {item.description && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{item.description}</div>}
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>Due: {dueRuleSummary(item, items)}</div>
                  {item.linked_document_type_id && (
                    <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                      Produces: {documentTypes.find((d) => d.id === item.linked_document_type_id)?.name ?? "—"}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingItemId(item.id)} className="text-xs font-semibold ch-link-navy">Edit</button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete step "${item.title}"?`)) run(() => deleteChecklistItem(item.id));
                    }}
                    className="text-xs font-semibold"
                    style={{ color: "var(--ch-fail)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          )}
        </div>

        {addingItem ? (
          <div className="border rounded-lg p-3 mt-2" style={{ borderColor: "var(--ch-line)" }}>
            <ItemForm
              trackItems={items}
              documentTypes={documentTypes}
              defaultSequence={items.length + 1}
              onSubmit={(fd) => run(() => createChecklistItem(track.id, fd), () => setAddingItem(false))}
              onCancel={() => setAddingItem(false)}
            />
          </div>
        ) : (
          <button onClick={() => setAddingItem(true)} className="text-xs font-semibold ch-link-navy mt-2">+ Add step</button>
        )}
      </div>
    </div>
  );
}

function TrackForm({
  clients,
  initial,
  defaultClientId,
  onSubmit,
  onCancel,
}: {
  clients: ClientOpt[];
  initial?: TrackRow;
  defaultClientId?: string;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [clientId, setClientId] = useState(initial?.client_id ?? defaultClientId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [noticeDaysOverride, setNoticeDaysOverride] = useState(initial?.notice_days_override != null ? String(initial.notice_days_override) : "");
  const [sortOrder, setSortOrder] = useState(initial ? String(initial.sort_order) : "0");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  const submit = () => {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("clientId", clientId);
    fd.set("description", description);
    fd.set("noticeDaysOverride", noticeDaysOverride);
    fd.set("sortOrder", sortOrder);
    if (isActive) fd.set("isActive", "on");
    onSubmit(fd);
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Track name (required)
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "New Joiner"' />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Client
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Org-wide default (no client)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Notice-period override (days)
          <input type="number" className={`${inputCls} w-full mt-1`} style={inputStyle} value={noticeDaysOverride} onChange={(e) => setNoticeDaysOverride(e.target.value)} placeholder="Falls back to the contract's own notice period if blank" />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Sort order
          <input type="number" className={`${inputCls} w-full mt-1`} style={inputStyle} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} rows={2} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      {initial && (
        <label className="flex items-center gap-1.5 text-xs mb-3" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
      )}
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {initial ? "Save track" : "Create track"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function ItemForm({
  trackItems,
  documentTypes,
  initial,
  defaultSequence,
  onSubmit,
  onCancel,
}: {
  trackItems: ChecklistTemplateItemRow[];
  documentTypes: DocTypeOpt[];
  initial?: ChecklistTemplateItemRow;
  defaultSequence?: number;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sequence, setSequence] = useState(String(initial?.sequence ?? defaultSequence ?? 1));
  const [isParallel, setIsParallel] = useState(initial?.is_parallel ?? false);
  const [dueBasis, setDueBasis] = useState<string>(initial?.due_basis ?? "request_created");
  const [dueOffsetDays, setDueOffsetDays] = useState(String(initial?.due_offset_days ?? 0));
  const [dueRelativeItemId, setDueRelativeItemId] = useState(initial?.due_relative_item_id ?? "");
  const [linkedDocumentTypeId, setLinkedDocumentTypeId] = useState(initial?.linked_document_type_id ?? "");

  const submit = () => {
    if (!title.trim()) return;
    if (dueBasis === "relative_to_item" && !dueRelativeItemId) return;
    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("description", description);
    fd.set("sequence", sequence);
    if (isParallel) fd.set("isParallel", "on");
    fd.set("dueBasis", dueBasis);
    fd.set("dueOffsetDays", dueOffsetDays);
    fd.set("dueRelativeItemId", dueRelativeItemId);
    fd.set("linkedDocumentTypeId", linkedDocumentTypeId);
    onSubmit(fd);
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Step title (required)
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Sequence
          <input type="number" className={`${inputCls} w-full mt-1`} style={inputStyle} value={sequence} onChange={(e) => setSequence(e.target.value)} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} rows={2} placeholder="Description / instructions (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Due date is based on
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={dueBasis} onChange={(e) => setDueBasis(e.target.value)}>
            <option value="request_created">Request created</option>
            <option value="required_onboard_date">Required onboard date</option>
            <option value="relative_to_item">Another step finishing</option>
          </select>
        </label>
        {dueBasis === "relative_to_item" ? (
          <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Relative to step
            <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={dueRelativeItemId} onChange={(e) => setDueRelativeItemId(e.target.value)}>
              <option value="">Choose…</option>
              {trackItems.map((i) => (
                <option key={i.id} value={i.id}>{i.title}</option>
              ))}
            </select>
          </label>
        ) : (
          <div />
        )}
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Offset (days, can be negative)
          <input type="number" className={`${inputCls} w-full mt-1`} style={inputStyle} value={dueOffsetDays} onChange={(e) => setDueOffsetDays(e.target.value)} />
        </label>
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        {dueOffsetDays} {DUE_BASIS_LABEL[dueBasis]}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Produces this document type (optional)
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={linkedDocumentTypeId} onChange={(e) => setLinkedDocumentTypeId(e.target.value)}>
            <option value="">—</option>
            {documentTypes.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs mt-5" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isParallel} onChange={(e) => setIsParallel(e.target.checked)} /> Runs in parallel with other steps
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!title.trim() || (dueBasis === "relative_to_item" && !dueRelativeItemId)}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {initial ? "Save step" : "Add step"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
