// Testar supabase/calendar-shared.sql i lokal Postgres (PGlite) med Supabase-liknande auth och roller.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const ROOT = process.argv[2];
const db = new PGlite();
const sql = f => readFileSync(`${ROOT}/supabase/${f}`, 'utf8');
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) ok++; else { fail++; console.log('FEL:', name, extra); } };

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  grant usage on schema auth to authenticated, anon;
  grant usage on schema public to authenticated, anon;
`);
for (const f of ['schema.sql', 'projects.sql', 'calendar.sql', 'calendar-shared.sql']) {
  try { await db.exec(sql(f)); } catch (e) { console.log('Kunde inte köra', f, e.message); process.exit(1); }
}
// Kör om: ska inte gå sönder
await db.exec(sql('calendar-shared.sql'));

const U1 = '00000000-0000-0000-0000-000000000001'; // Lina
const U2 = '00000000-0000-0000-0000-000000000002'; // Kristoffer, med i samma projekt
const U3 = '00000000-0000-0000-0000-000000000003'; // Utomstående
await db.exec(`
  alter table auth.users disable trigger all;
  insert into auth.users (id, email) values ('${U1}', 'lina@x'), ('${U2}', 'kristoffer@x'), ('${U3}', 'ute@x');
`);
// Projekt och medlemmar som superuser
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'projects'`)).rows.map(r => r.column_name);
const pr = await db.query(`insert into public.projects (name) values ('Skolan'), ('Utes') returning id`);
const [P1, P2] = pr.rows.map(r => r.id);
await db.exec(`
  insert into public.project_members (project_id, user_id, role) values
    (${P1}, '${U1}', 'owner'), (${P1}, '${U2}', 'member'), (${P2}, '${U3}', 'owner');
  alter table public.plans disable trigger all;
  insert into public.plans (owner_id, project_id, title) values ('${U1}', ${P1}, 'Linas'), ('${U2}', ${P1}, 'Kristoffers'), ('${U3}', ${P2}, 'Utes');
  alter table public.plans enable trigger all;
`);
const plan = async title => (await db.query(`select id from public.plans where title = $1`, [title])).rows[0].id;
const [L, K, X] = [await plan('Linas'), await plan('Kristoffers'), await plan('Utes')];

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const tryQ = async (q, p) => { try { return { rows: (await db.query(q, p)).rows }; } catch (e) { return { error: e.message }; } };

// Varje lärare lägger in sin egen lektion
await as(U1, () => db.query(`insert into public.lesson_events (plan_id, lesson_id, starts_at) values ($1, 'l1', now())`, [L]));
await as(U2, () => db.query(`insert into public.lesson_events (plan_id, lesson_id, starts_at) values ($1, 'l1', now())`, [K]));
await as(U3, () => db.query(`insert into public.lesson_events (plan_id, lesson_id, starts_at) values ($1, 'l1', now())`, [X]));

const seen = async uid => (await as(uid, () => db.query(`select plan_id from public.lesson_events order by plan_id`))).rows.map(r => r.plan_id);
const s1 = await seen(U1), s2 = await seen(U2), s3 = await seen(U3);
check('Lina ser sin och Kristoffers', JSON.stringify(s1) === JSON.stringify([L, K]), JSON.stringify(s1));
check('Kristoffer ser sin och Linas', JSON.stringify(s2) === JSON.stringify([L, K]), JSON.stringify(s2));
check('Utomstående ser bara sin', JSON.stringify(s3) === JSON.stringify([X]), JSON.stringify(s3));

// Ändra/ta bort andras: ska inte påverka något
const upd = await as(U1, () => tryQ(`update public.lesson_events set duration_min = 30 where plan_id = $1 returning id`, [K]));
check('Lina kan inte flytta Kristoffers lektion', !upd.error && upd.rows.length === 0, JSON.stringify(upd));
const del = await as(U1, () => tryQ(`delete from public.lesson_events where plan_id = $1 returning id`, [K]));
check('Lina kan inte ta bort Kristoffers lektion', !del.error && del.rows.length === 0, JSON.stringify(del));
const ins = await as(U1, () => tryQ(`insert into public.lesson_events (plan_id, lesson_id, starts_at) values ($1, 'l2', now())`, [K]));
check('Lina kan inte lägga in på Kristoffers upplägg', !!ins.error, JSON.stringify(ins));
const own = await as(U1, () => tryQ(`update public.lesson_events set duration_min = 45 where plan_id = $1 returning id`, [L]));
check('Lina kan flytta sin egen', !own.error && own.rows.length === 1, JSON.stringify(own));

// Lämnar Kristoffer projektet ser han inte längre Linas (och tvärtom)
await db.exec(`delete from public.project_members where project_id = ${P1} and user_id = '${U2}'`);
const s2b = await seen(U2);
check('Efter att ha lämnat ser Kristoffer inte Linas', !s2b.includes(L), JSON.stringify(s2b));

// Utloggad ser inget
const anon = await (async () => { await db.exec('set role anon'); try { return await tryQ('select * from public.lesson_events'); } finally { await db.exec('reset role'); } })();
check('Utloggad ser inget', !!anon.error || anon.rows.length === 0, JSON.stringify(anon));

console.log(`${ok} ok, ${fail} fel`);
process.exit(fail ? 1 : 0);
