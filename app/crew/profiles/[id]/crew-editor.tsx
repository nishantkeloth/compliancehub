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

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="text-xs mt-1.5" style={{ color: "var(--ch-fail)" }}>{error}</div>;
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
  const [pending, startTransition] = useTransition();

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
    startTransition(async () => {
      const res = await updateCrewProfile(crew.id, fd);
      if (res?.error) { setError(res.error); return; }
      onSaved();
    });
  };

  const disabled = !canManage;

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Identity</div>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <input className={inputCls} style={inputStyle} placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Employee code" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} disabled={disabled} />
        <select className={inputCls} style={inputStyle} value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)} disabled={disabled}>
          <option value="candidate">Candidate</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Terminated</option>
        </select>
      </div>
      <input className={`${inputCls} w-full mb-4`} style={inputStyle} placeholder="Photo URL (optional)" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} disabled={disabled} />

      <div className={labelCls} style={labelStyle}>Personal</div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} disabled={disabled} />
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Date of birth
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} disabled={disabled} />
        </label>
        <input className={inputCls} style={inputStyle} placeholder="Gender" value={gender} onChange={(e) => setGender(e.target.value)} disabled={disabled} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <input className={inputCls} style={inputStyle} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={disabled} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <input className={inputCls} style={inputStyle} placeholder="Home country" value={homeCountry} onChange={(e) => setHomeCountry(e.target.value)} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Current location" value={currentLocation} onChange={(e) => setCurrentLocation(e.target.value)} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Nearest airport" value={nearestAirport} onChange={(e) => setNearestAirport(e.target.value)} disabled={disabled} />
      </div>

      <div className={labelCls} style={labelStyle}>Role & Employment</div>
      <div className="grid gap-3 sm:grid-cols-3 mb-3">
        <select className={inputCls} style={inputStyle} value={primaryJobRoleId} onChange={(e) => setPrimaryJobRoleId(e.target.value)} disabled={disabled}>
          <option value="">No primary role</option>
          {jobRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className={inputCls} style={inputStyle} value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} disabled={disabled}>
          <option value="">Employment type</option>
          <option value="permanent">Permanent</option>
          <option value="temporary">Temporary</option>
          <option value="subcontractor">Subcontractor</option>
          <option value="freelancer">Freelancer</option>
        </select>
        <select className={inputCls} style={inputStyle} value={defaultRotationTemplateId} onChange={(e) => setDefaultRotationTemplateId(e.target.value)} disabled={disabled}>
          <option value="">No default rotation</option>
          {rotationTemplates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Joining date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} disabled={disabled} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Notice period (days)
          <input type="number" min={0} className={`${inputCls} w-full mt-1`} style={inputStyle} value={noticePeriodDays} onChange={(e) => setNoticePeriodDays(e.target.value)} disabled={disabled} />
        </label>
        <label className="text-xs" style={{ color: "var(--ch-sub)" }}>
          Availability date
          <input type="date" className={`${inputCls} w-full mt-1`} style={inputStyle} value={availabilityDate} onChange={(e) => setAvailabilityDate(e.target.value)} disabled={disabled} />
        </label>
      </div>

      <div className={labelCls} style={labelStyle}>Emergency Contact</div>
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <input className={inputCls} style={inputStyle} placeholder="Name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} disabled={disabled} />
        <input className={inputCls} style={inputStyle} placeholder="Phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} disabled={disabled} />
      </div>

      <div className={labelCls} style={labelStyle}>Notes</div>
      <textarea className={`${inputCls} w-full`} style={inputStyle} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={disabled} />

      {canManage && (
        <div className="flex items-center gap-2 mt-4">
          <button onClick={save} disabled={pending || !fullName.trim()} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
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
  const [skillId, setSkillId] = useState("");
  const [years, setYears] = useState("");
  const [grade, setGrade] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () => {
    if (!skillId) return;
    setError(null);
    const fd = new FormData();
    fd.set("skillId", skillId);
    fd.set("yearsExperience", years);
    fd.set("competencyGrade", grade);
    startTransition(async () => {
      const res = await addCrewSkill(crewId, fd);
      if (res?.error) { setError(res.error); return; }
      setSkillId(""); setYears(""); setGrade("");
      onChanged();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Skills</div>
      <div className="space-y-1.5 mb-3">
        {crewSkills.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No skills recorded.</div>}
        {crewSkills.map((cs) => {
          const skill = unwrap(cs.skills);
          return (
            <div key={cs.id} className="flex items-center gap-2 text-sm">
              <span style={{ color: "var(--ch-ink)" }}>{skill?.name ?? "Unknown skill"}</span>
              {cs.years_experience != null && <span style={{ color: "var(--ch-sub)" }}>{cs.years_experience} yrs</span>}
              {cs.competency_grade && <span style={{ color: "var(--ch-sub)" }}>({cs.competency_grade})</span>}
              {canManage && (
                <button onClick={() => removeCrewSkill(cs.id, crewId).then(onChanged)} className="text-xs" style={{ color: "var(--ch-fail)" }}>Remove</button>
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
          <button onClick={add} disabled={pending || !skillId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Add</button>
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
  const [jobRoleId, setJobRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () => {
    if (!jobRoleId) return;
    setError(null);
    startTransition(async () => {
      const res = await addCrewSecondaryRole(crewId, jobRoleId);
      if (res?.error) { setError(res.error); return; }
      setJobRoleId("");
      onChanged();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Secondary / Backup Roles</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {secondaryRoles.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>None set.</div>}
        {secondaryRoles.map((sr) => {
          const role = unwrap(sr.job_roles);
          return (
            <div key={sr.id} className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
              {role?.name ?? "Unknown role"}
              {canManage && (
                <button onClick={() => removeCrewSecondaryRole(sr.id, crewId).then(onChanged)} className="text-xs" style={{ color: "var(--ch-fail)" }}>✕</button>
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
          <button onClick={add} disabled={pending || !jobRoleId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Add</button>
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
  const [offshoreSiteId, setOffshoreSiteId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = assignments.find((a) => a.end_date === null) ?? null;
  const history = assignments.filter((a) => a.end_date !== null);

  const assign = () => {
    if (!offshoreSiteId) return;
    setError(null);
    const fd = new FormData();
    fd.set("offshoreSiteId", offshoreSiteId);
    fd.set("startDate", startDate);
    startTransition(async () => {
      const res = await assignCrewToSite(crewId, fd);
      if (res?.error) { setError(res.error); return; }
      setOffshoreSiteId("");
      onChanged();
    });
  };

  const endAssignment = (id: string) => {
    setError(null);
    const fd = new FormData();
    fd.set("endDate", new Date().toISOString().slice(0, 10));
    startTransition(async () => {
      const res = await endCrewAssignment(id, crewId, fd);
      if (res?.error) { setError(res.error); return; }
      onChanged();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Vessel Assignment</div>

      {current ? (
        <div className="flex items-center gap-3 flex-wrap mb-3 rounded-lg border px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
          <div>
            <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{unwrap(current.offshore_sites)?.name ?? "Unknown vessel"}</span>
            <span className="text-xs ml-2" style={{ color: "var(--ch-sub)" }}>since {current.start_date}</span>
          </div>
          {canManage && (
            <button onClick={() => endAssignment(current.id)} disabled={pending} className="text-xs font-semibold ml-auto disabled:opacity-50" style={{ color: "var(--ch-fail)" }}>
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
          <button onClick={assign} disabled={pending || !offshoreSiteId} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            {current ? "Reassign" : "Assign"}
          </button>
        </div>
      )}
      <ErrorLine error={error} />

      {history.length > 0 && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--ch-line)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--ch-sub)" }}>History</div>
          <div className="space-y-1">
            {history.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <span style={{ color: "var(--ch-ink)" }}>{unwrap(a.offshore_sites)?.name ?? "Unknown vessel"}</span>
                <span style={{ color: "var(--ch-sub)" }}>{a.start_date} – {a.end_date}</span>
                {canManage && (
                  <button onClick={() => deleteCrewAssignment(a.id, crewId).then(onChanged)} style={{ color: "var(--ch-fail)" }}>Remove</button>
                )}
              </div>
            ))}
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
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const typeById = (id: string) => documentTypes.find((d) => d.id === id);
  const sorted = [...crewDocuments].sort((a, b) => (typeById(a.document_type_id)?.name ?? "").localeCompare(typeById(b.document_type_id)?.name ?? ""));

  const applicableFields = (documentTypeId: string) =>
    customFieldDefinitions.filter((f) => f.applies_to_document_type_id === null || f.applies_to_document_type_id === documentTypeId);

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Documents & Certifications (restricted)</div>

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
                onDone={() => { setEditingId(null); onChanged(); }}
                onCancel={() => setEditingId(null)}
              />
            );
          }
          const { status, daysRemaining } = computeDocumentStatus(d.expiry_date, type?.warning_threshold_days ?? null, type?.category ?? null);
          const colors = DOCUMENT_STATUS_COLORS[status];
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
              </div>
              {canManage && (
                <>
                  <button onClick={() => setEditingId(d.id)} className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>Edit</button>
                  <button onClick={() => deleteCrewDocument(d.id, crewId).then(onChanged)} className="text-xs font-semibold" style={{ color: "var(--ch-fail)" }}>Remove</button>
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
            onDone={() => { setAdding(false); onChanged(); }}
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
  onDone,
  onCancel,
}: {
  crewId: string;
  crewDocument?: CrewDocument;
  documentTypes: DocumentType[];
  crewList: Ref[];
  customFieldDefinitions: CustomFieldDefinition[];
  onDone: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedType = documentTypes.find((t) => t.id === documentTypeId);
  const isVisa = selectedType?.category === "visa";
  const isVaccination = selectedType?.category === "vaccination";
  const tracksNumber = selectedType?.tracks_number ?? true;
  const applicableFields = customFieldDefinitions.filter(
    (f) => f.applies_to_document_type_id === null || f.applies_to_document_type_id === documentTypeId
  );

  const save = () => {
    if (!documentTypeId) return;
    setError(null);
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
    startTransition(async () => {
      const res = crewDocument
        ? await updateCrewDocument(crewDocument.id, crewId, fd)
        : await createCrewDocument(crewId, fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
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
        <button onClick={save} disabled={pending || !documentTypeId} className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Cancel</button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Cost (permission-gated) ================= */

function CostForm({ crew, canManage, onSaved }: { crew: Crew; canManage: boolean; onSaved: () => void }) {
  const [dayRate, setDayRate] = useState(crew.day_rate != null ? String(crew.day_rate) : "");
  const [currency, setCurrency] = useState(crew.currency ?? "USD");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("dayRate", dayRate);
    fd.set("currency", currency.trim() || "USD");
    startTransition(async () => {
      const res = await updateCrewCost(crew.id, fd);
      if (res?.error) { setError(res.error); return; }
      onSaved();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Cost (restricted)</div>
      <div className="flex items-center gap-2 flex-wrap">
        <input type="number" min={0} step="0.01" className={`${inputCls} w-32`} style={inputStyle} placeholder="Day rate" value={dayRate} onChange={(e) => setDayRate(e.target.value)} disabled={!canManage} />
        <input className={`${inputCls} w-24`} style={inputStyle} placeholder="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!canManage} />
        {canManage && (
          <button onClick={save} disabled={pending} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/* ================= Sensitive (permission-gated) ================= */

function SensitiveForm({ crew, canManage, onSaved }: { crew: Crew; canManage: boolean; onSaved: () => void }) {
  const [notes, setNotes] = useState(crew.dietary_medical_notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("dietaryMedicalNotes", notes.trim());
    startTransition(async () => {
      const res = await updateCrewSensitive(crew.id, fd);
      if (res?.error) { setError(res.error); return; }
      onSaved();
    });
  };

  return (
    <div className={cardCls} style={cardStyle}>
      <div className={labelCls} style={labelStyle}>Dietary / Medical Accommodation Notes (restricted)</div>
      <textarea className={`${inputCls} w-full`} style={inputStyle} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canManage} />
      {canManage && (
        <div className="mt-2">
          <button onClick={save} disabled={pending} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
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
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("linkedProfileId", linkedProfileId);
    startTransition(async () => {
      const res = await linkCrewToUser(crew.id, fd);
      if (res?.error) { setError(res.error); return; }
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
        <select className={inputCls} style={inputStyle} value={linkedProfileId} onChange={(e) => setLinkedProfileId(e.target.value)}>
          <option value="">Not linked</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={save} disabled={pending} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
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
