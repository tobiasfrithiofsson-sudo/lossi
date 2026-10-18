// ── Feedback från testare ──
// Feedback-knappen i topbaren (theme.js) öppnar en dialog där testaren väljer
// Idé, Bugg eller Övrigt och skriver fritt. Sidan och lite teknisk info följer
// med automatiskt (hjälper vid buggar). Sparas via LossiData.sendFeedback i
// tabellen feedback (supabase/feedback.sql). Kräver theme.js och data.js.

const FEEDBACK_KINDS = {
  idea:  { label: 'Idé eller tanke', icon: 'lightbulb', placeholder: 'Vad skulle göra Lossi bättre för dig? Vad kändes konstigt eller saknades?' },
  bug:   { label: 'Något fungerar inte', icon: 'bug', placeholder: 'Vad gjorde du, vad hände, och vad hade du väntat dig skulle hända?' },
  other: { label: 'Övrigt', icon: 'message-circle', placeholder: 'Skriv vad du vill.' },
};

let feedbackKind = 'idea';

function buildFeedbackModalHTML() {
  return `
<div class="modal-overlay" id="feedbackModal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3>Ge feedback</h3>
      <button class="modal-close" onclick="closeFeedbackModal()" aria-label="Stäng">
        <i data-lucide="x"></i>
      </button>
    </div>
    <div class="modal-body feedback-body" id="feedbackForm">
      <p class="feedback-intro">Lossi är under utveckling och allt du tycker är värdefullt – stort som smått.</p>
      <div class="feedback-kinds" role="radiogroup" aria-label="Typ av feedback">
        ${Object.entries(FEEDBACK_KINDS).map(([key, k]) => `
          <button type="button" class="feedback-kind" role="radio" data-kind="${key}" onclick="pickFeedbackKind('${key}')">
            <i data-lucide="${k.icon}"></i>
            <span>${k.label}</span>
          </button>`).join('')}
      </div>
      <label class="feedback-label" for="feedbackMessage">Berätta</label>
      <textarea class="field-input feedback-text" id="feedbackMessage" rows="6" maxlength="5000" oninput="clearFeedbackError()"></textarea>
      <p class="feedback-fine"><i data-lucide="info"></i>Vi ser vilken sida du var på och vilken webbläsare du använder, så att det blir lättare att förstå och rätta till.</p>
      <p class="password-message is-error" id="feedbackError" role="alert" hidden></p>
    </div>
    <div class="feedback-thanks" id="feedbackThanks" hidden>
      <div class="feedback-thanks-icon"><i data-lucide="heart-handshake"></i></div>
      <h4>Tack!</h4>
      <p>Din feedback är skickad. Den läses och hjälper till att forma Lossi.</p>
    </div>
    <div class="modal-footer" id="feedbackFooter">
      <button class="btn-ghost" onclick="closeFeedbackModal()">Avbryt</button>
      <button class="btn-primary" id="feedbackSendBtn" onclick="sendFeedbackForm()">
        <i data-lucide="send"></i>
        Skicka
      </button>
    </div>
  </div>
</div>`;
}

function ensureFeedbackModal() {
  if (document.getElementById('feedbackModal')) return;
  document.body.insertAdjacentHTML('beforeend', buildFeedbackModalHTML());
  const modal = document.getElementById('feedbackModal');
  modal.addEventListener('click', e => { if (e.target === modal) closeFeedbackModal(); });
  lucide.createIcons({ nodes: [modal] });
}

function pickFeedbackKind(kind) {
  feedbackKind = kind;
  document.querySelectorAll('.feedback-kind').forEach(btn => {
    const on = btn.dataset.kind === kind;
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-checked', String(on));
  });
  document.getElementById('feedbackMessage').placeholder = FEEDBACK_KINDS[kind].placeholder;
}

function openFeedbackModal() {
  ensureFeedbackModal();
  document.getElementById('userMenuDropdown')?.classList.remove('open');
  document.getElementById('feedbackForm').hidden = false;
  document.getElementById('feedbackThanks').hidden = true;
  document.getElementById('feedbackFooter').hidden = false;
  document.getElementById('feedbackSendBtn').disabled = false;
  clearFeedbackError();
  pickFeedbackKind(feedbackKind);
  document.getElementById('feedbackModal').classList.add('open');
  document.getElementById('feedbackMessage').focus();
}

function closeFeedbackModal() {
  document.getElementById('feedbackModal')?.classList.remove('open');
}

function clearFeedbackError() {
  document.getElementById('feedbackError').hidden = true;
}

// Det som hjälper att förstå en bugg utan att fråga testaren
function feedbackContext() {
  const context = {
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    userAgent: navigator.userAgent,
    theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
    title: document.title,
  };
  const planTitle = document.getElementById('planTitle')?.textContent.trim();
  if (planTitle) context.planTitle = planTitle;
  return context;
}

async function sendFeedbackForm() {
  const textarea = document.getElementById('feedbackMessage');
  const message = textarea.value.trim();
  const error = document.getElementById('feedbackError');
  if (!message) {
    error.textContent = 'Skriv några ord innan du skickar.';
    error.hidden = false;
    textarea.focus();
    return;
  }
  const btn = document.getElementById('feedbackSendBtn');
  btn.disabled = true;
  try {
    await LossiData.sendFeedback({
      kind: feedbackKind,
      message,
      page: window.location.pathname + window.location.search,
      context: feedbackContext(),
    });
    textarea.value = '';
    document.getElementById('feedbackForm').hidden = true;
    document.getElementById('feedbackFooter').hidden = true;
    document.getElementById('feedbackThanks').hidden = false;
    setTimeout(closeFeedbackModal, 2200);
  } catch (e) {
    console.warn('Kunde inte skicka feedback:', e);
    error.textContent = e?.code === 'PGRST205'
      ? 'Feedback är inte aktiverat i databasen än.'
      : 'Kunde inte skicka. Kontrollera uppkopplingen och försök igen – texten finns kvar.';
    error.hidden = false;
    btn.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('feedbackModal')?.classList.contains('open')) closeFeedbackModal();
});
