// Testar supabase/marketplace.sql i lokal Postgres (PGlite): vem får publicera,
// läsa, ändra och ta bort publicerade upplägg och deras filer.
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
  -- Låtsas-Storage (bara det reglerna behöver)
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, delete on storage.objects to authenticated;
`);
for (const f of ['schema.sql', 'calendar.sql', 'projects.sql', 'notifications.sql', 'feedback.sql', 'feedback-admin.sql', 'files.sql', 'marketplace.sql', 'marketplace.sql']) {
  try { await db.exec(sql(f)); } catch (e) { console.log('Kunde inte köra', f, e.message); process.exit(1); }
}

const ANNA = '00000000-0000-0000-0000-000000000001';
const BO = '00000000-0000-0000-0000-000000000002';
const ADMIN = '00000000-0000-0000-0000-0000000000aa';
await db.exec(`alter table auth.users disable trigger user;`);
await db.exec(`insert into auth.users (id, email) values ('${ANNA}', 'anna@x'), ('${BO}', 'bo@x'), ('${ADMIN}', 'admin@x')`);
await db.exec(`alter table auth.users enable trigger user;`);
const PA = (await db.query(`select public.ensure_personal_project($1) as id`, [ANNA])).rows[0].id;
await db.exec(`select public.ensure_personal_project('${BO}')`);
await db.exec(`alter table public.plans disable trigger user;`);
const plan = (await db.query(`insert into public.plans (owner_id, project_id, title, state) values ($1, $2, 'Annas', '{}') returning id`, [ANNA, PA])).rows[0].id;
await db.exec(`alter table public.plans enable trigger user;`);

async function as(uid, fn, admin = false) {
  const claims = JSON.stringify({ sub: uid, app_metadata: admin ? { role: 'admin' } : {} });
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false); select set_config('request.jwt.claims', '${claims}', false);`);
  try { return { rows: (await fn()).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`); }
}
const q = (text, params = []) => () => db.query(text, params);

// Publicera
const boSteals = await as(BO, q(`insert into public.market_plans (source_plan_id, title) values ($1, 'Stöld') returning id`, [plan]));
check('Bo kan inte publicera Annas upplägg', !!boSteals.error, JSON.stringify(boSteals));
const pub = await as(ANNA, q(`insert into public.market_plans (source_plan_id, title, author_name, subject, grade, state) values ($1, 'Annas', 'Anna Berg', 'Biologi', '7', '{"title":"Annas"}') returning id`, [plan]));
check('Anna publicerar sitt upplägg', !pub.error, JSON.stringify(pub));
const M = pub.rows?.[0]?.id;

// Filer
const up = await as(ANNA, q(`insert into storage.objects (bucket_id, name) values ('plan-files', $1)`, [`market/${M}/a.pdf`]));
check('Anna laddar upp en fil till sitt publicerade upplägg', !up.error, JSON.stringify(up));
const boUp = await as(BO, q(`insert into storage.objects (bucket_id, name) values ('plan-files', $1)`, [`market/${M}/b.pdf`]));
check('Bo kan inte lägga filer i Annas publicerade upplägg', !!boUp.error, JSON.stringify(boUp));
const row = await as(ANNA, q(`insert into public.market_files (market_id, activity_id, name, size, mime, path) values ($1, 'act1', 'a.pdf', 10, 'application/pdf', $2) returning id`, [M, `market/${M}/a.pdf`]));
check('Anna registrerar filen', !row.error, JSON.stringify(row));
const wrongPath = await as(ANNA, q(`insert into public.market_files (market_id, name, size, path) values ($1, 'x.pdf', 1, 'market/999/x.pdf')`, [M]));
check('Filens sökväg måste höra till det publicerade upplägget', !!wrongPath.error, JSON.stringify(wrongPath));

// Läsa
const boRead = await as(BO, q(`select title, author_name from public.market_plans`));
check('Bo ser det publicerade upplägget', boRead.rows?.length === 1 && boRead.rows[0].author_name === 'Anna Berg', JSON.stringify(boRead));
const boFiles = await as(BO, q(`select name from public.market_files where market_id = $1`, [M]));
check('Bo ser filerna', boFiles.rows?.length === 1, JSON.stringify(boFiles));
const boObj = await as(BO, q(`select name from storage.objects where name like 'market/%'`));
check('Bo får hämta filen ur hinken', boObj.rows?.length === 1, JSON.stringify(boObj));
await db.exec(`insert into storage.objects (bucket_id, name) values ('plan-files', '${plan}/privat.pdf')`);
const boPrivate = await as(BO, q(`select name from storage.objects where name = $1`, [`${plan}/privat.pdf`]));
check('Bo får fortfarande inte Annas privata filer', boPrivate.rows?.length === 0, JSON.stringify(boPrivate));

// Ändra, räkna, ta bort
const boUpdate = await as(BO, q(`update public.market_plans set title = 'Hack' where id = $1 returning id`, [M]));
check('Bo kan inte ändra Annas publicerade upplägg', !boUpdate.error && boUpdate.rows.length === 0, JSON.stringify(boUpdate));
const annaUpdate = await as(ANNA, q(`update public.market_plans set title = 'Annas 2', updated_at = now() where id = $1 returning id`, [M]));
check('Anna publicerar igen (ändrar)', annaUpdate.rows?.length === 1, JSON.stringify(annaUpdate));
const usesHack = await as(BO, q(`update public.market_plans set uses = 100 where id = $1`, [M]));
check('Ingen kan sätta antal användningar direkt', !!usesHack.error, JSON.stringify(usesHack));
await as(BO, q(`select public.count_market_use($1)`, [M]));
const uses = (await db.query(`select uses from public.market_plans where id = $1`, [M])).rows[0].uses;
check('Användningen räknas', uses === 1, uses);
const boDel = await as(BO, q(`delete from public.market_plans where id = $1 returning id`, [M]));
check('Bo kan inte ta bort Annas publicerade upplägg', !boDel.error && boDel.rows.length === 0, JSON.stringify(boDel));
const boDelObj = await as(BO, q(`delete from storage.objects where name = $1 returning id`, [`market/${M}/a.pdf`]));
check('Bo kan inte ta bort Annas publicerade filer', !boDelObj.error && boDelObj.rows.length === 0, JSON.stringify(boDelObj));
const adminDel = await as(ADMIN, q(`delete from public.market_plans where id = $1 returning id`, [M]), true);
check('Administratören kan ta bort ett publicerat upplägg', adminDel.rows?.length === 1, JSON.stringify(adminDel));
const filesLeft = (await db.query(`select count(*)::int as n from public.market_files`)).rows[0].n;
check('Filraderna försvinner med upplägget', filesLeft === 0, filesLeft);

// Tas källupplägget bort finns det publicerade kvar
const pub2 = await as(ANNA, q(`insert into public.market_plans (source_plan_id, title) values ($1, 'Igen') returning id`, [plan]));
await db.exec(`alter table public.plans disable trigger user; delete from public.plans where id = ${plan}; alter table public.plans enable trigger user;`);
const kept = (await db.query(`select source_plan_id from public.market_plans where id = $1`, [pub2.rows[0].id])).rows[0];
check('Det publicerade finns kvar när källan tas bort', kept && kept.source_plan_id === null, JSON.stringify(kept));

console.log(`${ok} ok, ${fail} fel`);
process.exit(fail ? 1 : 0);
