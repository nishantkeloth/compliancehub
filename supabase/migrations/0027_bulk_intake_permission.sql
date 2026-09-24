-- ============================================================
-- ComplianceHub — Bulk Data Migration: admin-only permission
--
-- Nishant asked for the upcoming legacy-data migration tools (crew
-- register import from Excel/CSV, and AI-assisted bulk document-folder
-- intake) to be restricted to company admins only. Following the same
-- convention used everywhere else in the app (no hardcoded role checks
-- in app code or RLS — every gate is a permission key), this adds one
-- new permission and grants it to the company_admin role only, exactly
-- like ai.configure was scoped in 0009_phase9_ai_crew_matrix.sql.
--
-- This migration only adds the permission row + the admin grant. The
-- page it gates (/team/bulk-intake) ships in the same commit; the
-- actual import logic (column mapping, document matching) follows once
-- Nishant provides a sample crew register export and the document
-- folders are in place.
-- ============================================================

begin;

insert into permissions (key, label, description) values
  ('crew.bulk_intake.manage', 'Bulk Data Migration', 'Import the legacy crew register and bulk-upload crew document folders (AI-assisted matching to existing crew members). Admin-only by default.')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key from roles r join permissions p on p.key = 'crew.bulk_intake.manage'
where r.system_key = 'company_admin'
on conflict do nothing;

commit;
