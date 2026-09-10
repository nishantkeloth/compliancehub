# Crew Matrix — Test Scenarios

Covers what's live today: **Crew Setup** (job roles, skills, clients, rotation
templates, offshore sites, manning requirements) and **Crew Profiles** (list,
create, detail/edit, skills, secondary roles, cost, sensitive notes, linked
user account, delete), plus the grouped sidebar nav.

Not covered here (not built yet): document/certificate tracking, assignments,
reliever tracking, the compliance rule engine, Excel import.

## 1. Test users you'll need

Permissions are additive and independent, so set up (or temporarily assign)
users covering these combinations to test gating properly:

| User | crew.view | crew.manage | crew.view_cost | crew.view_sensitive |
|---|---|---|---|---|
| U1 — Company Admin | ✅ | ✅ | ✅ | ✅ |
| U2 — Crew viewer only | ✅ | ❌ | ❌ | ❌ |
| U3 — Crew manager, no cost/medical | ✅ | ✅ | ❌ | ❌ |
| U4 — Cost visibility only | ✅ | ❌ | ✅ | ❌ |
| U5 — No crew access at all | ❌ | ❌ | ❌ | ❌ |

If your role model doesn't let you assign permissions this granularly yet,
at minimum test U1 (full access) and U5 (no access) — those two alone catch
most gating bugs.

## 2. Navigation & access control

| # | Steps | Expected |
|---|---|---|
| N1 | Sign in as U1, look at sidebar | "Crew Matrix" section visible with both "Crew Profiles" and "Crew Setup" |
| N2 | Sign in as U2 | "Crew Matrix" section visible with only "Crew Profiles" (no "Crew Setup") |
| N3 | Sign in as U5 | No "Crew Matrix" section in sidebar at all |
| N4 | As U5, navigate directly to `/crew/profiles` by URL | Redirected to `/` (dashboard), not a 404 or error page |
| N5 | As U2, navigate directly to `/crew/setup` by URL | Should be blocked/redirected — **verify this; if it isn't, that's a gap to fix** (the page currently gates via `crew.manage` server-side, confirm the redirect actually fires) |
| N6 | As U1, click "Crew Profiles" then "Crew Setup" | Correct nav item highlights active in the sidebar for each |

## 3. Crew Setup — Job Roles

| # | Steps | Expected |
|---|---|---|
| J1 | As U1, add a job role "Head Chef" | Appears in list immediately, no page reload needed |
| J2 | Add a second role with the exact same name "Head Chef" | Rejected with a clear error (unique constraint on org+name) — not a silent failure or duplicate row |
| J3 | Add a role, then edit its name | Updates in place |
| J4 | Mark a role inactive | Disappears from "active roles" pickers elsewhere (e.g. Crew Profiles' primary role dropdown, rotation template pickers) but doesn't delete existing crew records referencing it |
| J5 | As U2 (view-only), open Job Roles tab | Can see the list but no add/edit/delete controls render |
| J6 | Attempt to add a role via a raw request as U2 (bypassing UI) if you can test this | Server rejects it — this is the real security boundary, not the hidden button |

## 4. Crew Setup — Skills

| # | Steps | Expected |
|---|---|---|
| S1 | Add a skill "Halal Butchery" | Appears in list |
| S2 | Duplicate skill name in same org | Rejected |
| S3 | Delete a skill that's currently assigned to a crew member (via Crew Profiles' Skills section) | Confirm what actually happens — does it cascade-delete the crew_skills row, or block the delete? Either is defensible, but it should be intentional, not surprising |

## 5. Crew Setup — Clients

| # | Steps | Expected |
|---|---|---|
| C1 | Add a client with name, contract number, start/end dates, billing model | Saves and displays correctly |
| C2 | Add a client with only a name (all optional fields blank) | Saves fine — no required-field errors on the optional columns |
| C3 | Edit an existing client's contract end date | Updates correctly |
| C4 | Mark a client inactive | Removed from "active" pickers (e.g. offshore site's client dropdown) but historical offshore sites still show the client name |

## 6. Crew Setup — Rotation Templates

| # | Steps | Expected |
|---|---|---|
| R1 | Add a "fixed_equal" template, e.g. 28 days on / 28 off | Saves, days_on/days_off populate correctly |
| R2 | Add a "custom" pattern_type template with notes describing the pattern | Saves without requiring days_on/days_off to be numeric if the UI allows blank for custom |
| R3 | Set a rotation template as a crew member's default (via Crew Profile edit), then delete the template | Confirm: does this null out the crew member's default (on delete set null, per the schema), or block deletion? Should match the FK's `on delete set null` — verify the crew profile doesn't break/error afterward |

## 7. Crew Setup — Offshore Sites & Manning Requirements

| # | Steps | Expected |
|---|---|---|
| O1 | Add an offshore site with type "vessel", assign a client and a standard rotation template | Saves, all relations display by name (not raw IDs) |
| O2 | Add a site with no client assigned | Saves fine (client is optional) |
| O3 | Expand a site's manning requirements editor, add "2x Head Chef, 1x Baker" | Requirements save and display against the site |
| O4 | Set a manning requirement for the same job role twice on the same site | Second entry either updates the first (upsert) or is rejected — should not create two conflicting rows for the same site+role |
| O5 | Delete an offshore site that has manning requirements | Manning requirement rows should cascade-delete cleanly (per schema `on delete cascade`) — no orphaned rows, no error |
| O6 | Delete a client referenced by an offshore site | Site's client reference should null out (schema is `on delete set null`), site itself should remain intact |

## 8. Crew Profiles — List, search, filter

| # | Steps | Expected |
|---|---|---|
| P1 | Open `/crew/profiles` with no crew yet | Clean empty state message, no console/server errors |
| P2 | Create several crew members with varying statuses (candidate, active, inactive) | All show in list with correct status badge colors |
| P3 | Search by partial full name | Matches correctly, case-insensitive |
| P4 | Search by partial employee code | Matches correctly |
| P5 | Filter by status "active" | Only active crew shown |
| P6 | Combine search text + status filter | Both apply together (AND, not OR) |
| P7 | Click "Clear" after filtering | Returns to full unfiltered list |
| P8 | As U2 (view-only), open the list | No "Add crew member" button visible |
| P9 | As U1, confirm employee count in list matches Supabase table row count for that org | Sanity check against real data, not just UI |

## 9. Crew Profiles — Create

| # | Steps | Expected |
|---|---|---|
| CP1 | Click "Add crew member", fill only full name, submit | Creates successfully, redirects to the new detail page |
| CP2 | Try to submit with full name blank | Button stays disabled / submission blocked client-side |
| CP3 | Create with an employee code that already exists in the org | Rejected with a clear error, not a silent duplicate |
| CP4 | Create with duplicate employee code across two **different** orgs (if you can test multi-tenant) | Should succeed — uniqueness is per-org, not global |
| CP5 | Create a crew member, immediately check they appear back on `/crew/profiles` | List reflects the new record without manual refresh |

## 10. Crew Profiles — Detail / General edit

| # | Steps | Expected |
|---|---|---|
| D1 | Open a crew profile as U1, edit every general field (identity, personal, role/employment, emergency contact, notes), save | All fields persist correctly after a page refresh |
| D2 | As U2 (view-only), open a crew profile | All fields render as disabled inputs — visible but not editable, no Save button |
| D3 | As U3 (manage, no cost/sensitive), open a crew profile | General section is editable; Cost and Sensitive sections do not render at all (not just hidden — confirm via browser dev tools that the page's initial HTML/props don't contain day_rate/dietary_medical_notes) |
| D4 | Set date of birth, joining date, availability date | Date pickers save and redisplay correctly, no timezone drift (e.g. a date doesn't shift a day on reload) |
| D5 | Leave optional fields blank and save | No forced-required errors on optional columns |

## 11. Crew Profiles — Skills & secondary roles

| # | Steps | Expected |
|---|---|---|
| SK1 | Add a skill to a crew member with years experience and competency grade | Displays correctly in the list |
| SK2 | Add the same skill twice | Second add updates the existing entry (upsert on crew_id+skill_id), doesn't create a duplicate row |
| SK3 | Remove a skill | Disappears immediately |
| SK4 | As U2 (view-only), open a crew profile with skills listed | Skills are visible but no "Add"/"Remove" controls |
| SR1 | Add a secondary/backup role | Displays as a chip/pill |
| SR2 | Add the crew member's own primary role as a secondary role too | Decide/confirm expected behavior — should this be blocked, or is it harmless to allow? Worth a deliberate answer either way |
| SR3 | Remove a secondary role | Disappears immediately |

## 12. Crew Profiles — Cost (permission-gated)

| # | Steps | Expected |
|---|---|---|
| CO1 | As U1 (has view_cost + manage), set day rate and currency | Saves and redisplays |
| CO2 | As U4 (view_cost only, no manage), open the same profile | Cost section **visible** but inputs disabled, no Save button |
| CO3 | As U3 (manage, no view_cost) or U2 (no view_cost at all), open the profile | Cost section does not render at all |
| CO4 | As U3, inspect the page's network response / server payload for the crew profile fetch | `day_rate` and `currency` should be absent from the response entirely, not just unrendered — this is the defense-in-depth check, most important test in this whole suite |
| CO5 | Save an invalid day rate (negative number, non-numeric) | Rejected or coerced sensibly, not silently stored as garbage |

## 13. Crew Profiles — Sensitive / medical notes (permission-gated)

Mirror the Cost tests exactly, substituting `crew.view_sensitive` and
`dietary_medical_notes`:

| # | Steps | Expected |
|---|---|---|
| SE1 | As U1, add dietary/medical notes, save | Persists |
| SE2 | As a "view_sensitive only" user, open profile | Section visible, read-only |
| SE3 | As U2/U3 (no view_sensitive), open profile | Section absent entirely |
| SE4 | As U2/U3, inspect network response for the crew fetch | `dietary_medical_notes` absent from the payload — same defense-in-depth check as cost |

## 14. Crew Profiles — Linked user account

| # | Steps | Expected |
|---|---|---|
| L1 | As U1, link a crew profile to an existing ComplianceHub user (profiles table) | Saves the association |
| L2 | Unlink (select "Not linked") | Clears the association |
| L3 | As U3 (manage but this section is `canManage`-gated, not a separate permission) | Section renders and is usable, since it's gated only on crew.manage |
| L4 | As U2 (no manage) | Section does not render at all |
| L5 | Try linking the same user profile to two different crew members | Confirm expected behavior — the schema has no unique constraint on `linked_profile_id`, so this will currently succeed silently. Decide if that's acceptable or needs a constraint/warning |

## 15. Crew Profiles — Delete

| # | Steps | Expected |
|---|---|---|
| DL1 | As U1, delete a crew member with no skills/roles/documents attached | Removed, redirected to list, no longer appears |
| DL2 | Delete a crew member that has skills and secondary roles attached | Cascades cleanly (crew_skills, crew_secondary_roles are `on delete cascade`) — no orphaned rows, no error |
| DL3 | As U3 (manage, no cost/sensitive visibility) | Can still delete — Danger Zone is gated only on `canManage` |
| DL4 | As U2 (view-only) | No delete button visible; attempting the action directly should also fail server-side |
| DL5 | Cancel the confirm dialog | Nothing is deleted |

## 16. Multi-tenant isolation (org boundary)

If you have access to a second company/org in this environment:

| # | Steps | Expected |
|---|---|---|
| M1 | As a user in Org A, try to open `/crew/profiles/<id>` where `<id>` belongs to Org B (guess or copy a real UUID) | 404, not the other org's data |
| M2 | As a user in Org A, check the Crew Setup job roles/skills/clients/rotation templates/offshore sites lists | Only Org A's records show, never Org B's |
| M3 | Create a job role/skill with the same name in both orgs | Both succeed independently — uniqueness is per-org (`unique(org_id, name)`), confirmed already in section 3/4, worth re-confirming across two real orgs if available |

## 17. Regression checklist (quick pass after any future change)

- [ ] Sidebar sections render correctly for a full-access user and an empty state for a no-access user
- [ ] Crew Setup's 5 tabs (Job Roles, Skills, Clients, Rotation Templates, Offshore Sites) each load and CRUD correctly
- [ ] Manning requirements editor works from within an offshore site row
- [ ] Crew Profiles list search + status filter both work and combine correctly
- [ ] New crew member can be created and immediately edited
- [ ] Cost and Sensitive sections are invisible (not just disabled) to users without the respective permission, confirmed via network payload
- [ ] Skills, secondary roles, linked-user, and delete all respect `crew.manage`
- [ ] No orphaned rows after deleting a job role, skill, client, rotation template, or offshore site that had dependent records
- [ ] `npm run build` passes with no TypeScript errors before every push

---

**Two items flagged above deserve an explicit decision from you rather than
being left as "probably fine":** N5 (does `/crew/setup` actually redirect a
`crew.view`-only user, or just hide the nav link) and CO4/SE4 (confirming
cost/sensitive fields are truly absent from the network payload, not just
hidden in the UI — this is the one that actually matters for a real security
audit). Worth running those two specifically before considering this module
signed off.
