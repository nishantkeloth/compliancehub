-- ============================================================
-- ComplianceHub — link a site's manning requirement to a named
-- document requirement template.
--
-- Run this whole file once, top to bottom, in the Supabase SQL
-- Editor. Safe to re-run.
--
-- Context: 0029_document_requirement_templates.sql added named,
-- reusable document checklists per role. This lets a site's standing
-- manning requirement (Crew Matrix → Site tab, or Offshore Sites)
-- point at one of them, so "Generate from manning requirements"
-- (app/crew/matrices/actions.ts's generateDraftFromManning) can apply
-- that role's chosen template to the new line's documents
-- automatically, on top of the org-wide/per-client default it already
-- seeds. Nullable — a requirement with no template picked behaves
-- exactly as before.
-- ============================================================

begin;

alter table site_manning_requirements
  add column if not exists preferred_document_template_id uuid references document_requirement_templates(id) on delete set null;

commit;
