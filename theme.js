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
function getPlanSummary(id, state) {
  state = state || {};
  const demo = DEMO_PLANS[state.demoKey] || {};
  return {
    id,
    demoKey: state.demoKey || null,
    title: state.title || demo.title || 'Namnlöst upplägg',
    subject: state.subject || demo.subject || '',
    grade: state.grade || demo.grade || '',
    avatar: resolvePlanAvatarId(id, state.avatar),
  };
}

// Senast skapade först
async function getPlanSummaries() {
  const plans = await LossiData.listPlans();
  return plans.reverse().map(p => getPlanSummary(p.id, p.state));
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
  if (aside) {
    aside.innerHTML = buildAsideHTML();
    renderAsidePlans(options.currentPlanId).catch(e => console.warn('Kunde inte hämta upplägg till sidopanelen:', e));
  }

  if (!document.getElementById('createPlanModal')) {
    document.body.insertAdjacentHTML('beforeend', buildCreatePlanModalHTML());
    document.getElementById('createPlanModal').addEventListener('click', e => {
      if (e.target.id === 'createPlanModal') closeCreatePlanModal();
    });
  }

  if (!document.getElementById('profileModal')) {
    document.body.insertAdjacentHTML('beforeend', buildProfileModalHTML());
    document.getElementById('profileModal').addEventListener('click', e => {
      if (e.target.id === 'profileModal') closeProfileModal();
    });
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
      <div class="aside-plan-list"></div>
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
// Upplägg-listan i asiden fylls i när datan hämtats (renderAppShell väntar inte)
async function renderAsidePlans(currentPlanId) {
  const plans = await getPlanSummaries();
  const visiblePlans = plans.slice(0, ASIDE_PLAN_LIMIT);
  // Det öppna upplägget ska alltid synas i listan, även om det är äldre
  if (currentPlanId && !visiblePlans.some(p => p.id === String(currentPlanId))) {
    const current = plans.find(p => p.id === String(currentPlanId));
    if (current) visiblePlans[visiblePlans.length - 1] = current;
  }

  const list = document.querySelector('.aside-plan-list');
  if (!list) return;
  list.innerHTML = visiblePlans.map(p => `
    <a href="upplag.html?id=${p.id}" class="aside-item${p.id === String(currentPlanId) ? ' active' : ''}" data-aside-plan="${p.id}" title="${escapeHTML(p.title)}">
      <span class="aside-plan-icon">${planAvatarImgHTML(p.avatar)}</span>
      <span class="aside-item-text">${escapeHTML(p.title)}</span>
    </a>`).join('');
}

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

  let id;
  try {
    id = await LossiData.createPlan(state);
  } catch (e) {
    alert('Kunde inte spara upplägget.');
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
