// Testar supabase/access-codes.sql i lokal Postgres (PGlite).
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
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to authenticated, anon;
  grant usage on schema public to authenticated, anon;
`);
for (const f of ['schema.sql', 'calendar.sql', 'projects.sql', 'notifications.sql', 'feedback.sql', 'feedback-admin.sql', 'access-codes.sql', 'access-codes.sql']) {
  try { await db.exec(sql(f)); } catch (e) { console.log('Kunde inte köra', f, e.message); process.exit(1); }
}

const ADMIN = '00000000-0000-0000-0000-0000000000aa';
await db.exec(`alter table auth.users disable trigger user;`);
await db.exec(`insert into auth.users (id, email, raw_app_meta_data) values ('${ADMIN}', 'admin@x', '{"role":"admin"}')`);
await db.exec(`alter table auth.users enable trigger user;`);

async function as(uid, admin, fn) {
  const claims = JSON.stringify({ sub: uid, app_metadata: admin ? { role: 'admin' } : {} });
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false); select set_config('request.jwt.claims', '${claims}', false);`);
  try { return { rows: (await fn()).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`); }
}
const asAnon = async fn => { await db.exec('set role anon'); try { return { rows: (await fn()).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } };
const signUp = async (email, meta) => { try { const r = await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify(meta)]); return { id: r.rows[0].id }; } catch (e) { return { error: e.message }; } };

// Administratören skapar koder
const c1 = await as(ADMIN, true, () => db.query(`select public.admin_create_access_code(null) as code`));
check('Admin skapar kod', !c1.error && /^[A-HJ-KMNP-Z2-9]{6}$/.test(c1.rows[0].code), JSON.stringify(c1));
const CODE = c1.rows[0].code;
const c2 = await as(ADMIN, true, () => db.query(`select public.admin_create_access_code(now() - interval '1 day') as code`));
const EXPIRED = c2.rows[0].code;
const notAdmin = await as(ADMIN, false, () => db.query(`select public.admin_create_access_code(null)`));
check('Vanlig användare kan inte skapa kod', !!notAdmin.error, JSON.stringify(notAdmin));

// Utloggad kontrollerar koden (steg 1)
const chk = async code => (await asAnon(() => db.query(`select public.check_access_code($1) as ok`, [code]))).rows?.[0]?.ok;
check('Giltig kod godkänns (oavsett format)', await chk(CODE.toLowerCase().slice(0, 3) + '-' + CODE.slice(3)) === true);
check('Utgången kod nekas', await chk(EXPIRED) === false);
check('Påhittad kod nekas', await chk('ZZZZZZ') === false);
const anonList = await asAnon(() => db.query(`select * from public.access_codes`));
check('Utloggad kan inte läsa koderna', !!anonList.error || anonList.rows.length === 0, JSON.stringify(anonList));

// Konton
const a = await signUp('anna@x', { access_code: CODE, first_name: 'Anna', display_name: 'Anna Berg' });
check('Konto med giltig kod skapas', !!a.id, JSON.stringify(a));
const space = (await db.query(`select p.name from public.projects p where p.personal_owner = $1`, [a.id])).rows[0]?.name;
check('Annas första projekt heter "Annas yta"', space === 'Annas yta', space);
const j = await signUp('johannes@x', { access_code: CODE, first_name: 'Johannes' });
const jspace = (await db.query(`select p.name from public.projects p where p.personal_owner = $1`, [j.id])).rows[0]?.name;
check('Johannes → "Johannes yta"', jspace === 'Johannes yta', jspace);
const bad = await signUp('ute@x', { access_code: 'ZZZZZZ', first_name: 'Ute' });
check('Konto med fel kod nekas', !!bad.error, JSON.stringify(bad));
const exp = await signUp('sen@x', { access_code: EXPIRED, first_name: 'Sen' });
check('Konto med utgången kod nekas', !!exp.error, JSON.stringify(exp));
const none = await signUp('ingen@x', { first_name: 'Ingen' });
check('Konto utan kod och utan inbjudan nekas', !!none.error, JSON.stringify(none));

// Projektets gamla kod gäller inte längre
const projectCode = (await db.query(`select invite_code from public.projects where invite_code is not null limit 1`)).rows[0]?.invite_code;
if (projectCode) {
  const old = await signUp('gammal@x', { access_code: projectCode, invite_code: projectCode, first_name: 'Gammal' });
  check('Projektets gamla kod räcker inte för konto', !!old.error, JSON.stringify(old));
  const join = await as(a.id, false, () => db.query(`select public.join_project($1)`, [projectCode]));
  check('Gå med med projektkod fungerar inte längre', !!join.error, JSON.stringify(join));
}

// Inbjudan via e-post räcker (utan kod)
const annasProject = (await db.query(`select id from public.projects where personal_owner = $1`, [a.id])).rows[0].id;
await as(a.id, false, () => db.query(`select public.invite_by_email($1, 'kollega@x')`, [annasProject]));
const noCode = await signUp('kollega@x', { first_name: 'Kim' });
check('Inbjuden e-post utan kod nekas', !!noCode.error, JSON.stringify(noCode));
const inv = await signUp('kollega@x', { access_code: CODE, first_name: 'Kim' });
check('Inbjuden e-post med kod får konto', !!inv.id, JSON.stringify(inv));
const kimInvites = await as(inv.id, false, () => db.query(`select kind from public.notifications`));
check('Den inbjudna får inbjudan som notis', !kimInvites.error && kimInvites.rows.some(r => r.kind === 'project_invite'), JSON.stringify(kimInvites));

// Admin ser vilka som använt koden; avsluta och öppna igen
const list = await as(ADMIN, true, () => db.query(`select code, active, users from public.admin_list_access_codes()`));
const row = list.rows?.find(r => r.code === CODE);
check('Admin ser användarna för koden', row && row.users.length === 3 && row.users.some(u => u.email === 'anna@x'), JSON.stringify(row));
check('Utgången kod visas som inaktiv', list.rows?.find(r => r.code === EXPIRED)?.active === false);
const id = (await db.query(`select id from public.access_codes where code = $1`, [CODE])).rows[0].id;
await as(ADMIN, true, () => db.query(`select public.admin_close_access_code($1, true)`, [id]));
check('Avslutad kod nekas', await chk(CODE) === false);
const closedSignup = await signUp('efter@x', { access_code: CODE, first_name: 'Efter' });
check('Konto med avslutad kod nekas', !!closedSignup.error);
await as(ADMIN, true, () => db.query(`select public.admin_close_access_code($1, false)`, [id]));
check('Öppnad kod gäller igen', await chk(CODE) === true);
await as(ADMIN, true, () => db.query(`select public.admin_set_access_code_until($1, now() - interval '1 minute')`, [id]));
check('Kod med passerat datum nekas', await chk(CODE) === false);
const userList = await as(a.id, false, () => db.query(`select * from public.admin_list_access_codes()`));
check('Vanlig användare kan inte lista koder', !!userList.error, JSON.stringify(userList));

console.log(`${ok} ok, ${fail} fel`);
process.exit(fail ? 1 : 0);
