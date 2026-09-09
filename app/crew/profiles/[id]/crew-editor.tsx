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
} from "../actions";

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
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <div className="mt-4 max-w-3xl">
      <GeneralForm crew={crew} canManage={canManage} jobRoles={jobRoles} rotationTemplates={rotationTemplates} onSaved={refresh} />

      <SkillsSection crewId={crew.id} skills={skills} crewSkills={crewSkills} canManage={canManage} onChanged={refresh} />

      <SecondaryRolesSection crewId={crew.id} jobRoles={jobRoles} secondaryRoles={secondaryRoles} canManage={canManage} onChanged={refresh} />

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
