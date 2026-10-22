-- Lossi: projektets kalender (feedback #9, 2026-10-22)
-- Körs en gång i Supabase → SQL Editor, efter calendar.sql och projects.sql.
-- Kan köras om utan att något går sönder.
--
-- Medlemmar i ett projekt får se varandras inlagda lektioner (lesson_events)
-- för upplägg i projektet, så att man kan se hur mycket en klass har en viss
-- vecka. Att lägga in, flytta och ta bort gäller fortfarande bara egna
-- händelser (policyerna i calendar.sql är orörda). Policyer för samma
-- åtgärd gäller med "eller": egna händelser + händelser i ens projekt.

drop policy if exists "Projektets händelser: läsa" on public.lesson_events;
create policy "Projektets händelser: läsa" on public.lesson_events
  for select to authenticated
  using (
    exists (
      select 1 from public.plans p
      where p.id = plan_id and public.is_project_member(p.project_id)
    )
  );

-- (Uppslag per upplägg går redan snabbt: unique (plan_id, lesson_id) är ett index.)
