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
// Läroplanen: AI:n får aldrig skriva läroplanstext som sparas. Den anger
// kursen och pekar ut punkter (med kod när Lossi gett den listan, annars genom
// att citera Skolverket). Lossi letar upp dem i Skolverkets text och lägger in
// originalet (resolveAiCurriculum). Det som inte hittas visas i förhands-
// visningen och sparas bara som egen rad om läraren kryssar i det.
//
// Kräver theme.js, data.js, schedule.js (newLessonId), plan-markup.js och curriculum.js.

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
2. När planeringen börjar kännas färdig frågar du på ett naturligt sätt om läraren känner sig klar och vill ta med upplägget tillbaka till Lossi. Säger läraren ja (eller ber om det själv) svarar du med ETT kodblock i formatet nedan och ingenting annat i kodblocket, och berättar kort att läraren kopierar det och klistrar in det i Lossi. Använd inga tekniska ord som "JSON", "inmatning" eller "format" när du pratar med läraren.
3. Om läraren vill ändra något efteråt: ge ett nytt, komplett kodblock.

## Så ser ett upplägg ut i Lossi
- titel: kort namn, gärna "Ämne – vinkel", t.ex. "Fotosyntes – från molekyl till ekosystem".
- amne: t.ex. "Biologi".
- arskurs: kort, utan "Åk", t.ex. "7", "7–9", "F" (förskoleklass), "Förskola" eller "Gy 1" för gymnasiet. Lämna tom ("") om det är oklart.
- kurs: kursen enligt Skolverket. Gymnasiet: ämne och nivå, t.ex. "Samhällskunskap nivå 1b" (GY25) eller "Samhällskunskap 1b" (GY11). Grundskolan: ämnet, t.ex. "Samhällskunskap" (årskursen avgör stadiet). Förskoleklass: "Förskoleklassen". Förskola: "Förskolan". Lämna tom om det är oklart.
- beskrivning: 2–4 meningar om uppläggets syfte och upplägg.
- centraltInnehall: 3–6 punkter ur Skolverkets centrala innehåll för kursen som upplägget behandlar (förskolan: mål ur Lpfö 18). Skriv varje punkt ORDAGRANT som den står hos Skolverket – skriv inte om, sammanfatta eller hitta på. Lossi jämför med Skolverkets text och lägger in originalet; en punkt som inte går att hitta där läggs inte in som läroplan. Är du osäker på lydelsen, ta hellre med färre punkter.
- betygskriterier: de delar av betygskriterierna som upplägget ger eleven chans att visa, ordagrant som Skolverkets mening för betyget E. Samma regler som ovan. Förskola och förskoleklass har inga betygskriterier – lämna listan tom.
- lektioner: i ordning. Varje lektion har ett namn, längd i minuter och aktiviteter. Namnet är fritt (t.ex. "Begrepp och grundidéer" eller "Lektion 1: Begrepp") och det är läraren som bestämmer. Har innehållet ändrats så att ett namn inte längre passar, eller behöver en ny lektion ett namn, kan du föreslå ett nytt eller fråga läraren – byt aldrig namn utan att ni pratat om det.
- aktiviteter: typ, titel, minuter och beskrivning. Typ är en av: "Genomgång" (läraren går igenom), "Diskussion" (samtal i par, grupp eller helklass), "Aktivitet" (övning, grupparbete, laboration, skrivande), "Läsning" (eleverna läser) eller "Exit ticket" (kort avstämning i slutet). Aktiviteternas minuter ska tillsammans rymmas i lektionens längd.
- Skriv inga elevnamn eller andra personuppgifter.

## Format (kopiera exakt, byt bara innehållet)
\`\`\`json
{
  "lossi": ${AI_FORMAT_VERSION},
  "titel": "…",
  "amne": "…",
  "arskurs": "…",
  "kurs": "…",
  "beskrivning": "…",
  "centraltInnehall": ["…", "…"],
  "betygskriterier": ["…", "…"],
  "lektioner": [
    {
      "namn": "…",
      "minuter": 60,
      "aktiviteter": [
        { "typ": "Genomgång", "titel": "…", "minuter": 15, "beskrivning": "…" }
      ]
    }
  ]
}
\`\`\`

Bekräfta kort att du förstått och fråga sedan läraren vad upplägget ska handla om.`;

// Planera med AI: samma regler, plus upplägget som det ser ut nu (med lektionernas
// koder). Har upplägget en kurs får AI:n Skolverkets punkter med koder och svarar
// med koderna (buildCurriculumListing).
function buildFillPrompt(current, curriculumListing = '') {
  let prompt = LOSSI_AI_PROMPT;
  if (curriculumListing) {
    prompt = prompt
      .replace(/- kurs: [^\n]*\n/, '- kurs: upplägget har redan en kurs (se Läroplanen nedan). Ändra den inte.\n')
      .replace(/- centraltInnehall: [^\n]*\n/, '- centraltInnehall: koderna för de punkter ur listan under Läroplanen som upplägget behandlar, t.ex. ["c2", "c5"]. Skriv aldrig egen text här.\n')
      .replace(/- betygskriterier: [^\n]*\n/, '- betygskriterier: koderna för de kriterier ur listan under Läroplanen som upplägget ger eleven chans att visa, t.ex. ["k1"]. Skriv aldrig egen text här.\n');
  }
  return prompt
    .replace('Du hjälper en lärare att planera ett pedagogiskt upplägg som ska läggas in i Lossi',
      'Du är lärarens bollplank och hjälper hen att arbeta vidare på ett pedagogiskt upplägg som redan finns i Lossi')
    .replace(/1\. Prata först med läraren om upplägget:[^\n]*\n/,
      '1. Utgå från upplägget nedan – det är lärarens eget arbete. Fråga inte om sådant som redan står där, och ändra inte det läraren redan bestämt utan att fråga. Ge förslag, ställ frågor och justera tills läraren är nöjd. Hitta inte på källor, citat eller statistik.\n')
    .replace('Bekräfta kort att du förstått och fråga sedan läraren vad upplägget ska handla om.', `## Upplägget som det ser ut nu
Varje lektion har en "kod". Det här gäller när du ger kodblocket som tar upplägget tillbaka till Lossi:
- Behåll koden på de lektioner du ändrar, så att Lossi hittar dem (de kan redan ligga i lärarens kalender).
- Nya lektioner får ingen kod. De läggs sist i upplägget.
- Lektioner du utelämnar lämnas orörda, och ingenting tas bort. Vill läraren ta bort något gör hen det själv i Lossi.
- Tar du med "aktiviteter" för en lektion ersätter de lektionens nuvarande aktiviteter, så ta med alla som ska finnas kvar.
- Fält du utelämnar (t.ex. titel eller betygskriterier) lämnas orörda.

\`\`\`json
${JSON.stringify(current, null, 2)}
\`\`\`
${curriculumListing}
Börja med att kort sammanfatta upplägget som det ser ut nu (2–4 meningar). Peka sedan på det som verkar saknas eller kan utvecklas, till exempel lektioner utan aktiviteter, aktiviteter som inte ryms i lektionstiden, en tom beskrivning eller inget centralt innehåll, och ge 2–3 konkreta förslag på hur ni kan fortsätta. Fråga till sist läraren vad hen vill arbeta vidare med. Ge inget kodblock förrän läraren känner sig klar och vill tillbaka till Lossi.`);
}

// Skolverkets punkter för uppläggets kurs, med koder, till Fyll i-instruktionen
async function buildCurriculumListing(cur) {
  if (!cur?.subject) return '';
  const C = LossiCurriculum;
  const subj = await C.subject(cur.schoolType, cur.subject).catch(() => null);
  if (!subj) return '';
  const content = C.levelOf(subj, cur.level)?.content || [];
  const criteria = C.criteriaOf(subj, cur.level)?.items || [];
  const line = (id, text) => `- ${id}: ${C.plainText(text)}`;
  let out = `
## Läroplanen
Upplägget är kopplat till ${C.courseLabel(cur)}${cur.reform ? ` (${cur.reform})` : ''}. Här är Skolverkets text med koder. Använd koderna i kodblocket till Lossi; Lossi lägger in Skolverkets text. Prata gärna om punkterna med deras innehåll, inte med koderna.

${C.contentTitle(cur)}:
${content.map(it => line(it.id, (it.lead ? it.lead + ' ' : '') + it.text)).join('\n')}
`;
  if (criteria.length) out += `
Betygskriterier (texten för E):
${criteria.map(it => line(it.id, C.criterionText(it))).join('\n')}
`;
  return out;
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
    return { error: 'Hittade inget upplägg i texten. Säg till din AI att du är klar och vill ta med upplägget till Lossi, och klistra in hela svaret, med kodblocket.' };
  }
  const warnings = [];

  const title = aiText(aiPick(data, 'titel', 'title'), AI_LIMITS.title);
  if (!title && !fill) return { error: 'Upplägget saknar titel. Be din AI om upplägget en gång till, komplett och med titel.' };

  const grade = normalizeGrade(aiText(aiPick(data, 'arskurs', 'årskurs', 'grade'), 20));

  const rawLessons = aiPick(data, 'lektioner', 'lessons');
  const lessonList = Array.isArray(rawLessons) ? rawLessons : [];
  if (lessonList.length > AI_LIMITS.lessons) warnings.push(`Bara de ${AI_LIMITS.lessons} första lektionerna tas med.`);

  const lessons = lessonList.slice(0, AI_LIMITS.lessons).map((l, i) => {
    let name = aiText(aiPick(l, 'namn', 'name', 'titel', 'title'), AI_LIMITS.title);
    // Namnet är lärarens eget; bara en lektion utan namn får "Lektion N"
    if (!fill && !name) name = `Lektion ${i + 1}`;
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
  if (!lessons.length && !fill) warnings.push('Upplägget har inga lektioner. Det skapas ändå, och du kan lägga till lektioner själv.');
  const has = key => aiPick(data, ...key) !== undefined;

  return {
    plan: {
      title,
      subject: normalizeChoice(aiText(aiPick(data, 'amne', 'ämne', 'subject'), 60)),
      grade,
      description: aiText(aiPick(data, 'beskrivning', 'description'), AI_LIMITS.text),
      course: aiText(aiPick(data, 'kurs', 'course'), AI_LIMITS.title),
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

// ── Läroplanen i svaret ──
// → { course, courseText, courseChanged, has: { content, criteria }, content: { matched, unmatched }, criteria: … }
// current = uppläggets kurs (Fyll i med AI): då gäller den, och koder ("c3") tillåts.
async function resolveAiCurriculum(plan, current = null) {
  const C = LossiCurriculum;
  const courseText = plan.course || '';
  let course = current?.subject ? { ...current } : null;
  if (course) { delete course.content; delete course.criteria; }
  if (!course && (courseText || plan.goals.length || plan.criteria.length || C.schoolTypeForGrade(plan.grade))) {
    course = await C.findCourse({ text: courseText || plan.subject, grade: plan.grade }).catch(() => null);
  }
  const subj = course ? await C.subject(course.schoolType, course.subject).catch(() => null) : null;
  const contentItems = subj ? C.levelOf(subj, course.level)?.content || [] : [];
  const criteriaItems = subj ? C.criteriaOf(subj, course.level)?.items || [] : [];
  const opts = { allowCodes: !!current?.subject };
  const label = current?.subject ? C.courseLabel(current).toLowerCase() : '';
  return {
    course: subj ? course : null,
    courseText,
    // Fyll i: AI:n föreslog en annan kurs än upplägget har (den byts inte)
    courseChanged: !!(label && courseText && !label.includes(courseText.toLowerCase()) && !courseText.toLowerCase().includes(String(current.subjectName || '').toLowerCase())),
    has: { content: plan.has ? plan.has.goals : true, criteria: plan.has ? plan.has.criteria : true },
    content: C.matchItems(plan.goals, contentItems, 'content', opts),
    criteria: C.matchItems(plan.criteria, criteriaItems, 'criteria', opts),
  };
}

// De rader som inte hittades hos Skolverket och som läraren valt att spara som egna rader
function aiOwnRows(res, kind) {
  const picked = new Set([...document.querySelectorAll(`#aiPreview input[data-ai-own="${kind}"]:checked`)].map(i => Number(i.value)));
  return res[kind].unmatched.filter((_, i) => picked.has(i));
}

// Förhandsvisningens läroplansdel: kursen, Skolverkets punkter och det som inte hittades
function aiCurriculumPreviewHTML(res, { fill = false } = {}) {
  const C = LossiCurriculum;
  const parts = [];
  if (res.course) {
    parts.push(`<div class="ai-preview-label">Kurs</div>
      <p class="ai-course"><i data-lucide="landmark"></i><span>${escapeHTML(C.courseLabel(res.course))}</span>${res.course.reform ? `<span class="course-tag-reform">${escapeHTML(res.course.reform)}</span>` : ''}<span class="ai-course-note">${fill ? 'uppläggets kurs' : 'hittad hos Skolverket'}</span></p>`);
    if (res.courseChanged) parts.push('<p class="ai-preview-empty">AI:n föreslog en annan kurs. Kursen ändras inte här; byt den själv under Detaljer › Kurs om det behövs.</p>');
  } else if (res.courseText || res.content.unmatched.length || res.criteria.unmatched.length) {
    parts.push(`<div class="ai-preview-label">Kurs</div>
      <p class="ai-preview-empty">${res.courseText ? `"${escapeHTML(res.courseText)}" hittades inte bland Skolverkets kurser.` : 'Ingen kurs angiven.'} Välj kurs i upplägget efteråt (Detaljer › Kurs) och bocka för punkterna där.</p>`);
  }
  const section = (kind, label) => {
    const { matched, unmatched } = res[kind];
    if (!res.has[kind] || (!matched.length && !unmatched.length)) return '';
    return `<div class="ai-preview-label">${label}</div>
      ${matched.length ? `<ul class="ai-sv-list">${matched.map(it => `<li><span class="ai-sv-badge"><i data-lucide="landmark"></i>Skolverkets text</span><span>${kind === 'criteria' ? C.textHTML(C.criterionText(it)) : C.leadHTML(it) + C.textHTML(it.text)}</span></li>`).join('')}</ul>` : ''}
      ${fill && matched.length ? '<p class="ai-preview-meta">Ersätter de punkter ur Skolverkets text som är valda nu. Anteckningar och lektionskopplingar på punkter som finns kvar följer med.</p>' : ''}
      ${unmatched.length ? `<div class="ai-unmatched">
        <div class="ai-unmatched-head"><i data-lucide="triangle-alert"></i><span>${unmatched.length === 1 ? 'En punkt hittades' : `${unmatched.length} punkter hittades`} inte hos Skolverket och läggs inte in som läroplan.</span></div>
        ${unmatched.map((t, i) => `<label class="ai-unmatched-row"><input type="checkbox" data-ai-own="${kind}" value="${i}" /><span><span class="ai-unmatched-text">${escapeHTML(t)}</span><span class="ai-unmatched-hint">Spara som egen rad (inte Skolverkets text)</span></span></label>`).join('')}
      </div>` : ''}`;
  };
  parts.push(section('content', C.contentTitle(res.course)));
  if (C.hasCriteria(res.course) || res.criteria.matched.length || res.criteria.unmatched.length) parts.push(section('criteria', 'Betygskriterier'));
  return parts.join('');
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
  const res = plan.curriculum;
  const C = LossiCurriculum;
  const whole = res?.course && C.WHOLE_SCHOOL_TYPES[res.course.schoolType];
  const curriculum = res?.course ? {
    ...res.course,
    content: res.content.matched.map(it => C.savedItem(it, 'content')),
    criteria: res.criteria.matched.map(it => C.savedItem(it, 'criteria')),
  } : null;
  return {
    title: plan.title,
    description: textToHTML(plan.description),
    klass: '',
    subject: res?.course && !whole ? res.course.subjectName : plan.subject,
    grade: whole ? whole.grade : plan.grade,
    curriculum,
    avatar,
    statusKey: 'status-upcoming',
    statusLabel: 'Kommande',
    goalsHTML: buildGoalListHTML('goalsList', res ? aiOwnRows(res, 'content') : plan.goals),
    criteriaHTML: buildGoalListHTML('criteriaList', res ? aiOwnRows(res, 'criteria') : plan.criteria),
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
      <button class="btn btn-text btn-icon modal-close" onclick="closeAiPlanModal()"><i data-lucide="x"></i></button>
    </div>

    <div class="modal-body ai-step" id="aiStepPaste">
      <section class="ai-section">
        <div class="ai-section-head"><span class="ai-step-num">1</span>Ge din AI Lossis instruktion</div>
        <p class="ai-help" id="aiHelp"></p>
        <div class="ai-actions">
          <button type="button" class="btn btn-solid" id="aiCopyBtn" onclick="copyAiPrompt()"><i data-lucide="copy"></i><span>Kopiera instruktion</span></button>
          <button type="button" class="btn btn-outline" onclick="toggleAiPrompt()" id="aiShowPromptBtn">Visa instruktionen</button>
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
      <button class="btn btn-outline" id="aiBackBtn" onclick="aiBack()">Avbryt</button>
      <button class="btn btn-solid" id="aiNextBtn" onclick="aiNext()">Granska</button>
    </div>
  </div>
</div>`;
}

let aiParsed = null;
let aiPromptText = LOSSI_AI_PROMPT;
// Planera med AI (upplag.html): { current() → upplägget i Lossi-formatet, previewHTML(result), apply(plan), curriculum() }
let aiFill = null;

const AI_HELP = {
  create: 'Kopiera instruktionen och klistra in den i Claude, ChatGPT eller den AI du brukar använda. Prata sedan med din AI om upplägget, så länge du vill. När du känner dig klar ger AI:n dig upplägget att <strong>klistra in här</strong>.',
  fill: 'Instruktionen innehåller allt du har skrivit i upplägget, och Skolverkets punkter om upplägget har en kurs. Klistra in den i Claude, ChatGPT eller den AI du brukar använda: den sammanfattar upplägget, föreslår hur du kan fortsätta och blir ditt bollplank. När du känner dig klar ger AI:n dig upplägget att <strong>klistra in här</strong>.',
};

function openAiPlanModal() {
  aiFill = null;
  showAiModal('create', LOSSI_AI_PROMPT);
}

async function openAiFillModal(fill) {
  aiFill = fill;
  const listing = await buildCurriculumListing(fill.curriculum?.()).catch(() => '');
  showAiModal('fill', buildFillPrompt(fill.current(), listing));
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
  document.getElementById('aiModalTitle').textContent = mode === 'fill' ? 'Planera med AI' : 'Skapa med AI';
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
  const next = document.getElementById('aiNextBtn');
  next.disabled = true;
  try {
    result.plan.curriculum = await resolveAiCurriculum(result.plan, aiFill?.curriculum?.() || null);
  } catch (e) {
    console.warn('Kunde inte jämföra med Skolverkets text:', e);
    result.plan.curriculum = null;
  } finally {
    next.disabled = false;
  }
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
  const meta = [plan.subject, gradeLabel(plan.grade)].filter(Boolean).join(' · ');
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
    ${plan.curriculum ? aiCurriculumPreviewHTML(plan.curriculum) : `<div class="ai-preview-label">Centralt innehåll</div>
    ${list(plan.goals, 'Inget angivet')}
    <div class="ai-preview-label">Betygskriterier</div>
    ${list(plan.criteria, 'Inget angivet')}`}
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
      rememberChoiceLater('subjects', state.subject);
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
