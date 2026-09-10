"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateProject, deleteProject } from "../actions";
import { StatusPill } from "@/app/contracts/contracts-manager";

type Project = {
  id: string;
  project_code: string | null;
  project_name: string;
  client_reference: string | null;
  purchase_order_number: string | null;
  country: string | null;
  operating_region: string | null;
  base_port: string | null;
  mobilization_location: string | null;
  demobilization_location: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  expected_pob: number | null;
  project_manager_user_id: string | null;
  operations_coordinator_user_id: string | null;
  status: string;
  notes: string | null;
  contract_id: string;
  contractor_id: string;
  contract_title: string;
  contract_status: string;
  client_name: string;
  contractor_name: string;
};
type Site = { id: string; name: string; code: string | null; site_type: string; status: string };
type ContractRef = { id: string; contract_title: string; status: string; client_id: string };
type ContractorRef = { id: string; name: string; is_active: boolean; client_id: string };
type Member = { id: string; full_name: string };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const PROJECT_STATUSES = ["planned", "mobilizing", "active", "demobilizing", "completed", "cancelled"];

function memberName(members: Member[], id: string | null) {
  if (!id) return "—";
  return members.find((m) => m.id === id)?.full_name ?? "—";
}

export default function ProjectDetail({
  project,
  sites,
  contracts,
  contractors,
  members,
  canManage,
}: {
  project: Project;
  sites: Site[];
  contracts: ContractRef[];
  contractors: ContractorRef[];
  members: Member[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const submitDelete = () => {
    if (!window.confirm(`Delete "${project.project_name}"? This can't be undone.`)) return;
    startTransition(async () => {
      const res = await deleteProject(project.id);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.push("/projects");
    });
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b last:border-0" style={{ borderColor: "var(--ch-line)" }}>
      <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{label}</span>
      <span className="text-sm text-right" style={{ color: "var(--ch-ink)" }}>{value ?? "—"}</span>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <Link href="/projects" className="text-xs font-semibold ch-link-navy">← All projects</Link>
      </div>

      <div className="text-xs mb-2 flex items-center gap-1.5 flex-wrap" style={{ color: "var(--ch-sub)" }}>
        <span>{project.client_name}</span>
        <span>›</span>
        <Link href={`/contracts/${project.contract_id}`} className="ch-link-navy">{project.contract_title}</Link>
        <span>›</span>
        <span>{project.contractor_name}</span>
        <span>›</span>
        <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{project.project_name}</span>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {project.project_code && (
            <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
              {project.project_code}
            </span>
          )}
          <h1 className="text-lg font-semibold" style={{ color: "var(--ch-ink)" }}>{project.project_name}</h1>
          <StatusPill status={project.status} />
        </div>
        {canManage && !editing && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold">Edit</button>
            <button onClick={submitDelete} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }}>
              Delete
            </button>
          </div>
        )}
      </div>

      {error && <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}
      {warning && <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>{warning}</div>}

      {editing ? (
        <ProjectForm
          project={project}
          contracts={contracts}
          contractors={contractors}
          members={members}
          onCancel={() => setEditing(false)}
          onSubmit={(fd) => {
            setError(null);
            setEditing(false);
            startTransition(async () => {
              const res = await updateProject(project.id, fd);
              if (res?.error) {
                setError(res.error);
                setEditing(true);
                return;
              }
              if (res?.warning) setWarning(res.warning);
              router.refresh();
            });
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={`${cardCls} p-4`} style={cardStyle}>
            <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Project information</div>
            {row("Client reference", project.client_reference)}
            {row("Purchase order", project.purchase_order_number)}
            {row("Country", project.country)}
            {row("Operating region", project.operating_region)}
            {row("Base port", project.base_port)}
            {row("Mobilization location", project.mobilization_location)}
            {row("Demobilization location", project.demobilization_location)}
            {row("Expected POB", project.expected_pob)}
          </div>
          <div className={`${cardCls} p-4`} style={cardStyle}>
            <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Key dates & team</div>
            {row("Planned dates", `${project.planned_start_date ?? "…"} – ${project.planned_end_date ?? "…"}`)}
            {row("Actual dates", `${project.actual_start_date ?? "…"} – ${project.actual_end_date ?? "…"}`)}
            {row("Project manager", memberName(members, project.project_manager_user_id))}
            {row("Operations coordinator", memberName(members, project.operations_coordinator_user_id))}
            {project.notes && (
              <div className="mt-3">
                <div className="text-xs mb-1" style={{ color: "var(--ch-sub)" }}>Notes</div>
                <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--ch-ink)" }}>{project.notes}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
          Offshore sites ({sites.length})
        </div>
        {sites.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--ch-sub)" }}>
            No sites attached to this project yet — assign this project to a site from Crew Setup › Offshore Sites.
          </div>
        ) : (
          <div className="space-y-2">
            {sites.map((s) => (
              <div key={s.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
                {s.code && (
                  <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                    {s.code}
                  </span>
                )}
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{s.name}</span>
                <span className="text-xs uppercase" style={{ color: "var(--ch-sub)" }}>{s.site_type}</span>
                {s.status !== "active" && <span className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>{s.status}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectForm({
  project,
  contracts,
  contractors,
  members,
  onSubmit,
  onCancel,
}: {
  project: Project;
  contracts: ContractRef[];
  contractors: ContractorRef[];
  members: Member[];
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    contractId: project.contract_id,
    contractorId: project.contractor_id,
    projectName: project.project_name,
    clientReference: project.client_reference ?? "",
    purchaseOrderNumber: project.purchase_order_number ?? "",
    country: project.country ?? "",
    operatingRegion: project.operating_region ?? "",
    basePort: project.base_port ?? "",
    mobilizationLocation: project.mobilization_location ?? "",
    demobilizationLocation: project.demobilization_location ?? "",
    plannedStartDate: project.planned_start_date ?? "",
    plannedEndDate: project.planned_end_date ?? "",
    actualStartDate: project.actual_start_date ?? "",
    actualEndDate: project.actual_end_date ?? "",
    expectedPob: project.expected_pob?.toString() ?? "",
    projectManagerUserId: project.project_manager_user_id ?? "",
    operationsCoordinatorUserId: project.operations_coordinator_user_id ?? "",
    status: project.status,
    notes: project.notes ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const save = () => {
    if (!values.projectName.trim() || !values.contractId || !values.contractorId || submitted) return;
    const fd = new FormData();
    Object.entries(values).forEach(([k, v]) => fd.set(k, v));
    setSubmitted(true);
    onSubmit(fd);
  };

  const field = (label: string, key: keyof typeof values, type = "text") => (
    <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
      {label}
      <input type={type} className={`${inputCls} w-full mt-1`} style={inputStyle} value={values[key]} onChange={set(key)} />
    </label>
  );

  return (
    <div className={`${cardCls} p-4`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Contract
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.contractId} onChange={set("contractId")}>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.contract_title}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          EPC Contractor
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.contractorId} onChange={set("contractorId")}>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Status
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.status} onChange={set("status")}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Project / campaign name" value={values.projectName} onChange={set("projectName")} />
        {field("Client reference", "clientReference")}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        {field("Purchase order", "purchaseOrderNumber")}
        {field("Country", "country")}
        {field("Operating region", "operatingRegion")}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        {field("Base port", "basePort")}
        {field("Mobilization location", "mobilizationLocation")}
        {field("Demobilization location", "demobilizationLocation")}
      </div>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        {field("Planned start", "plannedStartDate", "date")}
        {field("Planned end", "plannedEndDate", "date")}
        {field("Actual start", "actualStartDate", "date")}
        {field("Actual end", "actualEndDate", "date")}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        {field("Expected POB", "expectedPob", "number")}
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Project manager
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.projectManagerUserId} onChange={set("projectManagerUserId")}>
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Operations coordinator
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.operationsCoordinatorUserId} onChange={set("operationsCoordinatorUserId")}>
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </label>
      </div>
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={values.notes} onChange={set("notes")} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !values.projectName.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
