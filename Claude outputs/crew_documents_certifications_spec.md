# Crew Documents & Certifications — Feature Spec

## 1. Why this exists

Testing the Crew Matrix module confirmed the Crew Profile form covers identity and
employment basics (name, nationality, role, skills, cost, dietary/medical notes) but
has no home for the data actually driving day-to-day ops: KSA visas, passports,
seaman books, and safety certifications — all of which currently live in per-vessel
Excel trackers (`KSA VISA TRACKER`, `TEAM DORA CREW MATRIX`) with manual 75/90-day
watching.

Gap found, mapped from the two source files:

| Source file | Fields not represented in Crew Profile today |
|---|---|
| KSA Visa Tracker (per vessel) | Visa number, issue/expiry, entry date, 75-day / 90-day flags, extension date, sponsor, visa type, reliever |
| Team Crew Matrix | Passport (number, issue, expiry); Seaman book (number, issue, expiry); COC, STCW, STSDSD, H2S, Medical, IK Medical, Food Safety certificates (each issue + expiry); vaccinations (Hep A, Hep B, Typhoid, Chickenpox); COVID doses (1st, 2nd, booster) |

The Crew Profiles page already anticipates this: its subheading reads *"Documents,
certifications, and deployment assignments build on this and come next."* This spec
is that next phase.

## 2. Data model

Follow the existing master-data pattern already used for job roles, skills, clients,
and rotation templates (an org-scoped lookup table + a per-crew-member linking
table), rather than one wide crew_profiles table with dozens of extra columns.

**Extensibility: JSONB custom fields (confirmed).** The core fields below (document
number, issue/expiry date, sponsor, entry/extension date) stay real typed columns —
they're the fields every document type already needs. Anything beyond that — an
org wanting to additionally track "Issuing Authority", "Renewal Fee", or whatever
else comes up later — is defined by the org itself at runtime, not shipped as a
migration. This trades a small amount of query/index overhead for zero engineering
turnaround when a new attribute is needed, which matters more once this becomes a
multi-tenant SaaS module than it does today. See section 2a.

**`document_types`** (org-scoped master data, managed in Crew Setup like Job Roles/Skills)
| column | notes |
|---|---|
| id | uuid |
| org_id | via `my_org_id()`, same RLS pattern as job_roles/skills |
| name | e.g. "COC", "STCW", "H2S", "Food Safety Certificate", "Seaman Book", "Passport" |
| category | enum: `visa`, `travel_document`, `certificate`, `vaccination` |
| default_validity_months | e.g. 60 for a 5-year cert, 24 for H2S, 12 for Medical — used to auto-suggest an expiry date from an issue date |
| tracks_number | bool — passport/seaman book/visa have a document number; a plain vaccination doesn't |
| active | bool, same as job_roles/skills |

Seed this table with the 13 document types already visible in the two spreadsheets
(visa, passport, seaman book, COC, STCW, STSDSD, H2S, Medical, IK Medical, Food
Safety Cert, Hep A, Hep B, Typhoid, Chickenpox, COVID) so nothing has to be
hand-entered before the first import.

**`crew_documents`** (the per-crew-member record)
| column | notes |
|---|---|
| id | uuid |
| crew_id | FK → crew_profiles |
| document_type_id | FK → document_types |
| document_number | nullable text — visa number, passport number, seaman book number |
| sponsor | nullable text — visa sponsor (e.g. "Allianz Marine Service") |
| issue_date | date |
| expiry_date | date |
| entry_date | nullable date — KSA entry date, visa-specific |
| extension_date | nullable date |
| dose_number | nullable text — for COVID vaccination: "1st", "2nd", "booster" |
| reliever_crew_id | nullable FK → crew_profiles — who covers if this crew member's visa lapses |
| notes | nullable text |
| custom_fields | `jsonb not null default '{}'` — org-defined attributes, keyed by `field_key` from `document_custom_field_definitions` below |

One row per document/cert per crew member, so someone can hold a COVID 1st dose,
2nd dose, and booster as three rows without schema changes, and a re-issued visa
just gets a new row rather than overwriting history.

### 2a. `document_custom_field_definitions` (org-scoped, admin-managed)

| column | notes |
|---|---|
| id | uuid |
| org_id | via `my_org_id()`, same RLS pattern as job_roles/skills |
| label | e.g. "Issuing Authority", "Renewal Fee" |
| field_key | slug derived from label (e.g. `issuing_authority`) — the JSON key used in `crew_documents.custom_fields` |
| field_type | enum: `text`, `number`, `date` |
| applies_to_document_type_id | nullable FK → document_types — null means "every document type"; set means scoped to one (e.g. a fee that only applies to visas) |
| sort_order | int — controls display order in the popover |
| active | bool, same as job_roles/skills — deactivating hides the field going forward without deleting historical data already stored in existing rows |
| created_by / updated_by | audit columns, same convention as other master data |

Managed on a new **Crew Setup → Custom Fields** tab (kept inside Crew Setup
alongside Document Types, Job Roles, Skills — rather than a separate global "Org
Settings" area — since these fields only ever apply to crew documents). Any
crew.manage-permitted user can add a field there and it appears in every document
edit popover immediately, no deploy required.

A GIN index on `crew_documents (custom_fields)` keeps ad-hoc filtering (e.g.
"show me everyone with Issuing Authority = DNV GL") usable once custom fields are
in real use; the matrix view's built-in filters (vessel, document type, status)
stay backed by the typed columns and don't depend on this index.

**`crew_documents_unique`**: no hard uniqueness constraint on (crew_id,
document_type_id) — certificates and vaccination doses legitimately repeat over a
career. Expiry status is always computed from the most recent row per crew_id +
document_type_id (+ dose_number where applicable).

**Vessel/site link**: separately, add `current_site_id` (FK → offshore_sites,
nullable) directly on `crew_profiles` — the spreadsheets are literally one tab per
vessel, so "which vessel is this person on" is a first-class piece of data, not a
document.

## 3. Expiry status logic

A shared helper (mirrors `getEffectiveAccess()`'s role as a single source of truth)
computes, for each `crew_documents` row:

- `days_remaining` = expiry_date − today
- `status`: `expired` (< 0 days), `critical` (0–14 days), `warning` (15–75 days),
  `ok` (> 75 days) — the 75/90-day bands already in the KSA tracker become the
  warning thresholds specifically for `category = 'visa'`; other categories can use
  a simpler 30/90-day band, configurable per document_type via a
  `warning_threshold_days` column if the org wants different windows per cert type.

This status drives both the crew profile view and the matrix view below, and is
the natural hook for a future notification/alert feature (email or dashboard
banner when something crosses into `critical`).

## 4. UI

### 4a. Documents matrix (primary view — table layout, confirmed)

A new page, `Crew Matrix → Crew Documents` (its own nav item under Crew Matrix,
alongside Crew Profiles and Crew Setup). Rows = crew members, columns = document
types, one column per type with the expiry date and a color-coded status pill
(green/amber/red matching the status logic above) — a direct digital replacement
for the "TEAM DORA CREW MATRIX" spreadsheet. Layout confirmed against the mockup
sent for review; the interaction it locks in:

- Click any cell to open an inline popover for that one crew member's record for
  that document type — document number, issue date, expiry date, and sponsor
  (sponsor only shown for visa-category types) — Save/Cancel, no page navigation.
  Updating twenty crew members' Food Safety Certificate dates after a renewal
  batch stays a single-screen task. If the org has defined custom fields for that
  document type (2a), they render below a "Custom fields" divider in the same
  popover, generated from the active field definitions — no separate screen.
- Toolbar above the table: a vessel/site filter and a document-type filter (both
  dropdowns), a crew-member search box, and a status quick-filter as pill buttons
  — All / Expiring soon / Expired — so "everything expiring in the next 30 days"
  is one click, replacing the manual 75/90-day columns in the current sheet.
- A legend (OK / Expiring / Expired with the same dot colors as the pills) sits
  above the table.
- Crew-member column is sticky on scroll (name + role + vessel sub-label) so it
  stays visible while scrolling across document-type columns.
- Export to CSV/XLSX from this same table, so the org isn't locked out of the
  spreadsheet format they're used to sharing with agents/sponsors.

### 4b. Per-crew detail (secondary view)

A "Documents & Certifications" section added to the existing crew profile detail
page (same place the "SKILLS" and "SECONDARY / BACKUP ROLES" sections live today),
listing every document/cert for that one person with full fields (sponsor,
reliever, notes) — useful when someone is looking at one crew member's full file
rather than scanning across the team.

### 4c. Bulk import

Since the real data already exists in the two spreadsheet formats, a one-time
importer (upload the existing xlsx/xls, map columns to `document_types`, preview,
confirm) seeds `crew_documents` without re-keying everything by hand. Column
headers in both source files are consistent enough (Rank/Name/Nationality plus
paired Issue/Expiry columns per cert) to build a single mapping template covering
both.

## 5. Permissions

Gate the whole feature behind a new `crew.documents.view` / `crew.documents.manage`
pair in the existing dynamic RBAC (roles/permissions/role_permissions), the same
way `crew.view`/`crew.manage` gate Crew Profiles today. Sponsor and document
number fields are sensitive enough that `view` vs `manage` should likely mirror
the existing `crew.view_cost` / `crew.view_sensitive` split rather than being
bundled into base `crew.view`.

## 6. Suggested build order

1. `document_types` table + Crew Setup tab to manage it (reuses the existing
   Job Roles/Skills tab pattern almost exactly).
2. `crew_documents` table (including `custom_fields jsonb`) + expiry-status
   helper.
3. Per-crew "Documents & Certifications" section (4b) — smallest surface area,
   proves the data model end-to-end. Custom fields can render read-only here
   first if step 4 (definitions UI) isn't done yet.
4. `document_custom_field_definitions` table + Crew Setup → Custom Fields tab
   (2a) — unlocks org-defined attributes for both 4b and the matrix popover.
5. Matrix/table view (4a) — the part you specifically flagged as the priority
   for updating data, built once the underlying data model is stable.
6. Bulk importer (4c) from the existing spreadsheets, so current data lands in
   one pass rather than being re-typed.
7. Expiry alerting/notifications, once status logic has been validated against
   a real import.
