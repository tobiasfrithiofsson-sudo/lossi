// ── Välkommen och rundtur – index.html ──
// Efter Skapa konto (onboarding.js sätter localStorage['lossi-welcome'] = '1')
// visas en dialog i tre steg: Välkommen, Använd inte riktiga personuppgifter
// och Få en rundtur. Starta rundturen visar en pratbubbla i taget vid de
// viktigaste delarna av översikten; resten av sidan tonas ner. Rundturen går
// att starta igen från användarmenyn (Visa rundturen → index.html?rundtur).
// Maskoten (mascot.js) finns i bilden och tittar mot det som visas.
// Utseendet finns i styles.css (VÄLKOMST OCH RUNDTUR).

const WELCOME_STEPS = [
  {
    title: 'Välkommen till Lossi',
    body: `<p>Lossi är en tjänst där du planerar dina pedagogiska upplägg. Du beskriver vad eleverna ska arbeta med och vilka betygskriterier de får visa. Sedan bygger du upp lektionerna med aktiviteter och tider. Upplägget kan du dela med kollegor i ett gemensamt projekt och lägga in lektionerna i kalendern.</p>
      <p>Lossi är i betaversion. Det betyder att du är en av de första som använder tjänsten. Funktioner kan ändras, och ibland fungerar något inte som det ska. Använd feedbackknappen när något krånglar eller när du har en idé. Vi läser allt.</p>`,
    props: [
      { icon: 'roller-coaster', x: 14, y: 16, rot: -10 },
      { icon: 'calendar-days', x: 76, y: 20, rot: 9 },
      { icon: 'users', x: 20, y: 74, rot: 8 },
    ],
    look: 'pointer',
  },
  {
    title: 'Använd inte riktiga personuppgifter',
    body: `<p>I detta stadiet är vi inte intresserade av faktiska uppgifter om dig, dina kollegor eller dina elever. Vi vill enbart veta hur du skulle använda Lossi i ditt arbete. Det betyder att säkerheten i databasen kan vara tvivelaktig och inget arbete har ännu gjorts kring GDPR.</p>
      <p class="welcome-dialog-note">Lossi är en beta. Skriv därför inga riktiga personuppgifter om elever, till exempel namn, personnummer eller omdömen.</p>`,
    props: [{ icon: 'shield-check', x: 74, y: 74, rot: 8, big: true }],
    look: 'prop',
    mood: 'curious',
  },
  {
    title: 'Få en rundtur',
    body: `<p>Vill du ha hjälp att komma igång? Rundturen visar steg för steg hur du skapar ett upplägg, lägger till lektioner och aktiviteter och delar med kollegor. Den tar bara ett par minuter, och du kan avbryta när du vill.</p>`,
    props: [{ icon: 'map', x: 24, y: 22, rot: -8, big: true }],
    look: 'prop',
    mood: 'happy',
  },
];

// Rundturen: target är en lista med selektorer (den första som syns används).
// wide: bubblans markering går över hela sidopanelens bredd.
const TOUR_STEPS = [
  {
    target: ['#projectSwitcher'], wide: true, side: 'right', icon: 'folder-kanban',
    title: 'Projekt',
    text: 'Allt i Lossi ligger i ett projekt. Din yta är bara din. Här byter du projekt, skapar nya och bjuder in kollegor att planera tillsammans.',
  },
  {
    target: ['.topnav-create'], side: 'bottom', icon: 'plus',
    title: 'Skapa upplägg',
    text: 'Börja ett nytt upplägg här. Fyll i det själv eller låt AI göra ett första utkast som du sedan ändrar i.',
  },
  {
    target: ['#planList .plan-row:not([style*="none"])', '#sec-plans .section-head'], side: 'bottom', icon: 'roller-coaster',
    title: 'Upplägg',
    text: 'Här finns alla upplägg i projektet. Öppna ett för att bygga lektioner med aktiviteter och dra dem i den ordning du vill. Exemplen får du ändra i och ta bort.',
  },
  {
    target: ['.aside-nav a[href="calendar.html"]'], wide: true, side: 'right', icon: 'calendar-days',
    title: 'Kalender',
    text: 'Lägg in lektionerna i kalendern och markera prov och inlämningar. Med Alla i projektet ser du kollegornas lektioner och får en varning när en klass får mycket samma vecka.',
  },
  {
    target: ['.feedback-btn'], side: 'bottom', icon: 'message-square-heart',
    title: 'Feedback',
    text: 'Något som krånglar eller en idé? Tryck här, vi läser allt. Rundturen hittar du igen under din profilbild.',
  },
];

const tourEl = id => document.getElementById(id);
const tourState = { welcomeStep: 0, step: -1, mascot: null, welcomeMascot: null, pointer: null };

function welcomePropsHTML(props) {
  return props.map(p => `
    <span class="tour-prop${p.big ? ' is-big' : ''}" style="left:${p.x}%; top:${p.y}%; --rot:${p.rot}deg"><i data-lucide="${p.icon}"></i></span>`).join('');
}

// ── Dialogen i tre steg ──
function openWelcomeDialog() {
  if (tourEl('welcomeOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay open welcome-overlay" id="welcomeOverlay">
      <div class="modal welcome-dialog" role="dialog" aria-modal="true" aria-labelledby="welcomeDialogTitle">
        <div class="welcome-dialog-text">
          <h2 class="welcome-dialog-title" id="welcomeDialogTitle"></h2>
          <div class="welcome-dialog-body" id="welcomeDialogBody"></div>
          <footer class="welcome-dialog-actions">
            <button type="button" class="btn btn-text btn-lg" id="welcomeSkip" onclick="finishWelcome(false)" hidden>Hoppa över</button>
            <button type="button" class="btn btn-solid btn-lg" id="welcomeNext" onclick="nextWelcomeStep()">Nästa</button>
          </footer>
        </div>
        <div class="welcome-dialog-media" id="welcomeMascot" aria-hidden="true"><div class="tour-props" id="welcomeProps"></div></div>
      </div>
    </div>`);
  tourState.welcomeMascot = createMascot(tourEl('welcomeMascot'));
  blinkNowAndThen(tourState.welcomeMascot, () => !!tourEl('welcomeOverlay'));
  document.addEventListener('pointermove', welcomePointer);
  showWelcomeStep(0);
}

function welcomePointer(e) {
  if (e.pointerType === 'touch') return;
  tourState.pointer = { x: e.clientX, y: e.clientY };
  if (WELCOME_STEPS[tourState.welcomeStep]?.look === 'pointer') tourState.welcomeMascot?.lookAt(e.clientX, e.clientY);
}

function showWelcomeStep(index) {
  const step = WELCOME_STEPS[index];
  const last = index === WELCOME_STEPS.length - 1;
  tourState.welcomeStep = index;
  tourEl('welcomeDialogTitle').textContent = step.title;
  tourEl('welcomeDialogBody').innerHTML = step.body;
  tourEl('welcomeProps').innerHTML = welcomePropsHTML(step.props);
  tourEl('welcomeSkip').hidden = !last;
  tourEl('welcomeNext').textContent = last ? 'Starta rundturen' : 'Nästa';
  lucide.createIcons({ nodes: [tourEl('welcomeProps')] });
  const mascot = tourState.welcomeMascot;
  mascot.setMood(step.mood || 'normal');
  // Tittar på sin sak i bilden, eller på pekaren
  requestAnimationFrame(() => {
    const prop = tourEl('welcomeProps').querySelector('.tour-prop');
    if (step.look === 'prop' && prop) {
      const r = prop.getBoundingClientRect();
      mascot.lookAt(r.left + r.width / 2, r.top + r.height / 2);
    } else if (tourState.pointer) mascot.lookAt(tourState.pointer.x, tourState.pointer.y);
    else mascot.center();
  });
  tourEl('welcomeNext').focus();
}

function nextWelcomeStep() {
  if (tourState.welcomeStep < WELCOME_STEPS.length - 1) showWelcomeStep(tourState.welcomeStep + 1);
  else finishWelcome(true);
}

function finishWelcome(startTour) {
  try { localStorage.removeItem('lossi-welcome'); } catch (e) {}
  document.removeEventListener('pointermove', welcomePointer);
  tourEl('welcomeOverlay')?.remove();
  tourState.welcomeMascot = null;
  if (startTour) startLossiTour();
}

// ── Rundturen ──
function startLossiTour() {
  endLossiTour();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="tour-layer" id="tourLayer">
      <div class="tour-spot" id="tourSpot"></div>
      <div class="tour-pop" id="tourPop" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourText">
        <span class="tour-arrow" id="tourArrow"></span>
        <div class="tour-pop-media" id="tourMascot" aria-hidden="true"><div class="tour-props" id="tourProps"></div></div>
        <h3 class="tour-pop-title" id="tourTitle"></h3>
        <p class="tour-pop-text" id="tourText"></p>
        <footer class="tour-pop-actions">
          <button type="button" class="btn btn-text btn-lg" onclick="endLossiTour()">Avsluta rundtur</button>
          <button type="button" class="btn btn-solid btn-lg" id="tourNext" onclick="showTourStep(tourState.step + 1)">Nästa</button>
        </footer>
      </div>
    </div>`);
  tourState.mascot = createMascot(tourEl('tourMascot'));
  blinkNowAndThen(tourState.mascot, () => !!tourEl('tourLayer'));
  window.addEventListener('resize', placeTourStep);
  document.addEventListener('keydown', tourKeys);
  showTourStep(0);
}

function endLossiTour() {
  tourEl('tourLayer')?.remove();
  tourState.step = -1;
  tourState.mascot = null;
  window.removeEventListener('resize', placeTourStep);
  document.removeEventListener('keydown', tourKeys);
}

function tourKeys(e) {
  if (e.key === 'Escape') endLossiTour();
}

// Första elementet som syns på skärmen (i mobil är sidopanelen undanskjuten)
function tourTarget(step) {
  for (const selector of step.target) {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.right > 0 && r.left < window.innerWidth) return el;
    }
  }
  return null;
}

function showTourStep(index, tries = 0) {
  if (index >= TOUR_STEPS.length) return endLossiTour();
  const step = TOUR_STEPS[index];
  const target = tourTarget(step);
  if (!target) {
    // Listor och sidopanelen ritas efter hand: vänta lite, hoppa sedan över steget
    if (tries < 10) return setTimeout(() => tourEl('tourLayer') && showTourStep(index, tries + 1), 150);
    return showTourStep(index + 1);
  }
  tourState.step = index;
  const last = !TOUR_STEPS.slice(index + 1).some(s => tourTarget(s));
  tourEl('tourTitle').textContent = step.title;
  tourEl('tourText').textContent = step.text;
  tourEl('tourNext').textContent = last ? 'Klar' : 'Nästa';
  tourEl('tourProps').innerHTML = welcomePropsHTML([{ icon: step.icon, x: 80, y: 22, rot: 8 }]);
  lucide.createIcons({ nodes: [tourEl('tourProps')] });
  tourState.mascot.setMood(last ? 'happy' : 'normal');
  target.scrollIntoView({ block: 'nearest' });
  placeTourStep();
  tourEl('tourNext').focus();
}

// Markeringen runt målet och bubblan bredvid, med pilen mot målet
function placeTourStep() {
  const step = TOUR_STEPS[tourState.step];
  const target = step && tourTarget(step);
  if (!target) return;
  const PAD = 8, GAP = 20, EDGE = 16;
  const r = target.getBoundingClientRect();
  const spot = { left: r.left - PAD, top: r.top - PAD, right: r.right + PAD, bottom: r.bottom + PAD };
  const aside = step.wide && target.closest('.app-aside');
  if (aside) {
    const a = aside.getBoundingClientRect();
    Object.assign(spot, { left: a.left, right: a.right });
  }
  Object.assign(tourEl('tourSpot').style, {
    borderRadius: aside ? '0' : '',
    left: spot.left + 'px', top: spot.top + 'px',
    width: spot.right - spot.left + 'px', height: spot.bottom - spot.top + 'px',
  });

  const pop = tourEl('tourPop');
  const arrow = tourEl('tourArrow');
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  // Till höger om det finns plats, annars under (eller över, om det är trångt nedåt)
  let side = step.side;
  if (side === 'right' && spot.right + GAP + w > vw - EDGE) side = 'bottom';
  if (side === 'bottom' && spot.bottom + GAP + h > vh - EDGE && spot.top - GAP - h > EDGE) side = 'top';
  let left, top;
  if (side === 'right') {
    left = spot.right + GAP;
    top = clamp(cy - 90, EDGE, vh - h - EDGE);
    arrow.style.top = clamp(cy - top, 24, h - 24) + 'px';
    arrow.style.left = '';
  } else {
    left = clamp(cx - w / 2, EDGE, vw - w - EDGE);
    top = side === 'top' ? spot.top - GAP - h : clamp(spot.bottom + GAP, EDGE, vh - h - EDGE);
    arrow.style.left = clamp(cx - left, 24, w - 24) + 'px';
    arrow.style.top = '';
  }
  pop.dataset.side = side;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  // Maskoten tittar mot det som visas
  requestAnimationFrame(() => tourState.mascot?.lookAt(cx, cy));
}

(function startWelcomeOrTour() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('rundtur')) {
    history.replaceState(null, '', window.location.pathname);
    return startLossiTour();
  }
  let show = false;
  try { show = localStorage.getItem('lossi-welcome') === '1'; } catch (e) {}
  if (show) openWelcomeDialog();
})();
