-- Phase 1 originally required every Project to have an EPC Contractor
-- (contractor_id uuid not null references contractors(id)). In practice a
-- project can exist before a contractor is appointed (or never need one),
-- so this drops the NOT NULL constraint. The foreign key itself stays —
-- a contractor_id that IS set must still point at a real contractor row.
--
-- Safe to re-run.

alter table projects alter column contractor_id drop not null;
