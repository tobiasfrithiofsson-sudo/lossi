-- Lossi: filer till upplägg och aktiviteter
-- Körs en gång i Supabase → SQL Editor, efter projects.sql. Kan köras om.
--
-- Själva filerna ligger i Supabase Storage (hinken "plan-files", privat).
-- Sökvägen är <uppläggets id>/<slumpat id>.<ändelse>, så att reglerna kan
-- se vilket upplägg en fil hör till. Tabellen plan_files håller ordning på
-- namn, storlek och om filen hör till hela upplägget eller en aktivitet.
--
-- Samma regler som för uppläggen: den som får läsa upplägget får ladda ner
-- filerna; skaparen och medskapare får ladda upp och ta bort.

-- ── Hinken ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plan-files', 'plan-files', false, 26214400, -- 25 MB per fil
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ── Vem får vad med ett upplägg ──
create or replace function public.can_read_plan(pid bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.plans p where p.id = pid and public.is_project_member(p.project_id));
$$;

create or replace function public.can_edit_plan(pid bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_plan_owner(pid) or public.is_plan_editor(pid);
$$;

-- Uppläggets id ur en sökväg som "12/abc-fil.pdf" (null om formen inte stämmer)
create or replace function public.plan_id_from_path(path text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when path ~ '^[0-9]{1,18}/[^/]+$' then split_part(path, '/', 1)::bigint end;
$$;

-- ── Tabellen ──
create table if not exists public.plan_files (
  id          bigint generated always as identity primary key,
  plan_id     bigint not null references public.plans (id) on delete cascade,
  activity_id text, -- null = hela upplägget, annars aktivitetens id (t.ex. "act3")
  name        text not null check (length(name) between 1 and 200),
  size        bigint not null check (size >= 0 and size <= 26214400),
  mime        text not null default '',
  path        text not null unique,
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (public.plan_id_from_path(path) = plan_id)
);

create index if not exists plan_files_plan_id_idx on public.plan_files (plan_id);

alter table public.plan_files enable row level security;

drop policy if exists "Filer: läsa" on public.plan_files;
create policy "Filer: läsa" on public.plan_files
  for select to authenticated
  using (public.can_read_plan(plan_id));

drop policy if exists "Filer: lägga till" on public.plan_files;
create policy "Filer: lägga till" on public.plan_files
  for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and public.can_edit_plan(plan_id));

drop policy if exists "Filer: ta bort" on public.plan_files;
create policy "Filer: ta bort" on public.plan_files
  for delete to authenticated
  using (public.can_edit_plan(plan_id));

revoke all on public.plan_files from anon, authenticated;
grant select, insert, delete on public.plan_files to authenticated;

-- ── Regler för själva filerna ──
drop policy if exists "Lossi-filer: ladda ner" on storage.objects;
create policy "Lossi-filer: ladda ner" on storage.objects
  for select to authenticated
  using (bucket_id = 'plan-files' and public.can_read_plan(public.plan_id_from_path(name)));

drop policy if exists "Lossi-filer: ladda upp" on storage.objects;
create policy "Lossi-filer: ladda upp" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plan-files' and public.can_edit_plan(public.plan_id_from_path(name)));

drop policy if exists "Lossi-filer: ta bort" on storage.objects;
create policy "Lossi-filer: ta bort" on storage.objects
  for delete to authenticated
  using (bucket_id = 'plan-files' and public.can_edit_plan(public.plan_id_from_path(name)));

revoke all on function public.can_read_plan(bigint) from public, anon;
revoke all on function public.can_edit_plan(bigint) from public, anon;
grant execute on function public.can_read_plan(bigint) to authenticated;
grant execute on function public.can_edit_plan(bigint) to authenticated;
grant execute on function public.plan_id_from_path(text) to authenticated;

-- ── Kolla läget: hur mycket utrymme filerna tar ──
-- select count(*) as filer, pg_size_pretty(sum(size)) as totalt from public.plan_files;
