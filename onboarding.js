// ── Skapa konto (onboarding) – login.html ──
// Tre steg i ett kort med en bild till höger:
//   1. Ange kod: sex rutor, man hoppar vidare automatiskt. Alla behöver en
//      giltig kod, även den som bjudits in till ett projekt.
//   2. Skapa konto: förnamn, efternamn, e-post, lösenord. Kontot skapas här
//      (supabase/access-codes.sql kontrollerar koden igen).
//   3. Ditt projekt: ens egen yta ("Annas yta") och inbjudningar till
//      kollegors projekt (Gå med / Avstå). Starta öppnar alltid den egna ytan.
// Till höger: maskoten (steg 1–2), vars ögon följer pekaren och tittar på
// fältet man skriver i (blundar vid lösenordet), och i steg 3 en liten
// version av Lossis projektväljare som visar ens projekt.
// Kräver auth.js, theme.js och data.js. Anropas från login.html (showSignup/showLogin).

const OB_CODE_LENGTH = 6;
const OB_MIN_PASSWORD = 8;
const obState = { step: 1, code: '', ownProject: null, joined: [] };
const obEl = id => document.getElementById(id);

function showSignup() {
  document.getElementById('loginCard').hidden = true;
  document.querySelector('.login-wordmark').hidden = true;
  obEl('signupCard').hidden = false;
  document.body.classList.add('is-onboarding');
  obGoStep(1);
}

function showLogin() {
  obEl('signupCard').hidden = true;
  document.querySelector('.login-wordmark').hidden = false;
  document.getElementById('loginCard').hidden = false;
  document.body.classList.remove('is-onboarding');
  document.title = 'Logga in | Lossi';
  document.getElementById('loginEmail').focus();
}

const OB_TITLES = { 1: 'Ange kod', 2: 'Skapa konto', 3: 'Ditt projekt' };

function obGoStep(step) {
  obState.step = step;
  document.querySelectorAll('.ob-step').forEach(s => { s.hidden = Number(s.dataset.step) !== step; });
  document.querySelectorAll('.ob-dots span').forEach((d, i) => d.classList.toggle('is-on', i === step - 1));
  // Steg 3: kontot finns redan, så det finns inget att gå tillbaka till
  obEl('obBack').hidden = step === 3;
  obEl('obNext').querySelector('.login-btn-label').textContent = step === 3 ? 'Starta' : 'Nästa';
  obEl('obMascot').hidden = step === 3;
  obEl('obApp').hidden = step !== 3;
  document.title = OB_TITLES[step] + ' | Lossi';
  // Gamla felmeddelanden hör inte till det nya steget
  ['obCodeError', 'obAccountError', 'obProjectError'].forEach(id => obShowError(id, ''));
  document.querySelectorAll('.ob-card .is-invalid').forEach(el => el.classList.remove('is-invalid'));
  if (step === 1) {
    const boxes = obCodeBoxes();
    (boxes.find(b => !b.value) || boxes[OB_CODE_LENGTH - 1]).focus();
  }
  if (step === 2) obEl('obFirstName').focus();
  if (step === 3) obLoadProjectStep();
}

function obSetLoading(on) {
  obEl('obNext').classList.toggle('is-loading', on);
  obEl('obNext').disabled = on;
}

function obShowError(id, text) {
  const el = obEl(id);
  el.textContent = text || '';
  el.hidden = !text;
}

obEl('obBack').addEventListener('click', () => {
  if (obState.step === 2) obGoStep(1);
  else showLogin();
});

obEl('obForm').addEventListener('submit', e => {
  e.preventDefault();
  if (obState.step === 1) obSubmitCode();
  else if (obState.step === 2) obSubmitAccount();
  else obStart();
});


// ── Steg 1: koden ──
function obCodeBoxes() {
  return [...document.querySelectorAll('.ob-code-box')];
}

function obCodeValue() {
  return obCodeBoxes().map(b => b.value).join('');
}

function obFillCode(text, from = 0) {
  const chars = String(text).toUpperCase().replace(/[^A-Z0-9]/g, '').split('');
  const boxes = obCodeBoxes();
  chars.slice(0, OB_CODE_LENGTH - from).forEach((c, i) => { boxes[from + i].value = c; });
  const next = boxes[Math.min(from + chars.length, OB_CODE_LENGTH - 1)];
  next.focus();
  next.select();
  obCodeChanged();
}

function obCodeChanged() {
  obShowError('obCodeError', '');
  obCodeBoxes().forEach(b => b.classList.remove('is-invalid'));
  obMascot.setMood(obCodeValue().length === OB_CODE_LENGTH ? 'curious' : 'normal');
}

obEl('obCode').addEventListener('input', e => {
  const box = e.target;
  const boxes = obCodeBoxes();
  const index = boxes.indexOf(box);
  const raw = box.value;
  if (raw.length > 1) return obFillCode(raw, index); // t.ex. inklistrat eller autofyllt
  box.value = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (box.value && index < OB_CODE_LENGTH - 1) {
    boxes[index + 1].focus();
    boxes[index + 1].select();
  }
  obCodeChanged();
});

obEl('obCode').addEventListener('keydown', e => {
  const boxes = obCodeBoxes();
  const index = boxes.indexOf(e.target);
  if (e.key === 'Backspace' && !e.target.value && index > 0) {
    e.preventDefault();
    boxes[index - 1].value = '';
    boxes[index - 1].focus();
    obCodeChanged();
  } else if (e.key === 'ArrowLeft' && index > 0) {
    e.preventDefault();
    boxes[index - 1].focus();
  } else if (e.key === 'ArrowRight' && index < OB_CODE_LENGTH - 1) {
    e.preventDefault();
    boxes[index + 1].focus();
  }
});

obEl('obCode').addEventListener('paste', e => {
  e.preventDefault();
  obFillCode(e.clipboardData?.getData('text') || '', obCodeBoxes().indexOf(e.target));
});

obEl('obCode').addEventListener('focusin', e => { if (e.target.select) e.target.select(); });

async function obSubmitCode() {
  const code = obCodeValue();
  if (code.length < OB_CODE_LENGTH) {
    obCodeBoxes().forEach(b => { if (!b.value) b.classList.add('is-invalid'); });
    (obCodeBoxes().find(b => !b.value) || obCodeBoxes()[0]).focus();
    return obShowError('obCodeError', code
      ? `Koden har ${OB_CODE_LENGTH} tecken.`
      : 'Skriv koden du har fått. Den har 6 tecken.');
  }
  obSetLoading(true);
  try {
    const ok = await LossiAuth.checkAccessCode(code);
    obSetLoading(false);
    if (!ok) {
      obCodeBoxes().forEach(b => b.classList.add('is-invalid'));
      obMascot.setMood('sad');
      return obShowError('obCodeError', 'Koden gäller inte. Kontrollera att du skrivit rätt, eller be om en ny kod.');
    }
    obState.code = code;
    obMascot.setMood('happy');
    setTimeout(() => obGoStep(2), 450);
  } catch (e) {
    console.warn('Kunde inte kontrollera koden:', e);
    obSetLoading(false);
    obShowError('obCodeError', 'Kunde inte kontrollera koden. Kontrollera uppkopplingen och försök igen.');
  }
}


// ── Steg 2: kontot ──
const OB_FIELDS = ['obFirstName', 'obLastName', 'obEmail', 'obPassword'];

OB_FIELDS.forEach(id => obEl(id).addEventListener('input', () => {
  obEl(id).classList.remove('is-invalid');
  obShowError('obAccountError', '');
}));

function obFail(id, text) {
  obShowError('obAccountError', text);
  obEl(id).classList.add('is-invalid');
  obEl(id).focus();
}

function obAccountError(err) {
  const msg = (err && err.message) || '';
  if (/ogiltig kod|database error saving new user/i.test(msg)) return 'Koden gäller inte längre. Gå tillbaka och skriv en ny kod.';
  if (/already registered|already exists/i.test(msg)) return 'Det finns redan ett konto med den e-postadressen. Gå tillbaka och logga in i stället.';
  if (/password/i.test(msg)) return `Lösenordet måste vara minst ${OB_MIN_PASSWORD} tecken.`;
  if (/email not confirmed/i.test(msg)) return 'Kontot skapades men måste aktiveras. Hör av dig till oss.';
  if (err && (err.status === 429 || /rate limit|too many/i.test(msg))) return 'Många försök på kort tid. Vänta en stund och försök igen.';
  if (/fetch|network/i.test(msg)) return 'Kunde inte nå servern. Kontrollera din uppkoppling.';
  return 'Något gick fel när kontot skulle skapas. Försök igen om en stund.';
}

async function obSubmitAccount() {
  const firstName = obEl('obFirstName').value.trim().replace(/\s+/g, ' ');
  const lastName = obEl('obLastName').value.trim().replace(/\s+/g, ' ');
  const email = obEl('obEmail').value.trim();
  const password = obEl('obPassword').value;
  if (!firstName) return obFail('obFirstName', 'Skriv ditt förnamn.');
  if (!lastName) return obFail('obLastName', 'Skriv ditt efternamn, så att kollegorna ser vem du är.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return obFail('obEmail', 'Skriv en giltig e-postadress, t.ex. namn@mail.se.');
  if (password.length < OB_MIN_PASSWORD) return obFail('obPassword', `Lösenordet måste vara minst ${OB_MIN_PASSWORD} tecken.`);
  obShowError('obAccountError', '');
  obSetLoading(true);
  try {
    await LossiAuth.signUp({ accessCode: obState.code, firstName, lastName, email, password });
    try { localStorage.setItem('lossi-profile-prompted', 'true'); } catch (e) {}
    obSetLoading(false);
    obGoStep(3);
  } catch (err) {
    console.warn('Kontot kunde inte skapas:', err);
    obSetLoading(false);
    obShowError('obAccountError', obAccountError(err));
  }
}


// ── Steg 3: projekt ──
async function obLoadProjectStep() {
  obSetLoading(true);
  let projects = [], notes = [];
  try {
    [projects, notes] = await Promise.all([
      LossiData.listProjects(),
      LossiData.listNotifications().catch(() => []),
    ]);
  } catch (e) {
    console.warn('Kunde inte hämta projekten:', e);
  }
  obSetLoading(false);
  obState.ownProject = projects.find(p => p.personal) || projects[0] || null;
  const own = obState.ownProject;
  obEl('obOwnProject').innerHTML = own ? obProjectRowHTML(own, 'Bara du') : '<p class="ob-help">Din yta skapas när du startar.</p>';
  const invites = notes.filter(n => n.kind === 'project_invite' && n.pending);
  obEl('obInvites').hidden = !invites.length;
  obEl('obInviteList').innerHTML = invites.map(n => `
    <div class="ob-invite" data-invite-id="${n.inviteId}" data-project-name="${escapeHTML(n.projectName)}">
      ${projectAvatarHTML({ id: n.projectId || 0, name: n.projectName }, null, 'ob-project-avatar')}
      <span class="ob-project-text">
        <span class="ob-project-name">${escapeHTML(n.projectName || 'Projekt')}</span>
        <span class="ob-project-meta">${n.actorName ? 'Inbjuden av ' + escapeHTML(n.actorName) : 'Inbjudan'}</span>
      </span>
      <span class="ob-invite-actions">
        <button type="button" class="btn btn-text" onclick="obAnswerInvite(this, false)">Avstå</button>
        <button type="button" class="btn btn-solid" onclick="obAnswerInvite(this, true)">Gå med</button>
      </span>
    </div>`).join('');
  lucide.createIcons({ nodes: [obEl('obOwnProject'), obEl('obInviteList')] });
  obRenderApp();
}

function obProjectRowHTML(project, meta) {
  return `
    ${projectAvatarHTML(project, project.avatar, 'ob-project-avatar')}
    <span class="ob-project-text">
      <span class="ob-project-name">${escapeHTML(project.name)}</span>
      <span class="ob-project-meta">${escapeHTML(meta)}</span>
    </span>`;
}

async function obAnswerInvite(btn, accept) {
  const row = btn.closest('.ob-invite');
  const actions = row.querySelector('.ob-invite-actions');
  actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
  obShowError('obProjectError', '');
  try {
    const projectId = await LossiData.answerInvite(row.dataset.inviteId, accept);
    actions.innerHTML = accept
      ? '<span class="ob-invite-done is-joined"><i data-lucide="check"></i>Gick med</span>'
      : '<span class="ob-invite-done">Avstod</span>';
    lucide.createIcons({ nodes: [actions] });
    if (accept) {
      obState.joined.push({ id: String(projectId), name: row.dataset.projectName });
      obState.lastJoined = String(projectId);
    }
    obRenderApp();
  } catch (e) {
    console.warn('Kunde inte svara på inbjudan:', e);
    actions.querySelectorAll('button').forEach(b => { b.disabled = false; });
    obShowError('obProjectError', 'Kunde inte svara på inbjudan. Försök igen om en stund.');
  }
}

// Starta: alltid i den egna ytan (där demo-uppläggen och välkomsten finns)
function obStart() {
  if (obState.ownProject) LossiData.setCurrentProject(obState.ownProject.id);
  try { localStorage.setItem('lossi-welcome', '1'); } catch (e) {}
  window.location.replace('index.html');
}

// Högerytan i steg 3: en liten Lossi med projektväljaren utfälld
function obRenderApp() {
  const own = obState.ownProject || { id: 0, name: 'Din yta' };
  const projects = [{ ...own, meta: 'Bara du', current: true }, ...obState.joined.map(p => ({ ...p, meta: 'Delat projekt' }))];
  obEl('obApp').innerHTML = `
    <div class="ob-app-window">
      <div class="ob-app-bar"><span></span><span></span><span></span></div>
      <div class="ob-app-body">
        <div class="ob-app-switcher">
          ${projectAvatarHTML(own, own.avatar, 'ob-app-avatar')}
          <span class="ob-app-name">${escapeHTML(own.name)}</span>
          <i data-lucide="chevrons-up-down"></i>
        </div>
        <div class="ob-app-menu">
          <div class="ob-app-menu-label">Dina projekt</div>
          ${projects.map(p => `
            <div class="ob-app-item${p.current ? ' is-current' : ''}${p.id === obState.lastJoined ? ' is-new' : ''}">
              ${projectAvatarHTML(p, p.avatar, 'ob-app-item-avatar')}
              <span class="ob-app-item-name">${escapeHTML(p.name)}</span>
              ${p.current ? '<i data-lucide="check"></i>' : ''}
            </div>`).join('')}
          <div class="ob-app-sep"></div>
          <div class="ob-app-item is-muted"><i data-lucide="plus"></i><span class="ob-app-item-name">Nytt projekt</span></div>
        </div>
      </div>
    </div>`;
  lucide.createIcons({ nodes: [obEl('obApp')] });
}


// ── Maskoten (mascot.js) ──
// Tittar på pekaren och på fältet man skriver i, blundar när man skriver
// lösenordet och blinkar då och då.
const obMascot = (() => {
  const mascot = createMascot(obEl('obMascot'));
  let lastPointer = 0;

  // Tittar på fältet man skriver i (ungefär där markören står)
  function lookAtField(el) {
    const r = el.getBoundingClientRect();
    if (el.classList.contains('ob-code-box')) return mascot.lookAt(r.left + r.width / 2, r.top + r.height / 2);
    const typed = Math.min(r.width - 16, 12 + (el.value || '').length * 8);
    mascot.lookAt(r.left + typed, r.top + r.height / 2);
  }

  document.addEventListener('pointermove', e => {
    if (obEl('signupCard').hidden || e.pointerType === 'touch') return;
    lastPointer = Date.now();
    mascot.lookAt(e.clientX, e.clientY);
  });
  document.addEventListener('pointerleave', mascot.center);
  document.documentElement.addEventListener('mouseleave', mascot.center);

  const form = obEl('obForm');
  form.addEventListener('focusin', e => {
    if (!e.target.matches('input')) return;
    mascot.setClosed(e.target.type === 'password');
    lookAtField(e.target);
  });
  form.addEventListener('focusout', e => {
    if (e.target.type === 'password') mascot.setClosed(false);
  });
  form.addEventListener('input', e => {
    // När man skriver följer blicken texten, även om musen nyss rört sig
    if (e.target.matches('input') && Date.now() - lastPointer > 300) lookAtField(e.target);
  });

  blinkNowAndThen(mascot, () => !obEl('signupCard').hidden);

  return mascot;
})();


// login.html?kod=ABC123: öppna steg 1 med koden ifylld (länken från admin-sidan)
(function openFromLink() {
  const param = new URLSearchParams(window.location.search).get('kod');
  if (!param) return;
  showSignup();
  obFillCode(param, 0);
})();
