"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createProject, deleteProject } from "./actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";
import { StatusPill } from "@/app/contracts/contracts-manager";
import { COUNTRIES } from "@/lib/countries";
import { REGIONS } from "@/lib/regions";

type Project = {
  id: string;
  project_code: string | null;
  project_name: string;
  status: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  expected_pob: number | null;
  contract_title: string;
  contractor_name: string;
};
type ContractRef = { id: string; contract_title: string; status: string; client_id: string };
type ContractorRef = { id: string; name: string; is_active: boolean; client_id: string };
type Member = { id: string; full_name: string };

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };
const PROJECT_STATUSES = ["planned", "mobilizing", "active", "demobilizing", "completed", "cancelled"];

export default function ProjectsManager({
  projects,
  contracts,
  contractors,
  members,
  canManage,
  defaultContractId,
}: {
  projects: Project[];
  contracts: ContractRef[];
  contractors: ContractorRef[];
  members: Member[];
  canManage: boolean;
  defaultContractId: string;
}) {
  const router = useRouter();
  const { items, addOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(projects);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(!!defaultContractId);
  const [bgError, setBgError] = useState<string | null>(null);
  const [bgWarning, setBgWarning] = useState<string | null>(null);

  const submitCreate = (fd: FormData, optimisticItem: Project) => {
    setBgError(null);
    setBgWarning(null);
    addOptimistic(optimisticItem);
    setAdding(false);
    startTransition(async () => {
      const res = await createProject(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't save "${optimisticItem.project_name}": ${res.error}`);
        return;
      }
      if (res?.warning) setBgWarning(res.warning);
      if (res?.id) {
        router.push(`/projects/${res.id}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (project: Project, index: number) => {
    if (!window.confirm(`Delete "${project.project_name}"? This can't be undone.`)) return;
    setBgError(null);
    removeOptimistic(project.id);
    startTransition(async () => {
      const res = await deleteProject(project.id);
      if (res?.error) {
        restoreOptimistic(project, index);
        setBgError(`Couldn't delete "${project.project_name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {bgError && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{bgError}</div>
      )}
      {bgWarning && (
        <div className="text-sm mb-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>{bgWarning}</div>
      )}

      {canManage &&
        (adding ? (
          <ProjectForm
            contracts={contracts}
            contractors={contractors}
            members={members}
            defaultContractId={defaultContractId}
            onSubmit={(fd, values) => submitCreate(fd, { id: tempId(), project_code: null, ...values })}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add project</button>
        ))}

      <div className="space-y-2 mt-4">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No projects yet.</div>}
        {items.map((p, i) => (
          <div key={p.id} className={`${cardCls} p-3 flex items-center gap-3 flex-wrap`} style={cardStyle}>
            <div className="flex-1 min-w-[220px]">
              {p.project_code && (
                <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5 mr-2" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
                  {p.project_code}
                </span>
              )}
              {isTempId(p.id) ? (
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{p.project_name}</span>
              ) : (
                <Link href={`/projects/${p.id}`} className="text-sm font-semibold ch-link-navy">{p.project_name}</Link>
              )}
              <span className="ml-2"><StatusPill status={p.status} /></span>
              <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>{p.contract_title} · {p.contractor_name}</span>
              {p.expected_pob != null && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>POB {p.expected_pob}</span>}
              {isTempId(p.id) && <span className="text-xs ml-2 italic" style={{ color: "var(--ch-sub)" }}>Saving…</span>}
            </div>
            {canManage && !isTempId(p.id) && (
              <Link href={`/projects/${p.id}?edit=1`} className="text-xs font-semibold ch-link-navy">
                Edit
              </Link>
            )}
            {canManage && (
              <button onClick={() => submitDelete(p, i)} disabled={isTempId(p.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-fail)" }}>
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectForm({
  contracts,
  contractors,
  members,
  defaultContractId,
  onSubmit,
  onCancel,
}: {
  contracts: ContractRef[];
  contractors: ContractorRef[];
  members: Member[];
  defaultContractId: string;
  onSubmit: (fd: FormData, values: Omit<Project, "id" | "project_code">) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    contractId: defaultContractId || contracts[0]?.id || "",
    contractorId: "",
    projectName: "",
    clientReference: "",
    purchaseOrderNumber: "",
    country: "",
    operatingRegion: "",
    basePort: "",
    mobilizationLocation: "",
    demobilizationLocation: "",
    plannedStartDate: "",
    plannedEndDate: "",
    actualStartDate: "",
    actualEndDate: "",
    expectedPob: "",
    projectManagerUserId: "",
    operationsCoordinatorUserId: "",
    status: "planned",
    notes: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const selectedContract = contracts.find((c) => c.id === values.contractId);
  const eligibleContractors = useMemo(
    () => (selectedContract ? contractors.filter((c) => c.client_id === selectedContract.client_id) : contractors),
    [contractors, selectedContract]
  );

  const isValid =
    values.projectName.trim() &&
    values.contractId &&
    values.country &&
    values.operatingRegion &&
    values.plannedStartDate &&
    values.plannedEndDate &&
    values.expectedPob;

  const save = () => {
    if (!isValid || submitted) return;
    const fd = new FormData();
    Object.entries(values).forEach(([k, v]) => fd.set(k, v));
    setSubmitted(true);
    onSubmit(fd, {
      project_name: values.projectName.trim(),
      status: values.status,
      planned_start_date: values.plannedStartDate || null,
      planned_end_date: values.plannedEndDate || null,
      expected_pob: values.expectedPob ? Number(values.expectedPob) : null,
      contract_title: selectedContract?.contract_title ?? "—",
      contractor_name: contractors.find((c) => c.id === values.contractorId)?.name ?? "—",
    });
  };

  const field = (label: string, key: keyof typeof values, type = "text", required = false) => (
    <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
      {label} {required && <span style={{ color: "var(--ch-fail)" }}>*</span>}
      <input type={type} className={`${inputCls} w-full mt-1`} style={inputStyle} value={values[key]} onChange={set(key)} />
    </label>
  );

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Contract <span style={{ color: "var(--ch-fail)" }}>*</span>
          <select
            className={`${inputCls} w-full mt-1`}
            style={inputStyle}
            value={values.contractId}
            onChange={(e) => setValues((v) => ({ ...v, contractId: e.target.value, contractorId: "" }))}
          >
            {contracts.length === 0 && <option value="">No contracts yet</option>}
            {contracts.map((c) => (
              <option key={c.id} value={c.id} disabled={c.status === "completed" || c.status === "cancelled"}>
                {c.contract_title} {(c.status === "completed" || c.status === "cancelled") ? `(${c.status})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          EPC Contractor
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.contractorId} onChange={set("contractorId")}>
            <option value="">No EPC contractor</option>
            {eligibleContractors.map((c) => (
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
        <label className={lbl} style={lblStyle}>
          Project name <span style={{ color: "var(--ch-fail)" }}>*</span>
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="Project / campaign name" value={values.projectName} onChange={set("projectName")} />
        </label>
        {field("Client reference", "clientReference")}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        {field("Purchase order", "purchaseOrderNumber")}
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Country <span style={{ color: "var(--ch-fail)" }}>*</span>
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.country} onChange={set("country")}>
            <option value="">Country…</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Operating region <span style={{ color: "var(--ch-fail)" }}>*</span>
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={values.operatingRegion} onChange={set("operatingRegion")}>
            <option value="">Operating region…</option>
            {/* Same list as Sites/Crew Location (lib/regions.ts) — cities
                (the UAE's emirates) alongside every country, plus "Other". */}
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        {field("Base port", "basePort")}
        {field("Mobilization location", "mobilizationLocation")}
        {field("Demobilization location", "demobilizationLocation")}
      </div>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        {field("Planned start", "plannedStartDate", "date", true)}
        {field("Planned end", "plannedEndDate", "date", true)}
        {field("Actual start", "actualStartDate", "date")}
        {field("Actual end", "actualEndDate", "date")}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        {field("Expected POB", "expectedPob", "number", true)}
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
      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Notes
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={values.notes} onChange={set("notes")} />
      </label>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !isValid} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
