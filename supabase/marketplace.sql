-- ── Marknadsplatsen (2026-10-27) ──
-- Lärare publicerar upplägg som alla med konto i Lossi kan se, förhandsvisa
-- och använda (kopiera till sin egen yta). Det publicerade är en ögonblicksbild:
-- upplägget (state) och kopior av dess filer, så att det inte ändras när
-- författaren fortsätter arbeta. "Publicera igen" ersätter ögonblicksbilden.
--
-- Filerna ligger i samma hink som uppläggens (plan-files), under
-- market/<publicerat id>/<slumpat id>.<ändelse>. Den som använder ett upplägg
-- får kopior av filerna i sitt nya upplägg (vanliga plan_files).
--
-- Kör efter projects.sql, files.sql och feedback-admin.sql (is_lossi_admin).
-- Går att köra om.

-- ── Tabellerna ──
create table if not exists public.market_plans (
  id             bigint generated always as identity primary key,
  source_plan_id bigint unique references public.plans (id) on delete set null,
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name    text not null default '' check (length(author_name) <= 120),
  title          text not null default '' check (length(title) <= 300),
  subject        text not null default '' check (length(subject) <= 120),
  grade          text not null default '' check (length(grade) <= 60),
  avatar         text,
  state          jsonb not null default '{}'::jsonb,
  uses           integer not null default 0,
  published_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists market_plans_published_idx on public.market_plans (published_at desc);

create table if not exists public.market_files (
  id          bigint generated always as identity primary key,
  market_id   bigint not null references public.market_plans (id) on delete cascade,
  activity_id text,
  name        text not null check (length(name) between 1 and 200),
  size        bigint not null check (size >= 0 and size <= 26214400),
  mime        text not null default '',
  path        text not null unique,
  created_at  timestamptz not null default now()
);

create index if not exists market_files_market_idx on public.market_files (market_id);

-- Det publicerade id:t ur en sökväg som "market/12/abc.pdf" (null om formen inte stämmer)
create or replace function public.market_id_from_path(path text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when path ~ '^market/[0-9]{1,18}/[^/]+$' then split_part(path, '/', 2)::bigint end;
$$;

-- Författaren (eller en administratör) får ändra och ta bort
create or replace function public.can_manage_market(mid bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.market_plans m where m.id = mid and m.owner_id = (select auth.uid()))
    or coalesce(public.is_lossi_admin(), false);
$$;

alter table public.market_files drop constraint if exists market_files_path_market;
alter table public.market_files add constraint market_files_path_market check (public.market_id_from_path(path) = market_id);

-- ── Regler: tabellerna ──
alter table public.market_plans enable row level security;
alter table public.market_files enable row level security;

drop policy if exists "Marknadsplats: läsa" on public.market_plans;
create policy "Marknadsplats: läsa" on public.market_plans
  for select to authenticated using (true);

-- Bara egna upplägg kan publiceras
drop policy if exists "Marknadsplats: publicera" on public.market_plans;
create policy "Marknadsplats: publicera" on public.market_plans
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_plan_owner(source_plan_id));

drop policy if exists "Marknadsplats: publicera igen" on public.market_plans;
create policy "Marknadsplats: publicera igen" on public.market_plans
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Marknadsplats: ta bort" on public.market_plans;
create policy "Marknadsplats: ta bort" on public.market_plans
  for delete to authenticated
  using (public.can_manage_market(id));

drop policy if exists "Marknadsplatsens filer: läsa" on public.market_files;
create policy "Marknadsplatsens filer: läsa" on public.market_files
  for select to authenticated using (true);

drop policy if exists "Marknadsplatsens filer: lägga till" on public.market_files;
create policy "Marknadsplatsens filer: lägga till" on public.market_files
  for insert to authenticated
  with check (exists (select 1 from public.market_plans m where m.id = market_id and m.owner_id = (select auth.uid())));

drop policy if exists "Marknadsplatsens filer: ta bort" on public.market_files;
create policy "Marknadsplatsens filer: ta bort" on public.market_files
  for delete to authenticated
  using (public.can_manage_market(market_id));

revoke all on public.market_plans from anon, authenticated;
revoke all on public.market_files from anon, authenticated;
grant select, insert, delete on public.market_plans to authenticated;
grant update (author_name, title, subject, grade, avatar, state, updated_at) on public.market_plans to authenticated;
grant select, insert, delete on public.market_files to authenticated;

-- ── Regler: själva filerna (hinken plan-files) ──
drop policy if exists "Marknadsplatsens filer: ladda ner" on storage.objects;
create policy "Marknadsplatsens filer: ladda ner" on storage.objects
  for select to authenticated
  using (bucket_id = 'plan-files' and public.market_id_from_path(name) is not null);

drop policy if exists "Marknadsplatsens filer: ladda upp" on storage.objects;
create policy "Marknadsplatsens filer: ladda upp" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'plan-files'
    and exists (select 1 from public.market_plans m where m.id = public.market_id_from_path(name) and m.owner_id = (select auth.uid()))
  );

drop policy if exists "Marknadsplatsens filer: ta bort" on storage.objects;
create policy "Marknadsplatsens filer: ta bort" on storage.objects
  for delete to authenticated
  using (bucket_id = 'plan-files' and public.can_manage_market(public.market_id_from_path(name)));

-- ── Räkna användningar (vem som helst får öka med ett) ──
create or replace function public.count_market_use(mid bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.market_plans set uses = uses + 1 where id = mid;
$$;

revoke all on function public.market_id_from_path(text) from public;
revoke all on function public.can_manage_market(bigint) from public, anon;
revoke all on function public.count_market_use(bigint) from public, anon;
grant execute on function public.market_id_from_path(text) to authenticated;
grant execute on function public.can_manage_market(bigint) to authenticated;
grant execute on function public.count_market_use(bigint) to authenticated;
