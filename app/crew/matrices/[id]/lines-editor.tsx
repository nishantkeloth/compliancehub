"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCrewMatrixLine,
  updateCrewMatrixLine,
  deleteCrewMatrixLine,
  copyCrewMatrixLine,
  reorderCrewMatrixLines,
  addLineSkill,
  removeLineSkill,
  addLineDocument,
  updateLineDocument,
  removeLineDocument,
  addLineCompetency,
  removeLineCompetency,
  addLineClientRequirement,
  removeLineClientRequirement,
} from "../actions";

export type Ref = { id: string; name: string };
export type Line = {
  id: string;
  line_number: number;
  job_role_id: string;
  job_role_name: string;
  required_headcount: number;
  day_shift_quantity: number | null;
  night_shift_quantity: number | null;
  other_shift_quantity: number | null;
  rotation_template_id: string | null;
  rotation_template_name: string | null;
  employment_type_preference: string | null;
  nationality_preference: string | null;
  language_requirement: string | null;
  minimum_experience_years: number | null;
  mobilization_lead_days: number | null;
  client_approval_required: boolean;
  remarks: string | null;
  sort_order: number;
  skills: { id: string; skill_id: string; name: string }[];
  documents: { id: string; document_type_id: string; name: string; minimum_remaining_validity_days: number | null; is_mandatory: boolean; waiver_permitted: boolean }[];
  competencies: { id: string; competency_name: string; minimum_grade: string | null; notes: string | null }[];
  clientRequirements: { id: string; requirement_text: string; is_mandatory: boolean }[];
};

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

type LineFormValues = {
  jobRoleId: string;
  requiredHeadcount: string;
  dayShiftQuantity: string;
  nightShiftQuantity: string;
  otherShiftQuantity: string;
  rotationTemplateId: string;
  employmentTypePreference: string;
  nationalityPreference: string;
  languageRequirement: string;
  minimumExperienceYears: string;
  mobilizationLeadDays: string;
  clientApprovalRequired: boolean;
  remarks: string;
};

const emptyLineForm = (jobRoles: Ref[]): LineFormValues => ({
  jobRoleId: jobRoles[0]?.id ?? "",
  requiredHeadcount: "1",
  dayShiftQuantity: "",
  nightShiftQuantity: "",
  otherShiftQuantity: "",
  rotationTemplateId: "",
  employmentTypePreference: "",
  nationalityPreference: "",
  languageRequirement: "",
  minimumExperienceYears: "",
  mobilizationLeadDays: "",
  clientApprovalRequired: false,
  remarks: "",
});

const lineToForm = (l: Line): LineFormValues => ({
  jobRoleId: l.job_role_id,
  requiredHeadcount: l.required_headcount?.toString() ?? "1",
  dayShiftQuantity: l.day_shift_quantity?.toString() ?? "",
  nightShiftQuantity: l.night_shift_quantity?.toString() ?? "",
  otherShiftQuantity: l.other_shift_quantity?.toString() ?? "",
  rotationTemplateId: l.rotation_template_id ?? "",
  employmentTypePreference: l.employment_type_preference ?? "",
  nationalityPreference: l.nationality_preference ?? "",
  languageRequirement: l.language_requirement ?? "",
  minimumExperienceYears: l.minimum_experience_years?.toString() ?? "",
  mobilizationLeadDays: l.mobilization_lead_days?.toString() ?? "",
  clientApprovalRequired: l.client_approval_required,
  remarks: l.remarks ?? "",
});

export default function LinesEditor({
  crewMatrixId,
  lines,
  isDraft,
  canManage,
  jobRoles,
  skills,
  rotationTemplates,
  documentTypes,
}: {
  crewMatrixId: string;
  lines: Line[];
  isDraft: boolean;
  canManage: boolean;
  jobRoles: Ref[];
  skills: Ref[];
  rotationTemplates: Ref[];
  documentTypes: Ref[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canEdit = isDraft && canManage;

  const refresh = () => router.refresh();

  const submitCreate = (form: LineFormValues) => {
    if (!form.jobRoleId) return;
    const fd = toFormData(form);
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const res = await createCrewMatrixLine(crewMatrixId, fd);
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setAdding(false);
      refresh();
    });
  };

  const submitUpdate = (lineId: string, form: LineFormValues) => {
    if (!form.jobRoleId) return;
    const fd = toFormData(form);
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const res = await updateCrewMatrixLine(lineId, crewMatrixId, fd);
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setEditingId(null);
      refresh();
    });
  };

  const submitDelete = (line: Line) => {
    if (!window.confirm(`Delete line ${line.line_number} (${line.job_role_name})?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCrewMatrixLine(line.id, crewMatrixId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      refresh();
    });
  };

  const submitCopy = (line: Line) => {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      const res = await copyCrewMatrixLine(line.id, crewMatrixId);
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        return;
      }
      refresh();
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= lines.length) return;
    const ordered = [...lines];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setError(null);
    startTransition(async () => {
      const res = await reorderCrewMatrixLines(crewMatrixId, ordered.map((l) => l.id));
      if (res?.error) {
        setError(res.error);
        return;
      }
      refresh();
    });
  };

  return (
    <div>
      {!isDraft && (
        <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)" }}>
          Lines can only be edited while this matrix is a draft — create a new version to make changes.
        </div>
      )}
      {error && <div className="text-sm mb-3" style={{ color: "var(--ch-fail)" }}>{error}</div>}

      {canEdit &&
        (adding ? (
          <LineForm
            initial={emptyLineForm(jobRoles)}
            jobRoles={jobRoles}
            rotationTemplates={rotationTemplates}
            busy={busy}
            onSubmit={submitCreate}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-3">
            + Add line
          </button>
        ))}

      <div className="space-y-2">
        {lines.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No lines yet.</div>}
        {lines.map((line, i) =>
          editingId === line.id ? (
            <LineForm
              key={line.id}
              initial={lineToForm(line)}
              jobRoles={jobRoles}
              rotationTemplates={rotationTemplates}
              busy={busy}
              onSubmit={(form) => submitUpdate(line.id, form)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={line.id} className={`${cardCls}`} style={cardStyle}>
              <div className="p-3 flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                  #{line.line_number}
                </span>
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{line.job_role_name}</span>
                <span className="text-xs" style={{ color: "var(--ch-sub)" }}>Headcount {line.required_headcount}</span>
                {(line.day_shift_quantity || line.night_shift_quantity || line.other_shift_quantity) && (
                  <span className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    D{line.day_shift_quantity ?? 0} / N{line.night_shift_quantity ?? 0} / O{line.other_shift_quantity ?? 0}
                  </span>
                )}
                {line.rotation_template_name && <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{line.rotation_template_name}</span>}
                {line.client_approval_required && (
                  <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                    Client approval required
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => setExpandedId(expandedId === line.id ? null : line.id)}
                    className="text-xs font-semibold ch-link-navy"
                  >
                    {expandedId === line.id ? "Hide requirements" : `Requirements (${line.skills.length + line.documents.length + line.competencies.length + line.clientRequirements.length})`}
                  </button>
                  {canEdit && (
                    <>
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="text-xs font-semibold disabled:opacity-30" style={{ color: "var(--ch-sub)" }} title="Move up">↑</button>
                      <button onClick={() => move(i, 1)} disabled={i === lines.length - 1} className="text-xs font-semibold disabled:opacity-30" style={{ color: "var(--ch-sub)" }} title="Move down">↓</button>
                      <button onClick={() => setEditingId(line.id)} className="text-xs font-semibold ch-link-navy">Edit</button>
                      <button onClick={() => submitCopy(line)} className="text-xs font-semibold ch-link-navy">Copy</button>
                      <button onClick={() => submitDelete(line)} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Delete</button>
                    </>
                  )}
                </div>
              </div>
              {expandedId === line.id && (
                <div className="border-t p-3" style={{ borderColor: "var(--ch-line)" }}>
                  <LineRequirements crewMatrixId={crewMatrixId} line={line} canEdit={canEdit} skills={skills} documentTypes={documentTypes} onChange={refresh} />
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function toFormData(form: LineFormValues): FormData {
  const fd = new FormData();
  fd.set("jobRoleId", form.jobRoleId);
  fd.set("requiredHeadcount", form.requiredHeadcount);
  fd.set("dayShiftQuantity", form.dayShiftQuantity);
  fd.set("nightShiftQuantity", form.nightShiftQuantity);
  fd.set("otherShiftQuantity", form.otherShiftQuantity);
  fd.set("rotationTemplateId", form.rotationTemplateId);
  fd.set("employmentTypePreference", form.employmentTypePreference);
  fd.set("nationalityPreference", form.nationalityPreference);
  fd.set("languageRequirement", form.languageRequirement);
  fd.set("minimumExperienceYears", form.minimumExperienceYears);
  fd.set("mobilizationLeadDays", form.mobilizationLeadDays);
  if (form.clientApprovalRequired) fd.set("clientApprovalRequired", "on");
  fd.set("remarks", form.remarks);
  return fd;
}

function LineForm({
  initial,
  jobRoles,
  rotationTemplates,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: LineFormValues;
  jobRoles: Ref[];
  rotationTemplates: Ref[];
  busy: boolean;
  onSubmit: (form: LineFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const setField = (k: keyof LineFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Job role
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.jobRoleId} onChange={setField("jobRoleId")}>
            {jobRoles.length === 0 && <option value="">No job roles yet</option>}
            {jobRoles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Required headcount
          <input type="number" min="1" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.requiredHeadcount} onChange={setField("requiredHeadcount")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Rotation template
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.rotationTemplateId} onChange={setField("rotationTemplateId")}>
            <option value="">—</option>
            {rotationTemplates.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs flex items-center gap-2 mt-5" style={{ color: "var(--ch-sub)" }}>
          <input type="checkbox" checked={values.clientApprovalRequired} onChange={(e) => setValues((v) => ({ ...v, clientApprovalRequired: e.target.checked }))} />
          Client approval required
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Day shift qty
          <input type="number" min="0" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.dayShiftQuantity} onChange={setField("dayShiftQuantity")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Night shift qty
          <input type="number" min="0" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.nightShiftQuantity} onChange={setField("nightShiftQuantity")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Other shift qty
          <input type="number" min="0" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.otherShiftQuantity} onChange={setField("otherShiftQuantity")} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Employment type pref.
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.employmentTypePreference} onChange={setField("employmentTypePreference")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Nationality pref.
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.nationalityPreference} onChange={setField("nationalityPreference")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Language requirement
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.languageRequirement} onChange={setField("languageRequirement")} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Min. experience (years)
          <input type="number" min="0" step="0.5" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.minimumExperienceYears} onChange={setField("minimumExperienceYears")} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Mobilization lead (days)
          <input type="number" min="0" className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.mobilizationLeadDays} onChange={setField("mobilizationLeadDays")} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Remarks" rows={2} value={values.remarks} onChange={setField("remarks")} />
      <div className="flex items-center gap-2">
        <button onClick={() => onSubmit(values)} disabled={busy || !values.jobRoleId} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save line
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function LineRequirements({
  crewMatrixId,
  line,
  canEdit,
  skills,
  documentTypes,
  onChange,
}: {
  crewMatrixId: string;
  line: Line;
  canEdit: boolean;
  skills: Ref[];
  documentTypes: Ref[];
  onChange: () => void;
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string } | undefined>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      onChange();
    });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {error && <div className="text-sm sm:col-span-2" style={{ color: "var(--ch-fail)" }}>{error}</div>}

      <SkillsPanel crewMatrixId={crewMatrixId} line={line} canEdit={canEdit} skills={skills} run={run} />
      <DocumentsPanel crewMatrixId={crewMatrixId} line={line} canEdit={canEdit} documentTypes={documentTypes} run={run} />
      <CompetenciesPanel crewMatrixId={crewMatrixId} line={line} canEdit={canEdit} run={run} />
      <ClientRequirementsPanel crewMatrixId={crewMatrixId} line={line} canEdit={canEdit} run={run} />
    </div>
  );
}

function SkillsPanel({
  crewMatrixId,
  line,
  canEdit,
  skills,
  run,
}: {
  crewMatrixId: string;
  line: Line;
  canEdit: boolean;
  skills: Ref[];
  run: (fn: () => Promise<{ error?: string } | undefined>) => void;
}) {
  const available = skills.filter((s) => !line.skills.some((ls) => ls.skill_id === s.id));
  const [selected, setSelected] = useState(available[0]?.id ?? "");

  return (
    <div>
      <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Required skills</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {line.skills.length === 0 && <span className="text-sm" style={{ color: "var(--ch-sub)" }}>None yet.</span>}
        {line.skills.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
            {s.name}
            {canEdit && (
              <button onClick={() => run(() => removeLineSkill(s.id, crewMatrixId))} className="font-bold" style={{ color: "var(--ch-fail)" }}>✕</button>
            )}
          </span>
        ))}
      </div>
      {canEdit && available.length > 0 && (
        <div className="flex items-center gap-2">
          <select className={`${inputCls} flex-1`} style={inputStyle} value={selected} onChange={(e) => setSelected(e.target.value)}>
            {available.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button onClick={() => selected && run(() => addLineSkill(line.id, crewMatrixId, selected))} className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold">Add</button>
        </div>
      )}
    </div>
  );
}

function DocumentsPanel({
  crewMatrixId,
  line,
  canEdit,
  documentTypes,
  run,
}: {
  crewMatrixId: string;
  line: Line;
  canEdit: boolean;
  documentTypes: Ref[];
  run: (fn: () => Promise<{ error?: string } | undefined>) => void;
}) {
  const available = documentTypes.filter((d) => !line.documents.some((ld) => ld.document_type_id === d.id));
  const [selected, setSelected] = useState(available[0]?.id ?? "");
  const [validityDays, setValidityDays] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [waiver, setWaiver] = useState(false);

  const add = () => {
    if (!selected) return;
    const fd = new FormData();
    fd.set("documentTypeId", selected);
    fd.set("minimumRemainingValidityDays", validityDays);
    if (!mandatory) fd.set("isMandatory", "off");
    if (waiver) fd.set("waiverPermitted", "on");
    run(() => addLineDocument(line.id, crewMatrixId, fd));
  };

  const toggleField = (doc: Line["documents"][number], field: "is_mandatory" | "waiver_permitted") => {
    const fd = new FormData();
    fd.set("minimumRemainingValidityDays", doc.minimum_remaining_validity_days?.toString() ?? "");
    const nextMandatory = field === "is_mandatory" ? !doc.is_mandatory : doc.is_mandatory;
    const nextWaiver = field === "waiver_permitted" ? !doc.waiver_permitted : doc.waiver_permitted;
    if (!nextMandatory) fd.set("isMandatory", "off");
    if (nextWaiver) fd.set("waiverPermitted", "on");
    run(() => updateLineDocument(doc.id, crewMatrixId, fd));
  };

  return (
    <div>
      <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Required document types</div>
      <div className="space-y-1.5 mb-2">
        {line.documents.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>None yet.</div>}
        {line.documents.map((d) => (
          <div key={d.id} className="flex items-center gap-2 flex-wrap text-xs">
            <span className="rounded-full border px-2.5 py-1" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>{d.name}</span>
            {d.minimum_remaining_validity_days != null && <span style={{ color: "var(--ch-sub)" }}>min. {d.minimum_remaining_validity_days}d remaining</span>}
            {canEdit ? (
              <>
                <label className="flex items-center gap-1" style={{ color: "var(--ch-sub)" }}>
                  <input type="checkbox" checked={d.is_mandatory} onChange={() => toggleField(d, "is_mandatory")} /> Mandatory
                </label>
                <label className="flex items-center gap-1" style={{ color: "var(--ch-sub)" }}>
                  <input type="checkbox" checked={d.waiver_permitted} onChange={() => toggleField(d, "waiver_permitted")} /> Waiver OK
                </label>
                <button onClick={() => run(() => removeLineDocument(d.id, crewMatrixId))} className="font-bold" style={{ color: "var(--ch-fail)" }}>✕</button>
              </>
            ) : (
              <span style={{ color: "var(--ch-sub)" }}>{d.is_mandatory ? "Mandatory" : "Optional"}{d.waiver_permitted ? " · waiver OK" : ""}</span>
            )}
          </div>
        ))}
      </div>
      {canEdit && available.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <select className={inputCls} style={inputStyle} value={selected} onChange={(e) => setSelected(e.target.value)}>
            {available.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input type="number" min="0" placeholder="Min. days valid" className={`${inputCls} w-32`} style={inputStyle} value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />
          <label className="flex items-center gap-1 text-xs" style={{ color: "var(--ch-sub)" }}>
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} /> Mandatory
          </label>
          <label className="flex items-center gap-1 text-xs" style={{ color: "var(--ch-sub)" }}>
            <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} /> Waiver OK
          </label>
          <button onClick={add} className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold">Add</button>
        </div>
      )}
    </div>
  );
}

function CompetenciesPanel({
  crewMatrixId,
  line,
  canEdit,
  run,
}: {
  crewMatrixId: string;
  line: Line;
  canEdit: boolean;
  run: (fn: () => Promise<{ error?: string } | undefined>) => void;
}) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");

  const add = () => {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("competencyName", name.trim());
    fd.set("minimumGrade", grade.trim());
    fd.set("notes", notes.trim());
    run(() => addLineCompetency(line.id, crewMatrixId, fd));
    setName("");
    setGrade("");
    setNotes("");
  };

  return (
    <div>
      <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Required competency grades</div>
      <div className="space-y-1.5 mb-2">
        {line.competencies.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>None yet.</div>}
        {line.competencies.map((c) => (
          <div key={c.id} className="flex items-center gap-2 flex-wrap text-xs">
            <span className="rounded-full border px-2.5 py-1" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
              {c.competency_name}{c.minimum_grade ? ` — min. ${c.minimum_grade}` : ""}
            </span>
            {c.notes && <span style={{ color: "var(--ch-sub)" }}>{c.notes}</span>}
            {canEdit && <button onClick={() => run(() => removeLineCompetency(c.id, crewMatrixId))} className="font-bold" style={{ color: "var(--ch-fail)" }}>✕</button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <input placeholder="Competency" className={`${inputCls} w-40`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Min. grade" className={`${inputCls} w-28`} style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value)} />
          <input placeholder="Notes" className={`${inputCls} flex-1`} style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button onClick={add} disabled={!name.trim()} className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">Add</button>
        </div>
      )}
    </div>
  );
}

function ClientRequirementsPanel({
  crewMatrixId,
  line,
  canEdit,
  run,
}: {
  crewMatrixId: string;
  line: Line;
  canEdit: boolean;
  run: (fn: () => Promise<{ error?: string } | undefined>) => void;
}) {
  const [text, setText] = useState("");
  const [mandatory, setMandatory] = useState(true);

  const add = () => {
    if (!text.trim()) return;
    const fd = new FormData();
    fd.set("requirementText", text.trim());
    if (!mandatory) fd.set("isMandatory", "off");
    run(() => addLineClientRequirement(line.id, crewMatrixId, fd));
    setText("");
  };

  return (
    <div>
      <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Client-specific requirements</div>
      <div className="space-y-1.5 mb-2">
        {line.clientRequirements.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>None yet.</div>}
        {line.clientRequirements.map((r) => (
          <div key={r.id} className="flex items-center gap-2 flex-wrap text-xs">
            <span className="rounded-full border px-2.5 py-1" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
              {r.requirement_text}{r.is_mandatory ? "" : " (optional)"}
            </span>
            {canEdit && <button onClick={() => run(() => removeLineClientRequirement(r.id, crewMatrixId))} className="font-bold" style={{ color: "var(--ch-fail)" }}>✕</button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <input placeholder="Requirement" className={`${inputCls} flex-1`} style={inputStyle} value={text} onChange={(e) => setText(e.target.value)} />
          <label className="flex items-center gap-1 text-xs" style={{ color: "var(--ch-sub)" }}>
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} /> Mandatory
          </label>
          <button onClick={add} disabled={!text.trim()} className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">Add</button>
        </div>
      )}
    </div>
  );
}
