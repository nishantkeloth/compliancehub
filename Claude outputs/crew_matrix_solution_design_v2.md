# Crew Matrix & Offshore Deployment — Solution Design Update

**Based on:** the original requirement doc, plus two real working spreadsheets you shared — `TEAM DORA CREW MATRIX` and `SHIPWORKZ KSA VISA TRACKER` (5 vessels: MAG CLIO, MAG ARISTON, NAUTICA 1, NAUTICA 2, GMS AURA — 61 crew-visa records total).

## 1. What the real data actually shows

This is the important finding, and it changes how I'd sequence the build: **neither spreadsheet is a deployment/assignment matrix in the sense of section 5 of the original spec** (mobilization date, sign-off date, days onboard). Both are **document/certificate expiry trackers**. That tells me the daily pain today isn't "who's on which vessel" — it's "whose visa/certificate is about to lapse, across five vessels, tracked by hand in five tabs." That's the workflow to prioritize.

**TEAM DORA CREW MATRIX** — one row per crew member, with a wide block of ISSUE/EXPIRY column pairs per document type:

| Document | Validity pattern observed |
|---|---|
| KSA Visa | Number, Issue, Expiry, KSA Entry Date, Renewal |
| Passport | Number, Issue, Expiry (10-year validity) |
| Seaman's Book | Number, Issue, Expiry (10-year validity) |
| COC (Certificate of Competency) | Issue, Expiry — 5 years |
| STCW | Issue, Expiry — 5 years |
| STSDSD Course | Issue, Expiry — 5 years |
| H2S | Issue, Expiry — 2 years |
| Medical | Issue, Expiry — 1 year |
| IK Medical (separate scheme) | Issue, Expiry — 1 year |
| Food Safety Cert (HACCP) | Issue, Expiry — 5 years |
| Vaccination (Hep A, Hep B, Typhoid, Chickenpox) | single date, non-expiring |
| Covid Vaccination | 1st dose, 2nd dose, booster — single dates |

**SHIPWORKZ KSA VISA TRACKER** — one tab per vessel, one row per crew member's visa:

- Rank, Name, Nationality, Vessel
- KSA Visa Number, Issue Date, Expiry Date, Entry Date
- **"75 days" and "90 days"** — calculated reminder checkpoints off the visa dates (this maps directly to the spec's "reminder intervals" concept in the compliance rule engine, but with real numbers: 75 and 90, not the generic 90/60/30/14/7 the original doc suggested)
- Extension / renewal date
- **Visa Sponsor** — varies per person (Allianz Marine Service, Stanford Marine, Mubarak Marine, L&T, International Arabian Marine Service) — this is a property of the *document*, not a fixed company-wide value
- Visa Type — Single Entry / Multiple Entry
- **Reliever** — a named person, tracked inline against each crew member. This is the real-world version of the spec's "relief planning" (section 6.3), confirming it's used in practice, not theoretical
- A manual **"SIGNOFF" / "SIGNED OFF"** row acts as a visual divider — crew who've left a vessel stay listed below it rather than being deleted, for history

Ranks observed: Steward, Cook, Asst Cook, Camp Boss (also written "CBOSS"/"Camp Boss"), Baker. Nationalities: Indian, Sri Lankan, Nepali. All of this lines up with the Job Roles you can already create in Crew Setup — no changes needed there.

## 2. Schema implications — what changes from Phase 1a

What I already built (`job_roles`, `skills`, `clients`, `rotation_templates`, `offshore_sites`, `crew_profiles`) still holds. Nothing in these spreadsheets contradicts it. What's missing is the compliance-document layer, which I'd deliberately deferred — it's now clearly the priority. Three new pieces, pulled forward:

**`compliance_requirement_rules`** — the configurable rule catalog from spec section 7, seeded with the *real* catalog above instead of generic placeholders: KSA Visa, Passport, Seaman's Book, COC, STCW, STSDSD, H2S, Medical, IK Medical, Food Safety Cert, and the vaccination set — each with its real validity period (5yr/2yr/1yr/non-expiring) and, for KSA Visa specifically, the 75/90-day reminder checkpoints rather than the generic intervals.

**`crew_documents`** — one row per crew member per document instance: document number, issue date, expiry date, status (Missing/Uploaded/Verified/Expiring/Expired/Waived per spec), and — specifically for visa-type documents — sponsor, visa type, and entry date as extra fields, since those don't apply to a passport or a vaccination record. I'd model this as a few visa-specific nullable columns on the same table rather than a separate table, to keep readiness calculation (spec section 7) working off one place.

**`assignment_reliefs`** — pulled forward from Phase 2 in my original sequencing. Given "Reliever" is a real, actively-used field in your live tracker, it belongs alongside document tracking rather than waiting for the full assignment workflow. This does depend on `crew_assignments` existing in some minimal form first (even just "who's currently on which vessel"), which isn't built yet.

## 3. Revised sequencing recommendation

My original plan was: Crew Profiles → Crew Matrix screen → Assignments → Compliance engine (later). Based on what you actually use day to day, I'd flip that:

1. **Crew Profiles** (as already planned — needed as the anchor for everything else)
2. **Document & Compliance Tracking** — the compliance rule catalog + a document tracker screen per crew member, seeded with your real document types and validity periods. This is the direct digital replacement for both spreadsheets you just shared, and the thing that would save you the most time immediately.
3. **Minimal assignment tracking** (crew → vessel, with a reliever field) — just enough to know who's currently where and who covers them, without the full mobilization workflow yet.
4. The fuller Crew Matrix screen, gap analysis, and workflow statuses from the original spec, once 1–3 are proven.

## 4. Import path is now urgent, not a Phase 2 nice-to-have

61 crew-visa records across 5 vessels in one file, plus whatever the full roster looks like beyond what's in Team Dora — you will not want to retype this by hand. The original spec's "Excel import template with preview, validation, row-level errors" (section 15) should move up alongside step 2 above, built specifically against the two column layouts you've shown me, so your existing spreadsheets become the seed data rather than a parallel system you keep maintaining.

## 5. Before I build anything further

A few things worth confirming rather than me assuming:

- Is "IK Medical" a specific insurance/medical scheme name I should keep as-is, or a label I'm misreading?
- Should Crew Profiles absorb the vessel sheets' structure directly (one crew record with a "current vessel" field, documents underneath), or do you want the vessel tabs preserved as a filter/grouping in the UI even though the underlying data is per-crew-member?
- Do you want historical/signed-off crew kept as inactive records (matching your manual "SIGNED OFF" divider), or archived out of the main view entirely?

I'd suggest we lock in Crew Profiles next (item 1 above) — it's unchanged by this new information — and I'll fold the document/visa model above into the migration once you confirm the three questions above.
