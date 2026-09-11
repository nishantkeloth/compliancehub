"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createOffshoreSite,
  updateOffshoreSite,
  deleteOffshoreSite,
  setManningRequirement,
  deleteManningRequirement,
} from "@/app/crew/setup/actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";

type JobRole = { id: string; name: string; category: string | null; is_active: boolean };
type Client = { id: string; name: string };
type Contractor = { id: string; name: string; client_id: string };
type RotationTemplate = { id: string; name: string };
export type OffshoreSite = {
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
  project_id: string | null;
};
type Project = { id: string; project_name: string; contractor_id: string };
type ManningReq = { id: string; offshore_site_id: string; job_role_id: string; minimum_headcount: number };

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

/* ================= Offshore Sites ================= */

const SITE_TYPES = ["vessel", "rig", "platform", "barge", "camp", "fpso", "other"];

export default function OffshoreSitesPanel({
  sites,
  contractors,
  clients,
  rotationTemplates,
  jobRoles,
  manningRequirements,
  projects,
}: {
  sites: OffshoreSite[];
  contractors: Contractor[];
  clients: Client[];
  rotationTemplates: RotationTemplate[];
  jobRoles: JobRole[];
  manningRequirements: ManningReq[];
  projects: Project[];
}) {
  const router = useRouter();
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(sites);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const contractorLabel = (id: string | null) => {
    const contractor = contractors.find((c) => c.id === id);
    if (!contractor) return "—";
    const client = clients.find((cl) => cl.id === contractor.client_id);
    return client ? `${contractor.name} (${client.name})` : contractor.name;
  };

  const submitCreate = (fd: FormData, optimisticItem: OffshoreSite) => {
    setBgError(null);
    addOptimistic(optimisticItem);
    setAdding(false);
    startTransition(async () => {
      const res = await createOffshoreSite(fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(`Couldn't save "${optimisticItem.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitUpdate = (site: OffshoreSite, fd: FormData, patch: Partial<OffshoreSite>) => {
    setBgError(null);
    updateOptimistic(site.id, patch);
    setEditingId(null);
    startTransition(async () => {
      const res = await updateOffshoreSite(site.id, fd);
      if (res?.error) {
        updateOptimistic(site.id, site);
        setBgError(`Couldn't update "${site.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (site: OffshoreSite, index: number) => {
    setBgError(null);
    removeOptimistic(site.id);
    startTransition(async () => {
      const res = await deleteOffshoreSite(site.id);
      if (res?.error) {
        restoreOptimistic(site, index);
        setBgError(`Couldn't delete "${site.name}": ${res.error}`);
      }
    });
  };

  return (
    <div>
      <BgErrorBanner error={bgError} />
      {adding ? (
        <OffshoreSiteForm
          contractors={contractors}
          rotationTemplates={rotationTemplates}
          projects={projects}
          onSubmit={(fd, values) => submitCreate(fd, { id: tempId(), ...values })}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add offshore site</button>
      )}

      <div className="space-y-2 mt-4">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No offshore sites yet.</div>}
        {items.map((s, i) =>
          editingId === s.id ? (
            <OffshoreSiteForm
              key={s.id}
              site={s}
              contractors={contractors}
              rotationTemplates={rotationTemplates}
              projects={projects}
              onSubmit={(fd, values) => submitUpdate(s, fd, values)}
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
                  <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
                    {projects.find((p) => p.id === s.project_id)?.project_name ?? "No project"}
                  </span>
                  {s.status !== "active" && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
                  <SavingTag id={s.id} />
                </div>
                <button
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  disabled={isTempId(s.id)}
                  className="text-xs font-semibold disabled:opacity-40"
                  style={{ color: "var(--ch-navy)" }}
                >
                  {expandedId === s.id ? "Hide manning" : "Manning requirements"}
                </button>
                <button onClick={() => setEditingId(s.id)} disabled={isTempId(s.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-navy)" }}>Edit</button>
                <DeleteButton onConfirm={() => submitDelete(s, i)} disabled={isTempId(s.id)} label="site" />
              </div>
              {expandedId === s.id && (
                <div className="border-t px-3 py-3" style={{ borderColor: "var(--ch-line)" }}>
                  <ManningRequirementsEditor
                    siteId={s.id}
                    jobRoles={jobRoles}
                    requirements={manningRequirements.filter((m) => m.offshore_site_id === s.id)}
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
  projects,
  onSubmit,
  onCancel,
}: {
  site?: OffshoreSite;
  contractors: Contractor[];
  rotationTemplates: RotationTemplate[];
  projects: Project[];
  onSubmit: (fd: FormData, values: Omit<OffshoreSite, "id">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(site?.name ?? "");
  const [code, setCode] = useState(site?.code ?? "");
  const [siteType, setSiteType] = useState(site?.site_type ?? "other");
  const [contractorId, setContractorId] = useState(site?.contractor_id ?? "");
  const [projectId, setProjectId] = useState(site?.project_id ?? "");
  const [country, setCountry] = useState(site?.country ?? "");
  const [operatingRegion, setOperatingRegion] = useState(site?.operating_region ?? "");
  const [portOrHeliport, setPortOrHeliport] = useState(site?.port_or_heliport ?? "");
  const [crewChangeLocation, setCrewChangeLocation] = useState(site?.crew_change_location ?? "");
  const [rotationTemplateId, setRotationTemplateId] = useState(site?.standard_rotation_template_id ?? "");
  const [status, setStatus] = useState(site?.status ?? "active");
  const [notes, setNotes] = useState(site?.notes ?? "");
  const [submitted, setSubmitted] = useState(false);

  // Only offer projects that belong to the selected EPC contractor — a
  // site's project must run under the same contractor it's assigned to.
  const eligibleProjects = projects.filter((p) => p.contractor_id === contractorId);

  const save = () => {
    if (!name.trim() || submitted) return;
    const fd = new FormData();
    fd.set("name", name.trim());
    fd.set("code", code.trim());
    fd.set("siteType", siteType);
    fd.set("contractorId", contractorId);
    fd.set("projectId", projectId);
    fd.set("country", country.trim());
    fd.set("operatingRegion", operatingRegion.trim());
    fd.set("portOrHeliport", portOrHeliport.trim());
    fd.set("crewChangeLocation", crewChangeLocation.trim());
    fd.set("standardRotationTemplateId", rotationTemplateId);
    fd.set("status", status);
    fd.set("notes", notes.trim());
    setSubmitted(true);
    onSubmit(fd, {
      name: name.trim(),
      code: code.trim() || null,
      site_type: siteType,
      contractor_id: contractorId || null,
      project_id: projectId || null,
      country: country.trim() || null,
      operating_region: operatingRegion.trim() || null,
      port_or_heliport: portOrHeliport.trim() || null,
      crew_change_location: crewChangeLocation.trim() || null,
      standard_rotation_template_id: rotationTemplateId || null,
      status,
      notes: notes.trim() || null,
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
        <select
          className={inputCls}
          style={inputStyle}
          value={contractorId}
          onChange={(e) => {
            setContractorId(e.target.value);
            setProjectId("");
          }}
        >
          <option value="">No EPC contractor</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className={inputCls} style={inputStyle} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!contractorId}>
          <option value="">{contractorId ? "No project" : "Pick a contractor first"}</option>
          {eligibleProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.project_name}</option>
          ))}
        </select>
        <input className={inputCls} style={inputStyle} placeholder="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Operating region" value={operatingRegion} onChange={(e) => setOperatingRegion(e.target.value)} />
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
        <button onClick={save} disabled={submitted || !name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

function ManningRequirementsEditor({
  siteId,
  jobRoles,
  requirements,
}: {
  siteId: string;
  jobRoles: JobRole[];
  requirements: ManningReq[];
}) {
  const router = useRouter();
  const { items, addOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(requirements);
  const [, startTransition] = useTransition();
  const [jobRoleId, setJobRoleId] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const add = () => {
    if (!jobRoleId) return;
    setError(null);
    setBgError(null);
    const fd = new FormData();
    fd.set("jobRoleId", jobRoleId);
    fd.set("minimumHeadcount", headcount);
    const optimisticItem: ManningReq = {
      id: tempId(),
      offshore_site_id: siteId,
      job_role_id: jobRoleId,
      minimum_headcount: Number(headcount) || 1,
    };
    addOptimistic(optimisticItem);
    setJobRoleId("");
    setHeadcount("1");
    startTransition(async () => {
      const res = await setManningRequirement(siteId, fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const remove = (req: ManningReq, index: number) => {
    setBgError(null);
    removeOptimistic(req.id);
    startTransition(async () => {
      const res = await deleteManningRequirement(req.id);
      if (res?.error) {
        restoreOptimistic(req, index);
        setBgError(res.error);
      }
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
        <button onClick={add} disabled={!jobRoleId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
          Set requirement
        </button>
      </div>
      <ErrorLine error={error} />
      <BgErrorBanner error={bgError} />
      <div className="space-y-1.5">
        {items.length === 0 && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No manning requirements set for this site yet.</div>}
        {items.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2 text-sm">
            <span style={{ color: "var(--ch-ink)" }}>{jobRoles.find((j) => j.id === r.job_role_id)?.name ?? "Unknown role"}</span>
            <span style={{ color: "var(--ch-sub)" }}>min {r.minimum_headcount}</span>
            <SavingTag id={r.id} />
            <button onClick={() => remove(r, i)} disabled={isTempId(r.id)} className="text-xs disabled:opacity-40" style={{ color: "var(--ch-fail)" }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
