-- Lossi: inbjudningar via e-post och notiser (klockan i topbaren)
-- Körs i Supabase → SQL Editor, efter projects.sql. Kan köras om.
--
-- En medlem bjuder in en e-postadress till projektet. Har personen konto
-- får hen en notis med Gå med / Avböj; annars sparas inbjudan och dyker upp
-- när kontot skapas med den adressen (då behövs ingen inbjudningskod).
-- Lossi skickar inga mejl.
--
-- Notiser skapas av databasen själv (regler nedan) och sparar namn och
-- titlar som de var då, så att de går att visa även om man inte delar
-- projekt med den som gjorde något. Var och en ser bara sina egna.

-- ── Hjälpfunktioner ──

-- Den inloggades e-postadress (gemener)
create or replace function public.current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(email) from auth.users where id = (select auth.uid());
$$;

-- Namnet som visas för en användare (visningsnamn, annars början av e-posten)
create or replace function public.display_name_of(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(raw_user_meta_data->>'display_name'), ''), split_part(email, '@', 1))
  from auth.users where id = uid;
$$;

-- ── Tabeller ──

create table if not exists public.project_invites (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references public.projects (id) on delete cascade,
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+$' and email = lower(email)),
  invited_by  uuid references auth.users (id) on delete set null,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);

create unique index if not exists project_invites_pending_idx
  on public.project_invites (project_id, email) where status = 'pending';
create index if not exists project_invites_email_idx on public.project_invites (email) where status = 'pending';

create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('project_invite', 'edit_request', 'editor_added', 'member_joined')),
  project_id   bigint references public.projects (id) on delete cascade,
  plan_id      bigint references public.plans (id) on delete cascade,
  invite_id    bigint references public.project_invites (id) on delete cascade,
  actor_name   text not null default '',
  project_name text not null default '',
  plan_title   text not null default '',
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.project_invites enable row level security;
alter table public.notifications enable row level security;

-- Inbjudningar: den inbjudna och projektets medlemmar ser dem
drop policy if exists "Inbjudningar: läsa" on public.project_invites;
create policy "Inbjudningar: läsa" on public.project_invites
  for select to authenticated
  using (email = public.current_email() or public.is_project_member(project_id));

-- Notiser: bara egna; man får bara markera dem som lästa
drop policy if exists "Notiser: läsa egna" on public.notifications;
create policy "Notiser: läsa egna" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Notiser: markera lästa" on public.notifications;
create policy "Notiser: markera lästa" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.project_invites from anon, authenticated;
revoke all on public.notifications from anon, authenticated;
grant select on public.project_invites to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ── Bjuda in, svara, ta tillbaka ──

-- Returnerar 'sent' (har konto, fick notis), 'saved' (inget konto än) eller 'member' (redan med)
create or replace function public.invite_by_email(pid bigint, invite_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := lower(trim(coalesce(invite_email, '')));
  target uuid;
begin
  if not public.is_project_member(pid) then
    raise exception 'Bara medlemmar kan bjuda in' using errcode = '42501';
  end if;
  if clean !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'Ogiltig e-postadress' using errcode = '22023';
  end if;
  select id into target from auth.users where lower(email) = clean;
  if target is not null and exists (select 1 from public.project_members where project_id = pid and user_id = target) then
    return 'member';
  end if;
  insert into public.project_invites (project_id, email, invited_by)
  values (pid, clean, (select auth.uid()))
  on conflict (project_id, email) where status = 'pending' do nothing;
  return case when target is null then 'saved' else 'sent' end;
end;
$$;

create or replace function public.answer_invite(invite bigint, accept boolean)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
begin
  select * into inv from public.project_invites where id = invite;
  if inv.id is null or inv.email <> public.current_email() then
    raise exception 'Inbjudan finns inte' using errcode = 'P0002';
  end if;
  if inv.status <> 'pending' then
    return inv.project_id;
  end if;
  update public.project_invites set status = case when accept then 'accepted' else 'declined' end, answered_at = now()
  where id = invite;
  if accept then
    insert into public.project_members (project_id, user_id, role)
    values (inv.project_id, (select auth.uid()), 'member')
    on conflict do nothing;
  end if;
  update public.notifications set read_at = coalesce(read_at, now())
  where invite_id = invite and user_id = (select auth.uid());
  return inv.project_id;
end;
$$;

-- Den som bjöd in, eller projektets ägare, kan ta tillbaka en obesvarad inbjudan
create or replace function public.cancel_invite(invite bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
begin
  select * into inv from public.project_invites where id = invite and status = 'pending';
  if inv.id is null then
    return;
  end if;
  if not (inv.invited_by = (select auth.uid()) or exists (
    select 1 from public.project_members m
    where m.project_id = inv.project_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  )) then
    raise exception 'Bara den som bjöd in eller ägaren kan ta tillbaka' using errcode = '42501';
  end if;
  delete from public.project_invites where id = invite;
end;
$$;

-- ── Notiser skapas automatiskt ──

-- Ny inbjudan till någon som har konto
create or replace function public.notify_project_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  select id into target from auth.users where lower(email) = new.email;
  if target is not null then
    insert into public.notifications (user_id, kind, project_id, invite_id, actor_name, project_name)
    select target, 'project_invite', new.project_id, new.id,
           coalesce(public.display_name_of(new.invited_by), ''), p.name
    from public.projects p where p.id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists lossi_notify_project_invite on public.project_invites;
create trigger lossi_notify_project_invite
  after insert on public.project_invites
  for each row execute function public.notify_project_invite();

-- Nytt konto: sparade inbjudningar till adressen blir notiser
create or replace function public.notify_saved_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, project_id, invite_id, actor_name, project_name)
  select new.id, 'project_invite', i.project_id, i.id, coalesce(public.display_name_of(i.invited_by), ''), p.name
  from public.project_invites i join public.projects p on p.id = i.project_id
  where i.status = 'pending' and i.email = lower(new.email);
  return new;
end;
$$;

drop trigger if exists lossi_notify_saved_invites on auth.users;
create trigger lossi_notify_saved_invites
  after insert on auth.users
  for each row execute function public.notify_saved_invites();

-- Medskapare: förfrågan till skaparen, godkänd/tillagd till medskaparen
create or replace function public.notify_plan_editor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl record;
begin
  select p.id, p.owner_id, p.title, pr.id as project_id, pr.name as project_name into pl
  from public.plans p join public.projects pr on pr.id = p.project_id where p.id = new.plan_id;
  if pl.id is null then
    return new;
  end if;
  if new.status = 'requested' and (tg_op = 'INSERT' or old.status is distinct from 'requested') then
    insert into public.notifications (user_id, kind, project_id, plan_id, actor_name, project_name, plan_title)
    values (pl.owner_id, 'edit_request', pl.project_id, pl.id, coalesce(public.display_name_of(new.user_id), ''), pl.project_name, pl.title);
  elsif new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved')
        and new.user_id is distinct from (select auth.uid()) then
    insert into public.notifications (user_id, kind, project_id, plan_id, actor_name, project_name, plan_title)
    values (new.user_id, 'editor_added', pl.project_id, pl.id, coalesce(public.display_name_of(pl.owner_id), ''), pl.project_name, pl.title);
  end if;
  return new;
end;
$$;

drop trigger if exists lossi_notify_plan_editor on public.plan_editors;
create trigger lossi_notify_plan_editor
  after insert or update of status on public.plan_editors
  for each row execute function public.notify_plan_editor();

-- Ny medlem: projektets ägare får veta (inte när ägaren själv läggs till)
create or replace function public.notify_member_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner' then
    return new;
  end if;
  insert into public.notifications (user_id, kind, project_id, actor_name, project_name)
  select m.user_id, 'member_joined', new.project_id, coalesce(public.display_name_of(new.user_id), ''), p.name
  from public.project_members m join public.projects p on p.id = m.project_id
  where m.project_id = new.project_id and m.role = 'owner' and m.user_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists lossi_notify_member_joined on public.project_members;
create trigger lossi_notify_member_joined
  after insert on public.project_members
  for each row execute function public.notify_member_joined();

-- ── Skapa konto med en sparad inbjudan i stället för kod ──
create or replace function public.require_invite_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.project_for_invite_code(new.raw_user_meta_data->>'invite_code') is null
     and not exists (select 1 from public.project_invites i where i.status = 'pending' and i.email = lower(new.email)) then
    raise exception 'Ogiltig inbjudningskod' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke all on function public.current_email() from public, anon;
revoke all on function public.display_name_of(uuid) from public, anon, authenticated;
revoke all on function public.invite_by_email(bigint, text) from public, anon;
revoke all on function public.answer_invite(bigint, boolean) from public, anon;
revoke all on function public.cancel_invite(bigint) from public, anon;
revoke all on function public.notify_project_invite() from public, anon, authenticated;
revoke all on function public.notify_saved_invites() from public, anon, authenticated;
revoke all on function public.notify_plan_editor() from public, anon, authenticated;
revoke all on function public.notify_member_joined() from public, anon, authenticated;
revoke all on function public.require_invite_code() from public, anon, authenticated;
grant execute on function public.current_email() to authenticated;
grant execute on function public.invite_by_email(bigint, text) to authenticated;
grant execute on function public.answer_invite(bigint, boolean) to authenticated;
grant execute on function public.cancel_invite(bigint) to authenticated;
