-- ============================================================
-- ComplianceHub — shared crew matrices go stale when a newer version
-- goes live.
--
-- Run this whole file once, top to bottom, in the Supabase SQL Editor.
-- Safe to re-run.
--
-- A "Send Matrix to Client" link serves a frozen snapshot of the crew and
-- their document status as of the moment it was sent, valid for 30 days.
-- Nothing told the client when that snapshot stopped being current: the
-- 'superseded' value existed on crew_matrix_share_packages.status but
-- nothing ever set it, and the public page had no way to say "a newer
-- version exists". A client could keep acting on last month's crew list
-- believing it was current.
--
-- This does three things:
--   1. A trigger flips a matrix's still-open share packages to
--      'superseded' the moment that matrix itself becomes 'superseded'
--      (the existing supersede_previous_active_matrix trigger does that to
--      the old version when a new one is activated), so the internal
--      Sharing History shows it.
--   2. Backfills the same for matrices that were already superseded.
--   3. get_crew_matrix_share_preview now also reports when the package was
--      sent and whether a newer version of the matrix is active, so the
--      public page can show a "newer version available" notice. This is
--      worked out live from crew_matrices rather than from the package
--      status, so it is right even for a package sent from an approved
--      (never-active) version. The link itself keeps working — the client
--      can still see what they were sent — it is just clearly marked as
--      out of date. Revoking is still a deliberate manual action.
-- ============================================================

begin;

create or replace function mark_share_packages_superseded()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'superseded' and old.status is distinct from 'superseded' then
    update crew_matrix_share_packages
    set status = 'superseded'
    where crew_matrix_id = new.id
      and status in ('sent', 'partially_sent');
  end if;
  return new;
end;
$$;

drop trigger if exists crew_matrices_share_superseded_trg on crew_matrices;
create trigger crew_matrices_share_superseded_trg
  after update of status on crew_matrices
  for each row execute function mark_share_packages_superseded();

update crew_matrix_share_packages p
set status = 'superseded'
from crew_matrices m
where p.crew_matrix_id = m.id
  and m.status = 'superseded'
  and p.status in ('sent', 'partially_sent');

create or replace function get_crew_matrix_share_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient crew_matrix_share_recipients%rowtype;
  v_package crew_matrix_share_packages%rowtype;
  v_staff jsonb;
  v_newer_version integer;
begin
  select * into v_recipient from crew_matrix_share_recipients where token = p_token;

  if v_recipient.id is null or v_recipient.revoked_at is not null or v_recipient.token_expires_at < now() then
    return jsonb_build_object('valid', false);
  end if;

  select * into v_package from crew_matrix_share_packages where id = v_recipient.share_package_id;

  if v_package.id is null or v_package.revoked_at is not null then
    return jsonb_build_object('valid', false);
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'share_staff_id', s.id,
      'staff', s.staff_snapshot_json,
      'documents', (
        select coalesce(jsonb_agg(d.document_snapshot_json order by d.display_order, d.id), '[]'::jsonb)
        from crew_matrix_share_documents d
        where d.share_staff_id = s.id
      )
    )
    order by s.display_order, s.id
  )
  into v_staff
  from crew_matrix_share_staff s
  where s.share_package_id = v_package.id;

  -- Highest version of this same matrix that is live now and newer than
  -- what was sent. Only the version number leaves the database.
  select max(m.version_number) into v_newer_version
  from crew_matrices m
  where m.org_id = v_package.org_id
    and m.matrix_number is not null
    and m.matrix_number = v_package.matrix_number_snapshot
    and m.status = 'active'
    and m.version_number > v_package.matrix_version_snapshot;

  update crew_matrix_share_recipients
  set first_opened_at = coalesce(first_opened_at, now()),
      last_opened_at = now(),
      view_count = view_count + 1
  where id = v_recipient.id;

  insert into crew_matrix_share_events (org_id, share_package_id, recipient_id, event_type, outcome)
  values (v_package.org_id, v_package.id, v_recipient.id, 'viewed', 'success');

  return jsonb_build_object(
    'valid', true,
    'share_reference', v_package.share_reference,
    'matrix_title', v_package.matrix_title_snapshot,
    'matrix_number', v_package.matrix_number_snapshot,
    'matrix_version', v_package.matrix_version_snapshot,
    'matrix_status_at_share', v_package.matrix_status_at_share,
    'client_name', v_package.client_name_snapshot,
    'project_name', v_package.project_name_snapshot,
    'site_name', v_package.site_name_snapshot,
    'company_name', v_package.company_name_snapshot,
    'recipient_name', v_recipient.recipient_name,
    'expires_at', v_recipient.token_expires_at,
    'shared_at', v_package.created_at,
    'newer_version', v_newer_version,
    'staff', coalesce(v_staff, '[]'::jsonb)
  );
end;
$$;

grant execute on function get_crew_matrix_share_preview(text) to anon, authenticated;

commit;
