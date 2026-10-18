-- Lossi: kalendern (lektioner kopplade till en tid)
-- Körs en gång i Supabase → SQL Editor. Kan köras om utan att något går sönder.
-- Kräver att schema.sql (tabellen plans) redan körts.
--
-- En rad = en lektion i ett upplägg, inlagd på en tid i lärarens kalender.
-- lesson_id är lektionens fasta id i uppläggets innehåll (data-lesson-id).
-- En lektion kan ligga på ett tillfälle (unique plan_id + lesson_id).
-- Tas upplägget eller kontot bort försvinner händelserna automatiskt.

create table if not exists public.lesson_events (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id      bigint not null references public.plans (id) on delete cascade,
  lesson_id    text not null,
  starts_at    timestamptz not null,
  duration_min integer not null default 60 check (duration_min between 5 and 600),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (plan_id, lesson_id)
);

create index if not exists lesson_events_owner_start_idx on public.lesson_events (owner_id, starts_at);

drop trigger if exists lesson_events_set_updated_at on public.lesson_events;
create trigger lesson_events_set_updated_at
  before update on public.lesson_events
  for each row execute function public.set_updated_at();

-- Row Level Security: bara egna händelser, och bara på egna upplägg
alter table public.lesson_events enable row level security;

drop policy if exists "Egna händelser: läsa" on public.lesson_events;
create policy "Egna händelser: läsa" on public.lesson_events
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Egna händelser: skapa" on public.lesson_events;
create policy "Egna händelser: skapa" on public.lesson_events
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.plans p where p.id = plan_id and p.owner_id = (select auth.uid()))
  );

drop policy if exists "Egna händelser: ändra" on public.lesson_events;
create policy "Egna händelser: ändra" on public.lesson_events
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.plans p where p.id = plan_id and p.owner_id = (select auth.uid()))
  );

drop policy if exists "Egna händelser: ta bort" on public.lesson_events;
create policy "Egna händelser: ta bort" on public.lesson_events
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.lesson_events from anon;
grant select, insert, update, delete on public.lesson_events to authenticated;
