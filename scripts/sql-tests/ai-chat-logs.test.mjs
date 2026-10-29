// Testar supabase/ai-chat-logs.sql i lokal Postgres (PGlite): samtalen i Planera med AI.
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
for (const f of ['schema.sql', 'calendar.sql', 'projects.sql', 'feedback.sql', 'feedback-admin.sql', 'ai.sql', 'ai-chat-logs.sql', 'ai-chat-logs.sql']) {
  try { await db.exec(sql(f)); } catch (e) { console.log('Kunde inte köra', f, e.message); process.exit(1); }
}

const LINA = '00000000-0000-0000-0000-000000000001';
const BO = '00000000-0000-0000-0000-000000000002';
const ADMIN = '00000000-0000-0000-0000-000000000003';
await db.exec(`alter table auth.users disable trigger user;`);
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${LINA}', 'lina@x', '{"display_name":"Lina"}'), ('${BO}', 'bo@x', '{}'), ('${ADMIN}', 'tobias@x', '{}')`);
const ids = (await db.query(`insert into public.ai_chat_logs (user_id, question, reply, proposal) values
  ('${LINA}', 'Kan du lägga om efter FIGA?', 'Jag är inte helt säker på FIGA.', null),
  ('${LINA}', 'Lägg till en avslutning', 'Här är ett förslag.', '{"summary":"Avslutning","changes":[{"op":"add_activity"}]}'),
  ('${BO}', 'Hej', 'Hej!', null)
  returning id`)).rows.map(r => r.id);
await db.exec(`insert into public.ai_chat_logs (user_id, question, reply, created_at) values ('${LINA}', 'Gammal', 'Gammal', now() - interval '100 days')`);

async function as(uid, q, params = [], admin = false) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false); select set_config('request.jwt.claims', '${admin ? '{"app_metadata":{"role":"admin"}}' : '{}'}', false);`);
  try { return { rows: (await db.query(q, params)).rows }; } catch (e) { return { error: e.message }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`); }
}
const row = async id => (await db.query(`select * from public.ai_chat_logs where id = $1`, [id])).rows[0];

let r = await as(LINA, `select public.rate_ai_chat($1, $2::smallint)`, [ids[0], -1]);
check('Lina ger tumme ner på sitt svar', !r.error && (await row(ids[0])).rating === -1, JSON.stringify(r));
r = await as(BO, `select public.rate_ai_chat($1, $2::smallint)`, [ids[0], 1]);
check('Bo kan inte ändra Linas tumme', (await row(ids[0])).rating === -1, JSON.stringify(r));
r = await as(LINA, `select public.rate_ai_chat($1, $2::smallint)`, [ids[0], 5]);
check('Bara 1 och -1 godtas', !!r.error, JSON.stringify(r));
r = await as(LINA, `select public.rate_ai_chat($1, null)`, [ids[0]]);
check('Tummen kan tas bort', !r.error && (await row(ids[0])).rating === null, JSON.stringify(r));
r = await as(LINA, `select public.set_ai_chat_outcome($1, 'applied')`, [ids[1]]);
check('Lina genomförde förslaget', !r.error && (await row(ids[1])).outcome === 'applied', JSON.stringify(r));
r = await as(LINA, `select public.set_ai_chat_outcome($1, 'applied')`, [ids[0]]);
check('Utfall bara på svar med förslag', (await row(ids[0])).outcome === null, JSON.stringify(r));
r = await as(LINA, `select public.set_ai_chat_outcome($1, 'hack')`, [ids[1]]);
check('Okänt utfall nekas', !!r.error, JSON.stringify(r));

r = await as(LINA, `select * from public.ai_chat_logs`);
check('Lärare kan inte läsa tabellen direkt', !!r.error || r.rows.length === 0, JSON.stringify(r).slice(0, 200));
r = await as(LINA, `select * from public.ai_chat_admin_list()`);
check('Lärare kan inte läsa admin-listan', !!r.error, JSON.stringify(r).slice(0, 200));
r = await as(ADMIN, `select * from public.ai_chat_admin_list()`, [], true);
check('Admin ser de senaste 90 dagarna med namn', !r.error && r.rows.length === 3 && r.rows.some(x => x.author === 'Lina') && !r.rows.some(x => x.question === 'Gammal'), JSON.stringify(r).slice(0, 300));
r = await (async () => { await db.exec('set role anon'); try { return { rows: (await db.query(`select public.rate_ai_chat(${ids[2]}, 1::smallint)`)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } })();
check('Utloggad kan inte anropa', !!r.error, JSON.stringify(r));

await db.exec(`delete from auth.users where id = '${BO}'`);
const left = (await db.query(`select count(*)::int as n from public.ai_chat_logs where user_id = '${BO}'`)).rows[0].n;
check('Bos samtal försvinner med kontot', left === 0);

console.log(`${ok} ok, ${fail} fel`);
process.exit(fail ? 1 : 0);
