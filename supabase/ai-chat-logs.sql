-- Lossi: samtalen i Planera med AI sparas för att förbättra AI:n (2026-10-29)
-- Körs en gång i Supabase → SQL Editor, efter ai.sql och feedback-admin.sql.
-- Kan köras om.
--
-- Varje svar från AI:n blir en rad: lärarens fråga, svaret, ett eventuellt
-- förslag, vad läraren gjorde med förslaget (genomförde, avböjde, ångrade)
-- och lärarens tumme upp/ner. Raderna skrivs av serverfunktionen plan-chat
-- och raderas efter 90 dagar (funktionen städar bort äldre rader när den
-- sparar nya). Bara Lossis administratörer (is_lossi_admin, feedback-admin.sql)
-- kan läsa dem, i Admin › AI-samtal. En lärare kan bara sätta tumme och utfall
-- på sina egna rader, och raderna försvinner om kontot tas bort.

create table if not exists public.ai_chat_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  plan_id     bigint,
  question    text not null,
  reply       text not null default '',
  proposal    jsonb,
  outcome     text check (outcome in ('applied', 'declined', 'undone')),
  rating      smallint check (rating in (-1, 1)),
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists ai_chat_logs_created_idx on public.ai_chat_logs (created_at desc);
create index if not exists ai_chat_logs_user_idx on public.ai_chat_logs (user_id, created_at desc);

-- RLS utan regler: ingen läser eller skriver direkt, bara via funktionerna nedan
-- (och serverfunktionen, som använder service role).
alter table public.ai_chat_logs enable row level security;

-- Lärarens tumme upp (1), ner (-1) eller ingen (null) på ett eget svar
create or replace function public.rate_ai_chat(log_id bigint, value smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if value is not null and value not in (-1, 1) then
    raise exception 'Okänt värde' using errcode = '22023';
  end if;
  update public.ai_chat_logs set rating = value
  where id = log_id and user_id = (select auth.uid());
end;
$$;

-- Vad läraren gjorde med förslaget i ett eget svar
create or replace function public.set_ai_chat_outcome(log_id bigint, value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if value not in ('applied', 'declined', 'undone') then
    raise exception 'Okänt värde' using errcode = '22023';
  end if;
  update public.ai_chat_logs set outcome = value
  where id = log_id and user_id = (select auth.uid()) and proposal is not null;
end;
$$;

-- Admin › AI-samtal: de senaste 90 dagarna, nyast först, med lärarens namn
-- och uppläggets titel
create or replace function public.ai_chat_admin_list()
returns table (
  id bigint, created_at timestamptz, author text, email text, plan_id bigint, plan_title text,
  question text, reply text, proposal jsonb, outcome text, rating smallint, error text
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
    select l.id, l.created_at,
           coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), u.email)::text,
           u.email::text, l.plan_id, p.title::text,
           l.question, l.reply, l.proposal, l.outcome, l.rating, l.error
    from public.ai_chat_logs l
    left join auth.users u on u.id = l.user_id
    left join public.plans p on p.id = l.plan_id
    where l.created_at > now() - interval '90 days'
    order by l.created_at desc
    limit 1000;
end;
$$;

revoke all on function public.rate_ai_chat(bigint, smallint) from public, anon;
revoke all on function public.set_ai_chat_outcome(bigint, text) from public, anon;
revoke all on function public.ai_chat_admin_list() from public, anon;
grant execute on function public.rate_ai_chat(bigint, smallint) to authenticated;
grant execute on function public.set_ai_chat_outcome(bigint, text) to authenticated;
grant execute on function public.ai_chat_admin_list() to authenticated;
