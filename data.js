// ── Datalager ──
// All läsning och skrivning av upplägg går via LossiData. Sidorna vet inte
// var datan bor: i Supabase-tabellen plans (supabase/schema.sql), där
// databasens regler ser till att varje lärare bara når sina egna upplägg.
// Kräver auth.js (LossiAuth.client).
//
// Ett upplägg = ett id + ett state-objekt (formen sätts av saveState() i
// upplag.html). Demo-upplägg som aldrig redigerats har state.demo = true och
// bara titel/ämne/årskurs/avatar; sidans inbyggda innehåll visas för dem.
//
// UI-inställningar (tema, dold inbjudan, slumpad reservavatar) är inte
// uppläggsdata och ligger kvar i localStorage i theme.js.
const LossiData = (() => {
  const db = () => LossiAuth.client;
  const SAVE_DELAY_MS = 800;
  // Webbläsare tillåter bara små keepalive-anrop när sidan stängs
  const KEEPALIVE_MAX_BYTES = 60000;

  // Ogiltig eller utgången inloggning (PGRST301/303): logga in på nytt i stället för att visa fel
  function check({ data, error }) {
    if (error) {
      if (['PGRST301', 'PGRST303'].includes(error.code)) {
        LossiAuth.client.auth.signOut({ scope: 'local' })
          .finally(() => window.location.replace('login.html'));
      }
      throw error;
    }
    return data;
  }

  // ── Demo-upplägg ──
  // Den som saknar upplägg (ny lärare, eller efter supabase/reset.sql) får
  // demo-uppläggen. Körs högst en gång per sidladdning, även om aside och
  // översikt frågar samtidigt.
  let seeding = null;

  function demoRows() {
    return Object.entries(DEMO_PLANS).map(([key, demo], i) => {
      const avatar = PLAN_AVATARS[i % PLAN_AVATARS.length].id;
      return {
        title: demo.title,
        avatar,
        state: { demo: true, demoKey: key, title: demo.title, subject: demo.subject, grade: demo.grade, avatar },
      };
    });
  }

  async function fetchPlans() {
    return check(await db().from('plans').select('id, state').order('id'));
  }

  // [{ id, state }], äldst först
  async function listPlans() {
    let rows = await fetchPlans();
    if (!rows.length) {
      seeding = seeding || db().from('plans').insert(demoRows()).then(check);
      await seeding;
      rows = await fetchPlans();
    }
    return rows.map(r => ({ id: String(r.id), state: r.state }));
  }

  // null om upplägget inte finns eller tillhör någon annan
  async function loadPlan(id) {
    if (!/^\d+$/.test(String(id))) return null;
    const row = check(await db().from('plans').select('state').eq('id', id).maybeSingle());
    if (row) lastSaved.set(String(id), JSON.stringify(row.state));
    return row ? row.state : null;
  }

  // ── Spara ──
  // saveState() anropas vid nästan varje ändring. Sparningen väntar tills det
  // varit lugnt en stund, skickar bara senaste läget och hoppar över det som
  // redan är sparat. När sidan lämnas skickas det som återstår direkt.
  const pending = new Map();   // id → senaste osparade state
  const lastSaved = new Map(); // id → JSON som senast sparats
  const timers = new Map();
  let statusListener = () => {};

  function columnsFor(state) {
    return { state, title: state.title || '', avatar: state.avatar || null };
  }

  async function writePlan(id, state) {
    const json = JSON.stringify(state);
    if (lastSaved.get(id) === json) return;
    statusListener('saving');
    try {
      const rows = check(await db().from('plans').update(columnsFor(state)).eq('id', id).select('id'));
      if (!rows.length) throw new Error('Upplägget finns inte längre eller tillhör ett annat konto.');
      lastSaved.set(id, json);
      if (!pending.has(id)) statusListener('saved');
    } catch (e) {
      statusListener('error', e);
      throw e;
    }
  }

  async function savePlan(id, state) {
    id = String(id);
    pending.set(id, state);
    clearTimeout(timers.get(id));
    return new Promise((resolve, reject) => {
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        const latest = pending.get(id);
        pending.delete(id);
        writePlan(id, latest).then(resolve, reject);
      }, SAVE_DELAY_MS));
    });
  }

  // Skickar osparade ändringar direkt. Vid sidbyte avbryts vanliga anrop,
  // så då används fetch med keepalive (som får slutföras efter att sidan stängts).
  function flushOnLeave() {
    const token = LossiAuth.accessToken();
    pending.forEach((state, id) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      const body = JSON.stringify(columnsFor(state));
      if (lastSaved.get(id) === JSON.stringify(state)) return;
      if (!token || body.length > KEEPALIVE_MAX_BYTES) {
        writePlan(id, state).catch(() => {});
        return;
      }
      fetch(`${LOSSI_CONFIG.supabaseUrl}/rest/v1/plans?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          apikey: LOSSI_CONFIG.supabasePublishableKey,
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body,
      }).catch(() => {});
      lastSaved.set(id, JSON.stringify(state));
    });
    pending.clear();
  }

  window.addEventListener('pagehide', flushOnLeave);

  // Sparar ett nytt upplägg och returnerar dess id
  async function createPlan(state) {
    const row = check(await db().from('plans').insert(columnsFor(state)).select('id').single());
    return String(row.id);
  }

  // Sidan kan visa "Sparar…/Kunde inte spara" (status: 'saving' | 'saved' | 'error')
  function onSaveStatus(fn) {
    statusListener = fn;
  }

  return { listPlans, loadPlan, savePlan, createPlan, flushOnLeave, onSaveStatus };
})();
