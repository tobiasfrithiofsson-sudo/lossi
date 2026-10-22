-- Lossi: klasser tillhör projektet (2026-10-22)
-- Körs en gång i Supabase → SQL Editor, efter projects.sql. Kan köras om.
--
-- Förut sparade varje lärare sina klasser i sin egen profil
-- (user_metadata.classes), så kollegorna i projektet såg dem inte. Nu har
-- varje projekt en lista med klasser som alla medlemmar ser, lägger till i
-- och tar bort ur. Ett upplägg pekar fortfarande på sin klass med namn
-- (state.klass), så ingenting i uppläggen behöver ändras.

alter table public.projects add column if not exists classes text[] not null default '{}';

-- Samma regler som appen: blanksteg städas, max 40 tecken, samma namn
-- (oavsett stora/små bokstäver) bara en gång, högst 200 klasser.
create or replace function public.clean_class_name(class_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(regexp_replace(trim(coalesce(class_name, '')), '\s+', ' ', 'g'), 40);
$$;

create or replace function public.add_project_class(pid bigint, class_name text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := public.clean_class_name(class_name);
  result text[];
begin
  if not public.is_project_member(pid) then
    raise exception 'Du är inte med i projektet' using errcode = '42501';
  end if;
  if cleaned = '' then
    raise exception 'Klassen behöver ett namn' using errcode = '22023';
  end if;
  update public.projects p
    set classes = array_append(p.classes, cleaned)
    where p.id = pid
      and cardinality(p.classes) < 200
      and not exists (select 1 from unnest(p.classes) c where lower(c) = lower(cleaned));
  select p.classes into result from public.projects p where p.id = pid;
  return result;
end;
$$;

create or replace function public.remove_project_class(pid bigint, class_name text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := public.clean_class_name(class_name);
  result text[];
begin
  if not public.is_project_member(pid) then
    raise exception 'Du är inte med i projektet' using errcode = '42501';
  end if;
  update public.projects p
    set classes = array(select c from unnest(p.classes) c where lower(c) <> lower(cleaned))
    where p.id = pid;
  select p.classes into result from public.projects p where p.id = pid;
  return result;
end;
$$;

revoke all on function public.clean_class_name(text) from public, anon;
revoke all on function public.add_project_class(bigint, text) from public, anon;
revoke all on function public.remove_project_class(bigint, text) from public, anon;
grant execute on function public.clean_class_name(text) to authenticated;
grant execute on function public.add_project_class(bigint, text) to authenticated;
grant execute on function public.remove_project_class(bigint, text) to authenticated;

-- Engångsflytt: klasser som redan finns läggs in i projekten, så att
-- ingenting försvinner ur listorna. Ett projekt får
--   * klasserna som används på dess upplägg, och
--   * medlemmarnas egna sparade klasser (user_metadata.classes).
-- Finns redan namnet görs inget (det går alltså bra att köra om).
with found as (
  select p.project_id, public.clean_class_name(p.state ->> 'klass') as name
  from public.plans p
  where coalesce(p.state ->> 'klass', '') <> ''
  union
  select m.project_id, public.clean_class_name(c.value)
  from public.project_members m
  join auth.users u on u.id = m.user_id
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(u.raw_user_meta_data -> 'classes') = 'array'
         then u.raw_user_meta_data -> 'classes' else '[]'::jsonb end
  ) as c(value)
),
missing as (
  select f.project_id, f.name
  from found f
  join public.projects pr on pr.id = f.project_id
  where f.name <> ''
    and not exists (select 1 from unnest(pr.classes) c where lower(c) = lower(f.name))
),
unique_missing as (
  select distinct on (project_id, lower(name)) project_id, name
  from missing
  order by project_id, lower(name), name
)
update public.projects pr
  set classes = pr.classes || (
    select array_agg(um.name order by um.name) from unique_missing um where um.project_id = pr.id
  )
where exists (select 1 from unique_missing um where um.project_id = pr.id);
