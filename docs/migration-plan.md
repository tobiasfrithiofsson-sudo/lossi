# Lossi: backend + free hosting for test users

Working checklist. Start every session by reading this file, picking the next unchecked step, and checking it off when its "Done when" holds. Each step fits in one sitting and leaves the app working and committed.

## Progress
- [x] Step 0: Plan into repo
- [x] Step 1: Git + GitHub (private repo `tobiasfrithiofsson-sudo/lossi`)
- [x] Step 2: Deploy today's app to Cloudflare (live: https://lossi.tobias-frithiofsson.workers.dev/)
- [x] Step 3: Introduce `data.js` (still localStorage)
- [x] Step 4: Supabase project + table (project `lossi`, ref `mqzmtndjfgeujaqzqpeb`)
- [x] Step 5: Login (`auth.js`; email + password since 2026-10-16)
- [x] Step 6: Switch `data.js` to Supabase
- [ ] Step 7: Keep-alive + invite testers

Steps 3 and 4 are independent and can be done in either order. Everything else runs in order.

## Decisions (2026-10-16)
- **Supabase** (Postgres) for database + auth, **Cloudflare Workers (static assets)** for hosting. Both free for the test phase.
- **Supabase Auth** (email + password; magic link was tried first, see step 5) for now. Better Auth (self-hosted on a Cloudflare Worker) was considered and deferred. All auth calls go through `auth.js`, so swapping it later touches one file.
- **Test first, rewrite later:** wire Supabase into today's vanilla app. A JS framework rewrite is expected before real production. `data.js`, `auth.js` and the DB schema stay framework-agnostic so they carry over.
- **Low lock-in:** Supabase is plain Postgres (`pg_dump` moves it anywhere). The app pages never talk to Supabase directly, only through `data.js` / `auth.js`.

Why not the alternatives: Neon (needs our own API layer), PocketBase (no free always-on host), Appwrite (proprietary API shape), Firebase (proprietary NoSQL, high lock-in).

Free-tier catch: Supabase pauses projects after 7 days without traffic. Data is kept; step 7 adds a weekly ping.

## Persistence (after step 3)
All plan data goes through `LossiData` in `data.js`: `listPlans()` → `[{ id, state }]` oldest first, `loadPlan(id)`, `savePlan(id, state)`, `createPlan(state)` → id. All async. Step 6 only rewrites the inside of `data.js`.
- `upplag.html`: `boot()` at the end of the script loads the plan, then runs `applyState`, `recalcLessonTimes` and `initAllSortables`. `saveState()` does nothing until `planLoaded` is true, so demo content can't overwrite a plan that is still loading.
- `theme.js`: `getPlanSummaries()` is async. The aside plan list is filled afterwards by `renderAsidePlans()`. `createPlan()` is async.
- Stays in localStorage on purpose (UI/browser-local, not plan data): `lossi-theme`, `lossi-invite-dismissed`, and the random fallback avatar `lossi-plan-avatar-<id>` (only used when a plan has no saved avatar; in step 6, seed demo plans with an avatar so it's rarely needed). `clearSiteCache` still wipes local `lossi-*` keys, which is fine: in step 6 that's only a local cache.
- **Step 6 watch-out:** `saveState` also runs on `beforeunload`. A network save may not finish when the page closes, so use debounced autosave while editing (and/or `fetch` with `keepalive`).

## Add a tester (closed registration, decided 2026-10-16)
1. Supabase → Authentication → Users → **Add user** → **Create new user**.
2. Email + a password you make up, tick **Auto Confirm User**, **Create user**.
3. Send the email + password to the tester (preferably by SMS) and ask them to change it under "Byt lösenord" in the user menu.
The tester gets the demo plans automatically on first login. Forgotten password: "Reset password" on the user in Supabase (mail only reaches Supabase team members), or `supabase/admin.sql`. Registration stays closed during the test phase because Lossi can't send mail yet (no address check, no self-service reset). Option for later: "Skapa konto" with an invite code.

## Steps

### Step 0: Plan into repo
This file. *Done when:* committed together with step 1.

### Step 1: Git + GitHub (20–30 min)
First commit, `.gitignore` (.DS_Store, `Samhällsekonomi.pptx`, `.claude/settings.local.json`). Create a **private** GitHub repo and push.
*Done when:* the code is visible on GitHub.

### Step 2: Deploy today's app to Cloudflare (30 min)
Deployed through Cloudflare's combined Workers & Pages wizard as a Worker serving static assets, connected to the GitHub repo (a push to `main` redeploys). No build step. `.assetsignore` keeps repo-only files (`docs/`, `.claude/` etc.) off the live site. Still localStorage-only.
*Done when:* a public URL shows Lossi, and a push to GitHub redeploys it.

### Step 3: Introduce `data.js`, still localStorage (1 session)
Pure refactor: `listPlans`, `loadPlan`, `savePlan`, `createPlan`, `getPlanAvatar` / `setPlanAvatar`, all async. Replace the touch points above. No visible change.
*Done when:* create / edit / reorder / reload / Word + PowerPoint export work exactly as before, locally and on the live site.

### Step 4: Supabase project + table (30–45 min)
Create the account and project (EU region). Run the SQL for table `plans` (`id`, `owner_id`, `title`, `state jsonb`, `avatar`, `created_at`, `updated_at`) with Row Level Security (owner only). Put the project URL + anon key in `config.js`. The anon key is meant to be public; RLS provides the security.
*Done when:* the table is visible in the Supabase table editor, with RLS enabled.

Done 2026-10-16. Schema is in `supabase/schema.sql` (safe to re-run). `config.js` holds the project URL + publishable key (`LOSSI_CONFIG`); no page loads it yet (step 5 does). Checked from outside: logged-out reads and inserts get "permission denied", and the auth endpoint answers. The policies for logged-in users get their real test in step 6 (two users). Table columns: `id` (bigint identity, used in `?id=`), `owner_id` (defaults to the logged-in user), `title`, `avatar`, `state` (jsonb), `created_at`, `updated_at` (trigger). The database password is in Tobias's password manager (needed for `pg_dump` in step 7).

### Step 5: Login (1 session, needs 3 + 4)
`auth.js` (`signIn`, `signOut`, `getUser`, `requireUser`), `login.html` with email magic link, redirect when logged out, log out in the user menu (app shell in `theme.js`). Add localhost + the live URL as redirect URLs in Supabase. Data still in localStorage.
*Done when:* you can log in and out by magic link both locally and on the live site.

Done 2026-10-16. `login.html` + `login.css` (landing-page style, dark mode, mobile), `auth.js` (`LossiAuth`; supabase-js 2.45.4 from jsdelivr). Protected pages have `class="auth-pending" data-auth-required` on `<html>` and call `LossiAuth.requireUser()` first. An expired link's `#error=…` is carried along to the login page. Supabase → Authentication → URL Configuration: Site URL `https://lossi.tobias-frithiofsson.workers.dev`, Redirect URLs `https://lossi.tobias-frithiofsson.workers.dev/**` and `http://localhost:8765/**`. Lesson learned: if a link leads to `localhost:3000`, the Site URL/redirect list wasn't saved when the mail was sent; old mails keep the wrong address, so request a new link.

**Changed 2026-10-16: email + password instead of magic link.** Supabase's built-in email only sends to Supabase team members and only a couple of mails per hour, so testers couldn't log in, and Tobias got locked out after logging out. Now no email is sent at all: Tobias creates accounts in Supabase (Authentication → Users → Add user → Create new user, tick "Auto Confirm User") and gives the tester the password. Testers can change it under "Byt lösenord" in the user menu. `supabase/admin.sql` sets a new password for a user (forgotten password, or accounts first created by magic link). Recommended Supabase setting: turn off "Allow new users to sign up", so only accounts Tobias creates exist. Magic link can come back once Lossi has its own email (needs a domain; Brevo suggested for EU data).

### Step 6: Switch `data.js` to Supabase (1 session, needs 5)
Swap the localStorage implementation for Supabase queries, with debounced autosave and seeded demo plans (`DEMO_PLANS`) for new users.
Also (decided 2026-10-16):
- Remove "Rensa sparad data" from the user menu (`clearSiteCache` in `theme.js`). After this step it would only clear local settings, and the name would mislead testers.
- Add `supabase/reset.sql` with ready-to-run lines: delete one user's plans by email (keeps the account), and delete all plans. Users with no plans get the demo plans again at next login, so deleting rows = "start over with demo".
- Admin path for now is the Supabase dashboard: Authentication → Users → Delete user also removes their plans (`on delete cascade`). An in-app admin page needs a server-side secret key and waits for the framework rewrite.
*Done when:* a plan made on one device shows up on another, a second user (private window) can't see it, and rows appear in the table editor.

Done 2026-10-16, tested by Tobias with two accounts: plans persist, sync across devices, and the second user can't see the first user's plans. Logic (seeding once, debounced saves, skip-unchanged, keepalive on leave) was also checked against a mock database.

### Step 7: Keep-alive + invite testers (30–60 min)
- **Create tester accounts** in Supabase (see step 5) and send each tester their email + password yourself. No email service is needed for this.
- *Later, not required now:* own email via SMTP (needs a domain; Brevo for EU data or Resend), which would allow magic links and password-reset mails.
- [x] Keep-alive: `.github/workflows/keep-supabase-awake.yml` queries the database every third day (06:17 UTC) with the public key; a logged-out query is refused by RLS (HTTP 401) but still counts as traffic. A failed run (e.g. project already paused) makes GitHub email Tobias. Can also be run by hand: GitHub → Actions → "Håll Supabase vaket" → Run workflow. Note: GitHub turns off scheduled workflows after 60 days without commits in the repo (it emails a warning first).
- Short tester note. Test the exit path: `pg_dump` works.
*Done when:* Kristoffer logs in on the live URL and creates a plan.

## Verification
Run locally via the `lossi-static` preview (`.claude/launch.json`, port 8765), then re-check on the live URL after each push. Re-test Word/PowerPoint export in steps 3 and 6.

## Calendar (added 2026-10-18)
Lessons can be put on a time slot. Table `lesson_events` (`supabase/calendar.sql`, run once in the SQL Editor after `schema.sql`; done 2026-10-18, verified by Tobias): one row per lesson (`plan_id` + `lesson_id`, unique), `starts_at`, `duration_min`, owner-only RLS that also checks the plan belongs to the user; deleted with its plan. Lessons have a fixed `data-lesson-id` in the plan's HTML (assigned when a plan is opened or a lesson is scheduled from the calendar).
- `schedule.js`: shared schedule dialog, Swedish date formatting, `resolveEvents` (events + plans → lesson name/plan title; the lesson's own length wins over the stored one), sidebar "Kommande händelser".
- `upplag.html`: calendar button on each lesson row (shows day + time when scheduled).
- `calendar.html` + `calendar.css`: week view Mon–Fri (Helg button adds the weekend; on weekends with Helg off it opens next week), click a free slot to add a lesson, click a lesson for Öppna upplägg / Ändra tid / Ta bort. One day at a time on mobile.
- `index.html`: Kommande shows the next three scheduled lessons, or a pointer to the calendar.
- Not built: recurring lessons, drag to move in the calendar, sync with external calendars (Google/Outlook).

