// Send-time document verification — the pure comparison half. Given what
// the AI read off a stored document file and what ComplianceHub has on
// record for that crew member and document, decide pass / warn / fail per
// check. No I/O here, so it runs identically in the wizard preview and in
// the send action (which re-runs it server-side and trusts nothing the
// browser says about results).
//
// What this can and can't tell you: it checks the file agrees with itself
// and with the record (name, number, expiry, type, still valid for the
// link's lifetime). It cannot confirm a certificate is genuine with the
// issuing body.

export type CheckKey = "name" | "number" | "expiry" | "type" | "validity";
export type CheckState = "pass" | "warn" | "fail" | "na";
export type Overall = "pass" | "warn" | "fail" | "unread" | "no_file" | "not_verified";

export type DocRead = {
  holder_name: string | null;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  document_type_name: string | null;
  confidence: number;
  source_excerpt: string | null;
};

export type Expected = {
  crewName: string;
  typeName: string;
  tracksNumber: boolean;
  number: string | null;
  issueDate: string | null;
  expiryDate: string | null;
};

export type Check = {
  key: CheckKey;
  label: string;
  state: CheckState;
  recorded: string | null;
  found: string | null;
  note: string | null;
};

export const LINK_VALID_DAYS = 30;

const TITLES = new Set(["MR", "MRS", "MS", "MISS", "DR", "CAPT", "CAPTAIN"]);

function nameTokens(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

function editDistanceAtMost1(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatches(a: string, b: string) {
  if (a === b) return "exact" as const;
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return "fuzzy" as const;
  if (a.length > 4 && b.length > 4 && editDistanceAtMost1(a, b)) return "fuzzy" as const;
  return null;
}

// Same person, allowing reordered names, initials, a missing middle name
// and a one-letter spelling variant (MOHAMMED / MOHAMMAD). Anything less
// than every token of the shorter name being accounted for is a fail.
export function compareNames(recorded: string, found: string): { state: CheckState; note: string | null } {
  const a = nameTokens(recorded);
  const b = nameTokens(found);
  if (a.length === 0 || b.length === 0) return { state: "warn", note: "Could not compare names." };
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const used = new Set<number>();
  let fuzzy = false;
  for (const t of short) {
    let hit = -1;
    let kind: "exact" | "fuzzy" | null = null;
    for (let i = 0; i < long.length; i++) {
      if (used.has(i)) continue;
      const m = tokenMatches(t, long[i]);
      if (m === "exact") {
        hit = i;
        kind = m;
        break;
      }
      if (m && hit === -1) {
        hit = i;
        kind = m;
      }
    }
    if (hit === -1) return { state: "fail", note: "The name on the file does not match the crew record." };
    used.add(hit);
    if (kind === "fuzzy") fuzzy = true;
  }
  if (!fuzzy && a.length === b.length) return { state: "pass", note: null };
  return { state: "warn", note: "Close match — check it is the same person." };
}

export function normaliseNumber(s: string | null | undefined) {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export function looseTypeMatch(a: string, b: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return true;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter((t) => t.length > 2));
  const tb = new Set(nb.split(" ").filter((t) => t.length > 2));
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size, 1) >= 0.4;
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function runChecks(expected: Expected, read: DocRead, now: Date = new Date()): Check[] {
  const checks: Check[] = [];

  // Name
  if (!read.holder_name) {
    checks.push({ key: "name", label: "Name", state: "warn", recorded: expected.crewName, found: null, note: "No holder name could be read from the file." });
  } else {
    const r = compareNames(expected.crewName, read.holder_name);
    checks.push({ key: "name", label: "Name", state: r.state, recorded: expected.crewName, found: read.holder_name, note: r.note });
  }

  // Number
  if (!expected.tracksNumber || !expected.number) {
    checks.push({ key: "number", label: "Number", state: "na", recorded: expected.number, found: read.document_number, note: null });
  } else if (!read.document_number) {
    checks.push({ key: "number", label: "Number", state: "warn", recorded: expected.number, found: null, note: "No number could be read from the file." });
  } else if (normaliseNumber(expected.number) === normaliseNumber(read.document_number)) {
    checks.push({ key: "number", label: "Number", state: "pass", recorded: expected.number, found: read.document_number, note: null });
  } else {
    checks.push({ key: "number", label: "Number", state: "fail", recorded: expected.number, found: read.document_number, note: "The number on the file differs from the record." });
  }

  // Expiry
  if (!expected.expiryDate && !read.expiry_date) {
    checks.push({ key: "expiry", label: "Expiry", state: "na", recorded: null, found: null, note: null });
  } else if (!read.expiry_date) {
    checks.push({ key: "expiry", label: "Expiry", state: "warn", recorded: expected.expiryDate, found: null, note: "No expiry date could be read from the file." });
  } else if (!expected.expiryDate) {
    checks.push({ key: "expiry", label: "Expiry", state: "warn", recorded: null, found: read.expiry_date, note: "The record has no expiry date; the file shows one." });
  } else if (expected.expiryDate === read.expiry_date) {
    checks.push({ key: "expiry", label: "Expiry", state: "pass", recorded: expected.expiryDate, found: read.expiry_date, note: null });
  } else {
    checks.push({ key: "expiry", label: "Expiry", state: "fail", recorded: expected.expiryDate, found: read.expiry_date, note: "The expiry date on the file differs from the record." });
  }

  // Type
  if (!read.document_type_name) {
    checks.push({ key: "type", label: "Type", state: "warn", recorded: expected.typeName, found: null, note: "The document type could not be identified." });
  } else if (looseTypeMatch(read.document_type_name, expected.typeName)) {
    checks.push({ key: "type", label: "Type", state: "pass", recorded: expected.typeName, found: read.document_type_name, note: null });
  } else {
    checks.push({ key: "type", label: "Type", state: "fail", recorded: expected.typeName, found: read.document_type_name, note: "The file looks like a different kind of document." });
  }

  // Validity for the whole life of the secure link — judged on the date
  // printed on the file when readable, otherwise on the record.
  const validityDate = read.expiry_date ?? expected.expiryDate;
  if (!validityDate) {
    checks.push({ key: "validity", label: `Valid for ${LINK_VALID_DAYS} days`, state: "na", recorded: null, found: null, note: null });
  } else {
    const today = isoDay(now);
    const linkEnd = isoDay(new Date(now.getTime() + LINK_VALID_DAYS * 24 * 60 * 60 * 1000));
    if (validityDate < today) {
      checks.push({ key: "validity", label: `Valid for ${LINK_VALID_DAYS} days`, state: "fail", recorded: null, found: validityDate, note: "Expired." });
    } else if (validityDate < linkEnd) {
      const days = Math.max(0, Math.round((Date.parse(validityDate) - Date.parse(today)) / 86400000));
      checks.push({ key: "validity", label: `Valid for ${LINK_VALID_DAYS} days`, state: "warn", recorded: null, found: validityDate, note: `Expires in ${days} day${days === 1 ? "" : "s"}, before the link ends.` });
    } else {
      checks.push({ key: "validity", label: `Valid for ${LINK_VALID_DAYS} days`, state: "pass", recorded: null, found: validityDate, note: null });
    }
  }

  return checks;
}

export function overallOf(checks: Check[]): "pass" | "warn" | "fail" {
  if (checks.some((c) => c.state === "fail")) return "fail";
  if (checks.some((c) => c.state === "warn")) return "warn";
  return "pass";
}

// What the verify step and the send action both operate on: one row per
// crew member × required document that has a record.
export type VerifyItem = {
  key: string; // `${crewId}:${docTypeId}`
  crewId: string;
  crewName: string;
  roleName: string;
  docTypeId: string;
  docTypeName: string;
  versionId: string | null; // latest stored file, null when the record has no file
  fileName: string | null;
  expected: Expected;
};

export type VerifyOutcome = {
  key: string;
  overall: Overall;
  checks: Check[];
  error: string | null;
};

export type Decision = { key: string; decision: "include" | "exclude"; reason?: string };

export type Policy = "auto_exclude" | "require_decision";

// Whether a document goes out, given its outcome, the sender's explicit
// decision (if any) and the policy. Shared by the wizard (to show the
// consequence) and the send action (to enforce it).
export function resolveInclusion(outcome: VerifyOutcome, decision: Decision | undefined): { include: boolean; needsDecision: boolean; overridden: boolean } {
  const o = outcome.overall;
  if (decision?.decision === "exclude") return { include: false, needsDecision: false, overridden: false };
  if (o === "pass" || o === "warn") return { include: true, needsDecision: false, overridden: false };
  if (decision?.decision === "include") return { include: true, needsDecision: false, overridden: true };
  // fail / unread / not_verified / no_file with no decision
  return { include: false, needsDecision: o !== "no_file", overridden: false };
}

export function overallLabel(o: Overall) {
  switch (o) {
    case "pass":
      return "Verified";
    case "warn":
      return "Verified with a note";
    case "fail":
      return "Failed";
    case "unread":
      return "Could not read";
    case "no_file":
      return "No file stored";
    default:
      return "Not verified";
  }
}

export type ReadRow = { read_ok: boolean; read_json: DocRead | null; read_error: string | null };

// Turns a cached reading (or the lack of one) plus the record into the
// outcome shown in the wizard and enforced at send.
export function outcomeFor(item: VerifyItem, read: ReadRow | undefined | null, now: Date = new Date()): VerifyOutcome {
  if (!item.versionId) return { key: item.key, overall: "no_file", checks: [], error: null };
  if (!read) return { key: item.key, overall: "not_verified", checks: [], error: null };
  if (!read.read_ok || !read.read_json) return { key: item.key, overall: "unread", checks: [], error: read.read_error ?? "The file could not be read." };
  const checks = runChecks(item.expected, read.read_json, now);
  return { key: item.key, overall: overallOf(checks), checks, error: null };
}
