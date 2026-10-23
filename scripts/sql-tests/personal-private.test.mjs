// Testar supabase/personal-private.sql i lokal Postgres (PGlite): den egna
// ytan kan inte delas, och gamla medlemmar/inbjudningar städas bort.
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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  grant usage on schema auth to authenticated, anon;
  grant usage on schema public to authenticated, anon;
`);
for (const f of ['schema.sql', 'calendar.sql', 'projects.sql', 'notifications.sql']) {
  try { await db.exec(sql(f)); } catch (e) { console.log('Kunde inte köra', f, e.message); process.exit(1); }
}

const ANNA = '00000000-0000-0000-0000-000000000001';
const BO = '00000000-0000-0000-0000-000000000002';
const CIA = '00000000-0000-0000-0000-000000000003';
await db.exec(`alter table auth.users disable trigger user;`);
await db.exec(`insert into auth.users (id, email) values ('${ANNA}', 'anna@x'), ('${BO}', 'bo@x'), ('${CIA}', 'cia@x')`);
await db.exec(`alter table auth.users enable trigger user;`);
const personal = async uid => (await db.query(`select public.ensure_personal_project($1) as id`, [uid])).rows[0].id;
const PA = await personal(ANNA), PB = await personal(BO), PC = await personal(CIA);

// Läget före: Bo är redan med i Annas yta och har ett upplägg där; Cia har en obesvarad inbjudan
await db.exec(`
  insert into public.project_members (project_id, user_id, role) values (${PA}, '${BO}', 'member');
  alter table public.plans disable trigger user;
  insert into public.plans (owner_id, project_id, title, state) values
    ('${ANNA}', ${PA}, 'Annas', '{}'), ('${BO}', ${PA}, 'Bos i Annas yta', '{}');
  alter table public.plans enable trigger user;
  insert into public.project_invites (project_id, email, invited_by) values (${PA}, 'cia@x', '${ANNA}');
`);

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return { rows: (await fn()).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

// Kör filen två gånger (ska gå att köra om)
for (let i = 0; i < 2; i++) {
  try { await db.exec(sql('personal-private.sql')); } catch (e) { console.log('Kunde inte köra personal-private.sql', e.message); process.exit(1); }
}

const members = async pid => (await db.query(`select user_id from public.project_members where project_id = $1 order by user_id`, [pid])).rows.map(r => r.user_id);
check('Bo är borttagen ur Annas yta', JSON.stringify(await members(PA)) === JSON.stringify([ANNA]), JSON.stringify(await members(PA)));
const bosPlan = (await db.query(`select project_id from public.plans where title = 'Bos i Annas yta'`)).rows[0].project_id;
check('Bos upplägg flyttat till Bos yta', String(bosPlan) === String(PB), `${bosPlan} vs ${PB}`);
const annasPlan = (await db.query(`select project_id from public.plans where title = 'Annas'`)).rows[0].project_id;
check('Annas upplägg ligger kvar', String(annasPlan) === String(PA));
const pending = (await db.query(`select count(*)::int as n from public.project_invites where project_id = $1`, [PA])).rows[0].n;
check('Obesvarad inbjudan till Annas yta borttagen', pending === 0, pending);

// Spärrarna
const inv = await as(ANNA, () => db.query(`select public.invite_by_email($1, 'cia@x') as r`, [PA]));
check('Anna kan inte bjuda in till sin yta', !!inv.error && /egen yta/.test(inv.error), JSON.stringify(inv));
let direct = null;
try { await db.query(`insert into public.project_members (project_id, user_id, role) values ($1, $2, 'member')`, [PA, CIA]); } catch (e) { direct = e.message; }
check('Ingen kan läggas till som medlem i någon annans yta', !!direct, direct);

// Delade projekt fungerar som vanligt
const sp = await as(ANNA, () => db.query(`select public.create_project('Skolan') as id`));
check('Anna kan skapa ett delat projekt', !sp.error, JSON.stringify(sp));
const SP = sp.rows?.[0]?.id;
const inv2 = await as(ANNA, () => db.query(`select public.invite_by_email($1, 'cia@x') as r`, [SP]));
check('Inbjudan till delat projekt fungerar', !inv2.error && inv2.rows[0].r === 'sent', JSON.stringify(inv2));
const invId = (await db.query(`select id from public.project_invites where project_id = $1 and status = 'pending'`, [SP])).rows[0]?.id;
const ans = await as(CIA, () => db.query(`select public.answer_invite($1, true) as r`, [invId]));
check('Cia kan gå med i det delade projektet', !ans.error && JSON.stringify(await members(SP)).includes(CIA), JSON.stringify(ans));
check('Nya konton får fortfarande sin egen yta', String(await personal(CIA)) === String(PC));

console.log(`${ok} ok, ${fail} fel`);
process.exit(fail ? 1 : 0);
