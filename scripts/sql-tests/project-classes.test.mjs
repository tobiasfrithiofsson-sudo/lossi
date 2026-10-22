// Testar supabase/project-classes.sql i lokal Postgres (PGlite).
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
for (const f of ['schema.sql', 'projects.sql', 'calendar.sql']) await db.exec(sql(f));

const U1 = '00000000-0000-0000-0000-000000000001'; // Lina: egna klasser 7B, 8a i profilen
const U2 = '00000000-0000-0000-0000-000000000002'; // Kristoffer: 8A, 9C
const U3 = '00000000-0000-0000-0000-000000000003'; // Utomstående
await db.exec(`
  alter table auth.users disable trigger all;
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${U1}', 'lina@x', '{"classes": ["7B", "8a"]}'),
    ('${U2}', 'kristoffer@x', '{"classes": ["8A", " 9C "]}'),
    ('${U3}', 'ute@x', '{"classes": "inte en lista"}');
`);
const pr = await db.query(`insert into public.projects (name) values ('Skolan'), ('Utes') returning id`);
const [P1, P2] = pr.rows.map(r => r.id);
await db.exec(`
  insert into public.project_members (project_id, user_id, role) values
    (${P1}, '${U1}', 'owner'), (${P1}, '${U2}', 'member'), (${P2}, '${U3}', 'owner');
  alter table public.plans disable trigger all;
  insert into public.plans (owner_id, project_id, title, state) values
    ('${U1}', ${P1}, 'Linas', '{"klass": "6C"}'), ('${U3}', ${P2}, 'Utes', '{"klass": "Gy1"}');
  alter table public.plans enable trigger all;
`);

// Kör filen två gånger: andra gången ska inte ge dubbletter
await db.exec(sql('project-classes.sql'));
await db.exec(sql('project-classes.sql'));

const classes = async pid => (await db.query(`select classes from public.projects where id = $1`, [pid])).rows[0].classes;
const c1 = await classes(P1), c2 = await classes(P2);
const lower = a => a.map(x => x.toLowerCase()).sort();
check('Skolan fick alla medlemmars klasser + upplägget, utan dubbletter', JSON.stringify(lower(c1)) === JSON.stringify(['6c', '7b', '8a', '9c']), JSON.stringify(c1));
check('Blanksteg städade (9C)', c1.includes('9C'), JSON.stringify(c1));
check('Utes fick bara sitt (ingen läcka från Skolan)', JSON.stringify(c2) === JSON.stringify(['Gy1']), JSON.stringify(c2));

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rpc = (uid, fn, pid, name) => as(uid, async () => ({ rows: (await db.query(`select public.${fn}($1, $2) as r`, [pid, name])).rows }));

const a = await rpc(U2, 'add_project_class', P1, '  5A  ');
check('Kristoffer lägger till 5A', !a.error && a.rows[0].r.includes('5A'), JSON.stringify(a));
const dup = await rpc(U1, 'add_project_class', P1, '5a');
check('5a läggs inte till igen', !dup.error && dup.rows[0].r.filter(x => x.toLowerCase() === '5a').length === 1, JSON.stringify(dup));
const seen = await as(U1, async () => ({ rows: (await db.query(`select classes from public.projects where id = $1`, [P1])).rows }));
check('Lina ser Kristoffers klass', !seen.error && seen.rows[0].classes.includes('5A'), JSON.stringify(seen));
const out = await rpc(U3, 'add_project_class', P1, 'Hack');
check('Utomstående kan inte lägga till', !!out.error, JSON.stringify(out));
const outDel = await rpc(U3, 'remove_project_class', P1, '5A');
check('Utomstående kan inte ta bort', !!outDel.error, JSON.stringify(outDel));
const empty = await rpc(U1, 'add_project_class', P1, '   ');
check('Tomt namn nekas', !!empty.error, JSON.stringify(empty));
const long = await rpc(U1, 'add_project_class', P1, 'x'.repeat(60));
check('Långt namn kortas till 40', !long.error && long.rows[0].r.some(x => x.length === 40), JSON.stringify(long).slice(0, 120));
const del = await rpc(U1, 'remove_project_class', P1, '5a');
check('Lina tar bort 5A (oavsett stora/små)', !del.error && !del.rows[0].r.some(x => x.toLowerCase() === '5a'), JSON.stringify(del));
const anon = await (async () => { await db.exec('set role anon'); try { return { rows: (await db.query(`select public.add_project_class(${P1}, 'X')`)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } })();
check('Utloggad kan inte anropa', !!anon.error, JSON.stringify(anon));

console.log(`${ok} ok, ${fail} fel`);
process.exit(fail ? 1 : 0);
