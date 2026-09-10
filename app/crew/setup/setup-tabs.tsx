"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createJobRole,
  updateJobRole,
  deleteJobRole,
  createSkill,
  deleteSkill,
  createClient_,
  updateClient,
  deleteClient,
  createRotationTemplate,
  updateRotationTemplate,
  deleteRotationTemplate,
  createOffshoreSite,
  updateOffshoreSite,
  deleteOffshoreSite,
  setManningRequirement,
  deleteManningRequirement,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  createContractor,
  updateContractor,
  deleteContractor,
} from "./actions";

type JobRole = { id: string; name: string; category: string | null; is_active: boolean };
type Skill = { id: string; name: string };
type Client = {
  id: string;
  name: string;
  contract_number: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  billing_model: string | null;
  notes: string | null;
  is_active: boolean;
};
type Contractor = {
  id: string;
  name: string;
  client_id: string;
  notes: string | null;
  is_active: boolean;
};
type RotationTemplate = {
  id: string;
  name: string;
  pattern_type: string;
  days_on: number | null;
  days_off: number | null;
  notes: string | null;
  is_active: boolean;
};
type OffshoreSite = {
  id: string;
  name: string;
  code: string | null;
  site_type: string;
  country: string | null;
  operating_region: string | null;
  port_or_heliport: string | null;
  crew_change_location: string | null;
  status: string;
  notes: string | null;
  contractor_id: string | null;
  standard_rotation_template_id: string | null;
};
type ManningReq = { id: string; offshore_site_id: string; job_role_id: string; minimum_headcount: number };
type DocumentType = {
  id: string;
  name: string;
  category: string | null;
  default_validity_months: number | null;
  warning_threshold_days: number | null;
  tracks_number: boolean;
  is_active: boolean;
};

const TABS = ["Job Roles", "Skills", "Clients", "Contractors", "Rotation Templates", "Offshore Sites", "Document Types"] as const;
type Tab = (typeof TABS)[number];

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

export default function SetupTabs({
  jobRoles,
  skills,
  clients,
  contractors,
  rotationTemplates,
  offshoreSites,
  manningRequirements,
  documentTypes,
}: {
  jobRoles: JobRole[];
  skills: Skill[];
  clients: Client[];
  contractors: Contractor[];
  rotationTemplates: RotationTemplate[];
  offshoreSites: OffshoreSite[];
  manningRequirements: ManningReq[];
  documentTypes: DocumentType[];
}) {
  const [tab, setTab] = useState<Tab>("Job Roles");
  const router = useRouter();
  const refresh = () => router.refresh();

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

      {tab === "Job Roles" && <JobRolesPanel jobRoles={jobRoles} onChanged={refresh} />}
      {tab === "Skills" && <SkillsPanel skills={skills} onChanged={refresh} />}
      {tab === "Clients" && <ClientsPanel clients={clients} onChanged={refresh} />}
      {tab === "Contractors" && <ContractorsPanel contractors={contractors} clients={clients} onChanged={refresh} />}
      {tab === "Rotation Templates" && <RotationTemplatesPanel templates={rotationTemplates} onChanged={refresh} />}
      {tab === "Offshore Sites" && (
        <OffshoreSitesPanel
          sites={offshoreSites}
          contractors={contractors}
          clients={clients}
          rotationTemplates={rotationTemplates}
          jobRoles={jobRoles}
          manningRequirements={manningRequirements}
          onChanged={refresh}
        />
      )}
      {tab === "Document Types" && <DocumentTypesPanel documentTypes={documentTypes} onChanged={refresh} />}
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="text-xs mt-1.5" style={{ color: "var(--ch-fail)" }}>
      {error}
    </div>
  );
}

/* ================= Job Roles ================= */

function JobRolesPanel({ jobRoles, onChanged }: { jobRoles: JobRole[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const add = () => {
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("category", category.trim());
    startTransition(async () => {
      const res = await createJobRole(fd);
      if (res?.error) { setError(res.error); return; }
      setName("");
      setCategory("");
      onChanged();
    });
  };

  return (
    <div>
      <div className={`${cardCls} p-4 mb-4`} style={cardStyle}>
        <div className="flex items-center gap-2 flex-wrap">
          <input className={`${inputCls} flex-1 min-w-[160px]`} style={inputStyle} placeholder="Role name, e.g. Head Chef" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={`${inputCls} w-48`} style={inputStyle} placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <button onClick={add} disabled={pending || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {pending ? "Adding…" : "+ Add role"}
          </button>
        </div>
        <ErrorLine error={error} />
      </div>

      <div className="space-y-2">
        {jobRoles.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No job roles yet.</div>}
        {jobRoles.map((r) =>
          editingId === r.id ? (
            <JobRoleEditRow key={r.id} role={r} onDone={() => { setEditingId(null); onChanged(); }} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={r.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[160px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{r.name}</span>
                {r.category && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{r.category}</span>}
                {!r.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
              </div>
              <button onClick={() => setEditingId(r.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onDelete={() => deleteJobRole(r.id).then(onChanged)} label="role" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function JobRoleEditRow({ role, onDone, onCancel }: { role: JobRole; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(role.name);
  const [category, setCategory] = useState(role.category ?? "");
  const [isActive, setIsActive] = useState(role.is_active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("category", category.trim());
    if (isActive) fd.set("isActive", "on");
    startTransition(async () => {
      const res = await updateJobRole(role.id, fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <div className={`${cardCls} p-3`} style={cardStyle}>
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${inputCls} flex-1 min-w-[160px]`} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        <input className={`${inputCls} w-48`} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        <button onClick={save} disabled={pending} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Skills ================= */

function SkillsPanel({ skills, onChanged }: { skills: Skill[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () => {
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    startTransition(async () => {
      const res = await createSkill(fd);
      if (res?.error) { setError(res.error); return; }
      setName("");
      onChanged();
    });
  };

  return (
    <div>
      <div className={`${cardCls} p-4 mb-4`} style={cardStyle}>
        <div className="flex items-center gap-2">
          <input className={`${inputCls} flex-1`} style={inputStyle} placeholder="Skill name, e.g. HACCP Certified" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button onClick={add} disabled={pending || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {pending ? "Adding…" : "+ Add skill"}
          </button>
        </div>
        <ErrorLine error={error} />
      </div>

      <div className="flex flex-wrap gap-2">
        {skills.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No skills yet.</div>}
        {skills.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
            {s.name}
            <button onClick={() => deleteSkill(s.id).then(onChanged)} className="text-xs" style={{ color: "var(--ch-fail)" }} title="Delete">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= Clients ================= */

function ClientsPanel({ clients, onChanged }: { clients: Client[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      {adding ? (
        <ClientForm onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add client</button>
      )}

      <div className="space-y-2 mt-4">
        {clients.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No clients yet.</div>}
        {clients.map((c) =>
          editingId === c.id ? (
            <ClientForm key={c.id} client={c} onDone={() => { setEditingId(null); onChanged(); }} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={c.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[200px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{c.name}</span>
                {c.contract_number && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>Contract {c.contract_number}</span>}
                {(c.contract_start_date || c.contract_end_date) && (
                  <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
                    {c.contract_start_date ?? "…"} – {c.contract_end_date ?? "…"}
                  </span>
                )}
                {!c.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
              </div>
              <button onClick={() => setEditingId(c.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onDelete={() => deleteClient(c.id).then(onChanged)} label="client" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ClientForm({ client, onDone, onCancel }: { client?: Client; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(client?.name ?? "");
  const [contractNumber, setContractNumber] = useState(client?.contract_number ?? "");
  const [start, setStart] = useState(client?.contract_start_date ?? "");
  const [end, setEnd] = useState(client?.contract_end_date ?? "");
  const [billingModel, setBillingModel] = useState(client?.billing_model ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [isActive, setIsActive] = useState(client?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("contractNumber", contractNumber.trim());
    fd.set("contractStartDate", start);
    fd.set("contractEndDate", end);
    fd.set("billingModel", billingModel.trim());
    fd.set("notes", notes.trim());
    if (isActive) fd.set("isActive", "on");
    startTransition(async () => {
      const res = client ? await updateClient(client.id, fd) : await createClient_(fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Contract number" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Contract start
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Contract end
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Billing model
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. Monthly invoicing" value={billingModel} onChange={(e) => setBillingModel(e.target.value)} />
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs mr-auto" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        <button onClick={save} disabled={pending || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Contractors (EPC contractors, under a client) ================= */

function ContractorsPanel({
  contractors,
  clients,
  onChanged,
}: {
  contractors: Contractor[];
  clients: Client[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "—";

  return (
    <div>
      {clients.length === 0 && (
        <div className="text-sm mb-4" style={{ color: "var(--ch-sub)" }}>
          Add a client first (Clients tab) before adding EPC contractors under them.
        </div>
      )}
      {adding ? (
        <ContractorForm clients={clients} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={clients.length === 0}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4 disabled:opacity-50"
        >
          + Add contractor
        </button>
      )}

      <div className="space-y-2 mt-4">
        {contractors.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No EPC contractors yet.</div>}
        {contractors.map((c) =>
          editingId === c.id ? (
            <ContractorForm key={c.id} contractor={c} clients={clients} onDone={() => { setEditingId(null); onChanged(); }} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={c.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[200px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{c.name}</span>
                <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>under {clientName(c.client_id)}</span>
                {!c.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
              </div>
              <button onClick={() => setEditingId(c.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onDelete={() => deleteContractor(c.id).then(onChanged)} label="contractor" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ContractorForm({
  contractor,
  clients,
  onDone,
  onCancel,
}: {
  contractor?: Contractor;
  clients: Client[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(contractor?.name ?? "");
  const [clientId, setClientId] = useState(contractor?.client_id ?? clients[0]?.id ?? "");
  const [notes, setNotes] = useState(contractor?.notes ?? "");
  const [isActive, setIsActive] = useState(contractor?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!name.trim() || !clientId) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("clientId", clientId);
    fd.set("notes", notes.trim());
    if (isActive) fd.set("isActive", "on");
    startTransition(async () => {
      const res = contractor ? await updateContractor(contractor.id, fd) : await createContractor(fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Contractor name, e.g. Allianz Marine Service" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={inputCls} style={inputStyle} value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Select client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs mr-auto" style={{ color: "var(--ch-ink)" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        <button onClick={save} disabled={pending || !name.trim() || !clientId} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Rotation Templates ================= */

function RotationTemplatesPanel({ templates, onChanged }: { templates: RotationTemplate[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      {adding ? (
        <RotationTemplateForm onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add rotation pattern</button>
      )}

      <div className="space-y-2 mt-4">
        {templates.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No rotation patterns yet.</div>}
        {templates.map((t) =>
          editingId === t.id ? (
            <RotationTemplateForm key={t.id} template={t} onDone={() => { setEditingId(null); onChanged(); }} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={t.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
              <div className="flex-1 min-w-[160px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{t.name}</span>
                <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
                  {t.days_on != null && t.days_off != null ? `${t.days_on}/${t.days_off}` : t.pattern_type.replace("_", " ")}
                </span>
                {!t.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
              </div>
              <button onClick={() => setEditingId(t.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onDelete={() => deleteRotationTemplate(t.id).then(onChanged)} label="rotation pattern" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function RotationTemplateForm({ template, onDone, onCancel }: { template?: RotationTemplate; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [patternType, setPatternType] = useState(template?.pattern_type ?? "fixed_equal");
  const [daysOn, setDaysOn] = useState(template?.days_on != null ? String(template.days_on) : "");
  const [daysOff, setDaysOff] = useState(template?.days_off != null ? String(template.days_off) : "");
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showDays = patternType !== "custom";

  const save = () => {
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("patternType", patternType);
    fd.set("daysOn", showDays ? daysOn : "");
    fd.set("daysOff", showDays ? daysOff : "");
    fd.set("notes", notes.trim());
    if (isActive) fd.set("isActive", "on");
    startTransition(async () => {
      const res = template ? await updateRotationTemplate(template.id, fd) : await createRotationTemplate(fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
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
        <button onClick={save} disabled={pending || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Offshore Sites ================= */

const SITE_TYPES = ["vessel", "rig", "platform", "barge", "camp", "fpso", "other"];

function OffshoreSitesPanel({
  sites,
  contractors,
  clients,
  rotationTemplates,
  jobRoles,
  manningRequirements,
  onChanged,
}: {
  sites: OffshoreSite[];
  contractors: Contractor[];
  clients: Client[];
  rotationTemplates: RotationTemplate[];
  jobRoles: JobRole[];
  manningRequirements: ManningReq[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const contractorLabel = (id: string | null) => {
    const contractor = contractors.find((c) => c.id === id);
    if (!contractor) return "—";
    const client = clients.find((cl) => cl.id === contractor.client_id);
    return client ? `${contractor.name} (${client.name})` : contractor.name;
  };

  return (
    <div>
      {adding ? (
        <OffshoreSiteForm contractors={contractors} rotationTemplates={rotationTemplates} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add offshore site</button>
      )}

      <div className="space-y-2 mt-4">
        {sites.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No offshore sites yet.</div>}
        {sites.map((s) =>
          editingId === s.id ? (
            <OffshoreSiteForm
              key={s.id}
              site={s}
              contractors={contractors}
              rotationTemplates={rotationTemplates}
              onDone={() => { setEditingId(null); onChanged(); }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={s.id} className={cardCls} style={cardStyle}>
              <div className="p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{s.name}</span>
                  {s.code && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{s.code}</span>}
                  <span className="text-xs ml-2 uppercase font-semibold" style={{ color: "var(--ch-navy)" }}>{s.site_type}</span>
                  <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{contractorLabel(s.contractor_id)}</span>
                  {s.status !== "active" && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
                </div>
                <button onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>
                  {expandedId === s.id ? "Hide manning" : "Manning requirements"}
                </button>
                <button onClick={() => setEditingId(s.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
                <DeleteButton onDelete={() => deleteOffshoreSite(s.id).then(onChanged)} label="site" />
              </div>
              {expandedId === s.id && (
                <div className="border-t px-3 py-3" style={{ borderColor: "var(--ch-line)" }}>
                  <ManningRequirementsEditor
                    siteId={s.id}
                    jobRoles={jobRoles}
                    requirements={manningRequirements.filter((m) => m.offshore_site_id === s.id)}
                    onChanged={onChanged}
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

function OffshoreSiteForm({
  site,
  contractors,
  rotationTemplates,
  onDone,
  onCancel,
}: {
  site?: OffshoreSite;
  contractors: Contractor[];
  rotationTemplates: RotationTemplate[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(site?.name ?? "");
  const [code, setCode] = useState(site?.code ?? "");
  const [siteType, setSiteType] = useState(site?.site_type ?? "other");
  const [contractorId, setContractorId] = useState(site?.contractor_id ?? "");
  const [country, setCountry] = useState(site?.country ?? "");
  const [operatingRegion, setOperatingRegion] = useState(site?.operating_region ?? "");
  const [portOrHeliport, setPortOrHeliport] = useState(site?.port_or_heliport ?? "");
  const [crewChangeLocation, setCrewChangeLocation] = useState(site?.crew_change_location ?? "");
  const [rotationTemplateId, setRotationTemplateId] = useState(site?.standard_rotation_template_id ?? "");
  const [status, setStatus] = useState(site?.status ?? "active");
  const [notes, setNotes] = useState(site?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("code", code.trim());
    fd.set("siteType", siteType);
    fd.set("contractorId", contractorId);
    fd.set("country", country.trim());
    fd.set("operatingRegion", operatingRegion.trim());
    fd.set("portOrHeliport", portOrHeliport.trim());
    fd.set("crewChangeLocation", crewChangeLocation.trim());
    fd.set("standardRotationTemplateId", rotationTemplateId);
    fd.set("status", status);
    fd.set("notes", notes.trim());
    startTransition(async () => {
      const res = site ? await updateOffshoreSite(site.id, fd) : await createOffshoreSite(fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Site name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        <select className={inputCls} style={inputStyle} value={siteType} onChange={(e) => setSiteType(e.target.value)}>
          {SITE_TYPES.map((t) => (
            <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <select className={inputCls} style={inputStyle} value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
          <option value="">No EPC contractor</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input className={inputCls} style={inputStyle} placeholder="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Operating region" value={operatingRegion} onChange={(e) => setOperatingRegion(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Port / heliport" value={portOrHeliport} onChange={(e) => setPortOrHeliport(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder="Crew-change location" value={crewChangeLocation} onChange={(e) => setCrewChangeLocation(e.target.value)} />
        <select className={inputCls} style={inputStyle} value={rotationTemplateId} onChange={(e) => setRotationTemplateId(e.target.value)}>
          <option value="">No standard rotation</option>
          {rotationTemplates.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <select className={`${inputCls} mr-auto`} style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button onClick={save} disabled={pending || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function ManningRequirementsEditor({
  siteId,
  jobRoles,
  requirements,
  onChanged,
}: {
  siteId: string;
  jobRoles: JobRole[];
  requirements: ManningReq[];
  onChanged: () => void;
}) {
  const [jobRoleId, setJobRoleId] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () => {
    if (!jobRoleId) return;
    setError(null);
    const fd = new FormData();
    fd.set("jobRoleId", jobRoleId);
    fd.set("minimumHeadcount", headcount);
    startTransition(async () => {
      const res = await setManningRequirement(siteId, fd);
      if (res?.error) { setError(res.error); return; }
      setJobRoleId("");
      setHeadcount("1");
      onChanged();
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select className={inputCls} style={inputStyle} value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
          <option value="">Select job role…</option>
          {jobRoles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <input type="number" min={1} className={`${inputCls} w-24`} style={inputStyle} value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
        <button onClick={add} disabled={pending || !jobRoleId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
          Set requirement
        </button>
      </div>
      <ErrorLine error={error} />
      <div className="space-y-1.5">
        {requirements.length === 0 && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No manning requirements set for this site yet.</div>}
        {requirements.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-sm">
            <span style={{ color: "var(--ch-ink)" }}>{jobRoles.find((j) => j.id === r.job_role_id)?.name ?? "Unknown role"}</span>
            <span style={{ color: "var(--ch-sub)" }}>min {r.minimum_headcount}</span>
            <button onClick={() => deleteManningRequirement(r.id).then(onChanged)} className="text-xs" style={{ color: "var(--ch-fail)" }}>Remove</button>
          </div>
        ))}
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

function DocumentTypesPanel({ documentTypes, onChanged }: { documentTypes: DocumentType[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      {adding ? (
        <DocumentTypeForm onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add document type</button>
      )}

      <div className="space-y-2 mt-4">
        {documentTypes.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No document types yet.</div>}
        {documentTypes.map((d) =>
          editingId === d.id ? (
            <DocumentTypeForm key={d.id} documentType={d} onDone={() => { setEditingId(null); onChanged(); }} onCancel={() => setEditingId(null)} />
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
              </div>
              <button onClick={() => setEditingId(d.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
              <DeleteButton onDelete={() => deleteDocumentType(d.id).then(onChanged)} label="document type" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function DocumentTypeForm({
  documentType,
  onDone,
  onCancel,
}: {
  documentType?: DocumentType;
  onDone: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("category", category);
    fd.set("defaultValidityMonths", defaultValidityMonths);
    fd.set("warningThresholdDays", warningThresholdDays);
    if (tracksNumber) fd.set("tracksNumber", "on");
    if (isActive) fd.set("isActive", "on");
    startTransition(async () => {
      const res = documentType ? await updateDocumentType(documentType.id, fd) : await createDocumentType(fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
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
        <button onClick={save} disabled={pending || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Shared ================= */

function DeleteButton({ onDelete, label }: { onDelete: () => Promise<any>; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        if (!window.confirm(`Delete this ${label}?`)) return;
        startTransition(async () => {
          await onDelete();
        });
      }}
      disabled={pending}
      className="text-xs font-semibold disabled:opacity-50"
      style={{ color: "var(--ch-fail)" }}
    >
      Delete
    </button>
  );
}
