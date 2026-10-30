-- ── AI-förslag: en rad per anrop till Claude (supabase/functions/plan-chat) ──
-- Används för gränsen per lärare och dygn och för att se vad AI:n kostar.
-- Bara serverfunktionen (service role) läser och skriver: RLS är på och det
-- finns inga regler, så ingen inloggad användare kommer åt tabellen.
create table if not exists public.ai_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

create index if not exists ai_requests_user_created on public.ai_requests (user_id, created_at desc);

alter table public.ai_requests enable row level security;
