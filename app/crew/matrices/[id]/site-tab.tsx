"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setManningRequirement, deleteManningRequirement } from "@/app/crew/setup/actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";
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
};
export type ManningReq = {
  id: string;
  offshore_site_id: string;
  job_role_id: string;
  minimum_headcount: number;
  preferred_document_template_id: string | null;
};

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };

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

export default function SiteTab({
  site,
  jobRoles,
  manningRequirements,
  documentTemplates,
  canManageManning,
}: {
  site: SiteInfo;
  jobRoles: Ref[];
  manningRequirements: ManningReq[];
  documentTemplates: DocTemplate[];
  canManageManning: boolean;
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>Site</div>
        <Row label="Name" value={site.name} />
        <Row label="Code" value={site.code} />
        <Row label="Type" value={site.site_type} />
        <Row label="Country" value={site.country} />
        <Row label="Operating region" value={site.operating_region} />
        <Row label="Port / heliport" value={site.port_or_heliport} />
        <Row label="Crew-change location" value={site.crew_change_location} />
        <Row label="Status" value={site.status} />
        <div className="text-xs mt-3" style={{ color: "var(--ch-sub)" }}>
          To change these details, edit the site from{" "}
          <a href="/sites" className="ch-link-navy font-semibold">Offshore Sites</a>.
        </div>
      </div>

      <div className={`${cardCls} p-4`} style={cardStyle}>
        <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--ch-sub)" }}>
          Manning requirements
        </div>
        <div className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
          Check off every role this site needs, with its minimum headcount — used when generating a matrix
          from manning requirements, and shared with the Offshore Sites page. Optionally pick a document
          template per role too, so a generated matrix&rsquo;s line for that role starts with that
          template&rsquo;s document checklist already applied.
        </div>
        <BgErrorBanner error={bgError} />
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
