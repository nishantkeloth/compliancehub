"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setManningRequirement, deleteManningRequirement, updateOffshoreSite } from "@/app/crew/setup/actions";
import { syncManningLineFromSiteRequirement } from "../actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";
import { COUNTRIES } from "@/lib/countries";
import { REGIONS } from "@/lib/regions";
import type { Ref, DocTemplate } from "./lines-editor";

export type SiteInfo = {
  id: string;
  name: string;
  code: string | null;
  site_type: string | null;
  country: string | null;
  operating_region: string | null;
  port_or_heliport: string | null;
  crew_change_location: string | null;
  status: string | null;
  notes: string | null;
  contractor_id: string | null;
  project_id: string | null;
  standard_rotation_template_id: string | null;
};
export type ManningReq = {
  id: string;
  offshore_site_id: string;
  job_role_id: string;
  minimum_headcount: number;
  preferred_document_template_id: string | null;
};

// Same shapes as app/sites/sites-panel.tsx (the standalone Offshore Sites
// page) — kept here too so the Crew Matrix's Site tab can edit every field
// that page used to be the only place to edit.
export type Contractor = { id: string; name: string; client_id: string };
export type ClientRef = { id: string; name: string };
export type ProjectRef = { id: string; project_name: string; contractor_id: string | null };

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

const SITE_TYPES = ["vessel", "rig", "platform", "barge", "camp", "fpso", "other"];

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

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span style={{ color: "var(--ch-sub)" }}>{label}</span>
      <span style={{ color: "var(--ch-ink)" }}>{value}</span>
    </div>
  );
}

type SiteFormState = {
  name: string;
  code: string;
  siteType: string;
  contractorId: string;
  projectId: string;
  country: string;
  operatingRegion: string;
  portOrHeliport: string;
  crewChangeLocation: string;
  rotationTemplateId: string;
  status: string;
  notes: string;
};

function siteToFormState(site: SiteInfo): SiteFormState {
  return {
    name: site.name ?? "",
    code: site.code ?? "",
    siteType: site.site_type ?? "other",
    contractorId: site.contractor_id ?? "",
    projectId: site.project_id ?? "",
    country: site.country ?? "",
    operatingRegion: site.operating_region ?? "",
    portOrHeliport: site.port_or_heliport ?? "",
    crewChangeLocation: site.crew_change_location ?? "",
    rotationTemplateId: site.standard_rotation_template_id ?? "",
    status: site.status ?? "active",
    notes: site.notes ?? "",
  };
}

function SiteEditForm({
  form,
  setForm,
  contractors,
  eligibleProjects,
  rotationTemplates,
  error,
  saving,
  onSave,
  onCancel,
}: {
  form: SiteFormState;
  setForm: (updater: (prev: SiteFormState) => SiteFormState) => void;
  contractors: Contractor[];
  eligibleProjects: ProjectRef[];
  rotationTemplates: Ref[];
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel?: () => void;
}) {
  const set = <K extends keyof SiteFormState>(key: K, value: SiteFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className={lbl} style={lblStyle}>
          Site name
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Code
          <input className={`${inputCls} w-full mt-1`} style={{ ...inputStyle, background: "var(--ch-paper)", color: "var(--ch-sub)" }} value={form.code || "—"} disabled readOnly />
          <span className="block mt-1" style={{ color: "var(--ch-sub)" }}>Auto-assigned, can&rsquo;t be changed.</span>
        </label>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className={lbl} style={lblStyle}>
          Site type
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.siteType} onChange={(e) => set("siteType", e.target.value)}>
            {SITE_TYPES.map((t) => (
              <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Status
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className={lbl} style={lblStyle}>
          EPC contractor
          <select
            className={`${inputCls} w-full mt-1`}
            style={inputStyle}
            value={form.contractorId}
            onChange={(e) => setForm((prev) => ({ ...prev, contractorId: e.target.value, projectId: "" }))}
          >
            <option value="">No EPC contractor</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Project
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.projectId} onChange={(e) => set("projectId", e.target.value)}>
            <option value="">
              {eligibleProjects.length ? "No project" : form.contractorId ? "No projects under this contractor" : "No contractor-less projects"}
            </option>
            {eligibleProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.project_name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className={lbl} style={lblStyle}>
          Country
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.country} onChange={(e) => set("country", e.target.value)}>
            <option value="">Country…</option>
            {form.country && !COUNTRIES.includes(form.country as (typeof COUNTRIES)[number]) && (
              <option value={form.country}>{form.country} (unmatched — pick below)</option>
            )}
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Operating region
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.operatingRegion} onChange={(e) => set("operatingRegion", e.target.value)}>
            <option value="">Operating region…</option>
            {form.operatingRegion && !REGIONS.includes(form.operatingRegion) && (
              <option value={form.operatingRegion}>{form.operatingRegion} (unmatched — pick below)</option>
            )}
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className={lbl} style={lblStyle}>
          Port / heliport
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.portOrHeliport} onChange={(e) => set("portOrHeliport", e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Crew-change location
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.crewChangeLocation} onChange={(e) => set("crewChangeLocation", e.target.value)} />
        </label>
      </div>
      <label className={`${lbl} block`} style={lblStyle}>
        Standard rotation template
        <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={form.rotationTemplateId} onChange={(e) => set("rotationTemplateId", e.target.value)}>
          <option value="">No standard rotation</option>
          {rotationTemplates.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <label className={`${lbl} block`} style={lblStyle}>
        Notes
        <textarea className={`${inputCls} w-full mt-1`} style={inputStyle} rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      {error && (
        <div className="text-xs" style={{ color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onSave} disabled={saving || !form.name.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {onCancel && (
          <button onClick={onCancel} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold border disabled:opacity-50" style={{ borderColor: "var(--ch-line)" }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default function SiteTab({
  crewMatrixId,
  isDraft,
  editingEnabled,
  existingLineRoleIds,
  site,
  contractors,
  clients,
  projects,
  rotationTemplates,
  jobRoles,
  manningRequirements,
  documentTemplates,
  canManageManning,
  canEditSite,
}: {
  // The matrix this Site tab is opened from — checking off a role below
  // also adds a manning line to THIS matrix (see syncManningLineFromSiteRequirement),
  // and isDraft/editingEnabled gate that the same way the Manning Lines tab
  // gates its own editing, since a line can only change while the matrix is
  // a draft.
  crewMatrixId: string;
  isDraft: boolean;
  // Page-level "Edit" toggle (see matrix-detail.tsx) — when on, the Site
  // card shows its edit form directly, same as the Manning Lines tab
  // unlocking via the same flag. The card's own "Edit" link still works as
  // a fallback when this is off (e.g. a non-draft matrix, where the
  // page-level toggle isn't shown at all) so site details stay editable
  // independent of the matrix's own draft/edit state.
  editingEnabled: boolean;
  // job_role_id of every line this matrix already has — used only to spot
  // a role that's checked here but has no matching line yet (checked
  // before this matrix existed, checked from the standalone Sites page,
  // or a sync that failed partway) and offer a one-click "Sync now" to
  // catch it up. Toggling a role live already keeps the two in step; this
  // is just for whatever was already checked before that existed.
  existingLineRoleIds: string[];
  site: SiteInfo;
  contractors: Contractor[];
  clients: ClientRef[];
  projects: ProjectRef[];
  rotationTemplates: Ref[];
  jobRoles: Ref[];
  manningRequirements: ManningReq[];
  documentTemplates: DocTemplate[];
  canManageManning: boolean;
  canEditSite: boolean;
}) {
  const router = useRouter();
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(manningRequirements);
  const [, startTransition] = useTransition();
  const [bgError, setBgError] = useState<string | null>(null);
  // Local text state for the headcount inputs, keyed by job role, so typing
  // doesn't save on every keystroke — committed onBlur.
  const [headcountDraft, setHeadcountDraft] = useState<Record<string, string>>({});

  const byRoleId = new Map(items.map((r) => [r.job_role_id, r]));

  // Every save is a full-row upsert (site_manning_requirements is unique on
  // offshore_site_id + job_role_id) — always sends the row's current
  // headcount and template together, so updating one never clobbers the
  // other back to blank.
  const submit = (jobRoleId: string, minimumHeadcount: number, preferredDocumentTemplateId: string | null) => {
    const fd = new FormData();
    fd.set("jobRoleId", jobRoleId);
    fd.set("minimumHeadcount", String(minimumHeadcount));
    if (preferredDocumentTemplateId) fd.set("preferredDocumentTemplateId", preferredDocumentTemplateId);
    return setManningRequirement(site.id, fd);
  };

  // Keeps this matrix's own crew_matrix_lines in sync with the checklist
  // below — only while the matrix is still a draft (a line can't change
  // otherwise, same rule the Manning Lines tab follows). Errors here are
  // surfaced but don't roll back the site_manning_requirements change that
  // already succeeded — the checklist and the matrix's lines can be
  // reconciled by re-toggling if the two ever disagree.
  const syncLine = (jobRoleId: string, active: boolean, minimumHeadcount: number, preferredDocumentTemplateId: string | null) => {
    if (!isDraft) return;
    startTransition(async () => {
      const res = await syncManningLineFromSiteRequirement(crewMatrixId, jobRoleId, active, minimumHeadcount, preferredDocumentTemplateId);
      if (res?.error) setBgError(res.error);
      router.refresh();
    });
  };

  // Roles checked off here that this matrix has no line for yet — normally
  // empty, since toggling a role live keeps the two in step, but a role
  // checked before this matrix existed (or from the standalone Sites page,
  // which only ever writes the site-level requirement, never a matrix
  // line) shows up here until "Sync now" is clicked.
  const missingFromLines = isDraft ? items.filter((r) => !isTempId(r.id) && !existingLineRoleIds.includes(r.job_role_id)) : [];
  const [syncingAll, setSyncingAll] = useState(false);

  const syncAllMissing = () => {
    if (syncingAll || missingFromLines.length === 0) return;
    setBgError(null);
    setSyncingAll(true);
    startTransition(async () => {
      for (const r of missingFromLines) {
        const res = await syncManningLineFromSiteRequirement(crewMatrixId, r.job_role_id, true, r.minimum_headcount, r.preferred_document_template_id);
        if (res?.error) {
          setBgError(res.error);
          break;
        }
      }
      setSyncingAll(false);
      router.refresh();
    });
  };

  const toggle = (role: Ref, checked: boolean) => {
    setBgError(null);
    if (checked) {
      const optimisticItem: ManningReq = {
        id: tempId(),
        offshore_site_id: site.id,
        job_role_id: role.id,
        minimum_headcount: 1,
        preferred_document_template_id: null,
      };
      addOptimistic(optimisticItem);
      startTransition(async () => {
        const res = await submit(role.id, 1, null);
        if (res?.error) {
          removeOptimistic(optimisticItem.id);
          setBgError(res.error);
          return;
        }
        router.refresh();
      });
      syncLine(role.id, true, 1, null);
    } else {
      const existing = byRoleId.get(role.id);
      if (!existing || isTempId(existing.id)) return;
      const index = items.findIndex((r) => r.id === existing.id);
      removeOptimistic(existing.id);
      startTransition(async () => {
        const res = await deleteManningRequirement(existing.id);
        if (res?.error) {
          restoreOptimistic(existing, index);
          setBgError(res.error);
        }
      });
      syncLine(role.id, false, 0, null);
    }
  };

  const commitHeadcount = (req: ManningReq, raw: string) => {
    setHeadcountDraft((prev) => {
      const next = { ...prev };
      delete next[req.job_role_id];
      return next;
    });
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1 || value === req.minimum_headcount) return;
    setBgError(null);
    updateOptimistic(req.id, { minimum_headcount: value });
    startTransition(async () => {
      const res = await submit(req.job_role_id, value, req.preferred_document_template_id);
      if (res?.error) {
        updateOptimistic(req.id, { minimum_headcount: req.minimum_headcount });
        setBgError(res.error);
        return;
      }
      router.refresh();
    });
    syncLine(req.job_role_id, true, value, req.preferred_document_template_id);
  };

  const setTemplate = (req: ManningReq, templateId: string) => {
    setBgError(null);
    const nextTemplateId = templateId || null;
    updateOptimistic(req.id, { preferred_document_template_id: nextTemplateId });
    startTransition(async () => {
      const res = await submit(req.job_role_id, req.minimum_headcount, nextTemplateId);
      if (res?.error) {
        updateOptimistic(req.id, { preferred_document_template_id: req.preferred_document_template_id });
        setBgError(res.error);
        return;
      }
      router.refresh();
    });
  };

  // ---- Site details, editable in place (previously only editable from the
  // standalone Offshore Sites page) ----
  // editingSiteLocal is this card's own fallback toggle (its "Edit" link),
  // for when there's no page-level editingEnabled to piggyback on (e.g. a
  // non-draft matrix, where matrix-detail.tsx doesn't render its top "Edit"
  // button at all) — editingEnabled from the page just as validly puts this
  // card in edit mode, so the two are combined below rather than one
  // overriding the other.
  const [editingSiteLocal, setEditingSiteLocal] = useState(false);
  const editingSite = editingEnabled || editingSiteLocal;
  const [siteForm, setSiteForm] = useState<SiteFormState>(() => siteToFormState(site));
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [, startSiteTransition] = useTransition();

  const startEditSite = () => {
    setSiteForm(siteToFormState(site));
    setSiteError(null);
    setEditingSiteLocal(true);
  };

  const eligibleProjects = siteForm.contractorId
    ? projects.filter((p) => p.contractor_id === siteForm.contractorId || p.contractor_id === null)
    : projects.filter((p) => p.contractor_id === null);

  const contractorLabel = (id: string | null) => {
    const contractor = contractors.find((c) => c.id === id);
    if (!contractor) return null;
    const client = clients.find((cl) => cl.id === contractor.client_id);
    return client ? `${contractor.name} (${client.name})` : contractor.name;
  };

  const saveSite = () => {
    if (!siteForm.name.trim() || siteSaving) return;
    setSiteError(null);
    setSiteSaving(true);
    const fd = new FormData();
    fd.set("name", siteForm.name.trim());
    fd.set("siteType", siteForm.siteType);
    fd.set("contractorId", siteForm.contractorId);
    fd.set("projectId", siteForm.projectId);
    fd.set("country", siteForm.country.trim());
    fd.set("operatingRegion", siteForm.operatingRegion.trim());
    fd.set("portOrHeliport", siteForm.portOrHeliport.trim());
    fd.set("crewChangeLocation", siteForm.crewChangeLocation.trim());
    fd.set("standardRotationTemplateId", siteForm.rotationTemplateId);
    fd.set("status", siteForm.status);
    fd.set("notes", siteForm.notes.trim());
    startSiteTransition(async () => {
      const res = await updateOffshoreSite(site.id, fd);
      setSiteSaving(false);
      if (res?.error) {
        setSiteError(res.error);
        return;
      }
      setEditingSiteLocal(false);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Site</div>
          {canEditSite && !editingSite && (
            <button onClick={startEditSite} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>
              Edit
            </button>
          )}
        </div>
        {editingSite ? (
          <SiteEditForm
            form={siteForm}
            setForm={setSiteForm}
            contractors={contractors}
            eligibleProjects={eligibleProjects}
            rotationTemplates={rotationTemplates}
            error={siteError}
            saving={siteSaving}
            onSave={saveSite}
            // Only offered when editing was started locally (this card's own
            // "Edit" link) — when it's the page-level toggle driving this,
            // the way out is the page's "Done editing" button, same as the
            // Manning Lines tab.
            onCancel={editingSiteLocal ? () => setEditingSiteLocal(false) : undefined}
          />
        ) : (
          <>
            <Row label="Name" value={site.name} />
            <Row label="Code" value={site.code} />
            <Row label="Type" value={site.site_type} />
            <Row label="EPC contractor" value={contractorLabel(site.contractor_id)} />
            <Row label="Project" value={projects.find((p) => p.id === site.project_id)?.project_name} />
            <Row label="Country" value={site.country} />
            <Row label="Operating region" value={site.operating_region} />
            <Row label="Port / heliport" value={site.port_or_heliport} />
            <Row label="Crew-change location" value={site.crew_change_location} />
            <Row label="Standard rotation" value={rotationTemplates.find((r) => r.id === site.standard_rotation_template_id)?.name} />
            <Row label="Status" value={site.status} />
            {site.notes && (
              <div className="text-xs mt-3 pt-2 border-t" style={{ color: "var(--ch-sub)", borderColor: "var(--ch-line)" }}>
                {site.notes}
              </div>
            )}
            {!canEditSite && (
              <div className="text-xs mt-3" style={{ color: "var(--ch-sub)" }}>
                You don&rsquo;t have permission to edit site details.
              </div>
            )}
          </>
        )}
      </div>

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
          Manning requirements
        </div>
        <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
          Check off every role this site needs, with its minimum headcount.
          {isDraft
            ? " Since this matrix is still a draft, checking a role also adds a manning line for it here (unchecking removes it) — see the Manning Lines tab. Richer per-line detail (shifts, rotation, documents, remarks) is still edited there."
            : " This matrix is no longer a draft, so changes here update the site's manning requirements for future matrices, but won't add or remove lines on this one."}
          {" "}Optionally pick a document template per role too, so a line for that role starts with that
          template&rsquo;s document checklist already applied.
        </div>
        <BgErrorBanner error={bgError} />
        {missingFromLines.length > 0 && (
          <div className="text-xs rounded-lg px-3 py-2 mb-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}>
            <span>
              {missingFromLines.length} checked role{missingFromLines.length === 1 ? "" : "s"} {missingFromLines.length === 1 ? "isn’t" : "aren’t"} reflected as
              manning lines yet.
            </span>
            {canManageManning && (
              <button onClick={syncAllMissing} disabled={syncingAll} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                {syncingAll ? "Syncing…" : "Sync now"}
              </button>
            )}
          </div>
        )}
        {jobRoles.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No job roles configured yet — add some under Crew Setup.</div>
        ) : (
          <div className="space-y-1.5">
            {jobRoles.map((role) => {
              const req = byRoleId.get(role.id);
              const selected = !!req;
              const saving = !!req && isTempId(req.id);
              const templatesForRole = documentTemplates.filter((t) => t.job_role_id === role.id);
              return (
                <div key={role.id} className="flex items-center gap-3 flex-wrap text-xs py-1">
                  <label className="flex items-center gap-2 min-w-[160px]" style={{ color: "var(--ch-ink)" }}>
                    <input type="checkbox" checked={selected} disabled={!canManageManning || saving} onChange={(e) => toggle(role, e.target.checked)} />
                    <span className={selected ? "font-semibold" : ""}>{role.name}</span>
                  </label>
                  {req && (
                    <>
                      <label className="flex items-center gap-1" style={{ color: "var(--ch-sub)" }}>
                        min headcount
                        <input
                          type="number"
                          min={1}
                          disabled={!canManageManning || saving}
                          className="border rounded px-1.5 py-0.5 w-16 text-xs"
                          style={{ borderColor: "var(--ch-line)" }}
                          value={headcountDraft[role.id] ?? req.minimum_headcount.toString()}
                          onChange={(e) => setHeadcountDraft((prev) => ({ ...prev, [role.id]: e.target.value }))}
                          onBlur={(e) => commitHeadcount(req, e.target.value)}
                        />
                      </label>
                      {templatesForRole.length > 0 &&
                        (canManageManning ? (
                          <select
                            className="border rounded-lg px-2 py-1 text-xs"
                            style={{ borderColor: "var(--ch-line)" }}
                            disabled={saving}
                            value={req.preferred_document_template_id ?? ""}
                            onChange={(e) => setTemplate(req, e.target.value)}
                          >
                            <option value="">No document template</option>
                            {templatesForRole.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        ) : (
                          req.preferred_document_template_id && (
                            <span style={{ color: "var(--ch-sub)" }}>
                              {templatesForRole.find((t) => t.id === req.preferred_document_template_id)?.name ?? "Template"}
                            </span>
                          )
                        ))}
                      <SavingTag id={req.id} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
