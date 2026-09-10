# Crew Matrix — Test Cases (Round 2)

Realistic offshore catering data throughout — same company context as your
actual crew/visa trackers. Work through these in order; later cases build
on data created in earlier ones. Cleanup steps are called out at the end
rather than after each case, so you're not deleting and recreating things
mid-run.

| # | Area | Steps | Expected result |
|---|------|-------|------------------|
| 1 | Job Roles | Crew Setup → Job Roles → add **"Camp Boss"** | Appears in the list immediately |
| 2 | Job Roles | Add **"Camp Boss"** again, exact same name | Rejected with an error — not a second row |
| 3 | Job Roles | Add **"Steward"**, **"Cook"**, **"Baker"** | All three appear |
| 4 | Job Roles | Edit "Baker" → rename to **"Ship's Baker"**, uncheck "Active", save | Row updates, shows "Inactive" tag |
| 5 | Skills | Skills tab → add **"HACCP Certified"** | Appears as a chip |
| 6 | Skills | Add **"HACCP Certified"** again | Rejected — no duplicate chip |
| 7 | Skills | Add **"Halal Butchery"** | Appears alongside the first skill |
| 8 | Clients | Clients tab → add **"Stanford Marine"** with contract number **SM-2026-014**, leave dates/billing blank | Saves with no error on the blank optional fields |
| 9 | Clients | Add **"Mubarak Marine"**, no contract number at all | Saves fine |
| 10 | Rotation Templates | Add **"28/28"**, pattern type "Fixed equal", days on 28 / days off 28 | Row shows "28/28" |
| 11 | Rotation Templates | Add **"Contract Pattern"**, pattern type "Custom", notes "Per client contract terms" | Saves without requiring days on/off |
| 12 | Offshore Sites | Add **"Nautica 1"**, type "Vessel", client "Stanford Marine", standard rotation "28/28" | Row shows vessel type and client name |
| 13 | Offshore Sites | Expand "Nautica 1" → Manning requirements → set **2x Steward** | Requirement appears under the site |
| 14 | Offshore Sites | Set the same site + "Steward" requirement again with headcount 3 | Updates the existing requirement to 3, doesn't create a second row |
| 15 | Offshore Sites | Delete "Nautica 1" entirely | Site disappears; re-expanding is no longer possible (requirement was tied to it) |
| 16 | Crew Profiles | Crew Profiles → "+ Add crew member": **Arjun Nair**, nationality **Indian**, primary role **Steward**, status Active | Redirects to his detail page |
| 17 | Crew Profiles | On Arjun's page: add skill "HACCP Certified" with 4 years experience; add "Camp Boss" as a secondary role | Both appear in their sections |
| 18 | Crew Profiles | Edit Arjun's phone, email, home country, joining date, save | All fields persist after a refresh |
| 19 | Crew Profiles | Add a second crew member: **Meera Pillai**, nationality **Indian**, primary role **Cook**, status Candidate | Appears in the list with a "Candidate" badge |
| 20 | Crew Profiles | Search **"Arjun"** in the list | Only Arjun shows |
| 21 | Crew Profiles | Clear search, filter by status **"Active"** | Shows Arjun, not Meera (she's Candidate) |
| 22 | Crew Profiles | Search **"Suresh"** (nobody by that name) | Empty-state message, not an error |
| 23 | Permissions | If you have a second, lower-permission account: sign in as them and open Arjun's profile | Cost and dietary/medical sections should not appear at all |
| 24 | Cost/Sensitive | On Arjun's page as your admin account, set day rate **250 USD** and a dietary note, save | Both persist; re-open the page to confirm |

## Cleanup (once you're satisfied)

- Delete crew members: Arjun Nair, Meera Pillai
- Delete job roles: Camp Boss, Steward, Cook, Ship's Baker
- Delete skills: HACCP Certified, Halal Butchery
- Delete clients: Stanford Marine, Mubarak Marine
- Delete rotation templates: 28/28, Contract Pattern
- Confirm offshore site "Nautica 1" is already gone (case 15)

Report back whatever you find — a straight "all good" is a fine outcome
too, this doesn't need to turn up a bug to be worth doing.
