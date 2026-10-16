-- Lossi: administrera testkonton
-- Kör i Supabase → SQL Editor. Nya konton skapas enklast i panelen:
-- Authentication → Users → Add user → Create new user (e-post + lösenord,
-- bocka i "Auto Confirm User"). Inga mail skickas.


-- ── Sätt ett nytt lösenord för en användare ──
-- T.ex. om någon glömt sitt, eller för konton som skapades med e-postlänk.
-- Byt ut lösenordet och e-postadressen och kör.
update auth.users
set encrypted_password = extensions.crypt('NyttLösenord123', extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now())
where email = 'namn@skola.se';


-- ── Lista alla konton ──
-- select email, created_at, last_sign_in_at from auth.users order by created_at;
