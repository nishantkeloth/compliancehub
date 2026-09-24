"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setManningRequirement, deleteManningRequirement } from "@/app/crew/setup/actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";
import type { Ref } from "./lines-editor";

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
export type ManningReq = { id: string; offshore_site_id: string; job_role_id: string; minimum_headcount: number };

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
  canManageManning,
}: {
  site: SiteInfo;
  jobRoles: Ref[];
  manningRequirements: ManningReq[];
  canManageManning: boolean;
}) {
  const router = useRouter();
  const { items, addOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(manningRequirements);
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
      offshore_site_id: site.id,
      job_role_id: jobRoleId,
      minimum_headcount: Number(headcount) || 1,
    };
    addOptimistic(optimisticItem);
    setJobRoleId("");
    setHeadcount("1");
    startTransition(async () => {
      const res = await setManningRequirement(site.id, fd);
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
          The site&rsquo;s standing minimum headcount per role — used when generating a matrix from manning
          requirements, and shared with the Offshore Sites page.
        </div>
        {canManageManning && (
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <select className={inputCls} style={inputStyle} value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
              <option value="">Select job role…</option>
              {jobRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              className={`${inputCls} w-24`}
              style={inputStyle}
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
            />
            <button onClick={add} disabled={!jobRoleId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
              Set requirement
            </button>
          </div>
        )}
        <ErrorLine error={error} />
        <BgErrorBanner error={bgError} />
        <div className="space-y-1.5">
          {items.length === 0 && (
            <div className="text-xs" style={{ color: "var(--ch-sub)" }}>No manning requirements set for this site yet.</div>
          )}
          {items.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <span style={{ color: "var(--ch-ink)" }}>{jobRoles.find((j) => j.id === r.job_role_id)?.name ?? "Unknown role"}</span>
              <span style={{ color: "var(--ch-sub)" }}>min {r.minimum_headcount}</span>
              <SavingTag id={r.id} />
              {canManageManning && (
                <button onClick={() => remove(r, i)} disabled={isTempId(r.id)} className="text-xs disabled:opacity-40" style={{ color: "var(--ch-fail)" }}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
