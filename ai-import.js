// ── Skapa med AI ──
// Läraren kopierar en instruktion (LOSSI_AI_PROMPT) till sin egen AI
// (Claude, ChatGPT …), tar fram upplägget i samtal med den och klistrar in
// AI:ns svar här. Lossi skickar ingenting till någon AI.
//
// Svaret är ett JSON-kodblock i Lossi-formatet (version 1, se prompten).
// parseLossiAi() läser det förlåtande men strikt: bara kända fält, ren text
// (allt escapas i plan-markup.js), gränser för längd och antal. Upplägget
// sparas sedan som vilket nytt upplägg som helst (LossiData.createPlan), så
// databasens regler gäller precis som vanligt.
//
// Kräver theme.js, data.js, schedule.js (newLessonId) och plan-markup.js.

const AI_FORMAT_VERSION = 1;
const AI_LIMITS = {
  title: 150,
  text: 3000,
  listItems: 30,
  listItem: 500,
  lessons: 40,
  activities: 30,
  activityTitle: 200,
  minutes: 600,
};

const LOSSI_AI_PROMPT = `Du hjälper en lärare att planera ett pedagogiskt upplägg som ska läggas in i Lossi, en tjänst där lärare planerar undervisning. Svara på svenska.

## Så arbetar vi
1. Prata först med läraren om upplägget: ämne, årskurs eller kurs, syfte, hur många lektioner och hur långa de är, arbetssätt och vad eleverna ska lära sig. Ställ frågor, ge förslag och justera tills läraren är nöjd. Hitta inte på källor, citat eller statistik.
2. När läraren ber om "Lossi-inmatningen" (eller säger att ni är klara) svarar du med ETT kodblock i formatet nedan och ingenting annat i kodblocket. Läraren klistrar in det i Lossi.
3. Om läraren vill ändra något efteråt: ge ett nytt, komplett kodblock.

## Så ser ett upplägg ut i Lossi
- titel: kort namn, gärna "Ämne – vinkel", t.ex. "Fotosyntes – från molekyl till ekosystem".
- amne: t.ex. "Biologi".
- arskurs: en av "4", "5", "6", "7", "8", "9" (grundskolan). Lämna tom ("") för gymnasiet eller om det är oklart.
- beskrivning: 2–4 meningar om uppläggets syfte och upplägg.
- centraltInnehall: 3–6 punkter ur det centrala innehållet (Lgr22 eller GY25) som upplägget behandlar.
- betygskriterier: de delar av betygskriterierna som upplägget ger eleven chans att visa. Ingen E/C/A-matris – bedömningen är samlad.
- lektioner: i ordning. Varje lektion har ett namn ("Lektion 1: …"), längd i minuter och aktiviteter.
- aktiviteter: typ, titel, minuter och beskrivning. Typ är en av: "Genomgång" (läraren går igenom), "Diskussion" (samtal i par, grupp eller helklass), "Aktivitet" (övning, grupparbete, laboration, skrivande), "Läsning" (eleverna läser) eller "Exit ticket" (kort avstämning i slutet). Aktiviteternas minuter ska tillsammans rymmas i lektionens längd.
- Skriv inga elevnamn eller andra personuppgifter.

## Format (kopiera exakt, byt bara innehållet)
\`\`\`json
{
  "lossi": ${AI_FORMAT_VERSION},
  "titel": "…",
  "amne": "…",
  "arskurs": "…",
  "beskrivning": "…",
  "centraltInnehall": ["…", "…"],
  "betygskriterier": ["…", "…"],
  "lektioner": [
    {
      "namn": "Lektion 1: …",
      "minuter": 60,
      "aktiviteter": [
        { "typ": "Genomgång", "titel": "…", "minuter": 15, "beskrivning": "…" }
      ]
    }
  ]
}
\`\`\`

Bekräfta kort att du förstått och fråga sedan läraren vad upplägget ska handla om.`;

// Fyll i med AI: samma regler, plus upplägget som det ser ut nu (med lektionernas koder)
function buildFillPrompt(current) {
  return LOSSI_AI_PROMPT
    .replace('Du hjälper en lärare att planera ett pedagogiskt upplägg som ska läggas in i Lossi',
      'Du hjälper en lärare att arbeta vidare på ett pedagogiskt upplägg som redan finns i Lossi')
    .replace('Bekräfta kort att du förstått och fråga sedan läraren vad upplägget ska handla om.', `## Upplägget som det ser ut nu
Varje lektion har en "kod". Det här gäller när du ger Lossi-inmatningen:
- Behåll koden på de lektioner du ändrar, så att Lossi hittar dem (de kan redan ligga i lärarens kalender).
- Nya lektioner får ingen kod. De läggs sist i upplägget.
- Lektioner du utelämnar lämnas orörda, och ingenting tas bort. Vill läraren ta bort något gör hen det själv i Lossi.
- Tar du med "aktiviteter" för en lektion ersätter de lektionens nuvarande aktiviteter, så ta med alla som ska finnas kvar.
- Fält du utelämnar (t.ex. titel eller betygskriterier) lämnas orörda.

\`\`\`json
${JSON.stringify(current, null, 2)}
\`\`\`

Bekräfta kort att du förstått och fråga sedan läraren vad hen vill göra med upplägget.`);
}

// ── Tolka svaret ──

// Plockar ut JSON ur AI:ns svar: helst ur ett kodblock, annars från första { till sista }
function extractAiJson(text) {
  const candidates = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(text))) candidates.push(m[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    for (const variant of [c, c.replace(/[“”„]/g, '"')]) {
      try {
        const value = JSON.parse(variant);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch (e) {}
    }
  }
  return null;
}

// Första värdet som finns bland nycklarna (tål t.ex. "titel"/"title")
function aiPick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const hit = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    if (hit !== undefined && obj[hit] != null) return obj[hit];
  }
  return undefined;
}

function aiText(value, max) {
  if (value == null) return '';
  if (Array.isArray(value)) value = value.join('\n');
  if (typeof value === 'object') return '';
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function aiMinutes(value) {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? '').replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), AI_LIMITS.minutes);
}

function aiList(value) {
  if (typeof value === 'string') value = value.split('\n');
  if (!Array.isArray(value)) return [];
  return value.map(v => aiText(v, AI_LIMITS.listItem).replace(/^[-•*]\s*/, '')).filter(Boolean).slice(0, AI_LIMITS.listItems);
}

const AI_TYPE_ALIASES = {
  'genomgång': 'Genomgång', 'genomgang': 'Genomgång', 'föreläsning': 'Genomgång', 'introduktion': 'Genomgång',
  'diskussion': 'Diskussion', 'samtal': 'Diskussion', 'reflektion': 'Diskussion',
  'aktivitet': 'Aktivitet', 'övning': 'Aktivitet', 'grupparbete': 'Aktivitet', 'uppgift': 'Aktivitet', 'laboration': 'Aktivitet',
  'läsning': 'Läsning', 'läs': 'Läsning', 'lasning': 'Läsning',
  'exit ticket': 'Exit ticket', 'exit-ticket': 'Exit ticket', 'exitticket': 'Exit ticket', 'avstämning': 'Exit ticket',
};

function aiActivityType(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return AI_TYPE_ALIASES[key] || null;
}

// → { plan, warnings } eller { error }
// fill = true: ändringar i ett befintligt upplägg (Fyll i med AI). Då är alla
// fält frivilliga; plan.has säger vilka listor som fanns med, och lektioner
// med kod pekar på befintliga lektioner.
function parseLossiAi(text, { fill = false } = {}) {
  if (!String(text || '').trim()) return { error: 'Klistra in svaret från din AI först.' };
  const data = extractAiJson(String(text));
  if (!data) {
    return { error: 'Hittade ingen Lossi-inmatning i texten. Be din AI om "Lossi-inmatningen" och klistra in hela svaret, med kodblocket.' };
  }
  const warnings = [];

  const title = aiText(aiPick(data, 'titel', 'title'), AI_LIMITS.title);
  if (!title && !fill) return { error: 'Inmatningen saknar titel. Be din AI om en ny, komplett Lossi-inmatning.' };

  let grade = aiText(aiPick(data, 'arskurs', 'årskurs', 'grade'), 20).replace(/^(åk|årskurs)\s*/i, '');
  if (grade && !PLAN_GRADES.includes(grade)) {
    warnings.push(`Årskurs "${grade}" finns inte att välja i Lossi än, så den lämnas tom. Du kan ändra under Detaljer.`);
    grade = '';
  }

  const rawLessons = aiPick(data, 'lektioner', 'lessons');
  const lessonList = Array.isArray(rawLessons) ? rawLessons : [];
  if (lessonList.length > AI_LIMITS.lessons) warnings.push(`Bara de ${AI_LIMITS.lessons} första lektionerna tas med.`);

  const lessons = lessonList.slice(0, AI_LIMITS.lessons).map((l, i) => {
    let name = aiText(aiPick(l, 'namn', 'name', 'titel', 'title'), AI_LIMITS.title);
    if (!fill && !/^lektion\b/i.test(name)) name = `Lektion ${i + 1}` + (name ? `: ${name}` : '');
    const label = name || `Lektion ${i + 1}`;
    const minutes = aiMinutes(aiPick(l, 'minuter', 'minutes', 'langd', 'längd'));
    const rawActivities = aiPick(l, 'aktiviteter', 'activities', 'moment');
    const hasActivities = Array.isArray(rawActivities);
    const activityList = Array.isArray(rawActivities) ? rawActivities : [];
    if (activityList.length > AI_LIMITS.activities) warnings.push(`${label}: bara de ${AI_LIMITS.activities} första aktiviteterna tas med.`);
    const activities = activityList.slice(0, AI_LIMITS.activities).map(a => {
      const rawType = aiPick(a, 'typ', 'type');
      let type = aiActivityType(rawType);
      if (!type) {
        if (rawType) warnings.push(`${label}: typen "${aiText(rawType, 40)}" finns inte i Lossi och blir "Aktivitet".`);
        type = 'Aktivitet';
      }
      return {
        type,
        title: aiText(aiPick(a, 'titel', 'title', 'namn', 'name'), AI_LIMITS.activityTitle) || type,
        minutes: aiMinutes(aiPick(a, 'minuter', 'minutes', 'tid')),
        desc: aiText(aiPick(a, 'beskrivning', 'description'), AI_LIMITS.text),
      };
    }).filter(a => a.title);
    const sum = activities.reduce((s, a) => s + (a.minutes || 0), 0);
    if (minutes && sum > minutes) warnings.push(`${label}: aktiviteterna är ${sum} min men lektionen ${minutes} min.`);
    return { code: aiText(aiPick(l, 'kod', 'code'), 40), name, minutes, activities, hasActivities };
  });
  if (!lessons.length && !fill) warnings.push('Inmatningen har inga lektioner. Upplägget skapas ändå, och du kan lägga till lektioner själv.');
  const has = key => aiPick(data, ...key) !== undefined;

  return {
    plan: {
      title,
      subject: normalizeChoice(aiText(aiPick(data, 'amne', 'ämne', 'subject'), 60)),
      grade,
      description: aiText(aiPick(data, 'beskrivning', 'description'), AI_LIMITS.text),
      goals: aiList(aiPick(data, 'centraltInnehall', 'centraltInnehåll', 'centralt_innehall', 'goals')),
      criteria: aiList(aiPick(data, 'betygskriterier', 'criteria')),
      lessons,
      has: {
        goals: has(['centraltInnehall', 'centraltInnehåll', 'centralt_innehall', 'goals']),
        criteria: has(['betygskriterier', 'criteria']),
      },
    },
    warnings,
  };
}

// Ett nytt upplägg (samma form som saveState() i upplag.html) från en tolkad inmatning
function planStateFromAi(plan, avatar) {
  let next = 1;
  const structureHTML = plan.lessons.map(l => buildLessonGroupHTML({
    lessonId: newLessonId(),
    name: l.name,
    minutes: l.minutes,
    activities: l.activities.map(a => ({ id: 'act' + next++, type: a.type, title: a.title, time: a.minutes, desc: a.desc })),
  })).join('');
  return {
    title: plan.title,
    description: textToHTML(plan.description),
    klass: '',
    subject: plan.subject,
    grade: plan.grade,
    avatar,
    statusKey: 'status-upcoming',
    statusLabel: 'Kommande',
    goalsHTML: buildGoalListHTML('goalsList', plan.goals),
    criteriaHTML: buildGoalListHTML('criteriaList', plan.criteria),
    structureHTML,
    createdAt: new Date().toISOString(),
  };
}

// ── Dialogen ──

function buildAiPlanModalHTML() {
  return `
<div class="modal-overlay" id="aiPlanModal">
  <div class="modal ai-modal">
    <div class="modal-header">
      <h3><i data-lucide="sparkles" class="ai-modal-icon"></i><span id="aiModalTitle">Skapa med AI</span></h3>
      <button class="modal-close" onclick="closeAiPlanModal()"><i data-lucide="x"></i></button>
    </div>

    <div class="modal-body ai-step" id="aiStepPaste">
      <section class="ai-section">
        <div class="ai-section-head"><span class="ai-step-num">1</span>Ge din AI Lossis instruktion</div>
        <p class="ai-help" id="aiHelp"></p>
        <div class="ai-actions">
          <button type="button" class="btn-primary" id="aiCopyBtn" onclick="copyAiPrompt()"><i data-lucide="copy"></i><span>Kopiera instruktion</span></button>
          <button type="button" class="btn-ghost" onclick="toggleAiPrompt()" id="aiShowPromptBtn">Visa instruktionen</button>
        </div>
        <textarea class="field-input ai-prompt" id="aiPrompt" readonly hidden></textarea>
      </section>

      <section class="ai-section">
        <div class="ai-section-head"><span class="ai-step-num">2</span>Klistra in svaret</div>
        <textarea class="field-input ai-paste" id="aiPaste" placeholder="Klistra in hela svaret från din AI här" oninput="showAiError('')"></textarea>
        <p class="password-message is-error" id="aiError" role="alert" hidden></p>
        <p class="ai-fine"><i data-lucide="shield-check"></i>Lossi skickar inget till din AI. Skriv inga elevnamn i samtalet.</p>
      </section>
    </div>

    <div class="modal-body ai-step" id="aiStepPreview" hidden>
      <div class="ai-preview" id="aiPreview"></div>
    </div>

    <div class="modal-footer">
      <button class="btn-ghost" id="aiBackBtn" onclick="aiBack()">Avbryt</button>
      <button class="btn-primary" id="aiNextBtn" onclick="aiNext()">Granska</button>
    </div>
  </div>
</div>`;
}

let aiParsed = null;
let aiPromptText = LOSSI_AI_PROMPT;
// Fyll i med AI (upplag.html): { current() → upplägget i Lossi-formatet, previewHTML(result), apply(plan) }
let aiFill = null;

const AI_HELP = {
  create: 'Kopiera instruktionen och klistra in den i Claude, ChatGPT eller den AI du brukar använda. Prata sedan med din AI om upplägget, så länge du vill. När ni är nöjda ber du om <strong>Lossi-inmatningen</strong>.',
  fill: 'Instruktionen innehåller upplägget som det ser ut nu. Klistra in den i din AI och be den t.ex. fylla lektionerna med aktiviteter eller skriva betygskriterier. När ni är nöjda ber du om <strong>Lossi-inmatningen</strong>.',
};

function openAiPlanModal() {
  aiFill = null;
  showAiModal('create', LOSSI_AI_PROMPT);
}

function openAiFillModal(fill) {
  aiFill = fill;
  showAiModal('fill', buildFillPrompt(fill.current()));
}

function showAiModal(mode, prompt) {
  if (!document.getElementById('aiPlanModal')) {
    document.body.insertAdjacentHTML('beforeend', buildAiPlanModalHTML());
    document.getElementById('aiPlanModal').addEventListener('click', e => {
      if (e.target.id === 'aiPlanModal') closeAiPlanModal();
    });
  }
  aiPromptText = prompt;
  document.getElementById('aiPrompt').value = prompt;
  document.getElementById('aiModalTitle').textContent = mode === 'fill' ? 'Fyll i med AI' : 'Skapa med AI';
  document.getElementById('aiHelp').innerHTML = AI_HELP[mode];
  toggleAiPrompt(false);
  document.getElementById('createPlanModal')?.classList.remove('open');
  aiParsed = null;
  document.getElementById('aiPaste').value = '';
  showAiError('');
  showAiStep('paste');
  document.getElementById('aiPlanModal').classList.add('open');
  lucide.createIcons({ nodes: [document.getElementById('aiPlanModal')] });
}

function closeAiPlanModal() {
  document.getElementById('aiPlanModal')?.classList.remove('open');
}

function showAiPreviewError(text) {
  const preview = document.getElementById('aiPreview');
  preview.querySelector('.ai-save-error')?.remove();
  preview.insertAdjacentHTML('afterbegin', `<p class="password-message is-error ai-save-error" role="alert">${escapeHTML(text)}</p>`);
  preview.scrollIntoView({ block: 'start' });
}

function showAiStep(step) {
  document.getElementById('aiStepPaste').hidden = step !== 'paste';
  document.getElementById('aiStepPreview').hidden = step !== 'preview';
  document.getElementById('aiBackBtn').textContent = step === 'paste' ? 'Avbryt' : 'Tillbaka';
  const next = document.getElementById('aiNextBtn');
  next.textContent = step === 'paste' ? 'Granska' : (aiFill ? 'Uppdatera upplägget' : 'Skapa upplägg');
  next.disabled = false;
  next.classList.remove('is-loading');
  next.removeAttribute('aria-busy');
  document.getElementById('aiBackBtn').disabled = false;
}

// Laddning i knappen medan något sparas (snurra + text, knapparna låsta)
function setAiLoading(label) {
  const next = document.getElementById('aiNextBtn');
  const back = document.getElementById('aiBackBtn');
  if (label) {
    next.dataset.label = next.textContent;
    next.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${escapeHTML(label)}`;
    next.setAttribute('aria-busy', 'true');
  } else {
    next.textContent = next.dataset.label || next.textContent;
    next.removeAttribute('aria-busy');
  }
  next.classList.toggle('is-loading', !!label);
  next.disabled = !!label;
  back.disabled = !!label;
}

function showAiError(text) {
  const el = document.getElementById('aiError');
  el.textContent = text;
  el.hidden = !text;
}

async function copyAiPrompt() {
  const label = document.querySelector('#aiCopyBtn span');
  try {
    await navigator.clipboard.writeText(aiPromptText);
    label.textContent = 'Kopierad!';
  } catch (e) {
    toggleAiPrompt(true);
    document.getElementById('aiPrompt').select();
    label.textContent = 'Markera och kopiera';
  }
  setTimeout(() => { label.textContent = 'Kopiera instruktion'; }, 2000);
}

function toggleAiPrompt(show) {
  const area = document.getElementById('aiPrompt');
  area.hidden = show === undefined ? !area.hidden : !show;
  document.getElementById('aiShowPromptBtn').textContent = area.hidden ? 'Visa instruktionen' : 'Dölj instruktionen';
}

function aiBack() {
  if (!document.getElementById('aiStepPreview').hidden) showAiStep('paste');
  else closeAiPlanModal();
}

async function aiNext() {
  if (!document.getElementById('aiStepPreview').hidden) return aiFill ? applyAiFill() : createPlanFromAi();
  const result = parseLossiAi(document.getElementById('aiPaste').value, { fill: !!aiFill });
  if (result.error) {
    showAiError(result.error);
    return;
  }
  aiParsed = result;
  if (aiFill) {
    const el = document.getElementById('aiPreview');
    el.innerHTML = aiFill.previewHTML(result);
    lucide.createIcons({ nodes: [el] });
  } else {
    await renderAiPreview(result);
  }
  showAiStep('preview');
}

async function renderAiPreview({ plan, warnings }) {
  const project = await LossiData.currentProject().catch(() => null);
  const activityCount = plan.lessons.reduce((n, l) => n + l.activities.length, 0);
  const meta = [plan.subject, plan.grade ? 'Åk ' + plan.grade : ''].filter(Boolean).join(' · ');
  const list = (items, empty) => items.length
    ? `<ul class="ai-preview-list">${items.map(t => `<li>${escapeHTML(t)}</li>`).join('')}</ul>`
    : `<p class="ai-preview-empty">${empty}</p>`;
  const el = document.getElementById('aiPreview');
  el.innerHTML = `
    ${warnings.length ? `<div class="ai-warnings"><i data-lucide="triangle-alert"></i><ul>${warnings.map(w => `<li>${escapeHTML(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="ai-preview-head">
      <h4 class="ai-preview-title">${escapeHTML(plan.title)}</h4>
      <p class="ai-preview-meta">${escapeHTML(meta || 'Inget ämne angivet')} · ${plan.lessons.length} ${plan.lessons.length === 1 ? 'lektion' : 'lektioner'} · ${activityCount} ${activityCount === 1 ? 'aktivitet' : 'aktiviteter'}${project ? ` · skapas i <strong>${escapeHTML(project.name)}</strong>` : ''}</p>
    </div>
    ${plan.description ? `<p class="ai-preview-desc">${textToHTML(plan.description)}</p>` : ''}
    <div class="ai-preview-label">Centralt innehåll</div>
    ${list(plan.goals, 'Inget angivet')}
    <div class="ai-preview-label">Betygskriterier</div>
    ${list(plan.criteria, 'Inget angivet')}
    <div class="ai-preview-label">Struktur och tidslinje</div>
    ${plan.lessons.map(l => {
      const sum = l.activities.reduce((s, a) => s + (a.minutes || 0), 0);
      const over = l.minutes && sum > l.minutes;
      return `
      <div class="ai-lesson">
        <div class="ai-lesson-head">
          <span class="ai-lesson-name">${escapeHTML(l.name)}</span>
          <span class="ai-lesson-time${over ? ' is-over' : ''}">${sum} / ${l.minutes ?? '–'} min</span>
        </div>
        ${l.activities.map(a => {
          const t = ACTIVITY_TYPES[a.type];
          return `<div class="ai-activity" title="${escapeHTML(a.desc)}">
            <span class="activity-icon ${t.iconClass}" title="${escapeHTML(a.type)}"><i data-lucide="${t.icon}"></i></span>
            <span class="ai-activity-title">${escapeHTML(a.title)}</span>
            <span class="ai-activity-time">${a.minutes ?? '–'} min</span>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}`;
  lucide.createIcons({ nodes: [el] });
}

function applyAiFill() {
  if (!aiParsed || !aiFill) return;
  setAiLoading('Uppdaterar upplägget…');
  // Låt snurran synas innan sidan byggs om
  requestAnimationFrame(() => setTimeout(() => {
    try {
      aiFill.apply(aiParsed.plan);
      closeAiPlanModal();
    } finally {
      setAiLoading(null);
    }
  }, 30));
}

// Förhandsgranskningens delar (delas med Fyll i med AI i upplag.html)
function aiWarningsHTML(warnings) {
  return warnings.length ? `<div class="ai-warnings"><i data-lucide="triangle-alert"></i><ul>${warnings.map(w => `<li>${escapeHTML(w)}</li>`).join('')}</ul></div>` : '';
}

function aiActivityRowsHTML(activities) {
  return activities.map(a => {
    const t = ACTIVITY_TYPES[a.type];
    return `<div class="ai-activity" title="${escapeHTML(a.desc)}">
      <span class="activity-icon ${t.iconClass}" title="${escapeHTML(a.type)}"><i data-lucide="${t.icon}"></i></span>
      <span class="ai-activity-title">${escapeHTML(a.title)}</span>
      <span class="ai-activity-time">${a.minutes ?? '–'} min</span>
    </div>`;
  }).join('');
}

async function createPlanFromAi() {
  if (!aiParsed) return;
  setAiLoading('Skapar upplägget…');
  document.querySelector('#aiPreview .ai-save-error')?.remove();
  const avatar = PLAN_AVATARS[Math.floor(Math.random() * PLAN_AVATARS.length)].id;
  try {
    const project = await LossiData.currentProject().catch(() => null);
    const state = planStateFromAi(aiParsed.plan, avatar);
    const id = await LossiData.createPlan(state, project?.id);
    if (state.subject && !subjectItems().some(i => sameChoice(i.name, state.subject))) {
      await rememberChoice('subjects', state.subject).catch(() => {});
    }
    window.location = 'upplag.html?id=' + id;
  } catch (e) {
    console.warn('Kunde inte skapa upplägget:', e);
    setAiLoading(null);
    showAiPreviewError('Kunde inte spara upplägget. Kontrollera uppkopplingen och försök igen.');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAiPlanModal();
});
