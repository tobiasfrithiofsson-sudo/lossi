// ── Datalager ──
// All läsning och skrivning av upplägg går via LossiData. Sidorna vet inte
// var datan bor: i Supabase-tabellen plans (supabase/schema.sql). Varje
// upplägg ligger i ett projekt (supabase/projects.sql); databasens regler
// låter medlemmar läsa varandras upplägg, men bara skaparen ändra.
// Kräver auth.js (LossiAuth.client).
//
// Ett upplägg = ett id + ett state-objekt (formen sätts av saveState() i
// upplag.html). Äldre demo-upplägg som aldrig redigerats har state.demo = true
// och bara titel/ämne/årskurs/avatar; sidans inbyggda innehåll visas för dem.
// Nya konton får i stället startuppläggen i starter-plans.js.
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

  // ── Startupplägg ──
  // En ny lärare får startuppläggen (starter-plans.js) en gång, plus en
  // lektion i kalendern nästa vardag. Att det skett noteras i användarens
  // metadata (demo_seeded), så att den som själv tagit bort alla sina upplägg
  // inte får tillbaka dem. supabase/reset.sql kan nollställa. Sidor utan
  // starter-plans.js lägger inte in något (översikten gör det).
  // Körs högst en gång per sidladdning, även om aside och översikt frågar samtidigt.
  let seeding = null;

  function markSeeded() {
    return db().auth.updateUser({ data: { demo_seeded: true } });
  }

  // Har den inloggade inga egna upplägg och har aldrig fått startuppläggen: lägg in dem
  // (i det egna projektet, databasens standardval). Högst en gång per sidladdning.
  async function ensureDemoPlans() {
    if (seeding) return seeding;
    seeding = (async () => {
      if (typeof buildStarterPlans !== 'function') return;
      const user = await LossiAuth.getUser();
      if (!user || user.user_metadata?.demo_seeded) return;
      const own = check(await db().from('plans').select('id').eq('owner_id', user.id).limit(1));
      if (!own.length) {
        const { rows, event } = buildStarterPlans();
        // Omvänd ordning: listorna visar senast skapade först, och det första ska stå överst
        const created = check(await db().from('plans').insert(rows.slice().reverse()).select('id, title'));
        const plan = event && created.find(c => c.title === rows[event.index].title);
        if (plan) {
          await scheduleLesson({ planId: plan.id, lessonId: event.lessonId, start: event.start, durationMin: event.durationMin })
            .catch(e => console.warn('Kunde inte lägga in startlektionen i kalendern:', e));
        }
      }
      await markSeeded();
    })();
    return seeding;
  }

  const PLAN_COLUMNS = 'id, state, owner_id, project_id';
  // Listor (sidopanel, översikt, kalender) behöver bara några fält ur state.
  // Hela state är 5–150 kB per upplägg (aktiviteterna sparas som HTML) och
  // hämtas bara för det öppna upplägget och där lektionsnamnen behövs.
  const SUMMARY_FIELDS = ['title', 'subject', 'grade', 'klass', 'avatar', 'demoKey'];
  const SUMMARY_COLUMNS = 'id, owner_id, project_id, demo:state->demo, '
    + SUMMARY_FIELDS.map(f => `${f}:state->>${f}`).join(', ');

  function toPlan(r) {
    return { id: String(r.id), state: r.state, ownerId: r.owner_id, projectId: r.project_id != null ? String(r.project_id) : null };
  }

  // Samma fält ur ett helt state som SUMMARY_COLUMNS ger
  function summaryState(source) {
    const state = {};
    if (source?.demo === true) state.demo = true;
    SUMMARY_FIELDS.forEach(f => { if (source?.[f] != null) state[f] = source[f]; });
    return state;
  }

  // Alla upplägg man får se, hämtas en gång per sida och delas av alla delar
  // av sidan. Sparningar, borttagningar och nya upplägg håller listan aktuell.
  let summariesPromise = null;
  function allSummaries() {
    if (!summariesPromise) {
      summariesPromise = (async () => {
        await ensureDemoPlans();
        const rows = check(await db().from('plans').select(SUMMARY_COLUMNS).order('id'));
        return rows.map(r => ({ ...toPlan(r), state: summaryState(r) }));
      })();
      summariesPromise.catch(() => { summariesPromise = null; });
    }
    return summariesPromise;
  }

  function forgetSummaries() {
    summariesPromise = null;
  }

  // Håller listan i takt med det som sparats på sidan
  function updateSummary(id, state) {
    summariesPromise?.then(plans => {
      const plan = plans.find(p => p.id === id);
      if (plan) plan.state = summaryState(state);
    }).catch(() => {});
  }

  // [{ id, state, ownerId, projectId }], äldst först. state har bara
  // titel, ämne, årskurs, klass, avatar, demoKey och demo (se loadPlanStates).
  //   projectId – bara upplägg i det projektet (annars alla man får se)
  //   mine      – bara den inloggades egna upplägg
  async function listPlans({ projectId, mine = false } = {}) {
    const [plans, user] = await Promise.all([allSummaries(), mine ? LossiAuth.getUser() : null]);
    return plans
      .filter(p => (!projectId || p.projectId === String(projectId)) && (!mine || p.ownerId === user?.id))
      .map(p => ({ ...p, state: { ...p.state } }));
  }

  // Den inloggades egna upplägg, i alla projekt (kalender, egna klasser/ämnen)
  function listMyPlans() {
    return listPlans({ mine: true });
  }

  // Hela state för flera upplägg (t.ex. lektionsnamn i kalendern): Map id → state.
  // Det som redan hämtats (eller håller på att hämtas) på sidan hämtas inte igen.
  const fullStates = new Map(); // id → Promise<state | undefined>
  async function loadPlanStates(ids) {
    ids = [...new Set(ids.map(String))].filter(id => /^\d+$/.test(id));
    const missing = ids.filter(id => !fullStates.has(id));
    if (missing.length) {
      const request = Promise.resolve(db().from('plans').select('id, state').in('id', missing.map(Number)))
        .then(res => new Map(check(res).map(r => [String(r.id), r.state])));
      missing.forEach(id => {
        const one = request.then(states => states.get(id));
        fullStates.set(id, one);
        one.catch(() => { if (fullStates.get(id) === one) fullStates.delete(id); });
      });
    }
    const states = await Promise.all(ids.map(id => fullStates.get(id)));
    return new Map(ids.map((id, i) => [id, states[i]]).filter(([, state]) => state));
  }

  // Samma upplägg med hela state, i samma ordning
  async function withFullStates(plans) {
    const states = await loadPlanStates(plans.map(p => p.id));
    return plans.map(p => ({ ...p, state: states.get(p.id) || p.state }));
  }

  // { state, ownerId, projectId }, eller null om upplägget inte finns eller inte syns för en
  async function loadPlanInfo(id) {
    if (!/^\d+$/.test(String(id))) return null;
    const row = check(await db().from('plans').select(PLAN_COLUMNS + ', created_at, updated_at').eq('id', id).maybeSingle());
    if (!row) return null;
    lastSaved.set(String(id), JSON.stringify(row.state));
    fullStates.set(String(id), Promise.resolve(row.state));
    const plan = toPlan(row);
    return { state: plan.state, ownerId: plan.ownerId, projectId: plan.projectId, createdAt: row.created_at || null, updatedAt: row.updated_at || null };
  }

  async function loadPlan(id) {
    return (await loadPlanInfo(id))?.state || null;
  }

  // ── Projekt (supabase/projects.sql) ──
  // Ett projekt = { id, name, personal, inviteCode, members: [{ userId, role, displayName, avatar, email }] }.
  // Alla får ett första projekt när kontot skapas (personal: nya upplägg hamnar
  // där som standard och det kan inte tas bort); annars är alla projekt likadana.
  // Det valda projektet kommer man ihåg i webbläsaren.
  const CURRENT_PROJECT_KEY = 'lossi-project';
  let projectsPromise = null;

  async function fetchProjects() {
    // Alla kolumner: invite_code finns först när steg 3 i projects.sql körts
    const rows = check(await db().from('projects').select('*').order('created_at'));
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
      inviteCode: r.invite_code || null,
      avatar: r.avatar || null,
      // Projektets klasser (supabase/project-classes.sql); null = kolumnen finns inte än
      classes: Array.isArray(r.classes) ? r.classes : null,
      // Projektets ämnen och årskurser (supabase/project-choices.sql); null = kolumnerna finns inte än
      subjects: Array.isArray(r.subjects) ? r.subjects : null,
      grades: Array.isArray(r.grades) ? r.grades : null,
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

  // Skapar ett delat projekt (man blir ägare; det får en inbjudningskod) och väljer det
  async function createProject(name) {
    const id = String(check(await db().rpc('create_project', { project_name: name })));
    projectsPromise = null;
    setCurrentProject(id);
    return id;
  }

  // ── Medskapare (supabase/projects.sql, steg 4) ──
  // En rad = { planId, userId, status: 'requested' | 'approved' }. Man ser sina
  // egna förfrågningar, allt om sina egna upplägg och godkända medskapare i
  // sina projekt.
  function toEditor(r) {
    return { planId: String(r.plan_id), userId: r.user_id, status: r.status };
  }

  async function listPlanEditors(planId) {
    return check(await db().from('plan_editors').select('plan_id, user_id, status').eq('plan_id', planId)).map(toEditor);
  }

  // Obesvarade förfrågningar på den inloggades egna upplägg
  async function listMyEditRequests() {
    const user = await LossiAuth.getUser();
    const rows = check(await db().from('plan_editors').select('plan_id, user_id, status').eq('status', 'requested'));
    return rows.map(toEditor).filter(e => e.userId !== user?.id);
  }

  // Returnerar 'requested', 'approved' eller 'owner'
  async function requestPlanEdit(planId) {
    return check(await db().rpc('request_plan_edit', { pid: Number(planId) }));
  }

  // Skaparen gör en projektmedlem till medskapare direkt
  async function addPlanEditor(planId, userId) {
    check(await db().rpc('add_plan_editor', { pid: Number(planId), editor: userId }));
  }

  async function decidePlanEdit(planId, userId, approve) {
    check(await db().rpc('decide_plan_edit', { pid: Number(planId), editor: userId, approve }));
  }

  // Skaparen tar bort en medskapare, eller man drar tillbaka sin egen förfrågan
  async function removePlanEditor(planId, userId) {
    check(await db().rpc('remove_plan_editor', { pid: Number(planId), editor: userId }));
  }

  // Byter namn på ett projekt (bara ägaren). Returnerar det sparade namnet.
  async function renameProject(id, name) {
    const saved = check(await db().rpc('rename_project', { pid: Number(id), project_name: name }));
    projectsPromise = null;
    return saved;
  }

  // ── Projektets klasser (supabase/project-classes.sql) ──
  // Alla medlemmar ser, lägger till och tar bort. Returnerar projektets nya lista.
  async function setCachedClasses(id, classes) {
    const projects = await projectsPromise?.catch(() => null);
    const project = projects?.find(p => p.id === String(id));
    if (project && Array.isArray(classes)) project.classes = classes;
    return classes || [];
  }

  async function addProjectClass(id, name) {
    return setCachedClasses(id, check(await db().rpc('add_project_class', { pid: Number(id), class_name: name })));
  }

  async function removeProjectClass(id, name) {
    return setCachedClasses(id, check(await db().rpc('remove_project_class', { pid: Number(id), class_name: name })));
  }

  // ── Projektets ämnen och årskurser (supabase/project-choices.sql) ──
  // kind = 'subjects' eller 'grades'. Alla medlemmar ändrar. Returnerar projektets nya lista.
  async function setCachedChoices(id, kind, list) {
    const projects = await projectsPromise?.catch(() => null);
    const project = projects?.find(p => p.id === String(id));
    if (project && Array.isArray(list)) project[kind] = list;
    return list || [];
  }

  async function addProjectChoice(id, kind, value) {
    return setCachedChoices(id, kind, check(await db().rpc('add_project_choice', { pid: Number(id), kind, choice: value })));
  }

  async function removeProjectChoice(id, kind, value) {
    return setCachedChoices(id, kind, check(await db().rpc('remove_project_choice', { pid: Number(id), kind, choice: value })));
  }

  // Projektets avatar (id ur USER_AVATARS i theme.js; null = första bokstaven). Bara ägaren.
  async function setProjectAvatar(id, avatar) {
    check(await db().rpc('set_project_avatar', { pid: Number(id), avatar_id: avatar || '' }));
    projectsPromise = null;
  }

  // Ägaren tar bort en medlem; personens upplägg flyttas till hens första projekt
  async function removeProjectMember(id, userId) {
    check(await db().rpc('remove_project_member', { pid: Number(id), member: userId }));
    projectsPromise = null;
    forgetSummaries();
  }

  // Lämna projektet (inte ägaren); ens upplägg där flyttas till ens första projekt
  async function leaveProject(id) {
    check(await db().rpc('leave_project', { pid: Number(id) }));
    projectsPromise = null;
    forgetSummaries();
    try { localStorage.removeItem(CURRENT_PROJECT_KEY); } catch (e) {}
  }

  // Tar bort ett delat projekt (bara ägaren). Uppläggen flyttas till skaparnas egna projekt.
  async function deleteProject(id) {
    check(await db().rpc('delete_project', { pid: Number(id) }));
    projectsPromise = null;
    forgetSummaries();
    try { localStorage.removeItem(CURRENT_PROJECT_KEY); } catch (e) {}
  }

  // ── Inbjudan via e-post och notiser (supabase/notifications.sql) ──
  // 'sent' (har konto, får en notis), 'saved' (inget konto än) eller 'member' (redan med)
  async function inviteByEmail(projectId, email) {
    return check(await db().rpc('invite_by_email', { pid: Number(projectId), invite_email: email }));
  }

  // Obesvarade inbjudningar till ett projekt (syns för medlemmarna)
  async function listProjectInvites(projectId) {
    const rows = check(await db().from('project_invites').select('id, email, invited_by, created_at')
      .eq('project_id', projectId).eq('status', 'pending').order('created_at'));
    return rows.map(r => ({ id: String(r.id), email: r.email, invitedBy: r.invited_by, createdAt: r.created_at }));
  }

  async function cancelInvite(id) {
    check(await db().rpc('cancel_invite', { invite: Number(id) }));
  }

  // Tacka ja eller nej; ja = medlem och projektet blir valt
  async function answerInvite(id, accept) {
    const projectId = String(check(await db().rpc('answer_invite', { invite: Number(id), accept })));
    projectsPromise = null;
    forgetSummaries();
    if (accept) setCurrentProject(projectId);
    return projectId;
  }

  // Den inloggades senaste notiser, nyast först. Inbjudningar får pending = om de kan besvaras.
  async function listNotifications(limit = 30) {
    const user = await LossiAuth.getUser();
    const rows = check(await db().from('notifications').select('*').order('created_at', { ascending: false }).limit(limit));
    const inviteIds = rows.filter(r => r.invite_id).map(r => r.invite_id);
    let pending = new Set();
    if (inviteIds.length) {
      try {
        const invites = check(await db().from('project_invites').select('id').in('id', inviteIds).eq('status', 'pending'));
        pending = new Set(invites.map(i => String(i.id)));
      } catch (e) {
        // Notiserna ska synas även om inbjudningarnas status inte gick att hämta
        console.warn('Kunde inte hämta inbjudningarnas status:', e);
        pending = new Set(inviteIds.map(String));
      }
    }
    return rows.filter(r => r.user_id === user?.id || !r.user_id).map(r => ({
      id: String(r.id), kind: r.kind, projectId: r.project_id != null ? String(r.project_id) : null,
      planId: r.plan_id != null ? String(r.plan_id) : null, inviteId: r.invite_id != null ? String(r.invite_id) : null,
      pending: r.invite_id != null && pending.has(String(r.invite_id)),
      actorName: r.actor_name || '', projectName: r.project_name || '', planTitle: r.plan_title || '',
      createdAt: r.created_at, read: !!r.read_at,
    }));
  }

  async function markNotificationsRead(ids) {
    if (!ids.length) return;
    check(await db().from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids.map(Number)));
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
      if (!rows.length) throw new Error('Upplägget finns inte längre, eller så har du inte längre rätt att ändra det.');
      lastSaved.set(id, json);
      fullStates.set(id, Promise.resolve(state));
      updateSummary(id, state);
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
      updateSummary(id, state);
      fullStates.set(id, Promise.resolve(state));
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
    // Filerna först (databasen tar bara bort raderna om dem)
    try {
      const files = await listPlanFiles(id);
      await removeStoredFiles(files.map(f => f.path));
    } catch (e) {
      console.warn('Kunde inte ta bort uppläggets filer:', e);
    }
    const rows = check(await db().from('plans').delete().eq('id', id).select('id'));
    if (!rows.length) throw new Error('Upplägget finns inte längre eller tillhör ett annat konto.');
    lastSaved.delete(id);
    fullStates.delete(id);
    forgetSummaries();
  }

  // Sparar ett nytt upplägg och returnerar dess id. Utan projekt hamnar det i det egna.
  async function createPlan(state, projectId) {
    const columns = columnsFor(state);
    if (projectId) columns.project_id = Number(projectId);
    const row = check(await db().from('plans').insert(columns).select('id').single());
    forgetSummaries();
    return String(row.id);
  }

  // ── Kalender: lektioner inlagda på en tid (tabellen lesson_events, supabase/calendar.sql) ──
  // En händelse = { id, planId, lessonId, start (Date), durationMin, ownerId }.
  // Man ser sina egna händelser och (supabase/calendar-shared.sql) de andra
  // medlemmarnas i sina projekt; ändra och ta bort gäller bara egna.
  const EVENT_COLUMNS = 'id, plan_id, lesson_id, starts_at, duration_min, owner_id';

  function toEvent(r) {
    return { id: String(r.id), planId: String(r.plan_id), lessonId: r.lesson_id, start: new Date(r.starts_at), durationMin: r.duration_min, ownerId: r.owner_id || null };
  }

  // Händelser som börjar i intervallet [from, to)
  // Startlektionen (ensureDemoPlans) ska finnas med redan första gången
  async function listEvents(from, to) {
    await ensureDemoPlans().catch(() => {});
    const rows = check(await db().from('lesson_events').select(EVENT_COLUMNS)
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at'));
    return rows.map(toEvent);
  }

  async function listPlanEvents(planId) {
    const rows = check(await db().from('lesson_events').select(EVENT_COLUMNS).eq('plan_id', planId));
    return rows.map(toEvent);
  }

  // Den inloggades närmaste händelser som inte är slut än (Kommande är personligt)
  async function upcomingEvents(limit = 5) {
    await ensureDemoPlans().catch(() => {});
    const now = new Date();
    const since = new Date(now.getTime() - 10 * 60 * 60 * 1000);
    const user = await LossiAuth.getUser();
    const rows = check(await db().from('lesson_events').select(EVENT_COLUMNS)
      .eq('owner_id', user?.id).gte('starts_at', since.toISOString()).order('starts_at').limit(limit + 10));
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

  // ── Filer (supabase/files.sql) ──
  // En fil = { id, planId, activityId, name, size, mime, path, uploadedBy, createdAt }.
  // activityId null = hela upplägget. Själva filen ligger i Storage-hinken
  // plan-files under <planId>/<slumpat id>.<ändelse>.
  const FILE_BUCKET = 'plan-files';
  const FILE_MAX_BYTES = 25 * 1024 * 1024;
  const FILE_TYPES = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    odt: 'application/vnd.oasis.opendocument.text',
    odp: 'application/vnd.oasis.opendocument.presentation',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };

  function toFile(r) {
    return { id: String(r.id), planId: String(r.plan_id), activityId: r.activity_id || null, name: r.name, size: Number(r.size), mime: r.mime, path: r.path, uploadedBy: r.uploaded_by, createdAt: r.created_at };
  }

  // Filtypen avgörs av filändelsen (webbläsare anger inte alltid typen)
  function fileType(file) {
    const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '')?.[1] || '').toLowerCase();
    return FILE_TYPES[ext] || null;
  }

  // Varför en fil inte går att ladda upp, eller null
  function fileProblem(file) {
    if (!fileType(file)) return `${file.name}: den filtypen går inte att ladda upp. Tillåtna är PDF, Word, PowerPoint, Excel, OpenDocument, text och bilder.`;
    if (file.size > FILE_MAX_BYTES) return `${file.name} är för stor (högst 25 MB per fil).`;
    return null;
  }

  async function listPlanFiles(planId) {
    const rows = check(await db().from('plan_files').select('*').eq('plan_id', planId).order('created_at'));
    return rows.map(toFile);
  }

  async function uploadPlanFile(planId, file, activityId = null) {
    const problem = fileProblem(file);
    if (problem) throw new Error(problem);
    const mime = fileType(file);
    const random = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    // Bara a–z/0–9 i sökvägen (Storage tål inte alla tecken, t.ex. å/ä/ö); filnamnet sparas i tabellen
    const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] || '').toLowerCase();
    const path = `${planId}/${random}.${ext}`;
    const { error } = await db().storage.from(FILE_BUCKET).upload(path, file, { contentType: mime, upsert: false });
    if (error) throw error;
    try {
      const row = check(await db().from('plan_files').insert({
        plan_id: Number(planId), activity_id: activityId, name: String(file.name).slice(0, 200), size: file.size, mime, path,
      }).select('*').single());
      return toFile(row);
    } catch (e) {
      await db().storage.from(FILE_BUCKET).remove([path]).catch(() => {});
      throw e;
    }
  }

  async function removeStoredFiles(paths) {
    if (!paths.length) return;
    const { error } = await db().storage.from(FILE_BUCKET).remove(paths);
    if (error) throw error;
  }

  async function deletePlanFiles(files) {
    if (!files.length) return;
    await removeStoredFiles(files.map(f => f.path));
    check(await db().from('plan_files').delete().in('id', files.map(f => Number(f.id))));
  }

  // Tillfällig länk som laddar ner filen med sitt riktiga namn
  // Länk för att visa filen i Lossi (bild, PDF): ingen nedladdning, gäller en
  // timme och återanvänds under tiden så att miniatyrerna inte hämtas om.
  const viewUrls = new Map(); // filens id → { url, until }
  async function fileViewUrl(file) {
    const hit = viewUrls.get(file.id);
    if (hit && hit.until > Date.now()) return hit.url;
    const { data, error } = await db().storage.from(FILE_BUCKET).createSignedUrl(file.path, 3600);
    if (error) throw error;
    viewUrls.set(file.id, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }

  async function fileDownloadUrl(file) {
    const { data, error } = await db().storage.from(FILE_BUCKET).createSignedUrl(file.path, 60, { download: file.name });
    if (error) throw error;
    return data.signedUrl;
  }

  // Kopierar en lagrad fil till en ny sökväg i samma hink (samma ändelse)
  async function copyStoredFile(fromPath, toFolder) {
    const ext = (/\.([a-z0-9]+)$/i.exec(fromPath)?.[1] || '').toLowerCase();
    const random = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    const path = `${toFolder}/${random}.${ext}`;
    const { error } = await db().storage.from(FILE_BUCKET).copy(fromPath, path);
    if (error) throw error;
    return path;
  }

  // ── Marknadsplatsen (supabase/marketplace.sql) ──
  // Ett publicerat upplägg = { id, sourcePlanId, ownerId, authorName, title, subject,
  // grade, avatar, uses, publishedAt, updatedAt, state? }. Det är en ögonblicksbild:
  // upplägget och kopior av dess filer (under market/<id>/ i hinken).
  const MARKET_COLUMNS = 'id, source_plan_id, owner_id, author_name, title, subject, grade, avatar, uses, published_at, updated_at';

  function toMarket(r) {
    return {
      id: String(r.id), sourcePlanId: r.source_plan_id != null ? String(r.source_plan_id) : null, ownerId: r.owner_id,
      authorName: r.author_name || '', title: r.title || '', subject: r.subject || '', grade: r.grade || '', avatar: r.avatar || null,
      uses: r.uses || 0, publishedAt: r.published_at, updatedAt: r.updated_at, state: r.state || null,
    };
  }

  function toMarketFile(r) {
    return { id: 'm' + r.id, marketId: String(r.market_id), activityId: r.activity_id || null, name: r.name, size: Number(r.size), mime: r.mime, path: r.path };
  }

  // Alla publicerade upplägg, senast publicerade först, med antal filer
  async function listMarketPlans() {
    const [rows, files] = await Promise.all([
      db().from('market_plans').select(MARKET_COLUMNS).order('updated_at', { ascending: false }),
      db().from('market_files').select('market_id'),
    ]);
    const counts = new Map();
    (check(files) || []).forEach(f => counts.set(String(f.market_id), (counts.get(String(f.market_id)) || 0) + 1));
    return check(rows).map(r => ({ ...toMarket(r), fileCount: counts.get(String(r.id)) || 0 }));
  }

  // Ett publicerat upplägg med state och filer (null om det inte finns)
  async function getMarketPlan(id) {
    if (!/^\d+$/.test(String(id))) return null;
    const row = check(await db().from('market_plans').select('*').eq('id', id).maybeSingle());
    if (!row) return null;
    const files = check(await db().from('market_files').select('*').eq('market_id', id).order('created_at'));
    return { ...toMarket(row), files: files.map(toMarketFile) };
  }

  // Har upplägget publicerats? { id, publishedAt, updatedAt } eller null
  async function marketPlanForSource(planId) {
    const row = check(await db().from('market_plans').select('id, published_at, updated_at').eq('source_plan_id', planId).maybeSingle());
    return row ? { id: String(row.id), publishedAt: row.published_at, updatedAt: row.updated_at } : null;
  }

  async function removeMarketFiles(marketId) {
    const files = check(await db().from('market_files').select('id, path').eq('market_id', marketId));
    if (!files.length) return;
    await removeStoredFiles(files.map(f => f.path));
    check(await db().from('market_files').delete().eq('market_id', marketId));
  }

  // Publicerar (eller publicerar igen) ett eget upplägg: state + kopior av filerna
  async function publishPlan(planId, state, { authorName = '' } = {}) {
    const fields = {
      author_name: authorName.slice(0, 120), title: (state.title || '').slice(0, 300), subject: (state.subject || '').slice(0, 120),
      grade: (state.grade || '').slice(0, 60), avatar: state.avatar || null, state,
    };
    const existing = await marketPlanForSource(planId);
    let marketId;
    if (existing) {
      check(await db().from('market_plans').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', existing.id));
      marketId = existing.id;
      await removeMarketFiles(marketId);
    } else {
      marketId = String(check(await db().from('market_plans').insert({ ...fields, source_plan_id: Number(planId) }).select('id').single()).id);
    }
    const files = await listPlanFiles(planId);
    for (const f of files) {
      const path = await copyStoredFile(f.path, `market/${marketId}`);
      check(await db().from('market_files').insert({ market_id: Number(marketId), activity_id: f.activityId, name: f.name, size: f.size, mime: f.mime, path }));
    }
    return marketId;
  }

  async function unpublishPlan(marketId) {
    await removeMarketFiles(marketId);
    check(await db().from('market_plans').delete().eq('id', marketId));
  }

  // Använd: en egen kopia (i valt projekt) med kopior av filerna. Returnerar nya id:t.
  async function useMarketPlan(marketId, projectId) {
    const market = await getMarketPlan(marketId);
    if (!market) throw new Error('Upplägget finns inte längre på marknadsplatsen.');
    const state = { ...market.state, createdAt: new Date().toISOString() };
    delete state.demoKey;
    const planId = await createPlan(state, projectId);
    for (const f of market.files) {
      const path = await copyStoredFile(f.path, planId);
      check(await db().from('plan_files').insert({ plan_id: Number(planId), activity_id: f.activityId, name: f.name, size: f.size, mime: f.mime, path }));
    }
    await db().rpc('count_market_use', { mid: Number(marketId) });
    return planId;
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

  // ── Koder för att skapa konto (supabase/access-codes.sql, bara administratörer) ──
  // En kod = { id, code, validUntil (Date|null), closedAt, createdAt, active, users: [{ name, email, createdAt }] }
  async function listAccessCodes() {
    return check(await db().rpc('admin_list_access_codes')).map(r => ({
      id: String(r.id), code: r.code,
      validUntil: r.valid_until ? new Date(r.valid_until) : null,
      closedAt: r.closed_at ? new Date(r.closed_at) : null,
      createdAt: new Date(r.created_at), active: !!r.active,
      users: (r.users || []).map(u => ({ name: u.name || u.email, email: u.email, createdAt: new Date(u.created_at) })),
    }));
  }

  async function createAccessCode(validUntil) {
    return check(await db().rpc('admin_create_access_code', { p_valid_until: validUntil ? validUntil.toISOString() : null }));
  }

  async function setAccessCodeUntil(id, validUntil) {
    check(await db().rpc('admin_set_access_code_until', { p_id: Number(id), p_valid_until: validUntil ? validUntil.toISOString() : null }));
  }

  async function closeAccessCode(id, closed) {
    check(await db().rpc('admin_close_access_code', { p_id: Number(id), p_closed: !!closed }));
  }

  // Sidan kan visa "Sparar…/Kunde inte spara" (status: 'saving' | 'saved' | 'error')
  function onSaveStatus(fn) {
    statusListener = fn;
  }

  return {
    listPlans, listMyPlans, loadPlanStates, withFullStates, loadPlan, loadPlanInfo, savePlan,
    listProjects, currentProject, setCurrentProject, inviteByEmail, listProjectInvites, cancelInvite, answerInvite, listNotifications, markNotificationsRead,
    createProject, renameProject, setProjectAvatar, addProjectClass, removeProjectClass, addProjectChoice, removeProjectChoice, removeProjectMember, leaveProject, deleteProject, findMember,
    listPlanEditors, listMyEditRequests, requestPlanEdit, addPlanEditor, decidePlanEdit, removePlanEditor, createPlan, deletePlan, flushOnLeave, onSaveStatus,
    listEvents, listPlanEvents, upcomingEvents, scheduleLesson, unscheduleLesson,
    sendFeedback, listAllFeedback, updateFeedback,
    listAccessCodes, createAccessCode, setAccessCodeUntil, closeAccessCode,
    listPlanFiles, uploadPlanFile, deletePlanFiles, fileDownloadUrl, fileViewUrl, fileProblem, FILE_MAX_BYTES,
    listMarketPlans, getMarketPlan, marketPlanForSource, publishPlan, unpublishPlan, useMarketPlan,
  };
})();
