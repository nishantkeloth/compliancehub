"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVisaType, updateVisaType, deleteVisaType } from "./actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";
import { COUNTRIES } from "@/lib/countries";
import { parseDayList, formatDayList } from "@/lib/visa";

export type VisaType = {
  id: string;
  country: string;
  name: string;
  mobilization_code: string | null;
  entry_valid_days: number | null;
  stay_basis: "until_expiry" | "days_from_entry";
  stay_days: number | null;
  entry_type: "single" | "multiple" | null;
  expiry_reminder_days: number[];
  entry_reminder_days: number[];
  notes: string | null;
  is_active: boolean;
  sort_order: number;
};

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

const MOBILIZATION_CHOICES = [
  { value: "mission", label: "Mission" },
  { value: "resident", label: "Resident" },
  { value: "seaman", label: "Seaman" },
  { value: "visit", label: "Visit" },
];

function describeRules(v: VisaType): string {
  const parts: string[] = [];
  parts.push(v.entry_valid_days != null ? `enter within ${v.entry_valid_days} days of issue` : "no entry deadline set");
  parts.push(v.stay_basis === "days_from_entry" && v.stay_days != null ? `stay ${v.stay_days} days after entry` : "stay until expiry");
  if (v.entry_type) parts.push(v.entry_type === "single" ? "single entry" : "multiple entry");
  return parts.join(" · ");
}

export default function VisaTypesPanel({ visaTypes }: { visaTypes: VisaType[] }) {
  const router = useRouter();
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(visaTypes);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const submitCreate = (fd: FormData, optimistic: VisaType) => {
    setBgError(null);
    addOptimistic(optimistic);
    setAdding(false);
    startTransition(async () => {
      const res = await createVisaType(fd);
      if (res?.error) {
        removeOptimistic(optimistic.id);
        setBgError(`Couldn't save "${optimistic.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitUpdate = (v: VisaType, fd: FormData, patch: Partial<VisaType>) => {
    setBgError(null);
    updateOptimistic(v.id, patch);
    setEditingId(null);
    startTransition(async () => {
      const res = await updateVisaType(v.id, fd);
      if (res?.error) {
        updateOptimistic(v.id, v);
        setBgError(`Couldn't update "${v.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (v: VisaType, index: number) => {
    setBgError(null);
    setConfirmId(null);
    removeOptimistic(v.id);
    startTransition(async () => {
      const res = await deleteVisaType(v.id);
      if (res?.error) {
        restoreOptimistic(v, index);
        setBgError(`Couldn't delete "${v.name}": ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  const countries = Array.from(new Set(items.map((v) => v.country))).sort((a, b) => a.localeCompare(b));

  return (
    <div>
      <p className="text-sm mb-4" style={{ color: "var(--ch-sub)" }}>
        The visa types you deal with, per country, and the rules that drive the dates on a crew member&apos;s visa: how long after issue they must enter,
        how long they may stay, and when to be reminded. Starting values are a guide — confirm them with your PRO and edit here.
      </p>
      {bgError && (
        <div className="text-sm rounded-lg px-3 py-2 mb-3" style={{ background: "#fbe0e0", color: "#b3261e" }}>{bgError}</div>
      )}
      {adding ? (
        <VisaTypeForm onSubmit={(fd, values) => submitCreate(fd, { id: tempId(), sort_order: 0, ...values })} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mb-4">+ Add visa type</button>
      )}

      {items.length === 0 && !adding && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No visa types yet.</div>}

      {countries.map((country) => (
        <div key={country} className="mb-5">
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>{country}</div>
          <div className="space-y-2">
            {items
              .filter((v) => v.country === country)
              .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
              .map((v) => {
                const index = items.findIndex((x) => x.id === v.id);
                if (editingId === v.id) {
                  return <VisaTypeForm key={v.id} visaType={v} onSubmit={(fd, values) => submitUpdate(v, fd, values)} onCancel={() => setEditingId(null)} />;
                }
                return (
                  <div key={v.id} className={`${cardCls} p-3`} style={cardStyle}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-[220px]">
                        <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{v.name}</span>
                        {v.mobilization_code && (
                          <span className="text-xs ml-2 uppercase font-semibold" style={{ color: "var(--ch-navy)" }}>
                            Mobilization: {MOBILIZATION_CHOICES.find((m) => m.value === v.mobilization_code)?.label ?? v.mobilization_code}
                          </span>
                        )}
                        {!v.is_active && <span className="text-xs ml-2 font-semibold" style={{ color: "var(--ch-fail)" }}>Inactive</span>}
                        {isTempId(v.id) && <span className="text-xs ml-2 italic" style={{ color: "var(--ch-sub)" }}>Saving…</span>}
                        <div className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>{describeRules(v)}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--ch-sub)" }}>
                          Expiry reminders (days before): {v.expiry_reminder_days.length ? formatDayList(v.expiry_reminder_days) : "none"}
                          {v.entry_valid_days != null && <> · Entry-deadline reminders: {v.entry_reminder_days.length ? formatDayList(v.entry_reminder_days) : "none"}</>}
                        </div>
                        {v.notes && <div className="text-xs mt-0.5 italic" style={{ color: "var(--ch-sub)" }}>{v.notes}</div>}
                      </div>
                      <button onClick={() => setEditingId(v.id)} disabled={isTempId(v.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-navy)" }}>Edit</button>
                      {confirmId === v.id ? (
                        <span className="text-xs flex items-center gap-2">
                          <span style={{ color: "var(--ch-sub)" }}>Delete? Visas already recorded keep their dates.</span>
                          <button onClick={() => submitDelete(v, index)} className="font-semibold" style={{ color: "var(--ch-fail)" }}>Yes, delete</button>
                          <button onClick={() => setConfirmId(null)} className="font-semibold" style={{ color: "var(--ch-sub)" }}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmId(v.id)} disabled={isTempId(v.id)} className="text-xs font-semibold disabled:opacity-40" style={{ color: "var(--ch-fail)" }}>Delete</button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function VisaTypeForm({
  visaType,
  onSubmit,
  onCancel,
}: {
  visaType?: VisaType;
  onSubmit: (fd: FormData, values: Omit<VisaType, "id" | "sort_order">) => void;
  onCancel: () => void;
}) {
  const [country, setCountry] = useState(visaType?.country ?? "United Arab Emirates");
  const [name, setName] = useState(visaType?.name ?? "");
  const [mobilizationCode, setMobilizationCode] = useState(visaType?.mobilization_code ?? "");
  const [entryValidDays, setEntryValidDays] = useState(visaType?.entry_valid_days != null ? String(visaType.entry_valid_days) : "");
  const [stayBasis, setStayBasis] = useState<"until_expiry" | "days_from_entry">(visaType?.stay_basis ?? "until_expiry");
  const [stayDays, setStayDays] = useState(visaType?.stay_days != null ? String(visaType.stay_days) : "");
  const [entryType, setEntryType] = useState(visaType?.entry_type ?? "");
  const [expiryReminders, setExpiryReminders] = useState(formatDayList(visaType?.expiry_reminder_days ?? [30, 14, 7]));
  const [entryReminders, setEntryReminders] = useState(formatDayList(visaType?.entry_reminder_days ?? []));
  const [notes, setNotes] = useState(visaType?.notes ?? "");
  const [isActive, setIsActive] = useState(visaType?.is_active ?? true);
  const [submitted, setSubmitted] = useState(false);

  const stayOk = stayBasis !== "days_from_entry" || (stayDays !== "" && Number(stayDays) >= 1);
  const canSave = !!country && !!name.trim() && stayOk && !submitted;

  const save = () => {
    if (!canSave) return;
    const fd = new FormData();
    fd.set("country", country);
    fd.set("name", name.trim());
    fd.set("mobilizationCode", mobilizationCode);
    fd.set("entryValidDays", entryValidDays);
    fd.set("stayBasis", stayBasis);
    fd.set("stayDays", stayBasis === "days_from_entry" ? stayDays : "");
    fd.set("entryType", entryType);
    fd.set("expiryReminderDays", expiryReminders);
    fd.set("entryReminderDays", entryReminders);
    fd.set("notes", notes.trim());
    if (isActive) fd.set("isActive", "on");
    setSubmitted(true);
    onSubmit(fd, {
      country,
      name: name.trim(),
      mobilization_code: mobilizationCode || null,
      entry_valid_days: entryValidDays ? Number(entryValidDays) : null,
      stay_basis: stayBasis,
      stay_days: stayBasis === "days_from_entry" && stayDays ? Number(stayDays) : null,
      entry_type: (entryType as "single" | "multiple" | "") || null,
      expiry_reminder_days: parseDayList(expiryReminders),
      entry_reminder_days: parseDayList(entryReminders),
      notes: notes.trim() || null,
      is_active: isActive,
    });
  };

  return (
    <div className={`${cardCls} p-4 mb-3`} style={cardStyle}>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className={lbl} style={lblStyle}>
          Country
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={country} onChange={(e) => setCountry(e.target.value)}>
            {!COUNTRIES.includes(country as never) && country && <option value={country}>{country}</option>}
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Visa type name
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. Mission visa" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Matches this mobilization visa choice
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={mobilizationCode} onChange={(e) => setMobilizationCode(e.target.value)}>
            <option value="">None</option>
            {MOBILIZATION_CHOICES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className={lbl} style={lblStyle}>
          Must enter within (days of issue)
          <input type="number" min={1} className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="leave empty if no deadline" value={entryValidDays} onChange={(e) => setEntryValidDays(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Stay allowed
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={stayBasis} onChange={(e) => setStayBasis(e.target.value as "until_expiry" | "days_from_entry")}>
            <option value="until_expiry">Until the visa expires</option>
            <option value="days_from_entry">A number of days after entry</option>
          </select>
        </label>
        {stayBasis === "days_from_entry" ? (
          <label className={lbl} style={lblStyle}>
            Days of stay after entry
            <input type="number" min={1} className={`${inputCls} w-full mt-1`} style={inputStyle} value={stayDays} onChange={(e) => setStayDays(e.target.value)} />
          </label>
        ) : (
          <label className={lbl} style={lblStyle}>
            Entries
            <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={entryType} onChange={(e) => setEntryType(e.target.value as "single" | "multiple" | "")}>
              <option value="">Not set</option>
              <option value="single">Single entry</option>
              <option value="multiple">Multiple entry</option>
            </select>
          </label>
        )}
      </div>
      {stayBasis === "days_from_entry" && (
        <div className="grid gap-3 sm:grid-cols-3 mb-3">
          <label className={lbl} style={lblStyle}>
            Entries
            <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={entryType} onChange={(e) => setEntryType(e.target.value as "single" | "multiple" | "")}>
              <option value="">Not set</option>
              <option value="single">Single entry</option>
              <option value="multiple">Multiple entry</option>
            </select>
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className={lbl} style={lblStyle}>
          Remind before expiry (days, separated by commas)
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. 90, 60, 30, 14, 7" value={expiryReminders} onChange={(e) => setExpiryReminders(e.target.value)} />
        </label>
        <label className={lbl} style={lblStyle}>
          Remind before entry deadline (days)
          <input className={`${inputCls} w-full mt-1`} style={inputStyle} placeholder="e.g. 14, 7, 3" value={entryReminders} onChange={(e) => setEntryReminders(e.target.value)} disabled={!entryValidDays} />
        </label>
      </div>

      <label className={`${lbl} block mb-3`} style={lblStyle}>
        Notes
        <input className={`${inputCls} w-full mt-1`} style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5 text-xs mb-3" style={{ color: "var(--ch-ink)" }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
      </label>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!canSave} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}
