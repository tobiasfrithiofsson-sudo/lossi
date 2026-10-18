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
  // En ny lärare får demo-uppläggen en gång. Att det skett noteras i
  // användarens metadata (demo_seeded), så att den som själv tagit bort alla
  // sina upplägg inte får tillbaka demona. supabase/reset.sql kan nollställa.
  // Körs högst en gång per sidladdning, även om aside och översikt frågar samtidigt.
  let seeding = null;

  function markSeeded() {
    return db().auth.updateUser({ data: { demo_seeded: true } });
  }

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
    const user = await LossiAuth.getUser();
    const seeded = !!user?.user_metadata?.demo_seeded;
    if (!rows.length && !seeded) {
      seeding = seeding || db().from('plans').insert(demoRows()).then(check).then(markSeeded);
      await seeding;
      rows = await fetchPlans();
    } else if (rows.length && !seeded && !seeding) {
      // Konton från innan flaggan fanns
      seeding = markSeeded();
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

  // Raderar upplägget permanent. Väntande sparningar för det kastas.
  async function deletePlan(id) {
    id = String(id);
    clearTimeout(timers.get(id));
    timers.delete(id);
    pending.delete(id);
    const rows = check(await db().from('plans').delete().eq('id', id).select('id'));
    if (!rows.length) throw new Error('Upplägget finns inte längre eller tillhör ett annat konto.');
    lastSaved.delete(id);
  }

  // Sparar ett nytt upplägg och returnerar dess id
  async function createPlan(state) {
    const row = check(await db().from('plans').insert(columnsFor(state)).select('id').single());
    return String(row.id);
  }

  // ── Kalender: lektioner inlagda på en tid (tabellen lesson_events, supabase/calendar.sql) ──
  // En händelse = { id, planId, lessonId, start (Date), durationMin }.
  const EVENT_COLUMNS = 'id, plan_id, lesson_id, starts_at, duration_min';

  function toEvent(r) {
    return { id: String(r.id), planId: String(r.plan_id), lessonId: r.lesson_id, start: new Date(r.starts_at), durationMin: r.duration_min };
  }

  // Händelser som börjar i intervallet [from, to)
  async function listEvents(from, to) {
    const rows = check(await db().from('lesson_events').select(EVENT_COLUMNS)
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at'));
    return rows.map(toEvent);
  }

  async function listPlanEvents(planId) {
    const rows = check(await db().from('lesson_events').select(EVENT_COLUMNS).eq('plan_id', planId));
    return rows.map(toEvent);
  }

  // De närmaste händelserna som inte är slut än
  async function upcomingEvents(limit = 5) {
    const now = new Date();
    const since = new Date(now.getTime() - 10 * 60 * 60 * 1000);
    const rows = check(await db().from('lesson_events').select(EVENT_COLUMNS)
      .gte('starts_at', since.toISOString()).order('starts_at').limit(limit + 10));
    return rows.map(toEvent)
      .filter(e => e.start.getTime() + e.durationMin * 60000 > now.getTime())
      .slice(0, limit);
  }

  // Lägger in lektionen på en tid, eller flyttar den om den redan ligger i kalendern
  async function scheduleLesson({ planId, lessonId, start, durationMin }) {
    const row = check(await db().from('lesson_events').upsert({
      plan_id: Number(planId),
      lesson_id: lessonId,
      starts_at: start.toISOString(),
      duration_min: durationMin,
    }, { onConflict: 'plan_id,lesson_id' }).select(EVENT_COLUMNS).single());
    return toEvent(row);
  }

  async function unscheduleLesson(planId, lessonId) {
    check(await db().from('lesson_events').delete().eq('plan_id', planId).eq('lesson_id', lessonId));
  }

  // Sidan kan visa "Sparar…/Kunde inte spara" (status: 'saving' | 'saved' | 'error')
  function onSaveStatus(fn) {
    statusListener = fn;
  }

  return {
    listPlans, loadPlan, savePlan, createPlan, deletePlan, flushOnLeave, onSaveStatus,
    listEvents, listPlanEvents, upcomingEvents, scheduleLesson, unscheduleLesson,
  };
})();
