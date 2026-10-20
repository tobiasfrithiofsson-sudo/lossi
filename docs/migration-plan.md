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

## Add a tester (invite code, since 2026-10-19)
Give the tester the code or link from **Bjud in** (project switcher or the card at the bottom of the sidebar). They open `login.html?kod=…` (or Skapa konto on the login page), enter name, email and password, and land in that project with an account of their own. Existing users join with **Gå med med kod** in the project switcher. Sign-ups are open in Supabase but the database rejects any new account without a valid code (`lossi_require_invite_code` trigger on `auth.users`, `supabase/projects.sql` step 3) – this also blocks **Add user** in the Supabase dashboard. "Confirm email" must be off (Lossi can't send mail). A leaked code is replaced with `update public.projects set invite_code = null where name = '…';` (a new one is generated). Anyone can create a shared project with **Skapa projekt** in the project switcher (RPC `create_project`, step 3b); it gets its own code and the invite dialog opens right away. Forgotten password: `supabase/admin.sql`.

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

## Feedback (added 2026-10-18/19)
- Testers: Feedback button in the topbar (`feedback.js`) → table `feedback` (`supabase/feedback.sql`; run with the read key from the local-only `supabase/feedback.local.sql`).
- Tobias: `feedbackboard.html` ("Feedback från testare" in the user menu) lists all feedback with filters, status and notes. Admin = `app_metadata.role = 'admin'`, checked in the database (`supabase/feedback-admin.sql`, run 2026-10-19; after a role change, log out and in again).
- Claude: `scripts/feedback.sh` reads all feedback and sets status/notes with the secret read key in `.feedback-token` (gitignored).


## Projects (shared work, started 2026-10-19)
Tobias's model: a user can be in several projects. Everyone has a personal project ("Mina upplägg", secret plans); a school is a project with many members. The sidebar is personal (only my own plans and calendar events); the overview shows every member's plans in the current project, with a "Bara mina" filter. Others' plans open read-only; the creator can grant edit rights on request (editors change content, only the creator deletes or revokes). An invite code both creates the account and joins the project (all members can see and share it). Each teacher has their own calendar and may schedule colleagues' lessons. Simultaneous editing: a warning ("X is also editing") plus protection against silent overwrites, no live editing.

Steps:
1. **Database** – `supabase/projects.sql` (tested locally with PGlite and run by Tobias in the SQL Editor 2026-10-19). Tables `projects` (`personal_owner` set = someone's personal project, one per user, deleted with the account) and `project_members` (`role` owner/member). `plans.project_id` (not null, defaults to the logged-in user's personal project via `personal_project_id()`, so the app needs no change). Trigger on `auth.users` creates the personal project for new accounts. RLS: members read each other's plans, only the creator inserts/updates/deletes; projects and members are read-only for users (created by database functions). `is_project_member()` is security definer to avoid recursive policies. No visible change in the app.
2. **Projects in the app** (built 2026-10-19, member-profiles SQL run and tested live by Tobias with a shared project). `data.js`: `listPlans({ projectId, mine })` (rows now carry `ownerId`/`projectId`), `listMyPlans`, `loadPlanInfo`, `listProjects`/`currentProject`/`setCurrentProject` (chosen project in localStorage `lossi-project`, falls back to the personal one), `findMember`, `createPlan(state, projectId)`. Member names/avatars come from the RPC `project_member_profiles()` (end of `projects.sql`; without it names show as "Okänd"/"En kollega"). `theme.js`: project switcher at the top of the sidebar (`renderProjectSwitcher`, menu with all projects + "Gå med med kod" marked Snart); sidebar plans = my own in the chosen project; Skapa creates in the chosen project. `index.html`: plans in the chosen project with the creator's avatar, Alla/Bara mina toggle (hidden in the personal project, remembered in `lossi-owner-filter`). `upplag.html`: opening a plan switches to its project; someone else's plan opens in `body.read-mode` (banner with "Duplicera till mina upplägg", fields locked with `data-read-locked`, no sortables, nothing saved, calendar button hidden; CSS under "LÄSLÄGE"). Duplicates stay in the plan's project. Calendar: only own plans can be scheduled until the calendar SQL change. Mock (`scripts/mock-supabase.js`) has a shared project "Sandlådan" with colleague Kristoffer (u2) for local tests.
3. **Invite code** (built 2026-10-19, run and tested live by Tobias with 3b). SQL: `projects.invite_code` (8 chars from an alphabet without 0/O/1/I, stored without dash, shown as ABCD-1234; set by trigger for shared projects only), `invite_project_name(code)` (anon, shows the project on Skapa konto), `join_project(code)`, `require_invite_code` BEFORE INSERT trigger on `auth.users`, and the AFTER trigger adds new accounts to the code's project. `auth.js`: `inviteProjectName`, `signUpWithCode` (code + display_name in user metadata). `login.html`: Skapa konto card (code with live project name, name, email, password ≥ 8), `?kod=` pre-fills it. `theme.js`: invite dialog (code, link, members) and join dialog; the sidebar card is now live (invite in shared projects, join in the personal one). Supabase settings: Allow new users to sign up ON, Confirm email OFF – turn them on only after the SQL is run.
4. **Co-editors / medskapare** (built 2026-10-19, run and tested live by Tobias). SQL (`projects.sql` step 4): table `plan_editors` (plan_id, user_id, status requested|approved), RPCs `request_plan_edit`, `decide_plan_edit(pid, editor, approve)` (deny deletes the row), `remove_plan_editor` (owner, or yourself to withdraw), extra update policy for approved editors, trigger `lossi_keep_plan_owner` (only the owner can change owner_id/project_id; SQL Editor is exempt), rights dropped when someone leaves the project. `data.js`: `listPlanEditors`, `listMyEditRequests`, `requestPlanEdit`, `decidePlanEdit`, `removePlanEditor`. `upplag.html`: read banner has Be om redigeringsrätt / Ångra förfrågan; owner gets a banner per request with Neka/Godkänn; Personer shows Skapare + Medskapare (owner has × to remove, with confirm); approved editors edit normally with `body.is-coeditor` (delete plan and calendar button hidden). Overview row shows "1 vill redigera" and the sidebar a count badge on the owner's plans. Not built: notifications outside Lossi (email), "leave as co-editor" button for the editor.
4b. **Delete project** (built 2026-10-19, run and tested live by Tobias 2026-10-20). RPC `delete_project(pid)`: only the project's owner, never a personal project. Removes co-editor rights on its plans, moves every plan back to its creator's personal project (the owner/project lock trigger is bypassed with the transaction-local setting `lossi.moving_plans`), then deletes the project (members cascade). UI: "Ta bort {projekt}" in the project switcher for owners, confirm dialog `deleteProjectModal` in theme.js. Not built: "Lämna projekt" for members, transferring ownership.
5. "Someone else is editing" warning + overwrite check on save (`updated_at`).

Calendar change needed before step 2/4: `lesson_events` has `unique (plan_id, lesson_id)` and requires the plan to be your own; must become per user (`unique (owner_id, plan_id, lesson_id)`, plan readable instead of owned).

## Skapa med AI (added 2026-10-20)
Teachers build a plan with their own AI (Claude, ChatGPT …) and paste the result; Lossi never calls an AI.
- `ai-import.js`: `LOSSI_AI_PROMPT` (the rules a teacher copies to their AI: fields, activity types, Lgr22/GY25 samlad bedömning, no student names, answer with ONE ```json block when asked for "Lossi-inmatningen"), `parseLossiAi` (tolerant extraction of the JSON block, Swedish keys with English aliases, activity type aliases, limits on length/count, warnings for unknown types, gymnasium grades and lessons over time), `planStateFromAi` (builds the normal plan state), and the dialog `aiPlanModal` (copy prompt → paste → preview → Skapa upplägg in the current project). Entry: "Skapa med AI" card at the top of the Skapa dialog.
- Format version 1: `{ lossi, titel, amne, arskurs, beskrivning, centraltInnehall[], betygskriterier[], lektioner[{ namn, minuter, kod?, aktiviteter[{ typ, titel, minuter, beskrivning }] }] }`.
- `plan-markup.js`: shared markup for activities (`buildActivityMarkup`, `buildActivityReadFields`), goal rows (`buildGoalItemInnerHTML`, `GOAL_LISTS`) and whole lessons (`buildLessonGroupHTML`), moved out of upplag.html. Titles and descriptions are now escaped (they used to be interpolated raw); `buildActivityReadFields` still takes description HTML from the editor.
- Safety: pasted text is only ever data – no SQL is built from it, everything is escaped, and the plan is saved through `LossiData.createPlan` under the normal database rules.
- **Fyll i med AI** (part 2, same day): plan ⋯ menu (edit-only, so owner and co-editors). `buildFillPrompt(current)` adds the plan as it is now (`currentPlanForAi` in upplag.html: lessons with `kod` = `data-lesson-id`, minutes, calendar time, activities) and the rules: keep codes, new lessons without code go last, omitted lessons/fields stay untouched, nothing is deleted, a lesson's `aktiviteter` replace its current ones. `parseLossiAi(text, { fill: true })` makes every field optional. `aiFillPreviewHTML` lists what changes; `applyAiFillToPlan` updates in place (lesson ids, and so calendar links, are kept; unknown codes become new lessons; lists/activities are only replaced when the answer has items), then saves. Not built: deleting or reordering lessons via AI, undo.
