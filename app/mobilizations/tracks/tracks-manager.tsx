"use client";

// Phase 12 admin screen — configure a client's mobilization tracks
// (onboarding pathways, e.g. "New Joiner" vs "Returning Crew") and each
// track's ordered checklist of steps. Deliberately client-agnostic:
// nothing here is specific to any one client's process — an admin
// types in whatever a client's flow actually requires. See
// claude/phase12-adnoc-mobilization-flow-scope.md.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTrack,
  updateTrack,
  deleteTrack,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  setChecklistItemActive,
  type TrackRow,
  type ChecklistTemplateItemRow,
} from "../tracks-actions";
import { VISA_TYPES, VISA_LABEL } from "../visa-types";

type DocTypeOpt = { id: string; name: string };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

const DUE_BASIS_LABEL: Record<string, string> = {
  request_created: "days after the request is created",
  required_onboard_date: "days relative to the required onboard date",
  planned_arrival_date: "days relative to the person's planned arrival date",
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
  if (item.due_basis === "planned_arrival_date") {
    return item.due_offset_days === 0 ? "on the planned arrival date" : `${Math.abs(item.due_offset_days)} day(s) ${item.due_offset_days < 0 ? "before" : "after"} the planned arrival date`;
  }
  return item.due_offset_days === 0 ? "on the day the request is created" : `${item.due_offset_days} day(s) after the request is created`;
}

export default function TracksManager({
  tracks,
  items,
  documentTypes,
}: {
  tracks: TrackRow[];
  items: ChecklistTemplateItemRow[];
  documentTypes: DocTypeOpt[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creatingTrack, setCreatingTrack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks start collapsed. A track that appears after the first render
  // (one just created) opens by itself so steps can be added straight away.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set(tracks.map((t) => t.id)));
  useEffect(() => {
    const fresh = tracks.filter((t) => !knownIds.current.has(t.id)).map((t) => t.id);
    if (fresh.length === 0) return;
    for (const id of fresh) knownIds.current.add(id);
    setOpenIds((cur) => new Set([...cur, ...fresh]));
  }, [tracks]);
  const toggleTrack = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const visibleTracks = tracks;

  return (
    <div>
      {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button onClick={() => setCreatingTrack((v) => !v)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">
          {creatingTrack ? "Cancel" : "+ New track"}
        </button>
        {tracks.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setOpenIds(new Set(tracks.map((t) => t.id)))} className="rounded-lg px-3 py-2 text-xs font-semibold border" style={{ borderColor: "var(--ch-line)" }}>
              Expand all
            </button>
            <button onClick={() => setOpenIds(new Set())} className="rounded-lg px-3 py-2 text-xs font-semibold border" style={{ borderColor: "var(--ch-line)" }}>
              Collapse all
            </button>
          </div>
        )}
      </div>

      {creatingTrack && (
        <div className={`${cardCls} p-4 mb-4`} style={cardStyle}>
          <TrackForm
            onSubmit={(fd) => run(() => createTrack(fd), () => setCreatingTrack(false))}
            onCancel={() => setCreatingTrack(false)}
          />
        </div>
      )}

      {visibleTracks.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No tracks yet. Click &ldquo;+ New track&rdquo; to add one.</div>}

      <div className="space-y-5">
        {visibleTracks.map((track) => (
          <TrackCard
            key={track.id}
            track={track}
            documentTypes={documentTypes}
            items={items.filter((i) => i.track_id === track.id).sort((a, b) => a.sequence - b.sequence)}
            run={run}
            open={openIds.has(track.id)}
            onToggle={() => toggleTrack(track.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TrackCard({
  track,
  documentTypes,
  items,
  run,
  open,
  onToggle,
}: {
  track: TrackRow;
  documentTypes: DocTypeOpt[];
  items: ChecklistTemplateItemRow[];
  run: (fn: () => Promise<{ error?: string } | undefined>, onOk?: () => void) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      {editing ? (
        <TrackForm
          initial={track}
          onSubmit={(fd) => run(() => updateTrack(track.id, fd), () => setEditing(false))}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-2 flex-1 min-w-[200px] text-left"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="w-4 h-4 shrink-0" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", color: "var(--ch-sub)" }}>
              <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{track.name}</span>
            <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
              {items.length} step{items.length === 1 ? "" : "s"}
            </span>
            {!track.is_active && (
              <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
                inactive
              </span>
            )}
          </button>
          <div className="flex items-center gap-2">
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
      {open && !editing && (
        <div className="mt-2">
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
              <div key={item.id} className="flex items-start gap-2 flex-wrap text-sm border rounded-lg px-2.5 py-1.5" style={{ borderColor: "var(--ch-line)", opacity: item.is_active ? 1 : 0.55 }}>
                <span className="text-[10px] font-mono rounded px-1 py-0.5 mt-0.5" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)" }}>
                  {item.sequence}
                </span>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium" style={{ color: "var(--ch-ink)" }}>
                    {item.title}
                    {item.is_parallel && <span className="ml-1 text-[10px]" style={{ color: "var(--ch-sub)" }}>(parallel)</span>}
                    {!item.is_active && <span className="ml-1 text-[10px] font-bold uppercase" style={{ color: "var(--ch-sub)" }}>Off</span>}
                  </div>
                  {item.description && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{item.description}</div>}
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>Due: {dueRuleSummary(item, items)}</div>
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    Visa: {item.visa_types && item.visa_types.length > 0 ? item.visa_types.map((v) => VISA_LABEL[v] ?? v).join(", ") : "all types"}
                  </div>
                  {item.linked_document_type_id && (
                    <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                      Produces: {documentTypes.find((d) => d.id === item.linked_document_type_id)?.name ?? "—"}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => run(() => setChecklistItemActive(item.id, !item.is_active))}
                    className="text-xs font-semibold ch-link-navy"
                  >
                    {item.is_active ? "Turn off" : "Turn on"}
                  </button>
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
      )}
    </div>
  );
}

function TrackForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: TrackRow;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  const submit = () => {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("description", description);
    if (isActive) fd.set("isActive", "on");
    onSubmit(fd);
  };

  return (
    <div>
      <label className="block text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        Track name (required)
        <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "New Joiner"' />
      </label>
      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Description
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
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
  const [visaTypes, setVisaTypes] = useState<string[]>(initial?.visa_types ?? []);

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
    for (const v of visaTypes) fd.append("visaTypes", v);
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
      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Description / instructions
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Due date is based on
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={dueBasis} onChange={(e) => setDueBasis(e.target.value)}>
            <option value="request_created">Request created</option>
            <option value="required_onboard_date">Required onboard date</option>
            <option value="planned_arrival_date">Planned arrival date (per person)</option>
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
      <div className="mb-3">
        <div className="text-xs mb-1" style={{ color: "var(--ch-sub)" }}>Applies to visa types (none ticked = every visa type)</div>
        <div className="flex items-center gap-3 flex-wrap">
          {VISA_TYPES.map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
              <input
                type="checkbox"
                checked={visaTypes.includes(v)}
                onChange={(e) => setVisaTypes((cur) => (e.target.checked ? [...cur, v] : cur.filter((x) => x !== v)))}
              />
              {VISA_LABEL[v]}
            </label>
          ))}
        </div>
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
