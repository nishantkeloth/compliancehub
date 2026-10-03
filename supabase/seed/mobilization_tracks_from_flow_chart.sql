-- Creates the two mobilization tracks from the UAE ADNOC crew mobilization
-- flow chart: "New Joiner" and "Returning Crew".
--
-- Run once in the Supabase SQL Editor AFTER migration 0040.
-- Safe to run again: a track that already exists by name is left alone.
--
-- Due dates count from each person's planned arrival date (Day 0):
-- negative = days before arrival, positive = days after.
-- Steps with a linked document type are matched by name; if no document
-- type matches, the step is still created without the link (see the
-- NOTICE lines in the output).

do $$
declare
  v_org uuid;
  v_track uuid;
  v_s_train uuid;
  v_s_cert uuid;

  -- document type lookups (null when no name matches)
  d_medical uuid; d_visa uuid; d_tbosiet uuid; d_h2s uuid; d_induction uuid;
  d_cicpa uuid; d_passport uuid; d_food uuid;
begin
  -- The company that owns the ADNOC client; falls back to the only company.
  select org_id into v_org from clients where name ilike '%adnoc%' order by id limit 1;
  if v_org is null then
    select id into v_org from companies order by id limit 1;
  end if;
  if v_org is null then
    raise exception 'Could not find your company. Nothing was created.';
  end if;

  select id into d_medical   from document_types where org_id = v_org and is_active and name ilike '%medical%' order by name limit 1;
  select id into d_visa      from document_types where org_id = v_org and is_active and name ilike '%visa%' order by name limit 1;
  select id into d_tbosiet   from document_types where org_id = v_org and is_active and (name ilike '%bosiet%') order by name limit 1;
  select id into d_h2s       from document_types where org_id = v_org and is_active and name ilike '%h2s%' order by name limit 1;
  select id into d_induction from document_types where org_id = v_org and is_active and name ilike '%induction%' order by name limit 1;
  select id into d_cicpa     from document_types where org_id = v_org and is_active and name ilike '%cicpa%' order by name limit 1;
  select id into d_passport  from document_types where org_id = v_org and is_active and name ilike '%hse passport%' order by name limit 1;
  select id into d_food      from document_types where org_id = v_org and is_active and (name ilike '%food safety%' or name ilike '%highfield%') order by name limit 1;

  raise notice 'Linked document types found: medical=%, visa=%, T-BOSIET=%, H2S=%, induction=%, CICPA=%, HSE passport=%, food safety=%',
    d_medical is not null, d_visa is not null, d_tbosiet is not null, d_h2s is not null,
    d_induction is not null, d_cicpa is not null, d_passport is not null, d_food is not null;

  ------------------------------------------------------------------
  -- Track 1: New Joiner
  ------------------------------------------------------------------
  if exists (select 1 from mobilization_tracks where org_id = v_org and name = 'New Joiner') then
    raise notice 'Track "New Joiner" already exists - left unchanged.';
  else
    insert into mobilization_tracks (org_id, client_id, name, description, sort_order)
    values (v_org, null, 'New Joiner',
            'Crew new to ADNOC: medical and visa before arrival, then training, induction and HSE Passport after landing.', 1)
    returning id into v_track;

    insert into mobilization_checklist_items
      (org_id, track_id, sequence, title, description, is_parallel, due_basis, due_offset_days, linked_document_type_id, visa_types)
    values
      (v_org, v_track, 1, 'Pre-medical screening in home country',
        'Fit-to-work report from the home-country clinic. The visa application starts once this is fit.',
        false, 'planned_arrival_date', -34, d_medical, null),
      (v_org, v_track, 2, 'Mission visa application',
        'PRO / Admin applies for the mission visa once the medical is fit.',
        false, 'planned_arrival_date', -32, d_visa, array['mission']),
      (v_org, v_track, 3, 'Check Emirates ID is valid',
        'Resident visa holders only. Confirm the Emirates ID is current.',
        false, 'planned_arrival_date', -32, null, array['resident']),
      (v_org, v_track, 4, 'Air ticket and travel',
        'Book on visa approval. Arrive Saturday night or Sunday so training can start Monday.',
        false, 'planned_arrival_date', -13, null, null),
      (v_org, v_track, 5, 'Pre-book T-BOSIET and H2S (OPITO)',
        'Book the course as soon as travel is confirmed.',
        false, 'planned_arrival_date', -13, null, null),
      (v_org, v_track, 6, 'CICPA pass application',
        'Apply on Day 1 after arrival.',
        false, 'planned_arrival_date', 1, d_cicpa, null),
      (v_org, v_track, 7, 'T-BOSIET and H2S training (3 days)',
        'OPITO courses. All training and induction must finish within 5 days of arrival.',
        false, 'planned_arrival_date', 1, d_tbosiet, null),
      (v_org, v_track, 8, 'ADNOC Induction',
        'Straight after the training.',
        false, 'planned_arrival_date', 4, d_induction, null),
      (v_org, v_track, 9, 'Collect certificates and original medical',
        'Collect everything needed for the HSE Passport application.',
        false, 'planned_arrival_date', 4, null, null),
      (v_org, v_track, 10, 'ADNOC HSE Passport submitted',
        'Submit on Day 5 or 6. Takes 3 to 7 working days.',
        false, 'planned_arrival_date', 5, d_passport, null),
      (v_org, v_track, 11, 'Highfield L2 Food Safety training (3 days)',
        'Runs in parallel with the steps above.',
        true, 'planned_arrival_date', 2, null, null);

    select id into v_s_train from mobilization_checklist_items
      where track_id = v_track and sequence = 11;

    insert into mobilization_checklist_items
      (org_id, track_id, sequence, title, description, is_parallel, due_basis, due_offset_days, due_relative_item_id, linked_document_type_id)
    values
      (v_org, v_track, 12, 'Receive Highfield Food Safety certificate',
        'About 10 days after the exam.',
        true, 'relative_to_item', 10, v_s_train, d_food);

    insert into mobilization_checklist_items
      (org_id, track_id, sequence, title, description, is_parallel, due_basis, due_offset_days)
    values
      (v_org, v_track, 13, 'Send crew change manifest to client',
        'At least 7 days before the join date. The client confirms in 3 days to a week.',
        false, 'required_onboard_date', -7);

    raise notice 'Created track "New Joiner" with 13 steps.';
  end if;

  ------------------------------------------------------------------
  -- Track 2: Returning Crew
  ------------------------------------------------------------------
  if exists (select 1 from mobilization_tracks where org_id = v_org and name = 'Returning Crew') then
    raise notice 'Track "Returning Crew" already exists - left unchanged.';
  else
    insert into mobilization_tracks (org_id, client_id, name, description, sort_order)
    values (v_org, null, 'Returning Crew',
            'Crew who have worked for ADNOC before: CICPA and a new medical on Day 1, no visa, training or HSE Passport steps.', 2)
    returning id into v_track;

    insert into mobilization_checklist_items
      (org_id, track_id, sequence, title, description, is_parallel, due_basis, due_offset_days, linked_document_type_id)
    values
      (v_org, v_track, 1, 'CICPA pass application',
        'Apply on Day 1 after arrival.',
        false, 'planned_arrival_date', 1, d_cicpa),
      (v_org, v_track, 2, 'New medical at an ADNOC-approved clinic',
        'Done on Day 1 together with the CICPA application.',
        true, 'planned_arrival_date', 1, d_medical),
      (v_org, v_track, 3, 'Send crew change manifest to client',
        'At least 7 days before the join date. The client confirms in 3 days to a week.',
        false, 'required_onboard_date', -7, null);

    raise notice 'Created track "Returning Crew" with 3 steps.';
  end if;
end $$;
