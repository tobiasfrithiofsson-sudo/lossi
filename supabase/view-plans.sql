-- Lossi: läs uppläggens texter
-- Kör i Supabase → SQL Editor. Ändrar ingenting, visar bara.
-- Texterna sparas som HTML (sidans kod); här tas koden bort så att de går att läsa.
-- Demo-upplägg som aldrig redigerats har bara en titel.

select
  coalesce(u.raw_user_meta_data->>'display_name', u.email) as larare,
  p.id,
  p.title as titel,
  p.state->>'subject' as amne,
  p.state->>'grade' as arskurs,
  trim(regexp_replace(regexp_replace(coalesce(p.state->>'description', ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')) as pedagogisk_ide,
  trim(regexp_replace(regexp_replace(coalesce(p.state->>'goalsHTML', ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')) as centralt_innehall,
  trim(regexp_replace(regexp_replace(coalesce(p.state->>'criteriaHTML', ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')) as betygskriterier,
  trim(regexp_replace(regexp_replace(coalesce(p.state->>'structureHTML', ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')) as lektioner_och_aktiviteter,
  p.updated_at as senast_andrad
from public.plans p
join auth.users u on u.id = p.owner_id
order by larare, p.id;
