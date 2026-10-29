// Testar supabase/project-choices.sql i lokal Postgres (PGlite).
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

const U1 = '00000000-0000-0000-0000-000000000001'; // Lina: Historia, slöjd och Gy 1 i profilen
const U2 = '00000000-0000-0000-0000-000000000002'; // Kristoffer: historia, Musik
const U3 = '00000000-0000-0000-0000-000000000003'; // Utomstående
await db.exec(`
  alter table auth.users disable trigger all;
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${U1}', 'lina@x', '{"subjects": ["Historia", "slöjd"], "grades": ["Gy 1"]}'),
    ('${U2}', 'kristoffer@x', '{"subjects": ["historia", " Musik "]}'),
    ('${U3}', 'ute@x', '{"subjects": "inte en lista"}');
`);
const pr = await db.query(`insert into public.projects (name) values ('Skolan'), ('Utes') returning id`);
const [P1, P2] = pr.rows.map(r => r.id);
await db.exec(`
  insert into public.project_members (project_id, user_id, role) values
    (${P1}, '${U1}', 'owner'), (${P1}, '${U2}', 'member'), (${P2}, '${U3}', 'owner');
  alter table public.plans disable trigger all;
  insert into public.plans (owner_id, project_id, title, state) values
    ('${U1}', ${P1}, 'Linas', '{"subject": "Teknik", "grade": "7–9"}'), ('${U3}', ${P2}, 'Utes', '{"subject": "Filosofi"}');
  alter table public.plans enable trigger all;
`);

// project-classes.sql först (clean_class_name). Kör filen två gånger: andra gången ska inte ge dubbletter
await db.exec(sql('project-classes.sql'));
await db.exec(sql('project-choices.sql'));
await db.exec(sql('project-choices.sql'));

const col = async (pid, c) => (await db.query(`select ${c} from public.projects where id = $1`, [pid])).rows[0][c];
const s1 = await col(P1, 'subjects'), g1 = await col(P1, 'grades'), s2 = await col(P2, 'subjects');
const lower = a => a.map(x => x.toLowerCase()).sort();
const DEF = ['samhällskunskap', 'svenska', 'matematik', 'biologi', 'fysik', 'kemi', 'engelska', 'idrott', 'bild'];
check('Skolan: standard + profilernas + upplägget, utan dubbletter', JSON.stringify(lower(s1)) === JSON.stringify([...DEF, 'historia', 'musik', 'slöjd', 'teknik'].sort()), JSON.stringify(s1));
check('Skolan: årskurser standard + Gy 1 + 7–9', JSON.stringify(g1) === JSON.stringify(['Förskola', 'F', '1', '2', '3', '4', '5', '6', '7', '8', '9', '7–9', 'Gy 1']), JSON.stringify(g1));
check('Utes fick bara sitt', JSON.stringify(lower(s2)) === JSON.stringify([...DEF, 'filosofi'].sort()), JSON.stringify(s2));
const fresh = (await db.query(`insert into public.projects (name) values ('Ny') returning subjects, grades`)).rows[0];
check('Nytt projekt får standardlistorna', fresh.subjects.length === 9 && fresh.grades.length === 11, JSON.stringify(fresh));

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } catch (e) { return { error: e.message }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const rpc = (uid, fn, pid, kind, v) => as(uid, async () => ({ rows: (await db.query(`select public.${fn}($1, $2, $3) as r`, [pid, kind, v])).rows }));

const a = await rpc(U2, 'add_project_choice', P1, 'subjects', '  Hem- och  konsumentkunskap ');
check('Kristoffer lägger till ett ämne (städat)', !a.error && a.rows[0].r.includes('Hem- och konsumentkunskap'), JSON.stringify(a));
const dup = await rpc(U1, 'add_project_choice', P1, 'subjects', 'HISTORIA');
check('Historia läggs inte till igen', !dup.error && dup.rows[0].r.filter(x => x.toLowerCase() === 'historia').length === 1, JSON.stringify(dup));
const g = await rpc(U1, 'remove_project_choice', P1, 'grades', '1');
check('Lina tar bort årskurs 1', !g.error && !g.rows[0].r.includes('1') && g.rows[0].r.includes('2'), JSON.stringify(g));
const g2 = await rpc(U1, 'add_project_choice', P1, 'grades', '1');
check('och lägger tillbaka den', !g2.error && g2.rows[0].r.includes('1'), JSON.stringify(g2));
const bad = await rpc(U1, 'add_project_choice', P1, 'classes', 'X');
check('Okänd lista nekas', !!bad.error, JSON.stringify(bad));
const out = await rpc(U3, 'add_project_choice', P1, 'subjects', 'Hack');
check('Utomstående kan inte lägga till', !!out.error, JSON.stringify(out));
const outDel = await rpc(U3, 'remove_project_choice', P1, 'subjects', 'Historia');
check('Utomstående kan inte ta bort', !!outDel.error, JSON.stringify(outDel));
const empty = await rpc(U1, 'add_project_choice', P1, 'grades', '   ');
check('Tomt värde nekas', !!empty.error, JSON.stringify(empty));
const anon = await (async () => { await db.exec('set role anon'); try { return { rows: (await db.query(`select public.add_project_choice(${P1}, 'subjects', 'X')`)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } })();
check('Utloggad kan inte anropa', !!anon.error, JSON.stringify(anon));

console.log(`${ok} ok, ${fail} fel`);
process.exit(fail ? 1 : 0);
