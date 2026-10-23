-- ── Den egna ytan är bara ens egen (2026-10-23) ──
-- Det första projektet ("{Förnamn}s yta", äldre: "Sandlådan") är en
-- reservplats: nya upplägg hamnar där och upplägg från borttagna/lämnade
-- projekt flyttas dit. Därför kan ingen annan bli medlem eller bjudas in dit.
-- För att samarbeta skapar man ett nytt projekt.
--
-- Kör efter projects.sql och notifications.sql. Går att köra om.
--   1. Spärrar: inbjudningar och medlemskap i någon annans egna yta stoppas
--      i databasen, oavsett vilken väg de kommer (e-post, gamla koder).
--   2. Städning: obesvarade inbjudningar till egna ytor tas bort, och den som
--      redan är medlem i någon annans egna yta tas bort därifrån. Deras
--      upplägg där flyttas till deras egen yta (som när man lämnar ett projekt),
--      så inget arbete försvinner.

-- 1. Spärrar
create or replace function public.keep_personal_project_private()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  select personal_owner into owner_id from public.projects where id = new.project_id;
  if owner_id is null then
    return new;
  end if;
  if tg_table_name = 'project_invites' then
    raise exception 'Din egen yta kan inte delas. Skapa ett nytt projekt för att samarbeta.' using errcode = '42501';
  end if;
  if new.user_id <> owner_id then
    raise exception 'Någon annans egna yta kan man inte gå med i' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists lossi_personal_no_invites on public.project_invites;
create trigger lossi_personal_no_invites
  before insert on public.project_invites
  for each row execute function public.keep_personal_project_private();

drop trigger if exists lossi_personal_no_members on public.project_members;
create trigger lossi_personal_no_members
  before insert on public.project_members
  for each row execute function public.keep_personal_project_private();

revoke all on function public.keep_personal_project_private() from public, anon, authenticated;

-- 2. Städning av det som redan finns (notiserna om inbjudningarna försvinner med dem)
delete from public.project_invites i
using public.projects p
where i.project_id = p.id and p.personal_owner is not null and i.status = 'pending';

do $$
declare
  m record;
begin
  for m in
    select pm.project_id, pm.user_id
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where p.personal_owner is not null and pm.user_id <> p.personal_owner
  loop
    perform public.drop_project_member(m.project_id, m.user_id);
  end loop;
end;
$$;
