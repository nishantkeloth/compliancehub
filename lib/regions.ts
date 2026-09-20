// Phase 16 — a shared, fixed list of region options for
// crew_profiles.current_location, so it can be exact-matched against a
// site/project's operating_region (offshore_sites.operating_region /
// projects.operating_region) on the Crew Matrix Staffing Plan's Available
// Candidates list. Those two fields stay free text (unconstrained,
// entered rarely, by an admin) — this list only constrains the much
// higher-volume, per-crew-member field, so a crew member's location can
// only ever read one of these values and reliably match a site whose
// Operating Region is typed the same way. Extend this list as AHM's
// actual operating regions become clear; it's a plain constant, not a
// database table, so a future increment can promote it to an
// admin-configurable list without changing how any of these call sites
// use it.
export const REGIONS = ["Abu Dhabi", "Dubai", "Sharjah", "Qatar", "Saudi Arabia", "Oman", "Other"] as const;
