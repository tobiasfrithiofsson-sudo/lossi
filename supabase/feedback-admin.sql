-- Lossi: feedbacksidan för administratörer (feedbackboard.html)
-- Körs en gång i Supabase → SQL Editor, efter feedback.sql. Kan köras om.
--
-- Administratör = användare med app_metadata.role = 'admin'. app_metadata kan
-- bara ändras i databasen (inte från appen), så testare kan inte göra sig själva
-- till administratörer. Rollen följer med i inloggningen: logga ut och in igen
-- efter att ha kört filen.

-- ── Är den inloggade en administratör? ──
create or replace function public.is_lossi_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- ── All feedback, med namn och e-post på den som skickade ──
create or replace function public.feedback_admin_list()
returns table (
  id bigint, created_at timestamptz, kind text, status text, note text,
  author text, email text, page text, message text, context jsonb
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
    select f.id, f.created_at, f.kind, f.status, f.note,
           coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), u.email)::text,
           u.email::text, f.page, f.message, f.context
    from public.feedback f
    left join auth.users u on u.id = f.owner_id
    order by f.created_at desc;
end;
$$;

-- ── Ändra status och anteckning ──
create or replace function public.feedback_admin_update(p_id bigint, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_lossi_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.feedback
  set status = p_status, note = nullif(p_note, '')
  where id = p_id;
end;
$$;

revoke all on function public.is_lossi_admin() from public;
revoke all on function public.feedback_admin_list() from public;
revoke all on function public.feedback_admin_update(bigint, text, text) from public;
grant execute on function public.is_lossi_admin() to authenticated;
grant execute on function public.feedback_admin_list() to authenticated;
grant execute on function public.feedback_admin_update(bigint, text, text) to authenticated;

-- ── Gör Tobias till administratör ──
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
where email = 'tobias.frithiofsson@gmail.com';
