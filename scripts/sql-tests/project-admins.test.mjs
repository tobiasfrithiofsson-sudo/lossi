// Testar supabase/project-admins.sql i lokal Postgres (PGlite): administratörer i projekt.
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
// Två gånger: filen ska gå att köra om
for (const f of ['schema.sql', 'calendar.sql', 'projects.sql', 'notifications.sql', 'project-admins.sql', 'project-admins.sql']) {
  try { await db.exec(sql(f)); } catch (e) { console.log('Kunde inte köra', f, e.message); process.exit(1); }
}

const OWNER = '00000000-0000-0000-0000-000000000001';
const ADA = '00000000-0000-0000-0000-000000000002'; // blir administratör
const BO = '00000000-0000-0000-0000-000000000003';  // medlem
const CIA = '00000000-0000-0000-0000-000000000004'; // medlem
const UTE = '00000000-0000-0000-0000-000000000005'; // inte med
await db.exec(`alter table auth.users disable trigger user;`);
await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@x'), ('${ADA}', 'a@x'), ('${BO}', 'b@x'), ('${CIA}', 'c@x'), ('${UTE}', 'u@x')`);
await db.exec(`alter table auth.users enable trigger user;`);
const P = (await db.query(`insert into public.projects (name) values ('Skolan') returning id`)).rows[0].id;
await db.exec(`insert into public.project_members (project_id, user_id, role) values
  (${P}, '${OWNER}', 'owner'), (${P}, '${ADA}', 'member'), (${P}, '${BO}', 'member'), (${P}, '${CIA}', 'member')`);

async function as(uid, q, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return { rows: (await db.query(q, params)).rows }; } catch (e) { return { error: e.message }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const role = async uid => (await db.query(`select role from public.project_members where project_id = $1 and user_id = $2`, [P, uid])).rows[0]?.role;
const setRole = (by, member, r) => as(by, `select public.set_project_member_role($1, $2, $3)`, [P, member, r]);

let r = await setRole(BO, ADA, 'admin');
check('En medlem kan inte göra någon till administratör', !!r.error && await role(ADA) === 'member', JSON.stringify(r));
r = await setRole(OWNER, ADA, 'admin');
check('Ägaren gör Ada till administratör', !r.error && await role(ADA) === 'admin', JSON.stringify(r));
r = await setRole(ADA, BO, 'admin');
check('Ada gör Bo till administratör (flera går)', !r.error && await role(BO) === 'admin', JSON.stringify(r));
r = await setRole(ADA, OWNER, 'member');
check('Ägarens roll kan inte ändras', !!r.error && await role(OWNER) === 'owner', JSON.stringify(r));
r = await setRole(ADA, BO, 'owner');
check('Ingen kan göras till ägare', !!r.error, JSON.stringify(r));
r = await setRole(ADA, UTE, 'admin');
check('Någon utanför projektet kan inte få en roll', !!r.error, JSON.stringify(r));
r = await setRole(UTE, CIA, 'admin');
check('Utomstående kan inte ändra roller', !!r.error && await role(CIA) === 'member', JSON.stringify(r));

r = await as(ADA, `select public.rename_project($1, 'Nya skolan') as n`, [P]);
check('Administratör byter namn', !r.error && r.rows[0].n === 'Nya skolan', JSON.stringify(r));
r = await as(CIA, `select public.rename_project($1, 'Hack')`, [P]);
check('Medlem kan inte byta namn', !!r.error, JSON.stringify(r));
r = await as(ADA, `select public.set_project_avatar($1, 'rocket')`, [P]);
check('Administratör byter avatar', !r.error, JSON.stringify(r));

const inv = (await db.query(`insert into public.project_invites (project_id, email, invited_by) values ($1, 'ny@x', $2) returning id`, [P, CIA])).rows[0].id;
r = await as(ADA, `select public.cancel_invite($1)`, [inv]);
const left = (await db.query(`select count(*)::int as n from public.project_invites where id = $1`, [inv])).rows[0].n;
check('Administratör tar tillbaka någon annans inbjudan', !r.error && left === 0, JSON.stringify(r));

r = await as(ADA, `select public.remove_project_member($1, $2)`, [P, OWNER]);
check('Administratör kan inte ta bort ägaren', !!r.error && await role(OWNER) === 'owner', JSON.stringify(r));
r = await as(CIA, `select public.remove_project_member($1, $2)`, [P, BO]);
check('Medlem kan inte ta bort någon', !!r.error && await role(BO) === 'admin', JSON.stringify(r));
r = await as(ADA, `select public.remove_project_member($1, $2)`, [P, BO]);
check('Administratör tar bort en annan administratör', !r.error && !(await role(BO)), JSON.stringify(r));
r = await setRole(ADA, ADA, 'member');
check('Administratör kan lämna rollen själv', !r.error && await role(ADA) === 'member', JSON.stringify(r));
r = await as(ADA, `select public.rename_project($1, 'Igen')`, [P]);
check('och kan sedan inte byta namn', !!r.error, JSON.stringify(r));

await setRole(OWNER, ADA, 'admin');
r = await as(ADA, `select public.delete_project($1)`, [P]);
check('Administratör kan inte ta bort projektet', !!r.error, JSON.stringify(r));
r = await as(ADA, `select public.leave_project($1)`, [P]);
check('Administratör kan lämna projektet', !r.error && !(await role(ADA)), JSON.stringify(r));

await setRole(OWNER, CIA, 'admin');
await db.exec(`insert into public.project_members (project_id, user_id, role) values (${P}, '${UTE}', 'member')`);
const notes = (await db.query(`select user_id from public.notifications where kind = 'member_joined' and project_id = $1 order by user_id`, [P])).rows.map(x => x.user_id);
check('Ägaren och administratörer får notisen när någon går med', notes.includes(OWNER) && notes.includes(CIA), JSON.stringify(notes));

r = await (async () => { await db.exec('set role anon'); try { return { rows: (await db.query(`select public.set_project_member_role(${P}, '${CIA}', 'member')`)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } })();
check('Utloggad kan inte anropa', !!r.error, JSON.stringify(r));

console.log(`${ok} ok, ${fail} fel`);
process.exit(fail ? 1 : 0);
