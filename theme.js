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

// ── Rensa sparad data och cache ──
// Tar bort allt Lossi sparat lokalt (upplägg, tema, sidopanelens läge),
// hämtar om sajtens egna filer förbi webbläsarens cache och laddar om.
async function clearSiteCache() {
  if (!confirm('Rensa all sparad data för Lossi i den här webbläsaren?\n\nÄndringar du gjort i upplägg försvinner och sidan laddas om.')) return;

  // Upplägg-sidan sparar sig själv vid beforeunload. Stäng av det, annars
  // skrivs den gamla datan tillbaka direkt efter att den rensats.
  if (typeof saveState === 'function') window.removeEventListener('beforeunload', saveState);

  try {
    Object.keys(localStorage).filter(k => k.startsWith('lossi-')).forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch (e) {}

  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    if (navigator.serviceWorker) await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister()));
  } catch (e) {}

  // Tvinga fram färska kopior av sidan och dess egna css/js i HTTP-cachen
  // (CDN-bibliotek hoppas över, de rörs inte av lokala ändringar).
  const urls = [location.href, ...[...document.querySelectorAll('link[rel="stylesheet"][href], script[src]')]
    .map(el => el.href || el.src)
    .filter(u => new URL(u, location.href).origin === location.origin)];
  await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => {})));

  location.reload();
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
// Vilka upplägg som finns (lossi-plans = lista med id). Saknas listan
// gäller de tre demo-uppläggen. Innehållet i varje upplägg ligger som
// tidigare i lossi-plan-<id>; demo-uppläggen som inte sparats än får
// titel/ämne/årskurs från DEMO_PLANS.
const DEMO_PLANS = {
  '1': { title: 'Demokrati – grunderna och processerna', subject: 'Samhällskunskap', grade: '7–9' },
  '2': { title: 'Källkritik i det digitala samhället', subject: 'Samhällskunskap', grade: '9' },
  '3': { title: 'Fotosyntes – från molekyl till ekosystem', subject: 'Biologi', grade: '7' },
};

function getPlanIds() {
  try {
    const ids = JSON.parse(localStorage.getItem('lossi-plans'));
    if (Array.isArray(ids) && ids.length) return ids.map(String);
  } catch (e) {}
  return Object.keys(DEMO_PLANS);
}

function readPlanState(id) {
  try {
    return JSON.parse(localStorage.getItem('lossi-plan-' + id)) || null;
  } catch (e) {
    return null;
  }
}

// Det som listor (aside, översikt) behöver veta om ett upplägg
function getPlanSummary(id) {
  const state = readPlanState(id) || {};
  const demo = DEMO_PLANS[id] || {};
  return {
    id,
    title: state.title || demo.title || 'Namnlöst upplägg',
    subject: state.subject || demo.subject || '',
    grade: state.grade || demo.grade || '',
    avatar: resolvePlanAvatarId(id, state.avatar),
  };
}

// Senast skapade först
function getPlanSummaries() {
  return getPlanIds().slice().reverse().map(getPlanSummary);
}

function escapeHTML(text) {
  return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── App-skal: topbar + aside ──
// Byggs här så att index.html och upplag.html delar exakt samma innehåll.
// Sidan anropar renderAppShell() först i sitt script, före lucide.createIcons().
// Projekt, kommande händelser och team är platshållare tills de tjänsterna finns.
const APP_PROJECT = { name: 'Amerikanska skolan' };
const APP_EVENTS = [
  { title: 'Samhällsekonomi', time: '10:00–11:00' },
  { title: 'Matematik', time: '11:00–12:00' },
];
const APP_TEAMS = [
  { name: 'Astronomerna', emoji: '🚀' },
  { name: 'Dricka kaffe?', emoji: '☕' },
];
const ASIDE_PLAN_LIMIT = 4;

function renderAppShell(options = {}) {
  const header = document.querySelector('header.app-topbar');
  if (header) header.innerHTML = buildTopbarHTML(options.active);

  const aside = document.querySelector('aside.app-aside');
  if (aside) aside.innerHTML = buildAsideHTML(options.currentPlanId);

  if (!document.getElementById('createPlanModal')) {
    document.body.insertAdjacentHTML('beforeend', buildCreatePlanModalHTML());
    document.getElementById('createPlanModal').addEventListener('click', e => {
      if (e.target.id === 'createPlanModal') closeCreatePlanModal();
    });
  }
}

function buildTopbarHTML(active) {
  return `
  <div class="app-topbar-start">
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
        <div class="app-switcher-item is-disabled" title="Kommer senare">
          <div class="app-switcher-icon app-icon-calendar"><i data-lucide="calendar-days"></i></div>
          <span class="app-switcher-name">Kalender</span>
          <span class="app-switcher-soon">Snart</span>
        </div>
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
      <a href="#" class="topnav-link${active === 'material' ? ' active' : ''}" title="Kommer senare">Material</a>
      <button class="topnav-create" onclick="openCreatePlanModal()">Skapa</button>
    </nav>
  </div>

  <div class="app-topbar-end">
    <div class="user-menu">
      <div class="user-badge" onclick="toggleUserMenu()" id="userBadge" title="Tobias Frithiofsson">
        <div class="user-avatar-sm"><img src="avatar.png" alt="Tobias Frithiofsson" /></div>
        <i data-lucide="chevron-down"></i>
      </div>
      <div class="user-menu-dropdown" id="userMenuDropdown">
        <button class="user-menu-item" id="themeMenuItem" onclick="toggleTheme()"></button>
        <button class="user-menu-item" onclick="clearSiteCache()">
          <i data-lucide="eraser"></i>
          Rensa sparad data
        </button>
        <div class="user-menu-sep"></div>
        <a href="landing.html" class="user-menu-item">
          <i data-lucide="log-out"></i>
          Logga ut
        </a>
      </div>
    </div>
  </div>`;
}

function buildAsideHTML(currentPlanId) {
  const plans = getPlanSummaries();
  const visiblePlans = plans.slice(0, ASIDE_PLAN_LIMIT);
  // Det öppna upplägget ska alltid synas i listan, även om det är äldre
  if (currentPlanId && !visiblePlans.some(p => p.id === String(currentPlanId))) {
    const current = plans.find(p => p.id === String(currentPlanId));
    if (current) visiblePlans[visiblePlans.length - 1] = current;
  }

  let inviteDismissed = false;
  try { inviteDismissed = localStorage.getItem('lossi-invite-dismissed') === 'true'; } catch (e) {}

  return `
  <div class="aside-scroll">
    <div class="aside-project" title="Projekt – fler projekt kommer senare">
      <div class="aside-project-icon"><i data-lucide="award"></i></div>
      <span class="aside-project-name">${escapeHTML(APP_PROJECT.name)}</span>
    </div>

    <div class="aside-group">
      <div class="aside-label">Kommande händelser</div>
      ${APP_EVENTS.map(ev => `
        <div class="aside-item is-placeholder" title="Från Kalender – kommer senare">
          <span class="aside-dot"></span>
          <span class="aside-item-text">${escapeHTML(ev.title)}</span>
          <span class="aside-item-meta">${ev.time}</span>
        </div>`).join('')}
    </div>

    <div class="aside-group">
      <div class="aside-label">Upplägg</div>
      ${visiblePlans.map(p => `
        <a href="upplag.html?id=${p.id}" class="aside-item${p.id === String(currentPlanId) ? ' active' : ''}" data-aside-plan="${p.id}" title="${escapeHTML(p.title)}">
          <span class="aside-plan-icon">${planAvatarImgHTML(p.avatar)}</span>
          <span class="aside-item-text">${escapeHTML(p.title)}</span>
        </a>`).join('')}
      <a href="index.html" class="aside-item aside-more">
        <i data-lucide="ellipsis"></i>
        <span class="aside-item-text">Mer</span>
      </a>
    </div>

    <div class="aside-group">
      <div class="aside-label">Team</div>
      ${APP_TEAMS.map(t => `
        <div class="aside-item is-placeholder" title="Teamchatt – kommer senare">
          <span class="aside-dot"></span>
          <span class="aside-item-text">${escapeHTML(t.name)} ${t.emoji}</span>
        </div>`).join('')}
      <div class="aside-item aside-more is-placeholder" title="Kommer senare">
        <i data-lucide="ellipsis"></i>
        <span class="aside-item-text">Mer</span>
      </div>
    </div>
  </div>

  ${inviteDismissed ? '' : `
  <div class="aside-invite" title="Inbjudningar kommer senare">
    <i data-lucide="user-plus" class="aside-invite-icon"></i>
    <div class="aside-invite-text">
      <div class="aside-invite-title">Bjud in kollegor</div>
      <div class="aside-invite-sub">Samarbeta med ditt team</div>
    </div>
    <button class="aside-invite-close" onclick="dismissInvite()" title="Dölj"><i data-lucide="x"></i></button>
  </div>`}`;
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
        <label class="field-label">Pedagogisk idé</label>
        <div class="field-group-content">
          <div class="editor-wrap">
            <div class="editor-body" contenteditable="true" id="createPlanDescription" data-placeholder="Beskriv upplägget kort"></div>
          </div>
        </div>
      </div>
      <div class="field-group">
        <label class="field-label" for="createPlanSubject">Ämne</label>
        <div class="field-group-content">
          <select class="field-input" id="createPlanSubject">
            ${PLAN_SUBJECTS.map(s => `<option>${s}</option>`).join('')}
          </select>
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
  document.getElementById('createPlanModal').classList.add('open');
  name.focus();
}

function closeCreatePlanModal() {
  document.getElementById('createPlanModal').classList.remove('open');
}

function createPlan() {
  const nameInput = document.getElementById('createPlanName');
  const title = nameInput.value.trim();
  if (!title) {
    nameInput.classList.add('is-invalid');
    nameInput.focus();
    return;
  }

  const ids = getPlanIds();
  const id = String(Math.max(0, ...ids.map(n => parseInt(n, 10) || 0)) + 1);
  const avatar = document.querySelector('#createPlanAvatarPicker .avatar-picker-btn.selected')?.dataset.avatar
    || PLAN_AVATARS[0].id;

  // Samma form som saveState() i upplag.html, men tomt innehåll
  const state = {
    title,
    description: document.getElementById('createPlanDescription').innerHTML.trim(),
    klass: '',
    subject: document.getElementById('createPlanSubject').value,
    grade: document.getElementById('createPlanGrade').value,
    avatar,
    statusKey: 'status-upcoming',
    statusLabel: 'Kommande',
    goalsHTML: '',
    criteriaHTML: '',
    structureHTML: '',
    createdAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem('lossi-plan-' + id, JSON.stringify(state));
    localStorage.setItem('lossi-plans', JSON.stringify([...ids, id]));
  } catch (e) {
    alert('Kunde inte spara upplägget i webbläsaren.');
    return;
  }

  window.location = 'upplag.html?id=' + id;
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('createPlanModal');
  if (!modal || !modal.classList.contains('open')) return;
  if (e.key === 'Escape') closeCreatePlanModal();
  if (e.key === 'Enter' && e.target.id === 'createPlanName') createPlan();
});
