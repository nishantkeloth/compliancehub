"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createJobRole,
  updateJobRole,
  deleteJobRole,
  createSkill,
  deleteSkill,
  createRotationTemplate,
  updateRotationTemplate,
  deleteRotationTemplate,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  deleteCustomFieldDefinition,
} from "./actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";

type JobRole = { id: string; name: string; category: string | null; is_active: boolean };
type Skill = { id: string; name: string };
type RotationTemplate = {
  id: string;
  name: string;
  pattern_type: string;
  days_on: number | null;
  days_off: number | null;
  notes: string | null;
  is_active: boolean;
};
type DocumentType = {
  id: string;
  name: string;
  category: string | null;
  default_validity_months: number | null;
  warning_threshold_days: number | null;
  tracks_number: boolean;
  is_active: boolean;
};
type CustomFieldDefinition = {
  id: string;
  label: string;
  field_key: string;
  field_type: string;
  applies_to_document_type_id: string | null;
  sort_order: number;
  is_active: boolean;
};

const TABS = ["Job Roles", "Skills", "Rotation Templates", "Document Types", "Custom Fields"] as const;
type Tab = (typeof TABS)[number];

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="text-xs mt-1.5" style={{ color: "var(--ch-fail)" }}>
      {error}
    </div>
  );
}

function BgErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
      {error}
    </div>
  );
}

function SavingTag({ id }: { id: string }) {
  if (!isTempId(id)) return null;
  return (
    <span className="text-xs ml-2 italic" style={{ color: "var(--ch-sub)" }}>
      Saving…
    </span>
  );
}

function DeleteButton({ onConfirm, disabled, label }: { onConfirm: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      onClick={() => {
        if (!window.confirm(`Delete this ${label}?`)) return;
        onConfirm();
      }}
      disabled={disabled}
      className="text-xs font-semibold disabled:opacity-40"
      style={{ color: "var(--ch-fail)" }}
    >
      Delete
    </button>
  );
}

export default function SetupTabs({
  jobRoles,
  skills,
  rotationTemplates,
  documentTypes,
  customFieldDefinitions,
}: {
  jobRoles: JobRole[];
  skills: Skill[];
  rotationTemplates: RotationTemplate[];
  documentTypes: DocumentType[];
  customFieldDefinitions: CustomFieldDefinition[];
}) {
  const [tab, setTab] = useState<Tab>("Job Roles");

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-5 flex-wrap border-b pb-2" style={{ borderColor: "var(--ch-line)" }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3.5 py-2 rounded-lg text-sm font-semibold"
            style={
              tab === t
                ? { background: "var(--ch-navy)", color: "#fff" }
                : { color: "var(--ch-sub)" }
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Job Roles" && <JobRolesPanel jobRoles={jobRoles} />}
      {tab === "Skills" && <SkillsPanel skills={skills} />}
      {tab === "Rotation Templates" && <RotationTemplatesPanel templates={rotationTemplates} />}
      {tab === "Document Types" && <DocumentTypesPanel documentTypes={documentTypes} />}
      {tab === "Custom Fields" && (
        <CustomFieldDefinitionsPanel customFieldDefinitions={customFieldDefinitions} documentTypes={documentTypes} />
      )}
    </div>
  );
}

/* ================= Job Roles ================= */

function JobRolesPanel({ jobRoles }: { jobRoles: JobRole[] }) {
  const router = useRouter();
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(jobRoles);
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const add = () => {
    if (!name.trim()) return;
    setError(null);
    setBgError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("category", category.trim());
    const optimisticItem: JobRole = { id: tempId(), name: name.trim(), category: category.trim() || null, is_active: true };
    addOptimistic(optimisticItem);
    setName("");
    setCategory("");
    startTransition(async () => {
      const res = await createJobRole(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't add "${optimisticItem.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitUpdate = (role: JobRole, fd: FormData, patch: Partial<JobRole>) => {
    setBgError(null);
    updateOptimistic(role.id, patch);
    setEditingId(null);
    startTransition(async () => {
      const res = await updateJobRole(role.id, fd);
      if (res?.error) {
        updateOptimistic(role.id, role);
        setBgError(`Couldn't update "${role.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (role: JobRole, index: number) => {
    setBgError(null);
    removeOptimistic(role.id);
    startTransition(async () => {
      const res = await deleteJobRole(role.id);
      if (res?.error) {
        restoreOptimistic(role, index);
        setBgError(`Couldn't delete "${role.name}": ${res.error}`);
      }
    });
  };

  return (
    <div>
      <BgErrorBanner error={bgError} />
      <div className={`${cardCls} p-4 mb-4`} style={cardStyle}>
        <div className="flex items-center gap-2 flex-wrap">
          <input className={`${inputCls} flex-1 min-w-[160px]`} style={inputStyle} placeholder="Role name, e.g. Head Chef" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={`${inputCls} w-48`} style={inputStyle} placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <button onClick={add} disabled={!name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            + Add role
          </button>
        </div>
        <ErrorLine error={error} />
      </div>

      <div className="space-y-2">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No job roles yet.</div>}
        {items.map((r, i) =>
          editingId === r.id ? (
            <JobRoleEditRow key={r.id} role={r} onSubmit={(fd, patch) => submitUpdate(r, fd, patch)} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={r.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[160px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{r.name}</span>
                {r.category && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{r.category}</span>}
                {!r.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
                <SavingTag id={r.id} />
              </div>
              <button onClick={() => setEditingId(r.id)} disabled={isTempId(r.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onConfirm={() => submitDelete(r, i)} disabled={isTempId(r.id)} label="role" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function JobRoleEditRow({
  role,
  onSubmit,
  onCancel,
}: {
  role: JobRole;
  onSubmit: (fd: FormData, patch: Partial<JobRole>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [category, setCategory] = useState(role.category ?? "");
  const [isActive, setIsActive] = useState(role.is_active);
  const [submitted, setSubmitted] = useState(false);

  const save = () => {
    if (submitted) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("category", category.trim());
    if (isActive) fd.set("isActive", "on");
    setSubmitted(true);
    onSubmit(fd, { name: name.trim(), category: category.trim() || null, is_active: isActive });
  };

  return (
    <div className={`${cardCls} p-3`} style={cardStyle}>
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${inputCls} flex-1 min-w-[160px]`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        <input className={`${inputCls} w-48`} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        <button onClick={save} disabled={submitted} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================= Skills ================= */

function SkillsPanel({ skills }: { skills: Skill[] }) {
  const router = useRouter();
  const { items, addOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(skills);
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const add = () => {
    if (!name.trim()) return;
    setError(null);
    setBgError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    const optimisticItem: Skill = { id: tempId(), name: name.trim() };
    addOptimistic(optimisticItem);
    setName("");
    startTransition(async () => {
      const res = await createSkill(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't add "${optimisticItem.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (skill: Skill, index: number) => {
    setBgError(null);
    removeOptimistic(skill.id);
    startTransition(async () => {
      const res = await deleteSkill(skill.id);
      if (res?.error) {
        restoreOptimistic(skill, index);
        setBgError(`Couldn't delete "${skill.name}": ${res.error}`);
      }
    });
  };

  return (
    <div>
      <BgErrorBanner error={bgError} />
      <div className={`${cardCls} p-4 mb-4`} style={cardStyle}>
        <div className="flex items-center gap-2">
          <input className={`${inputCls} flex-1`} style={inputStyle} placeholder="Skill name, e.g. HACCP Certified" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button onClick={add} disabled={!name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            + Add skill
          </button>
        </div>
        <ErrorLine error={error} />
      </div>

      <div className="flex flex-wrap gap-2">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No skills yet.</div>}
        {items.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
            {s.name}
            {isTempId(s.id) ? (
              <span className="text-xs italic" style={{ color: "var(--ch-sub)" }}>…</span>
            ) : (
              <button onClick={() => submitDelete(s, i)} className="text-xs" style={{ color: "var(--ch-fail)" }} title="Delete">✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= Rotation Templates ================= */

function RotationTemplatesPanel({ templates }: { templates: RotationTemplate[] }) {
  const router = useRouter();
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(templates);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const submitCreate = (fd: FormData, optimisticItem: RotationTemplate) => {
    setBgError(null);
    addOptimistic(optimisticItem);
    setAdding(false);
    startTransition(async () => {
      const res = await createRotationTemplate(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't save "${optimisticItem.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitUpdate = (template: RotationTemplate, fd: FormData, patch: Partial<RotationTemplate>) => {
    setBgError(null);
    updateOptimistic(template.id, patch);
    setEditingId(null);
    startTransition(async () => {
      const res = await updateRotationTemplate(template.id, fd);
      if (res?.error) {
        updateOptimistic(template.id, template);
        setBgError(`Couldn't update "${template.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (template: RotationTemplate, index: number) => {
    setBgError(null);
    removeOptimistic(template.id);
    startTransition(async () => {
      const res = await deleteRotationTemplate(template.id);
      if (res?.error) {
        restoreOptimistic(template, index);
        setBgError(`Couldn't delete "${template.name}": ${res.error}`);
      }
    });
  };

  return (
    <div>
      <BgErrorBanner error={bgError} />
      {adding ? (
        <RotationTemplateForm onSubmit={(fd, values) => submitCreate(fd, { id: tempId(), ...values })} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add rotation pattern</button>
      )}

      <div className="space-y-2 mt-4">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No rotation patterns yet.</div>}
        {items.map((t, i) =>
          editingId === t.id ? (
            <RotationTemplateForm key={t.id} template={t} onSubmit={(fd, values) => submitUpdate(t, fd, values)} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={t.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[160px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{t.name}</span>
                <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
                  {t.days_on != null && t.days_off != null ? `${t.days_on}/${t.days_off}` : t.pattern_type.replace("_", " ")}
                </span>
                {!t.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
                <SavingTag id={t.id} />
              </div>
              <button onClick={() => setEditingId(t.id)} disabled={isTempId(t.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onConfirm={() => submitDelete(t, i)} disabled={isTempId(t.id)} label="rotation pattern" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function RotationTemplateForm({
  template,
  onSubmit,
  onCancel,
}: {
  template?: RotationTemplate;
  onSubmit: (fd: FormData, values: Omit<RotationTemplate, "id">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [patternType, setPatternType] = useState(template?.pattern_type ?? "fixed_equal");
  const [daysOn, setDaysOn] = useState(template?.days_on != null ? String(template.days_on) : "");
  const [daysOff, setDaysOff] = useState(template?.days_off != null ? String(template.days_off) : "");
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [submitted, setSubmitted] = useState(false);

  const showDays = patternType !== "custom";

  const save = () => {
    if (!name.trim() || submitted) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("patternType", patternType);
    fd.set("daysOn", showDays ? daysOn : "");
    fd.set("daysOff", showDays ? daysOff : "");
    fd.set("notes", notes.trim());
    if (isActive) fd.set("isActive", "on");
    setSubmitted(true);
    onSubmit(fd, {
      name: name.trim(),
      pattern_type: patternType,
      days_on: showDays && daysOn ? Number(daysOn) : null,
      days_off: showDays && daysOff ? Number(daysOff) : null,
      notes: notes.trim() || null,
      is_active: isActive,
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Name, e.g. 14/14" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={inputCls} style={inputStyle} value={patternType} onChange={(e) => setPatternType(e.target.value)}>
          <option value="fixed_equal">Fixed equal (X/X)</option>
          <option value="fixed_custom">Fixed custom (X/Y)</option>
          <option value="custom">Custom start/end dates</option>
        </select>
        {showDays && (
          <div className="flex gap-2">
            <input type="number" min={1} className={`${inputCls} w-full`} style={inputStyle} placeholder="Days on" value={daysOn} onChange={(e) => setDaysOn(e.target.value)} />
            <input type="number" min={1} className={`${inputCls} w-full`} style={inputStyle} placeholder="Days off" value={daysOff} onChange={(e) => setDaysOff(e.target.value)} />
          </div>
        )}
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs mr-auto" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        <button onClick={save} disabled={submitted || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}


/* ================= Document Types ================= */

const DOCUMENT_CATEGORIES = [
  { value: "visa", label: "Visa" },
  { value: "travel_document", label: "Travel document" },
  { value: "certificate", label: "Certificate" },
  { value: "vaccination", label: "Vaccination" },
];

function DocumentTypesPanel({ documentTypes }: { documentTypes: DocumentType[] }) {
  const router = useRouter();
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(documentTypes);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const submitCreate = (fd: FormData, optimisticItem: DocumentType) => {
    setBgError(null);
    addOptimistic(optimisticItem);
    setAdding(false);
    startTransition(async () => {
      const res = await createDocumentType(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't save "${optimisticItem.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitUpdate = (documentType: DocumentType, fd: FormData, patch: Partial<DocumentType>) => {
    setBgError(null);
    updateOptimistic(documentType.id, patch);
    setEditingId(null);
    startTransition(async () => {
      const res = await updateDocumentType(documentType.id, fd);
      if (res?.error) {
        updateOptimistic(documentType.id, documentType);
        setBgError(`Couldn't update "${documentType.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (documentType: DocumentType, index: number) => {
    setBgError(null);
    removeOptimistic(documentType.id);
    startTransition(async () => {
      const res = await deleteDocumentType(documentType.id);
      if (res?.error) {
        restoreOptimistic(documentType, index);
        setBgError(`Couldn't delete "${documentType.name}": ${res.error}`);
      }
    });
  };

  return (
    <div>
      <BgErrorBanner error={bgError} />
      {adding ? (
        <DocumentTypeForm onSubmit={(fd, values) => submitCreate(fd, { id: tempId(), ...values })} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add document type</button>
      )}

      <div className="space-y-2 mt-4">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No document types yet.</div>}
        {items.map((d, i) =>
          editingId === d.id ? (
            <DocumentTypeForm key={d.id} documentType={d} onSubmit={(fd, values) => submitUpdate(d, fd, values)} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={d.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[200px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{d.name}</span>
                {d.category && (
                  <span className="text-xs ml-2 uppercase font-semibold" style={{ color: "var(--ch-navy)" }}>
                    {DOCUMENT_CATEGORIES.find((c) => c.value === d.category)?.label ?? d.category}
                  </span>
                )}
                {d.default_validity_months != null && (
                  <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{d.default_validity_months}mo validity</span>
                )}
                {!d.tracks_number && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>No document number</span>}
                {!d.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
                <SavingTag id={d.id} />
              </div>
              <button onClick={() => setEditingId(d.id)} disabled={isTempId(d.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onConfirm={() => submitDelete(d, i)} disabled={isTempId(d.id)} label="document type" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function DocumentTypeForm({
  documentType,
  onSubmit,
  onCancel,
}: {
  documentType?: DocumentType;
  onSubmit: (fd: FormData, values: Omit<DocumentType, "id">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(documentType?.name ?? "");
  const [category, setCategory] = useState(documentType?.category ?? "certificate");
  const [defaultValidityMonths, setDefaultValidityMonths] = useState(
    documentType?.default_validity_months != null ? String(documentType.default_validity_months) : ""
  );
  const [warningThresholdDays, setWarningThresholdDays] = useState(
    documentType?.warning_threshold_days != null ? String(documentType.warning_threshold_days) : ""
  );
  const [tracksNumber, setTracksNumber] = useState(documentType?.tracks_number ?? true);
  const [isActive, setIsActive] = useState(documentType?.is_active ?? true);
  const [submitted, setSubmitted] = useState(false);

  const save = () => {
    if (!name.trim() || submitted) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("category", category);
    fd.set("defaultValidityMonths", defaultValidityMonths);
    fd.set("warningThresholdDays", warningThresholdDays);
    if (tracksNumber) fd.set("tracksNumber", "on");
    if (isActive) fd.set("isActive", "on");
    setSubmitted(true);
    onSubmit(fd, {
      name: name.trim(),
      category,
      default_validity_months: defaultValidityMonths ? Number(defaultValidityMonths) : null,
      warning_threshold_days: warningThresholdDays ? Number(warningThresholdDays) : null,
      tracks_number: tracksNumber,
      is_active: isActive,
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Document type name, e.g. STCW" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={inputCls} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Default validity (months)
          <input type="number" min={1} className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. 60" value={defaultValidityMonths} onChange={(e) => setDefaultValidityMonths(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Warning threshold (days before expiry)
          <input type="number" min={1} className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. 75" value={warningThresholdDays} onChange={(e) => setWarningThresholdDays(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-4 mb-3">
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={tracksNumber} onChange={(e) => setTracksNumber(e.target.checked)} /> Has a document number
        </label>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================= Custom Field Definitions ================= */

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
];

function CustomFieldDefinitionsPanel({
  customFieldDefinitions,
  documentTypes,
}: {
  customFieldDefinitions: CustomFieldDefinition[];
  documentTypes: DocumentType[];
}) {
  const router = useRouter();
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(customFieldDefinitions);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const appliesToLabel = (id: string | null) => (id ? documentTypes.find((t) => t.id === id)?.name ?? "—" : "All document types");

  const submitCreate = (fd: FormData, optimisticItem: CustomFieldDefinition) => {
    setBgError(null);
    addOptimistic(optimisticItem);
    setAdding(false);
    startTransition(async () => {
      const res = await createCustomFieldDefinition(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't save "${optimisticItem.label}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitUpdate = (definition: CustomFieldDefinition, fd: FormData, patch: Partial<CustomFieldDefinition>) => {
    setBgError(null);
    updateOptimistic(definition.id, patch);
    setEditingId(null);
    startTransition(async () => {
      const res = await updateCustomFieldDefinition(definition.id, fd);
      if (res?.error) {
        updateOptimistic(definition.id, definition);
        setBgError(`Couldn't update "${definition.label}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (definition: CustomFieldDefinition, index: number) => {
    setBgError(null);
    removeOptimistic(definition.id);
    startTransition(async () => {
      const res = await deleteCustomFieldDefinition(definition.id);
      if (res?.error) {
        restoreOptimistic(definition, index);
        setBgError(`Couldn't delete "${definition.label}": ${res.error}`);
      }
    });
  };

  return (
    <div>
      <p className="text-sm mb-4" style={{ color: "var(--ch-sub)" }}>
        Org-defined attributes for documents & certifications — beyond the standard document
        number, issue/expiry dates and sponsor. A field defined here shows up automatically in
        every relevant document's edit form, no code change needed.
      </p>
      <BgErrorBanner error={bgError} />
      {adding ? (
        <CustomFieldDefinitionForm
          documentTypes={documentTypes}
          onSubmit={(fd, values) => submitCreate(fd, { id: tempId(), field_key: "", sort_order: 0, ...values })}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add custom field</button>
      )}

      <div className="space-y-2 mt-4">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No custom fields defined yet.</div>}
        {items.map((f, i) =>
          editingId === f.id ? (
            <CustomFieldDefinitionForm
              key={f.id}
              definition={f}
              documentTypes={documentTypes}
              onSubmit={(fd, values) => submitUpdate(f, fd, values)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={f.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[200px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{f.label}</span>
                <span className="text-xs ml-2 uppercase font-semibold" style={{ color: "var(--ch-navy)" }}>
                  {FIELD_TYPES.find((t) => t.value === f.field_type)?.label ?? f.field_type}
                </span>
                <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{appliesToLabel(f.applies_to_document_type_id)}</span>
                {!f.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
                <SavingTag id={f.id} />
              </div>
              <button onClick={() => setEditingId(f.id)} disabled={isTempId(f.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onConfirm={() => submitDelete(f, i)} disabled={isTempId(f.id)} label="custom field" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function CustomFieldDefinitionForm({
  definition,
  documentTypes,
  onSubmit,
  onCancel,
}: {
  definition?: CustomFieldDefinition;
  documentTypes: DocumentType[];
  onSubmit: (fd: FormData, values: Omit<CustomFieldDefinition, "id" | "field_key" | "sort_order">) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(definition?.label ?? "");
  const [fieldType, setFieldType] = useState(definition?.field_type ?? "text");
  const [appliesTo, setAppliesTo] = useState(definition?.applies_to_document_type_id ?? "");
  const [isActive, setIsActive] = useState(definition?.is_active ?? true);
  const [submitted, setSubmitted] = useState(false);

  const save = () => {
    if (!label.trim() || submitted) return;
    const fd = new FormData();
    fd.set("label", label.trim());
    fd.set("fieldType", fieldType);
    fd.set("appliesToDocumentTypeId", appliesTo);
    if (isActive) fd.set("isActive", "on");
    setSubmitted(true);
    onSubmit(fd, {
      label: label.trim(),
      field_type: fieldType,
      applies_to_document_type_id: appliesTo || null,
      is_active: isActive,
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Field label, e.g. Issuing Authority" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className={inputCls} style={inputStyle} value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
          {FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select className={inputCls} style={inputStyle} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
          <option value="">All document types</option>
          {documentTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name} only</option>
          ))}
        </select>
      </div>
      {definition && (
        <label className="flex items-center gap-1.5 text-xs mb-3" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
      )}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !label.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
