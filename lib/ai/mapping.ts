// Phase 9 — map model-produced names to this company's master data.
// exact → case-insensitive → alias table → fuzzy (token overlap ≥ 0.6).

export type Ref = { id: string; name: string };
export type EntityType = "job_role" | "skill" | "document_type" | "rotation_template";
export type Alias = { entity_type: EntityType; alias: string; target_id: string };

export type Mapping = { name: string; targetId: string | null; targetName: string | null; method: "exact" | "alias" | "fuzzy" | "none"; score: number };

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string) {
  return new Set(norm(s).split(" ").filter((t) => t.length > 1 && !["the", "and", "of", "for", "a", "an"].includes(t)));
}
function similarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

export function mapName(name: string, entityType: EntityType, refs: Ref[], aliases: Alias[]): Mapping {
  const n = norm(name);
  const exact = refs.find((r) => norm(r.name) === n);
  if (exact) return { name, targetId: exact.id, targetName: exact.name, method: "exact", score: 1 };
  const alias = aliases.find((a) => a.entity_type === entityType && norm(a.alias) === n);
  if (alias) {
    const target = refs.find((r) => r.id === alias.target_id);
    if (target) return { name, targetId: target.id, targetName: target.name, method: "alias", score: 1 };
  }
  let best: { ref: Ref; score: number } | null = null;
  for (const r of refs) {
    const s = similarity(name, r.name);
    if (s > (best?.score ?? 0)) best = { ref: r, score: s };
  }
  if (best && best.score >= 0.6) return { name, targetId: best.ref.id, targetName: best.ref.name, method: "fuzzy", score: best.score };
  return { name, targetId: null, targetName: null, method: "none", score: best?.score ?? 0 };
}

// Rotation names like "28/28" also match templates with days_on/days_off.
export function mapRotation(name: string, templates: { id: string; name: string; days_on: number | null; days_off: number | null }[], aliases: Alias[]): Mapping {
  const direct = mapName(name, "rotation_template", templates, aliases);
  if (direct.targetId) return direct;
  const m = name.match(/(\d+)\s*[/x-]\s*(\d+)/);
  if (m) {
    const on = Number(m[1]);
    const off = Number(m[2]);
    const t = templates.find((x) => x.days_on === on && x.days_off === off);
    if (t) return { name, targetId: t.id, targetName: t.name, method: "fuzzy", score: 0.9 };
  }
  return direct;
}
