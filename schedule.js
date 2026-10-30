// ── Kalender: gemensamt för alla sidor ──
// Lektioner i upplägg kan läggas in på en tid (tabellen lesson_events via
// LossiData). Här finns det som översikt, uppläggssida och kalender delar:
// lektioner ur ett upplägg, svensk datumformatering, dialogen för att lägga
// in/flytta en lektion och gruppen Kalender i sidopanelen.
// Kräver theme.js och data.js.

const SCHEDULE_DEFAULT_DURATION = 60;

// Hela upplägget i kalendern (Detaljer i upplag.html, t.ex. när aktiviteterna
// inte ligger i grupperingar): en vanlig händelse med det här reserverade
// lesson_id i stället för en grupperings id. Ett upplägg ligger inne en gång.
const WHOLE_PLAN_ID = 'plan';

// ── Lektioner i ett upplägg ──
// Lektionerna ligger i state.structureHTML som .lesson-group med ett fast
// id (data-lesson-id). Äldre upplägg saknar id tills de öppnas eller schemaläggs.
function newLessonId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function parseStructure(state) {
  const tpl = document.createElement('template');
  tpl.innerHTML = state?.structureHTML || '';
  return tpl;
}

function lessonDuration(group) {
  const m = /(\d+)/.exec(group.querySelector('.lesson-time-pill-value')?.textContent || '');
  return m ? parseInt(m[1], 10) : null;
}

// [{ id, name, durationMin }] i uppläggets ordning
// assessment: 'prov' | 'inlamning' | null (lektionens ⋯-meny i upplag.html)
function lessonsFromState(state) {
  return [...parseStructure(state).content.querySelectorAll('.lesson-group')].map((g, i) => ({
    id: g.dataset.lessonId || null,
    name: g.querySelector('.week-pill')?.textContent.trim() || `Gruppering ${i + 1}`,
    durationMin: lessonDuration(g),
    assessment: LESSON_ASSESSMENTS[g.dataset.assessment] ? g.dataset.assessment : null,
  }));
}

// Lektioner som kan markeras som prov eller inlämning (syns i kalendern,
// och räknas när kalendern varnar för hög belastning på en klass)
const LESSON_ASSESSMENTS = {
  prov: { label: 'Prov', icon: 'file-pen-line' },
  inlamning: { label: 'Inlämning', icon: 'inbox' },
};

// Ger alla lektioner ett id; returnerar { state, changed }
function withLessonIds(state) {
  const tpl = parseStructure(state);
  let changed = false;
  tpl.content.querySelectorAll('.lesson-group').forEach(g => {
    if (!g.dataset.lessonId) { g.dataset.lessonId = newLessonId(); changed = true; }
  });
  return { state: changed ? { ...state, structureHTML: tpl.innerHTML } : state, changed };
}

// Sätter en lektions längd (lektionens tidspill) i ett sparat upplägg
function withLessonDuration(state, lessonId, minutes) {
  const tpl = parseStructure(state);
  const value = tpl.content.querySelector(`.lesson-group[data-lesson-id="${CSS.escape(lessonId)}"] .lesson-time-pill-value`);
  if (!value || lessonDuration(value.closest('.lesson-group')) === minutes) return state;
  value.textContent = String(minutes);
  return { ...state, structureHTML: tpl.innerHTML };
}

// ── Datum och tid ──
function eventEnd(event) {
  return new Date(event.start.getTime() + event.durationMin * 60000);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatTime(date) {
  return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

// "idag", "imorgon", "tis" (inom en vecka) eller "20 okt"
function formatDay(date, { long = false } = {}) {
  const diff = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  if (diff === 0) return 'idag';
  if (diff === 1) return 'imorgon';
  if (diff > 1 && diff < 7 && !long) return date.toLocaleDateString('sv-SE', { weekday: 'short' });
  return date.toLocaleDateString('sv-SE', long
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short' });
}

function formatEventWhen(event, opts) {
  return `${formatDay(event.start, opts)} ${formatTime(event.start)}–${formatTime(eventEnd(event))}`;
}

function toDateInputValue(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// ── Händelser + upplägg ──
// Kopplar händelser till sina upplägg och lektioner. Händelser vars upplägg
// eller lektion inte finns längre hoppas över. Lektionens egen längd (om
// satt) gäller före den sparade, så att kalendern följer upplägget.
function resolveEvents(events, plans) {
  const byId = new Map(plans.map(p => [p.id, p]));
  return events.flatMap(e => {
    const plan = byId.get(e.planId);
    if (!plan) return [];
    const wholePlan = e.lessonId === WHOLE_PLAN_ID;
    const lessons = lessonsFromState(plan.state);
    const lesson = lessons.find(l => l.id === e.lessonId);
    if (plan.state?.structureHTML && !lesson && !wholePlan) return [];
    const summary = getPlanSummary(plan.id, plan.state);
    return [{
      ...e,
      durationMin: lesson?.durationMin || e.durationMin,
      plan: summary,
      klass: plan.state?.klass || '',
      wholePlan,
      lessonName: wholePlan ? summary.title : lesson?.name || 'Gruppering',
      assessment: lesson?.assessment || null,
    }];
  });
}

// Uppläggen med hela state där det finns händelser (resolveEvents behöver lektionsnamnen)
async function withEventStates(plans, events) {
  const ids = new Set(events.map(e => e.planId));
  const full = await LossiData.withFullStates(plans.filter(p => ids.has(p.id)));
  const byId = new Map(full.map(p => [p.id, p]));
  return plans.map(p => byId.get(p.id) || p);
}

// De närmaste inlagda lektionerna i valt projekt (Kommande i sidopanelen och på översikten).
// Kalendersidan visar också bara valt projekt. Sidopanelen och översikten frågar
// samtidigt när sidan laddas; då görs hämtningen en gång.
const upcomingRequests = new Map();
function upcomingInCurrentProject(limit = 3) {
  return LossiData.currentProject().catch(() => null).then(project => {
    const key = project?.id || '';
    if (!upcomingRequests.has(key)) {
      const request = (async () => {
        const [events, plans] = await Promise.all([
          LossiData.upcomingEvents(30),
          LossiData.listPlans(project ? { projectId: project.id } : {}),
        ]);
        return resolveEvents(events, await withEventStates(plans, events));
      })();
      upcomingRequests.set(key, request);
      request.finally(() => upcomingRequests.delete(key)).catch(() => {});
    }
    return upcomingRequests.get(key).then(list => list.slice(0, limit));
  });
}

// ── Gruppen Kalender i sidopanelen: kommande lektioner ──
async function renderAsideEvents() {
  const list = document.querySelector('.aside-events-list');
  if (!list) return;
  try {
    const upcoming = await upcomingInCurrentProject(3);
    list.innerHTML = upcoming.length
      ? upcoming.map(e => `
        <a href="upplag.html?id=${e.planId}" class="aside-item" title="${escapeHTML(e.lessonName)} · ${escapeHTML(formatEventWhen(e, { long: true }))}">
          <span class="aside-dot"></span>
          <span class="aside-item-text">${escapeHTML(e.plan.title)}</span>
          <span class="aside-item-meta">${escapeHTML(formatDay(e.start))} ${formatTime(e.start)}</span>
        </a>`).join('')
      : '<div class="aside-item is-placeholder aside-empty">Inget inplanerat</div>';
    rememberAsidePart('events', list.innerHTML);
  } catch (e) {
    console.warn('Kunde inte hämta kommande händelser:', e);
    list.innerHTML = '<div class="aside-item is-placeholder aside-empty">Kalendern är inte tillgänglig</div>';
  }
}

// ── Dialogen: lägg in / flytta en lektion ──
// openScheduleModal({
//   planId, lessonId, planTitle, lessonName  – en bestämd lektion, eller
//   plans                                    – låt läraren välja upplägg + lektion (från kalendern)
//   event, start, durationMin, onSaved(event), onRemoved()
// })
let scheduleCtx = null;

function buildScheduleModalHTML() {
  return `
<div class="modal-overlay" id="scheduleModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 id="scheduleModalTitle">Lägg in i kalendern</h3>
      <button class="btn btn-text btn-icon modal-close" onclick="closeScheduleModal()">
        <i data-lucide="x"></i>
      </button>
    </div>
    <form class="modal-body" id="scheduleForm" onsubmit="event.preventDefault(); saveSchedule()">
      <div class="schedule-target" id="scheduleTarget"></div>
      <div class="field-group" id="schedulePlanGroup">
        <label class="field-label" for="schedulePlan">Upplägg</label>
        <div class="field-group-content">
          <select class="field-input" id="schedulePlan" onchange="fillScheduleLessons()"></select>
        </div>
      </div>
      <div class="field-group" id="scheduleLessonGroup">
        <label class="field-label" for="scheduleLesson">Gruppering</label>
        <div class="field-group-content">
          <select class="field-input" id="scheduleLesson" onchange="syncScheduleDuration()"></select>
          <p class="schedule-hint" id="scheduleLessonHint" hidden></p>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="scheduleDate">Datum</label>
        <div class="field-group-content">
          <input class="field-input" type="date" id="scheduleDate" required />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="scheduleTime">Tid</label>
        <div class="field-group-content">
          <div class="schedule-time-row">
            <input class="field-input" type="time" id="scheduleTime" step="300" required aria-label="Starttid" oninput="shiftScheduleEnd()" />
            <span class="schedule-time-sep">–</span>
            <input class="field-input" type="time" id="scheduleEnd" step="300" required aria-label="Sluttid" oninput="rememberScheduleLength()" />
          </div>
          <span class="schedule-hint" id="scheduleLengthHint"></span>
        </div>
      </div>
      <p class="password-message is-error" id="scheduleError" role="alert" hidden></p>
      <button type="submit" hidden></button>
    </form>
    <div class="modal-footer schedule-footer">
      <button class="btn btn-outline schedule-remove" id="scheduleRemoveBtn" onclick="removeSchedule()" hidden>
        <i data-lucide="calendar-x"></i>
        Ta bort från kalendern
      </button>
      <button class="btn btn-outline" onclick="closeScheduleModal()">Avbryt</button>
      <button class="btn btn-solid" id="scheduleSaveBtn" onclick="saveSchedule()">Spara</button>
    </div>
  </div>
</div>`;
}

function ensureScheduleModal() {
  if (document.getElementById('scheduleModal')) return;
  document.body.insertAdjacentHTML('beforeend', buildScheduleModalHTML());
  const modal = document.getElementById('scheduleModal');
  modal.addEventListener('click', e => { if (e.target === modal) closeScheduleModal(); });
  lucide.createIcons({ nodes: [modal] });
}

function showScheduleError(text) {
  const el = document.getElementById('scheduleError');
  el.textContent = text;
  el.hidden = !text;
}

function openScheduleModal(ctx) {
  ensureScheduleModal();
  scheduleCtx = { ...ctx };
  const picking = !!ctx.plans;
  const start = ctx.event?.start || ctx.start || nextRoundedHour();
  document.getElementById('scheduleModalTitle').textContent = ctx.event ? 'Ändra tid' : 'Lägg in i kalendern';
  document.getElementById('scheduleTarget').hidden = picking;
  document.getElementById('scheduleTarget').innerHTML = picking ? '' : `
    <span class="schedule-target-lesson">${escapeHTML(ctx.lessonName || 'Gruppering')}</span>
    <span class="schedule-target-plan">${escapeHTML(ctx.planTitle || '')}</span>`;
  document.getElementById('schedulePlanGroup').hidden = !picking;
  document.getElementById('scheduleLessonGroup').hidden = !picking;
  document.getElementById('scheduleDate').value = toDateInputValue(start);
  document.getElementById('scheduleTime').value = formatTime(start);
  setScheduleLength(ctx.event?.durationMin || ctx.durationMin || SCHEDULE_DEFAULT_DURATION);
  document.getElementById('scheduleRemoveBtn').hidden = !ctx.event;
  document.getElementById('scheduleSaveBtn').disabled = false;
  showScheduleError('');
  if (picking) {
    const select = document.getElementById('schedulePlan');
    select.innerHTML = ctx.plans.map(p => `<option value="${p.id}">${escapeHTML(getPlanSummary(p.id, p.state).title)}</option>`).join('');
    fillScheduleLessons();
  }
  document.getElementById('scheduleModal').classList.add('open');
  (picking ? document.getElementById('schedulePlan') : document.getElementById('scheduleDate')).focus();
}

function closeScheduleModal() {
  document.getElementById('scheduleModal')?.classList.remove('open');
  scheduleCtx = null;
}

function nextRoundedHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

// Kalenderläget: lektionerna i valt upplägg, med info om de redan ligger inne,
// och sist hela upplägget (det enda valet när upplägget saknar grupperingar)
function fillScheduleLessons() {
  const plan = scheduleCtx.plans.find(p => p.id === document.getElementById('schedulePlan').value);
  const lessons = lessonsFromState(plan?.state);
  const select = document.getElementById('scheduleLesson');
  const hint = document.getElementById('scheduleLessonHint');
  const booked = scheduleCtx.eventsByKey || new Map();
  select.innerHTML = lessons.map((l, i) => {
    const existing = l.id && booked.get(plan.id + ':' + l.id);
    const note = existing ? ` (inlagd ${formatDay(existing.start)} ${formatTime(existing.start)})` : '';
    return `<option value="${i}">${escapeHTML(l.name + note)}</option>`;
  }).join('') + (plan ? `<option value="${WHOLE_PLAN_ID}">Hela upplägget</option>` : '');
  select.disabled = !plan;
  hint.hidden = true;
  syncScheduleDuration();
}

function syncScheduleDuration() {
  if (!scheduleCtx?.plans) return;
  const plan = scheduleCtx.plans.find(p => p.id === document.getElementById('schedulePlan').value);
  const choice = document.getElementById('scheduleLesson').value;
  const whole = choice === WHOLE_PLAN_ID;
  const lesson = whole ? null : lessonsFromState(plan?.state)[Number(choice)];
  if (lesson?.durationMin) setScheduleLength(lesson.durationMin);
  const key = whole ? WHOLE_PLAN_ID : lesson?.id;
  const booked = key && scheduleCtx.eventsByKey?.get(plan.id + ':' + key);
  const hint = document.getElementById('scheduleLessonHint');
  hint.hidden = !booked;
  hint.textContent = booked ? `${whole ? 'Upplägget' : 'Grupperingen'} ligger redan i kalendern och flyttas till den nya tiden.` : '';
}

// ── Start- och sluttid ──
// Läraren anger t.ex. 10:00–12:00. Ändras starttiden flyttas sluttiden med
// så att längden behålls; ändras sluttiden blir det den nya längden.
let scheduleLengthMin = SCHEDULE_DEFAULT_DURATION;

function timeToMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(value || '');
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function minutesToTime(total) {
  const t = Math.max(0, Math.min(total, 23 * 60 + 59));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function formatLength(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

function updateScheduleLengthHint() {
  const start = timeToMinutes(document.getElementById('scheduleTime').value);
  const end = timeToMinutes(document.getElementById('scheduleEnd').value);
  document.getElementById('scheduleLengthHint').textContent =
    start !== null && end !== null && end > start ? `Längd: ${formatLength(end - start)}` : '';
}

function setScheduleLength(min) {
  scheduleLengthMin = min;
  const start = timeToMinutes(document.getElementById('scheduleTime').value);
  if (start !== null) document.getElementById('scheduleEnd').value = minutesToTime(start + min);
  updateScheduleLengthHint();
}

function shiftScheduleEnd() {
  setScheduleLength(scheduleLengthMin);
}

function rememberScheduleLength() {
  const start = timeToMinutes(document.getElementById('scheduleTime').value);
  const end = timeToMinutes(document.getElementById('scheduleEnd').value);
  if (start !== null && end !== null && end > start) scheduleLengthMin = end - start;
  updateScheduleLengthHint();
}

function readScheduleForm() {
  const date = document.getElementById('scheduleDate').value;
  const start = timeToMinutes(document.getElementById('scheduleTime').value);
  const end = timeToMinutes(document.getElementById('scheduleEnd').value);
  if (!date || start === null || end === null) return { error: 'Välj datum, starttid och sluttid.' };
  if (end <= start) return { error: 'Sluttiden behöver vara efter starttiden.' };
  const durationMin = end - start;
  if (durationMin < 5 || durationMin > 600) return { error: 'Tiden behöver vara mellan 5 minuter och 10 timmar.' };
  const [y, mo, d] = date.split('-').map(Number);
  return { start: new Date(y, mo - 1, d, Math.floor(start / 60), start % 60), durationMin };
}

async function saveSchedule() {
  if (!scheduleCtx) return;
  const form = readScheduleForm();
  if (form.error) return showScheduleError(form.error);
  const btn = document.getElementById('scheduleSaveBtn');
  btn.disabled = true;
  try {
    let { planId, lessonId } = scheduleCtx;
    if (scheduleCtx.plans) {
      // Från kalendern: lektionen behöver ett fast id och rätt längd i upplägget
      const plan = scheduleCtx.plans.find(p => p.id === document.getElementById('schedulePlan').value);
      const choice = document.getElementById('scheduleLesson').value;
      if (!plan) throw new Error('Välj en gruppering.');
      if (choice === WHOLE_PLAN_ID) {
        lessonId = WHOLE_PLAN_ID;
      } else {
        const index = Number(choice);
        if (!lessonsFromState(plan.state)[index]) throw new Error('Välj en gruppering.');
        let { state } = withLessonIds(plan.state);
        lessonId = lessonsFromState(state)[index].id;
        state = withLessonDuration(state, lessonId, form.durationMin);
        if (state !== plan.state) {
          await LossiData.savePlan(plan.id, state);
          plan.state = state;
        }
      }
      planId = plan.id;
    }
    const event = await LossiData.scheduleLesson({ planId, lessonId, start: form.start, durationMin: form.durationMin });
    const done = scheduleCtx.onSaved;
    closeScheduleModal();
    done?.(event);
  } catch (e) {
    console.warn('Kunde inte lägga in lektionen:', e);
    showScheduleError(e.message === 'Välj en gruppering.' ? e.message
      // PGRST205: tabellen lesson_events finns inte (supabase/calendar.sql har inte körts)
      : e.code === 'PGRST205' ? 'Kalendern är inte aktiverad i databasen än. Kör supabase/calendar.sql i Supabase.'
      : 'Kunde inte spara i kalendern. Försök igen om en stund.');
    btn.disabled = false;
  }
}

async function removeSchedule() {
  const ev = scheduleCtx?.event;
  if (!ev) return;
  try {
    await LossiData.unscheduleLesson(ev.planId, ev.lessonId);
    const done = scheduleCtx.onRemoved;
    closeScheduleModal();
    done?.(ev);
  } catch (e) {
    console.warn('Kunde inte ta bort från kalendern:', e);
    showScheduleError('Kunde inte ta bort från kalendern. Försök igen om en stund.');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('scheduleModal')?.classList.contains('open')) closeScheduleModal();
});
