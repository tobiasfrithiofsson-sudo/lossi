// ── Uppläggets uppmärkning ──
// HTML för aktiviteter, rader i Centralt innehåll/Betygskriterier och hela
// lektioner. Delas av upplag.html (Ny aktivitet, lektionsförslag) och
// ai-import.js (Skapa med AI), så att allt som skapas ser likadant ut och
// sparas i samma form (structureHTML, goalsHTML, criteriaHTML).
//
// Text in = ren text: allt escapas här, så att inklistrad text aldrig kan bli
// kod på sidan. Kräver escapeHTML (theme.js).

const ACTIVITY_TYPES = {
  'Diskussion':  { iconClass: 'icon-discussion', icon: 'message-square' },
  'Genomgång':   { iconClass: 'icon-review',      icon: 'monitor' },
  'Aktivitet':   { iconClass: 'icon-activity',    icon: 'star' },
  'Exit ticket': { iconClass: 'icon-exit',        icon: 'check-square' },
  'Läsning':     { iconClass: 'icon-reading',     icon: 'book-open' },
};

const GOAL_LISTS = {
  goalsList:    { icon: 'square-check', iconClass: '',                    placeholder: 'Nytt centralt innehåll…' },
  criteriaList: { icon: 'target',       iconClass: 'goal-check-criteria', placeholder: 'Nytt betygskriterium…' },
};

const DRAG_HANDLE_HTML = '<span><i></i><i></i></span><span><i></i><i></i></span><span><i></i><i></i></span>';

// Ren text → säker HTML (radbrytningar blir <br>)
function textToHTML(text) {
  return escapeHTML(String(text ?? '')).replace(/\r?\n/g, '<br>');
}

// De fält (Typ/Beskrivning/Tid) som visas i aktivitetens läsvy. Beskrivning
// och Tid visas bara om de faktiskt har ett värde. Delas mellan
// buildActivityMarkup (vid skapande) och saveActivity (vid sparande), så
// läsvyn aldrig blir inaktuell mot formuläret. descHTML är redan HTML
// (formulärets beskrivningsfält).
function buildActivityReadFields(type, descHTML, time) {
  const fields = [`<div class="read-field"><span class="read-field-label">Typ</span><span class="read-field-value">${escapeHTML(type)}</span></div>`];
  if (descHTML) fields.push(`<div class="read-field"><span class="read-field-label">Beskrivning</span><span class="read-field-value">${descHTML}</span></div>`);
  if (time) fields.push(`<div class="read-field"><span class="read-field-label">Tid</span><span class="read-field-value">${escapeHTML(time)} min</span></div>`);
  return fields.join('\n        ');
}

// Innehållet i en .activity-wrapper (rad + formulär + läsvy). title och desc är ren text.
function buildActivityMarkup(id, { type = 'Diskussion', title = 'Ny aktivitet', time = null, desc = '' } = {}) {
  if (!ACTIVITY_TYPES[type]) type = 'Diskussion';
  const { iconClass, icon } = ACTIVITY_TYPES[type];
  const minutes = time == null || time === '' ? null : Math.max(0, Math.round(Number(time)) || 0);
  const timeLabel = minutes == null ? '– min' : minutes + ' min';
  const timeValue = minutes == null ? '0' : String(minutes);
  const safeTitle = escapeHTML(title);
  const descHTML = textToHTML(desc);
  const options = Object.keys(ACTIVITY_TYPES)
    .map(t => `<option${t === type ? ' selected' : ''}>${t}</option>`).join('\n              ');
  return `
      <div class="activity-row" onclick="toggleActivity('${id}')">
        <div class="drag-handle edit-only" title="Dra för att ändra ordning">
          ${DRAG_HANDLE_HTML}
        </div>
        <div class="activity-icon ${iconClass}" title="${type}">
          <i data-lucide="${icon}"></i>
        </div>
        <span class="activity-title">${safeTitle}</span>
        <span class="activity-time">${timeLabel}</span>
        <div class="popover-wrap" onclick="event.stopPropagation()">
          <button class="activity-more-btn" onclick="toggleAppPopover(this)" title="Fler alternativ">
            <i data-lucide="ellipsis"></i>
          </button>
          <div class="menu-popover">
            <button class="menu-popover-item" onclick="openActivity('${id}')">
              <i data-lucide="pencil"></i>
              Ändra
            </button>
            <button class="menu-popover-item" onclick="duplicateActivity('${id}')">
              <i data-lucide="copy"></i>
              Duplicera
            </button>
            <button class="menu-popover-item menu-popover-item-danger" onclick="confirmDeleteActivity('${id}')">
              <i data-lucide="trash-2"></i>
              Ta bort
            </button>
          </div>
        </div>
      </div>
      <div class="activity-form">
        <div class="field-group">
          <label class="field-label">Sammanfattning</label>
          <input class="field-input" type="text" value="${safeTitle}" placeholder="Beskriv aktiviteten kort" />
        </div>
        <div class="field-group">
          <label class="field-label">Gruppering</label>
          <div class="field-select">
            <div class="field-select-icon ${iconClass}">
              <i data-lucide="${icon}"></i>
            </div>
            <select>
              ${options}
            </select>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Beskrivning</label>
          <div class="inline-editable-rich">
            <div class="inline-editable-toolbar">
              <button class="toolbar-btn" title="Stycke">T</button>
              <button class="toolbar-btn" title="Fet" style="font-weight:800;">B</button>
              <div class="toolbar-sep"></div>
              <button class="toolbar-btn" title="Lista"><i data-lucide="list"></i></button>
              <button class="toolbar-btn" title="Citat"><i data-lucide="quote"></i></button>
              <button class="toolbar-btn" title="Mer">···</button>
            </div>
            <div class="inline-editable-body" contenteditable="true" data-placeholder="Glöm inte bort vad som är viktigt">${descHTML}</div>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Tidsåtgång</label>
          <div class="time-input-wrap">
            <input class="time-input" type="number" value="${timeValue}" min="0" />
            <span class="time-label">min</span>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Filer</label>
          <div class="file-drop">
            <div class="file-drop-text">
              <i data-lucide="paperclip"></i>
              Släpp filer att bifoga eller
              <button class="browse-btn">Bläddra</button>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-danger" onclick="confirmDeleteActivity('${id}')" style="margin-right:auto;">
            <i data-lucide="trash-2"></i>
            Ta bort
          </button>
          <button class="btn-primary" onclick="saveActivity('${id}')">Spara</button>
          <button class="btn-ghost" onclick="closeActivity('${id}')">Avbryt</button>
        </div>
      </div>
      <div class="activity-read">
        ${buildActivityReadFields(type, descHTML, minutes)}
      </div>
    `;
}

// Innehållet i en .goal-item (Centralt innehåll eller Betygskriterier). text är ren text.
function buildGoalItemInnerHTML(listId, text = '') {
  const cfg = GOAL_LISTS[listId] || GOAL_LISTS.goalsList;
  return `
      <div class="drag-handle edit-only" title="Dra för att ändra ordning">
        ${DRAG_HANDLE_HTML}
      </div>
      <div class="goal-check ${cfg.iconClass}">
        <i data-lucide="${cfg.icon}"></i>
      </div>
      <div class="goal-text" contenteditable="true" data-placeholder="${cfg.placeholder}">${escapeHTML(text)}</div>
      <button class="goal-delete" onclick="deleteGoal(this)" title="Ta bort"><i data-lucide="x"></i></button>
    `;
}

function buildGoalListHTML(listId, items) {
  return items.map(text => `<div class="goal-item">${buildGoalItemInnerHTML(listId, text)}</div>`).join('');
}

// En hel lektion som HTML. Resten av lektionsradens knappar (fäll ihop,
// kalender, avklarad, ⋯) läggs till av ensureLessonControls när upplägget
// öppnas. activities = [{ id, type, title, time, desc }]
function buildLessonGroupHTML({ lessonId, name, minutes = null, activities = [] }) {
  const minutesText = minutes == null || minutes === '' ? '' : String(Math.max(0, Math.round(Number(minutes)) || 0));
  return `<div class="lesson-group" data-lesson-id="${escapeHTML(lessonId)}">
      <div class="week-row">
        <div class="drag-handle edit-only" title="Dra för att flytta lektionen">
          ${DRAG_HANDLE_HTML}
        </div>
        <div class="week-pill" contenteditable="true">${escapeHTML(name)}</div>
        <div class="lesson-time-pill">
          <span class="lesson-time-pill-icon"><i data-lucide="triangle-alert"></i></span>
          <span class="lesson-time-pill-value" contenteditable="true" data-placeholder="–" title="Ange lektionens längd i minuter">${minutesText}</span>
          <span class="lesson-time-pill-unit">min</span>
        </div>
      </div>
      <div class="lesson-activities">${activities.map(a => `<div class="activity-wrapper" id="${a.id}">${buildActivityMarkup(a.id, a)}</div>`).join('')}</div>
    </div>`;
}
