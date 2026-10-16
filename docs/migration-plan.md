# Lossi: backend + free hosting for test users

Working checklist. Start every session by reading this file, picking the next unchecked step, and checking it off when its "Done when" holds. Each step fits in one sitting and leaves the app working and committed.

## Progress
- [x] Step 0: Plan into repo
- [ ] Step 1: Git + GitHub
- [ ] Step 2: Deploy today's app to Cloudflare Pages
- [ ] Step 3: Introduce `data.js` (still localStorage)
- [ ] Step 4: Supabase project + table
- [ ] Step 5: Login (`auth.js`, magic link)
- [ ] Step 6: Switch `data.js` to Supabase
- [ ] Step 7: Keep-alive + invite testers

Steps 3 and 4 are independent and can be done in either order. Everything else runs in order.

## Decisions (2026-10-16)
- **Supabase** (Postgres) for database + auth, **Cloudflare Pages** for hosting. Both free for the test phase.
- **Supabase Auth** (magic link) for now. Better Auth (self-hosted on a Cloudflare Worker) was considered and deferred. All auth calls go through `auth.js`, so swapping it later touches one file.
- **Test first, rewrite later:** wire Supabase into today's vanilla app. A JS framework rewrite is expected before real production. `data.js`, `auth.js` and the DB schema stay framework-agnostic so they carry over.
- **Low lock-in:** Supabase is plain Postgres (`pg_dump` moves it anywhere). Pages never talk to Supabase directly, only through `data.js` / `auth.js`.

Why not the alternatives: Neon (needs our own API layer), PocketBase (no free always-on host), Appwrite (proprietary API shape), Firebase (proprietary NoSQL, high lock-in).

Free-tier catch: Supabase pauses projects after 7 days without traffic. Data is kept; step 7 adds a weekly ping.

## Persistence touch points (before step 3)
- `upplag.html` `saveState` / `loadState`: plan state under `lossi-plan-<id>`
- `theme.js` `getPlanIds` / `getPlanSummary`: registry `lossi-plans`
- `theme.js` avatar fallback: `lossi-plan-avatar-<id>`
- `theme.js` create-plan dialog: writes new plan + registry
- UI prefs (`lossi-theme`, `lossi-invite-dismissed`) stay in localStorage.

## Steps

### Step 0: Plan into repo
This file. *Done when:* committed together with step 1.

### Step 1: Git + GitHub (20–30 min)
First commit, `.gitignore` (.DS_Store, `Samhällsekonomi.pptx`, `.claude/settings.local.json`). Create a **private** GitHub repo and push.
*Done when:* the code is visible on GitHub.

### Step 2: Deploy today's app to Cloudflare Pages (30 min)
Cloudflare dashboard → Workers & Pages → Create → Pages → connect the GitHub repo. No framework, no build command, output directory `/`. Still localStorage-only.
*Done when:* a public `*.pages.dev` URL shows Lossi, and a push to GitHub redeploys it.

### Step 3: Introduce `data.js`, still localStorage (1 session)
Pure refactor: `listPlans`, `loadPlan`, `savePlan`, `createPlan`, `getPlanAvatar` / `setPlanAvatar`, all async. Replace the touch points above. No visible change.
*Done when:* create / edit / reorder / reload / Word + PowerPoint export work exactly as before, locally and on Pages.

### Step 4: Supabase project + table (30–45 min)
Create the account and project (EU region). Run the SQL for table `plans` (`id`, `owner_id`, `title`, `state jsonb`, `avatar`, `created_at`, `updated_at`) with Row Level Security (owner only). Put the project URL + anon key in `config.js`. The anon key is meant to be public; RLS provides the security.
*Done when:* the table is visible in the Supabase table editor, with RLS enabled.

### Step 5: Login (1 session, needs 3 + 4)
`auth.js` (`signIn`, `signOut`, `getUser`, `requireUser`), `login.html` with email magic link, redirect when logged out, log out in the user menu (app shell in `theme.js`). Add localhost + the Pages URL as redirect URLs in Supabase. Data still in localStorage.
*Done when:* you can log in and out by magic link both locally and on Pages.

### Step 6: Switch `data.js` to Supabase (1 session, needs 5)
Swap the localStorage implementation for Supabase queries, with debounced autosave and seeded demo plans (`DEMO_PLANS`) for new users.
*Done when:* a plan made on one device shows up on another, a second user (private window) can't see it, and rows appear in the table editor.

### Step 7: Keep-alive + invite testers (30 min)
GitHub Action that pings Supabase weekly. Short tester note. Test the exit path: `pg_dump` works.
*Done when:* Kristoffer logs in on the live URL and creates a plan.

## Verification
Run locally via the `lossi-static` preview (`.claude/launch.json`, port 8765), then re-check on the Pages URL after each push. Re-test Word/PowerPoint export in steps 3 and 6.
