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
function createChoiceList({ input, list, getItems, getCurrent = () => '', onPick, onForget, emptyText, inline = false }) {
  let highlight = 0;

  function options() {
    const query = normalizeChoice(input.value);
    const q = query.toLowerCase();
    const items = getItems();
    const matches = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items.slice();
    matches.sort((a, b) => (b.name.toLowerCase().startsWith(q)) - (a.name.toLowerCase().startsWith(q)));
    const opts = matches.map(i => ({ ...i, type: 'item' }));
    // Befintliga träffar först (Enter väljer bästa träffen), "Lägg till" sist
    if (query && !items.some(i => sameChoice(i.name, query))) opts.push({ type: 'add', name: query });
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
             <span class="choice-option-name">${escapeHTML(o.name)}</span>
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

// Ämnen: standardförslagen (PLAN_SUBJECTS), lärarens egna och de som används i upplägg.
// Ett nytt ämne sparas i profilen (user_metadata.subjects) när det väljs.
let subjectsFromPlans = [];
function subjectItems() {
  const saved = savedChoices('subjects');
  return mergeChoices(PLAN_SUBJECTS, saved, subjectsFromPlans).map(name => ({
    name,
    removable: !PLAN_SUBJECTS.some(s => sameChoice(s, name)),
  }));
}

function initSubjectChoices(input, list, { inline = false, getCurrent, onPick }) {
  planFieldValues('subject').then(v => { subjectsFromPlans = v; });
  return createChoiceList({
    input, list, inline, getCurrent,
    getItems: subjectItems,
    emptyText: 'Skriv namnet på ett ämne och tryck Enter.',
    onPick: (name, isNew) => {
      if (isNew) rememberChoice('subjects', name);
      onPick(name, isNew);
    },
    onForget: async name => {
      subjectsFromPlans = subjectsFromPlans.filter(s => !sameChoice(s, name));
      await forgetChoice('subjects', name);
    },
  });
}

// ── Logga ut ──
// Spara först: åtkomsttoken försvinner vid utloggningen, och sidbytet efteråt
// hinner annars inte skicka ändringar som väntar på att sparas.
function logOut() {
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
const PLAN_GRADES = ['4', '5', '6', '7', '8', '9'];

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
// Team och inbjudan är platshållare. Kommande händelser fylls från kalendern
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
    aside.innerHTML = buildAsideHTML();
    renderProjectSwitcher(options.onProjectChange);
    renderAsidePlans(options.currentPlanId).catch(e => console.warn('Kunde inte hämta upplägg till sidopanelen:', e));
    if (typeof renderAsideEvents === 'function') renderAsideEvents();
  }

  if (!document.getElementById('createPlanModal')) {
    document.body.insertAdjacentHTML('beforeend', buildCreatePlanModalHTML());
    document.getElementById('createPlanModal').addEventListener('click', e => {
      if (e.target.id === 'createPlanModal') closeCreatePlanModal();
    });
    initSubjectChoices(document.getElementById('createPlanSubject'), document.getElementById('createPlanSubjectList'), {
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
    ['inviteModal', 'joinModal', 'createProjectModal'].forEach(id => document.getElementById(id).addEventListener('click', e => {
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
    <nav class="topnav">
      <a href="index.html" class="topnav-link${active === 'plans' ? ' active' : ''}">Upplägg</a>
      <a href="calendar.html" class="topnav-link topnav-calendar${active === 'calendar' ? ' active' : ''}">Kalender</a>
      <span class="topnav-link is-soon" title="Material kommer snart" aria-disabled="true">Material <span class="soon-badge">Snart</span></span>
      <button class="topnav-create" onclick="openCreatePlanModal()">Skapa</button>
    </nav>
  </div>

  <div class="app-topbar-end">
    <button class="feedback-btn" onclick="openFeedbackModal()" title="Ge feedback – idéer, tankar eller buggar">
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
        <button class="user-menu-item" id="themeMenuItem" onclick="toggleTheme()"></button>
        <a class="user-menu-item" href="feedbackboard.html" id="adminFeedbackLink" hidden>
          <i data-lucide="message-square-heart"></i>
          Feedback från testare
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

function buildAsideHTML() {
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

    <div class="aside-group">
      <div class="aside-label">Kommande händelser</div>
      <div class="aside-events-list"></div>
      <a href="calendar.html" class="aside-item aside-more">
        <i data-lucide="calendar-days"></i>
        <span class="aside-item-text">Kalender</span>
      </a>
    </div>

    <div class="aside-group">
      <div class="aside-label">Upplägg</div>
      <div class="aside-plan-list"></div>
      <a href="index.html" class="aside-item aside-more">
        <i data-lucide="ellipsis"></i>
        <span class="aside-item-text">Mer</span>
      </a>
    </div>

    <div class="aside-group">
      <div class="aside-label aside-label-soon">Team <span class="soon-badge">Snart</span></div>
      ${APP_TEAMS.map(t => `
        <div class="aside-item is-placeholder is-soon" title="Team kommer snart – exempel på hur det kan se ut">
          <span class="aside-dot"></span>
          <span class="aside-item-text">${escapeHTML(t.name)} ${t.emoji}</span>
        </div>`).join('')}
    </div>
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

function projectIconHTML(project) {
  const color = project.personal ? '--color-avatar-6' : PROJECT_COLORS[(Number(project.id) % (PROJECT_COLORS.length - 1)) + 1];
  return `<span class="aside-project-icon" style="background: var(${color})"><i data-lucide="${project.personal ? 'lock' : 'users'}"></i></span>`;
}

function projectMetaText(project) {
  if (project.personal) return 'Bara du';
  const n = project.members.length;
  return n ? `${n} ${n === 1 ? 'medlem' : 'medlemmar'}` : 'Delat projekt';
}

async function renderProjectSwitcher(onProjectChange) {
  const wrap = document.getElementById('projectSwitcher');
  if (!wrap) return;
  let projects, current;
  try {
    [projects, current] = await Promise.all([LossiData.listProjects(), LossiData.currentProject()]);
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
      <div class="menu-popover-label">Dina projekt</div>
      ${projects.map(p => `
        <button type="button" class="project-menu-item${p.id === current.id ? ' is-current' : ''}" role="menuitemradio" aria-checked="${p.id === current.id}" data-project-id="${p.id}">
          ${projectIconHTML(p)}
          <span class="project-menu-text">
            <span class="project-menu-name">${escapeHTML(p.name)}</span>
            <span class="project-menu-meta">${escapeHTML(projectMetaText(p))}</span>
          </span>
          ${p.id === current.id ? '<i data-lucide="check" class="project-menu-check"></i>' : ''}
        </button>`).join('')}
      <div class="menu-popover-sep"></div>
      ${current.personal ? '' : `
      <button type="button" class="project-menu-item" onclick="toggleProjectMenu(false); openInviteModal()">
        <span class="project-menu-plain-icon"><i data-lucide="user-plus"></i></span>
        <span class="project-menu-text"><span class="project-menu-name">Bjud in till ${escapeHTML(current.name)}</span></span>
      </button>`}
      <button type="button" class="project-menu-item" onclick="toggleProjectMenu(false); openCreateProjectModal()">
        <span class="project-menu-plain-icon"><i data-lucide="folder-plus"></i></span>
        <span class="project-menu-text"><span class="project-menu-name">Skapa projekt</span></span>
      </button>
      <button type="button" class="project-menu-item" onclick="toggleProjectMenu(false); openJoinModal()">
        <span class="project-menu-plain-icon"><i data-lucide="ticket"></i></span>
        <span class="project-menu-text"><span class="project-menu-name">Gå med med kod</span></span>
      </button>
    </div>`;
  updateInviteCard(current);
  // Nyss skapat projekt: visa koden direkt så att man kan bjuda in
  let openInvite = false;
  try { openInvite = sessionStorage.getItem('lossi-open-invite') === '1'; sessionStorage.removeItem('lossi-open-invite'); } catch (e) {}
  if (openInvite && !current.personal) openInviteModal();

  wrap.querySelectorAll('[data-project-id]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.projectId;
    toggleProjectMenu(false);
    if (id === current.id) return;
    LossiData.setCurrentProject(id);
    if (onProjectChange) {
      const project = projects.find(p => p.id === id);
      renderProjectSwitcher(onProjectChange);
      renderAsidePlans();
      onProjectChange(project);
    } else {
      window.location.href = 'index.html';
    }
  }));
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [wrap] });
}

// ── Bjud in och gå med (inbjudningskod, supabase/projects.sql steg 3) ──
// Alla medlemmar i ett delat projekt ser dess kod och en länk som öppnar
// Skapa konto med koden ifylld. Egna projekt kan man inte bjuda in till.
function inviteLink(code) {
  return new URL('login.html?kod=' + encodeURIComponent(code), window.location.href).href;
}

function formatInviteCode(code) {
  const raw = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
}

// Kortet längst ner i sidopanelen: bjud in till valt projekt, eller gå med i ett
function updateInviteCard(project) {
  const title = document.getElementById('asideInviteTitle');
  const sub = document.getElementById('asideInviteSub');
  if (!title || !sub) return;
  if (project && !project.personal) {
    title.textContent = 'Bjud in kollegor';
    sub.textContent = `Dela koden till ${project.name}`;
  } else {
    title.textContent = 'Samarbeta med kollegor';
    sub.textContent = 'Skapa ett projekt eller gå med med kod';
  }
}

async function openInviteOrJoin(e) {
  if (e?.target.closest('.aside-invite-close')) return;
  const project = await LossiData.currentProject().catch(() => null);
  if (project && !project.personal) openInviteModal();
  else toggleProjectMenu(true);
}

function buildInviteModalsHTML() {
  return `
<div class="modal-overlay" id="inviteModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 id="inviteModalTitle">Bjud in kollegor</h3>
      <button class="modal-close" onclick="closeInviteModal()"><i data-lucide="x"></i></button>
    </div>
    <div class="modal-body">
      <p class="invite-lead">Kollegor som får koden kan skapa ett konto och hamnar direkt i projektet. Har de redan ett konto väljer de <strong>Gå med med kod</strong> i projektväljaren.</p>
      <div class="invite-field">
        <span class="invite-label">Inbjudningskod</span>
        <div class="invite-copy-row">
          <span class="invite-code" id="inviteCode"></span>
          <button class="btn-ghost invite-copy-btn" onclick="copyInvite('code', this)"><i data-lucide="copy"></i><span>Kopiera</span></button>
        </div>
      </div>
      <div class="invite-field">
        <span class="invite-label">Eller skicka länken</span>
        <div class="invite-copy-row">
          <span class="invite-link" id="inviteLink"></span>
          <button class="btn-ghost invite-copy-btn" onclick="copyInvite('link', this)"><i data-lucide="copy"></i><span>Kopiera</span></button>
        </div>
      </div>
      <div class="invite-field" id="inviteMembersField">
        <span class="invite-label" id="inviteMembersLabel">Medlemmar</span>
        <div class="invite-members" id="inviteMembers"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary" onclick="closeInviteModal()">Klar</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="createProjectModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3>Skapa projekt</h3>
      <button class="modal-close" onclick="closeCreateProjectModal()"><i data-lucide="x"></i></button>
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
      <button class="btn-ghost" onclick="closeCreateProjectModal()">Avbryt</button>
      <button class="btn-primary" id="createProjectBtn" onclick="createProjectFromModal()">Skapa projekt</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="joinModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3>Gå med i ett projekt</h3>
      <button class="modal-close" onclick="closeJoinModal()"><i data-lucide="x"></i></button>
    </div>
    <form class="modal-body" id="joinForm" onsubmit="event.preventDefault(); joinWithCode()">
      <div class="field-group">
        <label class="field-label" for="joinCode">Inbjudningskod</label>
        <div class="field-group-content">
          <input class="field-input invite-code-input" type="text" id="joinCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-1234" />
        </div>
      </div>
      <p class="password-message" id="joinMessage" role="status" hidden></p>
      <button type="submit" hidden></button>
    </form>
    <div class="modal-footer">
      <button class="btn-ghost" onclick="closeJoinModal()">Avbryt</button>
      <button class="btn-primary" id="joinBtn" onclick="joinWithCode()">Gå med</button>
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
  if (!project || project.personal) return openJoinModal();
  if (!project.inviteCode) {
    alert('Projektet har ingen inbjudningskod än.');
    return;
  }
  inviteProject = project;
  document.getElementById('inviteModalTitle').textContent = `Bjud in till ${project.name}`;
  document.getElementById('inviteCode').textContent = formatInviteCode(project.inviteCode);
  document.getElementById('inviteLink').textContent = inviteLink(project.inviteCode);
  const members = project.members;
  document.getElementById('inviteMembersField').hidden = !members.length;
  document.getElementById('inviteMembersLabel').textContent = `Medlemmar (${members.length})`;
  const list = document.getElementById('inviteMembers');
  list.innerHTML = members.map(m => {
    const profile = { displayName: m.displayName, avatar: m.avatar, email: m.email };
    return `<div class="invite-member"><span class="invite-member-avatar">${userAvatarHTML(profile)}</span><span>${escapeHTML(profileName(profile) || 'Okänd')}</span></div>`;
  }).join('');
  document.querySelectorAll('#inviteModal .invite-copy-btn span').forEach(el => { el.textContent = 'Kopiera'; });
  document.getElementById('inviteModal').classList.add('open');
  lucide.createIcons({ nodes: [document.getElementById('inviteModal')] });
}

function closeInviteModal() {
  document.getElementById('inviteModal').classList.remove('open');
}

async function copyInvite(what, btn) {
  if (!inviteProject) return;
  const text = what === 'link' ? inviteLink(inviteProject.inviteCode) : formatInviteCode(inviteProject.inviteCode);
  const label = btn.querySelector('span');
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = 'Kopierad!';
  } catch (e) {
    label.textContent = 'Markera och kopiera';
  }
  setTimeout(() => { label.textContent = 'Kopiera'; }, 2000);
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

function openJoinModal() {
  document.getElementById('joinForm').reset();
  showJoinMessage('');
  document.getElementById('joinBtn').disabled = false;
  document.getElementById('joinModal').classList.add('open');
  document.getElementById('joinCode').focus();
}

function closeJoinModal() {
  document.getElementById('joinModal').classList.remove('open');
}

function showJoinMessage(text, isError) {
  const el = document.getElementById('joinMessage');
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
  el.hidden = !text;
}

async function joinWithCode() {
  const input = document.getElementById('joinCode');
  const code = input.value;
  if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) {
    showJoinMessage('Skriv inbjudningskoden (8 tecken).', true);
    input.focus();
    return;
  }
  const btn = document.getElementById('joinBtn');
  btn.disabled = true;
  try {
    await LossiData.joinProject(code);
    window.location.href = 'index.html';
  } catch (e) {
    console.warn('Kunde inte gå med i projektet:', e);
    showJoinMessage(/inbjudningskod/i.test(e?.message || '') ? 'Koden finns inte. Kontrollera att du skrivit rätt.' : 'Något gick fel. Försök igen om en stund.', true);
    btn.disabled = false;
  }
}

document.addEventListener('input', e => {
  if (e.target.id !== 'joinCode') return;
  const formatted = formatInviteCode(e.target.value);
  if (formatted !== e.target.value) e.target.value = formatted;
  showJoinMessage('');
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['inviteModal', 'joinModal', 'createProjectModal'].forEach(id => document.getElementById(id)?.classList.remove('open'));
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

// Obesvarade förfrågningar om redigeringsrätt per eget upplägg: Map planId → antal
async function editRequestCounts() {
  const counts = new Map();
  try {
    (await LossiData.listMyEditRequests()).forEach(r => counts.set(r.planId, (counts.get(r.planId) || 0) + 1));
  } catch (e) {} // t.ex. innan steg 4 i projects.sql körts
  return counts;
}

function editRequestBadgeHTML(n) {
  return n ? `<span class="request-badge" title="${n} ${n === 1 ? 'kollega vill' : 'kollegor vill'} redigera">${n}</span>` : '';
}

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
    return;
  }
  list.innerHTML = visiblePlans.map(p => `
    <a href="upplag.html?id=${p.id}" class="aside-item${p.id === String(currentPlanId) ? ' active' : ''}" data-aside-plan="${p.id}" title="${escapeHTML(p.title)}">
      <span class="aside-plan-icon">${planAvatarImgHTML(p.avatar)}</span>
      <span class="aside-item-text">${escapeHTML(p.title)}</span>
      ${editRequestBadgeHTML(requests.get(p.id))}
    </a>`).join('');
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
      <button class="modal-close" onclick="closeProfileModal()">
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
      <button class="btn-ghost" onclick="closeProfileModal()">Avbryt</button>
      <button class="btn-primary" id="profileSaveBtn" onclick="saveProfile()">Spara</button>
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
      <button class="modal-close" onclick="closeCreatePlanModal()">
        <i data-lucide="x"></i>
      </button>
    </div>
    <div class="modal-body">
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
          <select class="field-input" id="createPlanGrade">
            ${PLAN_GRADES.map(g => `<option>${g}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" onclick="closeCreatePlanModal()">Avbryt</button>
      <button class="btn-primary" onclick="createPlan()">Skapa</button>
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
      <button class="modal-close" onclick="closePasswordModal()">
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
      <button class="btn-ghost" onclick="closePasswordModal()">Avbryt</button>
      <button class="btn-primary" id="passwordSaveBtn" onclick="savePassword()">Spara lösenord</button>
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
    grade: document.getElementById('createPlanGrade').value,
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
    await rememberChoice('subjects', state.subject);
  }

  window.location = 'upplag.html?id=' + id;
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('createPlanModal');
  if (!modal || !modal.classList.contains('open')) return;
  if (e.key === 'Escape') closeCreatePlanModal();
  if (e.key === 'Enter' && e.target.id === 'createPlanName') createPlan();
});
