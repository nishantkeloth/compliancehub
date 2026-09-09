"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateTemplateMeta,
  addSection,
  renameSection,
  deleteSection,
  moveSection,
  addItem,
  updateItem,
  deleteItem,
  moveItem,
} from "../actions";

type Item = {
  id: string;
  prompt: string;
  sortOrder: number;
  maxMarks: number | null;
  responseType: string;
  riskLevel: string | null;
  requiresPhotoOnFail: boolean;
};
type Section = { id: string; title: string; sortOrder: number; items: Item[] };
type Meta = { code: string; name: string; revision: string; scoringType: string; status: string };

export default function TemplateEditor({
  templateId,
  initialMeta,
  initialSections,
}: {
  templateId: string;
  initialMeta: Meta;
  initialSections: Section[];
}) {
  const router = useRouter();
  const scored = initialMeta.scoringType === "scored";
  const refresh = () => router.refresh();

  return (
    <div className="mt-4">
      <TemplateMetaForm templateId={templateId} meta={initialMeta} onSaved={refresh} />

      <div className="mt-6 space-y-4">
        {initialSections.map((s, i) => (
          <SectionCard
            key={s.id}
            section={s}
            templateId={templateId}
            scored={scored}
            isFirst={i === 0}
            isLast={i === initialSections.length - 1}
            onChanged={refresh}
          />
        ))}
        {initialSections.length === 0 && (
          <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
            No sections yet — add one below to start building this checklist.
          </div>
        )}
      </div>

      <AddSectionForm templateId={templateId} onAdded={refresh} />
    </div>
  );
}

function TemplateMetaForm({
  templateId,
  meta,
  onSaved,
}: {
  templateId: string;
  meta: Meta;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(meta.code);
  const [name, setName] = useState(meta.name);
  const [revision, setRevision] = useState(meta.revision);
  const [status, setStatus] = useState(meta.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    code !== meta.code || name !== meta.name || revision !== meta.revision || status !== meta.status;

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("code", code.trim());
    fd.set("name", name.trim());
    fd.set("revision", revision.trim() || "00");
    fd.set("scoringType", meta.scoringType); // fixed — not editable from this form
    fd.set("status", status);
    startTransition(async () => {
      const res = await updateTemplateMeta(templateId, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <input
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code"
        />
        <input
          className="border rounded-lg px-3 py-2 text-sm sm:col-span-2"
          style={{ borderColor: "var(--ch-line)" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
      </div>
      <div className="flex items-center gap-4 flex-wrap text-sm" style={{ color: "var(--ch-ink)" }}>
        <label className="flex items-center gap-1.5">
          Revision
          <input
            className="border rounded-lg px-2 py-1 text-sm w-16"
            style={{ borderColor: "var(--ch-line)" }}
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5">
          Status
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            style={{ borderColor: "var(--ch-line)" }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
          {meta.scoringType === "scored" ? "Scored" : "Checklist"} · scoring type is fixed at creation
        </span>
        {dirty && (
          <button
            onClick={submit}
            disabled={pending || !code.trim() || !name.trim()}
            className="ch-btn-primary rounded-lg px-4 py-1.5 text-sm font-semibold ml-auto disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {error && (
        <div className="text-sm mt-2" style={{ color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  section,
  templateId,
  scored,
  isFirst,
  isLast,
  onChanged,
}: {
  section: Section;
  templateId: string;
  scored: boolean;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(section.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const saveTitle = () => {
    if (!title.trim() || title === section.title) {
      setEditingTitle(false);
      setTitle(section.title);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await renameSection(section.id, templateId, title);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setEditingTitle(false);
      onChanged();
    });
  };

  const remove = () => {
    if (
      !window.confirm(
        `Delete section "${section.title}"${section.items.length ? ` and its ${section.items.length} item(s)` : ""}?`
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteSection(section.id, templateId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onChanged();
    });
  };

  const move = (direction: "up" | "down") => {
    startTransition(async () => {
      await moveSection(section.id, templateId, direction);
      onChanged();
    });
  };

  return (
    <div className="bg-white border rounded-xl overflow-hidden" style={{ borderColor: "var(--ch-line)" }}>
      <div className="px-4 py-2.5 flex items-center gap-2 text-white" style={{ background: "var(--ch-navy)" }}>
        {editingTitle ? (
          <input
            autoFocus
            className="flex-1 rounded px-2 py-1 text-sm text-black"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && saveTitle()}
          />
        ) : (
          <div
            className="flex-1 text-sm font-bold tracking-wide cursor-pointer"
            onClick={() => setEditingTitle(true)}
            title="Click to rename"
          >
            {section.title}
          </div>
        )}
        <button onClick={() => move("up")} disabled={isFirst || pending} className="text-xs disabled:opacity-30" title="Move up">
          ▲
        </button>
        <button onClick={() => move("down")} disabled={isLast || pending} className="text-xs disabled:opacity-30" title="Move down">
          ▼
        </button>
        <button onClick={remove} disabled={pending} className="text-xs disabled:opacity-30" title="Delete section">
          ✕
        </button>
      </div>

      {error && (
        <div className="text-sm px-4 py-2" style={{ color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}

      {section.items.map((it, i) => (
        <ItemRow
          key={it.id}
          item={it}
          templateId={templateId}
          sectionId={section.id}
          scored={scored}
          isFirst={i === 0}
          isLast={i === section.items.length - 1}
          onChanged={onChanged}
        />
      ))}

      <AddItemForm sectionId={section.id} templateId={templateId} scored={scored} onAdded={onChanged} />
    </div>
  );
}

function ItemRow({
  item,
  templateId,
  sectionId,
  scored,
  isFirst,
  isLast,
  onChanged,
}: {
  item: Item;
  templateId: string;
  sectionId: string;
  scored: boolean;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(item.prompt);
  const [maxMarks, setMaxMarks] = useState(String(item.maxMarks ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!prompt.trim()) {
      setError("Prompt is required.");
      return;
    }
    if (scored && (!maxMarks || Number(maxMarks) < 1)) {
      setError("Max marks must be at least 1.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("prompt", prompt.trim());
    fd.set("responseType", scored ? "score" : "tri_state");
    if (scored) fd.set("maxMarks", maxMarks);
    startTransition(async () => {
      const res = await updateItem(item.id, templateId, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  };

  const remove = () => {
    if (!window.confirm("Delete this item?")) return;
    startTransition(async () => {
      const res = await deleteItem(item.id, templateId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      onChanged();
    });
  };

  const move = (direction: "up" | "down") => {
    startTransition(async () => {
      await moveItem(item.id, sectionId, templateId, direction);
      onChanged();
    });
  };

  if (editing) {
    return (
      <div className="px-4 py-3 border-t" style={{ borderColor: "var(--ch-line)" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            autoFocus
            className="flex-1 border rounded-lg px-2 py-1.5 text-sm min-w-[200px]"
            style={{ borderColor: "var(--ch-line)" }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {scored && (
            <input
              type="number"
              min={1}
              className="border rounded-lg px-2 py-1.5 text-sm w-20"
              style={{ borderColor: "var(--ch-line)" }}
              placeholder="Max marks"
              value={maxMarks}
              onChange={(e) => setMaxMarks(e.target.value)}
            />
          )}
          <button
            onClick={save}
            disabled={pending}
            className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setPrompt(item.prompt);
              setMaxMarks(String(item.maxMarks ?? ""));
              setError(null);
            }}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold border"
            style={{ borderColor: "var(--ch-line)" }}
          >
            Cancel
          </button>
        </div>
        {error && (
          <div className="text-xs mt-1.5" style={{ color: "var(--ch-fail)" }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-2.5 border-t flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--ch-line)" }}>
      <div
        className="flex-1 text-sm min-w-[200px] cursor-pointer"
        style={{ color: "var(--ch-ink)" }}
        onClick={() => setEditing(true)}
        title="Click to edit"
      >
        {item.prompt}
        {scored && (
          <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
            ({item.maxMarks} marks)
          </span>
        )}
      </div>
      <button
        onClick={() => move("up")}
        disabled={isFirst || pending}
        className="text-xs disabled:opacity-30"
        style={{ color: "var(--ch-sub)" }}
        title="Move up"
      >
        ▲
      </button>
      <button
        onClick={() => move("down")}
        disabled={isLast || pending}
        className="text-xs disabled:opacity-30"
        style={{ color: "var(--ch-sub)" }}
        title="Move down"
      >
        ▼
      </button>
      <button
        onClick={remove}
        disabled={pending}
        className="text-xs disabled:opacity-30"
        style={{ color: "var(--ch-fail)" }}
        title="Delete item"
      >
        ✕
      </button>
    </div>
  );
}

function AddItemForm({
  sectionId,
  templateId,
  scored,
  onAdded,
}: {
  sectionId: string;
  templateId: string;
  scored: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [maxMarks, setMaxMarks] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!prompt.trim()) return;
    if (scored && (!maxMarks || Number(maxMarks) < 1)) {
      setError("Max marks must be at least 1.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("prompt", prompt.trim());
    fd.set("responseType", scored ? "score" : "tri_state");
    if (scored) fd.set("maxMarks", maxMarks);
    startTransition(async () => {
      const res = await addItem(sectionId, templateId, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setPrompt("");
      setOpen(false);
      onAdded();
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-4 py-2.5 border-t text-sm font-semibold"
        style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
      >
        + Add item
      </button>
    );
  }

  return (
    <div className="px-4 py-3 border-t" style={{ borderColor: "var(--ch-line)" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          autoFocus
          className="flex-1 border rounded-lg px-2 py-1.5 text-sm min-w-[200px]"
          style={{ borderColor: "var(--ch-line)" }}
          placeholder="Item prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {scored && (
          <input
            type="number"
            min={1}
            className="border rounded-lg px-2 py-1.5 text-sm w-20"
            style={{ borderColor: "var(--ch-line)" }}
            value={maxMarks}
            onChange={(e) => setMaxMarks(e.target.value)}
          />
        )}
        <button
          onClick={submit}
          disabled={pending || !prompt.trim()}
          className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold border"
          style={{ borderColor: "var(--ch-line)" }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="text-xs mt-1.5" style={{ color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function AddSectionForm({ templateId, onAdded }: { templateId: string; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!title.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("title", title.trim());
    startTransition(async () => {
      const res = await addSection(templateId, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setTitle("");
      onAdded();
    });
  };

  return (
    <div className="mt-4 flex items-center gap-2 flex-wrap">
      <input
        className="flex-1 border rounded-lg px-3 py-2 text-sm min-w-[200px]"
        style={{ borderColor: "var(--ch-line)" }}
        placeholder="New section title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button
        onClick={submit}
        disabled={pending || !title.trim()}
        className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add section"}
      </button>
      {error && (
        <span className="text-xs" style={{ color: "var(--ch-fail)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
