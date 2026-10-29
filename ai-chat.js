// ── Planera med AI: en chatt med Claude Haiku i en egen sidopanel ──
// Panelen ligger till höger på uppläggssidan. Öppnas en aktivitet samtidigt
// lägger sig aktivitetspanelen ovanpå sidan, till vänster om chatten
// (styles.css, body.ai-panel-open), så att läraren ser ändringarna.
//
// Varje svar kommer från serverfunktionen plan-chat (supabase/functions/
// plan-chat), som får konversationen och upplägget som det ser ut just nu.
// Vill AI:n ändra något visas det som ett förslagskort: inget ändras förrän
// läraren väljer Genomför, och det senaste förslaget går att ångra så länge
// upplägget inte ändrats efteråt.
//
// upplag.html anropar PlanChat.init({ planId, readOnly(), snapshot(),
// apply(changes, maps), undo(token), canUndo(token), openOwnAi() }).
// Konversationen sparas per upplägg i webbläsaren (localStorage). Varje svar
// sparas också i Lossi i 90 dagar (ai_chat_logs, supabase/ai-chat-logs.sql)
// med lärarens tumme upp/ner och vad hen gjorde med förslaget, så att
// samtalen kan analyseras i Admin › AI-samtal.
// Panelen går att göra bredare genom att dra i vänsterkanten (bredden sparas i
// webbläsaren) och att visa i helskärm, som aktivitetspanelen.
const PlanChat = (() => {
  const FUNCTION_URL = LOSSI_CONFIG.supabaseUrl + '/functions/v1/plan-chat';
  const MAX_SENT = 30;     // meddelanden som skickas med (serverns MAX_MESSAGES)
  const MAX_STORED = 60;
  const WIDTH_KEY = 'lossi-ai-panel-w';
  const MIN_WIDTH = 360;
  const STARTERS = [
    'Föreslå aktiviteter som passar upplägget',
    'Koppla läroplanen till mina aktiviteter',
    'Gör beskrivningarna tydligare',
    'Lägg till en avslutning i varje gruppering',
  ];

  let hooks = {};
  let messages = [];      // { role, text, proposal?, error? }
  let busy = false;
  let panel = null;
  let mascot = null;
  let blinkTimer = null;
  let pending = null;     // { thinkingMascot } medan vi väntar på första ordet
  const undoTokens = new Map(); // meddelandets index → token från apply (bara i den här sidvisningen)

  function init(h) { hooks = h; }

  const storeKey = () => 'lossi-ai-chat:' + hooks.planId;
  function load() {
    try { messages = JSON.parse(localStorage.getItem(storeKey()) || '[]'); } catch (_) { messages = []; }
    if (!Array.isArray(messages)) messages = [];
    // Ett svar som avbröts (sidan stängdes) räknas inte
    messages = messages.filter(m => m && (m.role === 'user' || m.text || m.proposal || m.error));
  }
  function store() {
    try { localStorage.setItem(storeKey(), JSON.stringify(messages.slice(-MAX_STORED))); } catch (_) { /* privat läge: sparas inte */ }
  }

  // ── Panelen ──
  function build() {
    panel = document.createElement('aside');
    panel.className = 'activity-panel ai-panel';
    panel.id = 'aiPanel';
    panel.setAttribute('aria-label', 'Planera med AI');
    panel.innerHTML = `
      <div class="activity-panel-resize-handle" id="aiPanelResizeHandle"></div>
      <div class="activity-panel-header">
        <div class="activity-panel-header-main">
          <div class="activity-panel-icon ai-panel-icon"><i data-lucide="sparkles"></i></div>
          <span class="activity-panel-title">Planera med AI</span>
        </div>
        <div class="activity-panel-header-actions">
          <button type="button" class="btn btn-text btn-icon" onclick="PlanChat.reset()" title="Ny konversation" aria-label="Ny konversation"><i data-lucide="square-pen"></i></button>
          <button type="button" class="btn btn-text btn-icon ai-panel-expand" id="aiPanelExpandBtn" onclick="PlanChat.toggleFullscreen()" title="Expandera till helskärm" aria-label="Expandera till helskärm"><i data-lucide="maximize-2"></i></button>
          <button type="button" class="btn btn-text btn-icon" onclick="PlanChat.close()" title="Stäng" aria-label="Stäng"><i data-lucide="x"></i></button>
        </div>
      </div>
      <div class="ai-chat-list" id="aiChatList" aria-live="polite"></div>
      <form class="ai-chat-composer" onsubmit="event.preventDefault(); PlanChat.send()">
        <textarea class="ai-chat-input" id="aiChatInput" rows="1" placeholder="Skriv vad du vill planera…" aria-label="Meddelande till AI:n"></textarea>
        <button type="submit" class="btn btn-solid btn-icon ai-chat-send" id="aiChatSend" title="Skicka" aria-label="Skicka"><i data-lucide="arrow-up"></i></button>
      </form>
      <p class="ai-chat-foot">AI kan ha fel, så läs förslagen innan du genomför dem. <button type="button" class="ai-chat-link" onclick="PlanChat.ownAi()">Använd din egen AI i stället</button></p>`;
    document.body.appendChild(panel);
    setupResize();
    const input = panel.querySelector('#aiChatInput');
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      if (e.key === 'Escape') close();
    });
    lucide.createIcons({ nodes: [panel] });
  }

  // ── Bredd och helskärm ──
  // Bredden är --ai-panel-w, så att sidan och aktivitetspanelen flyttar med (styles.css)
  function setWidth(px) {
    const width = Math.min(Math.max(px, MIN_WIDTH), window.innerWidth - 80);
    document.documentElement.style.setProperty('--ai-panel-w', width + 'px');
    return width;
  }

  function setupResize() {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved) setWidth(saved);
    } catch (_) { /* ingen sparad bredd */ }
    const handle = panel.querySelector('#aiPanelResizeHandle');
    let startX = 0;
    let startWidth = 0;
    let width = 0;
    const move = e => { width = setWidth(startWidth + startX - e.clientX); }; // åt vänster = bredare
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      panel.classList.remove('resizing');
      document.body.classList.remove('activity-panel-resizing');
      document.body.style.userSelect = '';
      try { if (width) localStorage.setItem(WIDTH_KEY, String(Math.round(width))); } catch (_) { /* sparas inte */ }
    };
    handle.addEventListener('pointerdown', e => {
      if (panel.classList.contains('fullscreen')) return;
      e.preventDefault();
      startX = e.clientX;
      startWidth = panel.getBoundingClientRect().width;
      panel.classList.add('resizing');
      document.body.classList.add('activity-panel-resizing'); // sidan följer med utan fördröjning
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  function toggleFullscreen(force) {
    if (!panel) return;
    const full = panel.classList.toggle('fullscreen', force);
    document.body.classList.toggle('ai-panel-fullscreen', full);
    const btn = panel.querySelector('#aiPanelExpandBtn');
    const label = full ? 'Återställ storlek' : 'Expandera till helskärm';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = `<i data-lucide="${full ? 'minimize-2' : 'maximize-2'}"></i>`;
    lucide.createIcons({ nodes: [btn] });
  }

  function autosize() {
    const input = document.getElementById('aiChatInput');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }

  function open() {
    if (hooks.readOnly?.()) return;
    if (!panel) build();
    load();
    render();
    panel.classList.add('open');
    document.body.classList.add('ai-panel-open');
    clearInterval(blinkTimer);
    blinkTimer = setInterval(() => { if (mascot) mascot.blink(); }, 4500);
  }

  function close() {
    if (!panel) return;
    toggleFullscreen(false);
    panel.classList.remove('open');
    document.body.classList.remove('ai-panel-open');
    clearInterval(blinkTimer);
    document.removeEventListener('pointermove', follow);
  }

  function toggle() {
    panel?.classList.contains('open') ? close() : open();
  }

  function reset() {
    if (busy) return;
    if (messages.length && !confirm('Börja en ny konversation? Den här konversationen försvinner (ändringar som redan gjorts i upplägget finns kvar).')) return;
    messages = [];
    undoTokens.clear();
    store();
    render();
  }

  function ownAi() {
    close();
    hooks.openOwnAi?.();
  }

  // Maskoten i starten följer pekaren
  function follow(e) { mascot?.lookAt(e.clientX, e.clientY); }

  // ── Rendering ──
  function render() {
    const list = document.getElementById('aiChatList');
    document.removeEventListener('pointermove', follow);
    mascot = null;
    if (!messages.length) {
      list.innerHTML = `
        <div class="ai-chat-intro">
          <div class="ai-chat-intro-mascot"><div class="ai-chat-mascot" aria-hidden="true"></div></div>
          <h3 class="ai-chat-intro-title">Vad vill du planera?</h3>
          <p class="ai-chat-intro-text">Jag ser hela upplägget och kan föreslå grupperingar och aktiviteter, skriva om beskrivningar och koppla läroplanen. Du bestämmer vad som läggs till.</p>
          <div class="ai-chat-starters">
            ${STARTERS.map(s => `<button type="button" class="ai-chat-starter" data-text="${escapeHTML(s)}" onclick="PlanChat.send(this.dataset.text)">${escapeHTML(s)}</button>`).join('')}
          </div>
          <p class="ai-chat-privacy"><i data-lucide="info"></i><span>Upplägget och det du skriver skickas till Anthropic (Claude Haiku). Samtalen sparas i 90 dagar så att vi kan förbättra AI:n. Skriv inte elevers namn.</span></p>
        </div>`;
      mascot = createMascot(list.querySelector('.ai-chat-mascot'), { mouthScale: 1.7 });
      document.addEventListener('pointermove', follow);
    } else {
      list.innerHTML = messages.map((m, i) => messageHTML(m, i)).join('');
    }
    lucide.createIcons({ nodes: [list] });
    if (pending) showThinking();
    scrollToEnd();
    syncComposer();
  }

  function messageHTML(m, i) {
    if (m.role === 'user') return `<div class="ai-msg is-user"><div class="ai-msg-bubble">${escapeHTML(m.text).replace(/\n/g, '<br>')}</div></div>`;
    return `<div class="ai-msg is-ai" data-i="${i}">
      <div class="ai-msg-text">${markdownHTML(m.text)}</div>
      ${m.error ? `<p class="ai-msg-error"><i data-lucide="circle-alert"></i><span>${escapeHTML(m.error)}</span></p>` : ''}
      ${m.proposal ? proposalHTML(m.proposal, i) : ''}
      ${m.logId ? ratingHTML(m, i) : ''}
    </div>`;
  }

  // Lite markdown: stycken, punktlistor, numrerade listor och **fetstil**
  function markdownHTML(text) {
    const inline = s => escapeHTML(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const out = [];
    let listTag = null;
    let para = [];
    const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
    const closeList = () => { if (listTag) out.push(`</${listTag}>`); listTag = null; };
    String(text || '').split('\n').forEach(raw => {
      const line = raw.trimEnd();
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (bullet || numbered) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (listTag !== tag) { closeList(); out.push(`<${tag}>`); listTag = tag; }
        out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      } else if (!line.trim()) {
        flushPara(); closeList();
      } else {
        closeList();
        para.push(line.replace(/^#+\s*/, ''));
      }
    });
    flushPara(); closeList();
    return out.join('');
  }

  // Tumme upp/ner på ett svar (sparas i ai_chat_logs)
  function ratingHTML(m, i) {
    const thumb = (value, icon, label) => `<button type="button" class="ai-rate${m.rating === value ? ' is-on' : ''}" onclick="PlanChat.rate(${i}, ${value})" title="${label}" aria-label="${label}" aria-pressed="${m.rating === value}"><i data-lucide="${icon}"></i></button>`;
    return `<div class="ai-rating">${thumb(1, 'thumbs-up', 'Bra svar')}${thumb(-1, 'thumbs-down', 'Dåligt svar')}</div>`;
  }

  function rate(i, value) {
    const m = messages[i];
    if (!m?.logId) return;
    m.rating = m.rating === value ? null : value;
    store();
    render();
    LossiData.rateAiChat(m.logId, m.rating).catch(e => console.warn('Kunde inte spara omdömet:', e));
  }

  function reportOutcome(i, value) {
    const id = messages[i]?.logId;
    if (id) LossiData.setAiChatOutcome(id, value).catch(e => console.warn('Kunde inte spara utfallet:', e));
  }

  // ── Förslagskortet ──
  const OP_ICONS = { add: 'plus', update: 'pencil', delete: 'trash-2', link: 'link' };

  function changeLines(p) {
    const names = { ...p.labels };
    p.changes.forEach(c => {
      if (c.op === 'add_grouping') names[c.ref] = c.name;
      if (c.op === 'add_activity') names[c.ref] = c.title;
    });
    const name = id => escapeHTML(names[id] || id);
    const minutes = m => (m ? ` · ${m} min` : '');
    return p.changes.map(c => {
      switch (c.op) {
        case 'add_grouping':
          return { kind: 'add', html: `Ny gruppering: <strong>${name(c.ref)}</strong>${minutes(c.minutes)}` };
        case 'update_grouping': {
          const parts = [c.name ? `nytt namn <strong>${escapeHTML(c.name)}</strong>` : '', c.minutes ? `${c.minutes} min` : ''].filter(Boolean).join(', ');
          return { kind: 'update', html: `Ändra grupperingen <strong>${name(c.grouping)}</strong>${parts ? ': ' + parts : ''}` };
        }
        case 'delete_grouping':
          return { kind: 'delete', html: `Ta bort grupperingen <strong>${name(c.grouping)}</strong> med dess aktiviteter` };
        case 'add_activity':
          return { kind: 'add', html: `<strong>${name(c.ref)}</strong> <span class="ai-op-meta">${escapeHTML(c.type)}${c.type === 'Förberedelse' ? ' · före lektionen' : minutes(c.minutes)}${c.grouping ? ` · i ${name(c.grouping)}` : ''}</span>`,
            detail: c.description };
        case 'update_activity': {
          const parts = [c.title ? `ny titel <strong>${escapeHTML(c.title)}</strong>` : '', c.type ? `typ ${escapeHTML(c.type)}` : '', c.minutes ? `${c.minutes} min` : '', c.description ? 'ny beskrivning' : ''].filter(Boolean).join(', ');
          return { kind: 'update', html: `Ändra <strong>${name(c.activity)}</strong>${parts ? ': ' + parts : ''}`, detail: c.description };
        }
        case 'delete_activity':
          return { kind: 'delete', html: `Ta bort <strong>${name(c.activity)}</strong>` };
        case 'link_curriculum':
          return { kind: 'link', html: `Koppla <strong>${name(c.activity)}</strong> till <span class="ai-op-meta">${name(c.item)}</span>` };
        default:
          return null;
      }
    }).filter(Boolean);
  }

  function proposalHTML(p, i) {
    const lines = changeLines(p);
    const status = {
      applied: `<span class="ai-proposal-status is-done"><i data-lucide="check"></i>Genomfört</span>${undoTokens.has(i) && hooks.canUndo?.(undoTokens.get(i)) ? `<button type="button" class="btn btn-text" onclick="PlanChat.undo(${i})"><i data-lucide="undo-2"></i>Ångra</button>` : ''}`,
      declined: '<span class="ai-proposal-status">Avböjt</span>',
      undone: '<span class="ai-proposal-status">Ångrat</span>',
    }[p.status];
    return `<div class="ai-proposal${p.status && p.status !== 'open' ? ' is-' + p.status : ''}">
      <div class="ai-proposal-head"><i data-lucide="wand-sparkles"></i><span>${escapeHTML(p.summary)}</span></div>
      <ul class="ai-proposal-list">
        ${lines.map(l => `<li class="ai-op is-${l.kind}"><i data-lucide="${OP_ICONS[l.kind]}"></i><span class="ai-op-text">${l.html}${l.detail ? `<span class="ai-op-detail">${escapeHTML(l.detail)}</span>` : ''}</span></li>`).join('')}
      </ul>
      ${p.skipped?.length ? `<ul class="ai-proposal-skipped">${p.skipped.map(s => `<li>${escapeHTML(s)}</li>`).join('')}</ul>` : ''}
      <div class="ai-proposal-actions">
        ${status || `<button type="button" class="btn btn-outline" onclick="PlanChat.decline(${i})">Nej tack</button>
        <button type="button" class="btn btn-solid" onclick="PlanChat.accept(${i})">Genomför</button>`}
      </div>
    </div>`;
  }

  function accept(i) {
    const p = messages[i]?.proposal;
    if (!p || (p.status && p.status !== 'open') || hooks.readOnly?.()) return;
    const result = hooks.apply(p.changes, p.maps);
    p.status = 'applied';
    p.skipped = result.skipped;
    if (result.token) undoTokens.set(i, result.token);
    reportOutcome(i, 'applied');
    store();
    render();
  }

  function decline(i) {
    const p = messages[i]?.proposal;
    if (!p || (p.status && p.status !== 'open')) return;
    p.status = 'declined';
    reportOutcome(i, 'declined');
    store();
    render();
  }

  function undo(i) {
    const p = messages[i]?.proposal;
    const token = undoTokens.get(i);
    if (!p || p.status !== 'applied' || !token) return;
    if (!hooks.canUndo(token)) {
      alert('Upplägget har ändrats efter förslaget, så det går inte att ångra längre.');
      render();
      return;
    }
    hooks.undo(token);
    undoTokens.delete(i);
    p.status = 'undone';
    reportOutcome(i, 'undone');
    store();
    render();
  }

  // ── Skicka ──
  function syncComposer() {
    const btn = document.getElementById('aiChatSend');
    if (btn) btn.disabled = busy;
  }

  function scrollToEnd() {
    const list = document.getElementById('aiChatList');
    if (list) list.scrollTop = list.scrollHeight;
  }

  // Maskoten tänker tills första ordet kommer
  function showThinking() {
    const list = document.getElementById('aiChatList');
    const last = list.querySelector('.ai-msg.is-ai:last-child .ai-msg-text');
    if (!last || last.textContent) return;
    last.innerHTML = '<div class="ai-msg-thinking"><div class="ai-msg-thinking-mascot"><div class="ai-chat-mascot" aria-hidden="true"></div></div><span>Tänker…</span></div>';
    pending.mascot = createMascot(last.querySelector('.ai-chat-mascot'), { mouthScale: 1.7 });
    pending.mascot.setThinking(true);
  }

  // Hur ett tidigare svar skickas med: texten plus vad som hände med förslaget
  function wireMessage(m) {
    if (m.role === 'user') return { role: 'user', text: m.text };
    let text = m.text || '';
    if (m.proposal) {
      const what = { applied: 'läraren genomförde det', declined: 'läraren avböjde det', undone: 'läraren genomförde och ångrade det' }[m.proposal.status] || 'läraren har inte svarat på det';
      text += `\n\n[Förslag: ${m.proposal.summary} (${m.proposal.changes.length} ändringar) – ${what}]`;
    }
    if (m.error && !text) text = '[Svaret avbröts]';
    return { role: 'assistant', text };
  }

  async function send(given) {
    if (busy || hooks.readOnly?.()) return;
    const input = document.getElementById('aiChatInput');
    const text = String(given ?? input.value).trim();
    if (!text) return;
    input.value = '';
    autosize();
    // Öppna förslag som läraren skriver förbi räknas som obesvarade
    messages.push({ role: 'user', text });
    const reply = { role: 'assistant', text: '' };
    messages.push(reply);
    busy = true;
    pending = {};
    render();

    try {
      const snap = await hooks.snapshot();
      const session = (await LossiAuth.client.auth.getSession()).data.session;
      if (!session) throw new Error('Du behöver vara inloggad.');
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          apikey: LOSSI_CONFIG.supabasePublishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: messages.slice(0, -1).slice(-MAX_SENT).map(wireMessage), plan: snap.plan, planId: hooks.planId }),
      });
      if (!res.ok || !res.body) {
        let message = 'Svaret gick inte att hämta. Försök igen om en stund.';
        try { message = (await res.json()).error || message; } catch (_) { /* inget svar att läsa */ }
        throw new Error(message);
      }
      await readStream(res.body, reply, snap);
    } catch (e) {
      console.warn('Planera med AI:', e);
      reply.error = e.message || 'Svaret gick inte att hämta. Försök igen om en stund.';
    }
    busy = false;
    pending?.mascot?.setThinking(false);
    pending = null;
    store();
    if (panel?.classList.contains('open')) render();
  }

  // Raderna från plan-chat: text (strömmas in), done (ev. förslag) eller error
  async function readStream(body, reply, snap) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // Svarets element hämtas en gång, så att en fördröjd ritning aldrig hamnar i ett annat meddelande
    const el = document.querySelector('#aiChatList .ai-msg.is-ai:last-child .ai-msg-text');
    let paint = 0;
    const draw = () => {
      paint = 0;
      if (!el?.isConnected) return;
      el.innerHTML = markdownHTML(reply.text);
      scrollToEnd();
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (_) { continue; }
        if (ev.t === 'text') {
          if (pending?.mascot) { pending.mascot.setThinking(false); pending.mascot = null; }
          reply.text += ev.d;
          paint = paint || requestAnimationFrame(draw);
        } else if (ev.t === 'done') {
          if (ev.proposal) reply.proposal = withLabels(ev.proposal, snap);
          if (ev.logId) reply.logId = ev.logId;
        } else if (ev.t === 'error') {
          reply.error = ev.error;
          if (ev.detail) console.warn('Planera med AI (plan-chat):', ev.detail);
        }
      }
    }
    if (paint) cancelAnimationFrame(paint);
    if (!reply.text && !reply.proposal && !reply.error) reply.error = 'Svaret blev tomt. Försök igen.';
  }

  // Förslaget sparas med id-tabellen från när frågan ställdes (G1 → grupperingens id …)
  // och namnen på det som det pekar på, så att kortet kan visas även senare.
  function withLabels(p, snap) {
    const ids = new Set(p.changes.flatMap(c => [c.grouping, c.activity, c.item].filter(Boolean)));
    const labels = {};
    ids.forEach(id => { if (snap.labels[id]) labels[id] = snap.labels[id]; });
    const maps = {};
    Object.entries(snap.maps).forEach(([kind, table]) => {
      maps[kind] = Object.fromEntries(Object.entries(table).filter(([id]) => ids.has(id)));
    });
    return { summary: p.summary, changes: p.changes, maps, labels, status: 'open' };
  }

  return { init, open, close, toggle, toggleFullscreen, reset, send, accept, decline, undo, rate, ownAi };
})();
