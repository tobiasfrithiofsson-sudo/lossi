-- Lossi: projekt (steg 1 av delade projekt)
-- Körs en gång i Supabase → SQL Editor, efter schema.sql och calendar.sql.
-- Kan köras om utan att något går sönder.
--
-- Ett projekt samlar upplägg. Alla användare har ett eget projekt
-- ("Mina upplägg", bara för en själv); en skola är ett projekt med många
-- medlemmar. Varje upplägg ligger i exakt ett projekt.
--
-- Den här filen ändrar inget som syns i appen: alla befintliga upplägg flyttas
-- till skaparens egna projekt, och nya upplägg hamnar där av sig själva.
-- Medlemmar i ett projekt får LÄSA varandras upplägg, men bara skaparen får
-- ändra eller ta bort. (Delade projekt, inbjudningskod och redigeringsrätt
-- kommer i senare steg.)


-- ── Tabeller ──

create table if not exists public.projects (
  id             bigint generated always as identity primary key,
  name           text not null default '',
  -- Satt = någons egna projekt (ett per användare). Tomt = delat projekt.
  personal_owner uuid unique references auth.users (id) on delete cascade,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id bigint not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_id_idx on public.project_members (user_id);


-- ── Hjälpfunktioner ──

-- Är den inloggade medlem i projektet? (security definer så att reglerna
-- nedan kan fråga medlemstabellen utan att fastna i sina egna regler.)
create or replace function public.is_project_member(pid bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = pid and m.user_id = (select auth.uid())
  );
$$;

-- Skapar en användares egna projekt (och medlemskapet) om det saknas.
-- Returnerar projektets id.
create or replace function public.ensure_personal_project(uid uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid bigint;
begin
  if uid is null then
    return null;
  end if;
  select id into pid from public.projects where personal_owner = uid;
  if pid is null then
    insert into public.projects (name, personal_owner, created_by)
    values ('Mina upplägg', uid, uid)
    on conflict (personal_owner) do nothing
    returning id into pid;
    if pid is null then
      select id into pid from public.projects where personal_owner = uid;
    end if;
  end if;
  insert into public.project_members (project_id, user_id, role)
  values (pid, uid, 'owner')
  on conflict do nothing;
  return pid;
end;
$$;

-- Den inloggades egna projekt; standardvärde för nya upplägg.
create or replace function public.personal_project_id()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select public.ensure_personal_project((select auth.uid()));
$$;

-- Nya konton får sitt egna projekt direkt.
create or replace function public.create_personal_project_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_personal_project(new.id);
  return new;
end;
$$;

drop trigger if exists lossi_personal_project on auth.users;
create trigger lossi_personal_project
  after insert on auth.users
  for each row execute function public.create_personal_project_for_new_user();

revoke all on function public.ensure_personal_project(uuid) from public, anon, authenticated;
revoke all on function public.create_personal_project_for_new_user() from public, anon, authenticated;
revoke all on function public.is_project_member(bigint) from public, anon;
revoke all on function public.personal_project_id() from public, anon;
grant execute on function public.is_project_member(bigint) to authenticated;
grant execute on function public.personal_project_id() to authenticated;


-- ── Befintliga konton och upplägg ──

-- Eget projekt åt alla som redan har konto.
do $$
begin
  perform public.ensure_personal_project(id) from auth.users;
end;
$$;

-- Varje upplägg får ett projekt; befintliga hamnar i skaparens egna projekt.
alter table public.plans
  add column if not exists project_id bigint references public.projects (id) on delete cascade;

update public.plans p
set project_id = pr.id
from public.projects pr
where p.project_id is null and pr.personal_owner = p.owner_id;

alter table public.plans alter column project_id set default public.personal_project_id();
alter table public.plans alter column project_id set not null;

create index if not exists plans_project_id_idx on public.plans (project_id);


-- ── Row Level Security ──

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

drop policy if exists "Projekt: läsa egna" on public.projects;
create policy "Projekt: läsa egna" on public.projects
  for select to authenticated
  using (public.is_project_member(id));

drop policy if exists "Medlemmar: läsa i egna projekt" on public.project_members;
create policy "Medlemmar: läsa i egna projekt" on public.project_members
  for select to authenticated
  using (public.is_project_member(project_id));

-- Projekt och medlemskap skapas än så länge bara av databasen själv
-- (funktionerna ovan), så inloggade får bara läsa.
revoke all on public.projects from anon, authenticated;
revoke all on public.project_members from anon, authenticated;
grant select on public.projects to authenticated;
grant select on public.project_members to authenticated;

-- Upplägg: medlemmar läser, bara skaparen ändrar och tar bort.
drop policy if exists "Egna upplägg: läsa" on public.plans;
drop policy if exists "Upplägg: läsa i egna projekt" on public.plans;
create policy "Upplägg: läsa i egna projekt" on public.plans
  for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists "Egna upplägg: skapa" on public.plans;
create policy "Egna upplägg: skapa" on public.plans
  for insert to authenticated
  with check ((select auth.uid()) = owner_id and public.is_project_member(project_id));

drop policy if exists "Egna upplägg: ändra" on public.plans;
create policy "Egna upplägg: ändra" on public.plans
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id and public.is_project_member(project_id));

-- "Egna upplägg: ta bort" från schema.sql gäller oförändrad.


-- ── Steg 2: namn och avatar på medlemmarna ──
-- Profilerna ligger i auth.users, som inloggade inte kan läsa. Funktionen
-- visar namn, avatar och e-post för medlemmarna i de projekt man själv är med i.
create or replace function public.project_member_profiles()
returns table (project_id bigint, user_id uuid, role text, display_name text, avatar text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.project_id, m.user_id, m.role,
         nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
         u.raw_user_meta_data->>'avatar',
         u.email::text
  from public.project_members m
  join auth.users u on u.id = m.user_id
  where public.is_project_member(m.project_id);
$$;

revoke all on function public.project_member_profiles() from public, anon;
grant execute on function public.project_member_profiles() to authenticated;


-- ── Steg 3: inbjudningskod ──
-- Varje delat projekt har en kod (8 tecken, utan lättförväxlade tecken som
-- 0/O och 1/I). Alla medlemmar ser koden och kan dela den. Med koden kan
-- man skapa ett konto (login.html) eller, om man redan har ett, gå med i
-- projektet (Gå med med kod i projektväljaren). Egna projekt har ingen kod.
--
-- Konton kan bara skapas med en giltig kod: regeln lossi_require_invite_code
-- stoppar alla andra nya konton, även de som skapas i Supabase-panelen.

create or replace function public.new_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 31) + 1, 1), '' order by i)
  from (select uuid_send(gen_random_uuid()) as b) r, generate_series(0, 7) i;
$$;

-- Skrivs med eller utan bindestreck/mellanslag, stora eller små bokstäver
create or replace function public.normalize_invite_code(code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

alter table public.projects add column if not exists invite_code text unique;

update public.projects
set invite_code = public.new_invite_code()
where personal_owner is null and invite_code is null;

-- Nya delade projekt får en kod direkt (egna projekt aldrig)
create or replace function public.set_project_invite_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.personal_owner is not null then
    new.invite_code := null;
  elsif new.invite_code is null then
    new.invite_code := public.new_invite_code();
  end if;
  return new;
end;
$$;

drop trigger if exists lossi_project_invite_code on public.projects;
create trigger lossi_project_invite_code
  before insert or update of invite_code, personal_owner on public.projects
  for each row execute function public.set_project_invite_code();

-- Projektet som en kod hör till (null om koden inte finns)
create or replace function public.project_for_invite_code(code text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.projects
  where personal_owner is null and invite_code = public.normalize_invite_code(code);
$$;

-- För sidan Skapa konto: projektets namn, så att man ser vart koden leder
create or replace function public.invite_project_name(code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select name from public.projects where id = public.project_for_invite_code(code);
$$;

-- Inloggade med en kod: gå med i projektet. Returnerar projektets id.
create or replace function public.join_project(code text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid bigint := public.project_for_invite_code(code);
begin
  if (select auth.uid()) is null then
    raise exception 'Inte inloggad';
  end if;
  if pid is null then
    raise exception 'Ogiltig inbjudningskod' using errcode = 'P0002';
  end if;
  insert into public.project_members (project_id, user_id, role)
  values (pid, (select auth.uid()), 'member')
  on conflict do nothing;
  return pid;
end;
$$;

-- Nya konton måste ha en giltig kod (skickas med som invite_code när kontot skapas)
create or replace function public.require_invite_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.project_for_invite_code(new.raw_user_meta_data->>'invite_code') is null then
    raise exception 'Ogiltig inbjudningskod' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

drop trigger if exists lossi_require_invite_code on auth.users;
create trigger lossi_require_invite_code
  before insert on auth.users
  for each row execute function public.require_invite_code();

-- Nya konton: eget projekt + medlem i projektet som koden hör till
create or replace function public.create_personal_project_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid bigint := public.project_for_invite_code(new.raw_user_meta_data->>'invite_code');
begin
  perform public.ensure_personal_project(new.id);
  if pid is not null then
    insert into public.project_members (project_id, user_id, role)
    values (pid, new.id, 'member')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.new_invite_code() from public, anon, authenticated;
revoke all on function public.set_project_invite_code() from public, anon, authenticated;
revoke all on function public.project_for_invite_code(text) from public, anon, authenticated;
revoke all on function public.require_invite_code() from public, anon, authenticated;
revoke all on function public.create_personal_project_for_new_user() from public, anon, authenticated;
revoke all on function public.invite_project_name(text) from public;
revoke all on function public.join_project(text) from public, anon;
grant execute on function public.invite_project_name(text) to anon, authenticated;
grant execute on function public.join_project(text) to authenticated;


-- ── Steg 3b: alla kan skapa projekt ──
-- Skaparen blir ägare och första medlem. Projektet får en inbjudningskod
-- automatiskt (lossi_project_invite_code ovan). Returnerar projektets id.
create or replace function public.create_project(project_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  clean text := trim(regexp_replace(coalesce(project_name, ''), '\s+', ' ', 'g'));
  pid bigint;
begin
  if uid is null then
    raise exception 'Inte inloggad';
  end if;
  if clean = '' or length(clean) > 60 then
    raise exception 'Projektnamnet måste vara 1–60 tecken' using errcode = '22023';
  end if;
  insert into public.projects (name, created_by) values (clean, uid) returning id into pid;
  insert into public.project_members (project_id, user_id, role) values (pid, uid, 'owner');
  return pid;
end;
$$;

revoke all on function public.create_project(text) from public, anon;
grant execute on function public.create_project(text) to authenticated;
