"use client";

import { useState, useTransition, useRef } from "react";
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
import { useGuideMaybe } from "@/components/guide/guide-context";

export type Ref = { id: string; name: string };
// Named, reusable document requirement templates (Crew Setup → Document
// Templates), offered per role on a Manning Line's document checklist so
// the user can pick one instead of ticking every document by hand.
export type DocTemplate = {
  id: string;
  name: string;
  job_role_id: string;
  items: { document_type_id: string; is_mandatory: boolean; minimum_remaining_validity_days: number | null }[];
};
// Document types as needed by the Staffing Plan tab (status computation +
// number display), a superset of Ref — passing this where Ref[] is
// expected (LinesEditor) is fine, TS structurally allows the wider shape.
export type DocTypeRef = Ref & { category: string | null; warning_threshold_days: number | null; tracks_number: boolean };
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
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

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
  editingEnabled,
  jobRoles,
  skills,
  rotationTemplates,
  documentTypes,
  documentTemplates,
}: {
  crewMatrixId: string;
  lines: Line[];
  isDraft: boolean;
  canManage: boolean;
  // Mirrors the header's "Edit" toggle (matrix-detail.tsx) — lines (and
  // everything under them: skills, document checkboxes, competencies,
  // client requirements) only become editable once that button has been
  // clicked, the same as the Overview tab's fields. Without this, the
  // requirement checkboxes here were always live for any draft matrix, so
  // clicking "Edit" up top had no visible effect on this tab.
  editingEnabled: boolean;
  jobRoles: Ref[];
  skills: Ref[];
  rotationTemplates: Ref[];
  documentTypes: Ref[];
  documentTemplates: DocTemplate[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guide = useGuideMaybe();

  const canEdit = isDraft && canManage && editingEnabled;

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
      guide?.notifyCompletion("matrix.line.added", { recordId: crewMatrixId });
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
    if (!window.confirm(`Delete manning line ${line.line_number} (${line.job_role_name})?`)) return;
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
          Manning lines can only be edited while this matrix is a draft — create a new version to make changes.
        </div>
      )}
      {isDraft && canManage && !editingEnabled && (
        <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)" }}>
          Click <strong>Edit</strong> above to change manning lines, requirements, or document checkboxes.
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
          <button
            onClick={() => setAdding(true)}
            data-guide-id="matrix.lines.add-button"
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-3"
          >
            + Add manning line
          </button>
        ))}

      <div className="space-y-2">
        {lines.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No manning lines yet.</div>}
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
                    data-guide-id="matrix.line.requirements-toggle"
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
                  <LineRequirements
                    crewMatrixId={crewMatrixId}
                    line={line}
                    canEdit={canEdit}
                    skills={skills}
                    documentTypes={documentTypes}
                    documentTemplates={documentTemplates}
                    onChange={refresh}
                    onSaved={() => guide?.notifyCompletion("matrix.line.requirements.set", { recordId: crewMatrixId })}
                  />
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
      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Remarks
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={values.remarks} onChange={setField("remarks")} />
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSubmit(values)}
          disabled={busy || !values.jobRoleId}
          data-guide-id="matrix.line.save"
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Save manning line
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
  documentTemplates,
  onChange,
  onSaved,
}: {
  crewMatrixId: string;
  line: Line;
  canEdit: boolean;
  skills: Ref[];
  documentTypes: Ref[];
  documentTemplates: DocTemplate[];
  onChange: () => void;
  // Fired after any real add (skill/document/competency/client
  // requirement) succeeds — lets an active guide's matrix.line.requirements
  // step advance on real engagement with this line's requirements, same
  // "only after a real server action succeeds" rule every other guide
  // completion event follows. Not fired on removal — only adding counts as
  // "set".
  onSaved?: () => void;
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // `optimistic`, when passed, runs synchronously as the first thing inside
  // the transition — so it must be the function that calls a useOptimistic
  // setter. Keeping it inside the same transition as the async server call
  // is what keeps the optimistic value on screen for the whole round trip
  // instead of flashing back immediately (a transition that only wrapped
  // the optimistic dispatch would settle right away, before the request
  // even lands).
  // `isAdd` distinguishes an add from a remove (both share this same
  // helper) — onSaved should only fire for the former.
  const run = (fn: () => Promise<{ error?: string } | undefined>, optimistic?: () => void, isAdd = false) => {
    setError(null);
    startTransition(async () => {
      optimistic?.();
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      onChange();
      if (isAdd) onSaved?.();
    });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {error && <div className="text-sm sm:col-span-2" style={{ color: "var(--ch-fail)" }}>{error}</div>}

      <SkillsPanel crewMatrixId={crewMatrixId} line={line} canEdit={canEdit} skills={skills} run={run} />
      <DocumentsPanel
        crewMatrixId={crewMatrixId}
        line={line}
        canEdit={canEdit}
        documentTypes={documentTypes}
        documentTemplates={documentTemplates.filter((t) => t.job_role_id === line.job_role_id)}
        onChange={onChange}
        onSaved={onSaved}
      />
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
  run: (fn: () => Promise<{ error?: string } | undefined>, optimistic?: () => void, isAdd?: boolean) => void;
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
          <button onClick={() => selected && run(() => addLineSkill(line.id, crewMatrixId, selected), undefined, true)} data-guide-id="matrix.line.skills.add-button" className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold">Add</button>
        </div>
      )}
    </div>
  );
}

type DocRow = Line["documents"][number];

function DocumentsPanel({
  crewMatrixId,
  line,
  canEdit,
  documentTypes,
  documentTemplates,
  onChange,
  onSaved,
}: {
  crewMatrixId: string;
  line: Line;
  canEdit: boolean;
  documentTypes: Ref[];
  documentTemplates: DocTemplate[];
  onChange: () => void;
  onSaved?: () => void;
}) {
  // Local state, not tied to a full-page refresh: a checkbox toggle used to
  // wait on `router.refresh()` (re-fetching every line's full requirement
  // data) just to make the change "stick" — and since that round trip is
  // much slower than the actual insert/delete, the optimistic tick would
  // revert back and then re-apply once the refresh finally landed, which is
  // what showed up as the checkbox "taking time to update". Managing the
  // list directly here means the checkbox changes once, immediately, and
  // stays that way regardless of how long the background refresh takes.
  // `onChange` (a page refresh) still fires after each save so that other
  // on-screen counts (e.g. the collapsed "Requirements (N)" total) catch up
  // eventually — it just no longer gates what this panel shows.
  const [docs, setDocs] = useState<DocRow[]>(line.documents);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(documentTemplates[0]?.id ?? "");
  const byTypeId = new Map(docs.map((d) => [d.document_type_id, d]));
  // A just-checked row shows instantly with a placeholder id (not a real
  // UUID) until its insert comes back. If "Mandatory" or the checkbox
  // itself gets clicked again before that insert resolves, calling the
  // server with the placeholder id fails ("invalid input syntax for type
  // uuid"). This map lets any such follow-up action wait for the real id
  // instead of firing early with the fake one.
  const pendingAdds = useRef<Map<string, Promise<string | undefined>>>(new Map());

  const resolveRealId = (doc: DocRow): Promise<string | undefined> => {
    if (!doc.id.startsWith("optimistic-")) return Promise.resolve(doc.id);
    return pendingAdds.current.get(doc.id) ?? Promise.resolve(undefined);
  };

  // Generalized so both a plain checkbox click (mandatory, no validity) and
  // "Apply template" (which may carry its own mandatory/validity values)
  // can share the same optimistic-add + server-insert path.
  const addDoc = (docTypeId: string, opts?: { isMandatory?: boolean; minimumRemainingValidityDays?: number | null }) => {
    const isMandatory = opts?.isMandatory ?? true;
    const minValidity = opts?.minimumRemainingValidityDays ?? null;
    const tempId = `optimistic-${docTypeId}`;
    setDocs((prev) => [
      ...prev,
      { id: tempId, document_type_id: docTypeId, name: "", minimum_remaining_validity_days: minValidity, is_mandatory: isMandatory, waiver_permitted: false },
    ]);
    const fd = new FormData();
    fd.set("documentTypeId", docTypeId);
    fd.set("minimumRemainingValidityDays", minValidity != null ? String(minValidity) : "");
    if (!isMandatory) fd.set("isMandatory", "off");
    const pending = addLineDocument(line.id, crewMatrixId, fd).then((res) => {
      if (res?.error) {
        setError(res.error);
        setDocs((prev) => prev.filter((d) => d.id !== tempId));
        return undefined;
      }
      const realId = res?.id;
      if (realId) {
        setDocs((prev) => prev.map((d) => (d.id === tempId ? { ...d, id: realId } : d)));
      }
      onChange();
      onSaved?.();
      return realId;
    });
    pendingAdds.current.set(tempId, pending);
  };

  const toggleSelected = (docTypeId: string, checked: boolean) => {
    setError(null);
    if (checked) {
      addDoc(docTypeId);
    } else {
      const existing = byTypeId.get(docTypeId);
      if (!existing) return;
      setDocs((prev) => prev.filter((d) => d.id !== existing.id));
      resolveRealId(existing).then((realId) => {
        // If the add this depends on never got a real id (it failed, or
        // was itself already removed), there's nothing on the server to
        // delete.
        if (!realId) return;
        removeLineDocument(realId, crewMatrixId).then((res) => {
          if (res?.error) {
            setError(res.error);
            setDocs((prev) => [...prev, { ...existing, id: realId }]);
            return;
          }
          onChange();
        });
      });
    }
  };

  const toggleField = (doc: DocRow, field: "is_mandatory" | "waiver_permitted") => {
    setError(null);
    const nextMandatory = field === "is_mandatory" ? !doc.is_mandatory : doc.is_mandatory;
    const nextWaiver = field === "waiver_permitted" ? !doc.waiver_permitted : doc.waiver_permitted;
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, is_mandatory: nextMandatory, waiver_permitted: nextWaiver } : d)));
    resolveRealId(doc).then((realId) => {
      if (!realId) return;
      const fd = new FormData();
      fd.set("minimumRemainingValidityDays", doc.minimum_remaining_validity_days?.toString() ?? "");
      if (!nextMandatory) fd.set("isMandatory", "off");
      if (nextWaiver) fd.set("waiverPermitted", "on");
      updateLineDocument(realId, crewMatrixId, fd).then((res) => {
        if (res?.error) {
          setError(res.error);
          setDocs((prev) => prev.map((d) => (d.id === realId || d.id === doc.id ? { ...d, is_mandatory: doc.is_mandatory, waiver_permitted: doc.waiver_permitted } : d)));
          return;
        }
        onChange();
      });
    });
  };

  // Apply a named template (Crew Setup → Document Templates): for a document
  // type not yet on this line, add it with the template's mandatory/validity
  // values (via addDoc); for one already on the line, sync those two values
  // to match the template rather than skipping it. Never removes a document
  // that's on the line but not in the template — this only fills in/updates,
  // it doesn't wholesale replace the checklist.
  const applyTemplateItem = (item: DocTemplate["items"][number]) => {
    setError(null);
    const existing = byTypeId.get(item.document_type_id);
    if (!existing) {
      addDoc(item.document_type_id, { isMandatory: item.is_mandatory, minimumRemainingValidityDays: item.minimum_remaining_validity_days });
      return;
    }
    setDocs((prev) =>
      prev.map((d) => (d.id === existing.id ? { ...d, is_mandatory: item.is_mandatory, minimum_remaining_validity_days: item.minimum_remaining_validity_days } : d))
    );
    resolveRealId(existing).then((realId) => {
      if (!realId) return;
      const fd = new FormData();
      fd.set("minimumRemainingValidityDays", item.minimum_remaining_validity_days != null ? String(item.minimum_remaining_validity_days) : "");
      if (!item.is_mandatory) fd.set("isMandatory", "off");
      if (existing.waiver_permitted) fd.set("waiverPermitted", "on");
      updateLineDocument(realId, crewMatrixId, fd).then((res) => {
        if (res?.error) {
          setError(res.error);
          return;
        }
        onChange();
      });
    });
  };
  const applyTemplate = (template: DocTemplate) => {
    template.items.forEach(applyTemplateItem);
  };

  // Adds every document type not yet on this line, and removes every one
  // that is — both just replay toggleSelected per row, so each still goes
  // through the same local-state + server-action path as a manual click.
  const selectAll = () => {
    documentTypes.forEach((docType) => {
      if (!byTypeId.has(docType.id)) toggleSelected(docType.id, true);
    });
  };
  const deselectAll = () => {
    documentTypes.forEach((docType) => {
      if (byTypeId.has(docType.id)) toggleSelected(docType.id, false);
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Required document types</div>
        {canEdit && documentTypes.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={selectAll} className="text-xs font-semibold ch-link-navy">Select all</button>
            <button onClick={deselectAll} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Deselect all</button>
          </div>
        )}
      </div>
      {canEdit && documentTemplates.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <select className={`${inputCls} flex-1`} style={inputStyle} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {documentTemplates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              const template = documentTemplates.find((t) => t.id === templateId);
              if (template) applyTemplate(template);
            }}
            disabled={!templateId}
            className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
            title="Fills in / updates this role's documents from the template — doesn't remove anything already checked."
          >
            Apply template
          </button>
        </div>
      )}
      {error && <div className="text-xs mb-2" style={{ color: "var(--ch-fail)" }}>{error}</div>}
      {documentTypes.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No document types configured yet.</div>
      ) : (
        // No scroll cutoff — every document type is shown at once, laid out
        // in columns so a long list doesn't turn into a tall single column.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 rounded-lg border p-2" style={{ borderColor: "var(--ch-line)" }}>
          {documentTypes.map((docType) => {
            const doc = byTypeId.get(docType.id);
            const selected = !!doc;
            return (
              <div key={docType.id} className="flex items-center gap-3 flex-wrap text-xs py-1">
                <label className="flex items-center gap-2 min-w-[190px]" style={{ color: "var(--ch-ink)" }}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!canEdit}
                    onChange={(e) => toggleSelected(docType.id, e.target.checked)}
                  />
                  <span className={selected ? "font-semibold" : ""}>{docType.name}</span>
                </label>
                {doc &&
                  (canEdit ? (
                    <label className="flex items-center gap-1" style={{ color: "var(--ch-sub)" }}>
                      <input type="checkbox" checked={doc.is_mandatory} onChange={() => toggleField(doc, "is_mandatory")} /> Mandatory
                    </label>
                  ) : (
                    <span style={{ color: "var(--ch-sub)" }}>
                      {doc.is_mandatory ? "Mandatory" : "Optional"}
                      {doc.waiver_permitted ? " · waiver OK" : ""}
                      {doc.minimum_remaining_validity_days != null ? ` · min. ${doc.minimum_remaining_validity_days}d remaining` : ""}
                    </span>
                  ))}
              </div>
            );
          })}
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
  run: (fn: () => Promise<{ error?: string } | undefined>, optimistic?: () => void, isAdd?: boolean) => void;
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
    run(() => addLineCompetency(line.id, crewMatrixId, fd), undefined, true);
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
          <label className={lbl} style={lblStyle}>Competency<input className={`${inputCls} w-40 mt-1`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className={lbl} style={lblStyle}>Min. grade<input className={`${inputCls} w-28 mt-1`} style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value)} /></label>
          <label className={`${lbl} flex-1`} style={lblStyle}>Notes<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
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
  run: (fn: () => Promise<{ error?: string } | undefined>, optimistic?: () => void, isAdd?: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [mandatory, setMandatory] = useState(true);

  const add = () => {
    if (!text.trim()) return;
    const fd = new FormData();
    fd.set("requirementText", text.trim());
    if (!mandatory) fd.set("isMandatory", "off");
    run(() => addLineClientRequirement(line.id, crewMatrixId, fd), undefined, true);
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
          <label className={`${lbl} flex-1`} style={lblStyle}>Requirement<input className={`${inputCls} w-full mt-1`} style={inputStyle} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <label className="flex items-center gap-1 text-xs" style={{ color: "var(--ch-sub)" }}>
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} /> Mandatory
          </label>
          <button onClick={add} disabled={!text.trim()} className="ch-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">Add</button>
        </div>
      )}
    </div>
  );
}
