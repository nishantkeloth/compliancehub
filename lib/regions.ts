import { COUNTRIES } from "./countries";

// Phase 16 (revised) — a shared, fixed list of options for
// crew_profiles.current_location, so it can be exact-matched against a
// site/project's operating_region (offshore_sites.operating_region /
// projects.operating_region) on the Crew Matrix Staffing Plan's Available
// Candidates / Other Location Candidates split (sameRegion() in
// staffing-plan.tsx). Those two fields stay free text (unconstrained,
// entered rarely, by an admin) — this list only constrains the much
// higher-volume, per-crew-member field, so a crew member's location can
// only ever read one of these values and reliably match a site whose
// Operating Region is typed the same way.
//
// Originally just AHM's own Gulf operating regions (the UAE's individual
// emirates plus the neighbouring countries AHM crews into). Widened to
// every country in lib/countries.ts, since a crew member's current
// location is very often just their home country while not yet mobilized
// — but the UAE's emirates stay as their own entries alongside
// "United Arab Emirates", because a site whose Operating Region is
// specifically "Abu Dhabi" or "Dubai" can only be matched by a crew
// member whose location reads the same way, not the country as a whole.
// Duplicate names between the two sources (Qatar, Saudi Arabia, Oman are
// in both) are removed automatically.
export const REGIONS: string[] = Array.from(
  new Set<string>(["Abu Dhabi", "Dubai", "Sharjah", ...COUNTRIES, "Other"])
);
