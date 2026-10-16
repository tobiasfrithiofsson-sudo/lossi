-- Lossi: databasschema (steg 4 i docs/migration-plan.md)
-- Körs en gång i Supabase → SQL Editor. Kan köras om utan att något går sönder.
--
-- Ett upplägg = en rad. Hela innehållet ligger som JSON i "state", samma form
-- som saveState() i upplag.html. title och avatar finns även som egna kolumner
-- så att listor kan hämtas utan att läsa hela innehållet.
-- Vanlig Postgres; bara auth.users och auth.uid() är Supabase-specifika.

create table if not exists public.plans (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null default '',
  avatar     text,
  state      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_owner_id_idx on public.plans (owner_id);

-- updated_at sätts automatiskt vid varje ändring
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- Row Level Security: varje inloggad lärare ser och ändrar bara sina egna upplägg.
-- Utloggade (anon) kommer inte åt något alls.
alter table public.plans enable row level security;

drop policy if exists "Egna upplägg: läsa" on public.plans;
create policy "Egna upplägg: läsa" on public.plans
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Egna upplägg: skapa" on public.plans;
create policy "Egna upplägg: skapa" on public.plans
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Egna upplägg: ändra" on public.plans;
create policy "Egna upplägg: ändra" on public.plans
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Egna upplägg: ta bort" on public.plans;
create policy "Egna upplägg: ta bort" on public.plans
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Behörigheter för Supabase Data API (krävs uttryckligen i nya projekt)
revoke all on public.plans from anon;
grant select, insert, update, delete on public.plans to authenticated;
