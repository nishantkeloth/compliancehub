// Version-to-version comparison for crew matrices — the pure half. Given two
// resolved snapshots (names already looked up), list what was added, removed
// or changed. No I/O here, so the same code feeds the Versions tab, the
// approval panel and the frozen summary stored with a version.
//
// How lines are matched: by job role. If a role appears on several lines in
// both versions, they are paired in line order; extras count as added or
// removed. Skills, documents, competencies and client requirements are
// compared as sets, so merely reordering them shows no change.

export type SnapSkill = { id: string; name: string };
export type SnapDocument = {
  document_type_id: string;
  name: string;
  minimum_remaining_validity_days: number | null;
  is_mandatory: boolean;
  waiver_permitted: boolean;
};
export type SnapCompetency = { competency_name: string; minimum_grade: string | null; notes: string | null };
export type SnapClientReq = { requirement_text: string; is_mandatory: boolean };

export type SnapLine = {
  job_role_id: string;
  roleName: string;
  line_number: number;
  required_headcount: number | null;
  day_shift_quantity: number | null;
  night_shift_quantity: number | null;
  other_shift_quantity: number | null;
  rotationName: string | null;
  employment_type_preference: string | null;
  nationality_preference: string | null;
  language_requirement: string | null;
  minimum_experience_years: number | null;
  mobilization_lead_days: number | null;
  client_approval_required: boolean;
  remarks: string | null;
  skills: SnapSkill[];
  documents: SnapDocument[];
  competencies: SnapCompetency[];
  clientReqs: SnapClientReq[];
};

export type SnapMatrix = {
  title: string;
  effective_from: string | null;
  effective_to: string | null;
  expected_pob: number | null;
  notes: string | null;
  lines: SnapLine[];
};

export type FieldChange = { label: string; from: string; to: string };
export type SetChange = { kind: "added" | "removed" | "changed"; group: string; label: string; detail?: string };
export type LineChange = {
  status: "added" | "removed" | "changed";
  roleId: string;
  roleName: string;
  lineNumber: number;
  /** Headcount in the older / newer version (null when the line is absent there). */
  headcountFrom: number | null;
  headcountTo: number | null;
  fields: FieldChange[];
  sets: SetChange[];
};
export type MatrixDiff = {
  header: FieldChange[];
  lines: LineChange[];
  unchangedLines: number;
  counts: { linesAdded: number; linesRemoved: number; linesChanged: number; headerChanged: number; edits: number };
};

const DASH = "—";

function show(v: string | number | null | undefined): string {
  if (v == null) return DASH;
  const s = String(v).trim();
  return s ? s : DASH;
}
function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}
function norm(v: string | null | undefined): string {
  return (v ?? "").trim().replace(/\s+/g, " ");
}
function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}
function sameNum(a: number | null | undefined, b: number | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

function pushText(out: FieldChange[], label: string, a: string | null, b: string | null) {
  if (!sameText(a, b)) out.push({ label, from: show(norm(a) || null), to: show(norm(b) || null) });
}
function pushNum(out: FieldChange[], label: string, a: number | null, b: number | null, unit = "") {
  if (!sameNum(a, b)) out.push({ label, from: a == null ? DASH : `${a}${unit}`, to: b == null ? DASH : `${b}${unit}` });
}

function diffHeader(a: SnapMatrix, b: SnapMatrix): FieldChange[] {
  const out: FieldChange[] = [];
  pushText(out, "Title", a.title, b.title);
  pushText(out, "Effective from", a.effective_from, b.effective_from);
  pushText(out, "Effective to", a.effective_to, b.effective_to);
  pushNum(out, "Expected POB", a.expected_pob, b.expected_pob);
  pushText(out, "Notes", a.notes, b.notes);
  return out;
}

function diffLineFields(a: SnapLine, b: SnapLine): FieldChange[] {
  const out: FieldChange[] = [];
  pushNum(out, "Headcount", a.required_headcount, b.required_headcount);
  pushNum(out, "Day shift", a.day_shift_quantity, b.day_shift_quantity);
  pushNum(out, "Night shift", a.night_shift_quantity, b.night_shift_quantity);
  pushNum(out, "Other shift", a.other_shift_quantity, b.other_shift_quantity);
  pushText(out, "Rotation", a.rotationName, b.rotationName);
  pushText(out, "Employment type", a.employment_type_preference, b.employment_type_preference);
  pushText(out, "Nationality preference", a.nationality_preference, b.nationality_preference);
  pushText(out, "Language", a.language_requirement, b.language_requirement);
  pushNum(out, "Minimum experience", a.minimum_experience_years, b.minimum_experience_years, " yrs");
  pushNum(out, "Mobilization lead days", a.mobilization_lead_days, b.mobilization_lead_days);
  if (a.client_approval_required !== b.client_approval_required) {
    out.push({ label: "Client approval required", from: yesNo(a.client_approval_required), to: yesNo(b.client_approval_required) });
  }
  pushText(out, "Remarks", a.remarks, b.remarks);
  return out;
}

function diffSets(a: SnapLine, b: SnapLine): SetChange[] {
  const out: SetChange[] = [];

  // Skills — by skill id.
  const aSkills = new Map(a.skills.map((s) => [s.id, s]));
  const bSkills = new Map(b.skills.map((s) => [s.id, s]));
  for (const [id, s] of bSkills) if (!aSkills.has(id)) out.push({ kind: "added", group: "Skill", label: s.name });
  for (const [id, s] of aSkills) if (!bSkills.has(id)) out.push({ kind: "removed", group: "Skill", label: s.name });

  // Documents — by document type id; a rule change is "changed".
  const aDocs = new Map(a.documents.map((d) => [d.document_type_id, d]));
  const bDocs = new Map(b.documents.map((d) => [d.document_type_id, d]));
  const docRule = (d: SnapDocument) =>
    `${d.is_mandatory ? "mandatory" : "optional"}${
      d.minimum_remaining_validity_days != null ? `, ${d.minimum_remaining_validity_days} days validity` : ""
    }${d.waiver_permitted ? ", waiver allowed" : ""}`;
  for (const [id, d] of bDocs) {
    const old = aDocs.get(id);
    if (!old) out.push({ kind: "added", group: "Document", label: d.name, detail: docRule(d) });
    else if (docRule(old) !== docRule(d)) {
      const parts: string[] = [];
      if (old.minimum_remaining_validity_days !== d.minimum_remaining_validity_days) {
        parts.push(`minimum validity ${show(old.minimum_remaining_validity_days)}${old.minimum_remaining_validity_days != null ? " d" : ""} → ${show(d.minimum_remaining_validity_days)}${d.minimum_remaining_validity_days != null ? " d" : ""}`);
      }
      if (old.is_mandatory !== d.is_mandatory) parts.push(`${old.is_mandatory ? "mandatory" : "optional"} → ${d.is_mandatory ? "mandatory" : "optional"}`);
      if (old.waiver_permitted !== d.waiver_permitted) parts.push(`waiver ${old.waiver_permitted ? "allowed" : "not allowed"} → ${d.waiver_permitted ? "allowed" : "not allowed"}`);
      out.push({ kind: "changed", group: "Document", label: d.name, detail: parts.join("; ") });
    }
  }
  for (const [id, d] of aDocs) if (!bDocs.has(id)) out.push({ kind: "removed", group: "Document", label: d.name });

  // Competencies — by name (case-insensitive).
  const key = (s: string) => norm(s).toLowerCase();
  const aComp = new Map(a.competencies.map((c) => [key(c.competency_name), c]));
  const bComp = new Map(b.competencies.map((c) => [key(c.competency_name), c]));
  for (const [k, c] of bComp) {
    const old = aComp.get(k);
    if (!old) out.push({ kind: "added", group: "Competency", label: c.competency_name, detail: c.minimum_grade ? `minimum grade ${c.minimum_grade}` : undefined });
    else if (!sameText(old.minimum_grade, c.minimum_grade) || !sameText(old.notes, c.notes)) {
      const parts: string[] = [];
      if (!sameText(old.minimum_grade, c.minimum_grade)) parts.push(`minimum grade ${show(old.minimum_grade)} → ${show(c.minimum_grade)}`);
      if (!sameText(old.notes, c.notes)) parts.push("notes edited");
      out.push({ kind: "changed", group: "Competency", label: c.competency_name, detail: parts.join("; ") });
    }
  }
  for (const [k, c] of aComp) if (!bComp.has(k)) out.push({ kind: "removed", group: "Competency", label: c.competency_name });

  // Client requirements — by text.
  const aReq = new Map(a.clientReqs.map((r) => [key(r.requirement_text), r]));
  const bReq = new Map(b.clientReqs.map((r) => [key(r.requirement_text), r]));
  for (const [k, r] of bReq) {
    const old = aReq.get(k);
    if (!old) out.push({ kind: "added", group: "Client requirement", label: r.requirement_text, detail: r.is_mandatory ? "mandatory" : "optional" });
    else if (old.is_mandatory !== r.is_mandatory) {
      out.push({ kind: "changed", group: "Client requirement", label: r.requirement_text, detail: `${old.is_mandatory ? "mandatory" : "optional"} → ${r.is_mandatory ? "mandatory" : "optional"}` });
    }
  }
  for (const [k, r] of aReq) if (!bReq.has(k)) out.push({ kind: "removed", group: "Client requirement", label: r.requirement_text });

  return out;
}

export function diffMatrices(from: SnapMatrix, to: SnapMatrix): MatrixDiff {
  const header = diffHeader(from, to);

  const byRole = (lines: SnapLine[]) => {
    const m = new Map<string, SnapLine[]>();
    for (const l of [...lines].sort((x, y) => x.line_number - y.line_number)) {
      const arr = m.get(l.job_role_id) ?? [];
      arr.push(l);
      m.set(l.job_role_id, arr);
    }
    return m;
  };
  const fromBy = byRole(from.lines);
  const toBy = byRole(to.lines);
  const roleIds = Array.from(new Set([...toBy.keys(), ...fromBy.keys()]));

  const lines: LineChange[] = [];
  let unchanged = 0;

  for (const roleId of roleIds) {
    const a = fromBy.get(roleId) ?? [];
    const b = toBy.get(roleId) ?? [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const la = a[i];
      const lb = b[i];
      if (la && lb) {
        const fields = diffLineFields(la, lb);
        const sets = diffSets(la, lb);
        if (fields.length || sets.length) {
          lines.push({
            status: "changed",
            roleId,
            roleName: lb.roleName,
            lineNumber: lb.line_number,
            headcountFrom: la.required_headcount,
            headcountTo: lb.required_headcount,
            fields,
            sets,
          });
        } else unchanged++;
      } else if (lb) {
        lines.push({
          status: "added",
          roleId,
          roleName: lb.roleName,
          lineNumber: lb.line_number,
          headcountFrom: null,
          headcountTo: lb.required_headcount,
          fields: [],
          sets: [],
        });
      } else if (la) {
        lines.push({
          status: "removed",
          roleId,
          roleName: la.roleName,
          lineNumber: la.line_number,
          headcountFrom: la.required_headcount,
          headcountTo: null,
          fields: [],
          sets: [],
        });
      }
    }
  }

  // Newest-version order: added and changed lines by their line number, removed last.
  const rank = { added: 0, changed: 1, removed: 2 } as const;
  lines.sort((x, y) => rank[x.status] - rank[y.status] || x.lineNumber - y.lineNumber);

  const linesAdded = lines.filter((l) => l.status === "added").length;
  const linesRemoved = lines.filter((l) => l.status === "removed").length;
  const linesChanged = lines.filter((l) => l.status === "changed").length;
  const edits = lines.filter((l) => l.status === "changed").reduce((s, l) => s + l.fields.length + l.sets.length, 0);

  return {
    header,
    lines,
    unchangedLines: unchanged,
    counts: { linesAdded, linesRemoved, linesChanged, headerChanged: header.length, edits },
  };
}

export function hasChanges(d: MatrixDiff): boolean {
  return d.header.length > 0 || d.lines.length > 0;
}

/** Total number of individual changes, for a "7 changes" badge. */
export function totalChanges(d: MatrixDiff): number {
  return d.header.length + d.counts.linesAdded + d.counts.linesRemoved + d.counts.edits;
}

/** One short sentence per change, for the frozen summary, approvals and the client email. */
export function summarizeDiff(d: MatrixDiff): string[] {
  const out: string[] = [];
  for (const h of d.header) out.push(`${h.label}: ${h.from} → ${h.to}`);
  for (const l of d.lines) {
    const name = `Line ${l.lineNumber} · ${l.roleName}`;
    if (l.status === "added") out.push(`${name} added${l.headcountTo != null ? ` (headcount ${l.headcountTo})` : ""}`);
    else if (l.status === "removed") out.push(`${name} removed${l.headcountFrom != null ? ` (headcount was ${l.headcountFrom})` : ""}`);
    else {
      for (const f of l.fields) out.push(`${name}: ${f.label} ${f.from} → ${f.to}`);
      for (const s of l.sets) out.push(`${name}: ${s.group} ${s.label} ${s.kind}${s.detail ? ` (${s.detail})` : ""}`);
    }
  }
  return out;
}
