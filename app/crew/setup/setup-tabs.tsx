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
  createJobRoleDocumentRequirement,
  updateJobRoleDocumentRequirement,
  deleteJobRoleDocumentRequirement,
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
type Client = { id: string; name: string };
type DocRequirement = {
  id: string;
  job_role_id: string;
  client_id: string | null;
  document_type_id: string;
  is_mandatory: boolean;
  minimum_remaining_validity_days: number | null;
  is_excluded: boolean;
  sort_order: number;
};

const TABS = ["Job Roles", "Skills", "Rotation Templates", "Document Types", "Document Requirements", "Custom Fields"] as const;
type Tab = (typeof TABS)[number];

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

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
  clients,
  documentRequirements,
}: {
  jobRoles: JobRole[];
  skills: Skill[];
  rotationTemplates: RotationTemplate[];
  documentTypes: DocumentType[];
  customFieldDefinitions: CustomFieldDefinition[];
  clients: Client[];
  documentRequirements: DocRequirement[];
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
      {tab === "Document Requirements" && (
        <DocumentRequirementsPanel jobRoles={jobRoles} documentTypes={documentTypes} clients={clients} documentRequirements={documentRequirements} />
      )}
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
        <div className="flex items-end gap-2 flex-wrap">
          <label className={`${lbl} flex-1 min-w-[160px]`} style={lblStyle}>
            Role name
            <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. Head Chef" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={lbl} style={lblStyle}>
            Category (optional)
            <input className={`${inputCls} w-48 mt-1`} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
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
      <div className="flex items-end gap-2 flex-wrap">
        <label className={`${lbl} flex-1 min-w-[160px]`} style={lblStyle}>
          Role name
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Category
          <input className={`${inputCls} w-48 mt-1`} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
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
        <div className="flex items-end gap-2">
          <label className={`${lbl} flex-1`} style={lblStyle}>
            Skill name
            <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. HACCP Certified" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          </label>
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
        <label className={lbl} style={lblStyle}>
          Name
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. 14/14" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Pattern type
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={patternType} onChange={(e) => setPatternType(e.target.value)}>
            <option value="fixed_equal">Fixed equal (X/X)</option>
            <option value="fixed_custom">Fixed custom (X/Y)</option>
            <option value="custom">Custom start/end dates</option>
          </select>
        </label>
        {showDays && (
          <div className="flex gap-2">
            <label className={lbl} style={lblStyle}>
              Days on
              <input type="number" min={1} className={`${inputCls} w-full mt-1`} style={inputStyle} value={daysOn} onChange={(e) => setDaysOn(e.target.value)} />
            </label>
            <label className={lbl} style={lblStyle}>
              Days off
              <input type="number" min={1} className={`${inputCls} w-full mt-1`} style={inputStyle} value={daysOff} onChange={(e) => setDaysOff(e.target.value)} />
            </label>
          </div>
        )}
      </div>
      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Notes
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
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
        <label className={lbl} style={lblStyle}>
          Document type name
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. STCW" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Category
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
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
        <label className={lbl} style={lblStyle}>
          Field label
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. Issuing Authority" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Field type
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Applies to
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
            <option value="">All document types</option>
            {documentTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name} only</option>
            ))}
          </select>
        </label>
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

/* ================= Document Requirements (Phase 15) =================
   A job role's default required documents, pre-filled automatically onto
   every new crew matrix line for that role instead of being re-added by
   hand every time (app/crew/matrices/actions.ts's
   seedLineDocumentsFromTemplate). Optionally overridden per client — e.g.
   COVID vaccination required for Qatar clients but not others — via a row
   scoped to that client, which either replaces the org-wide default for
   that document type or, with "excluded", drops it for that client only. */

function DocumentRequirementsPanel({
  jobRoles,
  documentTypes,
  clients,
  documentRequirements,
}: {
  jobRoles: JobRole[];
  documentTypes: DocumentType[];
  clients: Client[];
  documentRequirements: DocRequirement[];
}) {
  const router = useRouter();
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(documentRequirements);
  const [, startTransition] = useTransition();
  const [bgError, setBgError] = useState<string | null>(null);
  const [roleId, setRoleId] = useState(jobRoles[0]?.id ?? "");
  const [clientId, setClientId] = useState(""); // "" = viewing/editing the org-wide default
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const docTypeName = (id: string) => documentTypes.find((d) => d.id === id)?.name ?? "—";
  const scoped = items
    .filter((r) => r.job_role_id === roleId && (r.client_id ?? "") === clientId)
    .sort((a, b) => a.sort_order - b.sort_order);
  const orgWideForRole = items.filter((r) => r.job_role_id === roleId && r.client_id === null);

  const submitCreate = (fd: FormData, optimisticItem: DocRequirement) => {
    setBgError(null);
    addOptimistic(optimisticItem);
    setAdding(false);
    startTransition(async () => {
      const res = await createJobRoleDocumentRequirement(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't add "${docTypeName(optimisticItem.document_type_id)}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitUpdate = (requirement: DocRequirement, fd: FormData, patch: Partial<DocRequirement>) => {
    setBgError(null);
    updateOptimistic(requirement.id, patch);
    setEditingId(null);
    startTransition(async () => {
      const res = await updateJobRoleDocumentRequirement(requirement.id, fd);
      if (res?.error) {
        updateOptimistic(requirement.id, requirement);
        setBgError(`Couldn't update "${docTypeName(requirement.document_type_id)}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (requirement: DocRequirement, index: number) => {
    setBgError(null);
    removeOptimistic(requirement.id);
    startTransition(async () => {
      const res = await deleteJobRoleDocumentRequirement(requirement.id);
      if (res?.error) {
        restoreOptimistic(requirement, index);
        setBgError(`Couldn't delete "${docTypeName(requirement.document_type_id)}": ${res.error}`);
      }
    });
  };

  return (
    <div>
      <p className="text-sm mb-4" style={{ color: "var(--ch-sub)" }}>
        A job role&apos;s default required documents — pre-filled automatically onto every new crew matrix line for
        that role, instead of adding each document by hand every time. Optionally override the default for one
        specific client below, e.g. a document only that client requires (or explicitly doesn&apos;t).
      </p>
      <BgErrorBanner error={bgError} />

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <select
          value={roleId}
          onChange={(e) => {
            setRoleId(e.target.value);
            setAdding(false);
            setEditingId(null);
          }}
          className={inputCls}
          style={inputStyle}
        >
          {jobRoles.length === 0 && <option value="">No job roles yet</option>}
          {jobRoles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setAdding(false);
            setEditingId(null);
          }}
          className={inputCls}
          style={inputStyle}
        >
          <option value="">Org-wide default</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name} override</option>
          ))}
        </select>
      </div>

      {!roleId ? (
        <div className="text-sm" style={{ color: "var(--ch-sub)" }}>Add a job role first, under the Job Roles tab.</div>
      ) : (
        <>
          {clientId && (
            <div className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
              Rows here apply only to {clients.find((c) => c.id === clientId)?.name ?? "this client"}, on top of the
              org-wide default below. Check &quot;excluded&quot; on a row to drop an org-wide document for this
              client only, rather than requiring it.
            </div>
          )}

          {adding ? (
            <RequirementForm
              jobRoleId={roleId}
              clientId={clientId || null}
              documentTypes={documentTypes}
              existing={scoped}
              onSubmit={(fd, values) => submitCreate(fd, { id: tempId(), ...values })}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">
              + Add document
            </button>
          )}

          <div className="space-y-2 mt-2">
            {scoped.length === 0 && (
              <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
                No documents configured for this {clientId ? "client override" : "role"} yet.
              </div>
            )}
            {scoped.map((r, i) =>
              editingId === r.id ? (
                <RequirementForm
                  key={r.id}
                  jobRoleId={roleId}
                  clientId={clientId || null}
                  documentTypes={documentTypes}
                  existing={scoped}
                  requirement={r}
                  onSubmit={(fd, values) => submitUpdate(r, fd, values)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div key={r.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
                  <div className="flex-1 min-w-[200px]">
                    <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>
                      {docTypeName(r.document_type_id)}
                      {r.is_mandatory && !r.is_excluded && " *"}
                    </span>
                    {r.minimum_remaining_validity_days != null && (
                      <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
                        min {r.minimum_remaining_validity_days}d remaining
                      </span>
                    )}
                    {r.is_excluded && (
                      <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Excluded for this client</span>
                    )}
                    <SavingTag id={r.id} />
                  </div>
                  <button onClick={() => setEditingId(r.id)} disabled={isTempId(r.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-navy)" }}>
                    Edit
                  </button>
                  <DeleteButton onConfirm={() => submitDelete(r, i)} disabled={isTempId(r.id)} label="requirement" />
                </div>
              )
            )}
          </div>

          {clientId && (
            <div className="mt-6">
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
                Org-wide default for this role (for reference)
              </div>
              {orgWideForRole.length === 0 && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No org-wide default set.</div>}
              {orgWideForRole.map((r) => (
                <div key={r.id} className="text-xs py-1" style={{ color: "var(--ch-sub)" }}>
                  {docTypeName(r.document_type_id)}{r.is_mandatory ? " *" : ""}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RequirementForm({
  jobRoleId,
  clientId,
  documentTypes,
  existing,
  requirement,
  onSubmit,
  onCancel,
}: {
  jobRoleId: string;
  clientId: string | null;
  documentTypes: DocumentType[];
  existing: DocRequirement[];
  requirement?: DocRequirement;
  onSubmit: (fd: FormData, values: Omit<DocRequirement, "id">) => void;
  onCancel: () => void;
}) {
  const usedDocTypeIds = new Set(existing.filter((e) => e.id !== requirement?.id).map((e) => e.document_type_id));
  const availableDocTypes = requirement ? documentTypes : documentTypes.filter((d) => !usedDocTypeIds.has(d.id));
  const [documentTypeId, setDocumentTypeId] = useState(requirement?.document_type_id ?? availableDocTypes[0]?.id ?? "");
  const [isMandatory, setIsMandatory] = useState(requirement?.is_mandatory ?? true);
  const [minValidity, setMinValidity] = useState(
    requirement?.minimum_remaining_validity_days != null ? String(requirement.minimum_remaining_validity_days) : ""
  );
  const [isExcluded, setIsExcluded] = useState(requirement?.is_excluded ?? false);
  const [submitted, setSubmitted] = useState(false);

  const save = () => {
    if (!documentTypeId || submitted) return;
    const fd = new FormData();
    fd.set("jobRoleId", jobRoleId);
    if (clientId) fd.set("clientId", clientId);
    fd.set("documentTypeId", documentTypeId);
    fd.set("isMandatory", isMandatory ? "on" : "off");
    fd.set("minimumRemainingValidityDays", minValidity);
    if (isExcluded) fd.set("isExcluded", "on");
    fd.set("sortOrder", String(requirement?.sort_order ?? existing.length));
    setSubmitted(true);
    onSubmit(fd, {
      job_role_id: jobRoleId,
      client_id: clientId,
      document_type_id: documentTypeId,
      is_mandatory: isMandatory,
      minimum_remaining_validity_days: minValidity ? Number(minValidity) : null,
      is_excluded: isExcluded,
      sort_order: requirement?.sort_order ?? existing.length,
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className={lbl} style={lblStyle}>
          Document type
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={documentTypeId} onChange={(e) => setDocumentTypeId(e.target.value)} disabled={!!requirement}>
            {availableDocTypes.length === 0 && <option value="">No document types left to add</option>}
            {availableDocTypes.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Min remaining validity (days, optional)
          <input
            type="number"
            className={`${inputCls} w-full mt-1`}
            style={inputStyle}
            value={minValidity}
            onChange={(e) => setMinValidity(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} /> Mandatory
        </label>
      </div>
      {clientId && (
        <label className="flex items-center gap-1.5 text-xs mb-3" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isExcluded} onChange={(e) => setIsExcluded(e.target.checked)} /> This client does NOT need this
          document (excludes the org-wide default instead of overriding it)
        </label>
      )}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !documentTypeId} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
