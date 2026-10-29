-- Lossi: administratörer i projekt (2026-10-29)
-- Körs en gång i Supabase → SQL Editor, efter projects.sql och notifications.sql.
-- Kan köras om.
--
-- Gäller bara projektet, inte Lossi som helhet (Lossis admin är
-- app_metadata.role i feedback-admin.sql och påverkas inte).
--
-- En medlem kan vara 'owner' (den som skapade projektet, en per projekt),
-- 'admin' eller 'member'. Ett projekt kan ha flera administratörer.
-- Administratörer kan det mesta som ägaren kan:
--   * byta projektets namn och avatar
--   * ta bort medlemmar och andra administratörer (aldrig ägaren)
--   * ta tillbaka inbjudningar som andra skickat
--   * göra medlemmar till administratörer och tvärtom
-- Bara ägaren kan ta bort projektet. En administratör kan lämna projektet
-- som en vanlig medlem.

-- 1. Rollen 'admin' blir tillåten
alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.project_members add constraint project_members_role_check
  check (role in ('owner', 'admin', 'member'));

-- 2. Ägare eller administratör i projektet
create or replace function public.is_project_manager(pid bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = pid and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_project_manager(bigint) from public, anon;
grant execute on function public.is_project_manager(bigint) to authenticated;

-- 3. Ge eller ta bort administratörsrollen (ägaren och administratörer).
--    Ägarens roll ändras aldrig. new_role = 'admin' eller 'member'.
create or replace function public.set_project_member_role(pid bigint, member uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new_role not in ('admin', 'member') then
    raise exception 'Okänd roll' using errcode = '22023';
  end if;
  if not public.is_project_manager(pid) then
    raise exception 'Bara ägaren och administratörer kan ändra roller' using errcode = '42501';
  end if;
  if exists (select 1 from public.project_members m where m.project_id = pid and m.user_id = member and m.role = 'owner') then
    raise exception 'Ägarens roll kan inte ändras' using errcode = '42501';
  end if;
  update public.project_members set role = new_role where project_id = pid and user_id = member;
  if not found then
    raise exception 'Personen är inte med i projektet' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_project_member_role(bigint, uuid, text) from public, anon;
grant execute on function public.set_project_member_role(bigint, uuid, text) to authenticated;

-- 4. Byt namn (förut bara ägaren)
create or replace function public.rename_project(pid bigint, project_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := trim(regexp_replace(coalesce(project_name, ''), '\s+', ' ', 'g'));
begin
  if not public.is_project_manager(pid) then
    raise exception 'Bara ägaren och administratörer kan byta namn' using errcode = '42501';
  end if;
  if clean = '' or length(clean) > 60 then
    raise exception 'Projektnamnet måste vara 1–60 tecken' using errcode = '22023';
  end if;
  update public.projects set name = clean where id = pid;
  return clean;
end;
$$;

-- 5. Byt avatar (förut bara ägaren)
create or replace function public.set_project_avatar(pid bigint, avatar_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_project_manager(pid) then
    raise exception 'Bara ägaren och administratörer kan byta avatar' using errcode = '42501';
  end if;
  update public.projects set avatar = nullif(trim(avatar_id), '') where id = pid;
end;
$$;

-- 6. Ta bort en medlem (förut bara ägaren). Aldrig ägaren eller sig själv
--    (man lämnar i stället).
create or replace function public.remove_project_member(pid bigint, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_project_manager(pid) then
    raise exception 'Bara ägaren och administratörer kan ta bort medlemmar' using errcode = '42501';
  end if;
  if member = (select auth.uid()) or exists (
    select 1 from public.project_members m where m.project_id = pid and m.user_id = member and m.role = 'owner'
  ) then
    raise exception 'Ägaren kan inte tas bort' using errcode = '42501';
  end if;
  perform public.drop_project_member(pid, member);
end;
$$;

-- 7. Ta tillbaka en inbjudan: den som bjöd in, ägaren eller en administratör
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
  if not (inv.invited_by = (select auth.uid()) or public.is_project_manager(inv.project_id)) then
    raise exception 'Bara den som bjöd in, ägaren eller en administratör kan ta tillbaka' using errcode = '42501';
  end if;
  delete from public.project_invites where id = invite;
end;
$$;

-- 8. Notisen "X gick med" går till ägaren och administratörerna
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
  where m.project_id = new.project_id and m.role in ('owner', 'admin') and m.user_id <> new.user_id;
  return new;
end;
$$;
