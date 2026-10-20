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
    values ('Sandlådan', uid, uid)
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


-- ── Steg 4: medskapare (redigeringsrätt på begäran) ──
-- En medlem i projektet kan be skaparen om att få redigera ett upplägg.
-- Skaparen godkänner (personen blir medskapare) eller nekar (förfrågan tas
-- bort), och kan när som helst ta bort en medskapare. Medskapare ändrar
-- innehållet men kan inte ta bort upplägget, byta skapare eller flytta det
-- till ett annat projekt.

create table if not exists public.plan_editors (
  plan_id      bigint not null references public.plans (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'requested' check (status in ('requested', 'approved')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  primary key (plan_id, user_id)
);

create index if not exists plan_editors_user_id_idx on public.plan_editors (user_id);

-- Är den inloggade godkänd medskapare på upplägget?
create or replace function public.is_plan_editor(pid bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plan_editors e
    where e.plan_id = pid and e.user_id = (select auth.uid()) and e.status = 'approved'
  );
$$;

-- Äger den inloggade upplägget?
create or replace function public.is_plan_owner(pid bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.plans p where p.id = pid and p.owner_id = (select auth.uid()));
$$;

alter table public.plan_editors enable row level security;

-- Läsa: sina egna förfrågningar, allt om sina egna upplägg, och godkända
-- medskapare på upplägg i projekt man är med i (visas under Personer)
drop policy if exists "Medskapare: läsa" on public.plan_editors;
create policy "Medskapare: läsa" on public.plan_editors
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_plan_owner(plan_id)
    or (status = 'approved' and exists (
      select 1 from public.plans p where p.id = plan_id and public.is_project_member(p.project_id)
    ))
  );

revoke all on public.plan_editors from anon, authenticated;
grant select on public.plan_editors to authenticated;

-- Be om redigeringsrätt (medlem i uppläggets projekt, inte skaparen)
create or replace function public.request_plan_edit(pid bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  p record;
  current_status text;
begin
  select id, owner_id, project_id into p from public.plans where id = pid;
  if uid is null or p.id is null or not public.is_project_member(p.project_id) then
    raise exception 'Upplägget finns inte' using errcode = 'P0002';
  end if;
  if p.owner_id = uid then
    return 'owner';
  end if;
  insert into public.plan_editors (plan_id, user_id, status)
  values (pid, uid, 'requested')
  on conflict (plan_id, user_id) do nothing;
  select status into current_status from public.plan_editors where plan_id = pid and user_id = uid;
  return current_status;
end;
$$;

-- Skaparen godkänner (approve = true) eller nekar (false) en förfrågan
create or replace function public.decide_plan_edit(pid bigint, editor uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_plan_owner(pid) then
    raise exception 'Bara skaparen kan ändra rättigheter' using errcode = '42501';
  end if;
  if approve then
    update public.plan_editors set status = 'approved', decided_at = now()
    where plan_id = pid and user_id = editor;
  else
    delete from public.plan_editors where plan_id = pid and user_id = editor;
  end if;
end;
$$;

-- Ta bort en medskapare (skaparen), eller dra tillbaka sin egen förfrågan/rätt
create or replace function public.remove_plan_editor(pid bigint, editor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_plan_owner(pid) or editor = (select auth.uid())) then
    raise exception 'Bara skaparen kan ta bort medskapare' using errcode = '42501';
  end if;
  delete from public.plan_editors where plan_id = pid and user_id = editor;
end;
$$;

-- Medskapare får ändra upplägget (skaparens regel "Egna upplägg: ändra" gäller som förut)
drop policy if exists "Upplägg: medskapare ändrar" on public.plans;
create policy "Upplägg: medskapare ändrar" on public.plans
  for update to authenticated
  using (public.is_plan_editor(id))
  with check (public.is_plan_editor(id));

-- ...men bara innehållet: skapare och projekt ligger fast för alla utom skaparen
create or replace function public.keep_plan_owner_and_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- (utan inloggad användare, t.ex. i SQL Editor, får allt ändras)
  if (select auth.uid()) is not null and old.owner_id is distinct from (select auth.uid()) then
    new.owner_id := old.owner_id;
    new.project_id := old.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists lossi_keep_plan_owner on public.plans;
create trigger lossi_keep_plan_owner
  before update on public.plans
  for each row execute function public.keep_plan_owner_and_project();

-- Lämnar man projektet försvinner ens rättigheter på dess upplägg
create or replace function public.drop_editor_rights_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.plan_editors e
  using public.plans p
  where e.plan_id = p.id and p.project_id = old.project_id and e.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists lossi_drop_editor_rights on public.project_members;
create trigger lossi_drop_editor_rights
  after delete on public.project_members
  for each row execute function public.drop_editor_rights_on_leave();

revoke all on function public.is_plan_editor(bigint) from public, anon;
revoke all on function public.is_plan_owner(bigint) from public, anon;
revoke all on function public.request_plan_edit(bigint) from public, anon;
revoke all on function public.decide_plan_edit(bigint, uuid, boolean) from public, anon;
revoke all on function public.remove_plan_editor(bigint, uuid) from public, anon;
revoke all on function public.keep_plan_owner_and_project() from public, anon, authenticated;
revoke all on function public.drop_editor_rights_on_leave() from public, anon, authenticated;
grant execute on function public.is_plan_editor(bigint) to authenticated;
grant execute on function public.is_plan_owner(bigint) to authenticated;
grant execute on function public.request_plan_edit(bigint) to authenticated;
grant execute on function public.decide_plan_edit(bigint, uuid, boolean) to authenticated;
grant execute on function public.remove_plan_editor(bigint, uuid) to authenticated;


-- ── Steg 4b: ta bort projekt ──
-- Bara projektets ägare kan ta bort ett delat projekt (egna projekt går inte).
-- Inget arbete försvinner: varje upplägg i projektet flyttas tillbaka till
-- skaparens eget projekt ("Mina upplägg"). Medskaparrätter och medlemskap
-- tas bort.

-- Regeln som låser skapare/projekt släpper när delete_project flyttar upplägg
create or replace function public.keep_plan_owner_and_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('lossi.moving_plans', true), '') = 'on' then
    return new;
  end if;
  -- (utan inloggad användare, t.ex. i SQL Editor, får allt ändras)
  if (select auth.uid()) is not null and old.owner_id is distinct from (select auth.uid()) then
    new.owner_id := old.owner_id;
    new.project_id := old.project_id;
  end if;
  return new;
end;
$$;

create or replace function public.delete_project(pid bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.project_members m
    join public.projects p on p.id = m.project_id
    where m.project_id = pid and m.user_id = (select auth.uid())
      and m.role = 'owner' and p.personal_owner is null
  ) then
    raise exception 'Bara projektets ägare kan ta bort det' using errcode = '42501';
  end if;
  delete from public.plan_editors e
  using public.plans p
  where e.plan_id = p.id and p.project_id = pid;
  perform set_config('lossi.moving_plans', 'on', true);
  update public.plans p
  set project_id = public.ensure_personal_project(p.owner_id)
  where p.project_id = pid;
  perform set_config('lossi.moving_plans', 'off', true);
  delete from public.projects where id = pid;
end;
$$;

revoke all on function public.keep_plan_owner_and_project() from public, anon, authenticated;
revoke all on function public.delete_project(bigint) from public, anon;
grant execute on function public.delete_project(bigint) to authenticated;


-- ── Steg 4c: byt namn på projekt ──
-- Bara projektets ägare (även för det egna projektet). 1–60 tecken.
create or replace function public.rename_project(pid bigint, project_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := trim(regexp_replace(coalesce(project_name, ''), '\s+', ' ', 'g'));
begin
  if not exists (
    select 1 from public.project_members m
    where m.project_id = pid and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'Bara projektets ägare kan byta namn' using errcode = '42501';
  end if;
  if clean = '' or length(clean) > 60 then
    raise exception 'Projektnamnet måste vara 1–60 tecken' using errcode = '22023';
  end if;
  update public.projects set name = clean where id = pid;
  return clean;
end;
$$;

revoke all on function public.rename_project(bigint, text) from public, anon;
grant execute on function public.rename_project(bigint, text) to authenticated;


-- ── Steg 4d: det första projektet är ett projekt som alla andra ──
-- Alla får ett första projekt ("Sandlådan") när kontot skapas. Det går att
-- bjuda in till det och byta namn på det, precis som andra projekt. Det enda
-- som skiljer: det kan inte tas bort, eftersom nya upplägg hamnar där som
-- standard och upplägg från borttagna projekt flyttas dit (personal_owner
-- markerar vilket projekt som är ens första).

create or replace function public.set_project_invite_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.invite_code is null then
    new.invite_code := public.new_invite_code();
  end if;
  return new;
end;
$$;

create or replace function public.project_for_invite_code(code text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.projects where invite_code = public.normalize_invite_code(code);
$$;

-- Koder till de första projekt som saknar en
update public.projects set invite_code = public.new_invite_code() where invite_code is null;

-- Det gamla standardnamnet byts till Sandlådan (namn som läraren själv valt lämnas)
update public.projects set name = 'Sandlådan' where personal_owner is not null and name = 'Mina upplägg';

revoke all on function public.set_project_invite_code() from public, anon, authenticated;
revoke all on function public.project_for_invite_code(text) from public, anon, authenticated;
