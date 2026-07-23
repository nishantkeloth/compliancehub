# ComplianceHub — Phase 3: Inspection Runner

This bundle adds the real product: starting an inspection, filling
it out, submitting it (which auto-creates corrective actions via
your existing database trigger), and managing those actions.

## Files in this bundle → where they go

```
compliancehub\
├── app\
│   ├── page.tsx                    (REPLACES your current dashboard)
│   ├── start-inspection.tsx        (new)
│   ├── inspections\
│   │   └── [id]\
│   │       ├── page.tsx            (new)
│   │       └── runner.tsx          (new)
│   └── actions\
│       ├── page.tsx                (new)
│       └── action-row.tsx          (new)
└── supabase_patch_owner_name.sql    (run in Supabase, not part of the app)
```

Remember: your project has NO `src` folder (we moved everything to
the root `app\` folder back in Phase 2) — so copy these into
`C:\Users\Nishant\compliancehub\app\`, not into `src\app\`.

## 1. Database patch (1 min)

Open Supabase → SQL Editor → paste `supabase_patch_owner_name.sql`
→ Run. This adds one column so the "Owner" field on corrective
actions actually saves.

## 2. Copy the files (2 min)

From wherever you extracted this bundle:

```powershell
Copy-Item app\page.tsx C:\Users\Nishant\compliancehub\app\page.tsx -Force
Copy-Item app\start-inspection.tsx C:\Users\Nishant\compliancehub\app\ -Force
Copy-Item app\inspections C:\Users\Nishant\compliancehub\app\ -Recurse -Force
Copy-Item app\actions C:\Users\Nishant\compliancehub\app\ -Recurse -Force
```

## 3. Restart clean (1 min)

In your ONE server terminal:

```powershell
Remove-Item .next -Recurse -Force
npm run dev
```

Hard-refresh localhost:3000 (Ctrl+Shift+R).

## 4. Try the whole loop (5 min)

1. On the dashboard, click **Start inspection** next to
   "Monthly HSE Inspection Checklist."
2. Type a site name (e.g. "Camp A") → **Go**. You land on the
   live runner.
3. Mark a few items ✕ (Not Acceptable) and type a finding note
   for each — e.g. "Fire exit blocked by supply boxes."
4. Scroll to the bottom → **Complete inspection**.
5. You land on the read-only summary: score, findings list.
6. Click **View corrective actions →** — the items you marked ✕
   should already be there as open actions (the database trigger
   created them the instant you submitted).
7. Assign an owner name, adjust a due date, click **Close out**
   on one — it should move to the Closed section on refresh.
8. Repeat with **FSMS Audit** from the dashboard — this exercises
   the scored (+/− marks) mode instead of tri-state.

## What "done" looks like

- A submitted inspection shows a score and a findings list.
- Every failed/under-scored item appears automatically under
  `/actions` with no manual step.
- Closing an action moves it to the Closed section and stamps
  the close date.
- The dashboard's "Corrective actions" badge count matches the
  number of open actions.

## Known MVP limitations (by design, for now)

- **Owner is a free-text name**, not a linked user account — good
  enough until you invite real inspectors/managers as logins.
  When you do, we'll switch this to a dropdown of org members.
- **No photo upload yet on failed items** — next natural addition,
  using Supabase Storage.
- **No offline support** — requires being online; PWA/offline
  comes after the web MVP is proven.
- **Sites are created ad hoc** by typing a name when starting an
  inspection — there's no "manage sites" screen yet.

## Troubleshooting

- **Blank page / "Cannot find module"**: the `.next` cache is
  stale again — repeat the Remove-Item + npm run dev from step 3,
  and confirm only ONE `npm run dev` window is running
  (`taskkill /IM node.exe /F` if unsure, then restart).
- **"relation corrective_actions has no column owner_name"**:
  the SQL patch in step 1 wasn't run yet.
- **Findings don't appear under /actions**: check the trigger
  still exists — in Supabase, Database → Functions → look for
  `fn_auto_action`. If missing, re-run the trigger section from
  `supabase_schema.sql` (Phase 1).
- **"no profile yet" reappears for a new signup**: that's the
  `handle_new_user` trigger — confirm it still has the real UUID,
  not the placeholder (see Phase 2 troubleshooting).
