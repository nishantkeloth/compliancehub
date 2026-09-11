// Phase 9 — general offshore catering norms used by the "from project
// context" and "review" modes. These are defaults; a company can override
// any value under Settings → AI (stored in ai_norm_overrides).

export type NormDef = { key: string; label: string; defaultValue: string; unit?: string; hint?: string };

export const DEFAULT_NORMS: NormDef[] = [
  { key: "camp_boss_threshold_pob", label: "Camp boss / catering manager required above", defaultValue: "40", unit: "POB", hint: "Below this a chief cook usually leads." },
  { key: "chief_cook_per_pob", label: "Chief cook / head chef per", defaultValue: "80", unit: "POB", hint: "Minimum 1." },
  { key: "cook_per_pob", label: "Cook per", defaultValue: "30", unit: "POB", hint: "Round up." },
  { key: "baker_threshold_pob", label: "Baker / night cook required above", defaultValue: "60", unit: "POB" },
  { key: "steward_per_pob", label: "Steward / galley hand per", defaultValue: "12", unit: "POB", hint: "Covers messing and galley cleaning." },
  { key: "housekeeper_per_cabins", label: "Housekeeper per", defaultValue: "25", unit: "cabins / beds", hint: "Applies when housekeeping is in scope." },
  { key: "laundry_attendant_per_pob", label: "Laundry attendant per", defaultValue: "50", unit: "POB", hint: "Applies when laundry is in scope." },
  { key: "night_coverage", label: "24-hour galley coverage when the site runs night shifts", defaultValue: "yes", unit: "yes/no", hint: "Adds a night cook/steward line." },
  { key: "default_rotation", label: "Default rotation", defaultValue: "28/28", hint: "e.g. 28/28, 35/35, 42/21." },
  { key: "mandatory_certificates", label: "Mandatory certificates for all catering roles", defaultValue: "BOSIET/HUET, Offshore medical (OGUK/UAE), Food hygiene (Level 2), Seaman's book or equivalent" },
  { key: "supervisor_extra_certificates", label: "Extra certificates for supervisors (camp boss / chief cook)", defaultValue: "Food hygiene Level 3, HACCP" },
  { key: "min_experience_supervisor_years", label: "Minimum experience — supervisors", defaultValue: "5", unit: "years" },
  { key: "min_experience_cook_years", label: "Minimum experience — cooks", defaultValue: "3", unit: "years" },
  { key: "mobilization_lead_days", label: "Default mobilization lead time", defaultValue: "14", unit: "days" },
];

export function effectiveNorms(overrides: { norm_key: string; value_text: string; is_active: boolean }[]): { key: string; label: string; value: string; unit?: string; overridden: boolean }[] {
  const byKey = new Map(overrides.filter((o) => o.is_active).map((o) => [o.norm_key, o.value_text]));
  return DEFAULT_NORMS.map((n) => ({ key: n.key, label: n.label, value: byKey.get(n.key) ?? n.defaultValue, unit: n.unit, overridden: byKey.has(n.key) }));
}

export function normsAsPromptText(norms: ReturnType<typeof effectiveNorms>) {
  return norms.map((n) => `- ${n.label}: ${n.value}${n.unit ? ` ${n.unit}` : ""} [norm:${n.key}]`).join("\n");
}
