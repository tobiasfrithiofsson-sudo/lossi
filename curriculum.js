// ── Läroplan: Skolverkets kurs- och ämnesplaner (och förskolans läroplan) ──
// Lossi hittar inte på något eget i läroplanen. Läraren väljer en kurs (eller
// ett ämne och årskurser i grundskolan) och bockar för punkter ur Skolverkets
// text; texten visas ordagrant och går inte att ändra. Lärarens egna ord står
// bredvid, som en anteckning. Texten kommer från curriculum/ (hämtas med
// scripts/fetch-curriculum.mjs ur Skolverkets Syllabus API).
//
// I upplägget sparas valen som state.curriculum:
//   { schoolType, subject, subjectName, reform, version, level, levelName,
//     content:  [{ id, heading, text, note, lessons: [lessonId] }],
//     criteria: [{ id, E, C, A } | { id, text }, + note, lessons] }
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

  return { index, subject, levelOf, criteriaOf, courseLabel, textHTML, plainText, criterionText, compare, sourcePhrase, sourceDoc, contentTitle, leadHTML, hasCriteria, schoolTypeForGrade, WHOLE_SCHOOL_TYPES, SCHOOL_TYPE_NAMES };
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
  let hooks = { save() {}, readOnly: () => false, lessons: () => [] };
  const shownStep = new Map(); // kriterium-id → visat betygssteg (bara på sidan)
  const KINDS = {
    content:  { listId: 'contentSv',  sectionId: 'sec-goals',    icon: 'square-check', iconClass: '',                    title: 'Centralt innehåll' },
    criteria: { listId: 'criteriaSv', sectionId: 'sec-criteria', icon: 'target',       iconClass: 'goal-check-criteria', title: 'Betygskriterier' },
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

  function lessonChipsHTML(item, kind) {
    const lessons = hooks.lessons();
    const linked = (item.lessons || []).map(id => lessons.findIndex(l => l.id === id)).filter(i => i >= 0).sort((a, b) => a - b);
    const chips = linked.map(i => `<span class="sv-lesson-chip" title="${escapeHTML(lessons[i].name)}">Lektion ${i + 1}</span>`).join('');
    const editable = !hooks.readOnly();
    const button = editable && lessons.length ? `
      <div class="popover-wrap" onclick="event.stopPropagation()">
        <button type="button" class="sv-link-btn" onclick="PlanCurriculum.openLessons(this, '${kind}', '${item.id}')" title="Koppla till lektioner">
          <i data-lucide="link"></i>${linked.length ? '' : '<span>Koppla till lektion</span>'}
        </button>
        <div class="menu-popover sv-lessons-menu"></div>
      </div>` : '';
    return chips || button ? `<div class="sv-lessons">${chips}${button}</div>` : '';
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

  function rowHTML(item, kind) {
    const cfg = KINDS[kind];
    const editable = !hooks.readOnly();
    let textBlock;
    if (kind === 'criteria' && !item.text) {
      const step = shownStep.get(item.id) || 'E';
      textBlock = `
        <div class="sv-steps filter-toggle" role="group" aria-label="Visa betygssteg">
          ${['E', 'C', 'A'].map(s => `<button type="button" aria-pressed="${s === step}" onclick="PlanCurriculum.showStep('${item.id}', '${s}')">${s}</button>`).join('')}
        </div>
        <div class="goal-text sv-text">${C.textHTML(item[step])}</div>`;
    } else {
      textBlock = `${item.heading ? `<div class="sv-heading">${escapeHTML(item.heading)}</div>` : ''}
        <div class="goal-text sv-text">${C.leadHTML(item)}${C.textHTML(item.text)}</div>`;
    }
    const note = item.note || '';
    const noteHTML = editable
      ? `<div class="sv-note${note ? '' : ' is-empty'}" contenteditable="true" data-placeholder="Din anteckning, t.ex. hur ni arbetar med det här" data-kind="${kind}" data-id="${item.id}">${escapeHTML(note)}</div>`
      : (note ? `<div class="sv-note">${escapeHTML(note)}</div>` : '');
    return `<div class="goal-item sv-item" data-id="${item.id}">
      <div class="goal-check ${cfg.iconClass}"><i data-lucide="${cfg.icon}"></i></div>
      <div class="sv-main">
        ${textBlock}
        ${noteHTML}
        <div class="sv-row-foot">
          ${lessonChipsHTML(item, kind)}
          ${editable && !note ? `<button type="button" class="sv-note-btn" onclick="PlanCurriculum.focusNote(this)"><i data-lucide="pencil-line"></i><span>Anteckning</span></button>` : ''}
        </div>
        ${flagHTML(item, kind)}
      </div>
      ${editable ? `<button class="goal-delete" onclick="PlanCurriculum.remove('${kind}', '${item.id}')" title="Ta bort"><i data-lucide="x"></i></button>` : ''}
    </div>`;
  }

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
      source.innerHTML = items.length ? `<i data-lucide="landmark"></i>Ordagrann text ur ${escapeHTML(C.sourcePhrase(cur))}${cur.reform ? ` (${escapeHTML(cur.reform)})` : ''}` : '';
    }
    const hint = document.getElementById(cfg.listId + 'Hint');
    if (hint) hint.hidden = !!cur;
    lucide.createIcons({ nodes: [list, source, hint].filter(Boolean) });
  }

  // Lektionerna har ändrats (ny, borttagen, flyttad, nytt namn)
  function refreshLessons() {
    if (!cur) return;
    const ids = new Set(hooks.lessons().map(l => l.id));
    let pruned = false;
    ['content', 'criteria'].forEach(kind => cur[kind].forEach(item => {
      const kept = (item.lessons || []).filter(id => ids.has(id));
      if (kept.length !== (item.lessons || []).length) { item.lessons = kept; pruned = true; }
    }));
    Object.keys(KINDS).forEach(renderList);
    if (pruned && !hooks.readOnly()) hooks.save();
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
  }

  function focusNote(btn) {
    const note = btn.closest('.sv-main').querySelector('.sv-note');
    note.classList.remove('is-empty');
    btn.remove();
    note.focus();
  }

  function openLessons(btn, kind, id) {
    const item = find(kind, id);
    const menu = btn.nextElementSibling;
    if (!item || !menu) return;
    const lessons = hooks.lessons();
    const linked = new Set(item.lessons || []);
    menu.innerHTML = `<div class="sv-lessons-title">Vilka lektioner tar upp det här?</div>` + lessons.map((l, i) => `
      <label class="sv-lesson-option">
        <input type="checkbox" value="${escapeHTML(l.id)}"${linked.has(l.id) ? ' checked' : ''} />
        <span><strong>Lektion ${i + 1}</strong>${l.name && !/^lektion \d+$/i.test(l.name) ? ` <span class="sv-lesson-name">${escapeHTML(l.name.replace(/^lektion \d+\s*[:–-]\s*/i, ''))}</span>` : ''}</span>
      </label>`).join('');
    menu.onchange = () => {
      item.lessons = [...menu.querySelectorAll('input:checked')].map(i => i.value);
      hooks.save();
    };
    toggleAppPopover(btn);
    // Raden ritas om när menyn stängs, så att kopplingarna syns
    const onClose = new MutationObserver(() => {
      if (menu.classList.contains('open')) return;
      onClose.disconnect();
      renderList(kind);
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
    if ((item.note || '') === text) { if (!text) renderList(field.dataset.kind); return; }
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
      return kind === 'criteria'
        ? (it.text ? { id: it.id, text: it.text, lessons: [] } : { id: it.id, E: it.E, C: it.C, A: it.A, lessons: [] })
        : { id: it.id, heading: it.heading || null, ...(it.lead ? { lead: it.lead } : {}), text: it.text, lessons: [] };
    });
    // Valda punkter som inte längre finns hos Skolverket tas bara bort på raden
    old.forEach((it, id) => { if (!catalogItems(kind).some(c => c.id === id)) cur[kind].push(it); });
    closeModal('svPickerModal');
    changed();
  }

  return {
    init, set, get, refreshLessons, openCoursePicker, pickSchoolType, renderCourseOptions, chooseSubject, backToSubjects,
    chooseLevel, clearCourse, ensureForGrade, openPicker, savePicker, closeModal, remove, useNewText, showStep, focusNote, openLessons,
  };
})();
