-- Lossi: feedback från testanvändare
-- Körs en gång i Supabase → SQL Editor. Kan köras om utan att något går sönder.
--
-- Testare skickar feedback från Lossi (Feedback-knappen i topbaren). De kan
-- skicka och se sina egna inlägg, inte andras. Tobias läser allt i Table Editor.
--
-- Claude läser via funktionen feedback_list(nyckel) med en hemlig läsnyckel
-- som bara ger åtkomst till feedbacken. Nyckeln ligger i tabellen
-- private.app_secrets (schemat private syns inte i Supabase API) och sätts av
-- supabase/feedback.local.sql, som bara finns lokalt och aldrig committas.

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('idea', 'bug', 'other')),
  message    text not null check (char_length(message) between 1 and 5000),
  page       text,
  context    jsonb not null default '{}'::jsonb,
  status     text not null default 'new' check (status in ('new', 'seen', 'done', 'wontfix')),
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "Egen feedback: skicka" on public.feedback;
create policy "Egen feedback: skicka" on public.feedback
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Egen feedback: läsa" on public.feedback;
create policy "Egen feedback: läsa" on public.feedback
  for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.feedback from anon;
grant select, insert on public.feedback to authenticated;

-- ── Hemlig läsnyckel (värdet sätts i feedback.local.sql) ──
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.app_secrets (
  key   text primary key,
  value text not null
);

-- ── Läsa feedback med nyckeln (för Claude) ──
create or replace function public.feedback_list(p_token text, p_since timestamptz default null)
returns table (
  id bigint, created_at timestamptz, kind text, status text, note text,
  author text, email text, page text, message text, context jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token is distinct from (select s.value from private.app_secrets s where s.key = 'feedback_token') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select f.id, f.created_at, f.kind, f.status, f.note,
           coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), u.email)::text,
           u.email::text, f.page, f.message, f.context
    from public.feedback f
    left join auth.users u on u.id = f.owner_id
    where p_since is null or f.created_at >= p_since
    order by f.created_at desc;
end;
$$;

-- ── Markera feedback som läst/åtgärdad (för Claude) ──
create or replace function public.feedback_set_status(p_token text, p_id bigint, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token is distinct from (select s.value from private.app_secrets s where s.key = 'feedback_token') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.feedback
  set status = p_status, note = coalesce(p_note, note)
  where id = p_id;
end;
$$;

revoke all on function public.feedback_list(text, timestamptz) from public;
revoke all on function public.feedback_set_status(text, bigint, text, text) from public;
grant execute on function public.feedback_list(text, timestamptz) to anon, authenticated;
grant execute on function public.feedback_set_status(text, bigint, text, text) to anon, authenticated;
