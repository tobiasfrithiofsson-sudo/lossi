// Apply saved theme before paint to avoid flash
(function () {
  if (localStorage.getItem('lossi-theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('lossi-theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('lossi-theme', 'dark');
  }
  syncThemeIcons();
}

function syncThemeIcons() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  // Användarmenyns tema-rad (topbaren har ingen egen temaknapp längre)
  const themeItem = document.getElementById('themeMenuItem');
  if (themeItem) {
    themeItem.innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>${isDark ? 'Ljust läge' : 'Mörkt läge'}`;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [themeItem] });
  }
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.setAttribute('title', isDark ? 'Byt till ljust läge' : 'Byt till mörkt läge');
    btn.innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  });
}

// ── Appväxlare (platshållare) ──
// Popover i headern som pekar mot framtida appar i Lossi-familjen
// (kalender, betygssystem, föräldrakontakt m.fl.). Navigerar inte
// någonstans ännu förutom till Lossi självt.
function toggleAppSwitcher() {
  const popover = document.getElementById('appSwitcherPopover');
  const btn = document.getElementById('appSwitcherBtn');
  if (!popover || !btn) return;
  const isOpen = popover.classList.contains('open');
  if (!isOpen) {
    const rect = btn.getBoundingClientRect();
    popover.style.top = rect.bottom + 6 + 'px';
    popover.style.right = 'auto';
    popover.style.left = rect.left + 'px';
  }
  popover.classList.toggle('open');
}

document.addEventListener('click', e => {
  const switcher = document.querySelector('.app-switcher');
  if (switcher && !switcher.contains(e.target)) {
    document.getElementById('appSwitcherPopover')?.classList.remove('open');
  }
});

// ── Sidopanelen som meny på mobil ──
function toggleAside(open) {
  const isOpen = typeof open === 'boolean' ? open : !document.body.classList.contains('aside-open');
  document.body.classList.toggle('aside-open', isOpen);
  document.getElementById('asideToggle')?.setAttribute('aria-expanded', String(isOpen));
}

function closeAside() {
  toggleAside(false);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('aside-open')) closeAside();
});

// ── Välj eller skriv in (klass, ämne) ──
// Ett textfält med förslagslista. Förslagen är lärarens egna värden (sparade i
// profilen, t.ex. user_metadata.subjects), eventuella standardförslag och
// värden som redan används i upplägg. Skriver läraren något nytt visas
// "Lägg till '…'". Egna värden kan tas bort ur listan med ×.
const CHOICE_MAX_LENGTH = 40;

function normalizeChoice(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, CHOICE_MAX_LENGTH);
}

function savedChoices(key) {
  const list = currentUser?.user_metadata?.[key];
  return Array.isArray(list) ? list : [];
}

function sameChoice(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

// Unika värden (skiftlägesokänsligt), sorterade på svenska
function mergeChoices(...lists) {
  const seen = new Map();
  lists.flat().forEach(v => {
    const name = normalizeChoice(v);
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
}

async function rememberChoice(key, name) {
  const saved = savedChoices(key);
  if (!name || saved.some(c => sameChoice(c, name))) return;
  try {
    currentUser = await LossiAuth.saveUserList(key, [...saved, name]);
  } catch (e) {
    console.warn('Kunde inte spara i profilen:', e);
  }
}

// Skapa byter sida direkt i stället för att vänta på profilen (updateUser är
// långsamt och avbryts av sidbytet). Värdet sparas när nästa sida har användaren.
const PENDING_CHOICE_KEY = 'lossi-pending-choice';
function rememberChoiceLater(key, name) {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_CHOICE_KEY) || '[]');
    sessionStorage.setItem(PENDING_CHOICE_KEY, JSON.stringify([...(Array.isArray(pending) ? pending : []), { key, name }]));
  } catch (e) {
    rememberChoice(key, name);
  }
}

async function savePendingChoice() {
  let pending = [];
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_CHOICE_KEY) || '[]');
    sessionStorage.removeItem(PENDING_CHOICE_KEY);
  } catch (e) {}
  // En i taget: varje sparning skriver hela profilens lista
  for (const p of Array.isArray(pending) ? pending : []) {
    if (p?.key && p.name) await rememberChoice(p.key, p.name);
  }
}

async function forgetChoice(key, name) {
  try {
    currentUser = await LossiAuth.saveUserList(key, savedChoices(key).filter(c => !sameChoice(c, name)));
  } catch (e) {
    console.warn('Kunde inte ta bort ur profilen:', e);
  }
}

// Värden som används i lärarens upplägg (t.ex. state.subject), hämtas en gång per sida
let planChoicesPromise = null;
function planFieldValues(field) {
  planChoicesPromise = planChoicesPromise || LossiData.listMyPlans().catch(() => []);
  return planChoicesPromise.then(plans => plans.map(p => p.state?.[field]).filter(Boolean));
}

// Kopplar förslagslistan till ett textfält.
//   input, list    – fältet och listans element
//   getItems()     – [{ name, removable }]
//   getCurrent()   – valt värde (markeras med bock)
//   onPick(name, isNew), onForget(name)
//   emptyText      – visas när det inte finns några förslag alls
//   inline         – listan visas under fältet när det har fokus (Skapa-dialogen);
//                    annars ligger den i en popover som öppnas på annat sätt
//   allowAdd       – false: bara befintliga val (inget "Lägg till …"), t.ex. projektets medlemmar
function createChoiceList({ input, list, getItems, getCurrent = () => '', onPick, onForget, emptyText, inline = false, allowAdd = true }) {
  let highlight = 0;

  function options() {
    const query = normalizeChoice(input.value);
    const q = query.toLowerCase();
    const items = getItems();
    const matches = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items.slice();
    matches.sort((a, b) => (b.name.toLowerCase().startsWith(q)) - (a.name.toLowerCase().startsWith(q)));
    const opts = matches.map(i => ({ ...i, type: 'item' }));
    // Befintliga träffar först (Enter väljer bästa träffen), "Lägg till" sist
    if (allowAdd && query && !items.some(i => sameChoice(i.name, query))) opts.push({ type: 'add', name: query });
    return opts;
  }

  function render() {
    const opts = options();
    const current = getCurrent() || '';
    highlight = Math.max(0, Math.min(highlight, opts.length - 1));
    list.innerHTML = opts.length
      ? opts.map((o, i) => o.type === 'add'
        ? `<div class="choice-option is-add${i === highlight ? ' is-active' : ''}" role="option" data-index="${i}">
             <i data-lucide="plus"></i><span>Lägg till <strong>${escapeHTML(o.name)}</strong></span>
           </div>`
        : `<div class="choice-option${i === highlight ? ' is-active' : ''}${sameChoice(o.name, current) ? ' is-selected' : ''}" role="option" data-index="${i}" aria-selected="${sameChoice(o.name, current)}">
             <span class="choice-option-name">${escapeHTML(o.name)}${o.meta ? `<span class="choice-option-meta">${escapeHTML(o.meta)}</span>` : ''}</span>
             ${sameChoice(o.name, current) ? '<i data-lucide="check" class="choice-option-check"></i>' : ''}
             ${o.removable ? `<button type="button" class="choice-option-forget" data-forget="${escapeHTML(o.name)}" title="Ta bort ur listan" aria-label="Ta bort ${escapeHTML(o.name)} ur listan"><i data-lucide="x"></i></button>` : ''}
           </div>`).join('')
      : `<div class="choice-empty">${getItems().length ? 'Inget matchar.' : emptyText}</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [list] });
  }

  function pick(index) {
    const o = options()[index];
    if (!o) return;
    onPick(o.name, o.type === 'add');
    if (inline) { input.value = o.name; close(); }
  }

  function open() { if (inline) list.hidden = false; render(); }
  function close() { if (inline) list.hidden = true; }

  input.addEventListener('input', () => { highlight = 0; open(); });
  input.addEventListener('keydown', e => {
    const count = options().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (inline && list.hidden) return open();
      if (!count) return;
      highlight = (highlight + (e.key === 'ArrowDown' ? 1 : -1) + count) % count;
      render();
      list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (inline && list.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      pick(highlight);
    } else if (e.key === 'Escape') {
      if (inline && !list.hidden) { e.stopPropagation(); close(); }
    }
  });
  if (inline) {
    input.addEventListener('focus', () => { highlight = 0; open(); });
    input.addEventListener('click', () => { if (list.hidden) open(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }
  // mousedown i stället för click, så att fältet inte tappar fokus först
  list.addEventListener('mousedown', async e => {
    const forget = e.target.closest('.choice-option-forget');
    if (forget) {
      e.preventDefault();
      await onForget?.(forget.dataset.forget);
      render();
      input.focus();
      return;
    }
    const option = e.target.closest('.choice-option');
    if (option) {
      e.preventDefault();
      pick(Number(option.dataset.index));
    }
  });

  return {
    render,
    reset() { input.value = ''; highlight = 0; render(); },
    open,
    close,
  };
}

// Ämnen och årskurser: standardförslagen (PLAN_SUBJECTS/PLAN_GRADES), lärarens
// egna och de som används i upplägg. Ett nytt värde sparas i profilen
// (user_metadata.subjects/grades) när det väljs.
const CHOICE_KINDS = {
  subjects: { suggestions: () => PLAN_SUBJECTS, planField: 'subject', emptyText: 'Skriv namnet på ett ämne och tryck Enter.' },
  grades: { suggestions: () => PLAN_GRADES, planField: 'grade', normalize: v => normalizeGrade(v), emptyText: 'Skriv en årskurs, t.ex. 7 eller Gy 1, och tryck Enter.' },
};
const choicesFromPlans = { subjects: [], grades: [] };

// Årskurser i skolordning: F, sedan siffrorna, sedan resten (t.ex. Gy 1)
function gradeOrder(a, b) {
  const rank = g => (/^F\b/i.test(g) ? 0 : /^\d/.test(g) ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b, 'sv', { numeric: true });
}

function choiceItems(key) {
  const suggestions = CHOICE_KINDS[key].suggestions();
  const names = mergeChoices(suggestions, savedChoices(key), choicesFromPlans[key]);
  if (key === 'grades') names.sort(gradeOrder);
  return names.map(name => ({
    name,
    removable: !suggestions.some(s => sameChoice(s, name)),
  }));
}

function subjectItems() { return choiceItems('subjects'); }
function gradeItems() { return choiceItems('grades'); }

function initSavedChoices(key, input, list, { inline = false, getCurrent, onPick }) {
  const kind = CHOICE_KINDS[key];
  planFieldValues(kind.planField).then(v => { choicesFromPlans[key] = v; });
  return createChoiceList({
    input, list, inline, getCurrent,
    getItems: () => choiceItems(key),
    emptyText: kind.emptyText,
    onPick: (name, isNew) => {
      if (kind.normalize) name = kind.normalize(name);
      if (isNew && !choiceItems(key).some(i => sameChoice(i.name, name))) rememberChoice(key, name);
      onPick(name, isNew);
    },
    onForget: async name => {
      choicesFromPlans[key] = choicesFromPlans[key].filter(s => !sameChoice(s, name));
      await forgetChoice(key, name);
    },
  });
}

function initSubjectChoices(input, list, options) {
  return initSavedChoices('subjects', input, list, options);
}

function initGradeChoices(input, list, options) {
  return initSavedChoices('grades', input, list, options);
}

// Läraren skriver årskursen själv; "Åk 7" och "årskurs 7" sparas som "7"
function normalizeGrade(value) {
  return normalizeChoice(String(value || '').replace(/^\s*(åk|årskurs)\.?\s*/i, ''));
}

// "7", "7–9" och "F" visas som "Åk 7"; annat (t.ex. "Gy 1") som det är skrivet
function gradeLabel(grade) {
  if (!grade) return '';
  return /^(F|\d+)(\s*[–-]\s*(F|\d+))?$/i.test(grade) ? 'Åk ' + grade : grade;
}

// ── Logga ut ──
// Spara först: åtkomsttoken försvinner vid utloggningen, och sidbytet efteråt
// hinner annars inte skicka ändringar som väntar på att sparas.
function logOut() {
  forgetAsideCache();
  if (typeof saveState === 'function') saveState();
  if (typeof LossiData !== 'undefined') LossiData.flushOnLeave();
  LossiAuth.signOut();
}

// ── Uppläggsavatarer ──
// Delad lista för index.html och upplag.html, så att samma upplägg visar
// samma bild överallt. Varje upplägg sparar sitt eget val (fältet "avatar"
// i lossi-plan-<id>); två upplägg kan ha samma bild utan att vara kopplade.
const PLAN_AVATAR_DIR = 'Upplagg avatar/';
const PLAN_AVATARS = [
  { id: 'sailboat',  file: 'Abstract sailboat avatar.svg',   label: 'Segelbåt' },
  { id: 'lightning', file: 'Angular lightning avatar.svg',   label: 'Blixt' },
  { id: 'compass',   file: 'Celestial compass avatar.svg',   label: 'Kompass' },
  { id: 'hourglass', file: 'Colorful hourglass avatar.svg',  label: 'Timglas' },
  { id: 'window',    file: 'Floating window avatar.svg',     label: 'Fönster' },
  { id: 'fan',       file: 'Folded fan avatar.svg',          label: 'Solfjäder' },
  { id: 'sunrise',   file: 'Geometric sunrise avatar.svg',   label: 'Soluppgång' },
  { id: 'mushroom',  file: 'Graphic mushroom avatar.svg',    label: 'Svamp' },
  { id: 'cube',      file: 'Impossible cube avatar.svg',     label: 'Kub' },
  { id: 'knot',      file: 'Looped knot avatar.svg',         label: 'Knut' },
  { id: 'diamond',   file: 'Orbiting diamond avatar.svg',    label: 'Diamant' },
  { id: 'windmill',  file: 'Paper windmill avatar.svg',      label: 'Väderkvarn' },
  { id: 'totem',     file: 'Pebble totem avatar.svg',        label: 'Stenröse' },
  { id: 'rainbow',   file: 'Rainbow bridge avatar.svg',      label: 'Regnbåge' },
  { id: 'staircase', file: 'Ribbon staircase avatar.svg',    label: 'Trappa' },
  { id: 'wave',      file: 'Sculptural wave avatar.svg',     label: 'Våg' },
  { id: 'mobile',    file: 'Sculpture mobile avatar.svg',    label: 'Mobil' },
  { id: 'balance',   file: 'Stacked balance avatar.svg',     label: 'Balans' },
  { id: 'pyramid',   file: 'Stepped pyramid avatar.svg',     label: 'Pyramid' },
  { id: 'crescents', file: 'Twin crescents avatar.svg',      label: 'Månskäror' },
];

function findPlanAvatar(id) {
  return PLAN_AVATARS.find(a => a.id === id) || null;
}

// Upplägg utan eget val (nya, eller äldre sparade lägen) får en slumpad bild
// första gången de visas. Den sparas under en egen nyckel, så att översikten
// och upplag.html visar samma bild utan att röra det sparade upplägget.
function randomPlanAvatarId(planId) {
  const key = 'lossi-plan-avatar-' + (planId || '1');
  let id = null;
  try { id = localStorage.getItem(key); } catch (e) {}
  if (findPlanAvatar(id)) return id;

  id = PLAN_AVATARS[Math.floor(Math.random() * PLAN_AVATARS.length)].id;
  try { localStorage.setItem(key, id); } catch (e) {}
  return id;
}

// Ger ett giltigt avatar-id för ett upplägg: lärarens val om det finns, annars den slumpade
function resolvePlanAvatarId(planId, savedId) {
  return findPlanAvatar(savedId) ? savedId : randomPlanAvatarId(planId);
}

function planAvatarImgHTML(id) {
  const avatar = findPlanAvatar(id) || PLAN_AVATARS[0];
  return `<img src="${encodeURI(PLAN_AVATAR_DIR + avatar.file)}" alt="" />`;
}

// ── Ämnen och årskurser ──
// Delas av Skapa-dialogen och Detaljer-panelen i upplag.html.
const PLAN_SUBJECTS = ['Samhällskunskap', 'Svenska', 'Matematik', 'Biologi', 'Fysik', 'Kemi', 'Engelska', 'Idrott', 'Bild'];
// Bara förslag: läraren kan skriva in vilken årskurs som helst
const PLAN_GRADES = ['F', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

// ── Uppläggsregister ──
// Vilka upplägg som finns och deras innehåll hämtas via LossiData (data.js).
// DEMO_PLANS är demo-uppläggen som nya lärare får (data.js lägger in dem);
// nyckeln följer med som state.demoKey så att Kommande-korten hittar dem.
const DEMO_PLANS = {
  '1': { title: 'Demokrati – grunderna och processerna', subject: 'Samhällskunskap', grade: '7–9' },
  '2': { title: 'Källkritik i det digitala samhället', subject: 'Samhällskunskap', grade: '9' },
  '3': { title: 'Fotosyntes – från molekyl till ekosystem', subject: 'Biologi', grade: '7' },
};

// Det som listor (aside, översikt) behöver veta om ett upplägg
function getPlanSummary(id, state, ownerId = null) {
  state = state || {};
  const demo = DEMO_PLANS[state.demoKey] || {};
  return {
    id,
    ownerId,
    demoKey: state.demoKey || null,
    title: state.title || demo.title || 'Namnlöst upplägg',
    subject: state.subject || demo.subject || '',
    grade: state.grade || demo.grade || '',
    avatar: resolvePlanAvatarId(id, state.avatar),
  };
}

// Senast skapade först (samma filter som LossiData.listPlans)
async function getPlanSummaries(filter) {
  const plans = await LossiData.listPlans(filter);
  return plans.reverse().map(p => getPlanSummary(p.id, p.state, p.ownerId));
}

function escapeHTML(text) {
  return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── App-skal: topbar + aside ──
// Byggs här så att index.html och upplag.html delar exakt samma innehåll.
// Sidan anropar renderAppShell() först i sitt script, före lucide.createIcons().
// Sidopanelen är personlig: den visar den inloggades egna upplägg i valt
// projekt (projektväljaren överst) och egna kalenderhändelser, aldrig andras.
// Team och inbjudan är platshållare. Gruppen Kalender fylls från kalendern
// av renderAsideEvents() i schedule.js.
const APP_TEAMS = [
  { name: 'Astronomerna', emoji: '🚀' },
  { name: 'Dricka kaffe?', emoji: '☕' },
];
const ASIDE_PLAN_LIMIT = 4;

function renderAppShell(options = {}) {
  const header = document.querySelector('header.app-topbar');
  if (header) header.innerHTML = buildTopbarHTML(options.active);

  const aside = document.querySelector('aside.app-aside');
  if (aside && !document.querySelector('.aside-backdrop')) {
    document.body.insertAdjacentHTML('beforeend', '<div class="aside-backdrop" onclick="closeAside()"></div>');
    // En länk i menyn byter sida; stäng menyn direkt så att den inte syns kvar vid bakåt
    aside.addEventListener('click', e => { if (e.target.closest('a[href]')) closeAside(); });
  }
  if (aside) {
    aside.innerHTML = buildAsideHTML(options.active);
    paintAsideFromCache(aside, options.currentPlanId);
    renderProjectSwitcher(options.onProjectChange);
    renderAsidePlans(options.currentPlanId).catch(e => console.warn('Kunde inte hämta upplägg till sidopanelen:', e));
    if (typeof renderAsideEvents === 'function') renderAsideEvents();
  }

  if (header) startNotifications();

  if (!document.getElementById('createPlanModal')) {
    document.body.insertAdjacentHTML('beforeend', buildCreatePlanModalHTML());
    document.getElementById('createPlanModal').addEventListener('click', e => {
      if (e.target.id === 'createPlanModal') closeCreatePlanModal();
    });
    initSubjectChoices(document.getElementById('createPlanSubject'), document.getElementById('createPlanSubjectList'), {
      inline: true,
      onPick: () => {},
    });
    initGradeChoices(document.getElementById('createPlanGrade'), document.getElementById('createPlanGradeList'), {
      inline: true,
      onPick: () => {},
    });
  }

  if (!document.getElementById('profileModal')) {
    document.body.insertAdjacentHTML('beforeend', buildProfileModalHTML());
    document.getElementById('profileModal').addEventListener('click', e => {
      if (e.target.id === 'profileModal') closeProfileModal();
    });
  }

  if (!document.getElementById('inviteModal')) {
    document.body.insertAdjacentHTML('beforeend', buildInviteModalsHTML());
    ['inviteModal', 'createProjectModal', 'deleteProjectModal', 'projectSettingsModal'].forEach(id => document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) document.getElementById(id).classList.remove('open');
    }));
  }

  if (!document.getElementById('passwordModal')) {
    document.body.insertAdjacentHTML('beforeend', buildPasswordModalHTML());
    document.getElementById('passwordModal').addEventListener('click', e => {
      if (e.target.id === 'passwordModal') closePasswordModal();
    });
  }
}

function buildTopbarHTML(active) {
  return `
  <div class="app-topbar-start">
    <!-- Bara på mobil: öppnar sidopanelen som en meny (styles.css, MOBIL) -->
    <button class="aside-toggle" id="asideToggle" onclick="toggleAside()" aria-label="Meny" aria-expanded="false">
      <i data-lucide="menu"></i>
    </button>
    <!-- Appväxlare: platshållare för navigering mellan tjänsterna i Lossi-familjen -->
    <div class="app-switcher">
      <button class="app-switcher-btn" onclick="toggleAppSwitcher()" id="appSwitcherBtn" title="Appar i Lossi-familjen">
        <i data-lucide="shapes"></i>
      </button>
      <div class="app-switcher-popover" id="appSwitcherPopover">
        <div class="app-switcher-label">Lossi-familjen</div>
        <a href="index.html" class="app-switcher-item active">
          <div class="app-switcher-icon app-icon-lossi"><i data-lucide="layers"></i></div>
          <span class="app-switcher-name">Lossi</span>
        </a>
        <a href="calendar.html" class="app-switcher-item">
          <div class="app-switcher-icon app-icon-calendar"><i data-lucide="calendar-days"></i></div>
          <span class="app-switcher-name">Kalender</span>
        </a>
        <div class="app-switcher-item is-disabled" title="Kommer senare">
          <div class="app-switcher-icon app-icon-grades"><i data-lucide="graduation-cap"></i></div>
          <span class="app-switcher-name">Betygssystem</span>
          <span class="app-switcher-soon">Snart</span>
        </div>
        <div class="app-switcher-item is-disabled" title="Kommer senare">
          <div class="app-switcher-icon app-icon-contact"><i data-lucide="message-circle"></i></div>
          <span class="app-switcher-name">Föräldrakontakt</span>
          <span class="app-switcher-soon">Snart</span>
        </div>
      </div>
    </div>
    <a href="index.html" class="logo">
      <div class="logo-mark">
        <img src="lossi-logo-sm.svg" alt="" width="34" height="34" />
      </div>
      <span class="logo-text">Lossi</span>
    </a>
    <!-- Sidorna (Upplägg, Kalender …) ligger i sidopanelen, se buildAsideHTML -->
    <div class="topnav">
      <button class="btn btn-solid topnav-create" onclick="openCreatePlanModal()">Skapa</button>
    </div>
  </div>

  <div class="app-topbar-end">
    <!-- Notiser (renderNotifications): inbjudningar, förfrågningar, medskapare, nya medlemmar -->
    <div class="notif-wrap" id="notifWrap">
      <button type="button" class="btn btn-text btn-icon notif-btn" id="notifBtn" onclick="toggleNotifications()" aria-label="Notiser" aria-expanded="false" title="Notiser">
        <i data-lucide="bell"></i>
        <span class="notif-badge" id="notifBadge" hidden></span>
      </button>
      <div class="notif-panel" id="notifPanel" role="dialog" aria-label="Notiser">
        <div class="notif-head">Notiser</div>
        <div class="notif-list" id="notifList"></div>
      </div>
    </div>
    <button class="btn btn-outline feedback-btn" onclick="openFeedbackModal()" title="Ge feedback – idéer, tankar eller buggar">
      <i data-lucide="message-square-heart"></i>
      <span class="feedback-btn-label">Feedback</span>
    </button>
    <div class="user-menu">
      <div class="user-badge" onclick="toggleUserMenu()" id="userBadge" data-user-title>
        <div class="user-avatar-sm" data-user-avatar></div>
        <i data-lucide="chevron-down"></i>
      </div>
      <div class="user-menu-dropdown" id="userMenuDropdown">
        <div class="user-menu-account" id="userMenuAccount" hidden>
          <div class="user-menu-account-avatar" data-user-avatar></div>
          <div class="user-menu-account-text">
            <span class="user-menu-account-name" data-user-name></span>
            <span class="user-menu-account-email" id="userMenuEmail"></span>
          </div>
        </div>
        <button class="user-menu-item" onclick="openProfileModal()">
          <i data-lucide="user"></i>
          Profil
        </button>
        <button class="user-menu-item" onclick="openTourFromMenu()">
          <i data-lucide="map"></i>
          Visa rundturen
        </button>
        <button class="user-menu-item" id="themeMenuItem" onclick="toggleTheme()"></button>
        <a class="user-menu-item" href="admin.html" id="adminFeedbackLink" hidden>
          <i data-lucide="shield"></i>
          Admin
        </a>
        <button class="user-menu-item" onclick="openPasswordModal()">
          <i data-lucide="key-round"></i>
          Byt lösenord
        </button>
        <div class="user-menu-sep"></div>
        <button class="user-menu-item" onclick="logOut()">
          <i data-lucide="log-out"></i>
          Logga ut
        </button>
      </div>
    </div>
  </div>`;
}

// ── Grupperna i sidopanelen ──
// Rubriken är en knapp som fäller ihop/ut gruppen (läget sparas i webbläsaren);
// pilen till höger går till gruppens sida. Team saknar sida än (Snart).
const ASIDE_COLLAPSED_KEY = 'lossi-aside-collapsed';

function asideCollapsedGroups() {
  try { return JSON.parse(localStorage.getItem(ASIDE_COLLAPSED_KEY) || '[]'); } catch (e) { return []; }
}

function asideGroupHTML({ id, label, href, actionLabel, soon = false, body }) {
  const collapsed = asideCollapsedGroups().includes(id);
  const action = href
    ? `<a class="aside-group-action" href="${href}" title="${escapeHTML(actionLabel)}" aria-label="${escapeHTML(actionLabel)}"><i data-lucide="arrow-right"></i></a>`
    : `<span class="aside-group-action is-disabled" title="${escapeHTML(actionLabel)}" aria-hidden="true"><i data-lucide="arrow-right"></i></span>`;
  return `
    <div class="aside-group${collapsed ? ' is-collapsed' : ''}" data-aside-group="${id}">
      <div class="aside-group-head">
        <button type="button" class="aside-group-toggle" aria-expanded="${!collapsed}" aria-controls="asideGroup-${id}" onclick="toggleAsideGroup('${id}')">
          <span class="aside-label">${escapeHTML(label)}</span>
          ${soon ? '<span class="soon-badge">Snart</span>' : ''}
          <i data-lucide="chevron-down" class="aside-group-chevron"></i>
        </button>
        ${action}
      </div>
      <div class="aside-group-body" id="asideGroup-${id}"${collapsed ? ' hidden' : ''}>${body}</div>
    </div>`;
}

function toggleAsideGroup(id) {
  const group = document.querySelector(`[data-aside-group="${id}"]`);
  if (!group) return;
  const collapse = !group.classList.contains('is-collapsed');
  group.classList.toggle('is-collapsed', collapse);
  group.querySelector('.aside-group-toggle').setAttribute('aria-expanded', String(!collapse));
  group.querySelector('.aside-group-body').hidden = collapse;
  const saved = asideCollapsedGroups().filter(g => g !== id);
  if (collapse) saved.push(id);
  try { localStorage.setItem(ASIDE_COLLAPSED_KEY, JSON.stringify(saved)); } catch (e) {}
}

// Lossis sidor, längst ner i sidopanelen (flyttade från topbaren)
function asideNavHTML(active) {
  const link = (id, href, icon, label) =>
    `<a href="${href}" class="aside-item${active === id ? ' active' : ''}"${active === id ? ' aria-current="page"' : ''}><i data-lucide="${icon}"></i><span class="aside-item-text">${label}</span></a>`;
  const soon = (icon, label, what) =>
    `<div class="aside-item is-placeholder is-soon" title="${what} kommer snart" aria-disabled="true"><i data-lucide="${icon}"></i><span class="aside-item-text">${label}</span><span class="soon-badge">Snart</span></div>`;
  return `
    <nav class="aside-group aside-nav" aria-label="Sidor i Lossi">
      ${link('plans', 'index.html', 'roller-coaster', 'Upplägg')}
      ${link('calendar', 'calendar.html', 'calendar-days', 'Kalender')}
      ${soon('folder-open', 'Material', 'Material')}
      ${link('marketplace', 'marknadsplats.html', 'candy', 'Marknadsplats')}
    </nav>`;
}

function buildAsideHTML(active) {
  let inviteDismissed = false;
  try { inviteDismissed = localStorage.getItem('lossi-invite-dismissed') === 'true'; } catch (e) {}

  return `
  <div class="aside-scroll">
    <!-- Projektväljare (renderProjectSwitcher) -->
    <div class="aside-project-wrap" id="projectSwitcher">
      <div class="aside-project">
        <div class="aside-project-icon"></div>
        <span class="aside-project-name"></span>
      </div>
    </div>

    ${asideGroupHTML({ id: 'calendar', label: 'Kalender', href: 'calendar.html', actionLabel: 'Gå till kalendern',
      body: '<div class="aside-events-list"></div>' })}

    ${asideGroupHTML({ id: 'plans', label: 'Upplägg', href: 'index.html', actionLabel: 'Gå till upplägg',
      body: `<div class="aside-plan-list"></div>
      <button type="button" class="aside-item aside-more" onclick="openCreatePlanModal()">
        <i data-lucide="plus"></i>
        <span class="aside-item-text">Skapa</span>
      </button>` })}

    ${asideGroupHTML({ id: 'teams', label: 'Team', soon: true, actionLabel: 'Team kommer snart',
      body: APP_TEAMS.map(t => `
        <div class="aside-item is-placeholder is-soon" title="Team kommer snart – exempel på hur det kan se ut">
          <span class="aside-dot"></span>
          <span class="aside-item-text">${escapeHTML(t.name)} ${t.emoji}</span>
        </div>`).join('') })}

    ${asideNavHTML(active)}
  </div>

  ${inviteDismissed ? '' : `
  <div class="aside-invite" role="button" tabindex="0" onclick="openInviteOrJoin(event)" onkeydown="if (event.key === 'Enter') openInviteOrJoin(event)">
    <i data-lucide="user-plus" class="aside-invite-icon"></i>
    <div class="aside-invite-text">
      <div class="aside-invite-title" id="asideInviteTitle">Bjud in kollegor</div>
      <div class="aside-invite-sub" id="asideInviteSub">Samarbeta med ditt team</div>
    </div>
    <button class="aside-invite-close" onclick="event.stopPropagation(); dismissInvite()" title="Dölj"><i data-lucide="x"></i></button>
  </div>`}`;
}

// ── Projektväljaren överst i sidopanelen ──
// Visar valt projekt; en meny listar alla projekt man är med i. Att byta
// projekt sparas i webbläsaren och laddar om sidan (eller anropar
// onProjectChange, om sidan själv vill rita om, som översikten).
const PROJECT_COLORS = ['--color-avatar-6', '--color-avatar-2', '--color-avatar-3', '--color-avatar-4', '--color-avatar-5', '--color-avatar-1'];

// Alla projekt är likadana; det första (personal) kan bara inte tas bort.
// Projektets avatar: en ur USER_AVATARS (ikon på färgtoning), eller projektets
// första bokstav. Utan vald avatar får projektet en färg efter sitt id.
function projectAvatarHTML(project, avatarId = project.avatar, extraClass = '') {
  const chosen = USER_AVATARS.find(a => a.id === avatarId && a.icon);
  const colors = chosen || USER_AVATARS[1 + (Number(project.id) % (USER_AVATARS.length - 1))];
  const letter = (String(project.name || '?').trim()[0] || '?').toUpperCase();
  const inner = chosen ? `<i data-lucide="${chosen.icon}"></i>` : `<span class="project-avatar-letter">${escapeHTML(letter)}</span>`;
  return `<span class="project-avatar ${extraClass}" style="--face-a:${colors.a};--face-b:${colors.b}">${inner}</span>`;
}

function projectIconHTML(project) {
  return projectAvatarHTML(project, project.avatar, 'aside-project-icon');
}

function projectMetaText(project) {
  const n = project.members.length;
  if (n === 1) return 'Bara du';
  return n ? `${n} medlemmar` : 'Projekt';
}

function isProjectOwner(project, user) {
  return project.members.some(m => m.userId === user?.id && m.role === 'owner') || (project.personal && !project.members.length);
}

// Sidans onProjectChange (översikten ritar om i stället för att ladda om), så att namnbytet kan rita om väljaren
let projectSwitcherOnChange;

async function renderProjectSwitcher(onProjectChange) {
  if (onProjectChange !== undefined) projectSwitcherOnChange = onProjectChange;
  const wrap = document.getElementById('projectSwitcher');
  if (!wrap) return;
  let projects, current, user;
  try {
    [projects, current, user] = await Promise.all([LossiData.listProjects(), LossiData.currentProject(), LossiAuth.getUser()]);
  } catch (e) {
    console.warn('Kunde inte hämta projekt:', e);
    wrap.innerHTML = '';
    return;
  }
  if (!current) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = `
    <button type="button" class="aside-project aside-project-btn" onclick="toggleProjectMenu()" aria-haspopup="menu" aria-expanded="false" title="Byt projekt">
      ${projectIconHTML(current)}
      <span class="aside-project-name">${escapeHTML(current.name)}</span>
      <i data-lucide="chevrons-up-down" class="aside-project-chevron"></i>
    </button>
    <div class="project-menu" id="projectMenu" role="menu">
      <div class="project-menu-head">
        ${projectAvatarHTML(current, current.avatar, 'project-menu-head-avatar')}
        <span class="project-menu-text">
          <span class="project-menu-head-name">${escapeHTML(current.name)}</span>
          <span class="project-menu-meta">${escapeHTML(projectMetaText(current))}</span>
        </span>
      </div>
      <button type="button" class="project-menu-item" onclick="toggleProjectMenu(false); openProjectSettings()">
        <i data-lucide="settings" class="project-menu-glyph"></i><span class="project-menu-name">Inställningar</span>
      </button>
      <button type="button" class="project-menu-item" onclick="toggleProjectMenu(false); openInviteModal()">
        <i data-lucide="user-plus" class="project-menu-glyph"></i><span class="project-menu-name">Bjud in medlemmar</span>
      </button>
      <div class="menu-popover-sep"></div>
      <div class="project-menu-label">Dina projekt</div>
      ${projects.map(p => `
        <button type="button" class="project-menu-item${p.id === current.id ? ' is-current' : ''}" role="menuitemradio" aria-checked="${p.id === current.id}" data-project-id="${p.id}" title="${escapeHTML(p.name)} · ${escapeHTML(projectMetaText(p))}">
          ${projectAvatarHTML(p, p.avatar, 'project-menu-avatar')}
          <span class="project-menu-name">${escapeHTML(p.name)}</span>
          ${p.id === current.id ? '<i data-lucide="check" class="project-menu-check"></i>' : ''}
        </button>`).join('')}
      <button type="button" class="project-menu-item is-accent" onclick="toggleProjectMenu(false); openCreateProjectModal()">
        <i data-lucide="plus" class="project-menu-glyph"></i><span class="project-menu-name">Nytt projekt</span>
      </button>
    </div>`;
  updateInviteCard(current);
  // Nyss skapat projekt: visa koden direkt så att man kan bjuda in
  let openInvite = false;
  try { openInvite = sessionStorage.getItem('lossi-open-invite') === '1'; sessionStorage.removeItem('lossi-open-invite'); } catch (e) {}
  if (openInvite) openInviteModal();

  wrap.querySelectorAll('[data-project-id]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.projectId;
    toggleProjectMenu(false);
    if (id === current.id) return;
    LossiData.setCurrentProject(id);
    if (onProjectChange) {
      const project = projects.find(p => p.id === id);
      renderProjectSwitcher(onProjectChange);
      renderAsidePlans();
      if (typeof renderAsideEvents === 'function') renderAsideEvents();
      onProjectChange(project);
    } else {
      window.location.href = 'index.html';
    }
  }));
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [wrap] });
  rememberAsidePart('project', wrap.querySelector('.aside-project-btn')?.outerHTML || '');
}

// ── Notiser (klockan i topbaren, supabase/notifications.sql) ──
// Hämtas när sidan laddas, när fliken får fokus och varje minut. Öppnar man
// listan markeras de olästa som lästa (de syns som nya tills listan stängs).
let notifications = [];
let notifTimer = null;
let notifError = false;
let notifShownUnread = new Set(); // olästa när listan öppnades: visas som nya tills den stängs

function startNotifications() {
  loadNotifications();
  clearInterval(notifTimer);
  notifTimer = setInterval(() => { if (!document.hidden) loadNotifications(); }, 60000);
  window.addEventListener('focus', () => loadNotifications());
}

async function loadNotifications() {
  try {
    notifications = await LossiData.listNotifications();
    notifError = false;
  } catch (e) {
    console.warn('Kunde inte hämta notiser:', e); // t.ex. innan notifications.sql körts
    notifError = true;
    if (document.getElementById('notifPanel')?.classList.contains('open')) renderNotifications();
    return;
  }
  const unread = notifications.filter(n => !n.read).length;
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.hidden = !unread;
  document.getElementById('notifBtn').setAttribute('aria-label', unread ? `Notiser, ${unread} nya` : 'Notiser');
  if (document.getElementById('notifPanel').classList.contains('open')) renderNotifications();
}

function notifTime(iso) {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'nyss';
  if (mins < 60) return `för ${mins} min sedan`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `för ${hours} ${hours === 1 ? 'timme' : 'timmar'} sedan`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'i går';
  if (days < 7) return `för ${days} dagar sedan`;
  return then.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

const NOTIF_ICONS = { project_invite: 'user-plus', edit_request: 'pencil', editor_added: 'badge-check', member_joined: 'users' };

function notificationHTML(n) {
  const who = `<strong>${escapeHTML(n.actorName || 'Någon')}</strong>`;
  const project = `<strong>${escapeHTML(n.projectName || 'ett projekt')}</strong>`;
  const plan = `<strong>${escapeHTML(n.planTitle || 'ett upplägg')}</strong>`;
  const text = {
    project_invite: `${who} har bjudit in dig till ${project}.`,
    edit_request: `${who} vill redigera ${plan}.`,
    editor_added: `${who} har gjort dig till medskapare på ${plan}.`,
    member_joined: `${who} har gått med i ${project}.`,
  }[n.kind] || '';
  let actions = '';
  if (n.kind === 'project_invite') {
    actions = n.pending
      ? `<div class="notif-actions">
           <button type="button" class="btn btn-outline notif-action" onclick="answerNotificationInvite('${n.inviteId}', false)">Avböj</button>
           <button type="button" class="btn btn-solid notif-action" onclick="answerNotificationInvite('${n.inviteId}', true)">Gå med</button>
         </div>`
      : '<div class="notif-done">Besvarad</div>';
  } else if (n.planId && (n.kind === 'edit_request' || n.kind === 'editor_added')) {
    actions = `<a class="notif-link" href="upplag.html?id=${n.planId}">Öppna upplägget</a>`;
  }
  return `
    <div class="notif-item${n.read && !notifShownUnread.has(n.id) ? '' : ' is-unread'}">
      <span class="notif-icon"><i data-lucide="${NOTIF_ICONS[n.kind] || 'bell'}"></i></span>
      <div class="notif-body">
        <div class="notif-text">${text}</div>
        <div class="notif-time">${escapeHTML(notifTime(n.createdAt))}</div>
        ${actions}
      </div>
    </div>`;
}

function renderNotifications() {
  const list = document.getElementById('notifList');
  list.innerHTML = notifications.length
    ? notifications.map(notificationHTML).join('')
    : notifError
      ? '<div class="notif-empty"><i data-lucide="cloud-off"></i><span>Kunde inte hämta notiser. Försök igen om en stund.</span></div>'
      : '<div class="notif-empty"><i data-lucide="bell-off"></i><span>Inga notiser än</span></div>';
  lucide.createIcons({ nodes: [list] });
}

function toggleNotifications(open) {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const show = open === undefined ? !panel.classList.contains('open') : open;
  if (show === panel.classList.contains('open')) return;
  panel.classList.toggle('open', show);
  document.getElementById('notifBtn').setAttribute('aria-expanded', String(show));
  if (show) {
    const unread = notifications.filter(n => !n.read);
    notifShownUnread = new Set(unread.map(n => n.id));
    renderNotifications();
    if (unread.length) {
      document.getElementById('notifBadge').hidden = true;
      LossiData.markNotificationsRead(unread.map(n => n.id))
        .catch(e => console.warn('Kunde inte markera notiser:', e))
        .finally(() => loadNotifications()); // och hämta det senaste
    } else {
      loadNotifications();
    }
  } else {
    notifShownUnread = new Set();
    notifications.forEach(n => { n.read = true; });
  }
}

async function answerNotificationInvite(inviteId, accept) {
  try {
    await LossiData.answerInvite(inviteId, accept);
    if (accept) {
      window.location.href = 'index.html';
      return;
    }
    await loadNotifications();
    renderNotifications();
  } catch (e) {
    console.warn('Kunde inte svara på inbjudan:', e);
    alert('Kunde inte svara på inbjudan. Försök igen om en stund.');
  }
}

document.addEventListener('click', e => {
  // Ett klick på något som just ritats om (t.ex. en knapp i listan) ska inte stänga den
  if (!e.target.isConnected) return;
  if (!e.target.closest('#notifWrap')) toggleNotifications(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleNotifications(false);
});

// ── Bjud in (med e-post; supabase/notifications.sql) ──
// Projektens koder är borttagna (supabase/access-codes.sql): kollegor bjuds
// in med sin e-postadress, och den som saknar konto skapar ett med samma adress.

// Kortet längst ner i sidopanelen: bjud in till valt projekt, eller gå med i ett
function updateInviteCard(project) {
  const title = document.getElementById('asideInviteTitle');
  const sub = document.getElementById('asideInviteSub');
  if (!title || !sub) return;
  title.textContent = 'Bjud in kollegor';
  sub.textContent = project ? `Bjud in till ${project.name}` : 'Samarbeta med ditt team';
}

async function openInviteOrJoin(e) {
  if (e?.target.closest('.aside-invite-close')) return;
  const project = await LossiData.currentProject().catch(() => null);
  if (project) openInviteModal();
  else toggleProjectMenu(true);
}

function buildInviteModalsHTML() {
  return `
<div class="modal-overlay" id="inviteModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 id="inviteModalTitle">Bjud in kollegor</h3>
      <button class="btn btn-text btn-icon modal-close" onclick="closeInviteModal()"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <form class="invite-field" onsubmit="event.preventDefault(); sendEmailInvite('inviteEmail', 'inviteEmailMessage')">
        <label class="invite-label" for="inviteEmail">Bjud in med e-post</label>
        <div class="invite-email-row">
          <input class="field-input" type="email" id="inviteEmail" placeholder="namn@skola.se" autocomplete="off" />
          <button type="submit" class="btn btn-solid">Bjud in</button>
        </div>
        <p class="invite-email-message" id="inviteEmailMessage" role="status" hidden></p>
      </form>
      <p class="invite-lead">Har kollegan redan ett konto får hen inbjudan i Lossi under klockan. Annars väntar den tills hen skapar ett konto med adressen.</p>
      <div class="invite-field" id="inviteMembersField">
        <span class="invite-label" id="inviteMembersLabel">Medlemmar</span>
        <div class="invite-members" id="inviteMembers"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-solid" onclick="closeInviteModal()">Klar</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="createProjectModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3>Skapa projekt</h3>
      <button class="btn btn-text btn-icon modal-close" onclick="closeCreateProjectModal()"><i data-lucide="x"></i></button>
    </div>
    <form class="modal-body" id="createProjectForm" onsubmit="event.preventDefault(); createProjectFromModal()">
      <p class="invite-lead">Ett projekt samlar upplägg som ni delar, t.ex. för en skola eller ett arbetslag. Du får en inbjudningskod som du kan ge till kollegorna.</p>
      <div class="field-group">
        <label class="field-label" for="createProjectName">Namn</label>
        <div class="field-group-content">
          <input class="field-input" type="text" id="createProjectName" maxlength="60" autocomplete="off" placeholder="T.ex. Norra skolan" oninput="showCreateProjectMessage('')" />
        </div>
      </div>
      <p class="password-message" id="createProjectMessage" role="status" hidden></p>
      <button type="submit" hidden></button>
    </form>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeCreateProjectModal()">Avbryt</button>
      <button class="btn btn-solid" id="createProjectBtn" onclick="createProjectFromModal()">Skapa projekt</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="deleteProjectModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 id="deleteProjectTitle">Ta bort projektet</h3>
      <button class="btn btn-text btn-icon modal-close" onclick="closeDeleteProjectModal()"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <p class="invite-lead" id="deleteProjectText"></p>
      <ul class="delete-project-facts">
        <li>Alla medlemmar förlorar åtkomsten till projektet, och inbjudningskoden slutar fungera.</li>
        <li>Inga upplägg försvinner: varje upplägg flyttas tillbaka till skaparens första projekt (det man fick när kontot skapades).</li>
        <li>Medskapare förlorar sin redigeringsrätt på uppläggen.</li>
      </ul>
      <p class="password-message is-error" id="deleteProjectMessage" role="status" hidden></p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeDeleteProjectModal()">Avbryt</button>
      <button class="btn btn-solid btn-danger" id="deleteProjectBtn" onclick="deleteProjectConfirmed()"><i data-lucide="trash-2"></i>Ta bort projektet</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="projectSettingsModal">
  <div class="modal settings-modal" role="dialog" aria-label="Projektinställningar">
    <nav class="settings-nav" id="projectSettingsNav" aria-label="Projektinställningar"></nav>
    <div class="settings-main">
      <button class="btn btn-text btn-icon modal-close settings-close" onclick="closeProjectSettings()" aria-label="Stäng"><i data-lucide="x"></i></button>
      <div class="project-settings" id="projectSettingsBody"></div>
    </div>
  </div>
</div>`;
}

let inviteProject = null;

async function openInviteModal() {
  let project;
  try {
    project = await LossiData.currentProject();
  } catch (e) {
    alert('Kunde inte hämta projektet. Ladda om sidan och försök igen.');
    return;
  }
  if (!project) return;
  inviteProject = project;
  document.getElementById('inviteModalTitle').textContent = `Bjud in till ${project.name}`;
  const members = project.members;
  document.getElementById('inviteMembersField').hidden = !members.length;
  document.getElementById('inviteMembersLabel').textContent = `Medlemmar (${members.length})`;
  const list = document.getElementById('inviteMembers');
  list.innerHTML = members.map(m => {
    const profile = { displayName: m.displayName, avatar: m.avatar, email: m.email };
    return `<div class="invite-member"><span class="invite-member-avatar">${userAvatarHTML(profile)}</span><span>${escapeHTML(profileName(profile) || 'Okänd')}</span></div>`;
  }).join('');
  document.getElementById('inviteEmail').value = '';
  document.getElementById('inviteEmailMessage').hidden = true;
  document.getElementById('inviteModal').classList.add('open');
  lucide.createIcons({ nodes: [document.getElementById('inviteModal')] });
}

function closeInviteModal() {
  document.getElementById('inviteModal').classList.remove('open');
}

// Bjud in en e-postadress till inviteProject (inbjudningsdialogen och inställningarna)
async function sendEmailInvite(inputId, messageId, onDone) {
  const input = document.getElementById(inputId);
  const msg = document.getElementById(messageId);
  const email = input.value.trim().toLowerCase();
  const show = (text, kind) => { msg.textContent = text; msg.className = 'invite-email-message' + (kind ? ' is-' + kind : ''); msg.hidden = false; };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    show('Skriv en giltig e-postadress, t.ex. namn@skola.se.', 'error');
    input.focus();
    return;
  }
  if (!inviteProject) return;
  const btn = input.form?.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const result = await LossiData.inviteByEmail(inviteProject.id, email);
    // Lossi skickar inga mejl än: för den som saknar konto väntar inbjudan på adressen
    if (result === 'member') show(`${email} är redan med i ${inviteProject.name}.`, 'error');
    else show(`Inbjudan skickad till ${email}.`, 'ok');
    if (result !== 'member') input.value = '';
    onDone?.();
  } catch (e) {
    console.warn('Kunde inte bjuda in:', e);
    show('Kunde inte skicka inbjudan. Försök igen om en stund.', 'error');
  }
  if (btn) btn.disabled = false;
}

// ── Projektinställningar ──
// En dialog med vänstermeny (som Notions inställningar), så att fler delar
// kan läggas till över tid. Varje del i PROJECT_SETTINGS_TABS ritar sitt
// innehåll till höger:
//   Allmänt    – avatar + namn (ägaren ändrar), Ta bort / Lämna projektet
//   Medlemmar  – medlemmar (ägaren kan ta bort), bjud in (e-post, kod, länk)
//   Klasser    – projektets klasser (supabase/project-classes.sql): alla
//                medlemmar lägger till och tar bort
let settingsProject = null;
let settingsUser = null;
let settingsAvatar = null;
let settingsTab = 'general';

const PROJECT_SETTINGS_TABS = [
  { id: 'general', label: 'Allmänt', icon: 'settings', title: 'Allmänt', lead: 'Projektets namn och avatar, och vad som händer med projektet.' },
  { id: 'members', label: 'Medlemmar', icon: 'users', title: 'Medlemmar', lead: 'Vilka som är med i projektet och hur du bjuder in fler.' },
  { id: 'classes', label: 'Klasser', icon: 'graduation-cap', title: 'Klasser', lead: 'Klasserna som alla i projektet väljer bland under Detaljer › Klass.' },
];

function renderSettingsNav() {
  const p = settingsProject;
  const nav = document.getElementById('projectSettingsNav');
  nav.innerHTML = `
    <div class="settings-nav-project">
      ${projectAvatarHTML(p, p.avatar, 'settings-nav-avatar')}
      <span class="settings-nav-name">${escapeHTML(p.name)}</span>
    </div>
    <div class="settings-nav-label">Projekt</div>
    ${PROJECT_SETTINGS_TABS.map(t => `
      <button type="button" class="settings-nav-item${t.id === settingsTab ? ' is-active' : ''}" onclick="showProjectSettingsTab('${t.id}')"${t.id === settingsTab ? ' aria-current="page"' : ''}>
        <i data-lucide="${t.icon}"></i><span>${t.label}</span>
      </button>`).join('')}`;
  lucide.createIcons({ nodes: [nav] });
}

function showProjectSettingsTab(id) {
  settingsTab = id;
  renderProjectSettings();
  document.querySelector('#projectSettingsModal .settings-main').scrollTop = 0;
}

async function openProjectSettings(tab = 'general') {
  settingsTab = tab;
  try {
    [settingsProject, settingsUser] = await Promise.all([LossiData.currentProject(), LossiAuth.getUser()]);
  } catch (e) {
    alert('Kunde inte hämta projektet. Ladda om sidan och försök igen.');
    return;
  }
  if (!settingsProject) return;
  settingsAvatar = settingsProject.avatar;
  inviteProject = settingsProject;
  renderProjectSettings();
  document.getElementById('projectSettingsModal').classList.add('open');
}

function closeProjectSettings() {
  document.getElementById('projectSettingsModal').classList.remove('open');
}

// Obesvarade inbjudningar via e-post (den som bjöd in eller ägaren kan ta tillbaka)
async function loadSettingsInvites() {
  const box = document.getElementById('settingsPendingInvites');
  if (!box || !settingsProject) return;
  let invites = [];
  try {
    invites = await LossiData.listProjectInvites(settingsProject.id);
  } catch (e) {
    box.innerHTML = '';
    return;
  }
  const owner = isProjectOwner(settingsProject, settingsUser);
  box.innerHTML = invites.map(i => `
    <div class="pending-invite">
      <i data-lucide="mail" class="project-menu-glyph"></i>
      <span class="pending-invite-email">${escapeHTML(i.email)}</span>
      <span class="pending-invite-status">Väntar på svar</span>
      ${owner || i.invitedBy === settingsUser?.id ? `<button type="button" class="btn btn-text btn-danger btn-xs" onclick="cancelSettingsInvite('${i.id}')">Ta tillbaka</button>` : ''}
    </div>`).join('');
  lucide.createIcons({ nodes: [box] });
}

async function cancelSettingsInvite(id) {
  try {
    await LossiData.cancelInvite(id);
    loadSettingsInvites();
  } catch (e) {
    console.warn('Kunde inte ta tillbaka inbjudan:', e);
    alert('Kunde inte ta tillbaka inbjudan. Försök igen om en stund.');
  }
}

function renderProjectSettings() {
  const p = settingsProject;
  const owner = isProjectOwner(p, settingsUser);
  const members = p.members.slice().sort((a, b) => (b.role === 'owner') - (a.role === 'owner'));
  const tab = PROJECT_SETTINGS_TABS.find(t => t.id === settingsTab) || PROJECT_SETTINGS_TABS[0];
  renderSettingsNav();
  const body = document.getElementById('projectSettingsBody');
  const sections = {
    general: () => `
    <section class="settings-section">
      <h4 class="settings-heading">Namn och avatar</h4>
      <div class="settings-general">
        <span class="settings-avatar-preview" id="settingsAvatarPreview">${projectAvatarHTML(p, settingsAvatar)}</span>
        <div class="settings-name">
          <label class="invite-label" for="settingsName">Namn</label>
          <input class="field-input" type="text" id="settingsName" maxlength="60" autocomplete="off" value="${escapeHTML(p.name)}" ${owner ? '' : 'disabled'} oninput="onSettingsNameInput()" />
        </div>
      </div>
      ${owner ? `
      <div class="settings-avatar-grid" role="radiogroup" aria-label="Projektets avatar">
        ${USER_AVATARS.map(a => `
          <button type="button" class="settings-avatar-option${(settingsAvatar || 'initials') === a.id ? ' is-selected' : ''}" role="radio" aria-checked="${(settingsAvatar || 'initials') === a.id}" title="${escapeHTML(a.id === 'initials' ? 'Bokstav' : a.label)}" onclick="pickSettingsAvatar('${a.id}')">
            ${projectAvatarHTML(p, a.id === 'initials' ? null : a.id)}
          </button>`).join('')}
      </div>
      <div class="settings-actions">
        <p class="password-message" id="settingsMessage" role="status" hidden></p>
        <button type="button" class="btn btn-solid" id="settingsSaveBtn" onclick="saveProjectSettings()" disabled>Spara</button>
      </div>` : '<p class="settings-note">Bara projektets ägare kan ändra namn och avatar.</p>'}
    </section>

    <section class="settings-section settings-danger">
      ${owner
        ? (p.personal
          ? '<p class="settings-note">Det här är ditt första projekt. Det kan inte tas bort, eftersom nya upplägg hamnar här och upplägg från borttagna projekt flyttas hit.</p>'
          : `<div class="settings-danger-row"><span><strong>Ta bort projektet</strong><span class="settings-note">Uppläggen flyttas tillbaka till respektive skapare.</span></span><button type="button" class="btn btn-outline btn-danger" onclick="closeProjectSettings(); openDeleteProjectModal()"><i data-lucide="trash-2"></i>Ta bort</button></div>`)
        : `<div class="settings-danger-row"><span><strong>Lämna projektet</strong><span class="settings-note">Dina upplägg här flyttas till ditt första projekt.</span></span><button type="button" class="btn btn-outline btn-danger" onclick="leaveProjectFromSettings()"><i data-lucide="log-out"></i>Lämna</button></div>`}
    </section>`,
    members: () => `
    <section class="settings-section">
      <h4 class="settings-heading">Medlemmar <span class="settings-count">${members.length}</span></h4>
      <div class="settings-members">
        ${members.map(m => {
          const profile = { displayName: m.displayName, avatar: m.avatar, email: m.email };
          const me = m.userId === settingsUser?.id;
          return `
          <div class="settings-member">
            <span class="settings-member-avatar">${userAvatarHTML(profile)}</span>
            <span class="settings-member-text">
              <span class="settings-member-name">${escapeHTML(profileName(profile) || 'Okänd')}${me ? ' <span class="settings-you">(du)</span>' : ''}</span>
              <span class="settings-member-email">${escapeHTML(m.email || '')}</span>
            </span>
            <span class="settings-role">${m.role === 'owner' ? 'Ägare' : 'Medlem'}</span>
            ${owner && m.role !== 'owner' ? `<button type="button" class="btn btn-text btn-danger btn-xs" onclick="removeMemberFromSettings('${m.userId}')">Ta bort</button>` : ''}
          </div>`;
        }).join('') || '<p class="settings-note">Inga medlemmar att visa.</p>'}
      </div>
    </section>

    <section class="settings-section">
      <h4 class="settings-heading">Bjud in</h4>
      <form class="invite-field" onsubmit="event.preventDefault(); sendEmailInvite('settingsInviteEmail', 'settingsInviteMessage', loadSettingsInvites)">
        <div class="invite-email-row">
          <input class="field-input" type="email" id="settingsInviteEmail" placeholder="namn@skola.se" autocomplete="off" aria-label="E-postadress att bjuda in" />
          <button type="submit" class="btn btn-solid">Bjud in</button>
        </div>
        <p class="invite-email-message" id="settingsInviteMessage" role="status" hidden></p>
      </form>
      <div class="pending-invites" id="settingsPendingInvites"></div>
      <p class="settings-note">Har kollegan inget konto än väntar inbjudan tills hen skapar ett konto med adressen.</p>
    </section>

`,
    classes: () => projectClassesHTML(),
  };
  body.innerHTML = `
    <header class="settings-page-head">
      <h2 class="settings-title">${tab.title}</h2>
      <p class="settings-lead">${tab.lead}</p>
    </header>
    ${sections[tab.id]()}`;
  lucide.createIcons({ nodes: [body] });
  if (tab.id === 'members') loadSettingsInvites();
  if (tab.id === 'classes') loadSettingsClassUsage();
}

// ── Klasser i projektinställningarna ──
// Antal upplägg per klass hämtas när delen öppnas (alla medlemmars upplägg i projektet).
let settingsClassUsage = new Map(); // klass (gemener) → antal upplägg

function projectClassesHTML() {
  const p = settingsProject;
  if (!Array.isArray(p.classes)) {
    return '<section class="settings-section"><p class="settings-note">Klasser i projektet är inte påslaget än.</p></section>';
  }
  const classes = mergeChoices(p.classes);
  return `
    <section class="settings-section">
      <h4 class="settings-heading">Lägg till klass</h4>
      <form class="invite-email-row" onsubmit="event.preventDefault(); addClassFromSettings()">
        <input class="field-input" type="text" id="settingsClassName" maxlength="${CHOICE_MAX_LENGTH}" placeholder="T.ex. 7B" autocomplete="off" aria-label="Klassens namn" />
        <button type="submit" class="btn btn-solid">Lägg till</button>
      </form>
      <p class="invite-email-message" id="settingsClassMessage" role="status" hidden></p>
    </section>
    <section class="settings-section">
      <h4 class="settings-heading">Projektets klasser <span class="settings-count">${classes.length}</span></h4>
      <div class="settings-classes" id="settingsClassList">
        ${classes.map(c => `
          <div class="settings-class">
            <span class="class-tag">${escapeHTML(c)}</span>
            <span class="settings-class-usage" data-class-usage="${escapeHTML(c.toLowerCase())}"></span>
            <button type="button" class="btn btn-text btn-danger btn-xs" onclick="removeClassFromSettings(this.dataset.name)" data-name="${escapeHTML(c)}"><i data-lucide="trash-2"></i>Ta bort</button>
          </div>`).join('') || '<p class="settings-note">Projektet har inga klasser än. Lägg till en ovan, eller skriv in en ny under Detaljer › Klass på ett upplägg.</p>'}
      </div>
      <p class="settings-note">En klass som tas bort går inte längre att välja, men upplägg som redan har den behåller den.</p>
    </section>`;
}

async function loadSettingsClassUsage() {
  try {
    const plans = await LossiData.listPlans({ projectId: settingsProject.id });
    settingsClassUsage = new Map();
    plans.forEach(pl => {
      const k = (pl.state?.klass || '').toLowerCase();
      if (k) settingsClassUsage.set(k, (settingsClassUsage.get(k) || 0) + 1);
    });
  } catch (e) {
    return;
  }
  document.querySelectorAll('[data-class-usage]').forEach(el => {
    const n = settingsClassUsage.get(el.dataset.classUsage) || 0;
    el.textContent = n ? (n === 1 ? '1 upplägg' : `${n} upplägg`) : 'Används inte';
  });
}

function showSettingsClassMessage(text, isError) {
  const msg = document.getElementById('settingsClassMessage');
  if (!msg) return;
  msg.textContent = text;
  msg.classList.toggle('is-error', !!isError);
  msg.hidden = !text;
}

async function addClassFromSettings() {
  const input = document.getElementById('settingsClassName');
  const name = normalizeChoice(input.value);
  if (!name) return showSettingsClassMessage('Skriv klassens namn.', true);
  if ((settingsProject.classes || []).some(c => sameChoice(c, name))) return showSettingsClassMessage(`${name} finns redan i projektet.`, true);
  try {
    settingsProject.classes = await LossiData.addProjectClass(settingsProject.id, name);
    renderProjectSettings();
    showSettingsClassMessage(`${name} är tillagd.`);
    document.getElementById('settingsClassName').focus();
  } catch (e) {
    console.warn('Kunde inte lägga till klassen:', e);
    showSettingsClassMessage('Kunde inte lägga till klassen. Försök igen om en stund.', true);
  }
}

async function removeClassFromSettings(name) {
  const n = settingsClassUsage.get(name.toLowerCase()) || 0;
  const usage = n ? ` ${n === 1 ? 'Ett upplägg' : n + ' upplägg'} har klassen och behåller den.` : '';
  if (!confirm(`Ta bort ${name} från ${settingsProject.name}? Ingen i projektet kan välja klassen längre.${usage}`)) return;
  try {
    settingsProject.classes = await LossiData.removeProjectClass(settingsProject.id, name);
    renderProjectSettings();
  } catch (e) {
    console.warn('Kunde inte ta bort klassen:', e);
    alert('Kunde inte ta bort klassen. Försök igen om en stund.');
  }
}

function settingsChanged() {
  const name = document.getElementById('settingsName')?.value.trim().replace(/\s+/g, ' ');
  return !!name && (name !== settingsProject.name || (settingsAvatar || null) !== (settingsProject.avatar || null));
}

function onSettingsNameInput() {
  const btn = document.getElementById('settingsSaveBtn');
  if (btn) btn.disabled = !settingsChanged();
  const msg = document.getElementById('settingsMessage');
  if (msg) msg.hidden = true;
  // Bokstaven i förhandsvisningen följer namnet
  document.getElementById('settingsAvatarPreview').innerHTML = projectAvatarHTML({ ...settingsProject, name: document.getElementById('settingsName').value }, settingsAvatar);
  lucide.createIcons({ nodes: [document.getElementById('settingsAvatarPreview')] });
}

function pickSettingsAvatar(id) {
  settingsAvatar = id === 'initials' ? null : id;
  document.querySelectorAll('.settings-avatar-option').forEach(b => {
    const on = b.getAttribute('onclick').includes(`'${id}'`);
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-checked', String(on));
  });
  onSettingsNameInput();
}

async function saveProjectSettings() {
  const p = settingsProject;
  const name = document.getElementById('settingsName').value.trim().replace(/\s+/g, ' ');
  const msg = document.getElementById('settingsMessage');
  if (!name) {
    msg.textContent = 'Ge projektet ett namn.';
    msg.className = 'password-message is-error';
    msg.hidden = false;
    return;
  }
  const btn = document.getElementById('settingsSaveBtn');
  btn.disabled = true;
  try {
    if (name !== p.name) await LossiData.renameProject(p.id, name);
    if ((settingsAvatar || null) !== (p.avatar || null)) await LossiData.setProjectAvatar(p.id, settingsAvatar);
    settingsProject = await LossiData.currentProject();
    renderProjectSwitcher(projectSwitcherOnChange);
    renderProjectSettings();
    const saved = document.getElementById('settingsMessage');
    saved.textContent = 'Sparat.';
    saved.className = 'password-message';
    saved.hidden = false;
  } catch (e) {
    console.warn('Kunde inte spara projektet:', e);
    msg.textContent = 'Kunde inte spara. Försök igen om en stund.';
    msg.className = 'password-message is-error';
    msg.hidden = false;
    btn.disabled = false;
  }
}

async function removeMemberFromSettings(userId) {
  const m = settingsProject.members.find(x => x.userId === userId);
  const name = profileName({ displayName: m?.displayName || '', email: m?.email || '' }) || 'medlemmen';
  if (!confirm(`Ta bort ${name} från ${settingsProject.name}? ${name} förlorar åtkomsten, och hens upplägg här flyttas till hens första projekt.`)) return;
  try {
    await LossiData.removeProjectMember(settingsProject.id, userId);
    settingsProject = await LossiData.currentProject();
    renderProjectSettings();
    renderProjectSwitcher(projectSwitcherOnChange);
  } catch (e) {
    console.warn('Kunde inte ta bort medlemmen:', e);
    alert('Kunde inte ta bort medlemmen. Försök igen om en stund.');
  }
}

async function leaveProjectFromSettings() {
  if (!confirm(`Lämna ${settingsProject.name}? Dina upplägg här flyttas till ditt första projekt, och du behöver en ny kod för att gå med igen.`)) return;
  try {
    await LossiData.leaveProject(settingsProject.id);
    window.location.href = 'index.html';
  } catch (e) {
    console.warn('Kunde inte lämna projektet:', e);
    alert('Kunde inte lämna projektet. Försök igen om en stund.');
  }
}

let projectToDelete = null;

async function openDeleteProjectModal() {
  const project = await LossiData.currentProject().catch(() => null);
  if (!project || project.personal) return;
  projectToDelete = project;
  const others = project.members.length - 1;
  document.getElementById('deleteProjectTitle').textContent = `Ta bort ${project.name}?`;
  document.getElementById('deleteProjectText').textContent = others > 0
    ? `Projektet har ${others} ${others === 1 ? 'medlem' : 'medlemmar'} förutom dig. Det går inte att ångra.`
    : 'Det går inte att ångra.';
  document.getElementById('deleteProjectMessage').hidden = true;
  document.getElementById('deleteProjectBtn').disabled = false;
  document.getElementById('deleteProjectModal').classList.add('open');
  lucide.createIcons({ nodes: [document.getElementById('deleteProjectModal')] });
}

function closeDeleteProjectModal() {
  document.getElementById('deleteProjectModal').classList.remove('open');
}

async function deleteProjectConfirmed() {
  if (!projectToDelete) return;
  const btn = document.getElementById('deleteProjectBtn');
  btn.disabled = true;
  try {
    await LossiData.deleteProject(projectToDelete.id);
    window.location.href = 'index.html';
  } catch (e) {
    console.warn('Kunde inte ta bort projektet:', e);
    const msg = document.getElementById('deleteProjectMessage');
    msg.textContent = 'Kunde inte ta bort projektet. Försök igen om en stund.';
    msg.hidden = false;
    btn.disabled = false;
  }
}

function openCreateProjectModal() {
  document.getElementById('createProjectForm').reset();
  showCreateProjectMessage('');
  document.getElementById('createProjectBtn').disabled = false;
  document.getElementById('createProjectModal').classList.add('open');
  document.getElementById('createProjectName').focus();
}

function closeCreateProjectModal() {
  document.getElementById('createProjectModal').classList.remove('open');
}

function showCreateProjectMessage(text) {
  const el = document.getElementById('createProjectMessage');
  el.textContent = text;
  el.classList.toggle('is-error', !!text);
  el.hidden = !text;
}

async function createProjectFromModal() {
  const input = document.getElementById('createProjectName');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) {
    showCreateProjectMessage('Ge projektet ett namn.');
    input.focus();
    return;
  }
  const btn = document.getElementById('createProjectBtn');
  btn.disabled = true;
  try {
    await LossiData.createProject(name);
    try { sessionStorage.setItem('lossi-open-invite', '1'); } catch (e) {}
    window.location.href = 'index.html';
  } catch (e) {
    console.warn('Kunde inte skapa projektet:', e);
    showCreateProjectMessage('Kunde inte skapa projektet. Försök igen om en stund.');
    btn.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['inviteModal', 'createProjectModal', 'deleteProjectModal', 'projectSettingsModal'].forEach(id => document.getElementById(id)?.classList.remove('open'));
});

function toggleProjectMenu(open) {
  const menu = document.getElementById('projectMenu');
  if (!menu) return;
  const show = open === undefined ? !menu.classList.contains('open') : open;
  menu.classList.toggle('open', show);
  menu.previousElementSibling?.setAttribute('aria-expanded', String(show));
}

document.addEventListener('click', e => {
  if (!e.target.closest('#projectSwitcher')) toggleProjectMenu(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleProjectMenu(false);
});

// Obesvarade förfrågningar om redigeringsrätt per eget upplägg: Map planId → antal.
// Sidopanelen och översikten frågar samtidigt när sidan laddas; då görs hämtningen en gång.
let editRequestsRequest = null;
function editRequestCounts() {
  if (!editRequestsRequest) {
    editRequestsRequest = (async () => {
      const counts = new Map();
      try {
        (await LossiData.listMyEditRequests()).forEach(r => counts.set(r.planId, (counts.get(r.planId) || 0) + 1));
      } catch (e) {} // t.ex. innan steg 4 i projects.sql körts
      return counts;
    })();
    editRequestsRequest.finally(() => { editRequestsRequest = null; });
  }
  return editRequestsRequest;
}

function editRequestBadgeHTML(n) {
  return n ? `<span class="request-badge" title="${n} ${n === 1 ? 'kollega vill' : 'kollegor vill'} redigera">${n}</span>` : '';
}

// Mjuka sidbyten (@view-transition i styles.css): webbläsaren hoppar ibland
// över övergången (t.ex. om fönstret ändras) och rapporterar det som ett fel.
// Det är ofarligt, så det fångas här.
['pageswap', 'pagereveal'].forEach(type => window.addEventListener(type, e => {
  const t = e.viewTransition;
  if (t) [t.ready, t.finished, t.updateCallbackDone].forEach(p => p?.catch(() => {}));
}));

// ── Sidopanelen direkt vid sidbyte ──
// Varje sida är en egen HTML-sida, så sidopanelen byggs om vid varje klick.
// För att den inte ska blinka tom sparas det senast ritade innehållet
// (projektväljaren, Kalender, Upplägg) och scrollläget i fliken och visas
// direkt; den riktiga datan ritar sedan om när den hämtats. Sparat per
// användare och valt projekt, så att man aldrig ser fel innehåll.
const ASIDE_CACHE_KEY = 'lossi-aside-cache';

function asideCacheOwner() {
  let project = '';
  try { project = localStorage.getItem('lossi-project') || ''; } catch (e) {}
  return (LossiAuth.storedUserId() || '') + ':' + project;
}

function readAsideCache() {
  try {
    const cache = JSON.parse(sessionStorage.getItem(ASIDE_CACHE_KEY) || 'null');
    return cache && cache.owner === asideCacheOwner() ? cache : null;
  } catch (e) {
    return null;
  }
}

function rememberAsidePart(part, html) {
  try {
    const cache = readAsideCache() || { owner: asideCacheOwner() };
    cache[part] = html;
    sessionStorage.setItem(ASIDE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function forgetAsideCache() {
  try { sessionStorage.removeItem(ASIDE_CACHE_KEY); } catch (e) {}
}

function paintAsideFromCache(aside, currentPlanId) {
  const cache = readAsideCache();
  if (!cache) return;
  const fill = (selector, html) => {
    const el = aside.querySelector(selector);
    if (el && html != null) el.innerHTML = html;
  };
  fill('#projectSwitcher', cache.project);
  fill('.aside-events-list', cache.events);
  fill('.aside-plan-list', cache.plans);
  aside.querySelectorAll('[data-aside-plan]').forEach(a => {
    a.classList.toggle('active', a.dataset.asidePlan === String(currentPlanId));
  });
  const scroll = aside.querySelector('.aside-scroll');
  if (scroll && cache.scroll) scroll.scrollTop = cache.scroll;
}

// Scrollläget följer med till nästa sida
window.addEventListener('pagehide', () => {
  const scroll = document.querySelector('.app-aside .aside-scroll');
  if (scroll) rememberAsidePart('scroll', scroll.scrollTop);
});

// Upplägg-listan i asiden fylls i när datan hämtats (renderAppShell väntar inte):
// den inloggades egna upplägg i valt projekt
async function renderAsidePlans(currentPlanId) {
  const project = await LossiData.currentProject().catch(() => null);
  const [plans, requests] = await Promise.all([getPlanSummaries({ projectId: project?.id, mine: true }), editRequestCounts()]);
  const visiblePlans = plans.slice(0, ASIDE_PLAN_LIMIT);
  // Det öppna upplägget ska alltid synas i listan, även om det är äldre
  if (currentPlanId && !visiblePlans.some(p => p.id === String(currentPlanId))) {
    const current = plans.find(p => p.id === String(currentPlanId));
    if (current) visiblePlans[visiblePlans.length - 1] = current;
  }

  const list = document.querySelector('.aside-plan-list');
  if (!list) return;
  if (!visiblePlans.length) {
    list.innerHTML = '<div class="aside-item is-placeholder aside-empty">Inga egna upplägg här än</div>';
    rememberAsidePart('plans', list.innerHTML);
    return;
  }
  list.innerHTML = visiblePlans.map(p => `
    <a href="upplag.html?id=${p.id}" class="aside-item${p.id === String(currentPlanId) ? ' active' : ''}" data-aside-plan="${p.id}" title="${escapeHTML(p.title)}">
      <span class="aside-plan-icon">${planAvatarImgHTML(p.avatar)}</span>
      <span class="aside-item-text">${escapeHTML(p.title)}</span>
      ${editRequestBadgeHTML(requests.get(p.id))}
    </a>`).join('');
  rememberAsidePart('plans', list.innerHTML);
}

// Uppdatera ett uppläggs titel/bild i asiden utan att bygga om allt
function updateAsidePlan(id, { title, avatar } = {}) {
  const item = document.querySelector(`[data-aside-plan="${id}"]`);
  if (!item) return;
  if (title !== undefined) {
    item.querySelector('.aside-item-text').textContent = title || 'Namnlöst upplägg';
    item.title = title;
  }
  if (avatar) item.querySelector('.aside-plan-icon').innerHTML = planAvatarImgHTML(avatar);
  rememberAsidePart('plans', item.closest('.aside-plan-list').innerHTML);
}

// ── Den inloggade läraren: namn och avatar ──
// Element med data-user-avatar / data-user-name / data-user-title fylls med
// lärarens profil (från LossiAuth.profileOf). Listor som byggs senare anropar
// fillUserProfile() efter att de ritats.
const USER_AVATARS = [
  { id: 'initials', label: 'Initialer',  icon: null,       a: '#FF8A3D', b: '#E24B4A' },
  { id: 'cat',      label: 'Katt',       icon: 'cat',      a: '#7C4FE0', b: '#A78BFA' },
  { id: 'bird',     label: 'Fågel',      icon: 'bird',     a: '#2F6FED', b: '#4FACFE' },
  { id: 'rabbit',   label: 'Kanin',      icon: 'rabbit',   a: '#E2508F', b: '#F5576C' },
  { id: 'fish',     label: 'Fisk',       icon: 'fish',     a: '#0E8F86', b: '#2BC48A' },
  { id: 'squirrel', label: 'Ekorre',     icon: 'squirrel', a: '#E8650C', b: '#F5A524' },
  { id: 'turtle',   label: 'Sköldpadda', icon: 'turtle',   a: '#15803D', b: '#4ADE80' },
  { id: 'snail',    label: 'Snigel',     icon: 'snail',    a: '#A855F7', b: '#12C2E9' },
  { id: 'rocket',   label: 'Raket',      icon: 'rocket',   a: '#4F46E5', b: '#764BA2' },
  { id: 'coffee',   label: 'Kaffe',      icon: 'coffee',   a: '#7C4A2D', b: '#B7794A' },
  { id: 'palette',  label: 'Palett',     icon: 'palette',  a: '#DB2777', b: '#F59E0B' },
  { id: 'sun',      label: 'Sol',        icon: 'sun',      a: '#EA580C', b: '#FACC15' },
];

let currentUser = null;

function currentProfile() {
  return currentUser ? LossiAuth.profileOf(currentUser) : { displayName: '', avatar: null, email: '' };
}

function profileName(profile) {
  return profile.displayName || profile.email.split('@')[0] || '';
}

function profileInitials(profile) {
  const source = profile.displayName || profile.email.split('@')[0] || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

function userAvatarHTML(profile, avatarId) {
  const avatar = USER_AVATARS.find(a => a.id === (avatarId || profile.avatar)) || USER_AVATARS[0];
  const inner = avatar.icon
    ? `<i data-lucide="${avatar.icon}"></i>`
    : `<span class="user-face-initials">${escapeHTML(profileInitials(profile))}</span>`;
  return `<span class="user-face" style="--face-a:${avatar.a};--face-b:${avatar.b}">${inner}</span>`;
}

function fillUserProfile(root = document) {
  const profile = currentProfile();
  const name = profileName(profile);
  const avatars = root.querySelectorAll('[data-user-avatar]');
  avatars.forEach(el => { el.innerHTML = userAvatarHTML(profile); });
  root.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = name; });
  root.querySelectorAll('[data-user-title]').forEach(el => { el.title = name; });
  if (avatars.length && typeof lucide !== 'undefined') lucide.createIcons({ nodes: [...avatars] });
}

// Anropas av sidorna när LossiAuth.requireUser() har en inloggad lärare
function applyUserProfile(user) {
  currentUser = user;
  savePendingChoice();
  const account = document.getElementById('userMenuAccount');
  if (account) {
    document.getElementById('userMenuEmail').textContent = user.email || '';
    account.hidden = false;
  }
  fillUserProfile();
  // Feedbacksidan syns bara för administratörer (app_metadata sätts i databasen)
  const adminLink = document.getElementById('adminFeedbackLink');
  if (adminLink) adminLink.hidden = user.app_metadata?.role !== 'admin';
  // Första gången utan namn: be läraren fylla i profilen (en gång per webbläsare)
  let prompted = false;
  try { prompted = localStorage.getItem('lossi-profile-prompted') === 'true'; } catch (e) {}
  if (!LossiAuth.profileOf(user).displayName && !prompted) {
    try { localStorage.setItem('lossi-profile-prompted', 'true'); } catch (e) {}
    openProfileModal({ welcome: true });
  }
}

// ── Profil-dialogen ──
function buildProfileModalHTML() {
  return `
<div class="modal-overlay" id="profileModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 id="profileModalTitle">Din profil</h3>
      <button class="btn btn-text btn-icon modal-close" onclick="closeProfileModal()">
        <i data-lucide="x"></i>
      </button>
    </div>
    <form class="modal-body" id="profileForm" onsubmit="event.preventDefault(); saveProfile()">
      <p class="profile-intro" id="profileIntro" hidden>Välkommen till Lossi! Berätta vad du heter och välj en avatar, så känns kontot som ditt.</p>
      <div class="profile-preview">
        <div class="profile-preview-avatar" id="profilePreviewAvatar"></div>
        <div class="profile-preview-text">
          <span class="profile-preview-name" id="profilePreviewName"></span>
          <span class="profile-preview-email" id="profilePreviewEmail"></span>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="profileName">Namn</label>
        <div class="field-group-content">
          <input class="field-input" type="text" id="profileName" maxlength="60" autocomplete="name" placeholder="T.ex. Kristoffer Lind" oninput="renderProfilePreview()" />
        </div>
      </div>
      <div class="field-group">
        <span class="field-label">Avatar</span>
        <div class="field-group-content">
          <div class="profile-avatar-picker" id="profileAvatarPicker" role="radiogroup" aria-label="Avatar"></div>
        </div>
      </div>
      <p class="password-message" id="profileMessage" role="status" hidden></p>
      <button type="submit" hidden></button>
    </form>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeProfileModal()">Avbryt</button>
      <button class="btn btn-solid" id="profileSaveBtn" onclick="saveProfile()">Spara</button>
    </div>
  </div>
</div>`;
}

let profileDraftAvatar = null;

function draftProfile() {
  return { ...currentProfile(), displayName: document.getElementById('profileName').value.trim(), avatar: profileDraftAvatar };
}

function renderProfilePreview() {
  const draft = draftProfile();
  document.getElementById('profilePreviewAvatar').innerHTML = userAvatarHTML(draft);
  document.getElementById('profilePreviewName').textContent = profileName(draft);
  document.getElementById('profilePreviewEmail').textContent = draft.email;
  const picker = document.getElementById('profileAvatarPicker');
  picker.innerHTML = USER_AVATARS.map(a => `
    <button type="button" class="profile-avatar-option${a.id === (draft.avatar || 'initials') ? ' selected' : ''}" role="radio" aria-checked="${a.id === (draft.avatar || 'initials')}" title="${a.label}" aria-label="${a.label}" onclick="pickProfileAvatar('${a.id}')">${userAvatarHTML(draft, a.id)}</button>`).join('');
  lucide.createIcons({ nodes: [picker, document.getElementById('profilePreviewAvatar')] });
}

function pickProfileAvatar(id) {
  profileDraftAvatar = id;
  renderProfilePreview();
}

function openProfileModal({ welcome = false } = {}) {
  if (!currentUser) return;
  document.getElementById('userMenuDropdown')?.classList.remove('open');
  const profile = currentProfile();
  profileDraftAvatar = profile.avatar || 'initials';
  document.getElementById('profileName').value = profile.displayName;
  document.getElementById('profileModalTitle').textContent = welcome ? 'Välkommen!' : 'Din profil';
  document.getElementById('profileIntro').hidden = !welcome;
  document.getElementById('profileMessage').hidden = true;
  document.getElementById('profileSaveBtn').disabled = false;
  renderProfilePreview();
  document.getElementById('profileModal').classList.add('open');
  document.getElementById('profileName').focus();
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.remove('open');
}

async function saveProfile() {
  const btn = document.getElementById('profileSaveBtn');
  const message = document.getElementById('profileMessage');
  btn.disabled = true;
  try {
    const user = await LossiAuth.updateProfile({
      displayName: document.getElementById('profileName').value.trim(),
      avatar: profileDraftAvatar,
    });
    currentUser = user;
    fillUserProfile();
    closeProfileModal();
  } catch (e) {
    console.warn('Kunde inte spara profilen:', e);
    message.textContent = 'Kunde inte spara profilen. Försök igen om en stund.';
    message.classList.add('is-error');
    message.hidden = false;
    btn.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('profileModal')?.classList.contains('open')) closeProfileModal();
});

function dismissInvite() {
  try { localStorage.setItem('lossi-invite-dismissed', 'true'); } catch (e) {}
  document.querySelector('.aside-invite')?.remove();
}

// ── Användarmeny ──
// Visa rundturen (tour.js): på översikten direkt, annars via länken dit
function openTourFromMenu() {
  document.getElementById('userMenuDropdown')?.classList.remove('open');
  if (typeof startLossiTour === 'function') startLossiTour();
  else window.location.href = 'index.html?rundtur';
}

function toggleUserMenu() {
  const dropdown = document.getElementById('userMenuDropdown');
  const badge = document.getElementById('userBadge');
  const isOpen = dropdown.classList.contains('open');
  if (!isOpen) {
    const rect = badge.getBoundingClientRect();
    dropdown.style.top = rect.bottom + 6 + 'px';
    dropdown.style.right = window.innerWidth - rect.right + 'px';
  }
  dropdown.classList.toggle('open');
}

document.addEventListener('click', e => {
  const badge = document.getElementById('userBadge');
  if (badge && !badge.contains(e.target)) {
    document.getElementById('userMenuDropdown')?.classList.remove('open');
  }
});

// ── Skapa upplägg ──
// Samma uppgifter som tidigare låg i "Redigera upplägg". Skapa sparar ett
// nytt, tomt upplägg och skickar läraren dit för att fylla i resten.
function buildCreatePlanModalHTML() {
  return `
<div class="modal-overlay" id="createPlanModal">
  <div class="modal">
    <div class="modal-header">
      <h3>Skapa upplägg</h3>
      <button class="btn btn-text btn-icon modal-close" onclick="closeCreatePlanModal()">
        <i data-lucide="x"></i>
      </button>
    </div>
    <div class="modal-body">
      <!-- Skapa med AI (ai-import.js): läraren tar fram hela upplägget med sin egen AI -->
      <button type="button" class="ai-entry" onclick="openAiPlanModal()">
        <span class="ai-entry-icon"><i data-lucide="sparkles"></i></span>
        <span class="ai-entry-text">
          <span class="ai-entry-title">Skapa med AI</span>
          <span class="ai-entry-sub">Ta fram hela upplägget tillsammans med din egen AI och klistra in resultatet</span>
        </span>
        <i data-lucide="chevron-right" class="ai-entry-chevron"></i>
      </button>
      <div class="field-group">
        <label class="field-label">Uppläggsavatar</label>
        <div class="field-group-content">
          <div class="avatar-picker" id="createPlanAvatarPicker">
            ${buildAvatarPickerHTML()}
          </div>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="createPlanName">Uppläggets namn</label>
        <div class="field-group-content">
          <input class="field-input" type="text" id="createPlanName" placeholder="T.ex. Samhällsekonomi" oninput="this.classList.remove('is-invalid')" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label">Beskrivning</label>
        <div class="field-group-content">
          <div class="editor-wrap">
            <div class="editor-body" contenteditable="true" id="createPlanDescription" data-placeholder="Beskriv upplägget kort"></div>
          </div>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="createPlanSubject">Ämne</label>
        <div class="field-group-content">
          <div class="choice-field">
            <input class="field-input" type="text" id="createPlanSubject" maxlength="${CHOICE_MAX_LENGTH}" autocomplete="off"
              placeholder="Välj eller skriv in ett ämne" role="combobox" aria-controls="createPlanSubjectList" aria-autocomplete="list" />
            <div class="choice-options choice-dropdown" id="createPlanSubjectList" role="listbox" aria-label="Ämnen" hidden></div>
          </div>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="createPlanGrade">Årskurs</label>
        <div class="field-group-content">
          <div class="choice-field">
            <input class="field-input" type="text" id="createPlanGrade" maxlength="${CHOICE_MAX_LENGTH}" autocomplete="off"
              placeholder="Välj eller skriv in en årskurs" role="combobox" aria-controls="createPlanGradeList" aria-autocomplete="list" />
            <div class="choice-options choice-dropdown opens-up" id="createPlanGradeList" role="listbox" aria-label="Årskurser" hidden></div>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeCreatePlanModal()">Avbryt</button>
      <button class="btn btn-solid" onclick="createPlan()">Skapa</button>
    </div>
  </div>
</div>`;
}

// ── Byt lösenord ──
// Testare får ett lösenord av Tobias och kan byta till ett eget här.
const PASSWORD_MIN_LENGTH = 8;

function buildPasswordModalHTML() {
  return `
<div class="modal-overlay" id="passwordModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3>Byt lösenord</h3>
      <button class="btn btn-text btn-icon modal-close" onclick="closePasswordModal()">
        <i data-lucide="x"></i>
      </button>
    </div>
    <form class="modal-body" id="passwordForm" onsubmit="event.preventDefault(); savePassword()">
      <input type="text" name="username" autocomplete="username" hidden />
      <div class="field-group">
        <label class="field-label" for="newPassword">Nytt lösenord</label>
        <div class="field-group-content">
          <input class="field-input" type="password" id="newPassword" autocomplete="new-password" placeholder="Minst ${PASSWORD_MIN_LENGTH} tecken" oninput="clearPasswordError()" />
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="newPasswordRepeat">Upprepa</label>
        <div class="field-group-content">
          <input class="field-input" type="password" id="newPasswordRepeat" autocomplete="new-password" oninput="clearPasswordError()" />
        </div>
      </div>
      <p class="password-message" id="passwordMessage" role="status" hidden></p>
      <button type="submit" hidden></button>
    </form>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closePasswordModal()">Avbryt</button>
      <button class="btn btn-solid" id="passwordSaveBtn" onclick="savePassword()">Spara lösenord</button>
    </div>
  </div>
</div>`;
}

function openPasswordModal() {
  document.getElementById('userMenuDropdown')?.classList.remove('open');
  document.getElementById('passwordForm').reset();
  clearPasswordError();
  document.getElementById('passwordSaveBtn').disabled = false;
  document.getElementById('passwordModal').classList.add('open');
  document.getElementById('newPassword').focus();
}

function closePasswordModal() {
  document.getElementById('passwordModal').classList.remove('open');
}

function showPasswordMessage(text, isError) {
  const el = document.getElementById('passwordMessage');
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
  el.hidden = !text;
}

function clearPasswordError() {
  showPasswordMessage('');
}

async function savePassword() {
  const password = document.getElementById('newPassword').value;
  const repeat = document.getElementById('newPasswordRepeat').value;
  if (password.length < PASSWORD_MIN_LENGTH) {
    showPasswordMessage(`Lösenordet behöver vara minst ${PASSWORD_MIN_LENGTH} tecken.`, true);
    return;
  }
  if (password !== repeat) {
    showPasswordMessage('Lösenorden är inte likadana.', true);
    return;
  }
  const btn = document.getElementById('passwordSaveBtn');
  btn.disabled = true;
  try {
    await LossiAuth.changePassword(password);
    showPasswordMessage('Klart! Använd det nya lösenordet nästa gång du loggar in.');
    setTimeout(closePasswordModal, 1600);
  } catch (e) {
    console.warn('Kunde inte byta lösenord:', e);
    const msg = /different from the old/i.test(e?.message || '')
      ? 'Det nya lösenordet måste skilja sig från det gamla.'
      : /weak|short|characters/i.test(e?.message || '')
        ? 'Lösenordet är för svagt. Prova ett längre.'
        : 'Kunde inte byta lösenord. Försök igen om en stund.';
    showPasswordMessage(msg, true);
    btn.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('passwordModal')?.classList.contains('open')) closePasswordModal();
});

// Bildväljare som används både i Skapa-dialogen och i uppläggets avatar-popover
function buildAvatarPickerHTML() {
  return PLAN_AVATARS.map(a =>
    `<button type="button" class="avatar-picker-btn avatar-picker-btn-image" data-avatar="${a.id}" title="${a.label}" aria-label="${a.label}" onclick="selectAvatarInPicker(this)">${planAvatarImgHTML(a.id)}</button>`
  ).join('');
}

function selectAvatarInPicker(btn) {
  btn.closest('.avatar-picker').querySelectorAll('.avatar-picker-btn').forEach(b => b.classList.toggle('selected', b === btn));
  // Uppläggets avatar-popover (upplag.html) sparar direkt vid val
  if (typeof onPlanAvatarPicked === 'function' && btn.closest('#planAvatarPopover')) onPlanAvatarPicked(btn.dataset.avatar);
}

function openCreatePlanModal() {
  document.getElementById('userMenuDropdown')?.classList.remove('open');
  const randomId = PLAN_AVATARS[Math.floor(Math.random() * PLAN_AVATARS.length)].id;
  document.querySelectorAll('#createPlanAvatarPicker .avatar-picker-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.avatar === randomId);
  });
  const name = document.getElementById('createPlanName');
  name.value = '';
  name.classList.remove('is-invalid');
  document.getElementById('createPlanDescription').innerHTML = '';
  document.getElementById('createPlanSubject').value = '';
  document.getElementById('createPlanGrade').value = '';
  document.getElementById('createPlanModal').classList.add('open');
  name.focus();
}

function closeCreatePlanModal() {
  document.getElementById('createPlanModal').classList.remove('open');
}

async function createPlan() {
  const nameInput = document.getElementById('createPlanName');
  const title = nameInput.value.trim();
  if (!title) {
    nameInput.classList.add('is-invalid');
    nameInput.focus();
    return;
  }

  const avatar = document.querySelector('#createPlanAvatarPicker .avatar-picker-btn.selected')?.dataset.avatar
    || PLAN_AVATARS[0].id;

  // Samma form som saveState() i upplag.html, men tomt innehåll
  const state = {
    title,
    description: document.getElementById('createPlanDescription').innerHTML.trim(),
    klass: '',
    subject: normalizeChoice(document.getElementById('createPlanSubject').value),
    grade: normalizeGrade(document.getElementById('createPlanGrade').value),
    avatar,
    statusKey: 'status-upcoming',
    statusLabel: 'Kommande',
    goalsHTML: '',
    criteriaHTML: '',
    structureHTML: '',
    createdAt: new Date().toISOString(),
  };

  let id;
  try {
    const project = await LossiData.currentProject().catch(() => null);
    id = await LossiData.createPlan(state, project?.id);
  } catch (e) {
    alert('Kunde inte spara upplägget.');
    return;
  }

  // Ett ämne som skrivits in men inte valts ur listan sparas också bland lärarens ämnen
  if (state.subject && !subjectItems().some(i => sameChoice(i.name, state.subject))) {
    rememberChoiceLater('subjects', state.subject);
  }
  if (state.grade && !gradeItems().some(i => sameChoice(i.name, state.grade))) {
    rememberChoiceLater('grades', state.grade);
  }

  window.location = 'upplag.html?id=' + id;
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('createPlanModal');
  if (!modal || !modal.classList.contains('open')) return;
  if (e.key === 'Escape') closeCreatePlanModal();
  if (e.key === 'Enter' && e.target.id === 'createPlanName') createPlan();
});
