// ── Läroplan: Skolverkets kurs- och ämnesplaner (och förskolans läroplan) ──
// Lossi hittar inte på något eget i läroplanen. Läraren väljer en kurs (eller
// ett ämne och årskurser i grundskolan) och bockar för punkter ur Skolverkets
// text; texten visas ordagrant och går inte att ändra. Lärarens egna ord står
// bredvid, som en anteckning. Texten kommer från curriculum/ (hämtas med
// scripts/fetch-curriculum.mjs ur Skolverkets Syllabus API).
//
// I upplägget sparas valen som state.curriculum:
//   { schoolType, subject, subjectName, reform, version, level, levelName,
//     content:  [{ id, heading, text, note, lessons: [lessonId], activities: [activityId] }],
//     criteria: [{ id, E, C, A } | { id, text }, + note, lessons, activities] }
// En punkt kan kopplas till hela lektioner och/eller enskilda aktiviteter;
// lektions- och aktivitetsraderna visar en tagg med antalet (renderTags).
// Raden visar bara texten (och anteckningen); klick på raden öppnar
// aktivitetspanelen med texten, anteckningen och kopplingarna (openItem).
// Texten sparas med, så att upplägget går att läsa och exportera även om
// Skolverket ändrar något. Ändrar Skolverket en punkt visas det på raden.
// Kräver escapeHTML (theme.js).
const LossiCurriculum = (() => {
  const BASE = 'curriculum/';
  let indexPromise = null;
  const subjects = new Map();

  function getJSON(path) {
    return fetch(BASE + path).then(res => {
      if (!res.ok) throw new Error(`Kunde inte hämta ${path} (${res.status})`);
      return res.json();
    });
  }

  // { fetchedAt, schoolTypes: { GY: { name, subjects: [{ code, name, reform, version, levels: [{ code, name }] }] }, GR: … } }
  function index() {
    if (!indexPromise) {
      indexPromise = getJSON('index.json');
      indexPromise.catch(() => { indexPromise = null; });
    }
    return indexPromise;
  }

  function subject(schoolType, code) {
    const key = schoolType + '/' + code;
    if (!subjects.has(key)) {
      const p = getJSON(`${encodeURIComponent(schoolType)}/${encodeURIComponent(code)}.json`);
      subjects.set(key, p);
      p.catch(() => subjects.delete(key));
    }
    return subjects.get(key);
  }

  const levelOf = (subj, levelCode) => subj?.levels.find(l => l.code === levelCode) || null;

  // Betygskriterierna för en nivå: { heading, items } eller null
  function criteriaOf(subj, levelCode) {
    const level = levelOf(subj, levelCode);
    return level?.criteria ? subj.criteria[level.criteria] || null : null;
  }

  // "Samhällskunskap nivå 1b", "Samhällskunskap 1b" (GY11), "Samhällskunskap, årskurs 4–6"
  function courseLabel({ subjectName, levelName, schoolType }) {
    if (schoolType === 'FS' || schoolType === 'FKLASS') return subjectName || '';
    if (!levelName || levelName === subjectName) return subjectName || '';
    if (levelName.startsWith(subjectName)) return levelName;
    if (schoolType === 'GR') return `${subjectName}, ${levelName.charAt(0).toLowerCase()}${levelName.slice(1)}`;
    return `${subjectName} ${levelName.charAt(0).toLowerCase()}${levelName.slice(1)}`;
  }

  // Skolverkets text med fetstilen kvar (<strong> är det enda som sparas som HTML)
  function textHTML(text) {
    return escapeHTML(text || '').replace(/&lt;(\/?)strong&gt;/g, '<$1strong>');
  }

  const plainText = text => String(text || '').replace(/<\/?strong>/g, '');

  // Kriteriets text för ett betygssteg (E, C, A), eller den enda texten
  const criterionText = (item, step = 'E') => item.text || item[step] || item.E || '';

  const sameText = (a, b) => plainText(a).replace(/\s+/g, ' ').trim() === plainText(b).replace(/\s+/g, ' ').trim();

  // Jämför en sparad punkt med Skolverkets senaste text.
  //   { status: 'same' | 'moved' | 'changed' | 'removed', item }  (item = katalogens punkt)
  // moved = samma text under ett annat id (Skolverket har lagt till eller tagit bort punkter före)
  function compare(saved, catalogItems, kind) {
    const textOf = it => kind === 'criteria' ? criterionText(it) : it.text;
    const byId = catalogItems.find(it => it.id === saved.id);
    if (byId && sameText(textOf(byId), textOf(saved))) return { status: 'same', item: byId };
    const byText = catalogItems.find(it => sameText(textOf(it), textOf(saved)));
    if (byText) return { status: 'moved', item: byText };
    if (byId) return { status: 'changed', item: byId };
    return { status: 'removed', item: null };
  }

  const SCHOOL_TYPE_NAMES = { GY: 'Gymnasieskola', GR: 'Grundskola', FKLASS: 'Förskoleklass', FS: 'Förskola' };

  // Skolformer utan ämnen och betygskriterier: ett enda val, kopplat till en årskurs
  // (Förskola → förskolans läroplan, F → förskoleklassens kapitel i Lgr22)
  const WHOLE_SCHOOL_TYPES = { FS: { grade: 'Förskola' }, FKLASS: { grade: 'F' } };
  const hasCriteria = c => !c || !WHOLE_SCHOOL_TYPES[c.schoolType];

  // Vilken av dem en årskurs hör till, eller null
  function schoolTypeForGrade(grade) {
    grade = String(grade || '').trim();
    return Object.keys(WHOLE_SCHOOL_TYPES).find(st => WHOLE_SCHOOL_TYPES[st].grade.toLowerCase() === grade.toLowerCase()) || null;
  }

  // Dokumentet texten kommer ur: "Skolverkets ämnesplan", "Lgr22, kapitel 3 Förskoleklassen" …
  function sourceDoc(c) {
    return { FS: 'Skolverkets läroplan för förskolan', FKLASS: 'Skolverkets läroplan för grundskolan, kapitel 3 Förskoleklassen', GR: 'Skolverkets kursplan' }[c.schoolType] || 'Skolverkets ämnesplan';
  }

  // "Skolverkets ämnesplan för Samhällskunskap nivå 1b", "Skolverkets läroplan för förskolan"
  function sourcePhrase(c) {
    if (WHOLE_SCHOOL_TYPES[c.schoolType]) return sourceDoc(c);
    return `${sourceDoc(c)} för ${courseLabel(c)}`;
  }

  // Förskolan har mål (strävansmål) i stället för centralt innehåll, och inga betygskriterier
  const contentTitle = c => c?.schoolType === 'FS' ? 'Mål ur läroplanen' : 'Centralt innehåll';

  // Förskolans mål börjar med "Förskolan ska ge varje barn förutsättningar att utveckla"
  const leadHTML = item => item.lead ? `<span class="sv-lead">${escapeHTML(item.lead)}</span> ` : '';

  // En vald punkt som den sparas i upplägget (texten följer med, se överst)
  function savedItem(it, kind) {
    if (kind === 'criteria') return it.text ? { id: it.id, text: it.text, lessons: [], activities: [] } : { id: it.id, E: it.E, C: it.C, A: it.A, lessons: [], activities: [] };
    return { id: it.id, heading: it.heading || null, ...(it.lead ? { lead: it.lead } : {}), text: it.text, lessons: [], activities: [] };
  }

  // Kursen som den sparas i upplägget (utan punkter)
  const courseOf = (schoolType, s, l) => ({
    schoolType, subject: s.code, subjectName: s.name, reform: s.reform || null,
    version: s.version ?? null, level: l.code, levelName: l.name,
  });

  // ── Hitta i Skolverkets text (Skapa/Fyll i med AI) ──
  // AI:n skriver aldrig läroplanstext som sparas. Den anger kursen med ord och
  // pekar ut punkter, och här letas de upp i Skolverkets text.
  const norm = s => plainText(s).toLowerCase().normalize('NFC').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const words = s => norm(s).replace(/[^a-zåäöéü0-9 ]/g, ' ').split(' ').filter(w => w.length > 2).map(w => w.slice(0, 6));

  // Kursen ur fri text, t.ex. "Samhällskunskap nivå 1b", "Samhällskunskap 1b" eller
  // "Samhällskunskap" + årskurs 8. → kurs (som courseOf) eller null
  async function findCourse({ text, grade }) {
    const idx = await index();
    const t = norm(text);
    const g = String(grade || '').trim();
    const whole = schoolTypeForGrade(g) || (/förskoleklass/.test(t) ? 'FKLASS' : /förskola|lpfö/.test(t) ? 'FS' : null);
    if (whole) {
      const s = idx.schoolTypes[whole]?.subjects[0];
      return s ? courseOf(whole, s, s.levels[0]) : null;
    }
    if (!t) return null;
    const gradeNum = Number((g.match(/^(\d)(?:\s*[–-]\s*(\d))?$/) || [])[2] || (g.match(/^(\d)$/) || [])[1]) || null;
    const gyHint = /^gy/i.test(g) || /nivå|gy|\b\d[a-c]\d?\b/.test(t);
    const order = gradeNum && !gyHint ? ['GR', 'GY'] : ['GY', 'GR'];
    const wantsOld = /gy11|gy2011/.test(t);
    for (const st of order) {
      const subjects = (idx.schoolTypes[st]?.subjects || [])
        .filter(s => t.includes(norm(s.name)))
        .sort((a, b) => b.name.length - a.name.length || ((a.reform === 'GY11') - (b.reform === 'GY11')) * (wantsOld ? -1 : 1));
      for (const s of subjects) {
        if (st === 'GR') {
          const n = gradeNum || Number((t.match(/(?:årskurs|åk)\s*(\d)/) || [])[1]) || null;
          const level = s.levels.find(l => {
            const r = norm(l.name).match(/(\d)\s*-\s*(\d)/);
            return r && n && n >= Number(r[1]) && n <= Number(r[2]);
          }) || (s.levels.length === 1 ? s.levels[0] : null);
          if (level) return courseOf(st, s, level);
          continue;
        }
        const rest = t.slice(t.indexOf(norm(s.name)) + norm(s.name).length);
        const key = (rest.match(/(?:nivå\s*)?(\d[a-c]?\d?)\b/) || [])[1];
        const level = (key && s.levels.find(l => norm(l.name).endsWith(' ' + key)))
          || s.levels.find(l => norm(l.name).length > 6 && !/^nivå/.test(norm(l.name)) && t.includes(norm(l.name)))
          || (s.levels.length === 1 ? s.levels[0] : null);
        if (level) return courseOf(st, s, level);
      }
      // Kurser med eget namn (t.ex. "Internationell ekonomi")
      for (const s of idx.schoolTypes[st]?.subjects || []) {
        const level = s.levels.find(l => norm(l.name).length > 8 && !/^nivå|^årskurs/.test(norm(l.name)) && t.includes(norm(l.name)));
        if (level) return courseOf(st, s, level);
      }
    }
    return null;
  }

  // AI:ns punkter → { matched: [katalogens punkter], unmatched: [AI:ns text] }.
  // En punkt hittas på sin kod ("c3", "k2"; bara när Lossi gett AI:n listan,
  // allowCodes) eller på att orden stämmer med Skolverkets text. En omskriven
  // eller påhittad punkt hittas inte, och då används ingenting av den.
  function matchItems(list, items, kind, { allowCodes = false } = {}) {
    const used = new Set();
    const matched = [];
    const unmatched = [];
    const prefix = kind === 'criteria' ? 'k' : 'c';
    const textsOf = it => kind === 'criteria' ? [it.text, it.E, it.C, it.A].filter(Boolean) : [it.text];
    list.forEach(raw => {
      const s = String(raw ?? '').trim();
      if (!s) return;
      let hit = null;
      const code = allowCodes && s.match(/^([ck])?\s*(\d{1,3})$/i);
      if (code && (!code[1] || code[1].toLowerCase() === prefix)) hit = items.find(it => it.id === prefix + Number(code[2])) || null;
      if (!hit && !code) {
        const a = new Set(words(s));
        let best = 0;
        items.forEach(it => textsOf(it).forEach(text => {
          const b = new Set(words(text));
          let shared = 0;
          a.forEach(w => { if (b.has(w)) shared++; });
          const dice = a.size + b.size ? 2 * shared / (a.size + b.size) : 0;
          // Ett ordagrant utdrag ur en lång punkt räknas också
          const excerpt = a.size >= 4 && shared / a.size >= 0.9 ? 0.75 : 0;
          const score = Math.max(dice, excerpt);
          if (score > best) { best = score; hit = it; }
        }));
        if (best < 0.6) hit = null;
      }
      if (!hit) unmatched.push(s);
      else if (!used.has(hit.id)) { used.add(hit.id); matched.push(hit); }
    });
    return { matched, unmatched };
  }

  // AI:ns kopplingar till lektioner och aktiviteter (ai-import.js, aiLinkTargets):
  // [{ lessonId, has, refs: [{ kind, item }], activities: [{ activityId, refs }] }].
  // has = AI:n tog med läroplan för lektionen; då ersätts lektionens egna kopplingar.
  function applyLinks(cur, targets) {
    const find = (kind, id) => cur[kind].find(it => it.id === id);
    targets.forEach(t => {
      if (t.lessonId && t.has) ['content', 'criteria'].forEach(k => cur[k].forEach(it => { it.lessons = (it.lessons || []).filter(x => x !== t.lessonId); }));
      t.refs.forEach(r => {
        const it = find(r.kind, r.item.id);
        if (it && t.lessonId && !(it.lessons ||= []).includes(t.lessonId)) it.lessons.push(t.lessonId);
      });
      (t.activities || []).forEach(a => a.refs.forEach(r => {
        const it = find(r.kind, r.item.id);
        if (it && a.activityId && !(it.activities ||= []).includes(a.activityId)) it.activities.push(a.activityId);
      }));
    });
  }

  return { applyLinks, index, subject, levelOf, criteriaOf, courseLabel, textHTML, plainText, criterionText, compare, sourcePhrase, sourceDoc, contentTitle, leadHTML, hasCriteria, schoolTypeForGrade, savedItem, courseOf, findCourse, matchItems, WHOLE_SCHOOL_TYPES, SCHOOL_TYPE_NAMES };
})();


// ── Läroplanen i upplägget (upplag.html) ──
// Kursvalet under Detaljer, Skolverkets punkter i Centralt innehåll och
// Betygskriterier, anteckningar, koppling till lektioner och markering när
// Skolverket ändrat en punkt. upplag.html anropar init(), set() när upplägget
// läses in, get() när det sparas och refreshLessons() när lektionerna ändras.
const PlanCurriculum = (() => {
  const C = LossiCurriculum;
  let cur = null;          // state.curriculum
  let catalog = null;      // ämnet ur curriculum/ (för versionskontroll och väljaren)
  let catalogKey = '';
  // lessons() → [{ id, name, activities: [{ id, title }] }] i uppläggets ordning
  let hooks = { save() {}, readOnly: () => false, lessons: () => [], openPanel() {}, closePanel() {} };
  let openKey = null;      // { kind, id } för punkten som visas i panelen
  const shownStep = new Map(); // kriterium-id → visat betygssteg (bara på sidan)
  const KINDS = {
    content:  { listId: 'contentSv',  sectionId: 'sec-goals',    icon: 'list-checks', iconClass: '',                    title: 'Centralt innehåll', one: 'Centralt innehåll' },
    criteria: { listId: 'criteriaSv', sectionId: 'sec-criteria', icon: 'target',       iconClass: 'goal-check-criteria', title: 'Betygskriterier', one: 'Betygskriterium' },
  };

  function init(h) {
    hooks = { ...hooks, ...h };
    buildModals();
  }

  function set(curriculum) {
    cur = curriculum && curriculum.subject ? structuredClone(curriculum) : null;
    if (cur) { cur.content ||= []; cur.criteria ||= []; }
    render();
    loadCatalog();
  }

  const get = () => cur ? structuredClone(cur) : null;

  function changed() {
    render();
    hooks.save();
  }

  async function loadCatalog() {
    if (!cur) { catalog = null; catalogKey = ''; return; }
    const key = cur.schoolType + '/' + cur.subject;
    if (catalogKey === key && catalog) { render(); return; }
    catalogKey = key;
    try {
      const subj = await C.subject(cur.schoolType, cur.subject);
      if (catalogKey !== key) return;
      catalog = subj;
      // Samma text under nytt id: följ med tyst (bara när man får redigera)
      if (!hooks.readOnly()) {
        let fixed = false;
        ['content', 'criteria'].forEach(kind => {
          const items = catalogItems(kind);
          cur[kind].forEach(saved => {
            const r = C.compare(saved, items, kind);
            if (r.status === 'moved' && !cur[kind].some(o => o.id === r.item.id)) { saved.id = r.item.id; fixed = true; }
          });
        });
        if (fixed) hooks.save();
      }
      render();
    } catch (e) {
      console.warn('Kunde inte hämta kursplanen:', e);
    }
  }

  function catalogItems(kind) {
    if (!catalog || !cur) return [];
    if (kind === 'content') return C.levelOf(catalog, cur.level)?.content || [];
    return C.criteriaOf(catalog, cur.level)?.items || [];
  }

  // ── Rendering ──
  function render() {
    renderCourseField();
    Object.keys(KINDS).forEach(renderList);
    renderTags();
    renderPanel();
  }

  function renderCourseField() {
    const trigger = document.getElementById('courseTrigger');
    if (!trigger) return;
    if (!cur) {
      trigger.innerHTML = '<span class="class-tag is-empty">Ej vald</span>';
      trigger.title = 'Välj kurs ur Skolverkets kurs- och ämnesplaner';
      return;
    }
    const outdated = catalog && !C.levelOf(catalog, cur.level);
    trigger.innerHTML = `<span class="class-tag course-tag" title="${escapeHTML(C.courseLabel(cur))}">
        <span class="course-tag-name">${escapeHTML(C.courseLabel(cur))}</span>
        ${cur.reform ? `<span class="course-tag-reform">${escapeHTML(cur.reform)}</span>` : ''}
      </span>${outdated ? '<span class="course-outdated">Finns inte längre hos Skolverket</span>' : ''}`;
    trigger.title = 'Byt kurs';
  }

  // Kort text för en aktivitet i ett chip
  const shortTitle = t => (t = String(t || '').trim()).length > 28 ? t.slice(0, 27).trimEnd() + '…' : t;

  // Grupperingarna numrerade i ordning (fria aktiviteter ligger i en del
  // utan id och nummer, free: true, från upplag.html)
  function numberedLessons() {
    let n = 0;
    return hooks.lessons().map(l => ({ ...l, number: l.free ? null : ++n }));
  }

  // Grupperingarna och aktiviteterna en punkt är kopplad till, i uppläggets ordning
  function linksOf(item) {
    const links = [];
    numberedLessons().forEach(l => {
      if (!l.free && (item.lessons || []).includes(l.id)) links.push({ type: 'lesson', id: l.id, label: `Gruppering ${l.number}`, title: l.name });
      l.activities.forEach(a => {
        if ((item.activities || []).includes(a.id)) links.push(l.free
          ? { type: 'activity', id: a.id, label: shortTitle(a.title), title: a.title }
          : { type: 'activity', id: a.id, label: `Gruppering ${l.number} › ${shortTitle(a.title)}`, title: `${l.name} › ${a.title}` });
      });
    });
    return links;
  }

  // På raden: bara antalet kopplingar
  function linkCountHTML(item) {
    const n = linksOf(item).length;
    if (!n) return '';
    return `<span class="sv-link-count" title="Kopplad till ${n} ${n === 1 ? 'gruppering eller aktivitet' : 'grupperingar och aktiviteter'}"><i data-lucide="link"></i>${n}</span>`;
  }

  // I panelen: en tagg per koppling (× tar bort) och en knapp för att koppla fler
  function panelLinksHTML(item, kind) {
    const editable = !hooks.readOnly();
    const links = linksOf(item);
    const tags = links.map(l => `
      <span class="sv-lesson-chip${l.type === 'activity' ? ' is-activity' : ''}" title="${escapeHTML(l.title)}">${escapeHTML(l.label)}${editable
        ? `<button type="button" class="sv-chip-remove" onclick="PlanCurriculum.unlink('${kind}', '${item.id}', '${l.type}', '${escapeHTML(l.id)}')" aria-label="Ta bort kopplingen till ${escapeHTML(l.label)}"><i data-lucide="x"></i></button>` : ''}</span>`).join('');
    const add = editable && hooks.lessons().length ? `
      <div class="popover-wrap">
        <button type="button" class="btn btn-outline btn-xs" onclick="PlanCurriculum.openLessons(this, '${kind}', '${item.id}')"><i data-lucide="plus"></i>Koppla till aktivitet</button>
        <div class="menu-popover sv-lessons-menu"></div>
      </div>` : '';
    return `${links.length ? `<div class="sv-lessons">${tags}</div>` : `<p class="sv-panel-empty">Inte kopplad till någon aktivitet än.</p>`}${add}`;
  }

  function flagHTML(item, kind) {
    if (!catalog) return '';
    const r = C.compare(item, catalogItems(kind), kind);
    if (r.status === 'same' || r.status === 'moved') return '';
    const editable = !hooks.readOnly();
    if (r.status === 'removed') {
      return `<div class="sv-flag"><i data-lucide="info"></i><span>Punkten finns inte i Skolverkets senaste version.</span>
        ${editable ? `<button type="button" class="btn btn-text btn-xs" onclick="PlanCurriculum.remove('${kind}', '${item.id}')">Ta bort</button>` : ''}</div>`;
    }
    const newText = kind === 'criteria' ? C.criterionText(r.item) : r.item.text;
    return `<div class="sv-flag"><i data-lucide="info"></i><span>Skolverket har ändrat texten.</span>
      <details class="sv-flag-new"><summary>Visa nya texten</summary><p>${C.textHTML(newText)}</p></details>
      ${editable ? `<button type="button" class="btn btn-text btn-xs" onclick="PlanCurriculum.useNewText('${kind}', '${item.id}')">Använd nya texten</button>` : ''}</div>`;
  }

  // Skolverkets text: kriterier med E/C/A-väljare, annars rubrik + text
  function textBlockHTML(item, kind) {
    if (kind === 'criteria' && !item.text) {
      const step = shownStep.get(item.id) || 'E';
      return `
        <div class="sv-steps filter-toggle" role="group" aria-label="Visa betygssteg">
          ${['E', 'C', 'A'].map(s => `<button type="button" aria-pressed="${s === step}" onclick="PlanCurriculum.showStep('${item.id}', '${s}')">${s}</button>`).join('')}
        </div>
        <div class="goal-text sv-text">${C.textHTML(item[step])}</div>`;
    }
    return `${item.heading ? `<div class="sv-heading">${escapeHTML(item.heading)}</div>` : ''}
        <div class="goal-text sv-text">${C.leadHTML(item)}${C.textHTML(item.text)}</div>`;
  }

  function rowHTML(item, kind) {
    const cfg = KINDS[kind];
    const editable = !hooks.readOnly();
    const note = item.note || '';
    const active = openKey && openKey.kind === kind && openKey.id === item.id;
    return `<div class="goal-item sv-item${active ? ' active' : ''}" data-id="${item.id}" data-kind="${kind}" title="Öppna">
      <div class="goal-check ${cfg.iconClass}"><i data-lucide="${cfg.icon}"></i></div>
      <div class="sv-main">
        ${textBlockHTML(item, kind)}
        ${note ? `<div class="sv-note">${escapeHTML(note)}</div>` : ''}
        ${flagHTML(item, kind)}
      </div>
      ${linkCountHTML(item)}
      ${editable ? `<button class="goal-delete" onclick="PlanCurriculum.remove('${kind}', '${item.id}')" title="Ta bort"><i data-lucide="x"></i></button>` : ''}
    </div>`;
  }

  // ── Panelen (aktivitetspanelen i upplag.html) ──
  function panelBody(item, kind) {
    const editable = !hooks.readOnly();
    const note = item.note || '';
    const body = document.createElement('div');
    body.className = 'sv-panel';
    body.innerHTML = `
      <section class="sv-panel-section">
        ${textBlockHTML(item, kind)}
        <div class="sv-panel-source">${cur ? `Ordagrant ur ${escapeHTML(C.sourcePhrase(cur))}` : ''}</div>
        ${flagHTML(item, kind)}
      </section>
      <section class="sv-panel-section">
        <label class="field-label">Anteckning</label>
        ${editable
          ? `<div class="sv-note sv-panel-note" contenteditable="true" data-placeholder="Din anteckning, t.ex. hur ni arbetar med det här" data-kind="${kind}" data-id="${item.id}">${escapeHTML(note)}</div>`
          : `<p class="sv-panel-empty">${note ? escapeHTML(note) : 'Ingen anteckning.'}</p>`}
      </section>
      <section class="sv-panel-section">
        <label class="field-label">Grupperingar och aktiviteter</label>
        <div class="sv-panel-links">${panelLinksHTML(item, kind)}</div>
      </section>`;
    return body;
  }

  function openItem(kind, id) {
    const item = find(kind, id);
    if (!item) return;
    openKey = { kind, id };
    hooks.openPanel({
      title: KINDS[kind].one,
      iconHTML: `<i data-lucide="${KINDS[kind].icon}"></i>`,
      iconClass: 'sv-panel-icon' + (kind === 'criteria' ? ' is-criteria' : ''),
      body: panelBody(item, kind),
      onClose: () => {
        openKey = null;
        document.querySelectorAll('.sv-item.active').forEach(el => el.classList.remove('active'));
      },
    });
    document.querySelectorAll('.sv-item.active').forEach(el => el.classList.remove('active'));
    document.querySelector(`#${KINDS[kind].listId} .sv-item[data-id="${CSS.escape(id)}"]`)?.classList.add('active');
  }

  // Ritar om panelens innehåll (inte medan man skriver anteckningen)
  function renderPanel() {
    if (!openKey) return;
    const item = find(openKey.kind, openKey.id);
    if (!item) { hooks.closePanel(); return; }
    const panel = document.querySelector('.sv-panel');
    if (!panel || panel.contains(document.activeElement) && document.activeElement.matches('.sv-note')) return;
    const fresh = panelBody(item, openKey.kind);
    panel.replaceWith(fresh);
    lucide.createIcons({ nodes: [fresh] });
  }

  function unlink(kind, id, type, targetId) {
    const item = find(kind, id);
    if (!item) return;
    if (type === 'lesson') item.lessons = (item.lessons || []).filter(x => x !== targetId);
    else item.activities = (item.activities || []).filter(x => x !== targetId);
    changed();
  }

  // Klick på en rad (utom på knappar och E/C/A) öppnar panelen
  document.addEventListener('click', e => {
    const row = e.target.closest?.('.sv-item[data-kind]');
    if (!row || e.target.closest('button, a, summary, details, input, label')) return;
    openItem(row.dataset.kind, row.dataset.id);
  });

  function renderList(kind) {
    const cfg = KINDS[kind];
    const list = document.getElementById(cfg.listId);
    const section = document.getElementById(cfg.sectionId);
    if (!list || !section) return;
    const items = cur ? cur[kind] : [];
    section.classList.toggle('has-course', !!cur);
    section.classList.toggle('has-sv', items.length > 0);
    if (kind === 'content') {
      const title = C.contentTitle(cur);
      const toggle = section.querySelector('.section-toggle');
      if (toggle?.firstChild?.nodeType === Node.TEXT_NODE) toggle.firstChild.textContent = title;
      list.dataset.empty = `${cur?.schoolType === 'FS' ? 'Inga mål' : 'Inget centralt innehåll'} valt än. Välj ur Skolverkets text med plusknappen.`;
    } else {
      // Förskolan och förskoleklassen har inga betygskriterier: sektionen syns bara om det finns egna rader
      section.hidden = !C.hasCriteria(cur) && !items.length && !document.getElementById('criteriaList')?.children.length;
    }
    list.innerHTML = items.map(item => rowHTML(item, kind)).join('');
    const source = document.getElementById(cfg.listId + 'Source');
    if (source) {
      source.hidden = !items.length;
      source.innerHTML = items.length ? `<i data-lucide="graduation-cap"></i>Ordagrann text ur ${escapeHTML(C.sourcePhrase(cur))}${cur.reform ? ` (${escapeHTML(cur.reform)})` : ''}` : '';
    }
    const hint = document.getElementById(cfg.listId + 'Hint');
    if (hint) hint.hidden = !!cur;
    lucide.createIcons({ nodes: [list, source, hint].filter(Boolean) });
  }

  // Lektionerna har ändrats (ny, borttagen, flyttad, nytt namn)
  function refreshLessons() {
    if (!cur) { renderTags(); return; }
    const lessons = hooks.lessons();
    const lessonIds = new Set(lessons.filter(l => !l.free).map(l => l.id));
    const activityIds = new Set(lessons.flatMap(l => l.activities.map(a => a.id)));
    let pruned = false;
    ['content', 'criteria'].forEach(kind => cur[kind].forEach(item => {
      const kept = (item.lessons || []).filter(id => lessonIds.has(id));
      const keptActs = (item.activities || []).filter(id => activityIds.has(id));
      if (kept.length !== (item.lessons || []).length || keptActs.length !== (item.activities || []).length) {
        item.lessons = kept;
        item.activities = keptActs;
        pruned = true;
      }
    }));
    Object.keys(KINDS).forEach(renderList);
    renderTags();
    if (pruned && !hooks.readOnly()) hooks.save();
  }

  // ── Taggar på lektions- och aktivitetsraderna ──
  // Läroplansikon + antal punkter. Lektionen räknar punkter kopplade till
  // lektionen eller till någon av dess aktiviteter. Taggarna ritas om här och
  // sparas inte med upplägget (upplag.html tar bort .sv-tag när det sparas).
  function linkedTo({ lessonId, activityIds = [] }) {
    if (!cur) return [];
    const acts = new Set(activityIds);
    return ['content', 'criteria'].flatMap(kind => cur[kind]
      .filter(it => (lessonId && (it.lessons || []).includes(lessonId)) || (it.activities || []).some(id => acts.has(id)))
      .map(it => ({ kind, item: it })));
  }

  function tagHTML(list, where) {
    if (!list.length) return '';
    const lines = list.map(({ kind, item }) => '• ' + C.plainText(kind === 'criteria' ? C.criterionText(item) : (item.lead ? item.lead + ' ' : '') + item.text).slice(0, 110));
    const label = `${list.length} ${list.length === 1 ? 'punkt' : 'punkter'} ur läroplanen ${where}`;
    return `<span class="sv-tag" title="${escapeHTML(label + ':\n' + lines.join('\n'))}" aria-label="${escapeHTML(label)}"><i data-lucide="graduation-cap"></i>${list.length}</span>`;
  }

  function renderTags() {
    const lessons = hooks.lessons();
    document.querySelectorAll('#structureList .sv-tag').forEach(el => el.remove());
    if (!cur) return;
    const nodes = [];
    lessons.forEach(l => {
      const group = document.querySelector(`#structureList .lesson-group[data-lesson-id="${CSS.escape(l.id)}"]`);
      const pill = group?.querySelector('.week-row .week-pill');
      const html = tagHTML(linkedTo({ lessonId: l.id, activityIds: l.activities.map(a => a.id) }), 'i grupperingen');
      if (pill && html) { pill.insertAdjacentHTML('afterend', html); nodes.push(pill.nextElementSibling); }
      l.activities.forEach(a => {
        const time = document.getElementById(a.id)?.querySelector('.activity-row .activity-time');
        const ahtml = tagHTML(linkedTo({ activityIds: [a.id] }), 'i aktiviteten');
        if (time && ahtml) { time.insertAdjacentHTML('beforebegin', ahtml); nodes.push(time.previousElementSibling); }
      });
    });
    if (nodes.length) lucide.createIcons({ nodes });
  }

  // ── Ändringar på raderna ──
  const find = (kind, id) => cur?.[kind].find(it => it.id === id);

  function remove(kind, id) {
    if (!cur) return;
    cur[kind] = cur[kind].filter(it => it.id !== id);
    changed();
  }

  function useNewText(kind, id) {
    const item = find(kind, id);
    if (!item || !catalog) return;
    const r = C.compare(item, catalogItems(kind), kind);
    if (!r.item) return;
    Object.assign(item, kind === 'criteria'
      ? { E: r.item.E, C: r.item.C, A: r.item.A, text: r.item.text }
      : { heading: r.item.heading, lead: r.item.lead, text: r.item.text });
    if (!item.lead) delete item.lead;
    if (!item.text) delete item.text;
    cur.version = catalog.version;
    changed();
  }

  function showStep(id, step) {
    shownStep.set(id, step);
    renderList('criteria');
    renderPanel();
  }

  function openLessons(btn, kind, id) {
    const item = find(kind, id);
    const menu = btn.nextElementSibling;
    if (!item || !menu) return;
    const lessons = numberedLessons();
    const linked = new Set(item.lessons || []);
    const linkedActs = new Set(item.activities || []);
    const nameOnly = name => name.replace(/^(lektion|gruppering) \d+\s*[:–-]?\s*/i, '');
    menu.innerHTML = `<div class="sv-lessons-title">Var tas det här upp? Välj hela grupperingen eller enskilda aktiviteter.</div>` + lessons.map(l => `
      ${l.free ? '<div class="sv-lessons-free">Utan gruppering</div>' : `
      <label class="sv-lesson-option">
        <input type="checkbox" data-lesson="${escapeHTML(l.id)}"${linked.has(l.id) ? ' checked' : ''} />
        <span><strong>Gruppering ${l.number}</strong>${nameOnly(l.name) ? ` <span class="sv-lesson-name">${escapeHTML(nameOnly(l.name))}</span>` : ''}</span>
      </label>`}
      ${l.activities.map(a => `
      <label class="sv-lesson-option is-activity">
        <input type="checkbox" data-activity="${escapeHTML(a.id)}"${linkedActs.has(a.id) ? ' checked' : ''} />
        <span>${escapeHTML(a.title || 'Aktivitet')}</span>
      </label>`).join('')}`).join('');
    menu.onchange = () => {
      item.lessons = [...menu.querySelectorAll('input[data-lesson]:checked')].map(i => i.dataset.lesson);
      item.activities = [...menu.querySelectorAll('input[data-activity]:checked')].map(i => i.dataset.activity);
      hooks.save();
      renderTags();
    };
    toggleAppPopover(btn);
    // Raden och panelen ritas om när menyn stängs, så att kopplingarna syns
    const onClose = new MutationObserver(() => {
      if (menu.classList.contains('open')) return;
      onClose.disconnect();
      renderList(kind);
      renderPanel();
    });
    onClose.observe(menu, { attributes: true, attributeFilter: ['class'] });
  }

  // Anteckningar sparas när man lämnar fältet; Enter avslutar
  document.addEventListener('focusout', e => {
    const field = e.target.closest?.('.sv-note[data-id]');
    if (!field) return;
    const item = find(field.dataset.kind, field.dataset.id);
    if (!item) return;
    const text = field.textContent.replace(/\s+/g, ' ').trim();
    if ((item.note || '') === text) return;
    if (text) item.note = text; else delete item.note;
    changed();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && e.target.closest?.('.sv-note[data-id]')) { e.preventDefault(); e.target.blur(); }
  });
  document.addEventListener('paste', e => {
    if (!e.target.closest?.('.sv-note[data-id]')) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').replace(/\s+/g, ' '));
  });

  // ── Dialog: välj kurs ──
  let pickST = 'GY';
  let pickSubject = null;

  function buildModals() {
    if (document.getElementById('coursePickerModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="coursePickerModal">
  <div class="modal modal-md course-modal" role="dialog" aria-modal="true" aria-labelledby="coursePickerTitle">
    <div class="modal-header">
      <h3 id="coursePickerTitle">Välj kurs</h3>
      <button class="btn btn-text btn-icon modal-close" onclick="PlanCurriculum.closeModal('coursePickerModal')"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <p class="course-intro">Välj kurs ur Skolverkets kurs- och ämnesplaner, förskoleklassens kapitel i Lgr22 eller förskolans läroplan. Sedan kan du bocka för centralt innehåll och betygskriterier, eller förskolans mål, med Skolverkets egen text.</p>
      <div class="course-search-row">
        <div class="filter-toggle" role="group" aria-label="Skolform" id="courseSchoolType">
          <button type="button" data-st="GY" onclick="PlanCurriculum.pickSchoolType('GY')">Gymnasieskola</button>
          <button type="button" data-st="GR" onclick="PlanCurriculum.pickSchoolType('GR')">Grundskola</button>
          <button type="button" data-st="FKLASS" onclick="PlanCurriculum.pickSchoolType('FKLASS')">Förskoleklass</button>
          <button type="button" data-st="FS" onclick="PlanCurriculum.pickSchoolType('FS')">Förskola</button>
        </div>
        <div class="choice-search course-search">
          <i data-lucide="search"></i>
          <input type="text" id="courseSearch" placeholder="Sök ämne eller kurs…" autocomplete="off" oninput="PlanCurriculum.renderCourseOptions()" />
        </div>
      </div>
      <div class="course-options" id="courseOptions" role="list"></div>
      <p class="course-warning" id="courseWarning" hidden></p>
    </div>
    <div class="modal-footer course-footer">
      <span class="course-source" id="courseSource"></span>
      <button class="btn btn-outline btn-danger" id="courseRemoveBtn" onclick="PlanCurriculum.clearCourse()" hidden>Ta bort kurs</button>
      <button class="btn btn-outline" onclick="PlanCurriculum.closeModal('coursePickerModal')">Avbryt</button>
    </div>
  </div>
</div>
<div class="modal-overlay" id="svPickerModal">
  <div class="modal modal-md sv-picker-modal" role="dialog" aria-modal="true" aria-labelledby="svPickerTitle">
    <div class="modal-header">
      <div>
        <h3 id="svPickerTitle">Centralt innehåll</h3>
        <p class="sv-picker-sub" id="svPickerSub"></p>
      </div>
      <button class="btn btn-text btn-icon modal-close" onclick="PlanCurriculum.closeModal('svPickerModal')"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body sv-picker-body" id="svPickerBody"></div>
    <div class="modal-footer">
      <span class="course-source" id="svPickerSource"></span>
      <button class="btn btn-outline" onclick="PlanCurriculum.closeModal('svPickerModal')">Avbryt</button>
      <button class="btn btn-solid" id="svPickerSave" onclick="PlanCurriculum.savePicker()">Spara</button>
    </div>
  </div>
</div>`);
    ['coursePickerModal', 'svPickerModal'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => { if (e.target.id === id) closeModal(id); });
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      ['svPickerModal', 'coursePickerModal'].forEach(id => {
        if (document.getElementById(id)?.classList.contains('open')) closeModal(id);
      });
    });
    lucide.createIcons({ nodes: [document.getElementById('coursePickerModal'), document.getElementById('svPickerModal')] });
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  // Gissar skolform ur årskursen (Förskola → förskolan, 7 → grundskolan, Gy 1 → gymnasiet)
  function guessSchoolType() {
    const grade = document.getElementById('detailGrade')?.textContent.trim() || '';
    const whole = C.schoolTypeForGrade(grade);
    if (whole) return whole;
    return /^(F|[1-9])$|^[1-9]\s*[–-]\s*[1-9]$/i.test(grade) ? 'GR' : 'GY';
  }

  async function openCoursePicker() {
    if (hooks.readOnly()) return;
    closeAllMenuPopovers();
    pickST = cur?.schoolType || guessSchoolType();
    pickSubject = null;
    const search = document.getElementById('courseSearch');
    search.value = cur ? '' : (document.getElementById('detailSubject')?.textContent.trim() || '');
    document.getElementById('courseRemoveBtn').hidden = !cur;
    const count = cur ? cur.content.length + cur.criteria.length : 0;
    const warning = document.getElementById('courseWarning');
    warning.hidden = !count;
    warning.textContent = count ? `Byter du kurs tas de ${count} punkter du valt ur ${C.courseLabel(cur)} bort. Dina egna rader finns kvar.` : '';
    document.getElementById('coursePickerModal').classList.add('open');
    renderCourseOptions();
    setTimeout(() => search.focus(), 0);
  }

  function pickSchoolType(st) {
    pickST = st;
    pickSubject = null;
    document.getElementById('courseSearch').value = '';
    renderCourseOptions();
  }

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  async function renderCourseOptions() {
    const box = document.getElementById('courseOptions');
    document.querySelectorAll('#courseSchoolType button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.st === pickST)));
    let idx;
    try {
      idx = await C.index();
    } catch (e) {
      box.innerHTML = '<p class="course-empty">Kunde inte hämta Skolverkets kursplaner. Kontrollera uppkopplingen och försök igen.</p>';
      return;
    }
    document.getElementById('courseSource').textContent = `Källa: Skolverket, hämtad ${idx.fetchedAt}`;
    const all = idx.schoolTypes[pickST]?.subjects || [];
    if (pickSubject) {
      const s = pickSubject;
      box.innerHTML = `
        <button type="button" class="course-back" onclick="PlanCurriculum.backToSubjects()"><i data-lucide="chevron-left"></i>Alla ämnen</button>
        <div class="course-subject-head">${escapeHTML(s.name)}${s.reform ? ` <span class="course-tag-reform">${escapeHTML(s.reform)}</span>` : ''}</div>
        ${s.levels.map(l => `
          <button type="button" class="course-option${cur?.subject === s.code && cur?.level === l.code ? ' is-selected' : ''}" onclick="PlanCurriculum.chooseLevel('${s.code}', '${l.code}')">
            <span class="course-option-name">${escapeHTML(C.courseLabel({ subjectName: s.name, levelName: l.name, schoolType: pickST }))}</span>
            <i data-lucide="chevron-right"></i>
          </button>`).join('')}`;
      lucide.createIcons({ nodes: [box] });
      return;
    }
    const q = norm(document.getElementById('courseSearch').value.trim());
    const hits = all.filter(s => !q || norm(s.name).includes(q) || s.levels.some(l => norm(l.name).includes(q)) || norm(s.code).startsWith(q));
    // Gymnasiet: GY25 först; de äldre (GY11) gäller för elever som började före hösten 2025
    hits.sort((a, b) => {
      const starts = (norm(b.name).startsWith(q) ? 1 : 0) - (norm(a.name).startsWith(q) ? 1 : 0);
      return starts || (a.reform === 'GY11') - (b.reform === 'GY11') || a.name.localeCompare(b.name, 'sv');
    });
    const shown = hits.slice(0, 60);
    box.innerHTML = shown.length ? shown.map(s => `
      <button type="button" class="course-option" onclick="PlanCurriculum.chooseSubject('${s.code}')">
        <span class="course-option-name">${escapeHTML(s.name)}</span>
        ${s.reform && pickST === 'GY' ? `<span class="course-tag-reform${s.reform === 'GY11' ? ' is-old' : ''}">${escapeHTML(s.reform)}</span>` : ''}
        ${C.WHOLE_SCHOOL_TYPES[pickST] ? `<span class="course-option-meta">${escapeHTML(s.reform || '')}</span>` : `<span class="course-option-meta">${s.levels.length} ${pickST === 'GR' ? (s.levels.length === 1 ? 'del' : 'delar') : (s.levels.length === 1 ? 'kurs' : (s.reform === 'GY25' ? 'nivåer' : 'kurser'))}</span>`}
        <i data-lucide="chevron-right"></i>
      </button>`).join('') + (hits.length > shown.length ? `<p class="course-empty">Visar ${shown.length} av ${hits.length}. Skriv mer för att hitta rätt.</p>` : '')
      : '<p class="course-empty">Inga ämnen matchar. Prova ett annat ord.</p>';
    lucide.createIcons({ nodes: [box] });
  }

  async function chooseSubject(code) {
    const idx = await C.index();
    pickSubject = idx.schoolTypes[pickST].subjects.find(s => s.code === code) || null;
    if (pickSubject?.levels.length === 1) return chooseLevel(code, pickSubject.levels[0].code);
    renderCourseOptions();
  }

  function backToSubjects() {
    pickSubject = null;
    renderCourseOptions();
  }

  async function chooseLevel(code, levelCode) {
    const subj = await C.subject(pickST, code).catch(() => null);
    const level = C.levelOf(subj, levelCode);
    if (!subj || !level) return;
    const same = cur && cur.subject === code && cur.level === levelCode;
    if (!same) {
      cur = {
        schoolType: pickST, subject: subj.code, subjectName: subj.name, reform: subj.reform || null,
        version: subj.version, level: level.code, levelName: level.name, content: [], criteria: [],
      };
      catalog = subj;
      catalogKey = pickST + '/' + code;
      // Ämnet i Detaljer följer kursen (förskolan har inga ämnen)
      const subjectEl = document.getElementById('detailSubject');
      const whole = C.WHOLE_SCHOOL_TYPES[pickST];
      if (subjectEl && !whole) subjectEl.textContent = subj.name;
      // Förskolans läroplan hör till årskursen Förskola, förskoleklassens till F
      const gradeEl = document.getElementById('detailGrade');
      if (gradeEl && whole) gradeEl.textContent = whole.grade;
      changed();
    }
    closeModal('coursePickerModal');
    if (!same) openPicker('content');
  }

  // Årskursen Förskola hör ihop med förskolans läroplan och F med förskoleklassens
  // kapitel i Lgr22: utan kurs (eller med en kurs där inget valts än) kopplas den
  // in direkt. Byts årskursen tas en tom sådan koppling bort. Valda punkter tas
  // aldrig bort här.
  async function ensureForGrade() {
    if (hooks.readOnly()) return;
    const target = C.schoolTypeForGrade(document.getElementById('detailGrade')?.textContent);
    const empty = !cur || (!cur.content.length && !cur.criteria.length);
    if (cur?.schoolType === target || !empty) return;
    if (!target) {
      if (cur && C.WHOLE_SCHOOL_TYPES[cur.schoolType]) { cur = null; catalog = null; catalogKey = ''; changed(); }
      return;
    }
    try {
      const idx = await C.index();
      const entry = idx.schoolTypes[target]?.subjects[0];
      const subj = entry && await C.subject(target, entry.code);
      const level = subj?.levels[0];
      if (!level || cur?.schoolType === target || C.schoolTypeForGrade(document.getElementById('detailGrade')?.textContent) !== target) return;
      cur = {
        schoolType: target, subject: subj.code, subjectName: subj.name, reform: subj.reform || null,
        version: subj.version, level: level.code, levelName: level.name, content: [], criteria: [],
      };
      catalog = subj;
      catalogKey = target + '/' + subj.code;
      changed();
    } catch (e) {
      console.warn('Kunde inte koppla läroplanen till årskursen:', e);
    }
  }

  // Fyll i med AI: punkterna Lossi hittat i Skolverkets text (ai-import.js,
  // resolveAiCurriculum). Kursen sätts bara om upplägget saknar kurs (eller har
  // en tom), och en lista ersätts bara när AI:n tog med den. Anteckningar och
  // lektionskopplingar följer med på punkter som redan var valda.
  // Aktiviteter som ersatts (Planera med AI): deras kopplingar tas bort
  function forgetActivities(ids) {
    if (!cur || !ids?.length) return;
    const gone = new Set(ids);
    ['content', 'criteria'].forEach(kind => cur[kind].forEach(it => { it.activities = (it.activities || []).filter(id => !gone.has(id)); }));
  }

  // targets = lektionerna/aktiviteterna i Lossi i AI:ns ordning (aiLinkTargets)
  function applyFromAi(res, targets = []) {
    if (hooks.readOnly() || !res?.course) return;
    const empty = !cur || (!cur.content.length && !cur.criteria.length);
    const same = cur && cur.schoolType === res.course.schoolType && cur.subject === res.course.subject && cur.level === res.course.level;
    if (!same) {
      if (!empty) return;
      cur = { ...res.course, content: [], criteria: [] };
      catalog = null;
      catalogKey = '';
    }
    ['content', 'criteria'].forEach(kind => {
      const old = new Map(cur[kind].map(it => [it.id, it]));
      const extra = (res.extra?.[kind] || []).filter(it => !old.has(it.id) || res.has[kind]);
      if (res.has[kind] && res[kind].matched.length) {
        cur[kind] = [...res[kind].matched, ...extra].map(it => old.get(it.id) || C.savedItem(it, kind));
      } else {
        // Listan togs inte med: punkter som bara nämns på lektioner läggs till
        extra.filter(it => !old.has(it.id)).forEach(it => cur[kind].push(C.savedItem(it, kind)));
      }
    });
    C.applyLinks(cur, targets);
    changed();
    loadCatalog();
  }

  function clearCourse() {
    cur = null;
    catalog = null;
    catalogKey = '';
    closeModal('coursePickerModal');
    changed();
  }

  // ── Dialog: bocka för punkter ──
  let pickerKind = 'content';

  async function openPicker(kind) {
    if (hooks.readOnly()) return;
    closeAllMenuPopovers();
    if (!cur) { openCoursePicker(); return; }
    pickerKind = kind;
    const body = document.getElementById('svPickerBody');
    document.getElementById('svPickerTitle').textContent = kind === 'content' ? C.contentTitle(cur) : KINDS[kind].title;
    document.getElementById('svPickerSub').textContent = C.courseLabel(cur) + (cur.reform ? ` (${cur.reform})` : '');
    body.innerHTML = '<p class="course-empty">Hämtar Skolverkets text…</p>';
    if (kind === 'criteria' && !C.hasCriteria(cur)) {
      body.innerHTML = cur.schoolType === 'FS'
        ? '<p class="course-empty">Förskolan har inga betygskriterier. Läroplanens mål anger vad förskolan ska sträva efter, inte vad varje barn ska uppnå.</p>'
        : '<p class="course-empty">Förskoleklassen har inga betygskriterier.</p>';
      document.getElementById('svPickerModal').classList.add('open');
      return;
    }
    document.getElementById('svPickerModal').classList.add('open');
    try {
      if (!catalog) { catalog = await C.subject(cur.schoolType, cur.subject); catalogKey = cur.schoolType + '/' + cur.subject; }
    } catch (e) {
      body.innerHTML = '<p class="course-empty">Kunde inte hämta Skolverkets text. Kontrollera uppkopplingen och försök igen.</p>';
      return;
    }
    document.getElementById('svPickerSource').textContent = `Ordagrant ur ${C.sourceDoc(cur)}, version ${catalog.version ?? '–'}, hämtad ${catalog.fetchedAt}`;
    const chosen = new Set(cur[kind].map(it => it.id));
    const items = catalogItems(kind);
    if (!items.length) {
      body.innerHTML = `<p class="course-empty">Skolverket har ${kind === 'criteria' ? 'inga betygskriterier' : 'inget centralt innehåll'} för ${escapeHTML(C.courseLabel(cur))}.</p>`;
      return;
    }
    let html = '';
    if (kind === 'criteria') {
      const group = C.criteriaOf(catalog, cur.level);
      html += `<p class="sv-picker-help">Välj de delar av kriterierna som upplägget ger eleverna chans att visa. Texten för E visas; C och A finns på raden i upplägget.</p>`;
      if (group?.heading) html += `<div class="sv-picker-group">${escapeHTML(group.heading)}</div>`;
    }
    let lastHeading = null;
    items.forEach(it => {
      if (it.heading && it.heading !== lastHeading) {
        html += `<div class="sv-picker-group">${escapeHTML(it.heading)}${it.lead ? `<span class="sv-picker-lead">${escapeHTML(it.lead)} …</span>` : ''}</div>`;
        lastHeading = it.heading;
      }
      html += `<label class="sv-picker-option">
        <input type="checkbox" value="${it.id}"${chosen.has(it.id) ? ' checked' : ''} />
        <span>${C.textHTML(kind === 'criteria' ? C.criterionText(it) : it.text)}</span>
      </label>`;
    });
    body.innerHTML = html;
    updatePickerCount();
    body.onchange = updatePickerCount;
  }

  function updatePickerCount() {
    const n = document.querySelectorAll('#svPickerBody input:checked').length;
    document.getElementById('svPickerSave').textContent = n ? `Spara (${n} valda)` : 'Spara';
  }

  function savePicker() {
    if (!cur || !catalog) return;
    const kind = pickerKind;
    const picked = new Set([...document.querySelectorAll('#svPickerBody input:checked')].map(i => i.value));
    const old = new Map(cur[kind].map(it => [it.id, it]));
    // Katalogens ordning; det som redan valts behåller sin text, anteckning och sina lektioner
    cur[kind] = catalogItems(kind).filter(it => picked.has(it.id)).map(it => {
      if (old.has(it.id)) return old.get(it.id);
      return C.savedItem(it, kind);
    });
    // Valda punkter som inte längre finns hos Skolverket tas bara bort på raden
    old.forEach((it, id) => { if (!catalogItems(kind).some(c => c.id === id)) cur[kind].push(it); });
    closeModal('svPickerModal');
    changed();
  }

  // ── Föreslå kopplingar (Claude Haiku, supabase/functions/suggest-links) ──
  // Öppnar sidopanelen med maskoten. Frågan till Haiku ställs först när
  // läraren väljer Föreslå kopplingar i panelen. AI:n får kursens hela
  // centrala innehåll och uppläggets aktiviteter och föreslår par (aktivitet,
  // punkt) med en motivering. Inget kopplas förrän läraren har godkänt det;
  // punkter som inte är valda än läggs till då.
  // Lägen i panelen: intro → loading → results (eller error/none) → done.
  let ai = null; // { body, mascot, suggestions, timers } medan panelen är öppen

  async function aiErrorText(e) {
    try {
      const body = await e?.context?.json();
      if (body?.error) return body.error;
    } catch (_) { /* inget svar att läsa */ }
    return 'Förslagen gick inte att hämta. Försök igen om en stund.';
  }

  // Förslagen sparas per upplägg och kurs i webbläsaren, så att de som inte
  // kopplades finns kvar nästa gång panelen öppnas (tills läraren söker igen)
  function savedKey() {
    const id = new URLSearchParams(location.search).get('id');
    return id && cur ? 'lossi-ai-links:' + id : null;
  }
  const courseKey = () => `${cur.schoolType}/${cur.subject}/${cur.level || ''}`;
  function loadSaved() {
    try {
      const saved = savedKey() && JSON.parse(localStorage.getItem(savedKey()) || 'null');
      return saved?.course === courseKey() ? saved.suggestions : [];
    } catch (_) { return []; }
  }
  function storeSaved(suggestions) {
    try {
      if (!savedKey()) return;
      if (suggestions.length) localStorage.setItem(savedKey(), JSON.stringify({ course: courseKey(), suggestions }));
      else localStorage.removeItem(savedKey());
    } catch (_) { /* privat läge e.d.: förslagen sparas bara inte */ }
  }

  // Det som redan är kopplat, eller vars aktivitet eller punkt inte finns längre, visas inte
  function stillOpen(list) {
    const itemIds = new Set(catalogItems('content').map(it => it.id));
    const actIds = new Set(aiActivities().acts.map(a => a.id));
    return list.filter(s => itemIds.has(s.itemId) && actIds.has(s.activityId)
      && !(find('content', s.itemId)?.activities || []).includes(s.activityId));
  }

  // Öppnas panelen igen visas förslagen som är kvar från förra sökningen direkt
  async function showEarlier() {
    if (!ai || !cur) return;
    const mine = ai;
    try {
      if (!catalog) { catalog = await C.subject(cur.schoolType, cur.subject); catalogKey = cur.schoolType + '/' + cur.subject; }
    } catch (_) { return; }
    const rest = stillOpen(loadSaved());
    if (ai !== mine || !rest.length) return;
    ai.suggestions = rest;
    renderAi('results', { earlier: true });
  }

  function aiActivities() {
    const lessons = numberedLessons();
    return { lessons, acts: lessons.flatMap(l => l.activities.map(a => ({ ...a, lesson: l.free ? '' : l.name }))) };
  }

  function suggestLinks() {
    if (hooks.readOnly()) return;
    closeAllMenuPopovers();
    const body = document.createElement('div');
    body.className = 'sv-panel sv-ai-panel';
    body.innerHTML = '<div class="sv-ai-mascot-wrap"><div class="sv-ai-mascot" aria-hidden="true"></div></div><div class="sv-ai-content"></div>';
    hooks.openPanel({
      title: 'Föreslå kopplingar',
      iconHTML: '<i data-lucide="sparkles"></i>',
      iconClass: 'sv-panel-icon',
      body,
      onClose: () => {
        if (ai?.body !== body) return;
        ai.timers.forEach(clearInterval);
        ai.mascot.setThinking(false);
        document.removeEventListener('pointermove', ai.follow);
        ai = null;
      },
    });
    const mascot = createMascot(body.querySelector('.sv-ai-mascot'), { mouthScale: 1.7 });
    // Maskoten följer pekaren, utom medan den tänker (setThinking)
    const follow = e => mascot.lookAt(e.clientX, e.clientY);
    document.addEventListener('pointermove', follow);
    ai = { body, mascot, follow, suggestions: [], timers: [setInterval(() => mascot.blink(), 4500)] };
    renderAi('intro');
    showEarlier();
  }

  function renderAi(state, data = {}) {
    if (!ai) return;
    const { body, mascot } = ai;
    const content = body.querySelector('.sv-ai-content');
    const { acts } = aiActivities();
    const title = (t, text) => `<h3 class="sv-ai-title">${escapeHTML(t)}</h3>${text ? `<p class="sv-ai-text">${text}</p>` : ''}`;
    const button = (label, onclick, { icon = '', solid = true } = {}) =>
      `<button type="button" class="btn ${solid ? 'btn-solid' : 'btn-outline'}" onclick="${onclick}">${icon ? `<i data-lucide="${icon}"></i>` : ''}${escapeHTML(label)}</button>`;
    body.classList.toggle('is-compact', state === 'results');
    mascot.setThinking(state === 'loading');
    mascot.setLove(state === 'done');
    mascot.setMood({ intro: 'normal', loading: 'curious', results: 'happy', done: 'happy', none: 'normal', error: 'sad' }[state] || 'normal');

    let html = '';
    if (state === 'intro' && !cur) {
      html = title('Välj kurs först', 'Jag behöver veta vilken kurs upplägget hör till för att kunna föreslå punkter ur läroplanen.')
        + `<div class="sv-ai-actions">${button('Välj kurs', 'PlanCurriculum.openCoursePicker()', { icon: 'graduation-cap' })}</div>`;
    } else if (state === 'intro' && !acts.length) {
      html = title('Lägg till aktiviteter först', 'När upplägget har aktiviteter kan jag föreslå vilka punkter ur läroplanen de passar.');
    } else if (state === 'intro') {
      html = title('Koppla läroplanen till aktiviteter',
        `Jag läser ${acts.length === 1 ? 'din aktivitet' : `dina ${acts.length} aktiviteter`} och mål ur läroplanen, och föreslår vilka punkter som passar.`)
        + `<div class="sv-ai-actions">${button('Koppla', 'PlanCurriculum.runSuggestions()')}</div>`;
    } else if (state === 'loading') {
      html = title('Jag läser…', 'Aktiviteterna och Skolverkets text. Det tar oftast några sekunder.');
    } else if (state === 'error') {
      html = title('Det gick inte den här gången', escapeHTML(data.message))
        + `<div class="sv-ai-actions">${button('Försök igen', 'PlanCurriculum.runSuggestions()', { icon: 'rotate-ccw' })}</div>`;
    } else if (state === 'none') {
      html = title('Jag hittade inga nya kopplingar', 'Antingen är det som passar redan kopplat, eller så säger aktiviteterna för lite. Skriv gärna en beskrivning på aktiviteterna och försök igen.')
        + `<div class="sv-ai-actions">${button('Försök igen', 'PlanCurriculum.runSuggestions()', { icon: 'rotate-ccw', solid: false })}</div>`;
    } else if (state === 'results') {
      const n = ai.suggestions.length;
      html = (data.earlier
        ? title(`${n} förslag kvar från förra gången`, 'Bocka för det du vill koppla, eller sök igen för nya förslag.')
        : title(`Jag hittade ${n} ${n === 1 ? 'koppling' : 'kopplingar'}`, 'Bocka ur det som inte stämmer och välj Koppla.'))
        + `<div class="sv-ai-list">${aiResultsHTML(!data.earlier)}</div>`
        + `<div class="form-actions">
            ${data.earlier ? '<button type="button" class="btn btn-outline sv-ai-again" onclick="PlanCurriculum.runSuggestions()"><i data-lucide="rotate-ccw"></i>Sök igen</button>' : ''}
            <button type="button" class="btn btn-outline" onclick="PlanCurriculum.closeSuggestions()">Avbryt</button>
            <button type="button" class="btn btn-solid" id="svAiSave" onclick="PlanCurriculum.acceptSuggestions()">Koppla</button>
          </div>`;
    } else if (state === 'done') {
      html = title('Klart!', `${data.count === 1 ? 'En koppling är gjord' : `${data.count} kopplingar är gjorda`}. Du ser dem som taggar på aktiviteterna och under ${escapeHTML(C.contentTitle(cur))}.`)
        + `<div class="sv-ai-actions">${data.rest ? button(`Visa övriga förslag (${data.rest})`, 'PlanCurriculum.showEarlier()') : ''}${
          button('Stäng', 'PlanCurriculum.closeSuggestions()', { solid: false })}</div>`;
    }
    content.innerHTML = html;
    if (state === 'results') {
      const save = content.querySelector('#svAiSave');
      const count = () => {
        const n = content.querySelectorAll('.sv-ai-list input:checked').length;
        save.textContent = n ? `Koppla (${n})` : 'Koppla';
        save.disabled = !n;
      };
      content.onchange = count;
      count();
    } else {
      content.onchange = null;
    }
    lucide.createIcons({ nodes: [content] });
    if (state === 'done' || state === 'results') mascot.blink();
  }

  function aiResultsHTML(checked) {
    const byId = new Map(catalogItems('content').map(it => [it.id, it]));
    let html = '';
    aiActivities().lessons.forEach(l => l.activities.forEach(a => {
      const mine = ai.suggestions.map((s, i) => ({ s, i })).filter(({ s }) => s.activityId === a.id);
      if (!mine.length) return;
      html += `<div class="sv-picker-group">${escapeHTML(l.free ? a.title : `Gruppering ${l.number} › ${a.title}`)}</div>`;
      mine.forEach(({ s, i }) => {
        const it = byId.get(s.itemId);
        html += `<label class="sv-picker-option">
          <input type="checkbox" value="${i}"${checked ? ' checked' : ''} />
          <span class="sv-ai-option-text">
            <span>${C.leadHTML(it)}${C.textHTML(it.text)}</span>
            ${s.reason ? `<span class="sv-ai-reason">${escapeHTML(s.reason)}</span>` : ''}
            ${find('content', it.id) ? '' : `<span class="sv-ai-new">Läggs till under ${escapeHTML(C.contentTitle(cur))}</span>`}
          </span>
        </label>`;
      });
    }));
    return html;
  }

  async function runSuggestions() {
    if (!ai || !cur || hooks.readOnly()) return;
    const mine = ai;
    const { acts } = aiActivities();
    if (!acts.length) return renderAi('intro');
    renderAi('loading');
    try {
      if (!catalog) { catalog = await C.subject(cur.schoolType, cur.subject); catalogKey = cur.schoolType + '/' + cur.subject; }
    } catch (e) {
      return renderAi('error', { message: 'Kunde inte hämta Skolverkets text. Kontrollera uppkopplingen.' });
    }
    const items = catalogItems('content');
    if (!items.length) return renderAi('error', { message: `Skolverket har inget centralt innehåll för ${C.courseLabel(cur)}.` });

    let res;
    try {
      const { data, error } = await LossiAuth.client.functions.invoke('suggest-links', {
        body: {
          course: C.courseLabel(cur),
          items: items.map(it => ({ id: it.id, heading: it.heading || '', text: C.plainText((it.lead ? it.lead + ' ' : '') + it.text) })),
          activities: acts.map(a => ({ id: a.id, title: a.title, type: a.type || '', desc: a.desc || '', lesson: a.lesson })),
        },
      });
      if (error) throw error;
      res = data;
    } catch (e) {
      console.warn('Föreslå kopplingar:', e);
      const message = await aiErrorText(e);
      if (ai === mine) renderAi('error', { message });
      return;
    }
    if (ai !== mine) return; // panelen stängdes medan Haiku arbetade

    ai.suggestions = stillOpen(res?.suggestions || []);
    storeSaved(ai.suggestions);
    renderAi(ai.suggestions.length ? 'results' : 'none');
  }

  function acceptSuggestions() {
    if (!ai || !cur || !catalog || hooks.readOnly()) return;
    const items = catalogItems('content');
    const picked = [...ai.body.querySelectorAll('.sv-ai-list input:checked')].map(i => ai.suggestions[Number(i.value)]).filter(Boolean);
    picked.forEach(s => {
      let item = find('content', s.itemId);
      if (!item) {
        const fromCatalog = items.find(it => it.id === s.itemId);
        if (!fromCatalog) return;
        item = C.savedItem(fromCatalog, 'content');
        cur.content.push(item);
      }
      item.activities = [...new Set([...(item.activities || []), s.activityId])];
    });
    // Katalogens ordning, som när man bockar för själv (punkter som inte finns hos Skolverket sist)
    const order = new Map(items.map((it, i) => [it.id, i]));
    cur.content.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    changed();
    const rest = stillOpen(ai.suggestions);
    storeSaved(rest);
    renderAi('done', { count: picked.length, rest: rest.length });
  }

  function closeSuggestions() {
    if (ai) hooks.closePanel();
  }

  return {
    init, set, get, refreshLessons, openCoursePicker, pickSchoolType, renderCourseOptions, chooseSubject, backToSubjects,
    chooseLevel, clearCourse, ensureForGrade, applyFromAi, forgetActivities, openPicker, savePicker, closeModal, remove, useNewText, showStep, openLessons, openItem, unlink,
    suggestLinks, runSuggestions, acceptSuggestions, closeSuggestions, showEarlier,
  };
})();
