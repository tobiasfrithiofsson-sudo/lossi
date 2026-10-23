// ── Välkommen och rundtur – index.html ──
// Efter Skapa konto (onboarding.js sätter localStorage['lossi-welcome'] = '1')
// visas en dialog i tre steg: Välkommen, Använd inte riktiga personuppgifter
// och Få en rundtur. Starta rundturen visar en pratbubbla i taget vid de
// viktigaste delarna av översikten; resten av sidan tonas ner. Rundturen går
// att visa igen med Kom igång i toppraden (openOnboarding i theme.js; från
// andra sidor via index.html?kom-igang, rundturen direkt via ?rundtur).
// Maskoten (mascot.js) finns i bilden och tittar mot det som visas.
// På uppläggssidan visar samma bubblor tips första gången man öppnar ett
// upplägg man får redigera (PLAN_TIPS, maybeShowPlanTips i upplag.html).
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
// action: knappen (nextLabel) och klick på markeringen gör det i stället för
// Nästa. Sista steget öppnar ett eget upplägg och fortsätter med tipsen där.
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
    target: ['.aside-nav a[href="calendar.html"]'], wide: true, side: 'right', icon: 'calendar-days',
    title: 'Kalender',
    text: 'Lägg in lektionerna i kalendern och markera prov och inlämningar. Med Alla i projektet ser du kollegornas lektioner och får en varning när en klass får mycket samma vecka.',
  },
  {
    target: ['.feedback-btn'], side: 'bottom', icon: 'message-square-heart',
    title: 'Feedback',
    text: 'Något som krånglar eller en idé? Tryck här, vi läser allt. Vill du se introduktionen igen trycker du på Kom igång.',
  },
  {
    target: ['#planList .plan-row[data-mine="true"]:not([style*="none"])'], side: 'bottom', icon: 'roller-coaster',
    title: 'Öppna ett upplägg',
    text: 'Här finns alla upplägg i projektet. Öppna ett, så visar vi hur du bygger lektioner med aktiviteter. Exemplen får du ändra i och ta bort.',
    nextLabel: 'Öppna upplägget',
    action: continueTourInPlan,
  },
];
const TOUR_CONTINUE_KEY = 'lossi-tour-continue';

// Rundturen fortsätter med tipsen i upplägget (maybeShowPlanTips)
function continueTourInPlan(row) {
  try { sessionStorage.setItem(TOUR_CONTINUE_KEY, '1'); } catch (e) {}
  endLossiTour();
  row.click();
}

// Tips första gången man öppnar ett upplägg man får redigera (upplag.html)
const PLAN_TIPS = [
  {
    target: ['#structureList .lesson-group > .week-row'], side: 'bottom', icon: 'list-ordered',
    title: 'Lektioner',
    text: 'Upplägget består av lektioner. Klicka på namnet för att byta det, och dra i raden för att flytta lektionen.',
  },
  {
    target: ['#structureList .activity-row'], side: 'bottom', icon: 'grip-vertical',
    title: 'Aktiviteter',
    text: 'Aktiviteterna är det som händer på lektionen. Klicka för att fylla i, och dra i prickarna för att flytta dem, även till en annan lektion.',
  },
  {
    target: ['#structureList .lesson-more-btn'], side: 'bottom', icon: 'ellipsis',
    title: 'Lektionens meny',
    text: 'Här lägger du till aktiviteter, duplicerar lektionen och markerar den som prov eller inlämning.',
  },
  {
    target: ['#structureList .lesson-schedule-btn'], side: 'bottom', icon: 'calendar-plus',
    title: 'Lägg in i kalendern',
    text: 'Välj dag och tid för lektionen. Då syns den i kalendern och under Kommande på översikten.',
  },
  {
    target: ['#sec-files .section-head'], side: 'top', icon: 'paperclip',
    title: 'Filer',
    text: 'Ladda upp material till upplägget. Bilder visas direkt och kommer med när du exporterar till PowerPoint.',
  },
  {
    target: ['#exportBtn'], side: 'bottom', icon: 'download',
    title: 'Exportera',
    text: 'Ladda ner upplägget som Word eller PowerPoint, eller skriv ut det.',
  },
];
const PLAN_TIPS_KEY = 'lossi-plan-tips';

const tourEl = id => document.getElementById(id);
const tourState = { welcomeStep: 0, step: -1, steps: TOUR_STEPS, onEnd: null, mascot: null, welcomeMascot: null, pointer: null };

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
    if (!tourEl('welcomeProps')) return; // dialogen hann stängas
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
// steps: TOUR_STEPS (översikten) eller PLAN_TIPS; onEnd körs när den stängs.
function startLossiTour(steps = TOUR_STEPS, { endLabel = 'Avsluta rundtur', onEnd = null } = {}) {
  endLossiTour();
  tourState.steps = steps;
  tourState.onEnd = onEnd;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="tour-layer" id="tourLayer">
      <div class="tour-spot" id="tourSpot"></div>
      <div class="tour-pop" id="tourPop" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourText">
        <span class="tour-arrow" id="tourArrow"></span>
        <div class="tour-pop-media" id="tourMascot" aria-hidden="true"><div class="tour-props" id="tourProps"></div></div>
        <h3 class="tour-pop-title" id="tourTitle"></h3>
        <p class="tour-pop-text" id="tourText"></p>
        <footer class="tour-pop-actions">
          <button type="button" class="btn btn-text btn-lg" onclick="endLossiTour()">${endLabel}</button>
          <button type="button" class="btn btn-solid btn-lg" id="tourNext" onclick="tourNext()">Nästa</button>
        </footer>
      </div>
    </div>`);
  tourEl('tourLayer').addEventListener('click', tourLayerClick);
  tourState.mascot = createMascot(tourEl('tourMascot'));
  blinkNowAndThen(tourState.mascot, () => !!tourEl('tourLayer'));
  window.addEventListener('resize', placeTourStep);
  document.addEventListener('scroll', placeTourStep, true);
  document.addEventListener('keydown', tourKeys);
  showTourStep(0);
}

function endLossiTour() {
  tourEl('tourLayer')?.remove();
  tourState.step = -1;
  tourState.mascot = null;
  window.removeEventListener('resize', placeTourStep);
  document.removeEventListener('scroll', placeTourStep, true);
  document.removeEventListener('keydown', tourKeys);
  const onEnd = tourState.onEnd;
  tourState.onEnd = null;
  onEnd?.();
}

function tourNext() {
  const step = tourState.steps[tourState.step];
  const target = step && tourTarget(step);
  if (step?.action && target) step.action(target);
  else showTourStep(tourState.step + 1);
}

// Klick på markeringen i ett steg med action (t.ex. upplägget) gör samma sak
function tourLayerClick(e) {
  const step = tourState.steps[tourState.step];
  const target = step?.action && tourTarget(step);
  if (!target || e.target.closest('.tour-pop')) return;
  const r = target.getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) step.action(target);
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
  const steps = tourState.steps;
  if (index >= steps.length) return endLossiTour();
  const step = steps[index];
  const target = tourTarget(step);
  if (!target) {
    // Listor och sidopanelen ritas efter hand: vänta lite, hoppa sedan över steget
    if (tries < 10) return setTimeout(() => tourEl('tourLayer') && showTourStep(index, tries + 1), 150);
    return showTourStep(index + 1);
  }
  tourState.step = index;
  const last = !steps.slice(index + 1).some(s => tourTarget(s));
  tourEl('tourTitle').textContent = step.title;
  tourEl('tourText').textContent = step.text;
  tourEl('tourNext').textContent = step.nextLabel || (last ? 'Klar' : 'Nästa');
  tourEl('tourProps').innerHTML = welcomePropsHTML([{ icon: step.icon, x: 80, y: 22, rot: 8 }]);
  lucide.createIcons({ nodes: [tourEl('tourProps')] });
  tourState.mascot.setMood(last ? 'happy' : 'normal');
  // Scrolla fram målet om det är dolt (även bakom den fasta toppraden)
  const r = target.getBoundingClientRect();
  const topbar = document.querySelector('.app-topbar')?.getBoundingClientRect().bottom || 0;
  if (r.top < topbar + 8 || r.bottom > window.innerHeight - 8) target.scrollIntoView({ block: 'center' });
  placeTourStep();
  setTimeout(placeTourStep, 80); // efter scrollningen, om scroll-händelsen dröjer
  tourEl('tourNext').focus({ preventScroll: true });
}

// Markeringen runt målet och bubblan bredvid, med pilen mot målet
function placeTourStep() {
  const step = tourState.steps[tourState.step];
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
  tourEl('tourSpot').classList.toggle('is-clickable', !!step.action);
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

// Uppläggssidan: tipsen visas en gång (anropas när upplägget har laddats)
// Visas också (igen) när rundturen på översikten fortsätter hit.
function maybeShowPlanTips() {
  let fromTour = false;
  try {
    fromTour = sessionStorage.getItem(TOUR_CONTINUE_KEY) === '1';
    sessionStorage.removeItem(TOUR_CONTINUE_KEY);
    if (!fromTour && localStorage.getItem(PLAN_TIPS_KEY)) return;
  } catch (e) { return; }
  setTimeout(() => startLossiTour(PLAN_TIPS, {
    endLabel: 'Stäng tipsen',
    onEnd: () => { try { localStorage.setItem(PLAN_TIPS_KEY, '1'); } catch (e) {} },
  }), 600);
}

(function startWelcomeOrTour() {
  if (!document.getElementById('planList')) return; // bara översikten
  const params = new URLSearchParams(window.location.search);
  if (params.has('rundtur') || params.has('kom-igang')) {
    history.replaceState(null, '', window.location.pathname);
    return params.has('rundtur') ? startLossiTour() : openWelcomeDialog();
  }
  let show = false;
  try { show = localStorage.getItem('lossi-welcome') === '1'; } catch (e) {}
  if (show) openWelcomeDialog();
})();
