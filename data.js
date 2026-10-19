// ── Datalager ──
// All läsning och skrivning av upplägg går via LossiData. Sidorna vet inte
// var datan bor: i Supabase-tabellen plans (supabase/schema.sql). Varje
// upplägg ligger i ett projekt (supabase/projects.sql); databasens regler
// låter medlemmar läsa varandras upplägg, men bara skaparen ändra.
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

  // Har den inloggade inga egna upplägg och har aldrig fått demona: lägg in dem
  // (i det egna projektet, databasens standardval). Högst en gång per sidladdning.
  async function ensureDemoPlans() {
    if (seeding) return seeding;
    seeding = (async () => {
      const user = await LossiAuth.getUser();
      if (!user || user.user_metadata?.demo_seeded) return;
      const own = check(await db().from('plans').select('id').eq('owner_id', user.id).limit(1));
      if (!own.length) check(await db().from('plans').insert(demoRows()));
      await markSeeded();
    })();
    return seeding;
  }

  const PLAN_COLUMNS = 'id, state, owner_id, project_id';

  function toPlan(r) {
    return { id: String(r.id), state: r.state, ownerId: r.owner_id, projectId: r.project_id != null ? String(r.project_id) : null };
  }

  // [{ id, state, ownerId, projectId }], äldst först.
  //   projectId – bara upplägg i det projektet (annars alla man får se)
  //   mine      – bara den inloggades egna upplägg
  async function listPlans({ projectId, mine = false } = {}) {
    await ensureDemoPlans();
    let query = db().from('plans').select(PLAN_COLUMNS);
    if (projectId) query = query.eq('project_id', projectId);
    if (mine) {
      const user = await LossiAuth.getUser();
      query = query.eq('owner_id', user?.id);
    }
    return check(await query.order('id')).map(toPlan);
  }

  // Den inloggades egna upplägg, i alla projekt (kalender, egna klasser/ämnen)
  function listMyPlans() {
    return listPlans({ mine: true });
  }

  // { state, ownerId, projectId }, eller null om upplägget inte finns eller inte syns för en
  async function loadPlanInfo(id) {
    if (!/^\d+$/.test(String(id))) return null;
    const row = check(await db().from('plans').select(PLAN_COLUMNS).eq('id', id).maybeSingle());
    if (!row) return null;
    lastSaved.set(String(id), JSON.stringify(row.state));
    const plan = toPlan(row);
    return { state: plan.state, ownerId: plan.ownerId, projectId: plan.projectId };
  }

  async function loadPlan(id) {
    return (await loadPlanInfo(id))?.state || null;
  }

  // ── Projekt (supabase/projects.sql) ──
  // Ett projekt = { id, name, personal, members: [{ userId, role, displayName, avatar, email }] }.
  // Alla har ett eget projekt (personal); delade projekt har flera medlemmar.
  // Det valda projektet kommer man ihåg i webbläsaren.
  const CURRENT_PROJECT_KEY = 'lossi-project';
  let projectsPromise = null;

  async function fetchProjects() {
    const rows = check(await db().from('projects').select('id, name, personal_owner, created_at').order('created_at'));
    // Namn och avatar på medlemmarna; saknas funktionen än visas bara projekten
    let members = [];
    try {
      members = check(await db().rpc('project_member_profiles')) || [];
    } catch (e) {
      console.warn('Kunde inte hämta projektens medlemmar:', e);
    }
    const projects = rows.map(r => ({
      id: String(r.id),
      name: r.name,
      personal: !!r.personal_owner,
      members: members.filter(m => String(m.project_id) === String(r.id)).map(m => ({
        userId: m.user_id, role: m.role, displayName: m.display_name || '', avatar: m.avatar || null, email: m.email || '',
      })),
    }));
    // Det egna projektet först, sedan delade i den ordning man gick med
    return projects.sort((a, b) => Number(b.personal) - Number(a.personal));
  }

  function listProjects() {
    projectsPromise = projectsPromise || fetchProjects().catch(e => { projectsPromise = null; throw e; });
    return projectsPromise;
  }

  // Det valda projektet (eller det egna om inget valts / valet inte längre finns)
  async function currentProject() {
    const projects = await listProjects();
    let saved = null;
    try { saved = localStorage.getItem(CURRENT_PROJECT_KEY); } catch (e) {}
    return projects.find(p => p.id === saved) || projects.find(p => p.personal) || projects[0] || null;
  }

  function setCurrentProject(id) {
    try { localStorage.setItem(CURRENT_PROJECT_KEY, String(id)); } catch (e) {}
  }

  // Namn och avatar för en användare i något av ens projekt
  async function findMember(userId) {
    const projects = await listProjects().catch(() => []);
    for (const p of projects) {
      const m = p.members.find(x => x.userId === userId);
      if (m) return m;
    }
    return null;
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

  // Sparar ett nytt upplägg och returnerar dess id. Utan projekt hamnar det i det egna.
  async function createPlan(state, projectId) {
    const columns = columnsFor(state);
    if (projectId) columns.project_id = Number(projectId);
    const row = check(await db().from('plans').insert(columns).select('id').single());
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

  // ── Feedback från testare (tabellen feedback, supabase/feedback.sql) ──
  async function sendFeedback({ kind, message, page, context }) {
    check(await db().from('feedback').insert({ kind, message, page, context }));
  }

  // Administratörer (supabase/feedback-admin.sql): all feedback + ändra status/anteckning
  async function listAllFeedback() {
    return check(await db().rpc('feedback_admin_list'));
  }

  async function updateFeedback(id, status, note) {
    check(await db().rpc('feedback_admin_update', { p_id: id, p_status: status, p_note: note || '' }));
  }

  // Sidan kan visa "Sparar…/Kunde inte spara" (status: 'saving' | 'saved' | 'error')
  function onSaveStatus(fn) {
    statusListener = fn;
  }

  return {
    listPlans, listMyPlans, loadPlan, loadPlanInfo, savePlan,
    listProjects, currentProject, setCurrentProject, findMember, createPlan, deletePlan, flushOnLeave, onSaveStatus,
    listEvents, listPlanEvents, upcomingEvents, scheduleLesson, unscheduleLesson,
    sendFeedback, listAllFeedback, updateFeedback,
  };
})();
