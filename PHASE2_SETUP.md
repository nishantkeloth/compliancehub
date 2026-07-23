# ComplianceHub — Phase 2 Setup (Auth + Seed)

Extract this bundle into your project so the folders merge:

```
C:\Users\Nishant\compliancehub\
├── src\lib\supabase\client.ts        (new)
├── src\lib\supabase\server.ts        (new)
├── src\app\login\page.tsx            (new)
├── src\app\page.tsx                  (REPLACES the default home page)
├── src\app\signout-button.tsx        (new)
├── scripts\seed-templates.mjs        (new)
└── supabase\auth_setup.sql           (run in Supabase, not part of the app)
```

## 1. Supabase dashboard (5 min)

a. **Authentication → Sign In / Providers → Email**: turn OFF
   "Confirm email" for now (development convenience — turn it back
   on before real users).

b. **SQL Editor**: open `supabase\auth_setup.sql`, replace
   `PASTE-YOUR-ORG-UUID-HERE` with your AHM Marine org UUID,
   run the whole file.

## 2. .env.local (2 min)

Add a third line with your service_role key
(Settings → API → service_role — keep it secret):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 3. Seed the templates (1 min)

From the project root:

```
node --env-file=.env.local scripts/seed-templates.mjs
```

Expected output:

```
Using organization AHM Marine: <uuid>
Seeded AHM MS 90: 14 sections, 94 items
Seeded AHM MS 33: 13 sections, 174 items, 390 total marks
Seed complete.
```

Safe to re-run — it skips templates that already exist.

## 4. Try it (2 min)

```
npm run dev
```

- Visit http://localhost:3000 → you are redirected to /login
- Create an account (your real email + a password)
- You land on the home page: signed in as you, role `admin`,
  and both AHM templates listed from the live database.

## Troubleshooting

- **"relation profiles does not exist"** → the base schema didn't
  run; re-run supabase_schema.sql.
- **Login works but role shows "no profile yet"** → the auth
  trigger wasn't installed or the UUID placeholder wasn't
  replaced; fix auth_setup.sql, delete the user in
  Authentication → Users, sign up again.
- **Seed script: "Invalid API key"** → the service_role key is
  wrong or has extra spaces in .env.local.
- **Env changes not picked up** → restart `npm run dev` after
  editing .env.local.
