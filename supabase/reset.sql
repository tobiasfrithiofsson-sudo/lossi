-- Lossi: börja om med uppläggen
-- Kör EN av delarna nedan i Supabase → SQL Editor. Det går inte att ångra
-- (gratisplanen har ingen återställning), så exportera först om datan är viktig.
--
-- Den som saknar upplägg får demo-uppläggen igen vid nästa inloggning.
-- Kontona finns kvar. Vill du ta bort ett konto helt: Authentication → Users →
-- Delete user (dess upplägg raderas då automatiskt).


-- ── 1. Rensa EN användares upplägg ──
-- Byt ut e-postadressen och kör.
delete from public.plans
where owner_id = (select id from auth.users where email = 'namn@skola.se');


-- ── 2. Rensa ALLA användares upplägg ──
-- Ta bort de två strecken framför raden nedan och kör.
-- delete from public.plans;


-- ── Kolla läget: antal upplägg per användare ──
-- select u.email, count(p.id) as upplagg
-- from auth.users u left join public.plans p on p.owner_id = u.id
-- group by u.email order by u.email;
