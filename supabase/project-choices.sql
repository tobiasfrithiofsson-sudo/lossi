-- Lossi: ämnen och årskurser tillhör projektet (2026-10-29)
-- Körs en gång i Supabase → SQL Editor, efter project-classes.sql. Kan köras om.
--
-- Förut var förslagen under Ämne och Årskurs en fast standardlista plus
-- lärarens egna sparade värden (user_metadata.subjects/grades). Nu har varje
-- projekt en lista med ämnen och en med årskurser, som alla medlemmar ser och
-- kan ändra i Projektinställningar. Ett upplägg sparar fortfarande ämnet och
-- årskursen som text (state.subject, state.grade), så uppläggen ändras inte.

-- Nya och befintliga projekt börjar med standardlistan (samma som
-- PLAN_SUBJECTS och PLAN_GRADES i theme.js)
alter table public.projects add column if not exists subjects text[] not null
  default '{Samhällskunskap,Svenska,Matematik,Biologi,Fysik,Kemi,Engelska,Idrott,Bild}';
alter table public.projects add column if not exists grades text[] not null
  default '{Förskola,F,1,2,3,4,5,6,7,8,9}';

-- kind = 'subjects' eller 'grades'. Samma städning som klasser
-- (clean_class_name: blanksteg, max 40 tecken), samma värde bara en gång
-- oavsett stora/små bokstäver, högst 200 per lista.
create or replace function public.add_project_choice(pid bigint, kind text, choice text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := public.clean_class_name(choice);
  result text[];
begin
  if not public.is_project_member(pid) then
    raise exception 'Du är inte med i projektet' using errcode = '42501';
  end if;
  if cleaned = '' then
    raise exception 'Värdet är tomt' using errcode = '22023';
  end if;
  if kind = 'subjects' then
    update public.projects p set subjects = array_append(p.subjects, cleaned)
      where p.id = pid and cardinality(p.subjects) < 200
        and not exists (select 1 from unnest(p.subjects) s where lower(s) = lower(cleaned));
    select p.subjects into result from public.projects p where p.id = pid;
  elsif kind = 'grades' then
    update public.projects p set grades = array_append(p.grades, cleaned)
      where p.id = pid and cardinality(p.grades) < 200
        and not exists (select 1 from unnest(p.grades) g where lower(g) = lower(cleaned));
    select p.grades into result from public.projects p where p.id = pid;
  else
    raise exception 'Okänd lista' using errcode = '22023';
  end if;
  return result;
end;
$$;

create or replace function public.remove_project_choice(pid bigint, kind text, choice text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := public.clean_class_name(choice);
  result text[];
begin
  if not public.is_project_member(pid) then
    raise exception 'Du är inte med i projektet' using errcode = '42501';
  end if;
  if kind = 'subjects' then
    update public.projects p set subjects = array(select s from unnest(p.subjects) s where lower(s) <> lower(cleaned))
      where p.id = pid;
    select p.subjects into result from public.projects p where p.id = pid;
  elsif kind = 'grades' then
    update public.projects p set grades = array(select g from unnest(p.grades) g where lower(g) <> lower(cleaned))
      where p.id = pid;
    select p.grades into result from public.projects p where p.id = pid;
  else
    raise exception 'Okänd lista' using errcode = '22023';
  end if;
  return result;
end;
$$;

revoke all on function public.add_project_choice(bigint, text, text) from public, anon;
revoke all on function public.remove_project_choice(bigint, text, text) from public, anon;
grant execute on function public.add_project_choice(bigint, text, text) to authenticated;
grant execute on function public.remove_project_choice(bigint, text, text) to authenticated;

-- Engångsflytt: ämnen och årskurser som redan används läggs till i projekten,
-- så att ingenting försvinner ur listorna. Ett projekt får
--   * ämnena/årskurserna på dess upplägg, och
--   * medlemmarnas egna sparade (user_metadata.subjects/grades).
-- Finns värdet redan görs inget (det går alltså bra att köra om).
with found as (
  select p.project_id, 'subjects' as kind, public.clean_class_name(p.state ->> 'subject') as name
  from public.plans p where coalesce(p.state ->> 'subject', '') <> ''
  union
  select p.project_id, 'grades', public.clean_class_name(p.state ->> 'grade')
  from public.plans p where coalesce(p.state ->> 'grade', '') <> ''
  union
  select m.project_id, k.kind, public.clean_class_name(c.value)
  from public.project_members m
  join auth.users u on u.id = m.user_id
  cross join (values ('subjects'), ('grades')) as k(kind)
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(u.raw_user_meta_data -> k.kind) = 'array'
         then u.raw_user_meta_data -> k.kind else '[]'::jsonb end
  ) as c(value)
),
unique_found as (
  select distinct on (project_id, kind, lower(name)) project_id, kind, name
  from found where name <> ''
  order by project_id, kind, lower(name), name
)
update public.projects pr
  set subjects = pr.subjects || coalesce((
        select array_agg(f.name order by f.name) from unique_found f
        where f.project_id = pr.id and f.kind = 'subjects'
          and not exists (select 1 from unnest(pr.subjects) s where lower(s) = lower(f.name))), '{}'),
      grades = pr.grades || coalesce((
        select array_agg(f.name order by f.name) from unique_found f
        where f.project_id = pr.id and f.kind = 'grades'
          and not exists (select 1 from unnest(pr.grades) g where lower(g) = lower(f.name))), '{}')
where exists (select 1 from unique_found f where f.project_id = pr.id);
