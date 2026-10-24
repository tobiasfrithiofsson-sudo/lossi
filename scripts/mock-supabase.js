// TILLFÄLLIG testfil (committas inte): låtsas-Supabase för att förhandsgranska inloggade sidor lokalt.
(function () {
  const user = { id: 'u1', email: 'tobias.frithiofsson@gmail.com', app_metadata: { role: 'admin' }, user_metadata: { display_name: 'Lina Berg', avatar: 'rocket', demo_seeded: true } };
  const session = { user, access_token: 'mock' };
  const saved = JSON.parse(sessionStorage.getItem('mockDb') || 'null');
  // Projekt: lärarens första (1, Sandlådan) och ett till (2) där kollegan Kristoffer (u2) också är med
  const tables = saved || {
    plans: [
      { id: 1, owner_id: 'u1', project_id: 1, state: { demo: true, demoKey: '1', title: 'Demokrati – grunderna och processerna', subject: 'Samhällskunskap', grade: '7–9', avatar: 'sailboat' } },
      { id: 2, owner_id: 'u1', project_id: 1, state: { demo: true, demoKey: '2', title: 'Källkritik i det digitala samhället', subject: 'Samhällskunskap', grade: '9', avatar: 'lightning' } },
      { id: 3, owner_id: 'u1', project_id: 1, state: { demo: true, demoKey: '3', title: 'Fotosyntes – från molekyl till ekosystem', subject: 'Biologi', grade: '7', avatar: 'compass' } },
      { id: 4, owner_id: 'u2', project_id: 2, state: { demo: true, demoKey: '1', title: 'Kristoffers demokratiupplägg', subject: 'Samhällskunskap', grade: '8', avatar: 'compass' } },
      { id: 5, owner_id: 'u1', project_id: 2, state: { demo: true, demoKey: '3', title: 'Linas fotosyntes för skolan', subject: 'Biologi', grade: '7', avatar: 'sailboat' } },
      { id: 6, owner_id: 'u2', project_id: 2, state: { demo: true, demoKey: '2', title: 'Kristoffers källkritik', subject: 'Samhällskunskap', grade: '9', avatar: 'lightning' } },
    ],
    // Medskapare: Kristoffer vill redigera Linas upplägg 5; Lina är medskapare på Kristoffers 6
    plan_editors: [
      { plan_id: 5, user_id: 'u2', status: 'requested' },
      { plan_id: 6, user_id: 'u1', status: 'approved' },
    ],
    projects: [
      { id: 1, name: 'Sandlådan', personal_owner: 'u1', invite_code: 'SND2PQ7K', created_at: '2026-10-19T10:00:00Z', classes: [] },
      { id: 2, name: 'Engelska skolan', personal_owner: null, invite_code: 'K7P4M2QX', created_at: '2026-10-19T11:00:00Z', classes: ['8A', '9C'] },
      // Ett projekt man inte är med i än (för Gå med med kod); filtreras bort tills man gått med
      { id: 3, name: 'Norra skolan', personal_owner: null, invite_code: 'NRSK2026', created_at: '2026-10-19T12:00:00Z', _hidden: true },
    ],
    lesson_events: [],
  };
  const memberProfiles = [
    { project_id: 1, user_id: 'u1', role: 'owner', display_name: 'Lina Berg', avatar: 'rocket', email: user.email },
    { project_id: 2, user_id: 'u1', role: 'owner', display_name: 'Lina Berg', avatar: 'rocket', email: user.email },
    { project_id: 2, user_id: 'u2', role: 'member', display_name: 'Kristoffer Ek', avatar: 'cat', email: 'kristoffer@skola.se' },
    { project_id: 2, user_id: 'u3', role: 'member', display_name: 'Mange W', avatar: null, email: 'mange@skola.se' },
  ];
  // Notiser och inbjudningar (supabase/notifications.sql): en obesvarad inbjudan till Norra skolan (3)
  const ago = min => new Date(Date.now() - min * 60000).toISOString();
  tables.project_invites = tables.project_invites || [{ id: 1, project_id: 3, email: user.email, invited_by: 'u2', status: 'pending', created_at: ago(5) }];
  tables.notifications = tables.notifications || [
    { id: 1, user_id: 'u1', kind: 'project_invite', project_id: 3, invite_id: 1, actor_name: 'Kristoffer Ek', project_name: 'Norra skolan', plan_title: '', created_at: ago(5), read_at: null },
    { id: 2, user_id: 'u1', kind: 'edit_request', project_id: 2, plan_id: 5, actor_name: 'Kristoffer Ek', project_name: 'Engelska skolan', plan_title: 'Linas fotosyntes för skolan', created_at: ago(90), read_at: null },
    { id: 3, user_id: 'u1', kind: 'member_joined', project_id: 2, actor_name: 'Mange W', project_name: 'Engelska skolan', plan_title: '', created_at: ago(60 * 30), read_at: ago(60 * 20) },
  ];
  const persist = () => sessionStorage.setItem('mockDb', JSON.stringify(tables));
  // Koder: ABC123 gäller tills vidare, OLD999 har gått ut
  tables.access_codes = tables.access_codes || [
    { id: 1, code: 'ABC123', valid_until: null, closed_at: null, created_at: ago(60 * 24 * 3) },
    { id: 2, code: 'OLD999', valid_until: ago(60 * 24), closed_at: null, created_at: ago(60 * 24 * 40) },
  ];
  const validAccessCode = code => {
    const c = (tables.access_codes || []).find(x => x.code === String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    return !!c && !c.closed_at && (!c.valid_until || new Date(c.valid_until) > new Date());
  };
  window.__mockDb = tables;
  // Räknar anropen per tabell, så att man kan se hur mycket en sida hämtar (window.__mockCalls)
  const calls = window.__mockCalls = [];
  // Som PostgREST: "id, alias:state->>fält, demo:state->demo"; utan lista (eller *) hela raden
  function project(row, cols) {
    if (!cols || cols.trim() === '*') return row;
    const out = {};
    cols.split(',').map(c => c.trim()).filter(Boolean).forEach(c => {
      const [alias, expr] = c.includes(':') ? c.split(':') : [null, c];
      const m = /^(\w+)->(>?)(\w+)$/.exec(expr);
      if (m) {
        const v = row[m[1]]?.[m[3]];
        out[alias || m[3]] = v == null ? null : (m[2] ? (typeof v === 'object' ? JSON.stringify(v) : String(v)) : v);
      } else out[alias || expr] = row[expr];
    });
    return out;
  }
  function builder(table) {
    const q = { f: [], op: 'select' };
    const rows = () => (tables[table] = tables[table] || []);
    const run = () => {
      let res = rows().filter(r => q.f.every(fn => fn(r)) && !r._hidden);
      const nextId = () => Math.max(0, ...rows().map(r => r.id)) + 1;
      if (q.op === 'insert') {
        // Som databasen: skaparen är den inloggade, projektet det egna om inget anges
        const defaults = table === 'plans' ? { owner_id: user.id, project_id: 1 }
          : table === 'plan_files' ? { uploaded_by: user.id, created_at: new Date().toISOString() } : {};
        const first = nextId(); // flera rader på en gång får olika id
        const ins = [].concat(q.p).map((p, i) => ({ id: first + i, ...defaults, ...p }));
        rows().push(...ins); res = ins;
      }
      // Som databasens regler: bara skaparen ändrar och tar bort upplägg
      // (medskapare får ändra men inte ta bort)
      const isEditor = r => (tables.plan_editors || []).some(e => e.plan_id === r.id && e.user_id === user.id && e.status === 'approved');
      if (table === 'plans' && q.op === 'delete') res = res.filter(r => r.owner_id === user.id);
      if (table === 'plans' && q.op === 'update') res = res.filter(r => r.owner_id === user.id || isEditor(r));
      if (q.op === 'upsert') {
        const keys = q.onConflict.split(',');
        res = [].concat(q.p).map(p => {
          const hit = rows().find(r => keys.every(k => String(r[k]) === String(p[k])));
          if (hit) { Object.assign(hit, p); return hit; }
          const row = { id: nextId(), ...(table === 'lesson_events' ? { owner_id: user.id } : {}), ...p }; rows().push(row); return row;
        });
      }
      if (q.op === 'update') res.forEach(r => Object.assign(r, q.p));
      if (table === 'plan_editors') res = res.map(r => ({ ...r }));
      if (q.op === 'delete') tables[table] = rows().filter(r => !res.includes(r));
      if (q.order) res = res.slice().sort((a, b) => (a[q.order] > b[q.order] ? 1 : -1) * (q.desc ? -1 : 1));
      if (q.limit) res = res.slice(0, q.limit);
      persist();
      if (q.op === 'select' || q.cols) res = res.map(r => project(r, q.cols));
      calls.push({ table, op: q.op, cols: q.cols || '', rows: res.length, bytes: JSON.stringify(res).length });
      if (q.single) return { data: res[0], error: null };
      if (q.maybe) return { data: res[0] || null, error: null };
      return { data: res, error: null };
    };
    const api = {
      select(cols) { q.cols = cols; return api; }, order(k, o) { q.order = k; q.desc = o?.ascending === false; return api; }, limit(n) { q.limit = n; return api; },
      eq(k, v) { q.f.push(r => String(r[k]) === String(v)); return api; },
      in(k, vs) { q.f.push(r => vs.map(String).includes(String(r[k]))); return api; },
      gte(k, v) { q.f.push(r => r[k] >= v); return api; },
      lt(k, v) { q.f.push(r => r[k] < v); return api; },
      insert(p) { q.op = 'insert'; q.p = p; return api; },
      upsert(p, o) { q.op = 'upsert'; q.p = p; q.onConflict = o.onConflict; return api; },
      update(p) { q.op = 'update'; q.p = p; return api; },
      delete() { q.op = 'delete'; return api; },
      maybeSingle() { q.maybe = true; return Promise.resolve(run()); }, single() { q.single = true; return Promise.resolve(run()); },
      then(a, b) { return Promise.resolve(run()).then(a, b); },
    };
    return api;
  }
  // Låtsas-Storage: filerna sparas bara som namn + storlek (window.__mockStorage)
  const stored = window.__mockStorage = JSON.parse(sessionStorage.getItem('mockStorage') || '{}');
  const persistStorage = () => sessionStorage.setItem('mockStorage', JSON.stringify(stored));
  const storage = {
    from: bucket => ({
      upload: async (path, file) => {
        await new Promise(r => setTimeout(r, Number(sessionStorage.getItem('mockUploadDelay') || 300)));
        if (stored[path]) return { data: null, error: { message: 'The resource already exists' } };
        stored[path] = { bucket, size: file.size, name: file.name };
        // Själva filen finns bara kvar tills sidan laddas om (för förhandsvisning i test)
        (window.__mockBlobs = window.__mockBlobs || {})[path] = URL.createObjectURL(file);
        persistStorage();
        return { data: { path }, error: null };
      },
      remove: async paths => { paths.forEach(p => delete stored[p]); persistStorage(); return { data: paths, error: null }; },
      createSignedUrl: async (path, secs, opts) => stored[path]
        ? { data: { signedUrl: (!opts?.download && window.__mockBlobs?.[path]) || `mock://${bucket}/${path}?download=${encodeURIComponent(opts?.download || '')}` }, error: null }
        : { data: null, error: { message: 'Object not found' } },
    }),
  };
  window.supabase = { createClient: () => ({
    storage,
    from: t => builder(t),
    rpc: async (name, params) => {
      const fb = window.__mockFeedback = window.__mockFeedback || [];
      if (name === 'project_member_profiles') return { data: memberProfiles, error: null };
      // Koder för att skapa konto (supabase/access-codes.sql)
      if (name === 'check_access_code') return { data: validAccessCode(params.input_code), error: null };
      if (name === 'admin_list_access_codes') return { data: (tables.access_codes || []).slice().reverse().map(c => ({
        ...c, active: !c.closed_at && (!c.valid_until || new Date(c.valid_until) > new Date()),
        users: (tables.access_code_signups || []).filter(u => u.code === c.code).map(u => ({ name: u.name, email: u.email, created_at: u.created_at })),
      })), error: null };
      if (name === 'admin_create_access_code') {
        const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        const code = Array.from({ length: 6 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
        (tables.access_codes = tables.access_codes || []).push({ id: Date.now(), code, valid_until: params.p_valid_until, closed_at: null, created_at: new Date().toISOString() });
        persist();
        return { data: code, error: null };
      }
      if (name === 'admin_set_access_code_until' || name === 'admin_close_access_code') {
        const c = (tables.access_codes || []).find(x => x.id === params.p_id);
        if (name === 'admin_set_access_code_until') c.valid_until = params.p_valid_until;
        else c.closed_at = params.p_closed ? new Date().toISOString() : null;
        persist();
        return { data: null, error: null };
      }
      const byCode = code => tables.projects.find(p => p.invite_code && p.invite_code === String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (name === 'invite_project_name') return { data: byCode(params.code)?.name || null, error: null };
      const editors = tables.plan_editors;
      const findEditor = (pid, uid) => editors.find(e => e.plan_id === Number(pid) && e.user_id === uid);
      if (name === 'request_plan_edit') {
        const plan = tables.plans.find(p => p.id === Number(params.pid));
        if (plan.owner_id === user.id) return { data: 'owner', error: null };
        if (!findEditor(params.pid, user.id)) editors.push({ plan_id: Number(params.pid), user_id: user.id, status: 'requested' });
        persist();
        return { data: findEditor(params.pid, user.id).status, error: null };
      }
      if (name === 'invite_by_email') {
        const email = params.invite_email.trim().toLowerCase();
        if (email === 'kristoffer@skola.se') return { data: 'member', error: null };
        tables.project_invites.push({ id: tables.project_invites.length + 1, project_id: Number(params.pid), email, invited_by: user.id, status: 'pending', created_at: new Date().toISOString() });
        persist();
        return { data: email.endsWith('@skola.se') ? 'sent' : 'saved', error: null };
      }
      if (name === 'cancel_invite') {
        tables.project_invites = tables.project_invites.filter(i => i.id !== Number(params.invite));
        persist();
        return { data: null, error: null };
      }
      if (name === 'answer_invite') {
        const inv = tables.project_invites.find(i => i.id === Number(params.invite));
        inv.status = params.accept ? 'accepted' : 'declined';
        if (params.accept) {
          const p = tables.projects.find(x => x.id === inv.project_id);
          delete p._hidden;
          memberProfiles.push({ project_id: p.id, user_id: 'u1', role: 'member', display_name: 'Lina Berg', avatar: 'rocket', email: user.email });
        }
        tables.notifications.filter(n => n.invite_id === inv.id).forEach(n => { n.read_at = n.read_at || new Date().toISOString(); });
        persist();
        return { data: inv.project_id, error: null };
      }
      if (name === 'add_plan_editor') {
        const e = findEditor(params.pid, params.editor);
        if (e) e.status = 'approved'; else editors.push({ plan_id: Number(params.pid), user_id: params.editor, status: 'approved' });
        persist();
        return { data: null, error: null };
      }
      if (name === 'decide_plan_edit') {
        const e = findEditor(params.pid, params.editor);
        if (params.approve) e.status = 'approved'; else editors.splice(editors.indexOf(e), 1);
        persist();
        return { data: null, error: null };
      }
      if (name === 'remove_plan_editor') {
        const e = findEditor(params.pid, params.editor);
        if (e) editors.splice(editors.indexOf(e), 1);
        persist();
        return { data: null, error: null };
      }
      // Projektets klasser (supabase/project-classes.sql)
      if (name === 'add_project_class' || name === 'remove_project_class') {
        const p = tables.projects.find(x => x.id === params.pid);
        const clean = String(params.class_name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        p.classes = (p.classes || []).filter(c => c.toLowerCase() !== clean.toLowerCase());
        if (name === 'add_project_class' && clean) p.classes.push(clean);
        persist();
        return { data: p.classes.slice(), error: null };
      }
      if (name === 'set_project_avatar') {
        tables.projects.find(x => x.id === Number(params.pid)).avatar = params.avatar_id || null;
        persist();
        return { data: null, error: null };
      }
      if (name === 'remove_project_member' || name === 'leave_project') {
        const uid = name === 'leave_project' ? user.id : params.member;
        const i = memberProfiles.findIndex(m => m.project_id === Number(params.pid) && m.user_id === uid);
        if (i >= 0) memberProfiles.splice(i, 1);
        tables.plans.filter(p => p.project_id === Number(params.pid) && p.owner_id === uid).forEach(p => { p.project_id = uid === user.id ? 1 : 99; });
        if (uid === user.id) tables.projects.find(x => x.id === Number(params.pid))._hidden = true;
        persist();
        return { data: null, error: null };
      }
      if (name === 'rename_project') {
        const p = tables.projects.find(x => x.id === Number(params.pid));
        p.name = params.project_name.trim().replace(/\s+/g, ' ');
        persist();
        return { data: p.name, error: null };
      }
      if (name === 'delete_project') {
        const pid = Number(params.pid);
        // Som databasen: egna upplägg till det egna projektet (1), kollegans till deras (99, syns inte här)
        tables.plan_editors = tables.plan_editors.filter(e => tables.plans.find(p => p.id === e.plan_id)?.project_id !== pid);
        tables.plans.filter(p => p.project_id === pid).forEach(p => { p.project_id = p.owner_id === user.id ? 1 : 99; });
        tables.projects = tables.projects.filter(p => p.id !== pid);
        persist();
        return { data: null, error: null };
      }
      if (name === 'create_project') {
        const id = Math.max(...tables.projects.map(p => p.id)) + 1;
        tables.projects.push({ id, name: params.project_name.trim(), personal_owner: null, invite_code: 'NY' + String(id).padStart(6, '2'), created_at: new Date().toISOString() });
        memberProfiles.push({ project_id: id, user_id: 'u1', role: 'owner', display_name: 'Lina Berg', avatar: 'rocket', email: user.email });
        persist();
        return { data: id, error: null };
      }
      if (name === 'join_project') {
        const p = byCode(params.code);
        if (!p) return { data: null, error: { message: 'Ogiltig inbjudningskod', code: 'P0002' } };
        if (p._hidden) { delete p._hidden; memberProfiles.push({ project_id: p.id, user_id: 'u1', role: 'member', display_name: 'Lina Berg', avatar: 'rocket', email: user.email }); persist(); }
        return { data: p.id, error: null };
      }
      if (name === 'feedback_admin_list') return { data: fb, error: null };
      if (name === 'feedback_admin_update') { const f = fb.find(x => x.id === params.p_id); Object.assign(f, { status: params.p_status, note: params.p_note || null }); return { data: null, error: null }; }
      return { data: null, error: { code: 'PGRST202' } };
    },
    auth: {
      // sessionStorage mockLoggedOut = utloggad (för att testa login.html)
      getSession: async () => ({ data: { session: sessionStorage.getItem('mockLoggedOut') ? null : session } }),
      onAuthStateChange: cb => { setTimeout(() => cb('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() {} } } }; },
      updateUser: async ({ data }) => { Object.assign(user.user_metadata, data || {}); return { data: { user }, error: null }; },
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ error: null }),
      signUp: async ({ email, options }) => {
        // Som supabase/access-codes.sql: bara med giltig kod
        const code = String(options?.data?.access_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!validAccessCode(code)) return { data: {}, error: { message: 'Database error saving new user', status: 500 } };
        const first = options?.data?.first_name;
        if (first) tables.projects.find(p => p.personal_owner === user.id).name = /[sxz]$/i.test(first) ? first + ' yta' : first + 's yta';
        if (validAccessCode(code)) (tables.access_code_signups = tables.access_code_signups || []).push({ code, email, name: options?.data?.display_name || email, created_at: new Date().toISOString() });
        Object.assign(user.user_metadata, { display_name: options?.data?.display_name || '' });
        // Inbjudningar till den nya adressen blir den inloggades (låtsas-användaren är alltid u1)
        (tables.project_invites || []).forEach(i => { if (i.email === email.toLowerCase()) i.email = user.email; });
        persist();
        if (email === 'finns@skola.se') return { data: {}, error: { message: 'User already registered', status: 422 } };
        sessionStorage.setItem('mockSignUp', JSON.stringify({ email, options }));
        sessionStorage.removeItem('mockLoggedOut');
        return { data: { user, session }, error: null };
      },
    },
  }) };
})();
