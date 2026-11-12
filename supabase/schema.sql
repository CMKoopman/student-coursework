-- Studyboard: one shared tracker, restricted to explicitly added members.
-- Run in the SQL Editor of a NEW Supabase project. Safe to rerun; progress is preserved.
begin;

create schema if not exists study_private;
revoke all on schema study_private from public, anon, authenticated;
grant usage on schema study_private to anon, authenticated;

create table if not exists study_private.workspace_access (
  workspace_id text primary key check (workspace_id = 'coursework'),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$')
);
alter table study_private.workspace_access enable row level security;
revoke all on study_private.workspace_access from public, anon, authenticated;
do $policy$
begin
  if not exists (select 1 from pg_policies where schemaname='study_private' and tablename='workspace_access' and policyname='workspace_access_no_client_access') then
    create policy workspace_access_no_client_access on study_private.workspace_access for all to anon, authenticated using (false) with check (false);
  end if;
end;
$policy$;

create or replace function study_private.authorize_access_key(p_access_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_access_key is null or p_access_key !~ '^[A-Za-z0-9_-]{43}$' or not exists (
    select 1 from study_private.workspace_access a
    where a.workspace_id = 'coursework' and a.key_hash = encode(sha256(convert_to(p_access_key,'UTF8')),'hex')
  ) then
    raise exception 'The private workspace link is invalid. Ask your tutor for the current link.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function study_private.authorize_access_key(text) from public, anon, authenticated;

create table if not exists public.study_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists public.study_progress (
  assessment_id text primary key,
  topic_count smallint not null check (topic_count between 1 and 30),
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  mark numeric(5,2) check (mark between 0 and 100),
  due_date date check (due_date between date '1900-01-01' and date '2200-12-31'),
  notes text not null default '' check (char_length(notes) <= 4000),
  topic_checks jsonb not null,
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  check (jsonb_typeof(topic_checks) = 'array' and jsonb_array_length(topic_checks) = topic_count)
);

insert into public.study_progress (assessment_id,topic_count,topic_checks) values
  ('history-mid', 1, '[false]'::jsonb),
  ('history-a7', 2, '[false,false]'::jsonb),
  ('history-a8', 1, '[false]'::jsonb),
  ('history-a9', 1, '[false]'::jsonb),
  ('history-a10', 1, '[false]'::jsonb),
  ('history-exam', 1, '[false]'::jsonb),
  ('maths-mid', 1, '[false]'::jsonb),
  ('maths-a3', 8, '[false,false,false,false,false,false,false,false]'::jsonb),
  ('maths-a4', 7, '[false,false,false,false,false,false,false]'::jsonb),
  ('maths-a5', 1, '[false]'::jsonb),
  ('maths-a6', 1, '[false]'::jsonb),
  ('maths-exam1', 1, '[false]'::jsonb),
  ('maths-exam2', 1, '[false]'::jsonb),
  ('science-mid', 1, '[false]'::jsonb),
  ('science-a4', 5, '[false,false,false,false,false]'::jsonb),
  ('science-a5', 4, '[false,false,false,false]'::jsonb),
  ('science-a6', 4, '[false,false,false,false]'::jsonb),
  ('science-exam1', 1, '[false]'::jsonb),
  ('science-exam2', 1, '[false]'::jsonb),
  ('english-mid', 1, '[false]'::jsonb),
  ('english-a6', 6, '[false,false,false,false,false,false]'::jsonb),
  ('english-a7', 4, '[false,false,false,false]'::jsonb),
  ('english-a8', 3, '[false,false,false]'::jsonb),
  ('english-a9', 2, '[false,false]'::jsonb),
  ('english-exam1', 1, '[false]'::jsonb),
  ('english-exam2', 1, '[false]'::jsonb),
  ('afrikaans-mid', 1, '[false]'::jsonb),
  ('afrikaans-a7', 1, '[false]'::jsonb),
  ('afrikaans-a8', 2, '[false,false]'::jsonb),
  ('afrikaans-a9', 1, '[false]'::jsonb),
  ('afrikaans-a10', 1, '[false]'::jsonb),
  ('afrikaans-exam1', 1, '[false]'::jsonb),
  ('afrikaans-exam2', 1, '[false]'::jsonb)
on conflict (assessment_id) do nothing;

alter table public.study_members enable row level security;
alter table public.study_progress enable row level security;
revoke all on public.study_members from public, anon, authenticated;
revoke all on public.study_progress from public, anon, authenticated;
grant select on public.study_members, public.study_progress to authenticated;

drop policy if exists study_own_membership on public.study_members;
create policy study_own_membership on public.study_members for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists study_member_read on public.study_progress;
create policy study_member_read on public.study_progress for select to authenticated
  using (exists (select 1 from public.study_members m where m.user_id = (select auth.uid())));

create or replace function study_private.validate_study_patch(p_patch jsonb, p_topic_count integer)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Invalid progress data.';
  end if;
  if (p_patch - array['status','mark','due_date','notes','topic_checks']) <> '{}'::jsonb then
    raise exception 'Unknown progress field.';
  end if;
  if p_patch ? 'status' and (jsonb_typeof(p_patch->'status') <> 'string' or p_patch->>'status' not in ('not_started','in_progress','completed')) then
    raise exception 'Invalid assessment status.';
  end if;
  if p_patch ? 'mark' and p_patch->'mark' <> 'null'::jsonb then
    if jsonb_typeof(p_patch->'mark') <> 'number' then raise exception 'Invalid mark.'; end if;
    if (p_patch->>'mark')::numeric not between 0 and 100 then raise exception 'Marks must be between 0 and 100.'; end if;
  end if;
  if p_patch ? 'due_date' and p_patch->'due_date' <> 'null'::jsonb then
    if jsonb_typeof(p_patch->'due_date') <> 'string' or p_patch->>'due_date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid due date.'; end if;
    if (p_patch->>'due_date')::date not between date '1900-01-01' and date '2200-12-31' then raise exception 'Invalid due date.'; end if;
  end if;
  if p_patch ? 'notes' and (jsonb_typeof(p_patch->'notes') <> 'string' or char_length(p_patch->>'notes') > 4000) then
    raise exception 'Notes can contain up to 4,000 characters.';
  end if;
  if p_patch ? 'topic_checks' then
    if jsonb_typeof(p_patch->'topic_checks') <> 'array' then raise exception 'Invalid topic checklist.'; end if;
    if jsonb_array_length(p_patch->'topic_checks') <> p_topic_count then raise exception 'Invalid topic checklist length.'; end if;
    if exists (select 1 from jsonb_array_elements(p_patch->'topic_checks') item where jsonb_typeof(item) <> 'boolean') then
      raise exception 'Topic checklist values must be true or false.';
    end if;
  end if;
end;
$$;
revoke all on function study_private.validate_study_patch(jsonb,integer) from public, anon, authenticated;

-- Only these two functions may write progress. Clients cannot update tables directly.
create or replace function study_private.save_study_progress(p_assessment_id text, p_expected_version integer, p_patch jsonb, p_access_key text default null)
returns setof public.study_progress language plpgsql security definer set search_path = '' as $$
declare
  v_topic_count integer;
  v_count integer;
begin
  if p_access_key is not null then
    perform study_private.authorize_access_key(p_access_key);
  else
  if auth.uid() is null or not exists (select 1 from public.study_members m where m.user_id = auth.uid()) then
    raise exception 'Tracker access is restricted to its members.' using errcode = '42501';
  end if;
  end if;
  select p.topic_count into v_topic_count from public.study_progress p where p.assessment_id = p_assessment_id;
  if not found then raise exception 'Unknown assessment.'; end if;
  perform study_private.validate_study_patch(p_patch,v_topic_count);
  return query update public.study_progress as target set
    status = case when p_patch ? 'status' then p_patch->>'status' else target.status end,
    mark = case when p_patch ? 'mark' then (p_patch->>'mark')::numeric else target.mark end,
    due_date = case when p_patch ? 'due_date' then (p_patch->>'due_date')::date else target.due_date end,
    notes = case when p_patch ? 'notes' then p_patch->>'notes' else target.notes end,
    topic_checks = case when p_patch ? 'topic_checks' then p_patch->'topic_checks' else target.topic_checks end,
    version = target.version + 1, updated_at = clock_timestamp(), updated_by = auth.uid()
  where target.assessment_id = p_assessment_id and target.version = p_expected_version
  returning target.*;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'STUDY_CONFLICT: progress changed elsewhere.' using errcode = '40001'; end if;
end;
$$;
revoke all on function study_private.save_study_progress(text,integer,jsonb,text) from public, anon, authenticated;
grant execute on function study_private.save_study_progress(text,integer,jsonb,text) to anon, authenticated;

-- A restore is one transaction: all assessments change, or none do.
create or replace function study_private.restore_study_backup(p_rows jsonb, p_access_key text default null)
returns setof public.study_progress language plpgsql security definer set search_path = '' as $$
declare
  v_entry jsonb;
  v_row public.study_progress%rowtype;
  v_patch jsonb;
  v_total integer;
begin
  if p_access_key is not null then
    perform study_private.authorize_access_key(p_access_key);
  else
  if auth.uid() is null or not exists (select 1 from public.study_members m where m.user_id = auth.uid()) then
    raise exception 'Tracker access is restricted to its members.' using errcode = '42501';
  end if;
  end if;
  select count(*) into v_total from public.study_progress;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Invalid backup.'; end if;
  if jsonb_array_length(p_rows) <> v_total or
    (select count(distinct item->>'assessment_id') from jsonb_array_elements(p_rows) item) <> v_total then
    raise exception 'A backup must contain every assessment exactly once.';
  end if;
  perform p.assessment_id from public.study_progress p order by p.assessment_id for update;
  for v_entry in select item from jsonb_array_elements(p_rows) item loop
    select p.* into v_row from public.study_progress p where p.assessment_id = v_entry->>'assessment_id';
    if not found then raise exception 'Unknown assessment in backup.'; end if;
    if jsonb_typeof(v_entry->'version') is distinct from 'number' or (v_entry->>'version')::integer is distinct from v_row.version then
      raise exception 'STUDY_CONFLICT: progress changed elsewhere.' using errcode = '40001';
    end if;
    v_patch = jsonb_build_object('status',v_entry->'status','mark',v_entry->'mark','due_date',v_entry->'due_date','notes',v_entry->'notes','topic_checks',v_entry->'topic_checks');
    perform study_private.validate_study_patch(v_patch,v_row.topic_count);
    update public.study_progress p set
      status = v_entry->>'status', mark = (v_entry->>'mark')::numeric,
      due_date = (v_entry->>'due_date')::date, notes = v_entry->>'notes',
      topic_checks = v_entry->'topic_checks', version = p.version + 1,
      updated_at = clock_timestamp(), updated_by = auth.uid()
    where p.assessment_id = v_row.assessment_id;
  end loop;
  return query select p.* from public.study_progress p order by p.assessment_id;
end;
$$;
revoke all on function study_private.restore_study_backup(jsonb,text) from public, anon, authenticated;
grant execute on function study_private.restore_study_backup(jsonb,text) to anon, authenticated;

-- Public API wrappers run as the caller; privileged implementations stay outside exposed schemas.
create or replace function public.save_study_progress(p_assessment_id text, p_expected_version integer, p_patch jsonb)
returns setof public.study_progress language sql security invoker set search_path = '' as $$
  select * from study_private.save_study_progress(p_assessment_id,p_expected_version,p_patch);
$$;
revoke all on function public.save_study_progress(text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.save_study_progress(text,integer,jsonb) to authenticated;

create or replace function public.restore_study_backup(p_rows jsonb)
returns setof public.study_progress language sql security invoker set search_path = '' as $$
  select * from study_private.restore_study_backup(p_rows);
$$;
revoke all on function public.restore_study_backup(jsonb) from public, anon, authenticated;
grant execute on function public.restore_study_backup(jsonb) to authenticated;

-- Private-link access is checked inside every operation; no table is public.
create or replace function study_private.load_shared_study_progress(p_access_key text)
returns setof public.study_progress language plpgsql security definer set search_path = '' as $$
begin
  perform study_private.authorize_access_key(p_access_key);
  return query select p.* from public.study_progress p order by p.assessment_id;
end;
$$;
revoke all on function study_private.load_shared_study_progress(text) from public, anon, authenticated;
grant execute on function study_private.load_shared_study_progress(text) to anon, authenticated;

create or replace function public.load_shared_study_progress(p_access_key text)
returns setof public.study_progress language sql security invoker set search_path = '' as $$
  select * from study_private.load_shared_study_progress(p_access_key);
$$;
revoke all on function public.load_shared_study_progress(text) from public, anon, authenticated;
grant execute on function public.load_shared_study_progress(text) to anon, authenticated;

create or replace function public.save_shared_study_progress(p_access_key text, p_assessment_id text, p_expected_version integer, p_patch jsonb)
returns setof public.study_progress language sql security invoker set search_path = '' as $$
  select * from study_private.save_study_progress(p_assessment_id,p_expected_version,p_patch,p_access_key);
$$;
revoke all on function public.save_shared_study_progress(text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.save_shared_study_progress(text,text,integer,jsonb) to anon, authenticated;

create or replace function public.restore_shared_study_backup(p_access_key text, p_rows jsonb)
returns setof public.study_progress language sql security invoker set search_path = '' as $$
  select * from study_private.restore_study_backup(p_rows,p_access_key);
$$;
revoke all on function public.restore_shared_study_backup(text,jsonb) from public, anon, authenticated;
grant execute on function public.restore_shared_study_backup(text,jsonb) to anon, authenticated;

commit;
