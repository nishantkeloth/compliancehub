"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateCrewProfile,
  updateCrewCost,
  updateCrewSensitive,
  linkCrewToUser,
  deleteCrewProfile,
  addCrewSkill,
  removeCrewSkill,
  addCrewSecondaryRole,
  removeCrewSecondaryRole,
  assignCrewToSite,
  endCrewAssignment,
  deleteCrewAssignment,
  createCrewDocument,
  updateCrewDocument,
  deleteCrewDocument,
} from "../actions";
import { computeDocumentStatus, DOCUMENT_STATUS_COLORS, DOCUMENT_STATUS_LABELS } from "@/lib/document-status";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";

type Crew = {
  id: string;
  employee_code: string | null;
  full_name: string;
  photo_url: string | null;
  employment_status: string;
  nationality: string | null;
  date_of_birth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  home_country: string | null;
  current_location: string | null;
  nearest_airport: string | null;
  primary_job_role_id: string | null;
  employment_type: string | null;
  joining_date: string | null;
  notice_period_days: number | null;
  availability_date: string | null;
  default_rotation_template_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  linked_profile_id: string | null;
  day_rate?: number | null;
  currency?: string | null;
  dietary_medical_notes?: string | null;
};
type Ref = { id: string; name: string };
type CrewSkill = { id: string; skill_id: string; years_experience: number | null; competency_grade: string | null; skills: { name: string } | { name: string }[] | null };
type SecondaryRole = { id: string; job_role_id: string; job_roles: { name: string } | { name: string }[] | null };
type Assignment = {
  id: string;
  offshore_site_id: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  offshore_sites: { name: string; code: string | null } | { name: string; code: string | null }[] | null;
};
type DocumentType = {
  id: string;
  name: string;
  category: string | null;
  tracks_number: boolean;
  warning_threshold_days: number | null;
  is_active: boolean;
};
type CrewDocument = {
  id: string;
  document_type_id: string;
  document_number: string | null;
  sponsor: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  entry_date: string | null;
  extension_date: string | null;
  dose_number: string | null;
  reliever_crew_id: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown> | null;
};
type CustomFieldDefinition = {
  id: string;
  label: string;
  field_key: string;
  field_type: string;
  applies_to_document_type_id: string | null;
  sort_order: number;
  is_active: boolean;
};

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl p-5 mb-4";
const cardStyle = { borderColor: "var(--ch-line)" };
const labelCls = "text-xs font-semibold uppercase tracking-wide mb-2";
const labelStyle = { color: "var(--ch-sub)" };

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="text-xs mt-1.5" style={{ color: "var(--ch-fail)" }}>{error}</div>;
}

function BgErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
      {error}
    </div>
  );
}

export default function CrewEditor({
  crew,
  canManage,
  canViewCost,
  canViewSensitive,
  jobRoles,
  rotationTemplates,
  skills,
  crewSkills,
  secondaryRoles,
  profiles,
  offshoreSites,
  assignments,
  canViewDocuments,
  canManageDocuments,
  documentTypes,
  crewDocuments,
  crewList,
  customFieldDefinitions,
}: {
  crew: Crew;
  canManage: boolean;
  canViewCost: boolean;
  canViewSensitive: boolean;
  jobRoles: Ref[];
  rotationTemplates: Ref[];
  skills: Ref[];
  crewSkills: CrewSkill[];
  secondaryRoles: SecondaryRole[];
  profiles: Ref[];
  offshoreSites: Ref[];
  assignments: Assignment[];
  canViewDocuments: boolean;
  canManageDocuments: boolean;
  documentTypes: DocumentType[];
  crewDocuments: CrewDocument[];
  crewList: Ref[];
  customFieldDefinitions: CustomFieldDefinition[];
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <div className="mt-4 max-w-3xl">
      <GeneralForm crew={crew} canManage={canManage} jobRoles={jobRoles} rotationTemplates={rotationTemplates} onSaved={refresh} />

      <SkillsSection crewId={crew.id} skills={skills} crewSkills={crewSkills} canManage={canManage} onChanged={refresh} />

      <SecondaryRolesSection crewId={crew.id} jobRoles={jobRoles} secondaryRoles={secondaryRoles} canManage={canManage} onChanged={refresh} />

      <AssignmentSection crewId={crew.id} offshoreSites={offshoreSites} assignments={assignments} canManage={canManage} onChanged={refresh} />

      {canViewDocuments && (
        <DocumentsSection
          crewId={crew.id}
          documentTypes={documentTypes}
          crewDocuments={crewDocuments}
          crewList={crewList}
          customFieldDefinitions={customFieldDefinitions}
          canManage={canManageDocuments}
          onChanged={refresh}
        />
      )}

      {canViewCost && <CostForm crew={crew} canManage={canManage} onSaved={refresh} />}

      {canViewSensitive && <SensitiveForm crew={crew} canManage={canManage} onSaved={refresh} />}

      {canManage && <LinkedUserForm crew={crew} profiles={profiles} onSaved={refresh} />}

      {canManage && <DangerZone crewId={crew.id} />}
    </div>
  );
}

/* ================= General ================= */

function GeneralForm({
  crew,
  canManage,
  jobRoles,
  rotationTemplates,
  onSaved,
}: {
  crew: Crew;
  canManage: boolean;
  jobRoles: Ref[];
  rotationTemplates: Ref[];
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(crew.full_name);
  const [employeeCode, setEmployeeCode] = useState(crew.employee_code ?? "");
  const [photoUrl, setPhotoUrl] = useState(crew.photo_url ?? "");
  const [employmentStatus, setEmploymentStatus] = useState(crew.employment_status);
  const [nationality, setNationality] = useState(crew.nationality ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(crew.date_of_birth ?? "");
  const [gender, setGender] = useState(crew.gender ?? "");
  const [phone, setPhone] = useState(crew.phone ?? "");
  const [email, setEmail] = useState(crew.email ?? "");
  const [homeCountry, setHomeCountry] = useState(crew.home_country ?? "");
  const [currentLocation, setCurrentLocation] = useState(crew.current_location ?? "");
  const [nearestAirport, setNearestAirport] = useState(crew.nearest_airport ?? "");
  const [primaryJobRoleId, setPrimaryJobRoleId] = useState(crew.primary_job_role_id ?? "");
  const [employmentType, setEmploymentType] = useState(crew.employment_type ?? "");
  const [joiningDate, setJoiningDate] = useState(crew.joining_date ?? "");
  const [noticePeriodDays, setNoticePeriodDays] = useState(crew.notice_period_days != null ? String(crew.notice_period_days) : "");
  const [availabilityDate, setAvailabilityDate] = useState(crew.availability_date ?? "");
  const [defaultRotationTemplateId, setDefaultRotationTemplateId] = useState(crew.default_rotation_template_id ?? "");
  const [emergencyContactName, setEmergencyContactName] = useState(crew.emergency_contact_name ?? "");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(crew.emergency_contact_phone ?? "");
  const [notes, setNotes] = useState(crew.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  const save = () => {
    if (!fullName.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("fullName", fullName.trim());
    fd.set("employeeCode", employeeCode.trim());
    fd.set("photoUrl", photoUrl.trim());
    fd.set("employmentStatus", employmentStatus);
    fd.set("nationality", nationality.trim());
    fd.set("dateOfBirth", dateOfBirth);
    fd.set("gender", gender.trim());
    fd.set("phone", phone.trim());
    fd.set("email", email.trim());
    fd.set("homeCountry", homeCountry.trim());
    fd.set("currentLocation", currentLocation.trim());
    fd.set("nearestAirport", nearestAirport.trim());
    fd.set("primaryJobRoleId", primaryJobRoleId);
    fd.set("employmentType", employmentType);
    fd.set("joiningDate", joiningDate);
    fd.set("noticePeriodDays", noticePeriodDays);
    fd.set("availabilityDate", availabilityDate);
    fd.set("defaultRotationTemplateId", defaultRotationTemplateId);
    fd.set("emergencyContactName", emergencyContactName.trim());
    fd.set("emergencyContactPhone", emergencyContactPhone.trim());
    fd.set("notes", notes.trim());
    // Optimistic: the fields already show what was typed, so treat the
    // save as done immediately and let the write happen in the
    // background; only surface it if it actually failed.
    setSaved(true);
    startTransition(async () => {
      const res = await updateCrewProfile(crew.id, fd);
      if (res?.error) {
        setSaved(false);
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  const disabled = !canManage;

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Identity</div>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <input className={inputCls} style={inputStyle} placeholder="Full name" value={fullName} onChange={(e) => { setFullName(e.target.value); setSaved(false); }} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Employee code" value={employeeCode} onChange={(e) => { setEmployeeCode(e.target.value); setSaved(false); }} disabled={disabled} />
        <select className={inputCls} style={inputStyle} value={employmentStatus} onChange={(e) => { setEmploymentStatus(e.target.value); setSaved(false); }} disabled={disabled}>
          <option value="candidate">Candidate</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Terminated</option>
        </select>
      </div>
      <input className={`${inputCls} w-full mb-4`} style={inputStyle} placeholder="Photo URL (optional)" value={photoUrl} onChange={(e) => { setPhotoUrl(e.target.value); setSaved(false); }} disabled={disabled} />

      <div className={labelCls} style={labelStyle}>Personal</div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Nationality" value={nationality} onChange={(e) => { setNationality(e.target.value); setSaved(false); }} disabled={disabled} />
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Date of birth
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={dateOfBirth} onChange={(e) => { setDateOfBirth(e.target.value); setSaved(false); }} disabled={disabled} />
        </label>
        <input className={inputCls} style={inputStyle} placeholder="Gender" value={gender} onChange={(e) => { setGender(e.target.value); setSaved(false); }} disabled={disabled} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Phone" value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Email" value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} disabled={disabled} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <input className={inputCls} style={inputStyle} placeholder="Home country" value={homeCountry} onChange={(e) => { setHomeCountry(e.target.value); setSaved(false); }} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Current location" value={currentLocation} onChange={(e) => { setCurrentLocation(e.target.value); setSaved(false); }} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Nearest airport" value={nearestAirport} onChange={(e) => { setNearestAirport(e.target.value); setSaved(false); }} disabled={disabled} />
      </div>

      <div className={labelCls} style={labelStyle}>Role & Employment</div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <select className={inputCls} style={inputStyle} value={primaryJobRoleId} onChange={(e) => { setPrimaryJobRoleId(e.target.value); setSaved(false); }} disabled={disabled}>
          <option value="">No primary role</option>
          {jobRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className={inputCls} style={inputStyle} value={employmentType} onChange={(e) => { setEmploymentType(e.target.value); setSaved(false); }} disabled={disabled}>
          <option value="">Employment type</option>
          <option value="permanent">Permanent</option>
          <option value="temporary">Temporary</option>
          <option value="subcontractor">Subcontractor</option>
          <option value="freelancer">Freelancer</option>
        </select>
        <select className={inputCls} style={inputStyle} value={defaultRotationTemplateId} onChange={(e) => { setDefaultRotationTemplateId(e.target.value); setSaved(false); }} disabled={disabled}>
          <option value="">No default rotation</option>
          {rotationTemplates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Joining date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={joiningDate} onChange={(e) => { setJoiningDate(e.target.value); setSaved(false); }} disabled={disabled} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Notice period (days)
          <input type="number" min={0} className={`${inputCls} w-full mt-1`} style={inputStyle} value={noticePeriodDays} onChange={(e) => { setNoticePeriodDays(e.target.value); setSaved(false); }} disabled={disabled} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Availability date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={availabilityDate} onChange={(e) => { setAvailabilityDate(e.target.value); setSaved(false); }} disabled={disabled} />
        </label>
      </div>

      <div className={labelCls} style={labelStyle}>Emergency Contact</div>
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <input className={inputCls} style={inputStyle} placeholder="Name" value={emergencyContactName} onChange={(e) => { setEmergencyContactName(e.target.value); setSaved(false); }} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Phone" value={emergencyContactPhone} onChange={(e) => { setEmergencyContactPhone(e.target.value); setSaved(false); }} disabled={disabled} />
      </div>

      <div className={labelCls} style={labelStyle}>Notes</div>
      <textarea className={`${inputCls} w-full`} style={inputStyle} rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} disabled={disabled} />

      {canManage && (
        <div className="flex items-center gap-2 mt-4">
          <button onClick={save} disabled={!fullName.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            Save
          </button>
          {saved && !error && <span className="text-xs font-semibold" style={{ color: "var(--ch-ok, #1a7f37)" }}>Saved</span>}
          <ErrorLine error={error} />
        </div>
      )}
    </div>
  );
}

/* ================= Skills ================= */

function SkillsSection({
  crewId,
  skills,
  crewSkills,
  canManage,
  onChanged,
}: {
  crewId: string;
  skills: Ref[];
  crewSkills: CrewSkill[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { items, addOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(crewSkills);
  const [, startTransition] = useTransition();
  const [skillId, setSkillId] = useState("");
  const [years, setYears] = useState("");
  const [grade, setGrade] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const add = () => {
    if (!skillId) return;
    setError(null);
    setBgError(null);
    const fd = new FormData();
    fd.set("skillId", skillId);
    fd.set("yearsExperience", years);
    fd.set("competencyGrade", grade);
    const skillName = skills.find((s) => s.id === skillId)?.name ?? "";
    const optimisticItem: CrewSkill = {
      id: tempId(),
      skill_id: skillId,
      years_experience: years ? Number(years) : null,
      competency_grade: grade.trim() || null,
      skills: { name: skillName },
    };
    addOptimistic(optimisticItem);
    setSkillId(""); setYears(""); setGrade("");
    startTransition(async () => {
      const res = await addCrewSkill(crewId, fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  const remove = (cs: CrewSkill, index: number) => {
    setBgError(null);
    removeOptimistic(cs.id);
    startTransition(async () => {
      const res = await removeCrewSkill(cs.id, crewId);
      if (res?.error) {
        restoreOptimistic(cs, index);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Skills</div>
      <BgErrorBanner error={bgError} />
      <div className="space-y-1.5 mb-3">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No skills recorded.</div>}
        {items.map((cs, i) => {
          const skill = unwrap(cs.skills);
          return (
            <div key={cs.id} className="flex items-center gap-2 text-sm">
              <span style={{ color: "var(--ch-ink)" }}>{skill?.name ?? "Unknown skill"}</span>
              {cs.years_experience != null && <span style={{ color: "var(--ch-sub)" }}>{cs.years_experience} yrs</span>}
              {cs.competency_grade && <span style={{ color: "var(--ch-sub)" }}>({cs.competency_grade})</span>}
              {isTempId(cs.id) && <span className="text-xs italic" style={{ color: "var(--ch-sub)" }}>Saving…</span>}
              {canManage && !isTempId(cs.id) && (
                <button onClick={() => remove(cs, i)} className="text-xs" style={{ color: "var(--ch-fail)" }}>Remove</button>
              )}
            </div>
          );
        })}
      </div>
      {canManage && (
        <div className="flex items-center gap-2 flex-wrap">
          <select className={inputCls} style={inputStyle} value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">Select skill…</option>
            {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="number" min={0} step="0.5" className={`${inputCls} w-24`} style={inputStyle} placeholder="Years" value={years} onChange={(e) => setYears(e.target.value)} />
          <input className={`${inputCls} w-32`} style={inputStyle} placeholder="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
          <button onClick={add} disabled={!skillId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Add</button>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Secondary roles ================= */

function SecondaryRolesSection({
  crewId,
  jobRoles,
  secondaryRoles,
  canManage,
  onChanged,
}: {
  crewId: string;
  jobRoles: Ref[];
  secondaryRoles: SecondaryRole[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { items, addOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(secondaryRoles);
  const [, startTransition] = useTransition();
  const [jobRoleId, setJobRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const add = () => {
    if (!jobRoleId) return;
    setError(null);
    setBgError(null);
    const roleName = jobRoles.find((r) => r.id === jobRoleId)?.name ?? "";
    const optimisticItem: SecondaryRole = { id: tempId(), job_role_id: jobRoleId, job_roles: { name: roleName } };
    addOptimistic(optimisticItem);
    setJobRoleId("");
    startTransition(async () => {
      const res = await addCrewSecondaryRole(crewId, jobRoleId);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  const remove = (sr: SecondaryRole, index: number) => {
    setBgError(null);
    removeOptimistic(sr.id);
    startTransition(async () => {
      const res = await removeCrewSecondaryRole(sr.id, crewId);
      if (res?.error) {
        restoreOptimistic(sr, index);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Secondary / Backup Roles</div>
      <BgErrorBanner error={bgError} />
      <div className="flex flex-wrap gap-2 mb-3">
        {items.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>None set.</div>}
        {items.map((sr, i) => {
          const role = unwrap(sr.job_roles);
          return (
            <div key={sr.id} className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
              {role?.name ?? "Unknown role"}
              {isTempId(sr.id) ? (
                <span className="text-xs italic" style={{ color: "var(--ch-sub)" }}>…</span>
              ) : (
                canManage && <button onClick={() => remove(sr, i)} className="text-xs" style={{ color: "var(--ch-fail)" }}>✕</button>
              )}
            </div>
          );
        })}
      </div>
      {canManage && (
        <div className="flex items-center gap-2">
          <select className={inputCls} style={inputStyle} value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
            <option value="">Select role…</option>
            {jobRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button onClick={add} disabled={!jobRoleId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Add</button>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Vessel assignment ================= */

function AssignmentSection({
  crewId,
  offshoreSites,
  assignments,
  canManage,
  onChanged,
}: {
  crewId: string;
  offshoreSites: Ref[];
  assignments: Assignment[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(assignments);
  const [, startTransition] = useTransition();
  const [offshoreSiteId, setOffshoreSiteId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const current = items.find((a) => a.end_date === null) ?? null;
  const history = items.filter((a) => a.end_date !== null);

  const assign = () => {
    if (!offshoreSiteId) return;
    setError(null);
    setBgError(null);
    const fd = new FormData();
    fd.set("offshoreSiteId", offshoreSiteId);
    fd.set("startDate", startDate);

    const siteName = offshoreSites.find((s) => s.id === offshoreSiteId)?.name ?? "";
    const previousCurrent = current;
    const optimisticNew: Assignment = {
      id: tempId(),
      offshore_site_id: offshoreSiteId,
      start_date: startDate,
      end_date: null,
      notes: null,
      offshore_sites: { name: siteName, code: null },
    };
    if (previousCurrent) updateOptimistic(previousCurrent.id, { end_date: startDate });
    addOptimistic(optimisticNew);
    setOffshoreSiteId("");

    startTransition(async () => {
      const res = await assignCrewToSite(crewId, fd);
      if (res?.error) {
        if (previousCurrent) updateOptimistic(previousCurrent.id, { end_date: null });
        removeOptimistic(optimisticNew.id);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  const endAssignment = (assignment: Assignment) => {
    setError(null);
    setBgError(null);
    const today = new Date().toISOString().slice(0, 10);
    const fd = new FormData();
    fd.set("endDate", today);
    updateOptimistic(assignment.id, { end_date: today });
    startTransition(async () => {
      const res = await endCrewAssignment(assignment.id, crewId, fd);
      if (res?.error) {
        updateOptimistic(assignment.id, { end_date: null });
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  const removeHistory = (assignment: Assignment, index: number) => {
    setBgError(null);
    removeOptimistic(assignment.id);
    startTransition(async () => {
      const res = await deleteCrewAssignment(assignment.id, crewId);
      if (res?.error) {
        restoreOptimistic(assignment, index);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Vessel Assignment</div>
      <BgErrorBanner error={bgError} />

      {current ? (
        <div className="flex items-center gap-3 flex-wrap mb-3 rounded-lg border px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
          <div>
            <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{unwrap(current.offshore_sites)?.name ?? "Unknown vessel"}</span>
            <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>since {current.start_date}</span>
            {isTempId(current.id) && <span className="text-xs ml-2 italic" style={{ color: "var(--ch-sub)" }}>Saving…</span>}
          </div>
          {canManage && (
            <button onClick={() => endAssignment(current)} disabled={isTempId(current.id)} className="text-xs font-semibold ml-auto disabled:opacity-50" style={{ color: "var(--ch-fail)" }}>
              End assignment
            </button>
          )}
        </div>
      ) : (
        <div className="text-sm mb-3" style={{ color: "var(--ch-sub)" }}>Not currently assigned to a vessel.</div>
      )}

      {canManage && (
        <div className="flex items-center gap-2 flex-wrap">
          <select className={inputCls} style={inputStyle} value={offshoreSiteId} onChange={(e) => setOffshoreSiteId(e.target.value)}>
            <option value="">{current ? "Reassign to…" : "Assign to…"}</option>
            {offshoreSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Start date
            <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <button onClick={assign} disabled={!offshoreSiteId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            {current ? "Reassign" : "Assign"}
          </button>
        </div>
      )}
      <ErrorLine error={error} />

      {history.length > 0 && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--ch-line)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--ch-sub)" }}>History</div>
          <div className="space-y-1">
            {history.map((a) => {
              const index = items.findIndex((x) => x.id === a.id);
              return (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span style={{ color: "var(--ch-ink)" }}>{unwrap(a.offshore_sites)?.name ?? "Unknown vessel"}</span>
                  <span style={{ color: "var(--ch-sub)" }}>{a.start_date} – {a.end_date}</span>
                  {canManage && (
                    <button onClick={() => removeHistory(a, index)} style={{ color: "var(--ch-fail)" }}>Remove</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Documents & Certifications (permission-gated) ================= */

function DocumentsSection({
  crewId,
  documentTypes,
  crewDocuments,
  crewList,
  customFieldDefinitions,
  canManage,
  onChanged,
}: {
  crewId: string;
  documentTypes: DocumentType[];
  crewDocuments: CrewDocument[];
  crewList: Ref[];
  customFieldDefinitions: CustomFieldDefinition[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { items, addOptimistic, updateOptimistic, removeOptimistic, restoreOptimistic } = useOptimisticList(crewDocuments);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);

  const typeById = (id: string) => documentTypes.find((d) => d.id === id);
  const sorted = [...items].sort((a, b) => (typeById(a.document_type_id)?.name ?? "").localeCompare(typeById(b.document_type_id)?.name ?? ""));

  const applicableFields = (documentTypeId: string) =>
    customFieldDefinitions.filter((f) => f.applies_to_document_type_id === null || f.applies_to_document_type_id === documentTypeId);

  const submitCreate = (fd: FormData, optimisticItem: CrewDocument) => {
    setBgError(null);
    addOptimistic(optimisticItem);
    setAdding(false);
    startTransition(async () => {
      const res = await createCrewDocument(crewId, fd);
      if (res?.error) {
        removeOptimistic(optimisticItem.id);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  const submitUpdate = (doc: CrewDocument, fd: FormData, patch: Partial<CrewDocument>) => {
    setBgError(null);
    updateOptimistic(doc.id, patch);
    setEditingId(null);
    startTransition(async () => {
      const res = await updateCrewDocument(doc.id, crewId, fd);
      if (res?.error) {
        updateOptimistic(doc.id, doc);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  const submitDelete = (doc: CrewDocument, index: number) => {
    setBgError(null);
    removeOptimistic(doc.id);
    startTransition(async () => {
      const res = await deleteCrewDocument(doc.id, crewId);
      if (res?.error) {
        restoreOptimistic(doc, index);
        setBgError(res.error);
        return;
      }
      onChanged();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Documents & Certifications (restricted)</div>
      <BgErrorBanner error={bgError} />

      <div className="space-y-2 mb-3">
        {sorted.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No documents recorded.</div>}
        {sorted.map((d) => {
          const type = typeById(d.document_type_id);
          if (editingId === d.id) {
            return (
              <DocumentForm
                key={d.id}
                crewId={crewId}
                crewDocument={d}
                documentTypes={documentTypes}
                crewList={crewList}
                customFieldDefinitions={customFieldDefinitions}
                onSubmit={(fd, patch) => submitUpdate(d, fd, patch)}
                onCancel={() => setEditingId(null)}
              />
            );
          }
          const { status, daysRemaining } = computeDocumentStatus(d.expiry_date, type?.warning_threshold_days ?? null, type?.category ?? null);
          const colors = DOCUMENT_STATUS_COLORS[status];
          const index = items.findIndex((x) => x.id === d.id);
          const fields = applicableFields(d.document_type_id);
          const customValues = fields
            .map((f) => {
              const v = d.custom_fields?.[f.field_key];
              return v !== undefined && v !== null && v !== "" ? `${f.label}: ${v}` : null;
            })
            .filter(Boolean);
          return (
            <div key={d.id} className="flex items-center gap-3 flex-wrap rounded-lg border px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
              <span className="text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: colors.bg, color: colors.fg }}>
                {DOCUMENT_STATUS_LABELS[status]}
              </span>
              <div className="flex-1 min-w-[160px]">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{type?.name ?? "Unknown type"}</span>
                {d.document_number && <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>#{d.document_number}</span>}
                {d.expiry_date && (
                  <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>
                    expires {d.expiry_date}{daysRemaining != null ? ` (${daysRemaining}d)` : ""}
                  </span>
                )}
                {customValues.length > 0 && (
                  <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>· {customValues.join(" · ")}</span>
                )}
                {isTempId(d.id) && <span className="text-xs ml-2 italic" style={{ color: "var(--ch-sub)" }}>Saving…</span>}
              </div>
              {canManage && !isTempId(d.id) && (
                <>
                  <button onClick={() => setEditingId(d.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
                  <button onClick={() => submitDelete(d, index)} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Remove</button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {canManage && (
        adding ? (
          <DocumentForm
            crewId={crewId}
            documentTypes={documentTypes}
            crewList={crewList}
            customFieldDefinitions={customFieldDefinitions}
            onSubmit={(fd, patch) =>
              submitCreate(fd, {
                id: tempId(),
                document_type_id: patch.document_type_id ?? documentTypes[0]?.id ?? "",
                document_number: patch.document_number ?? null,
                sponsor: patch.sponsor ?? null,
                issue_date: patch.issue_date ?? null,
                expiry_date: patch.expiry_date ?? null,
                entry_date: patch.entry_date ?? null,
                extension_date: patch.extension_date ?? null,
                dose_number: patch.dose_number ?? null,
                reliever_crew_id: patch.reliever_crew_id ?? null,
                notes: patch.notes ?? null,
                custom_fields: patch.custom_fields ?? {},
              })
            }
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            disabled={documentTypes.length === 0}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            + Add document
          </button>
        )
      )}
      {documentTypes.length === 0 && (
        <div className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
          Add document types first in Crew Setup → Document Types.
        </div>
      )}
    </div>
  );
}

function DocumentForm({
  crewId,
  crewDocument,
  documentTypes,
  crewList,
  customFieldDefinitions,
  onSubmit,
  onCancel,
}: {
  crewId: string;
  crewDocument?: CrewDocument;
  documentTypes: DocumentType[];
  crewList: Ref[];
  customFieldDefinitions: CustomFieldDefinition[];
  onSubmit: (fd: FormData, patch: Partial<CrewDocument>) => void;
  onCancel: () => void;
}) {
  const [documentTypeId, setDocumentTypeId] = useState(crewDocument?.document_type_id ?? documentTypes[0]?.id ?? "");
  const [documentNumber, setDocumentNumber] = useState(crewDocument?.document_number ?? "");
  const [sponsor, setSponsor] = useState(crewDocument?.sponsor ?? "");
  const [issueDate, setIssueDate] = useState(crewDocument?.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(crewDocument?.expiry_date ?? "");
  const [entryDate, setEntryDate] = useState(crewDocument?.entry_date ?? "");
  const [extensionDate, setExtensionDate] = useState(crewDocument?.extension_date ?? "");
  const [doseNumber, setDoseNumber] = useState(crewDocument?.dose_number ?? "");
  const [relieverCrewId, setRelieverCrewId] = useState(crewDocument?.reliever_crew_id ?? "");
  const [notes, setNotes] = useState(crewDocument?.notes ?? "");
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(crewDocument?.custom_fields ?? {})) {
      initial[k] = v == null ? "" : String(v);
    }
    return initial;
  });
  const [submitted, setSubmitted] = useState(false);

  const selectedType = documentTypes.find((t) => t.id === documentTypeId);
  const isVisa = selectedType?.category === "visa";
  const isVaccination = selectedType?.category === "vaccination";
  const tracksNumber = selectedType?.tracks_number ?? true;
  const applicableFields = customFieldDefinitions.filter(
    (f) => f.applies_to_document_type_id === null || f.applies_to_document_type_id === documentTypeId
  );

  const save = () => {
    if (!documentTypeId || submitted) return;
    const fd = new FormData();
    fd.set("documentTypeId", documentTypeId);
    fd.set("documentNumber", documentNumber.trim());
    fd.set("sponsor", sponsor.trim());
    fd.set("issueDate", issueDate);
    fd.set("expiryDate", expiryDate);
    fd.set("entryDate", entryDate);
    fd.set("extensionDate", extensionDate);
    fd.set("doseNumber", doseNumber.trim());
    fd.set("relieverCrewId", relieverCrewId);
    fd.set("notes", notes.trim());
    const customFieldsPayload: Record<string, string | number> = {};
    for (const f of applicableFields) {
      const raw = (customValues[f.field_key] ?? "").trim();
      if (!raw) continue;
      customFieldsPayload[f.field_key] = f.field_type === "number" ? Number(raw) : raw;
    }
    fd.set("customFields", JSON.stringify(customFieldsPayload));
    setSubmitted(true);
    onSubmit(fd, {
      document_type_id: documentTypeId,
      document_number: tracksNumber && documentNumber.trim() ? documentNumber.trim() : null,
      sponsor: sponsor.trim() || null,
      issue_date: issueDate || null,
      expiry_date: expiryDate || null,
      entry_date: entryDate || null,
      extension_date: extensionDate || null,
      dose_number: doseNumber || null,
      reliever_crew_id: relieverCrewId || null,
      notes: notes.trim() || null,
      custom_fields: customFieldsPayload,
    });
  };

  return (
    <div className="rounded-lg border p-3 mb-2" style={{ borderColor: "var(--ch-line)" }}>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <select className={inputCls} style={inputStyle} value={documentTypeId} onChange={(e) => setDocumentTypeId(e.target.value)}>
          <option value="">Select document type…</option>
          {documentTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {tracksNumber && (
          <input className={inputCls} style={inputStyle} placeholder="Document number" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Issue date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Expiry date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </label>
        {isVisa && (
          <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Entry date
            <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </label>
        )}
        {isVaccination && (
          <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Dose
            <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={doseNumber} onChange={(e) => setDoseNumber(e.target.value)}>
              <option value="">—</option>
              <option value="1st">1st</option>
              <option value="2nd">2nd</option>
              <option value="booster">Booster</option>
            </select>
          </label>
        )}
      </div>
      {isVisa && (
        <div className="grid gap-3 sm:grid-cols-3 mb-3">
          <input className={inputCls} style={inputStyle} placeholder="Sponsor" value={sponsor} onChange={(e) => setSponsor(e.target.value)} />
          <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
            Extension date
            <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={extensionDate} onChange={(e) => setExtensionDate(e.target.value)} />
          </label>
          <select className={inputCls} style={inputStyle} value={relieverCrewId} onChange={(e) => setRelieverCrewId(e.target.value)}>
            <option value="">No reliever</option>
            {crewList.filter((c) => c.id !== crewId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {applicableFields.length > 0 && (
        <div className="mb-3 pt-3 border-t" style={{ borderColor: "var(--ch-line)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--ch-sub)" }}>Custom fields</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {applicableFields.map((f) => (
              <label key={f.id} className="text-xs" style={{ color: "var(--ch-sub)" }}>
                {f.label}
                <input
                  type={f.field_type === "date" ? "date" : f.field_type === "number" ? "number" : "text"}
                  className={`${inputCls} w-full mt-1`}
                  style={inputStyle}
                  value={customValues[f.field_key] ?? ""}
                  onChange={(e) => setCustomValues((v) => ({ ...v, [f.field_key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <textarea className={`${inputCls} w-full mb-3`} style={inputStyle} placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={submitted || !documentTypeId} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================= Cost (permission-gated) ================= */

function CostForm({ crew, canManage, onSaved }: { crew: Crew; canManage: boolean; onSaved: () => void }) {
  const [dayRate, setDayRate] = useState(crew.day_rate != null ? String(crew.day_rate) : "");
  const [currency, setCurrency] = useState(crew.currency ?? "USD");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("dayRate", dayRate);
    fd.set("currency", currency.trim() || "USD");
    setSaved(true);
    startTransition(async () => {
      const res = await updateCrewCost(crew.id, fd);
      if (res?.error) {
        setSaved(false);
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Cost (restricted)</div>
      <div className="flex items-center gap-2 flex-wrap">
        <input type="number" min={0} step="0.01" className={`${inputCls} w-32`} style={inputStyle} placeholder="Day rate" value={dayRate} onChange={(e) => { setDayRate(e.target.value); setSaved(false); }} disabled={!canManage} />
        <input className={`${inputCls} w-24`} style={inputStyle} placeholder="Currency" value={currency} onChange={(e) => { setCurrency(e.target.value); setSaved(false); }} disabled={!canManage} />
        {canManage && (
          <button onClick={save} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">
            Save
          </button>
        )}
        {saved && !error && <span className="text-xs font-semibold" style={{ color: "var(--ch-ok, #1a7f37)" }}>Saved</span>}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Sensitive (permission-gated) ================= */

function SensitiveForm({ crew, canManage, onSaved }: { crew: Crew; canManage: boolean; onSaved: () => void }) {
  const [notes, setNotes] = useState(crew.dietary_medical_notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("dietaryMedicalNotes", notes.trim());
    setSaved(true);
    startTransition(async () => {
      const res = await updateCrewSensitive(crew.id, fd);
      if (res?.error) {
        setSaved(false);
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Dietary / Medical Accommodation Notes (restricted)</div>
      <textarea className={`${inputCls} w-full`} style={inputStyle} rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} disabled={!canManage} />
      {canManage && (
        <div className="mt-2 flex items-center gap-2">
          <button onClick={save} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">
            Save
          </button>
          {saved && !error && <span className="text-xs font-semibold" style={{ color: "var(--ch-ok, #1a7f37)" }}>Saved</span>}
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Linked user account ================= */

function LinkedUserForm({ crew, profiles, onSaved }: { crew: Crew; profiles: Ref[]; onSaved: () => void }) {
  const [linkedProfileId, setLinkedProfileId] = useState(crew.linked_profile_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("linkedProfileId", linkedProfileId);
    setSaved(true);
    startTransition(async () => {
      const res = await linkCrewToUser(crew.id, fd);
      if (res?.error) {
        setSaved(false);
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Self-Service Login (optional)</div>
      <p className="text-xs mb-2" style={{ color: "var(--ch-sub)" }}>
        Link this crew member to an existing ComplianceHub user account to give them self-service access to their own assignments and documents later.
      </p>
      <div className="flex items-center gap-2">
        <select className={inputCls} style={inputStyle} value={linkedProfileId} onChange={(e) => { setLinkedProfileId(e.target.value); setSaved(false); }}>
          <option value="">Not linked</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={save} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">
          Save
        </button>
        {saved && !error && <span className="text-xs font-semibold" style={{ color: "var(--ch-ok, #1a7f37)" }}>Saved</span>}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Danger zone ================= */

function DangerZone({ crewId }: { crewId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = () => {
    if (!window.confirm("Delete this crew profile? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCrewProfile(crewId);
      if (res?.error) { setError(res.error); return; }
      router.push("/crew/profiles");
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Danger Zone</div>
      <button onClick={remove} disabled={pending} className="rounded-lg px-4 py-2 text-sm font-semibold border disabled:opacity-50" style={{ borderColor: "var(--ch-fail)", color: "var(--ch-fail)" }}>
        {pending ? "Deleting…" : "Delete crew profile"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}
