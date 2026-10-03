-- Mobilization: planned arrival date anchor, visa type per person, and
-- per-step on/off + visa filter.
--
-- 1. Each mobilization position gets a visa type (Mission, Resident,
--    Seaman, Visit) and a planned arrival date. Pre-arrival steps count
--    back from the arrival date, arrival-week steps count forward.
-- 2. Checklist template steps get an on/off switch (is_active) and an
--    optional visa filter (visa_types; null = applies to every visa type),
--    so an organization's pathway can have exactly the steps it needs.
-- 3. Both the template and the per-position copy accept a new due basis:
--    'planned_arrival_date'.
--
-- Safe to run more than once.

alter table mobilization_positions
  add column if not exists visa_type text,
  add column if not exists planned_arrival_date date;

alter table mobilization_positions drop constraint if exists mobilization_positions_visa_type_check;
alter table mobilization_positions
  add constraint mobilization_positions_visa_type_check
  check (visa_type is null or visa_type in ('mission', 'resident', 'seaman', 'visit'));

alter table mobilization_checklist_items
  add column if not exists is_active boolean not null default true,
  add column if not exists visa_types text[];

alter table mobilization_checklist_items drop constraint if exists mobilization_checklist_items_visa_types_check;
alter table mobilization_checklist_items
  add constraint mobilization_checklist_items_visa_types_check
  check (visa_types is null or visa_types <@ array['mission', 'resident', 'seaman', 'visit']::text[]);

alter table mobilization_checklist_items drop constraint if exists mobilization_checklist_items_due_basis_check;
alter table mobilization_checklist_items
  add constraint mobilization_checklist_items_due_basis_check
  check (due_basis in ('request_created', 'required_onboard_date', 'planned_arrival_date', 'relative_to_item'));

alter table mobilization_position_checklist_items drop constraint if exists mobilization_position_checklist_items_due_basis_check;
alter table mobilization_position_checklist_items
  add constraint mobilization_position_checklist_items_due_basis_check
  check (due_basis in ('request_created', 'required_onboard_date', 'planned_arrival_date', 'relative_to_item'));
