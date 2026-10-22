-- Lossi: fristående koder för att skapa konto (onboarding, 2026-10-22)
-- Körs en gång i Supabase → SQL Editor, efter projects.sql, notifications.sql
-- och feedback-admin.sql. Kan köras om utan att något går sönder.
--
-- Under testperioden skapar administratörerna koder på admin-sidan. En kod
-- är inte kopplad till något projekt och kan användas av flera: den gäller
-- tills ett datum (eller tills vidare) och kan avslutas när som helst.
-- Ett konto kan skapas med
--   * en giltig kod, eller
--   * en väntande inbjudan till e-postadressen (från en kollega i Lossi).
-- Projektens gamla inbjudningskoder slutar gälla: kollegor bjuds in med e-post.
--
-- Nya konton får sitt första projekt döpt efter förnamnet ("Annas yta").


-- ── Koder och vilka som skapat konto med dem ──

create table if not exists public.access_codes (
  id          bigint generated always as identity primary key,
  code        text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  valid_until timestamptz,            -- tomt = gäller tills vidare
  closed_at   timestamptz,            -- avslutad av en administratör
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.access_code_signups (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code_id    bigint not null references public.access_codes (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists access_code_signups_code_idx on public.access_code_signups (code_id);

-- Bara via funktionerna nedan (ingen läser eller ändrar tabellerna direkt)
alter table public.access_codes enable row level security;
alter table public.access_code_signups enable row level security;
revoke all on public.access_codes from anon, authenticated;
revoke all on public.access_code_signups from anon, authenticated;


-- ── Hjälpfunktioner ──

-- Versaler, bara bokstäver och siffror ("ab-12 cd" → "AB12CD")
create or replace function public.normalize_access_code(code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Kodens id om den gäller just nu, annars null
-- (Parametern heter input_code: i SQL-funktioner vinner kolumnnamnet code annars.)
create or replace function public.valid_access_code_id(input_code text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.access_codes c
  where c.code = public.normalize_access_code(input_code)
    and c.closed_at is null
    and (c.valid_until is null or c.valid_until > now());
$$;

-- Steg 1 i onboardingen: gäller koden? (Utloggade får fråga.)
create or replace function public.check_access_code(input_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.valid_access_code_id(input_code) is not null;
$$;

-- "Anna" → "Annas yta", "Johannes" → "Johannes yta"
create or replace function public.personal_space_name(first_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(trim(first_name), '') = '' then 'Sandlådan'
    when lower(right(trim(first_name), 1)) in ('s', 'x', 'z') then left(trim(first_name), 50) || ' yta'
    else left(trim(first_name), 50) || 's yta'
  end;
$$;


-- ── Vem får skapa konto ──
-- Ersätter regeln i projects.sql/notifications.sql (projektets inbjudningskod).
create or replace function public.require_invite_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.valid_access_code_id(new.raw_user_meta_data->>'access_code') is null
     and not exists (select 1 from public.project_invites i where i.status = 'pending' and i.email = lower(new.email)) then
    raise exception 'Ogiltig kod' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

-- Nytt konto: eget första projekt ("Annas yta") och noteringen om koden.
-- Ersätter funktionen i projects.sql (som också gick med i kodens projekt).
create or replace function public.create_personal_project_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid bigint;
  code_id bigint := public.valid_access_code_id(new.raw_user_meta_data->>'access_code');
begin
  pid := public.ensure_personal_project(new.id);
  update public.projects
    set name = public.personal_space_name(new.raw_user_meta_data->>'first_name')
    where id = pid and coalesce(new.raw_user_meta_data->>'first_name', '') <> '';
  if code_id is not null then
    insert into public.access_code_signups (user_id, code_id) values (new.id, code_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;


-- ── Projektens gamla koder slutar gälla ──
-- (Kolumnen invite_code finns kvar men används inte.)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'join_project' and pronamespace = 'public'::regnamespace) then
    revoke all on function public.join_project(text) from public, anon, authenticated;
  end if;
  if exists (select 1 from pg_proc where proname = 'invite_project_name' and pronamespace = 'public'::regnamespace) then
    revoke all on function public.invite_project_name(text) from public, anon, authenticated;
  end if;
end;
$$;


-- ── Administratörer (is_lossi_admin i feedback-admin.sql) ──

-- Alla koder, nyast först, med vilka som skapat konto med dem
create or replace function public.admin_list_access_codes()
returns table (
  id bigint, code text, valid_until timestamptz, closed_at timestamptz, created_at timestamptz,
  active boolean, users jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_lossi_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select c.id, c.code, c.valid_until, c.closed_at, c.created_at,
           (c.closed_at is null and (c.valid_until is null or c.valid_until > now())),
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'name', coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), u.email),
               'email', u.email,
               'created_at', s.created_at
             ) order by s.created_at desc)
             from public.access_code_signups s join auth.users u on u.id = s.user_id
             where s.code_id = c.id
           ), '[]'::jsonb)
    from public.access_codes c
    order by c.created_at desc;
end;
$$;

-- Ny kod: 6 tecken utan sådana som förväxlas (0/O, 1/I/L)
create or replace function public.admin_create_access_code(p_valid_until timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  if not public.is_lossi_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.access_codes where code = candidate);
  end loop;
  insert into public.access_codes (code, valid_until) values (candidate, p_valid_until);
  return candidate;
end;
$$;

-- Ändra till vilket datum koden gäller (tomt = tills vidare)
create or replace function public.admin_set_access_code_until(p_id bigint, p_valid_until timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_lossi_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.access_codes set valid_until = p_valid_until where id = p_id;
end;
$$;

-- Avsluta koden nu (eller öppna den igen)
create or replace function public.admin_close_access_code(p_id bigint, p_closed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_lossi_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.access_codes set closed_at = case when p_closed then now() else null end where id = p_id;
end;
$$;

revoke all on function public.normalize_access_code(text) from public, anon, authenticated;
revoke all on function public.valid_access_code_id(text) from public, anon, authenticated;
revoke all on function public.personal_space_name(text) from public, anon, authenticated;
revoke all on function public.require_invite_code() from public, anon, authenticated;
revoke all on function public.create_personal_project_for_new_user() from public, anon, authenticated;
revoke all on function public.check_access_code(text) from public;
revoke all on function public.admin_list_access_codes() from public, anon;
revoke all on function public.admin_create_access_code(timestamptz) from public, anon;
revoke all on function public.admin_set_access_code_until(bigint, timestamptz) from public, anon;
revoke all on function public.admin_close_access_code(bigint, boolean) from public, anon;
grant execute on function public.check_access_code(text) to anon, authenticated;
grant execute on function public.admin_list_access_codes() to authenticated;
grant execute on function public.admin_create_access_code(timestamptz) to authenticated;
grant execute on function public.admin_set_access_code_until(bigint, timestamptz) to authenticated;
grant execute on function public.admin_close_access_code(bigint, boolean) to authenticated;
