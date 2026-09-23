begin;

-- The "invites" table predates this project's tracked-migration
-- discipline and was created directly in the Supabase dashboard, so its
-- true shape has drifted from what's in this migrations folder (the same
-- gap that produced the untracked "View audit log" permission found
-- earlier). It carries a legacy `role` text column (NOT NULL, no
-- default) left over from before the RBAC `roles` table existed. The app
-- has invited team members by `role_id` for a long time now and never
-- writes to `role`, so every invite insert has been failing with:
--   null value in column "role" of relation "invites" violates not-null constraint
--
-- Fix: the legacy column is no longer part of how invites work, so make
-- it optional instead of trying to keep it populated.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invites' and column_name = 'role'
  ) then
    execute 'alter table invites alter column role drop not null';
  end if;
end $$;

commit;
