# Crew Matrix — automated test scripts

Playwright tests covering the functional scenarios from the test-scenarios
doc: Crew Setup (job roles, skills, clients, rotation templates, offshore
sites + manning requirements) and Crew Profiles (create, edit, skills,
secondary roles, cost/sensitive sections, search/filter, delete).

Your login never leaves your machine — you put it in a local `.env` file
that's gitignored, and Claude never sees it.

## Setup

1. Copy this folder anywhere on your machine (e.g. next to your
   `Compliancehub` repo, doesn't need to be inside it).
2. Install dependencies:

   ```
   npm install
   npx playwright install chromium
   ```

3. Create your `.env` file:

   ```
   cp .env.example .env
   ```

   Then open `.env` and fill in `CH_EMAIL` / `CH_PASSWORD` with a real
   ComplianceHub login. Use an account with `crew.manage` (Company Admin
   covers it) to get full coverage — without it, the create/edit/delete
   tests will fail with permission errors instead of running.

## Running

```
npm test
```

Runs headless by default. To watch it click through the app:

```
npm run test:headed
```

Or use Playwright's interactive UI mode (best for debugging a failure):

```
npm run test:ui
```

After a run, view the HTML report (screenshots + traces for any failures):

```
npm run report
```

## What's covered vs. not

Covered here: CRUD and validation for every Crew Setup entity, manning
requirement cascade-delete, crew profile create/edit/skills/secondary
roles/delete, search and status filtering, and — when the signed-in
account has the permission — the cost and sensitive-notes sections.

Not automated (needs multiple accounts, see the full test-scenarios doc
for the manual steps):
- Confirming cost/sensitive fields are truly absent from the network
  payload for a lower-permission user (open browser dev tools → Network
  tab while signed in as that user, inspect the `crew_profiles` fetch).
- The `/crew/setup` redirect for a `crew.view`-only user.
- Multi-tenant isolation between two different orgs.

## Data safety

Every test uses a name prefixed with `Test ` and a timestamp, and deletes
what it created at the end of the test. If a test fails partway through
(the report will show which), check `/crew/setup` and `/crew/profiles`
for a leftover `Test ...` record and remove it by hand — nothing here
touches your real crew, client, or site records.

## If a selector breaks

These tests were written by reading the app's source directly, but
weren't run against the live site before being handed to you (no browser
access from that side). If a test fails on a selector (e.g. "element not
found") rather than a real assertion, the UI text/placeholder probably
just needs a small update in the matching `.spec.ts` file — the failure
message and the HTML report's screenshot will show exactly which step
didn't find what it expected.
